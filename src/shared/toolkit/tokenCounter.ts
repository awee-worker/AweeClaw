/**
 * Token 计数工具统一入口
 *
 * 本文件为向后兼容入口，重新导出 tokenEstimator 中的 Token 计数功能。
 * 新代码请直接从 '@shared/toolkit/tokenEstimator' 导入。
 */
export {
  measureTextTokens,
  measureTextTokens as countTokens,
  measureContentTokens,
  measureContentTokens as countContentTokens,
  measureConversationTokens,
  measureConversationTokens as countMessagesTokens,
  calculateTokenBudget,
  estimateTokensHeuristic,
  estimateTokensHeuristic as estimateTokens,
  releaseEncoder,
  type TokenBudget,
  type ContentPart,
  type ChatMessage,
} from './tokenEstimator'

/* ------------------------------------------------------------------ */
/* 旧版截断函数（保留以兼容旧代码）                                    */
/* ------------------------------------------------------------------ */

/**
 * 截断文本到指定 Token 限制
 *
 * @deprecated 请使用 tokenEstimator 中的 calculateTokenBudget
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 4
  if (text.length <= estimatedChars) return text
  return text.slice(0, estimatedChars) + '...'
}
