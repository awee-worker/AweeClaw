/**
 * 流式 JSON 容错解析与工具结果裁剪
 *
 * 解析器基于扫描状态机补全缺失的结构闭合符号，
 * 裁剪器根据内容特征动态分配头部与尾部的保留比例。
 */

import { getToolTruncateConfig } from '@configuration/agentProfile'

/* ------------------------------------------------------------------ */
/* 流式 JSON 解析                                                    */
/* ------------------------------------------------------------------ */

/** 解析可能不完整的 JSON 字符串，返回对象或 null */
export function parsePartialJson(jsonString: string): Record<string, unknown> | null {
  if (!jsonString || jsonString.trim().length === 0) return null

  // 第一优先级：直接解析
  try {
    return JSON.parse(jsonString)
  } catch {
    // 继续尝试修复
  }

  // 第二优先级：状态机修复后解析
  try {
    return JSON.parse(repairJson(jsonString))
  } catch {
    // 继续尝试字段提取
  }

  // 第三优先级：正则提取已知字段
  return extractKnownFields(jsonString)
}

/** JSON 扫描状态 */
type ScanState = 'value' | 'string'

/** 修复不完整的 JSON：补全字符串与未闭合的容器 */
function repairJson(input: string): string {
  const text = trimToFirstContainer(input)
  if (!text) return '{}'

  const stack: Array<'{' | '['> = []
  let state: ScanState = 'value'
  let pendingEscape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (state === 'string') {
      if (pendingEscape) {
        pendingEscape = false
        continue
      }
      if (ch === '\\') {
        pendingEscape = true
        continue
      }
      if (ch === '"') {
        state = 'value'
      }
      continue
    }

    // state === 'value'
    if (ch === '"') {
      state = 'string'
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      const top = stack[stack.length - 1]
      if ((ch === '}' && top === '{') || (ch === ']' && top === '[')) {
        stack.pop()
      }
    }
  }

  let result = text

  // 字符串未闭合：补全引号
  if (state === 'string') {
    if (pendingEscape) result += '\\'
    result += '"'
  }

  // 补全未闭合的容器
  while (stack.length > 0) {
    const top = stack.pop()
    result += top === '{' ? '}' : ']'
  }

  return result
}

/** 截取首个对象或数组起始位置之后的内容 */
function trimToFirstContainer(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed

  const objIdx = trimmed.indexOf('{')
  const arrIdx = trimmed.indexOf('[')

  if (objIdx === -1 && arrIdx === -1) return ''
  if (objIdx === -1) return trimmed.slice(arrIdx)
  if (arrIdx === -1) return trimmed.slice(objIdx)
  return trimmed.slice(Math.min(objIdx, arrIdx))
}

/** 从严重损坏的 JSON 中正则提取常用字段 */
function extractKnownFields(jsonString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const fields = [
    'path', 'content', 'command', 'query', 'pattern',
    'old_string', 'new_string', 'start_line', 'end_line',
    'line', 'column', 'paths', 'url', 'question',
  ]

  for (const key of fields) {
    const value = extractField(jsonString, key)
    if (value !== undefined) result[key] = value
  }

  return result
}

/** 提取单个字段的值 */
function extractField(text: string, key: string): unknown {
  const regex = new RegExp(`"${key}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^,}]+))`)
  const match = text.match(regex)
  if (!match) return undefined

  // 字符串值
  if (match[1] !== undefined) {
    try {
      return JSON.parse(`"${match[1]}"`)
    } catch {
      return match[1]
    }
  }

  // 非字符串值
  if (match[2] !== undefined) {
    try {
      return JSON.parse(match[2])
    } catch {
      return match[2]
    }
  }

  return undefined
}

/* ------------------------------------------------------------------ */
/* 工具结果裁剪                                                      */
/* ------------------------------------------------------------------ */

/** 智能截断工具结果，根据内容特征动态调整保留比例 */
export function truncateToolResult(
  result: string,
  toolName: string,
  maxLength?: number,
): string {
  if (!result) return ''

  const config = getToolTruncateConfig(toolName)
  const limit = maxLength || config.maxLength
  if (result.length <= limit) return result

  const { headRatio, tailRatio } = pickStrategy(result, toolName, config)

  const headSize = Math.floor(limit * headRatio)
  const tailSize = Math.floor(limit * tailRatio)
  const omitted = result.length - headSize - tailSize

  const head = cutAtLineEnd(result.slice(0, headSize + 200), headSize)
  const tail = cutAtLineStart(result.slice(-tailSize - 200), tailSize)

  return `${head}\n\n... [truncated: ${omitted.toLocaleString()} chars omitted] ...\n\n${tail}`
}

/** 裁剪策略选择 */
interface TruncateStrategy {
  headRatio: number
  tailRatio: number
}

/** 根据内容与工具特征选择裁剪策略 */
function pickStrategy(
  content: string,
  toolName: string,
  fallback: TruncateStrategy,
): TruncateStrategy {
  // 错误信息通常在末尾
  if (/error|exception|failed|fatal|panic|traceback|stack trace/i.test(content)) {
    return { headRatio: 0.25, tailRatio: 0.7 }
  }

  // 短成功消息保留更多头部
  if (/success|completed|done|✓|✔/i.test(content) && content.length < 5000) {
    return { headRatio: 0.8, tailRatio: 0.15 }
  }

  // 按工具类型调整
  const toolStrategies: Record<string, TruncateStrategy> = {
    run_command: { headRatio: 0.2, tailRatio: 0.75 },
    execute_command: { headRatio: 0.2, tailRatio: 0.75 },
    search_files: { headRatio: 0.9, tailRatio: 0.05 },
    grep_search: { headRatio: 0.9, tailRatio: 0.05 },
    codebase_search: { headRatio: 0.9, tailRatio: 0.05 },
    read_file: { headRatio: 0.7, tailRatio: 0.25 },
    get_lint_errors: { headRatio: 0.6, tailRatio: 0.35 },
    list_directory: { headRatio: 0.6, tailRatio: 0.35 },
  }

  return toolStrategies[toolName] ?? fallback
}

/** 在行尾边界截断（向前查找换行符） */
function cutAtLineEnd(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const searchStart = Math.max(0, maxLen - 100)
  const lastNewline = text.lastIndexOf('\n', maxLen)
  if (lastNewline > searchStart) return text.slice(0, lastNewline)
  return text.slice(0, maxLen)
}

/** 在行首边界截断（向后查找换行符） */
function cutAtLineStart(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const startPos = text.length - maxLen
  const searchEnd = Math.min(text.length, startPos + 100)
  const firstNewline = text.indexOf('\n', startPos)
  if (firstNewline !== -1 && firstNewline < searchEnd) return text.slice(firstNewline + 1)
  return text.slice(-maxLen)
}
