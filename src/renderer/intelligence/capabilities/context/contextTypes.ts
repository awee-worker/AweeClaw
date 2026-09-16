/**
 * 上下文管理类型定义
 */

import type { LLMMessage } from '@intelligence/providerTypes'
import type { TodoItem } from '../../types/dialogThreadModel'

// 从 compressionShared.ts 导入 CompressionLevel，避免重复定义
export type { CompressionLevel } from './compressionUtils'

/** 压缩级别配置 */
export interface LevelConfig {
  threshold: number  // 触发阈值（占上限的比例）
  description: string
}

/** 压缩级别配置表 */
export const COMPRESSION_LEVELS: Record<import('./compressionUtils').CompressionLevel, LevelConfig> = {
  0: { threshold: 0, description: 'Full Context' },
  1: { threshold: 0.5, description: 'Truncate Args' },
  2: { threshold: 0.7, description: 'Clear Results' },
  3: { threshold: 0.85, description: 'Deep Compress' },
  4: { threshold: 0.95, description: 'Session Handoff' },
}

/** 消息分组（一轮对话） */
export interface MessageGroup {
  turnIndex: number
  userIndex: number
  assistantIndex: number | null
  toolIndices: number[]
  tokens: number
  importance: number
  hasWriteOps: boolean
  hasErrors: boolean
  files: string[]
}

/** 关键决策点 */
export interface DecisionPoint {
  turnIndex: number
  type: 'file_create' | 'file_modify' | 'file_delete' | 'error_fix' | 'user_correction'
  description: string
  files: string[]
  messageIndex: number
}

/** 文件修改记录 */
export interface FileChangeRecord {
  path: string
  action: 'create' | 'modify' | 'delete'
  summary: string
  turnIndex: number
}

/** 结构化摘要 */
export interface StructuredSummary {
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  todos: TodoItem[]
  decisions: DecisionPoint[]
  fileChanges: FileChangeRecord[]
  errorsAndFixes: { error: string; fix: string }[]
  userInstructions: string[]
  generatedAt: number
  turnRange: [number, number]
}

/** Session Handoff 文档 */
export interface HandoffDocument {
  fromSessionId: string
  createdAt: number
  summary: StructuredSummary
  workingDirectory: string
  keyFileSnapshots: { path: string; content: string; reason: string }[]
  lastUserRequest: string
  /**
   * 最后一条助手消息的可见文本（可选）
   *
   * 交接后新线程只带交接快照，若不把「AI 最后说了什么」一并带过去，
   * 用户对上一轮提问的简短确认（「要」「继续」）就会失去指向对象，
   * 表现为 AI「不知道要做什么」。
   */
  lastAssistantMessage?: string
  suggestedNextSteps: string[]
}

/** 上下文统计（使用新的 CompressionStats） */
import type { CompressionStats } from './ContextCompressor'
export type ContextStats = CompressionStats

/** 优化后的上下文 */
export interface OptimizedContext {
  messages: LLMMessage[]
  summary: StructuredSummary | null
  stats: CompressionStats
  handoff?: HandoffDocument
}
