/**
 * 记忆数据库模块导出
 */

export { MemoryDb } from './MemoryDb'
export type {
  MemoryEntryRow,
  MemoryRelationRow,
  MemorySyncStateRow,
  GroupMemoryRow,
} from './MemoryDb'

// 群组记忆（P1-3）
export { GroupMemoryExtractor } from './GroupMemoryExtractor'
export type { ExtractedMemory, ExtractRequest, LLMCaller } from './GroupMemoryExtractor'

export { GroupMemoryManager } from './GroupMemoryManager'
export type { GroupMemoryConfig, MemoryContextResult } from './GroupMemoryManager'

export { registerGroupMemoryIpcHandlers, cleanupGroupMemoryIpcHandlers } from './GroupMemoryIpc'
