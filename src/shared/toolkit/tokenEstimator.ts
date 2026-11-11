/**
 * Token 计数与预算估算工具集
 *
 * 架构分层：
 * 1. 常量配置 — Token 计算相关的常量参数
 * 2. 编码器管理 — Tiktoken 编码器的懒加载与释放
 * 3. 启发式估算器 — 编码器不可用时的降级估算
 * 4. 文本测量器 — 基础文本 Token 计数
 * 5. 内容测量器 — 多模态内容 Token 计数
 * 6. 对话测量器 — 完整对话 Token 计数
 * 7. 预算计算器 — Token 预算与利用率计算
 *
 * 提供精确的 Token 计数和启发式估算两种模式
 */

import { Tiktoken, getEncoding } from 'js-tiktoken'

/* ================================================================== */
/* 类型定义                                                            */
/* ================================================================== */

export interface TokenBudget {
  used: number
  total: number
  remaining: number
  utilizationRatio: number
}

export interface ContentPart {
  type: string
  text?: string
  source?: unknown
}

export interface ChatMessage {
  role: string
  content?: string | ContentPart[]
  name?: string
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>
  tool_call_id?: string
}

/* ================================================================== */
/* 第一层：常量配置                                                    */
/* ================================================================== */

/** Token 计算常量 */
const TOKEN_CONSTANTS = {
  /** 图片内容的固定 Token 成本 */
  IMAGE_COST: 1600,
  /** 单条消息的额外开销 */
  MESSAGE_OVERHEAD: 4,
  /** 对话首尾的额外开销 */
  CONVERSATION_BOOKEND: 3,
  /** 工具调用的额外开销 */
  TOOL_CALL_OVERHEAD: 3,
  /** 拉丁字符每 Token 的字符数（启发式估算） */
  CHARS_PER_TOKEN_LATIN: 4,
  /** CJK 字符每 Token 的字符数（启发式估算） */
  CHARS_PER_TOKEN_CJK: 1.5,
} as const

/** CJK 字符范围（中日韩统一表意文字 + 平假名 + 片假名） */
const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g

/* ================================================================== */
/* 第二层：编码器管理                                                   */
/* ================================================================== */

/** Tiktoken 编码器懒加载管理器 */
class EncoderManager {
  private instance: Tiktoken | null = null

  /** 获取编码器实例（懒加载） */
  acquire(): Tiktoken {
    if (!this.instance) {
      this.instance = getEncoding('cl100k_base')
    }
    return this.instance
  }

  /** 释放编码器实例 */
  release(): void {
    this.instance = null
  }
}

const encoderManager = new EncoderManager()

/* ================================================================== */
/* 计数结果缓存                                                        */
/* ================================================================== */

/**
 * 文本 → Token 数的记忆化缓存
 *
 * 为什么需要：cl100k_base 对中文的编码成本极高（实测约 7 千字符/秒，
 * 五万余字中文需近 400ms），而发送一条消息的组装流程会对同一批文本
 * 反复计数 —— 压缩级别的每一轮迭代都会把整段历史与系统提示词重新编码
 * 一遍。历史消息在一次发送内不会变化，缓存命中后这些重复编码直接归零。
 *
 * 条目上限与单条长度上限是为了不把长文本长期留在内存里：超过长度上限的
 * 文本只计一次、不缓存，长文本本就很少在单次组装中被重复统计。
 */
const CACHE_MAX_ENTRIES = 2000
const CACHE_MAX_TEXT_LENGTH = 200_000
const tokenCache = new Map<string, number>()

function readCache(text: string): number | undefined {
  return tokenCache.get(text)
}

function writeCache(text: string, tokens: number): void {
  if (text.length > CACHE_MAX_TEXT_LENGTH) return
  if (tokenCache.size >= CACHE_MAX_ENTRIES) {
    // 整体清空而非逐条淘汰：这里的 key 是完整文本，逐条维护 LRU 的成本
    // 高于重建一次缓存；清空后首轮重新计数，代价与冷启动相同。
    tokenCache.clear()
  }
  tokenCache.set(text, tokens)
}

/* ================================================================== */
/* 第三层：启发式估算器                                                 */
/* ================================================================== */

/**
 * 基于字符数的启发式 Token 估算
 *
 * 区分 CJK 字符和拉丁字符，使用不同的字符/Token 比率
 */
function heuristicEstimate(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(CJK_REGEX) || []).length
  const latinCount = text.length - cjkCount
  return Math.ceil(
    cjkCount / TOKEN_CONSTANTS.CHARS_PER_TOKEN_CJK +
    latinCount / TOKEN_CONSTANTS.CHARS_PER_TOKEN_LATIN
  )
}

