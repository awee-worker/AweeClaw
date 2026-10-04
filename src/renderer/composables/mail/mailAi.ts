/**
 * 邮件 AI 整理
 *
 * 三项能力：
 * 1. analyzeMail —— 单封邮件：一句话摘要 + 分类 + 重要度 + 待办提取
 * 2. buildDigest —— 收件箱简报：跨多封邮件的可操作汇总
 * 3. composeMail —— 按用户要求生成邮件正文（写邮件面板「AI 帮写」）
 *
 * 均通过 callLLM 调用模型，要求返回严格 JSON，并用 zod 做结构校验与兜底，
 * 避免模型输出的格式漂移直接进入 UI。
 */

import { z } from 'zod'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig, LLMMessage } from '@shared/protocols/modelProtocol'
import { callLLM } from '../meeting-notes/callLLM'
import type { MailAiResult, MailMessageMeta } from '@shared/protocols/mail'

// ============================================
// 常量
// ============================================

/** 送入模型的正文最大字符数（超出截断，控制 token 成本） */
const MAX_BODY_CHARS = 6000
/** 简报最多纳入的邮件数 */
const MAX_DIGEST_MAILS = 30

// ============================================
// zod schema
// ============================================

const ZTodo = z.object({
  task: z.string().min(1),
  dueDate: z.string().optional(),
})

const ZMailAiRaw = z.object({
  summary: z.string().optional(),
  category: z.string().optional(),
  importance: z.union([z.number(), z.string()]).optional(),
  todos: z.array(ZTodo).optional(),
})

const ZDigestRaw = z.object({
  overview: z.string().optional(),
  highlights: z
    .array(
      z.object({
        subject: z.string().optional(),
        from: z.string().optional(),
        summary: z.string().optional(),
        importance: z.union([z.number(), z.string()]).optional(),
      }),
    )
    .optional(),
  actionItems: z.array(ZTodo).optional(),
})

export type MailDigest = {
  overview: string
  highlights: Array<{ subject: string; from: string; summary: string; importance: number }>
  actionItems: Array<{ task: string; dueDate?: string }>
  generatedAt: number
}

// ============================================
// 工具
// ============================================

/** 从 LLM 输出中容错提取 JSON 对象 */
function parseJsonObject(content: string): unknown {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}

/** 重要度归一化到 1-5，非法值回退 3 */
function normalizeImportance(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}

/** 截断正文 */
function clampBody(text: string): string {
  if (text.length <= MAX_BODY_CHARS) return text
  return `${text.slice(0, MAX_BODY_CHARS)}\n\n…（正文过长已截断）`
}

// ============================================
// 单封邮件整理
// ============================================

const MAIL_ANALYZE_PROMPT = `你是一名高效的个人邮件助理。请分析这封邮件，输出严格 JSON（不要 markdown 代码块）：

{
  "summary": "一句话摘要，不超过 50 字",
  "category": "分类，从以下中选一个：工作 / 通知 / 账单 / 营销 / 社交 / 其他",
  "importance": 1到5的整数（5 最重要）,
  "todos": [{"task": "需要我做的事", "dueDate": "YYYY-MM-DD（可选，邮件中明确提及才填）"}]
}

要求：
- 只在邮件确实包含需要本人处理的事项时才输出 todos，没有则返回空数组
- summary 概括邮件核心，不要复述标题
- importance 结合发件人身份、是否直接点名本人、是否有时限综合判断`

export interface AnalyzeMailInput {
  subject: string
  from: string
  date: number
  text: string
}

export interface AnalyzeMailResult {
  success: boolean
  result?: MailAiResult
  error?: string
}

