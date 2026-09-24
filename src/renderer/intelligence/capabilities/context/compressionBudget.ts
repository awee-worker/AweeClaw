/**
 * 压缩预算
 *
 * 回答「这次压缩够不够」：由上下文窗口与输出预留推出可用的 prompt 预算，
 * 以及压缩应当达到的目标水位。
 *
 * 与按压缩等级递进的策略互补 —— 等级决定用什么手段压，预算决定压到哪停。
 * 只看等级会出现「压了一轮仍在超限」的情况：下一轮请求立刻再次触发压缩，
 * 表现为每轮都压、每轮都压不够的抖动。
 */

/** token 估算误差的缓冲，避免贴着上限发送 */
const SAFETY_BUFFER_TOKENS = 1024

/** 未显式提供输出预留时的默认值 */
export const DEFAULT_MAX_COMPLETION_TOKENS = 8192

export interface CompressionBudget {
  /** 可用的 prompt 预算 */
  budget: number
  /** 压缩目标水位：压到该值以下即认为到位 */
  target: number
  /** 触发压缩的阈值（等于 budget） */
  triggerAt: number
}

/**
 * 由上下文窗口与输出预留推导压缩预算
 *
 * 输出预留是本次请求必须让出的空间：模型输出与 prompt 共享同一窗口，
 * 不预留会在长回复时被截断。
 */
export function computeCompressionBudget(
  contextWindow: number,
  maxCompletion: number = DEFAULT_MAX_COMPLETION_TOKENS,
  safetyBuffer: number = SAFETY_BUFFER_TOKENS
): CompressionBudget {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 0
  const completion = Number.isFinite(maxCompletion) && maxCompletion > 0 ? maxCompletion : 0

  const budget = Math.max(0, window - completion - safetyBuffer)

  return {
    budget,
    target: Math.floor(budget / 2),
    triggerAt: budget,
  }
}

/**
 * 判断压缩后的水位是否已达目标
 *
 * 未达目标意味着下一轮请求仍可能触发压缩，调用方需要继续压缩或接受抖动。
 */
export function isWithinTarget(
  estimatedTokens: number,
  budget: CompressionBudget
): boolean {
  return estimatedTokens <= budget.target
}
