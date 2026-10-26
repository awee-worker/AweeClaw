/**
 * 文件编辑请求解析器
 *
 * 将 LLM 工具传入的编辑参数解析为三种模式之一：
 * - string：基于 old_string/new_string 的字符串替换
 * - line：基于 start_line/end_line 的行范围替换
 * - batch：基于 edits 数组的批量操作
 *
 * 解析流程：模式检测 → 占位符清理 → 冲突校验 → 字段验证
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                           */
/* ------------------------------------------------------------------ */

export type EditFileMode = 'string' | 'line' | 'batch'

export type EditFileBatchAction = 'replace' | 'insert' | 'delete'

export interface EditFileBatchEdit {
  action: EditFileBatchAction
  start_line?: number
  end_line?: number
  after_line?: number
  content?: string
}

export interface EditFileStringArgs {
  path?: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export interface EditFileLineArgs {
  path?: string
  start_line: number
  end_line: number
  content: string
}

export interface EditFileBatchArgs {
  path?: string
  edits: EditFileBatchEdit[]
}

export type EditFileResolvedArgs = EditFileStringArgs | EditFileLineArgs | EditFileBatchArgs

/**
 * 解析结果。
 *
 * `notes` 记录「被判定忽略的输入」：模型同时给了多种模式的字段时，调用方
 * 会按优先级挑一个执行，剩下的必须显式告诉模型，否则它会以为两件事都做了。
 */
export type EditFileResolution =
  | { ok: true; mode: 'string'; normalized: Record<string, unknown>; args: EditFileStringArgs; notes?: string[] }
  | { ok: true; mode: 'line'; normalized: Record<string, unknown>; args: EditFileLineArgs; notes?: string[] }
  | { ok: true; mode: 'batch'; normalized: Record<string, unknown>; args: EditFileBatchArgs; notes?: string[] }
  | { ok: false; normalized: Record<string, unknown>; error: string; notes?: string[] }

/* ------------------------------------------------------------------ */
/* 字段键常量                                                         */
/* ------------------------------------------------------------------ */

/** 批量模式下需要清理的顶层字段 */
const TOP_LEVEL_KEYS_TO_STRIP = [
  'start_line',
  'end_line',
  'content',
  'old_string',
  'new_string',
  'replace_all',
] as const

/* ------------------------------------------------------------------ */
/* 模式检测器                                                         */
/* ------------------------------------------------------------------ */

/** 检测原始数据中包含哪些模式的字段 */
class ModeDetector {
  /** 是否包含字符串模式字段（null 视为「没给」，避免空值把模式判定带偏） */
  static hasStringMode(data: Record<string, unknown>): boolean {
    return (
      (data.old_string !== undefined && data.old_string !== null) ||
      (data.new_string !== undefined && data.new_string !== null)
    )
  }

  /** 是否包含行模式字段（null 视为「没给」） */
  static hasLineMode(data: Record<string, unknown>): boolean {
    return (
      (data.start_line !== undefined && data.start_line !== null) ||
      (data.end_line !== undefined && data.end_line !== null)
    )
  }

  /** 是否包含批量模式字段（非空 edits 数组） */
  static hasBatchMode(data: Record<string, unknown>): boolean {
    return Array.isArray(data.edits) && data.edits.length > 0
  }

}

/* ------------------------------------------------------------------ */
/* 占位符检测器                                                       */
/* ------------------------------------------------------------------ */

/** 检测 UI 序列化产生的空占位符 */
class PlaceholderDetector {
  /** 值是否为空（undefined 或空字符串） */
  private static isEmpty(value: unknown): boolean {
    return value === undefined || value === ''
  }

  /** 单个 batch edit 是否为镜像顶层字段的空占位符 */
  static isBatchEditPlaceholder(
    edit: unknown,
    topLevel: Record<string, unknown>,
  ): boolean {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return false

    const candidate = edit as Record<string, unknown>
    const action = candidate.action
    if (action !== 'replace' && action !== 'insert' && action !== 'delete') return false

    if (action === 'replace') {
      const mirrorsLineRange =
        typeof candidate.start_line === 'number' &&
        typeof candidate.end_line === 'number' &&
        candidate.start_line === topLevel.start_line &&
        candidate.end_line === topLevel.end_line
      return mirrorsLineRange && this.isEmpty(candidate.content)
    }

    if (action === 'insert') {
      const mirrorsInsertPoint =
        typeof candidate.after_line === 'number' &&
        candidate.after_line === topLevel.after_line
      return mirrorsInsertPoint && this.isEmpty(candidate.content)
    }

    return false
  }