/** 分析单封邮件 */
export async function analyzeMail(
  llmConfig: LLMConfig | null,
  input: AnalyzeMailInput,
  timeoutMs = 60000,
): Promise<AnalyzeMailResult> {
  if (!llmConfig) {
    return { success: false, error: 'LLM 配置缺失，请先在主窗口配置模型' }
  }

  const body = clampBody(input.text || '（无正文）')
  const userContent = `发件人：${input.from || '(未知)'}\n主题：${input.subject || '(无主题)'}\n\n正文：\n${body}`

  try {
    const messages: LLMMessage[] = [{ role: 'user', content: userContent }]
    const res = await callLLM(llmConfig, messages, {
      systemPrompt: MAIL_ANALYZE_PROMPT,
      timeoutMs,
    })

    const raw = parseJsonObject(res.content || '')
    const parsed = ZMailAiRaw.safeParse(raw)
    if (!parsed.success) {
      logger.system.warn('[mailAi] 单封整理结果结构校验失败', {
        raw: (res.content || '').slice(0, 300),
      })
      return { success: false, error: 'AI 返回格式异常，请重试' }
    }

    const data = parsed.data
    const result: MailAiResult = {
      summary: (data.summary ?? '').trim() || '(无摘要)',
      category: (data.category ?? '其他').trim() || '其他',
      importance: normalizeImportance(data.importance),
      todos: (data.todos ?? []).map((t) => ({
        task: t.task,
        dueDate: t.dueDate || undefined,
      })),
      generatedAt: Date.now(),
      model: llmConfig.model,
    }
    return { success: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.system.error('[mailAi] 单封整理失败', msg)
    return { success: false, error: msg }
  }
}

// ============================================
// 收件箱简报
// ============================================

const DIGEST_PROMPT = `你是一名高效的个人邮件助理。以下是收件箱中的一批邮件摘要，请生成一份可执行的收件箱简报，输出严格 JSON（不要 markdown 代码块）：

{
  "overview": "整体概览，2-3 句话，说明邮件主题分布与需要关注的重点",
  "highlights": [
    {"subject": "邮件主题", "from": "发件人", "summary": "该邮件要点", "importance": 1到5的整数}
  ],
  "actionItems": [{"task": "需要我处理的跨邮件待办", "dueDate": "YYYY-MM-DD（可选）"}]
}

要求：
- highlights 只列最重要的 5 封（按 importance 降序）
- actionItems 汇总所有邮件中需要本人行动的事项，去重合并
- 营销/通知类邮件除非重要，否则不进 highlights`

export interface DigestMailInput {
  subject: string
  from: string
  date: number
  text: string
}

export interface BuildDigestResult {
  success: boolean
  digest?: MailDigest
  error?: string
}

/** 生成收件箱简报 */
export async function buildDigest(
  llmConfig: LLMConfig | null,
  mails: DigestMailInput[],
  timeoutMs = 90000,
): Promise<BuildDigestResult> {
  if (!llmConfig) {
    return { success: false, error: 'LLM 配置缺失，请先在主窗口配置模型' }
  }
  if (mails.length === 0) {
    return { success: false, error: '没有可用于生成简报的邮件' }
  }

  const list = mails.slice(0, MAX_DIGEST_MAILS)
  const blocks = list.map((m, idx) => {
    const body = clampBody(m.text || '').slice(0, 800)
    return `【邮件 ${idx + 1}】\n发件人：${m.from || '(未知)'}\n主题：${m.subject || '(无主题)'}\n正文摘要：${body}`
  })
  const userContent = blocks.join('\n\n---\n\n')

  try {
    const messages: LLMMessage[] = [{ role: 'user', content: userContent }]
    const res = await callLLM(llmConfig, messages, {
      systemPrompt: DIGEST_PROMPT,
      timeoutMs,
    })

    const raw = parseJsonObject(res.content || '')
    const parsed = ZDigestRaw.safeParse(raw)
    if (!parsed.success) {
      logger.system.warn('[mailAi] 简报结果结构校验失败', {
        raw: (res.content || '').slice(0, 300),
      })
      return { success: false, error: 'AI 返回格式异常，请重试' }
    }

    const data = parsed.data
    const digest: MailDigest = {
      overview: (data.overview ?? '').trim(),
      highlights: (data.highlights ?? []).map((h) => ({
        subject: (h.subject ?? '').trim(),
        from: (h.from ?? '').trim(),
        summary: (h.summary ?? '').trim(),
        importance: normalizeImportance(h.importance),
      })),
      actionItems: (data.actionItems ?? []).map((t) => ({
        task: t.task,
        dueDate: t.dueDate || undefined,
      })),
      generatedAt: Date.now(),
    }
    return { success: true, digest }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.system.error('[mailAi] 简报生成失败', msg)
    return { success: false, error: msg }
  }
}

/** 将邮件元数据转换为简报输入（正文由调用方补齐） */
export function metaToDigestInput(
  meta: MailMessageMeta,
  text: string,
): DigestMailInput {
  return {
    subject: meta.subject,
    from: meta.from[0]?.name || meta.from[0]?.address || '',
    date: meta.date,
    text,
  }
}

// ============================================
// 写邮件：AI 帮写正文
// ============================================

const COMPOSE_PROMPT = `你是一名得体的商业邮件撰写助手。请根据用户要求撰写一封邮件，输出严格 JSON（不要 markdown 代码块）：

{
  "subject": "邮件主题（简洁明确，不超过 30 字）",
  "body": "邮件正文（纯文本，可用换行分段，不要使用 markdown 标记）"
}

要求：
- 正文结构：称呼 → 正文内容 → 结尾敬语 → 落款（落款未知时留空，不要编造姓名）
- 语气专业、简洁、礼貌；根据收件人与主题调整措辞
- 若用户提供了当前正文，在其基础上完善，而不是完全另起
- 只输出 JSON，不要额外说明`

const ZComposeRaw = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
})

