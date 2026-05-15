/**
 * 上下文管理模块
 */

// 压缩管理器
export {
  prepareMessages,
  updateStats,
  estimateMessagesTokens,
  type CompressionStats,
  type PrepareResult,
} from '../capabilities/context/ContextCompressor'
export {
  calculateLevel,
  LEVEL_NAMES,
  type CompressionLevel,
} from '../capabilities/context/compressionUtils'

// 摘要服务
export {
  generateSummary,
  generateHandoffDocument,
  type SummaryResult,
} from '../capabilities/context/summaryEngine'

// Handoff 管理
export { buildHandoffContext, buildWelcomeMessage } from '../capabilities/context/SessionHandoff'

// 类型
export type {
  StructuredSummary,
  HandoffDocument,
  FileChangeRecord,
} from '@intelligence/providerTypes'