  /** edits 数组是否全部为占位符 */
  static isBatchPlaceholder(data: Record<string, unknown>): boolean {
    if (!Array.isArray(data.edits) || data.edits.length === 0) return false
    return data.edits.every((edit) => this.isBatchEditPlaceholder(edit, data))
  }

  /** 行模式字段是否为空占位符（0/0 或 1/1 且 content 为空） */
  static isLinePlaceholder(data: Record<string, unknown>): boolean {
    if (data.content !== '') return false
    if (typeof data.start_line !== 'number' || typeof data.end_line !== 'number') return false
    return data.start_line === data.end_line && data.start_line <= 1
  }

  /** 字符串模式字段是否为空占位符（old_string 和 new_string 均为空） */
  static isEmptyStringPlaceholder(data: Record<string, unknown>): boolean {
    return data.old_string === '' && data.new_string === ''
  }
}

/* ------------------------------------------------------------------ */
/* 字段清理器                                                         */
/* ------------------------------------------------------------------ */

/** 清理规范化数据中的冲突字段 */
class FieldSanitizer {
  /** 删除批量模式下与顶层冲突的字段 */
  static stripTopLevelFields(normalized: Record<string, unknown>): void {
    for (const key of TOP_LEVEL_KEYS_TO_STRIP) {
      delete normalized[key]
    }
  }

  /** 删除行模式占位符字段 */
  static stripLinePlaceholder(normalized: Record<string, unknown>): void {
    delete normalized.start_line
    delete normalized.end_line
    delete normalized.content
  }

  /** 删除字符串模式占位符字段 */
  static stripStringPlaceholder(normalized: Record<string, unknown>): void {
    delete normalized.old_string
    delete normalized.new_string
    delete normalized.replace_all
  }

  /** 删除空 edits 数组 */
  static stripEmptyEdits(normalized: Record<string, unknown>): void {
    if (Array.isArray(normalized.edits) && normalized.edits.length === 0) {
      delete normalized.edits
    }
  }

  /** 删除占位符 edits 数组 */
  static stripPlaceholderEdits(normalized: Record<string, unknown>): void {
    if (PlaceholderDetector.isBatchPlaceholder(normalized)) {
      delete normalized.edits
    }
  }
}

/* ------------------------------------------------------------------ */
/* 可执行性探测                                                       */
/* ------------------------------------------------------------------ */

/**
 * 判断某个模式的字段是否「足以直接执行」。
 *
 * 与 ModeDetector 的存在性判定分开：存在性回答「出现了哪些字段」（供清理占位符用），
 * 可执行性回答「哪个模式能真正跑起来」（供选模式用）。
 *
 * 二者混用会误伤一类很常见的输入：模型只给了完整的行模式，但顺手带上了
 * `old_string: ""`。存在性判定认为「有字符串模式」于是优先选它，
 * 结果因 old_string 为空而失败——明明行模式是完整的。
 */
class ExecutabilityProbe {
  static string(data: Record<string, unknown>): boolean {
    return (
      typeof data.old_string === 'string' &&
      data.old_string.length > 0 &&
      typeof data.new_string === 'string'
    )
  }

  static line(data: Record<string, unknown>): boolean {
    return (
      typeof data.start_line === 'number' &&
      typeof data.end_line === 'number' &&
      typeof data.content === 'string'
    )
  }

  static batch(data: Record<string, unknown>): boolean {
    return Array.isArray(data.edits) && data.edits.length > 0
  }
}

/* ------------------------------------------------------------------ */
/* 规范化处理器                                                       */
/* ------------------------------------------------------------------ */

/**
 * 把行号字段的字符串形式转成数字。
 *
 * schema 层已经做过同样的转换，但解析器也被非 schema 入口直接调用（测试、内部复用），
 * 两层都做一次，避免同一个入参在不同入口得到不同结论。
 */
function coerceLineNumber(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? value : parsed
  }
  return value
}

