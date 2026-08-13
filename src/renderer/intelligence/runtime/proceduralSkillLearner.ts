/**
 * 程序性技能学习器（Procedural Skill Learner）
 *
 * 职责：
 * - 任务成功完成后，提取工具调用序列并生成意图签名
 * - 相似意图出现 ≥2 次且成功率 ≥80% 时，固化为参数化技能模板
 * - 新任务来时匹配已有模板，命中则将"建议工具序列"注入系统提示词
 * - LLM 参考建议方案执行（半自动模式），仍经过权限确认，跳过逐步试错推理
 *
 * 设计原则：
 * - 单一职责：只负责模板的记录、固化、匹配、建议生成，不介入执行循环
 * - 安全边界：仅注入建议，不绕过 approvalService 的工具权限确认
 * - 参数模式化：动态参数（path/command/query 等）标记为占位符，固定参数保留原值
 * - 可观测：记录固化、命中、注入的日志
 * - 健壮性：任何异常静默降级，绝不阻断主流程
 *
 * 存储策略：
 * - 模板持久化到 StorageService（localStorage），键名 PROCEDURAL_TEMPLATES_KEY
 * - 最大模板数 MAX_TEMPLATES，LRU 淘汰
 */

import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import type { ToolCall, ChatMessage } from '@intelligence/providerTypes'

// ============================================
// 常量与类型定义
// ============================================

const PROCEDURAL_TEMPLATES_KEY = 'procedural-skill-templates'
const MAX_TEMPLATES = 100
const MAX_EXAMPLE_INTENTS = 5
const PERSIST_DEBOUNCE_MS = 5000

/** 模板固化阈值 */
const SOLIDIFY_MIN_OCCURRENCES = 2
const SOLIDIFY_MIN_SUCCESS_RATE = 0.8

/** 模板匹配阈值 */
const MATCH_MIN_KEYWORD_OVERLAP = 0.4

/** 已知动态参数字段名（值随任务变化，模式化为占位符） */
const DYNAMIC_PARAM_FIELDS = new Set([
  'path', 'filePath', 'file_path', 'file', 'filename',
  'command', 'cmd', 'script',
  'query', 'search_query', 'searchQuery', 'search',
  'content', 'text', 'code', 'input',
  'cwd', 'workingDirectory', 'working_directory',
  'url', 'link', 'href',
  'pattern', 'regex', 'searchTerm', 'search_term',
  'name', ' newName', 'oldName',
  'replacement', 'find',
  'message', 'description',
  'language', 'framework',
  'directory', 'dir', 'folder',
])

/** 参数槽：区分固定值与动态占位符 */
interface ParamSlot {
  type: 'fixed' | 'dynamic'
  /** fixed 时的固定值（字符串化） */
  value?: string
  /** dynamic 时的占位符名（如 file_path, search_query） */
  placeholder?: string
}

/** 工具调用步骤（参数化） */
interface ToolCallStep {
  toolName: string
  /** 参数模式：字段名 → 槽位 */
  params: Record<string, ParamSlot>
}

/** 程序性技能模板 */
export interface ProceduralTemplate {
  id: string
  /** 意图签名（归一化关键词排序拼接，用于去重） */
  intentSignature: string
  /** 匹配用关键词 */
  intentKeywords: string[]
  /** 任务类型 */
  taskType: TaskType
  /** 成功工具调用序列 */
  toolSequence: ToolCallStep[]
  successCount: number
  failureCount: number
  /** successCount / (successCount + failureCount) */
  successRate: number
  lastUsedAt: number
  createdAt: number
  updatedAt: number
  enabled: boolean
  /** 原始用户消息样本（用于调试与展示） */
  exampleIntents: string[]
}

export type TaskType = 'coding' | 'debugging' | 'refactoring' | 'architecture' | 'testing' | 'documentation' | 'general'

/** 待固化的意图记录（未达到固化阈值的临时记录） */
interface PendingIntent {
  signature: string
  keywords: string[]
  taskType: TaskType
  toolSequence: ToolCallStep[]
  success: boolean
  timestamp: number
  rawIntent: string
}

// ============================================
// 辅助函数
// ============================================

