/**
 * 链路追踪 Span
 *
 * 直接复用 @aweeclaw/harness-core 的 Span 与工具函数。
 */
export {
  createSpan,
  endSpan,
  addSpanEvent,
  getSpanDuration,
  formatSpanTree,
} from '@aweeclaw/harness-core'
export type { Span, SpanEvent } from '@aweeclaw/harness-core'