/** 对原始数据进行规范化处理，清理占位符与冲突字段 */
function normalizeEditFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }

  // 行号一律按数字处理：模型给 "12" 是常态，不该因此判为参数非法
  if (normalized.start_line !== undefined) normalized.start_line = coerceLineNumber(normalized.start_line)
  if (normalized.end_line !== undefined) normalized.end_line = coerceLineNumber(normalized.end_line)
  if (Array.isArray(normalized.edits)) {
    normalized.edits = normalized.edits.map((edit) => {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return edit
      const candidate = { ...(edit as Record<string, unknown>) }
      if (candidate.start_line !== undefined) candidate.start_line = coerceLineNumber(candidate.start_line)
      if (candidate.end_line !== undefined) candidate.end_line = coerceLineNumber(candidate.end_line)
      if (candidate.after_line !== undefined) candidate.after_line = coerceLineNumber(candidate.after_line)
      return candidate
    })
  }

  // 清理空 edits 和占位符 edits
  FieldSanitizer.stripEmptyEdits(normalized)
  FieldSanitizer.stripPlaceholderEdits(normalized)

  const hasString = ModeDetector.hasStringMode(normalized)
  const hasLine = ModeDetector.hasLineMode(normalized)
  const hasBatch = ModeDetector.hasBatchMode(normalized)

  // 批量模式优先 — 清理所有顶层冲突字段
  if (hasBatch) {
    FieldSanitizer.stripTopLevelFields(normalized)
    return normalized
  }

  // 字符串或批量模式下，清理行模式占位符
  if ((hasString || hasBatch) && PlaceholderDetector.isLinePlaceholder(normalized)) {
    FieldSanitizer.stripLinePlaceholder(normalized)
  }

  // 行或批量模式下，清理字符串模式占位符
  if ((hasLine || hasBatch) && PlaceholderDetector.isEmptyStringPlaceholder(normalized)) {
    FieldSanitizer.stripStringPlaceholder(normalized)
  }

  return normalized
}

/* ------------------------------------------------------------------ */
/* 解析器                                                             */
/* ------------------------------------------------------------------ */

/** 字符串模式解析器 */
function parseStringMode(
  normalized: Record<string, unknown>,
): EditFileResolution {
  const oldStr = normalized.old_string
  const newStr = normalized.new_string

  if (typeof oldStr !== 'string' || oldStr.length === 0 || typeof newStr !== 'string') {
    return {
      ok: false,
      normalized,
      error: 'String mode requires both old_string and new_string',
    }
  }

  return {
    ok: true,
    mode: 'string',
    normalized,
    args: {
      path: typeof normalized.path === 'string' ? normalized.path : undefined,
      old_string: oldStr,
      new_string: newStr,
      replace_all: normalized.replace_all === true,
    },
  }
}

/** 行模式解析器 */
function parseLineMode(
  normalized: Record<string, unknown>,
): EditFileResolution {
  const startLine = normalized.start_line
  const endLine = normalized.end_line
  const content = normalized.content

  if (
    typeof startLine !== 'number' ||
    typeof endLine !== 'number' ||
    typeof content !== 'string'
  ) {
    return {
      ok: false,
      normalized,
      error: 'Line mode requires start_line, end_line, and content',
    }
  }

  if (startLine > endLine) {
    return {
      ok: false,
      normalized,
      error: 'start_line must be <= end_line',
    }
  }

  return {
    ok: true,
    mode: 'line',
    normalized,
    args: {
      path: typeof normalized.path === 'string' ? normalized.path : undefined,
      start_line: startLine,
      end_line: endLine,
      content,
    },
  }
}

