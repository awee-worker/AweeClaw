/**
 * 会议纪要整理 hook
 *
 * 职责：
 * - 将段列表拼接为完整转写文本
 * - 调用 LLM 提取结构化会议纪要（标题/摘要/议题/决议/待办）
 * - 通过 onProgress 回调报告进度（analyzing → extracting → structuring → done）
 * - 生成 MeetingMinutes 结构化数据，传给主进程生成 docx
 *
 * 调用方式：
 *   const organize = useMeetingNotesOrganize()
 *   const minutes = await organize(segments, speakers, llmConfig, { onProgress })
 *
 * 进度推送：
 *   1. analyzing（5%）：拼接转写文本
 *   2. extracting（30%-60%）：LLM 解析关键信息
 *   3. structuring（80%）：构建结构化数据
 *   4. done（100%）：完成
 */

import { useCallback } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import { callLLM } from './callLLM'
import type {
  Segment,
  Speaker,
  MeetingMinutes,
  OrganizeProgress,
} from '@shared/protocols/meetingNotes'

// ============================================
// 类型定义
// ============================================

export interface OrganizeOptions {
  /** 进度回调 */
  onProgress?: (progress: OrganizeProgress) => void
  /** 超时（ms），默认 120s */
  timeoutMs?: number
}

export interface OrganizeResult {
  /** 是否成功 */
  success: boolean
  /** 结构化会议纪要 */
  minutes: MeetingMinutes | null
  /** 错误信息 */
  error?: string
}

// ============================================
// 系统提示与解析
// ============================================

const ORGANIZE_SYSTEM_PROMPT = `你是一个专业的会议纪要整理助手。请基于以下会议转写文本，整理成结构化的会议纪要。

要求：
1. 提取会议的核心议题、决议、待办事项
2. 总结会议摘要（200字以内）
3. 识别参会人员（从转写中提取说话人名）
4. 决议必须是会议中明确达成的共识
5. 待办事项需指明负责人和截止日期（如转写中未明确，则省略 assignee/deadline）

输出格式（严格 JSON，不要添加 markdown 代码块标记）：
{
  "title": "会议标题（简短，不超过 30 字）",
  "summary": "会议摘要，200字以内",
  "topics": [
    {"title": "议题标题", "discussion": "讨论要点"}
  ],
  "decisions": ["决议1", "决议2"],
  "actionItems": [
    {"task": "任务描述", "assignee": "负责人（可选）", "deadline": "截止日期（可选，YYYY-MM-DD）"}
  ]
}`

/**
 * 将段列表拼接为转写文本
 *
 * 格式：
 *   [14:23:05] 我：
 *   原文：Hello everyone...
 *   译文：大家好...
 *
 *   [14:23:30] 用户A：
 *   原文：...
 *   译文：...
 */
