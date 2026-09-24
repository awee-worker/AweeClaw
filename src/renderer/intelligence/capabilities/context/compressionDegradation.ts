/**
 * 压缩链路降级状态
 *
 * 记录摘要的连续失败次数，供压缩编排判断「是否还值得再调一次摘要」。
 *
 * 独立成模块的原因：这份状态被压缩编排与原文归档两侧共用，且不含任何运行时依赖，
 * 使阈值行为可以被直接单测覆盖，不必拉起整个压缩链路。
 */

/** 摘要连续失败次数 */
let consecutiveSummaryFailures = 0

/** 触发原文归档降级前允许的连续失败次数 */
export const MAX_SUMMARY_FAILURES_BEFORE_RAW_ARCHIVE = 3

/**
 * 是否应跳过 LLM 摘要、直接走原文归档
 *
 * 连续失败达到阈值后为真：此时模型侧大概率仍不可用，
 * 再重试只会重复消耗一次调用，且必然失败。
 */
export function shouldFallbackToRawArchive(): boolean {
  return consecutiveSummaryFailures >= MAX_SUMMARY_FAILURES_BEFORE_RAW_ARCHIVE
}

export function noteSummaryFailure(): void {
  consecutiveSummaryFailures += 1
}

export function resetSummaryFailure(): void {
  consecutiveSummaryFailures = 0
}

export function getSummaryFailureCount(): number {
  return consecutiveSummaryFailures
}
