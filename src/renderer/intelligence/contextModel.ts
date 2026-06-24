/**
 * 上下文模型入口 — 统一导出上下文相关类型与工具
 */
export * from './capabilities/context/compressionUtils'
export * from './capabilities/context/contextTypes'
export type { StructuredSummary, HandoffDocument } from './capabilities/context/contextTypes'
export type { CompressionLevel } from './capabilities/context/compressionUtils'
export type { CompressionStats } from './capabilities/context/ContextCompressor'
export {
  prepareMessages,
  updateStats,
  calculateLevel,
  LEVEL_NAMES,
} from './capabilities/context/ContextCompressor'
export { buildHandoffContext, buildWelcomeMessage } from './capabilities/context/SessionHandoff'
export { generateSummary } from './capabilities/context/summaryEngine'
