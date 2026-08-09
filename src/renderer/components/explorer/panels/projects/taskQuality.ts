/**
 * taskQuality — 任务质量元数据与执行结果类型定义
 *
 * 设计目标：在「提问 → 执行 → 结果」全链路植入质量保障机制。
 * - TaskQualityMeta：引导用户高质量提问（预期产出 / 验收标准 / 约束 / 参考）
 * - TaskExecutionResult：结构化执行结果（摘要 / 产出 / 验收对照 / 后续建议）
 * - 两者均存入 TaskItem.metadata（JSON 字段），不改表结构，向后兼容。
 *
 * 解析约定：AI 回复末尾以特定分隔标记输出结构化结果块，
 * 由 parseExecutionResult 从文本中提取，前端渲染为结果卡片。
 */

// ─── 任务质量元数据（存入 task.metadata.quality） ──────────

/**
 * 任务质量元数据
 *
 * 在任务创建/编辑时引导用户补充结构化信息，提升 AI 执行质量：
 * - expectedOutput：明确交付物，避免 AI 猜测「要产出什么」
 * - acceptanceCriteria：可勾选验收清单，执行后逐条对照
 * - constraints：技术栈 / 编码规范 / 禁止事项
 * - references：参考资源路径，AI 可按需读取
 * - aiSuggestions：AI 分析任务描述后给出的优化建议
 * - qualityScore：AI 评估的任务描述清晰度评分（1-10）
 */
export interface TaskQualityMeta {
  /** 预期产出（交付什么：代码文件 / 文档 / 分析报告等，含格式要求） */
  expectedOutput?: string
  /** 验收标准（可逐条勾选的检查清单） */
  acceptanceCriteria?: string[]
  /** 约束条件（技术栈 / 编码规范 / 禁止事项） */
  constraints?: string
  /** 参考资源（文件路径 / 链接 / 知识库条目，AI 可通过 read_file 读取） */
  references?: string[]
  /** AI 优化建议（AI 分析任务描述后给出的改进建议，用户可选择采纳） */
  aiSuggestions?: string
  /** 提问质量评分（AI 评估，1-10，越高越清晰） */
  qualityScore?: number
}

/**
 * 从 TaskItem.metadata 中安全提取质量元数据
 *
 * metadata 为 JSON 字段，可能为 null / 旧数据 / 格式不符。
 * 此函数做防御性解析，任何异常都返回空对象（不抛错）。
 */
export function extractQualityMeta(metadata: unknown): TaskQualityMeta {
  if (!metadata || typeof metadata !== 'object') return {}
  const raw = metadata as Record<string, unknown>
  const qualityRaw = raw.quality
  if (!qualityRaw || typeof qualityRaw !== 'object') return {}
  const q = qualityRaw as Record<string, unknown>
  return {
    expectedOutput: typeof q.expectedOutput === 'string' ? q.expectedOutput : undefined,
    acceptanceCriteria: Array.isArray(q.acceptanceCriteria)
      ? q.acceptanceCriteria.filter((s): s is string => typeof s === 'string')
      : undefined,
    constraints: typeof q.constraints === 'string' ? q.constraints : undefined,
    references: Array.isArray(q.references)
      ? q.references.filter((s): s is string => typeof s === 'string')
      : undefined,
    aiSuggestions: typeof q.aiSuggestions === 'string' ? q.aiSuggestions : undefined,
    qualityScore: typeof q.qualityScore === 'number' ? q.qualityScore : undefined,
  }
}

/**
 * 将质量元数据合并写入 TaskItem.metadata（保留其他已有字段）
 *
 * 返回新的 metadata 对象（不修改原对象），可直接用于 update 调用。
 */