export interface ComposeMailInput {
  /** 用户对正文的要求（自然语言） */
  instruction: string
  /** 收件人（可选，用于把握称谓与语气） */
  to?: string
  /** 主题（可选；为空时允许模型给出建议主题） */
  subject?: string
  /** 当前正文（可选，作为续写 / 改写参考） */
  currentBody?: string
}

export interface ComposeMailResult {
  success: boolean
  /** 生成的正文（纯文本） */
  body?: string
  /** 建议主题（仅当未提供主题时返回） */
  subject?: string
  error?: string
}

/** 根据用户要求生成邮件正文（写邮件面板「AI 帮写」） */
export async function composeMail(
  llmConfig: LLMConfig | null,
  input: ComposeMailInput,
  timeoutMs = 60000,
): Promise<ComposeMailResult> {
  if (!llmConfig) {
    return { success: false, error: 'LLM 配置缺失，请先在主窗口配置模型' }
  }
  const instruction = (input.instruction || '').trim()
  if (!instruction) {
    return { success: false, error: '请先描述想让 AI 写什么内容' }
  }

  const parts: string[] = [`写作要求：${instruction}`]
  if (input.to) parts.push(`收件人：${input.to}`)
  if (input.subject) parts.push(`邮件主题：${input.subject}`)
  if (input.currentBody && input.currentBody.trim()) {
    parts.push(`当前正文（供参考）：\n${clampBody(input.currentBody.trim())}`)
  }

  try {
    const messages: LLMMessage[] = [{ role: 'user', content: parts.join('\n') }]
    const res = await callLLM(llmConfig, messages, {
      systemPrompt: COMPOSE_PROMPT,
      timeoutMs,
    })

    const raw = parseJsonObject(res.content || '')
    const parsed = ZComposeRaw.safeParse(raw)
    if (!parsed.success || !parsed.data.body?.trim()) {
      logger.system.warn('[mailAi] 写邮件生成结果结构校验失败', {
        raw: (res.content || '').slice(0, 300),
      })
      return { success: false, error: 'AI 返回格式异常，请重试' }
    }

    const data = parsed.data
    return {
      success: true,
      body: data.body.trim(),
      // 用户已填主题时不覆盖，只在主题为空时回填建议
      subject: input.subject?.trim() ? undefined : (data.subject || '').trim() || undefined,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.system.error('[mailAi] 写邮件生成失败', msg)
    return { success: false, error: msg }
  }
}