/** 中文停用词 */
const STOP_WORDS_ZH = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那', '和', '与', '或', '一个', '可以', '需要', '帮', '给', '把', '让', '请'])

/** 英文停用词 */
const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'need', 'please', 'help',
  'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that',
  'these', 'those', 'and', 'or', 'but', 'not', 'for', 'with', 'from',
  'to', 'of', 'in', 'on', 'at', 'by', 'about', 'as', 'into', 'how',
])

/** 从文本提取关键词（英文 ≥3 字符 + 中文 2-4 字，去停用词） */
function extractKeywords(text: string): string[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const enWords = lower.match(/[a-z][a-z0-9_-]{2,}/g) || []
  const zhWords = lower.match(/[\u4e00-\u9fa5]{2,4}/g) || []

  const filtered = [
    ...enWords.filter(w => !STOP_WORDS_EN.has(w)),
    ...zhWords.filter(w => !STOP_WORDS_ZH.has(w)),
  ]

  // 去重并取前 8 个（保留出现顺序）
  const unique: string[] = []
  for (const w of filtered) {
    if (!unique.includes(w)) unique.push(w)
    if (unique.length >= 8) break
  }
  return unique
}

/** 生成意图签名（关键词排序拼接，保证相似意图生成相同签名） */
function generateIntentSignature(keywords: string[]): string {
  return [...keywords].sort().join('|')
}

/** 简单推断任务类型 */
function inferTaskType(message: string): TaskType {
  const lower = message.toLowerCase()
  if (/fix|bug|error|报错|修复|错误|异常|crash/.test(lower)) return 'debugging'
  if (/refactor|重构|优化|clean|improve/.test(lower)) return 'refactoring'
  if (/test|测试|spec|coverage|单元测试/.test(lower)) return 'testing'
  if (/doc|readme|文档|comment|注释/.test(lower)) return 'documentation'
  if (/architect|架构|design|设计|pattern|模式/.test(lower)) return 'architecture'
  return 'coding'
}

/** 参数模式化：已知动态字段标记为占位符，其余 fixed */
function schematizeParams(args: Record<string, unknown>): Record<string, ParamSlot> {
  const result: Record<string, ParamSlot> = {}
  for (const [key, value] of Object.entries(args)) {
    if (DYNAMIC_PARAM_FIELDS.has(key)) {
      result[key] = { type: 'dynamic', placeholder: key }
    } else {
      result[key] = { type: 'fixed', value: String(value).slice(0, 200) }
    }
  }
  return result
}

/** 从消息列表提取成功的工具调用序列 */
function extractToolSequence(messages: ChatMessage[], assistantId?: string): ToolCallStep[] {
  const steps: ToolCallStep[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const assistantMsg = msg as { role: 'assistant'; toolCalls?: ToolCall[]; id?: string }

    // 限定到特定 assistant 消息时跳过其他消息
    if (assistantId && assistantMsg.id !== assistantId) continue

    const toolCalls = assistantMsg.toolCalls || []
    for (const tc of toolCalls) {
      // 仅记录成功完成的工具调用
      if (tc.status !== 'success') continue
      steps.push({
        toolName: tc.name,
        params: schematizeParams(tc.arguments || {}),
      })
    }
  }

  return steps
}

