/**
 * Token 计数工具 — Token 估算与截断
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 4
  if (text.length <= estimatedChars) return text
  return text.slice(0, estimatedChars) + "..."
}
