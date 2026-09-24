/**
 * 结构化摘要的决策点与错误修复提取
 *
 * 压缩会把较早的历史折叠成结构化摘要。摘要里若只剩「做了什么」，
 * 用户纠正过的方向与试错过程就会在折叠后消失 —— 模型会重新提出已被否掉的方案，
 * 或重犯已经修过的错误。
 *
 * 提取结果刻意保持精简：摘要服务的是「接下来要做什么」，条目过多会反过来淹没重点。
 */

import {
  getMessageText,
  type ChatMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type UserMessage,
  type ToolCall,
} from '@intelligence/providerTypes'
import type { DecisionPoint } from './contextTypes'

/** 用户纠正的识别模式（覆盖常见的否决与改向表达） */
const USER_CORRECTION_PATTERNS = [
  /\b(no|not right|incorrect|wrong|should be|don'?t|stop|instead|revert|undo)\b/i,
  /不对|错了|不是这样|应该是|不要|别这样|改成|换成|回退|撤销|搞错/,
]

/** 工具结果中的错误指示词 */
const ERROR_INDICATORS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /not found/i,
  /permission denied/i,
  /报错|失败|异常|不存在|拒绝访问/,
]

/** 会产生文件变更的工具及其决策类型 */
const FILE_WRITE_TOOLS: Record<string, DecisionPoint['type']> = {
  write_file: 'file_create',
  create_file_or_folder: 'file_create',
  edit_file: 'file_modify',
  apply_diff: 'file_modify',
  delete_file_or_folder: 'file_delete',
}

/** 单个列表的最大条目数 */
const MAX_DECISIONS = 8
const MAX_ERRORS = 5

/** 单条描述的字符上限，避免长文本挤占摘要预算 */
const MAX_DESCRIPTION_CHARS = 160

function isUserCorrection(text: string): boolean {
  return USER_CORRECTION_PATTERNS.some(pattern => pattern.test(text))
}

function contentHasError(content: string): boolean {
  return ERROR_INDICATORS.some(pattern => pattern.test(content))
}

/** 从工具参数中取文件路径，兼容不同工具的命名习惯 */
export function collectFilesFromToolCall(tc: ToolCall): string[] {
  const args = (tc.arguments ?? {}) as Record<string, unknown>
  const files: string[] = []

  for (const key of ['path', 'file_path', 'target_file', 'source']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) {
      files.push(value.trim())
    }
  }

  return Array.from(new Set(files))
}

function describeToolCall(tc: ToolCall): string {
  const files = collectFilesFromToolCall(tc)
  if (files.length) {
    return `${tc.name} ${files[0]}`
  }

  // 命令类工具的目标不在路径参数里，取命令本身才能说明当时做了什么
  const command = ((tc.arguments ?? {}) as Record<string, unknown>).command
  if (typeof command === 'string' && command.trim()) {
    return `${tc.name} \`${command.trim().slice(0, 80)}\``
  }

  return tc.name
}

/**
 * 提取决策点
 *
 * 覆盖两类折叠后最容易丢失的信息：
 * - 用户纠正：模型据此知道哪些方向已被否掉
 * - 文件变更：模型据此知道改过哪些文件，不必重复确认
 *
 * 只保留最近的若干条 —— 越靠近当前，越可能影响下一步动作。
 */
export function extractDecisionPoints(
  messages: ChatMessage[],
  maxItems = MAX_DECISIONS
): DecisionPoint[] {
  const points: DecisionPoint[] = []
  let userTurn = 0

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'user') {
      userTurn += 1
      const text = getMessageText((msg as UserMessage).content).trim()
      if (text && isUserCorrection(text)) {
        points.push({
          turnIndex: userTurn,
          type: 'user_correction',
          description: text.slice(0, MAX_DESCRIPTION_CHARS),
          files: [],
          messageIndex: i,
        })
      }
      continue
    }

    if (msg.role !== 'assistant') continue

    const toolCalls = (msg as AssistantMessage).toolCalls
    if (!toolCalls?.length) continue

    for (const tc of toolCalls) {
      const changeType = FILE_WRITE_TOOLS[tc.name]
      if (!changeType) continue

      points.push({
        turnIndex: userTurn,
        type: changeType,
        description: describeToolCall(tc),
        files: collectFilesFromToolCall(tc),
        messageIndex: i,
      })
    }
  }

  return points.slice(-maxItems)
}

/**
 * 提取错误与修复
 *
 * 配对规则：工具结果报错后，模型对同一工具的下一次调用视为修复动作。
 * 这个规则偏保守 —— 宁可漏配，也不要把无关调用认成修复。
 */
export function extractErrorsAndFixes(
  messages: ChatMessage[],
  maxItems = MAX_ERRORS
): { error: string; fix: string }[] {
  const results: { error: string; fix: string }[] = []
  /** 工具名 → 尚未修复的错误摘要 */
  const pending = new Map<string, string>()

  for (const msg of messages) {
    if (msg.role === 'tool') {
      const tm = msg as ToolResultMessage
      const content = typeof tm.content === 'string' ? tm.content : ''
      if (contentHasError(content)) {
        pending.set(tm.name || 'unknown', content.slice(0, MAX_DESCRIPTION_CHARS))
      }
      continue
    }

    if (msg.role !== 'assistant') continue

    const toolCalls = (msg as AssistantMessage).toolCalls
    if (!toolCalls?.length) continue

    for (const tc of toolCalls) {
      const error = pending.get(tc.name)
      if (!error) continue

      results.push({ error, fix: describeToolCall(tc) })
      pending.delete(tc.name)
    }
  }

  return results.slice(-maxItems)
}