export function mergeQualityMeta(
  metadata: unknown,
  quality: Partial<TaskQualityMeta>,
): Record<string, unknown> {
  const base = (metadata && typeof metadata === 'object'
    ? { ...(metadata as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  const existingQuality = (base.quality && typeof base.quality === 'object'
    ? { ...(base.quality as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  base.quality = { ...existingQuality, ...quality }
  return base
}

// ─── 执行结果（存入 task.metadata.result 或从 AI 回复解析） ────

/** 产出文件项 */
export interface DeliverableItem {
  /** 文件路径（相对工作区或绝对） */
  path: string
  /** 该文件的作用 / 描述 */
  description: string
}

/** 验收对照项 */
export interface AcceptanceCheckItem {
  /** 验收标准原文 */
  criteria: string
  /** 是否通过 */
  passed: boolean
  /** 备注（未通过原因 / 补充说明） */
  note?: string
}

/**
 * 结构化执行结果
 *
 * AI 执行任务后按规范输出，由 parseExecutionResult 从回复文本中解析。
 * 前端渲染为结果卡片，支持「查看对话 / 重新执行 / 标记完成」操作。
 */
export interface TaskExecutionResult {
  /** 执行摘要（一段话总结做了什么） */
  summary: string
  /** 产出文件列表（AI 创建 / 修改的文件） */
  deliverables: DeliverableItem[]
  /** 验收对照（逐条对照验收标准） */
  acceptanceCheck: AcceptanceCheckItem[]
  /** 后续建议（改进方向 / 待办事项） */
  followUp?: string
  /** 执行耗时（秒，由前端记录） */
  durationSec?: number
  /** 解析时间戳 */
  parsedAt?: string
}

/**
 * 从 TaskItem.metadata 中安全提取执行结果
 */
export function extractExecutionResult(metadata: unknown): TaskExecutionResult | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = metadata as Record<string, unknown>
  const resultRaw = raw.result
  if (!resultRaw || typeof resultRaw !== 'object') return null
  const r = resultRaw as Record<string, unknown>
  if (typeof r.summary !== 'string') return null

  return {
    summary: r.summary,
    deliverables: Array.isArray(r.deliverables)
      ? r.deliverables
          .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
          .map(d => ({
            path: typeof d.path === 'string' ? d.path : '',
            description: typeof d.description === 'string' ? d.description : '',
          }))
          .filter(d => d.path)
      : [],
    acceptanceCheck: Array.isArray(r.acceptanceCheck)
      ? r.acceptanceCheck
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .map(c => ({
            criteria: typeof c.criteria === 'string' ? c.criteria : '',
            passed: typeof c.passed === 'boolean' ? c.passed : false,
            note: typeof c.note === 'string' ? c.note : undefined,
          }))
          .filter(c => c.criteria)
      : [],
    followUp: typeof r.followUp === 'string' ? r.followUp : undefined,
    durationSec: typeof r.durationSec === 'number' ? r.durationSec : undefined,
    parsedAt: typeof r.parsedAt === 'string' ? r.parsedAt : undefined,
  }
}

/**
 * 将执行结果合并写入 TaskItem.metadata（保留其他已有字段）
 */
export function mergeExecutionResult(
  metadata: unknown,
  result: TaskExecutionResult,
): Record<string, unknown> {
  const base = (metadata && typeof metadata === 'object'
    ? { ...(metadata as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  base.result = result
  return base
}

// ─── 结果解析器（从 AI 回复文本中提取结构化结果） ─────────────

/**
 * 结构化结果块的 H2 标题正则（块起始标记）
 *
 * 约定 AI 在回复末尾以如下 Markdown 结构输出结构化结果（无任何特殊分隔符，
 * 纯 Markdown 标题，便于阅读与解析）：
 *
 * ```markdown
 * ## 执行结果
 *
 * ### 执行摘要
 * 创建了用户认证模块...
 *
 * ### 产出文件
 * - `/src/auth/login.ts` — 登录逻辑
 *
 * ### 验收对照
 * - [x] 实现登录功能
 * - [ ] JWT 鉴权中间件 — 未实现
 *
 * ### 后续建议
 * 建议补充密码重置功能
 * ```
 *
 * 解析逻辑：
 * 1. 定位 `## 执行结果` / `## Execution Result`（H2）作为块起始
 * 2. 块内容延伸到下一个 H2（`## ` 但非 `###`）或文本结束
 * 3. 块内按 `### `（H3）子标题分段，逐段解析为结构化数据
 *
 * 若 AI 未输出此块，返回 null（回退到纯对话展示）。
 *
 * 正则说明：`^##\s+` 后跟标题文本，且其后不能紧跟 `#`（排除 `###`）。
 * 使用 i 标志兼容 Execution Result / execution result 等大小写变体。
 */
const RESULT_BLOCK_HEADING_RE = /^##\s+(执行结果|Execution Result)\s*$/im

/**
 * H2 标题行检测（用于界定结果块的结束边界）
 *
 * 匹配 `## 标题` 但不匹配 `### 标题`。`##` 后必须紧跟空白而非 `#`。
 */
const H2_HEADING_RE = /^##(?!#)\s+\S/

/**
 * 从 AI 回复文本中定位结构化结果块的内容
 *
 * 块起始：第一个匹配 RESULT_BLOCK_HEADING_RE 的行（H2 结果标题）
 * 块结束：该行之后第一个 H2 标题（非 H3），或文本结束
 *
 * @returns 块内容（已 trim）；未找到结果标题时返回 null
 */
function extractResultBlock(text: string): string | null {
  const headingMatch = RESULT_BLOCK_HEADING_RE.exec(text)
  if (!headingMatch) return null

  // 从标题行之后开始扫描，直到遇到下一个 H2（非 H3）或文本结束
  const afterHeading = text.slice(headingMatch.index + headingMatch[0].length)
  const lines = afterHeading.split('\n')
  const blockLines: string[] = []
  for (const line of lines) {
    // 遇到下一个 H2 标题（非 H3）→ 块结束
    if (H2_HEADING_RE.test(line)) break
    blockLines.push(line)
  }
  const block = blockLines.join('\n').trim()
  return block || null
}

/**
 * 从 AI 回复文本中解析结构化执行结果
 *
 * 解析逻辑：
 * 1. 定位 `## 执行结果` H2 标题，提取其后到下一个 H2 之间的内容
 * 2. 按 `### `（H3）子标题分段（摘要 / 产出文件 / 验收对照 / 后续建议）
 * 3. 逐段解析为结构化数据
 *
 * @returns 解析成功返回 TaskExecutionResult，否则返回 null
 */
export function parseExecutionResult(text: string): TaskExecutionResult | null {
  if (!text) return null

  const block = extractResultBlock(text)
  if (!block) return null

  // 按 ### 标题（H3）分段
  const sections = splitSections(block)

  // 按别名查找分段（中英文 + 大小写兼容）。
  // prompt 中英文标题分别为「执行摘要」/「Summary」等，解析器需兼容大小写与变体。
  const summary = getSection(sections, '执行摘要', 'summary').trim()
  if (!summary) return null

  const deliverables = parseDeliverables(
    getSection(sections, '产出文件', 'deliverables'),
  )
  const acceptanceCheck = parseAcceptanceCheck(
    getSection(sections, '验收对照', 'acceptance check', 'acceptance'),
  )
  const followUp = getSection(sections, '后续建议', 'follow-up', 'followup').trim() || undefined

  return {
    summary,
    deliverables,
    acceptanceCheck,
    followUp,
    parsedAt: new Date().toISOString(),
  }
}

/**
 * 将结果块按 `### `（H3）子标题切分为 Map<title, content>
 *
 * 标题行格式：「### 执行摘要」「### Summary」等（支持中英文）
 * 内容为该标题到下一个 ### 标题之间的所有行。
 */
function splitSections(block: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = block.split('\n')
  let currentTitle = ''
  let currentLines: string[] = []

  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/.exec(line)
    if (match) {
      if (currentTitle) {
        sections.set(currentTitle, currentLines.join('\n'))
      }
      currentTitle = match[1].trim()
      currentLines = []
    } else if (currentTitle) {
      currentLines.push(line)
    }
  }
  if (currentTitle) {
    sections.set(currentTitle, currentLines.join('\n'))
  }
  return sections
}

/**
 * 按别名从分段 Map 中查找内容（大小写不敏感）
 *
 * prompt 输出的英文标题为首字母大写形式（如「Summary」「Acceptance Check」「Follow-up」），
 * 解析器需兼容这些变体，避免因大小写或连字符差异导致解析失败。
 *
 * 查找顺序：先精确匹配任一别名，再按小写形式做兜底匹配。
 */
function getSection(sections: Map<string, string>, ...aliases: string[]): string {
  // 1. 精确匹配
  for (const alias of aliases) {
    const value = sections.get(alias)
    if (value) return value
  }
  // 2. 大小写不敏感兜底（兼容 Summary / summary、Follow-up / follow-up 等）
  const lowerAliases = new Set(aliases.map(a => a.toLowerCase()))
  for (const [key, value] of sections) {
    if (lowerAliases.has(key.toLowerCase())) return value
  }
  return ''
}

/**
 * 解析产出文件列表
 *
 * 支持格式：
 * - `- /path/to/file.ts — 描述`
 * - `- /path/to/file.ts: 描述`
 * - `- /path/to/file.ts - 描述`
 */
function parseDeliverables(text: string): DeliverableItem[] {
  const items: DeliverableItem[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    const match = /^\s*[-*]\s*(.+?)\s*[—–\-:]\s*(.+?)\s*$/.exec(line)
    if (match) {
      const path = match[1].replace(/`/g, '').trim()
      const description = match[2].trim()
      if (path) {
        items.push({ path, description })
      }
    }
  }
  return items
}

/**
 * 解析验收对照列表
 *
 * 支持格式：
 * - `- [x] 验收标准`
 * - `- [ ] 验收标准`
 * - `- [x] 验收标准 — 备注`
 * - `- [x] 验收标准: 备注`
 */
function parseAcceptanceCheck(text: string): AcceptanceCheckItem[] {
  const items: AcceptanceCheckItem[] = []
  const lines = text.split('\n')

  for (const line of lines) {
    const match = /^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*$/.exec(line)
    if (match) {
      const passed = match[1].toLowerCase() === 'x'
      const rest = match[2].trim()
      // 分离验收标准与备注
      const noteMatch = /^(.+?)\s*[—–\-:]\s*(.+?)\s*$/.exec(rest)
      if (noteMatch) {
        items.push({
          criteria: noteMatch[1].trim(),
          passed,
          note: noteMatch[2].trim(),
        })
      } else {
        items.push({ criteria: rest, passed })
      }
    }
  }
  return items
}

/**
 * 获取 AI 回复中的纯正文部分（移除结构化结果块）
 *
 * 用于在对话流中展示时，只显示正文不显示末尾的结果块。
 * 从 `## 执行结果` 标题处截断（结果块约定位于回复末尾，故截断其后所有内容）。
 */
export function stripResultBlock(text: string): string {
  if (!text) return text
  const match = RESULT_BLOCK_HEADING_RE.exec(text)
  if (!match) return text
  return text.slice(0, match.index).trimEnd()
}

/**
 * 判断 AI 回复是否包含结构化结果块
 *
 * 判定标准：存在 `## 执行结果` H2 标题，且其后包含 `### 执行摘要` / `### Summary` 子节。
 *
 * 注意：不使用 `\b`（单词边界），因为 `\b` 仅识别 ASCII 字符，中文标题后会失效；
 * 改用 lookahead `(?=\s|$)` 确保标题后紧跟空白或行尾。
 */
export function hasResultBlock(text: string): boolean {
  if (!text) return false
  const match = RESULT_BLOCK_HEADING_RE.exec(text)
  if (!match) return false
  const after = text.slice(match.index + match[0].length)
  return /###\s+(执行摘要|Summary)(?=\s|$)/im.test(after)
}
