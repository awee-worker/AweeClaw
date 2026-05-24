/**
 * 智能上下文压缩器
 *
 * 核心改进：
 * 1. 消息重要性评分 - 保护高重要性消息不被压缩
 * 2. 语义保留策略 - 优先压缩低价值内容
 * 3. 决策点保护 - 文件修改、错误修复等关键操作完整保留
 * 4. 渐进式压缩 - 从最低重要性开始压缩，而非简单截断
 */

import { logger } from '@toolkit/LogEngine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { countTokens, countContentTokens } from '@shared/toolkit/tokenEstimator'
import type {
  ChatMessage,
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
  ToolCall,
  MessageContent,
} from '@intelligence/providerTypes'
import { type CompressionLevel } from './compressionUtils'
import type { PrepareResult } from './ContextCompressor'

// ===== 重要性评分常量 =====

/** 基础重要性权重 */
const IMPORTANCE_WEIGHTS = {
  SYSTEM_MESSAGE: 100,      // 系统消息最高优先级
  USER_MESSAGE: 80,         // 用户消息高优先级
  ASSISTANT_WITH_TOOL: 70,  // 包含工具调用的助手消息
  ASSISTANT_PLAIN: 50,      // 普通助手消息
  TOOL_RESULT: 40,          // 工具结果
  TOOL_RESULT_ERROR: 85,    // 错误结果高优先级
  TOOL_RESULT_WRITE: 75,    // 写操作结果
} as const

/** 内容模式加分 */
const CONTENT_BONUS = {
  HAS_FILE_PATH: 15,        // 包含文件路径
  HAS_ERROR: 20,            // 包含错误信息
  HAS_USER_CORRECTION: 25,  // 用户纠正
  IS_DECISION_POINT: 30,    // 决策点
  HAS_CODE_BLOCK: 10,       // 包含代码块
} as const

/** 时间衰减因子 */
const RECENCY_BOOST = {
  LAST_2_TURNS: 20,
  LAST_5_TURNS: 10,
  LAST_10_TURNS: 5,
} as const

/** 受保护的工具（结果不清理） */
const PROTECTED_TOOLS = new Set(['ask_user', 'read_file', 'search_files'])

/** 写操作工具 */
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'create_file_or_folder', 'apply_diff'])

/** 错误指示词 */
const ERROR_INDICATORS = ['error', 'failed', 'exception', 'cannot', 'unable', 'not found', 'permission denied']

// ===== 消息重要性评分 =====

interface ScoredMessage {
  message: ChatMessage
  index: number
  importance: number
  category: 'system' | 'user' | 'assistant_tool' | 'assistant_plain' | 'tool_result' | 'tool_error'
  metadata: {
    hasFilePath: boolean
    hasError: boolean
    isWriteOp: boolean
    isProtected: boolean
    tokenCount: number
  }
}

/**
 * 计算消息重要性评分
 */
function scoreMessage(msg: ChatMessage, index: number, totalMessages: number): ScoredMessage {
  let importance = 0
  let category: ScoredMessage['category'] = 'assistant_plain'
  const metadata = {
    hasFilePath: false,
    hasError: false,
    isWriteOp: false,
    isProtected: false,
    tokenCount: 0,
  }

  // 计算 token 数
  metadata.tokenCount = estimateMessageTokens(msg)

  // 基于角色评分
  switch (msg.role) {
    case 'user': {
      importance = IMPORTANCE_WEIGHTS.USER_MESSAGE
      category = 'user'
      const userMsg = msg as UserMessage
      const content = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content)

      // 检查用户纠正
      if (/\b(no|wrong|incorrect|not right|fix|change|should be)\b/i.test(content)) {
        importance += CONTENT_BONUS.HAS_USER_CORRECTION
      }

      // 检查文件路径
      if (/\b[\w-]+\.[a-zA-Z]+\b/.test(content)) {
        metadata.hasFilePath = true
        importance += CONTENT_BONUS.HAS_FILE_PATH
      }
      break
    }

    case 'assistant': {
      const assistantMsg = msg as AssistantMessage
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        importance = IMPORTANCE_WEIGHTS.ASSISTANT_WITH_TOOL
        category = 'assistant_tool'

        // 检查是否包含写操作
        for (const tc of assistantMsg.toolCalls) {
          if (WRITE_TOOLS.has(tc.name)) {
            metadata.isWriteOp = true
            importance += CONTENT_BONUS.IS_DECISION_POINT
          }
        }
      } else {
        importance = IMPORTANCE_WEIGHTS.ASSISTANT_PLAIN
        category = 'assistant_plain'
      }

      // 检查代码块
      const content = assistantMsg.content || ''
      if (/```[\s\S]*?```/.test(content)) {
        importance += CONTENT_BONUS.HAS_CODE_BLOCK
      }
      break
    }

    case 'tool': {
      const toolMsg = msg as ToolResultMessage
      const content = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)

      // 检查错误
      const lowerContent = content.toLowerCase()
      const hasError = ERROR_INDICATORS.some(indicator => lowerContent.includes(indicator))
      if (hasError) {
        importance = IMPORTANCE_WEIGHTS.TOOL_RESULT_ERROR
        category = 'tool_error'
        metadata.hasError = true
        importance += CONTENT_BONUS.HAS_ERROR
      } else {
        importance = IMPORTANCE_WEIGHTS.TOOL_RESULT
        category = 'tool_result'
      }

      // 检查写操作
      if (toolMsg.name && WRITE_TOOLS.has(toolMsg.name)) {
        metadata.isWriteOp = true
        importance += CONTENT_BONUS.IS_DECISION_POINT
      }

      // 检查受保护工具
      if (toolMsg.name && PROTECTED_TOOLS.has(toolMsg.name)) {
        metadata.isProtected = true
        importance += 15
      }

      // 检查文件路径
      if (/\b[\w-]+\.[a-zA-Z]+\b/.test(content)) {
        metadata.hasFilePath = true
        importance += CONTENT_BONUS.HAS_FILE_PATH
      }
      break
    }
  }

  // 时间衰减（越新的消息越重要）
  const distanceFromEnd = totalMessages - index - 1
  if (distanceFromEnd < 4) {
    importance += RECENCY_BOOST.LAST_2_TURNS
  } else if (distanceFromEnd < 10) {
    importance += RECENCY_BOOST.LAST_5_TURNS
  } else if (distanceFromEnd < 20) {
    importance += RECENCY_BOOST.LAST_10_TURNS
  }

  return { message: msg, index, importance, category, metadata }
}