/** 计算 Jaccard 相似度 */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const x of setA) {
    if (setB.has(x)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** 从用户消息提取纯文本 */
function extractMessageText(message: unknown): string {
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .filter((p: any) => p?.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ')
  }
  return ''
}

// ============================================
// 程序性技能学习器
// ============================================

class ProceduralSkillLearner {
  /** 已固化的模板 */
  private templates: ProceduralTemplate[] = []
  /** 待固化的意图记录（按签名分组） */
  private pendingIntents: Map<string, PendingIntent[]> = new Map()
  private loaded = false
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  /** 确保模板已从存储加载 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const stored = StorageService.get<ProceduralTemplate[]>(PROCEDURAL_TEMPLATES_KEY)
      if (stored && Array.isArray(stored)) {
        this.templates = stored.slice(0, MAX_TEMPLATES)
        logger.agent.info(`[ProceduralSkill] Loaded ${this.templates.length} templates from storage`)
      }
    } catch (err) {
      logger.agent.warn('[ProceduralSkill] Failed to load templates:', err)
    }
  }

  /** 延迟持久化（防抖） */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.doPersist()
    }, PERSIST_DEBOUNCE_MS)
  }

  private doPersist(): void {
    this.persistTimer = null
    try {
      const toStore = this.templates.slice(0, MAX_TEMPLATES)
      StorageService.set(PROCEDURAL_TEMPLATES_KEY, toStore)
    } catch (err) {
      logger.agent.warn('[ProceduralSkill] Failed to persist templates:', err)
    }
  }

  /**
   * 记录任务完成（成功或失败）
   *
   * 在 runLoop 结束后调用，从 thread.messages 提取工具调用序列，
   * 生成意图签名，尝试固化模板。
   */
  async recordTaskCompletion(req: {
    userMessage: unknown
    threadMessages: ChatMessage[]
    assistantId?: string
    success: boolean
  }): Promise<void> {
    try {
      await this.ensureLoaded()

      const intentText = extractMessageText(req.userMessage)
      if (!intentText.trim()) return

      const keywords = extractKeywords(intentText)
      if (keywords.length === 0) return

      const signature = generateIntentSignature(keywords)
      const taskType = inferTaskType(intentText)
      const toolSequence = req.success
        ? extractToolSequence(req.threadMessages, req.assistantId)
        : []

      // 成功但无工具调用的任务不记录（纯对话无程序性价值）
      if (req.success && toolSequence.length === 0) return

      // 记录到 pending
      const pending = this.pendingIntents.get(signature) || []
      pending.push({
        signature,
        keywords,
        taskType,
        toolSequence,
        success: req.success,
        timestamp: Date.now(),
        rawIntent: intentText.slice(0, 200),
      })

      // 保留最近 20 条 pending
      if (pending.length > 20) {
        pending.splice(0, pending.length - 20)
      }
      this.pendingIntents.set(signature, pending)

      // 尝试固化
      this.trySolidify(signature)

      logger.agent.info(
        `[ProceduralSkill] Recorded task: success=${req.success}, tools=${toolSequence.length}, ` +
          `signature="${signature.slice(0, 60)}", pending=${pending.length}`,
      )
    } catch (err) {
      logger.agent.warn('[ProceduralSkill] recordTaskCompletion failed:', err)
    }
  }

  /**
   * 尝试将 pending 意图固化为模板
   *
   * 条件：出现 ≥ SOLIDIFY_MIN_OCCURRENCES 次且成功率 ≥ SOLIDIFY_MIN_SUCCESS_RATE
   */
  private trySolidify(signature: string): void {
    const pending = this.pendingIntents.get(signature)
    if (!pending || pending.length < SOLIDIFY_MIN_OCCURRENCES) return

    const successCount = pending.filter(p => p.success).length
    const successRate = successCount / pending.length
    if (successRate < SOLIDIFY_MIN_SUCCESS_RATE) return

    // 取最近一次成功的工具序列作为模板
    const lastSuccess = [...pending].reverse().find(p => p.success && p.toolSequence.length > 0)
    if (!lastSuccess) return

    const now = Date.now()
    const exampleIntents = pending
      .map(p => p.rawIntent)
      .filter(Boolean)
      .slice(-MAX_EXAMPLE_INTENTS)

    // 检查是否已有同签名模板（更新而非新建）
    const existingIdx = this.templates.findIndex(t => t.intentSignature === signature)
    if (existingIdx >= 0) {
      const existing = this.templates[existingIdx]
      existing.toolSequence = lastSuccess.toolSequence
      existing.successCount += successCount
      existing.failureCount += pending.length - successCount
      existing.successRate = existing.successCount / (existing.successCount + existing.failureCount)
      existing.lastUsedAt = now
      existing.updatedAt = now
      existing.exampleIntents = [
        ...new Set([...existing.exampleIntents, ...exampleIntents]),
      ].slice(-MAX_EXAMPLE_INTENTS)
      logger.agent.info(`[ProceduralSkill] Updated template: ${signature.slice(0, 60)}, rate=${existing.successRate.toFixed(2)}`)
    } else {
      const template: ProceduralTemplate = {
        id: crypto.randomUUID(),
        intentSignature: signature,
        intentKeywords: lastSuccess.keywords,
        taskType: lastSuccess.taskType,
        toolSequence: lastSuccess.toolSequence,
        successCount,
        failureCount: pending.length - successCount,
        successRate,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        enabled: true,
        exampleIntents,
      }
      this.templates.push(template)

      // LRU 淘汰
      if (this.templates.length > MAX_TEMPLATES) {
        this.templates.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
        this.templates.splice(0, this.templates.length - MAX_TEMPLATES)
      }

      logger.agent.info(
        `[ProceduralSkill] Solidified new template: ${signature.slice(0, 60)}, ` +
          `tools=${template.toolSequence.length}, rate=${successRate.toFixed(2)}`,
      )
    }

    // 固化后清理 pending
    this.pendingIntents.delete(signature)
    this.schedulePersist()
  }

  /**
   * 匹配模板
   *
   * 根据用户消息生成关键词，与现有模板做 Jaccard 相似度匹配。
   * 返回命中的模板（最高相似度且超过阈值），无命中返回 null。
   */
  async matchTemplate(userMessage: string): Promise<ProceduralTemplate | null> {
    try {
      await this.ensureLoaded()
      if (this.templates.length === 0) return null

      const keywords = extractKeywords(userMessage)
      if (keywords.length === 0) return null

      let bestMatch: ProceduralTemplate | null = null
      let bestScore = 0

      for (const template of this.templates) {
        if (!template.enabled) continue
        const score = jaccardSimilarity(keywords, template.intentKeywords)
        if (score > bestScore && score >= MATCH_MIN_KEYWORD_OVERLAP) {
          bestScore = score
          bestMatch = template
        }
      }

      if (bestMatch) {
        bestMatch.lastUsedAt = Date.now()
        this.schedulePersist()
        logger.agent.info(
          `[ProceduralSkill] Template matched: "${bestMatch.intentSignature.slice(0, 60)}", ` +
            `score=${bestScore.toFixed(2)}, tools=${bestMatch.toolSequence.length}`,
        )
      }

      return bestMatch
    } catch (err) {
      logger.agent.warn('[ProceduralSkill] matchTemplate failed:', err)
      return null
    }
  }

  /**
   * 构建建议方案提示词段落
   *
   * 命中模板时注入系统提示词，让 LLM 参考以往成功经验执行。
   * 明确告知 LLM 这是建议而非强制，需根据当前情况调整。
   */
  buildSuggestionPrompt(template: ProceduralTemplate): string | null {
    if (!template.toolSequence || template.toolSequence.length === 0) return null

    const steps = template.toolSequence.map((step, idx) => {
      const params = Object.entries(step.params)
        .map(([key, slot]) => {
          if (slot.type === 'dynamic') {
            return `${key}=<${slot.placeholder}>`
          }
          return `${key}="${slot.value}"`
        })
        .join(', ')

      return `${idx + 1}. ${step.toolName}(${params})`
    })

    const successRatePct = Math.round(template.successRate * 100)

    return `## Suggested Workflow (from past experience)

A similar task was successfully completed ${template.successCount} time(s) with ${successRatePct}% success rate using the following tool sequence:

${steps.join('\n')}

**Instructions**:
- Review the suggested steps above and adapt parameters to the current task context.
- You may skip steps that are unnecessary or add steps as needed.
- Confirm each tool execution as usual — this suggestion does NOT bypass approval.
- If the task context differs significantly from past executions, ignore this suggestion and proceed normally.`
  }

  /** 获取所有模板（用于 UI 展示/调试） */
  async getTemplates(): Promise<ProceduralTemplate[]> {
    await this.ensureLoaded()
    return [...this.templates]
  }

  /** 清除所有模板 */
  async clearTemplates(): Promise<void> {
    this.templates = []
    this.pendingIntents.clear()
    try {
      StorageService.remove(PROCEDURAL_TEMPLATES_KEY)
    } catch (err) {
      logger.store.warn('[ProceduralSkill] Failed to clear templates:', err)
    }
  }
}

export const proceduralSkillLearner = new ProceduralSkillLearner()