function buildTranscriptForLLM(segments: Segment[], speakers: Speaker[]): string {
  const lines: string[] = []
  for (const seg of segments) {
    if (seg.isEnvironment) continue
    const speaker = speakers.find((s) => s.id === seg.speakerId)
    const name = speaker?.name || '未知'
    const time = new Date(seg.startTime).toLocaleTimeString('zh-CN', { hour12: false })

    lines.push(`[${time}] ${name}：`)
    if (seg.originalText) {
      lines.push(`原文：${seg.originalText}`)
    }
    if (seg.translatedText && seg.translatedText !== seg.originalText) {
      lines.push(`译文：${seg.translatedText}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 从转写中提取参会人名（有发言记录的说话人） */
function extractAttendees(segments: Segment[], speakers: Speaker[]): string[] {
  const names = new Set<string>()
  for (const seg of segments) {
    if (seg.isEnvironment) continue
    const speaker = speakers.find((s) => s.id === seg.speakerId)
    if (speaker) {
      names.add(speaker.name)
    }
  }
  return Array.from(names)
}

/**
 * 尝试从 LLM 输出中解析 JSON
 *
 * LLM 可能输出 markdown 代码块或附加说明，需要容错提取。
 */
function parseMinutesJson(content: string): Record<string, unknown> | null {
  // 移除 markdown 代码块标记
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()

  // 直接尝试解析
  try {
    return JSON.parse(cleaned)
  } catch {
    // 失败则提取第一个 JSON 对象
  }

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

/** 安全转换字符串数组 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

// ============================================
// Hook 实现
// ============================================

export function useMeetingNotesOrganize() {
  const organize = useCallback(
    async (
      segments: Segment[],
      speakers: Speaker[],
      llmConfig: LLMConfig | null,
      options: OrganizeOptions = {},
    ): Promise<OrganizeResult> => {
      const { onProgress, timeoutMs = 120000 } = options

      // 进度：analyzing
      onProgress?.({
        stage: 'analyzing',
        percent: 5,
        message: '正在拼接转写文本...',
      })

      const transcript = buildTranscriptForLLM(segments, speakers)
      if (!transcript.trim()) {
        return {
          success: false,
          minutes: null,
          error: '没有可整理的发言内容',
        }
      }

      if (!llmConfig) {
        return {
          success: false,
          minutes: null,
          error: 'LLM 配置缺失，无法整理',
        }
      }

      // 进度：extracting
      onProgress?.({
        stage: 'extracting',
        percent: 30,
        message: 'AI 正在分析会议内容...',
      })

      try {
        const messages = [
          {
            role: 'user' as const,
            content: `请基于以下会议转写文本整理会议纪要：\n\n${transcript}`,
          },
        ]

        const result = await callLLM(llmConfig, messages, {
          systemPrompt: ORGANIZE_SYSTEM_PROMPT,
          timeoutMs,
        })

        // 进度：structuring
        onProgress?.({
          stage: 'structuring',
          percent: 80,
          message: '正在构建结构化纪要...',
        })

        const content = result.content || ''
        if (!content) {
          logger.system.warn('[Organize] LLM returned empty content', {
            reasoning: result.reasoning?.slice(0, 200),
          })
          return {
            success: false,
            minutes: null,
            error: 'LLM 返回为空，请检查模型配置或重试',
          }
        }

        const parsed = parseMinutesJson(content)
        if (!parsed) {
          logger.system.warn('[Organize] Failed to parse LLM JSON, raw:', content.slice(0, 500))
          return {
            success: false,
            minutes: null,
            error: 'AI 返回格式异常，请重试',
          }
        }

        // 构建 MeetingMinutes
        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        const startTime = segments[0]
          ? `${pad(new Date(segments[0].startTime).getHours())}:${pad(new Date(segments[0].startTime).getMinutes())}`
          : ''
        const endTime = segments[segments.length - 1]
          ? `${pad(new Date(segments[segments.length - 1].endTime).getHours())}:${pad(new Date(segments[segments.length - 1].endTime).getMinutes())}`
          : ''

        const topicsRaw = Array.isArray(parsed.topics) ? parsed.topics : []
        const topics = topicsRaw
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .map((t) => ({
            title: String(t.title ?? ''),
            discussion: String(t.discussion ?? ''),
          }))
          .filter((t) => t.title)

        const actionItemsRaw = Array.isArray(parsed.actionItems) ? parsed.actionItems : []
        const actionItems = actionItemsRaw
          .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
          .map((a) => ({
            task: String(a.task ?? ''),
            assignee: a.assignee ? String(a.assignee) : undefined,
            deadline: a.deadline ? String(a.deadline) : undefined,
          }))
          .filter((a) => a.task)

        const minutes: MeetingMinutes = {
          title: String(parsed.title ?? '会议纪要'),
          date,
          startTime,
          endTime,
          attendees: extractAttendees(segments, speakers),
          summary: String(parsed.summary ?? ''),
          topics,
          decisions: asStringArray(parsed.decisions),
          actionItems,
        }

        // 进度：done
        onProgress?.({
          stage: 'done',
          percent: 100,
          message: '整理完成',
        })

        return { success: true, minutes }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.system.error('[Organize] LLM failed:', err)

        onProgress?.({
          stage: 'error',
          percent: 0,
          message: msg,
        })

        return {
          success: false,
          minutes: null,
          error: msg,
        }
      }
    },
    [],
  )

  return { organize }
}
