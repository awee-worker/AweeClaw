/**
 * Agent 模块类型定义
 * 
 * 按领域拆分，统一导出
 */

// ============================================
// 从 shared/types 重新导出通用类型
// ============================================

export type {
  TextContent,
  ImageContent,
  FileContent,
  MessageContent,
  ToolStatus,
  ToolResultType,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  ToolApprovalType,
  LLMMessage,
  ToolPropertySchema,
  ToolExecutionEnvelope,
  ToolExecutionOutcome,
  ToolStreamingPreview,
  ToolRichContent,
  ToolRichContentType,
} from '@shared/protocols/modelGateway'

// ============================================
// 从配置中心导入基础类型
// ============================================

export type { ToolCategory, ToolConfig } from '@configuration/toolDefinitions'
export type { AgentRuntimeConfig } from '@configuration/agentProfile'
export type { CompressionLevel } from '../capabilities/context/compressionUtils'
export type { HandoffDocument } from '@intelligence/providerTypes'

// ============================================
// Agent 专用类型
// ============================================

// 消息类型
export * from './conversationModel'

// 上下文类型
export * from './contextModel'

// 交互式内容类型
export * from './interactiveSession'

// 表单交互类型
export * from './form'

// 文件变更类型
export * from './fileMutation'

// 检查点类型
export * from './sessionSnapshot'

// 线程类型
export * from './dialogThreadModel'

// 服务类型
export * from './serviceContracts'

// ============================================
// 工具函数
// ============================================

import { isFileEditTool } from '@configuration/toolDefinitions'
import { isAssistantMessage, isToolCallPart, type ChatMessage } from './conversationModel'

export function getModifiedFilesFromMessages(messages: ChatMessage[]): string[] {
  const files = new Set<string>()
  for (const msg of messages) {
    if (isAssistantMessage(msg)) {
      for (const part of msg.parts) {
        if (isToolCallPart(part)) {
          const tc = part.toolCall
          if (isFileEditTool(tc.name)) {
            // 安全地访问 path 和 _meta.filePath
            let path: string | undefined
            if (typeof tc.arguments.path === 'string') {
              path = tc.arguments.path
            } else if (tc.arguments._meta && typeof tc.arguments._meta === 'object' && '_meta' in tc.arguments._meta) {
              const meta = tc.arguments._meta as { filePath?: unknown }
              if (typeof meta.filePath === 'string') {
                path = meta.filePath
              }
            }
            if (path) files.add(path)
          }
        }
      }
    }
  }
  return Array.from(files)
}

export function findLastCheckpointIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'checkpoint') return i
  }
  return -1
}