/* ================================================================== */
/* 第四层：文本测量器                                                   */
/* ================================================================== */

/**
 * 精确测量文本的 Token 数
 *
 * 优先使用 Tiktoken 编码器，失败时降级为启发式估算
 */
export function measureTextTokens(text: string): number {
  if (!text) return 0
  const hit = readCache(text)
  if (hit !== undefined) return hit
  let tokens: number
  try {
    tokens = encoderManager.acquire().encode(text).length
  } catch {
    tokens = heuristicEstimate(text)
  }
  writeCache(text, tokens)
  return tokens
}

/* ================================================================== */
/* 第五层：内容测量器                                                  */
/* ================================================================== */

/** 内容部分处理策略 */
interface ContentPartStrategy {
  measure: (part: ContentPart) => number
}

/** 文本内容处理策略 */
const textPartStrategy: ContentPartStrategy = {
  measure: (part) => (part.text ? measureTextTokens(part.text) : 0),
}

/** 图片内容处理策略 */
const imagePartStrategy: ContentPartStrategy = {
  measure: () => TOKEN_CONSTANTS.IMAGE_COST,
}

/** 工具调用/结果处理策略 */
const toolPartStrategy: ContentPartStrategy = {
  measure: (part) => measureTextTokens(JSON.stringify(part)),
}

/** 内容部分策略注册表 */
const CONTENT_PART_STRATEGIES: Record<string, ContentPartStrategy> = {
  text: textPartStrategy,
  image: imagePartStrategy,
  tool_use: toolPartStrategy,
  tool_result: toolPartStrategy,
}

/**
 * 测量多模态内容的 Token 数
 *
 * 支持文本、图片、工具调用等多种内容类型
 */
export function measureContentTokens(content: string | ContentPart[]): number {
  if (typeof content === 'string') return measureTextTokens(content)

  let total = 0
  for (const part of content) {
    const strategy = CONTENT_PART_STRATEGIES[part.type] || toolPartStrategy
    total += strategy.measure(part)
  }
  return total
}

/* ================================================================== */
/* 第六层：对话测量器                                                  */
/* ================================================================== */

/**
 * 测量完整对话的 Token 数
 *
 * 包含消息开销、角色、内容、工具调用等所有部分
 */
export function measureConversationTokens(messages: ChatMessage[]): number {
  let total = TOKEN_CONSTANTS.CONVERSATION_BOOKEND

  for (const msg of messages) {
    total += TOKEN_CONSTANTS.MESSAGE_OVERHEAD
    total += measureTextTokens(msg.role)

    if (msg.content) {
      total += measureContentTokens(msg.content)
    }

    if (msg.name) {
      total += measureTextTokens(msg.name)
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += measureTextTokens(tc.name)
        total += measureTextTokens(JSON.stringify(tc.arguments))
        total += TOKEN_CONSTANTS.TOOL_CALL_OVERHEAD
      }
    }

    if (msg.tool_call_id) {
      total += measureTextTokens(msg.tool_call_id)
    }
  }

  return total
}

/* ================================================================== */
/* 第七层：预算计算器                                                   */
/* ================================================================== */

/**
 * 计算 Token 预算使用情况
 *
 * 返回已用、总量、剩余和利用率
 */
export function calculateTokenBudget(messages: ChatMessage[], contextLimit: number): TokenBudget {
  const used = measureConversationTokens(messages)
  return {
    used,
    total: contextLimit,
    remaining: Math.max(0, contextLimit - used),
    utilizationRatio: contextLimit > 0 ? used / contextLimit : 0,
  }
}

/**
 * 使用启发式方法估算文本 Token 数（不依赖编码器）
 */
export function estimateTokensHeuristic(text: string): number {
  return heuristicEstimate(text)
}

/* ================================================================== */
/* 编码器生命周期管理                                                   */
/* ================================================================== */

/** 释放编码器实例（供应用退出时调用） */
export function releaseEncoder(): void {
  encoderManager.release()
  tokenCache.clear()
}

/* ================================================================== */
/* 向后兼容别名（供逐步迁移使用）                                      */
/* ================================================================== */

export const countTokens = measureTextTokens
export const countContentTokens = measureContentTokens
export const countMessagesTokens = measureConversationTokens
export const computeTokenBudget = calculateTokenBudget
export const estimateTokensForText = estimateTokensHeuristic
export const freeEncoder = releaseEncoder