/** 单个 batch edit 校验 */
function validateBatchEdit(
  edit: unknown,
  index: number,
): { ok: true; edit: EditFileBatchEdit } | { ok: false; error: string } {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
    return { ok: false, error: `Edit ${index}: action must be "replace", "insert", or "delete"` }
  }

  const candidate = edit as Record<string, unknown>
  const action = candidate.action
  if (action !== 'replace' && action !== 'insert' && action !== 'delete') {
    return { ok: false, error: `Edit ${index}: action must be "replace", "insert", or "delete"` }
  }

  const parsedEdit: EditFileBatchEdit = { action: action as EditFileBatchAction }

  // replace / delete 需要行范围
  if (action === 'replace' || action === 'delete') {
    if (
      typeof candidate.start_line !== 'number' ||
      typeof candidate.end_line !== 'number'
    ) {
      return { ok: false, error: `Edit ${index}: ${action} requires start_line and end_line` }
    }
    if (candidate.start_line > candidate.end_line) {
      return { ok: false, error: `Edit ${index}: start_line must be <= end_line` }
    }
    parsedEdit.start_line = candidate.start_line
    parsedEdit.end_line = candidate.end_line
  }

  // insert 需要插入锚点
  if (action === 'insert') {
    if (typeof candidate.after_line !== 'number') {
      return { ok: false, error: `Edit ${index}: insert requires after_line` }
    }
    parsedEdit.after_line = candidate.after_line
  }

  // replace / insert 需要 content
  if (
    (action === 'replace' || action === 'insert') &&
    typeof candidate.content !== 'string'
  ) {
    return { ok: false, error: `Edit ${index}: ${action} requires content` }
  }

  if (typeof candidate.content === 'string') {
    parsedEdit.content = candidate.content
  }

  return { ok: true, edit: parsedEdit }
}

