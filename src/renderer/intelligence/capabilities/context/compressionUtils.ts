export type CompressionLevel = 0 | 1 | 2 | 3 | 4

export const LEVEL_NAMES = [
  'Full Context',
  'Truncate Args',
  'Clear Results',
  'Deep Compress',
  'Session Handoff',
] as const

/**
 * 根据上下文使用率计算压缩等级
 *
 * 阈值设计原则：
 * - 0~65%：完整上下文，不做任何压缩
 * - 65~82%：轻量压缩，截断过长的工具参数
 * - 82~92%：中度压缩，清理旧工具结果
 * - 92~98%：深度压缩，LLM 摘要
 * - 98%+：会话交接，新建线程续接
 *
 * 调整历史：
 * - v1: 0.5/0.7/0.85/0.95（过于激进，短对话也触发压缩）
 * - v2: 0.6/0.78/0.9/0.96（仍有用户反馈短对话被强制交接）
 * - v3: 0.65/0.82/0.92/0.98（配合对话轮次保护，让 AI 有充足上下文空间）
 *
 * 注意：此函数仅基于 token 比例计算，实际触发还会被 contextOptimizer.ts 中的
 * "最小对话轮次保护"进一步约束（短对话不触发 level 3/4）。
 */
export function calculateLevel(ratio: number): CompressionLevel {
  if (ratio < 0.65) return 0
  if (ratio < 0.82) return 1
  if (ratio < 0.92) return 2
  if (ratio < 0.98) return 3
  return 4
}
