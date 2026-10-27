/**
 * 检查点与文件快照类型定义
 */

import type { ContextItem } from './contextModel'
import type { FileChangeDescriptor } from './fileMutation'

export interface FileSnapshot {
  path: string
  content: string | null
  timestamp?: number
}

export interface CheckpointImage {
  id: string
  mimeType: string
  base64: string
}

export interface PendingChange extends Omit<FileChangeDescriptor, 'oldContent'> {
  id: string
  toolCallId: string
  toolName: string
  status: 'pending' | 'accepted' | 'rejected'
  snapshot: FileSnapshot
  timestamp: number
  /**
   * 产生这条变更的会话线程。
   *
   * 变更条只服务单条会话：多条会话并行执行时，任何一条都不该看到、也不该
   * 接受 / 撤销别人写下的文件变更。历史数据没有该字段，按「无归属」处理。
   */
  threadId?: string
}

/**
 * 文件变更历史记录（持久保留，用于在助手消息底部展示"文件变更"chip）
 * 与 PendingChange 不同，接受/拒绝后不会删除，仅更新 status
 */
export interface FileChangeHistoryEntry extends Omit<FileChangeDescriptor, 'oldContent'> {
  id: string
  toolCallId: string
  toolName: string
  status: 'pending' | 'accepted' | 'rejected'
  /** 关联的助手消息 ID，用于按消息筛选 */
  assistantMessageId: string
  timestamp: number
  /** 产生这条记录的会话线程，用于把变更历史限制在所属会话内 */
  threadId?: string
}

export interface MessageCheckpoint {
  id: string
  messageId: string
  timestamp: number
  fileSnapshots: Record<string, FileSnapshot>
  description: string
  images?: CheckpointImage[]
  contextItems?: ContextItem[]
}

export interface Checkpoint {
  id: string
  type: 'user_message' | 'tool_edit'
  timestamp: number
  snapshots: Record<string, FileSnapshot>
  description: string
  messageId?: string
}