/**
 * 估算单条消息的 token 数
 */
function estimateMessageTokens(msg: ChatMessage): number {
  let total = 4 // 消息固定开销

  switch (msg.role) {
    case 'user': {
      const userMsg = msg as UserMessage
      total += countContentTokens(userMsg.content)
      break
    }
    case 'assistant': {
      const assistantMsg = msg as AssistantMessage
      total += countTokens(assistantMsg.content || '')
      for (const tc of assistantMsg.toolCalls || []) {
        total += countTokens(tc.name)
        total += countTokens(JSON.stringify(tc.arguments || {}))
        total += 3
      }
      break
    }
    case 'tool': {
      const toolMsg = msg as ToolResultMessage
      const content = typeof toolMsg.content === 'string' ? toolMsg.content : ''
      if (!toolMsg.compactedAt) {
        total += countTokens(content)
      }
      break
    }
  }

  return total
}

// ===== 智能压缩策略 =====

/**
 * 智能压缩消息
 *
 * 策略：
 * 1. 为所有消息计算重要性评分
 * 2. 按重要性排序
 * 3. 从低重要性消息开始压缩
 * 4. 高重要性消息完整保留
 */
export function smartCompressMessages(
  messages: ChatMessage[],
  lastLevel: CompressionLevel,
  contextLimit: number
): PrepareResult {
  const config = getAgentConfig()
  let result = [...messages]
  let truncatedToolCalls = 0
  let clearedToolResults = 0
  let removedMessages = 0

  // 过滤 checkpoint 消息
  result = result.filter(m => m.role !== 'checkpoint')

  // 计算当前 token 数
  const currentTokens = result.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
  const targetTokens = contextLimit * (lastLevel >= 3 ? 0.75 : 0.85)

  // 如果未超过目标，只进行轻量压缩
  if (currentTokens <= targetTokens && lastLevel < 2) {
    return {
      messages: result,
      appliedLevel: lastLevel,
      truncatedToolCalls: 0,
      clearedToolResults: 0,
      removedMessages: 0,
    }
  }

  // 为所有消息评分
  const scoredMessages = result.map((msg, idx) => scoreMessage(msg, idx, result.length))

  // 按重要性排序（升序，先处理低重要性）
  const sortedByImportance = [...scoredMessages].sort((a, b) => a.importance - b.importance)

  // 计算需要节省的 token 数
  let tokensToSave = currentTokens - targetTokens

  logger.agent.info(
    `[SmartCompress] Current: ${currentTokens}, Target: ${Math.round(targetTokens)}, ` +
    `Need to save: ${tokensToSave}, Level: ${lastLevel}`
  )

  // 阶段 1: 清理低重要性工具结果（L1+）
  if (lastLevel >= 1 && tokensToSave > 0) {
    for (const scored of sortedByImportance) {
      if (scored.category !== 'tool_result' || scored.metadata.isProtected) continue
      if (scored.metadata.hasError) continue // 保护错误结果

      const msg = scored.message as ToolResultMessage
      if (msg.compactedAt) continue

      const content = typeof msg.content === 'string' ? msg.content : ''
      if (content.length <= 100) continue // 已很短，不清理

      const saved = estimateMessageTokens(msg) - 5 // '[Cleared]' 约 5 tokens
      if (saved > 0) {
        result[scored.index] = { ...msg, content: '[Cleared]', compactedAt: Date.now() }
        clearedToolResults++
        tokensToSave -= saved

        if (tokensToSave <= 0) break
      }
    }
  }

  // 阶段 2: 截断工具参数（L1+）
  if (lastLevel >= 1 && tokensToSave > 0) {
    const threshold = lastLevel >= 3 ? 500 : lastLevel >= 2 ? 2000 : 10000

    for (const scored of sortedByImportance) {
      if (scored.category !== 'assistant_tool') continue

      const msg = scored.message as AssistantMessage
      let hasChanges = false
      let newToolCalls = msg.toolCalls

      if (msg.toolCalls?.length) {
        newToolCalls = msg.toolCalls.map(tc => {
          if (!WRITE_TOOLS.has(tc.name)) return tc

          const args = { ...tc.arguments }
          let truncated = false

          for (const key of ['content', 'new_string', 'old_string']) {
            if (typeof args[key] === 'string' && (args[key] as string).length > threshold) {
              const originalTokens = countTokens(args[key] as string)
              args[key] = `[Truncated: ${(args[key] as string).length} chars]`
              truncated = true
              tokensToSave -= Math.max(0, originalTokens - countTokens(args[key] as string))
            }
          }

          if (truncated) truncatedToolCalls++
          return truncated ? { ...tc, arguments: args } : tc
        })
      }

      if (truncatedToolCalls > 0 && newToolCalls !== msg.toolCalls) {
        result[scored.index] = { ...msg, toolCalls: newToolCalls }
      }

      if (tokensToSave <= 0) break
    }
  }

  // 阶段 3: 深度压缩 - 移除最低重要性消息（L3+）
  if (lastLevel >= 3 && tokensToSave > 0) {
    // 重新评分（因为前面的修改可能改变了状态）
    const updatedScored = result.map((msg, idx) => scoreMessage(msg, idx, result.length))
    const sorted = [...updatedScored].sort((a, b) => a.importance - b.importance)

    // 保护最近的消息
    const protectedCount = Math.min(6, result.length) // 保护最近 3 轮对话

    for (const scored of sorted) {
      const distanceFromEnd = result.length - scored.index - 1
      if (distanceFromEnd < protectedCount) continue // 保护最近的消息

      if (scored.importance >= 70) continue // 保护高重要性消息
      if (scored.category === 'system') continue // 不删除系统消息
      if (scored.category === 'user' && scored.metadata.hasError) continue // 保护用户错误报告

      const saved = estimateMessageTokens(scored.message)
      result[scored.index] = null as unknown as ChatMessage // 标记为删除
      removedMessages++
      tokensToSave -= saved

      if (tokensToSave <= 0) break
    }

    // 过滤掉标记为删除的消息
    result = result.filter(m => m !== null)
  }

  // 阶段 4: 替换历史图片为占位符
  const lastIndex = result.length - 1
  let hasModifications = false
  const modifiedMessages: ChatMessage[] = []

  for (let idx = 0; idx < result.length; idx++) {
    const msg = result[idx]
    if (idx === lastIndex || msg.role !== 'user') {
      modifiedMessages.push(msg)
      continue
    }

    const userMsg = msg as UserMessage
    if (typeof userMsg.content !== 'string') {
      const hasImage = userMsg.content.some(part => part.type === 'image')
      if (hasImage) {
        const newContent = userMsg.content.map(part =>
          part.type === 'image' ? { type: 'text' as const, text: '[Image: Previously analyzed]' } : part
        )
        modifiedMessages.push({ ...userMsg, content: newContent as MessageContent })
        hasModifications = true
        continue
      }
    }
    modifiedMessages.push(msg)
  }

  if (hasModifications) {
    result = modifiedMessages
  }

  logger.agent.info(
    `[SmartCompress] Done: removed=${removedMessages}, truncated=${truncatedToolCalls}, ` +
    `cleared=${clearedToolResults}, remaining=${result.length} msgs`
  )

  return {
    messages: result,
    appliedLevel: lastLevel,
    truncatedToolCalls,
    clearedToolResults,
    removedMessages,
  }
}

/**
 * 计算消息列表的压缩建议
 */
export function getCompressionAdvice(
  messages: ChatMessage[],
  contextLimit: number
): {
  currentTokens: number
  ratio: number
  suggestedLevel: CompressionLevel
  highImportanceCount: number
  lowImportanceCount: number
} {
  const currentTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
  const ratio = currentTokens / contextLimit

  const scored = messages.map((msg, idx) => scoreMessage(msg, idx, messages.length))
  const highImportanceCount = scored.filter(s => s.importance >= 70).length
  const lowImportanceCount = scored.filter(s => s.importance < 50).length

  let suggestedLevel: CompressionLevel = 0
  if (ratio >= 0.95) suggestedLevel = 4
  else if (ratio >= 0.85) suggestedLevel = 3
  else if (ratio >= 0.7) suggestedLevel = 2
  else if (ratio >= 0.5) suggestedLevel = 1

  return {
    currentTokens,
    ratio,
    suggestedLevel,
    highImportanceCount,
    lowImportanceCount,
  }
}