/** 批量模式解析器 */
function parseBatchMode(
  normalized: Record<string, unknown>,
): EditFileResolution {
  const edits = normalized.edits
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      ok: false,
      normalized,
      error: 'Batch mode requires non-empty edits array',
    }
  }

  const parsedEdits: EditFileBatchEdit[] = []
  for (let i = 0; i < edits.length; i++) {
    const result = validateBatchEdit(edits[i], i)
    if (!result.ok) {
      return { ok: false, normalized, error: result.error }
    }
    parsedEdits.push(result.edit)
  }

  return {
    ok: true,
    mode: 'batch',
    normalized,
    args: {
      path: typeof normalized.path === 'string' ? normalized.path : undefined,
      edits: parsedEdits,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 主入口                                                             */
/* ------------------------------------------------------------------ */

/** 附带说明地返回解析结果 */
function withNotes(resolution: EditFileResolution, notes: string[]): EditFileResolution {
  if (notes.length === 0) return resolution
  // 逐分支展开而不是重构对象：mode 与 args 是一一对应的判别联合，
  // 用 { mode: resolution.mode, args: resolution.args } 会把它们的关联拆散。
  if (!resolution.ok) return { ...resolution, notes }
  if (resolution.mode === 'string') return { ...resolution, notes }
  if (resolution.mode === 'line') return { ...resolution, notes }
  return { ...resolution, notes }
}

/**
 * 解析编辑文件请求。
 *
 * 模式推断是「全函数」：只要入参里有一种模式可用，就一定选出一个并返回成功，
 * 不会因为模型多带了别的模式的字段而报错。被忽略的字段写入 `notes` 回传，
 * 由执行器拼进结果文本，模型可以据此自我纠正下一轮的调用。
 */
export function resolveEditFileRequest(data: Record<string, unknown>): EditFileResolution {
  // 1. 先基于原始入参记录「哪些模式的字段是有意义的」。
  //    规范化会清掉批量模式下的顶层字段，之后就拿不到被忽略的信息了。
  const meaningfulString = ModeDetector.hasStringMode(data) && !PlaceholderDetector.isEmptyStringPlaceholder(data)
  const meaningfulLine = ModeDetector.hasLineMode(data) && !PlaceholderDetector.isLinePlaceholder(data)
  const meaningfulBatch = ModeDetector.hasBatchMode(data) && !PlaceholderDetector.isBatchPlaceholder(data)

  // 2. 规范化：清理空占位符；批量模式存在时清掉与顶层冲突的字段
  const normalized = normalizeEditFileArgs(data)

  // 3. 记录被忽略的模式，供调用方回传给模型
  const notes: string[] = []
  if (meaningfulBatch) {
    if (meaningfulString) {
      notes.push('old_string/new_string were ignored because a non-empty edits array was also provided — batch mode takes precedence.')
    }
    if (meaningfulLine) {
      notes.push('start_line/end_line/content were ignored because a non-empty edits array was also provided — batch mode takes precedence.')
    }
  } else if (meaningfulString && meaningfulLine) {
    notes.push('start_line/end_line/content were ignored because old_string/new_string were also provided — string mode takes precedence.')
  }

  // 4. 按「可执行性」挑模式，优先级 batch > string > line：
  //    batch 自带行号与内容，信息量最大；string 不依赖行号，比 line 更抗错位。
  if (ExecutabilityProbe.batch(normalized)) return withNotes(parseBatchMode(normalized), notes)
  if (ExecutabilityProbe.string(normalized)) return withNotes(parseStringMode(normalized), notes)
  if (ExecutabilityProbe.line(normalized)) return withNotes(parseLineMode(normalized), notes)

  // 5. 没有可执行模式：派给「字段出现过」的解析器，让它给出精确的缺字段原因，
  //    而不是笼统地说参数不对。
  if (ModeDetector.hasBatchMode(normalized)) return withNotes(parseBatchMode(normalized), notes)
  if (ModeDetector.hasLineMode(normalized)) return withNotes(parseLineMode(normalized), notes)
  if (ModeDetector.hasStringMode(normalized)) return withNotes(parseStringMode(normalized), notes)

  return withNotes(
    {
      ok: false,
      normalized,
      error:
        'No edit content: provide one of — (old_string + new_string) | (start_line + end_line + content) | a non-empty edits array',
    },
    notes,
  )
}

/** 对外暴露规范化函数（供外部调用） */
export { normalizeEditFileArgs }

/* ------------------------------------------------------------------ */
/* 行号前缀剥离                                                       */
/* ------------------------------------------------------------------ */

/** read_file 的行号前缀形态：`12: code` 或 `12 | code` */
const LINE_NUMBER_PREFIX = /^\s*\d+(?::\s?|\s*\|\s?)(.*)$/

/**
 * 剥离「行号 + 分隔符」前缀
 *
 * read_file 返回的代码正文是 `行号: 内容` 形式，模型有时会把整段带行号的文本
 * 原样用作 old_string / new_string，于是严格匹配一律失败。这里只在「几乎每一行
 * 都带行号前缀」时才剥离：单个带冒号的正文行（如 YAML 的 `key: value`）不会被误伤。
 *
 * 返回空字符串表示没有可剥离的前缀，调用方应保留原文。
 */
export function stripLineNumberPrefixes(text: string): string {
  if (!text.includes('\n')) return ''

  const lines = text.split('\n')
  let hit = 0
  const stripped = lines.map((line) => {
    const match = line.match(LINE_NUMBER_PREFIX)
    if (!match) return line
    hit++
    return match[1]
  })

  // 空白行不参与分母，避免结尾空行拉低比例导致该剥未剥
  const meaningful = lines.filter((line) => line.trim().length > 0).length
  if (meaningful < 2 || hit / meaningful < 0.9) return ''

  return stripped.join('\n')
}

/* ------------------------------------------------------------------ */
/* 场景感知扩展                                                       */
/* ------------------------------------------------------------------ */

/** 文件编辑场景类型 */
export type FileEditScenario = 'legal' | 'medical' | 'education' | 'general'

/** 场景编辑配置 */
export interface ScenarioEditConfig {
  /** 场景名称 */
  scenario: FileEditScenario
  /** 是否启用审计日志 */
  enableAudit: boolean
  /** 是否支持批量编辑 */
  supportBatchEdit: boolean
  /** 批量编辑最大数量 */
  maxBatchSize: number
  /** 受限路径模式（禁止编辑） */
  restrictedPatterns: RegExp[]
  /** 是否要求备份 */
  requireBackup: boolean
  /** 是否允许删除操作 */
  allowDelete: boolean
}

/** 场景编辑配置预设 */
const SCENARIO_EDIT_CONFIGS: Record<FileEditScenario, ScenarioEditConfig> = {
  /** 法律场景：强制审计，禁止删除，要求备份 */
  legal: {
    scenario: 'legal',
    enableAudit: true,
    supportBatchEdit: false,
    maxBatchSize: 1,
    restrictedPatterns: [/\.env$/i, /\/secrets?\//i, /\/private\//i, /\/contracts\/final\//i],
    requireBackup: true,
    allowDelete: false,
  },

  /** 医疗场景：严格限制，禁止批量编辑 */
  medical: {
    scenario: 'medical',
    enableAudit: true,
    supportBatchEdit: false,
    maxBatchSize: 1,
    restrictedPatterns: [
      /\.env$/i,
      /\/secrets?\//i,
      /\/patient[_-]?records?\//i,
      /\/phi\//i,
      /\/hipaa\//i,
      /\/diagnosis\//i,
    ],
    requireBackup: true,
    allowDelete: false,
  },

  /** 教育场景：宽松限制，支持批量 */
  education: {
    scenario: 'education',
    enableAudit: false,
    supportBatchEdit: true,
    maxBatchSize: 20,
    restrictedPatterns: [/\.env$/i],
    requireBackup: false,
    allowDelete: true,
  },

  /** 通用场景：默认配置 */
  general: {
    scenario: 'general',
    enableAudit: false,
    supportBatchEdit: true,
    maxBatchSize: 10,
    restrictedPatterns: [/\.env$/i, /\/secrets?\//i],
    requireBackup: false,
    allowDelete: true,
  },
}

/** 场景编辑解析结果 */
export interface ScenarioEditResolution {
  /** 是否允许编辑 */
  allowed: boolean
  /** 拒绝原因 */
  reason?: string
  /** 解析结果 */
  resolution: EditFileResolution
  /** 场景配置 */
  config: ScenarioEditConfig
}

/**
 * 获取场景编辑配置
 *
 * @param scenario 场景类型
 * @returns 场景编辑配置
 */
export function getScenarioEditConfig(
  scenario: FileEditScenario,
): ScenarioEditConfig {
  return SCENARIO_EDIT_CONFIGS[scenario]
}

/**
 * 检查路径是否被场景策略限制
 *
 * @param filePath 文件路径
 * @param scenario 场景类型
 * @returns 是否被限制
 */
export function isEditPathRestrictedByScenario(
  filePath: string,
  scenario: FileEditScenario,
): boolean {
  const config = SCENARIO_EDIT_CONFIGS[scenario]
  return config.restrictedPatterns.some((p) => p.test(filePath))
}

/**
 * 场景感知的编辑请求解析
 *
 * 在标准解析基础上，增加场景策略校验：
 * - 受限路径检查
 * - 批量编辑限制
 * - 删除操作限制
 * - 审计日志标记
 *
 * @param data 原始参数
 * @param scenario 场景类型
 * @returns 场景解析结果
 */
export function resolveScenarioEditRequest(
  data: Record<string, unknown>,
  scenario: FileEditScenario = 'general',
): ScenarioEditResolution {
  const config = SCENARIO_EDIT_CONFIGS[scenario]
  const resolution = resolveEditFileRequest(data)

  // 参数解析失败，直接返回
  if (!resolution.ok) {
    return {
      allowed: false,
      reason: resolution.error,
      resolution,
      config,
    }
  }

  // 检查路径限制
  const filePath = resolution.args.path
  if (filePath && isEditPathRestrictedByScenario(filePath, scenario)) {
    return {
      allowed: false,
      reason: `Path restricted by ${scenario} scenario policy: ${filePath}`,
      resolution,
      config,
    }
  }

  // 批量模式：检查场景是否支持
  if (resolution.mode === 'batch') {
    if (!config.supportBatchEdit) {
      return {
        allowed: false,
        reason: `${scenario} scenario does not support batch edit`,
        resolution,
        config,
      }
    }

    if (resolution.args.edits.length > config.maxBatchSize) {
      return {
        allowed: false,
        reason: `Batch size ${resolution.args.edits.length} exceeds limit ${config.maxBatchSize}`,
        resolution,
        config,
      }
    }

    // 检查是否包含删除操作
    if (!config.allowDelete) {
      const hasDelete = resolution.args.edits.some((e) => e.action === 'delete')
      if (hasDelete) {
        return {
          allowed: false,
          reason: `${scenario} scenario does not allow delete operations`,
          resolution,
          config,
        }
      }
    }
  }

  return {
    allowed: true,
    resolution,
    config,
  }
}
