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

export type EditFileResolution =
  | { ok: true; mode: 'string'; normalized: Record<string, unknown>; args: EditFileStringArgs }
  | { ok: true; mode: 'line'; normalized: Record<string, unknown>; args: EditFileLineArgs }
  | { ok: true; mode: 'batch'; normalized: Record<string, unknown>; args: EditFileBatchArgs }
  | { ok: false; normalized: Record<string, unknown>; error: string }

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
  /** 是否包含字符串模式字段 */
  static hasStringMode(data: Record<string, unknown>): boolean {
    return data.old_string !== undefined || data.new_string !== undefined
  }

  /** 是否包含行模式字段 */
  static hasLineMode(data: Record<string, unknown>): boolean {
    return data.start_line !== undefined || data.end_line !== undefined
  }

  /** 是否包含批量模式字段（非空 edits 数组） */
  static hasBatchMode(data: Record<string, unknown>): boolean {
    return Array.isArray(data.edits) && data.edits.length > 0
  }

  /** 统计激活的模式数量 */
  static countActiveModes(data: Record<string, unknown>): number {
    return [this.hasStringMode(data), this.hasLineMode(data), this.hasBatchMode(data)].filter(
      Boolean,
    ).length
  }

  /** 返回所有激活的模式标签 */
  static getActiveModes(data: Record<string, unknown>): EditFileMode[] {
    const modes: EditFileMode[] = []
    if (this.hasStringMode(data)) modes.push('string')
    if (this.hasLineMode(data)) modes.push('line')
    if (this.hasBatchMode(data)) modes.push('batch')
    return modes
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
/* 冲突检测器                                                         */
/* ------------------------------------------------------------------ */

/** 检测批量模式与其他模式字段的冲突 */
class ConflictChecker {
  /** 返回冲突错误消息，无冲突返回 null */
  static getBatchConflictError(data: Record<string, unknown>): string | null {
    if (!ModeDetector.hasBatchMode(data)) return null
    if (PlaceholderDetector.isBatchPlaceholder(data)) return null

    // 顶层存在有意义 content
    if (typeof data.content === 'string' && data.content.length > 0) {
      return 'Batch mode cannot be combined with top-level content. Put replacement text inside each edit, or remove the edits array.'
    }

    // 顶层存在有意义的行模式字段
    if (ModeDetector.hasLineMode(data) && !PlaceholderDetector.isLinePlaceholder(data)) {
      return 'Batch mode cannot be combined with top-level line mode fields'
    }

    // 顶层存在有意义的字符串模式字段
    if (
      ModeDetector.hasStringMode(data) &&
      !PlaceholderDetector.isEmptyStringPlaceholder(data)
    ) {
      return 'Batch mode cannot be combined with top-level string mode fields'
    }

    return null
  }
}

/* ------------------------------------------------------------------ */
/* 规范化处理器                                                       */
/* ------------------------------------------------------------------ */

/** 对原始数据进行规范化处理，清理占位符与冲突字段 */
function normalizeEditFileArgs(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data }

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

/** 解析编辑文件请求，返回规范化结果或错误 */
export function resolveEditFileRequest(data: Record<string, unknown>): EditFileResolution {
  // 1. 冲突检测
  const conflictError = ConflictChecker.getBatchConflictError(data)
  if (conflictError) {
    return { ok: false, normalized: { ...data }, error: conflictError }
  }

  // 2. 规范化
  const normalized = normalizeEditFileArgs(data)

  // 3. 模式计数校验
  const modeCount = ModeDetector.countActiveModes(normalized)
  if (modeCount > 1) {
    return {
      ok: false,
      normalized,
      error: 'Cannot mix string mode, line mode, and batch mode parameters',
    }
  }

  if (modeCount === 0) {
    return {
      ok: false,
      normalized,
      error:
        'Must provide either (old_string + new_string), (start_line + end_line + content), or (edits array)',
    }
  }

  // 4. 分发到对应解析器
  const activeModes = ModeDetector.getActiveModes(normalized)
  const mode = activeModes[0]

  if (mode === 'string') return parseStringMode(normalized)
  if (mode === 'line') return parseLineMode(normalized)
  return parseBatchMode(normalized)
}

/** 对外暴露规范化函数（供外部调用） */
export { normalizeEditFileArgs }
