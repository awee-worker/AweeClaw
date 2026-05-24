/**
 * Agent 运行时容器
 * 通过依赖注入解耦 IntelligenceCore、LoopDetector 和各 Slice 之间的循环依赖
 * 避免动态导入带来的时序问题和性能开销
 */

import type { AgentStore } from '../state/IntelligenceStore'
import type { StoreState } from '@store'
import type { LLMConfig } from '@shared/configuration/providerTypes'
import type { MessageContent, ChatMessage, ContextItem } from '@intelligence/providerTypes'
import type { WorkMode } from '@renderer/modes/workModeTypes'
import type { TokenBudgetController } from '../capabilities/budget/TokenQuotaManager'
import type { ExecutionContext } from './intelligenceTypes'
import { logger } from '@toolkit/LogEngine'

// ===== 类型定义 =====

export interface LoopExecutionParams {
  config: LLMConfig
  llmMessages: import('@shared/protocols/modelGateway').LLMMessage[]
  context: ExecutionContext
  assistantId: string
  budgetController?: TokenBudgetController
}

export type RunLoopFn = (params: LoopExecutionParams) => Promise<void>

export interface AgentRuntime {
  /** Agent Store 实例 */
  agentStore: AgentStore
  /** UI Store 实例（只读访问） */
  uiStore: StoreState
  /** 循环执行器 */
  runLoop: RunLoopFn
  /** 消息发送器 */
  sendMessage: (
    userMessage: MessageContent,
    config: LLMConfig,
    workspacePath: string | null,
    chatMode: WorkMode,
    promptOptions?: PromptOptions,
    executionOptions?: ExecutionOptions
  ) => Promise<{ threadId: string; assistantId: string; requestId: string }>
}

export interface PromptOptions {
  openFiles?: string[]
  activeFile?: string
  customInstructions?: string
  promptTemplateId?: string
  planPhase?: 'planning' | 'executing'
  mentionedSkills?: string[]
}

export interface ExecutionOptions {
  threadId?: string
  requestId?: string
  planTaskId?: string
}

// ===== 运行时容器 =====

class AgentRuntimeContainer {
  private runtime: AgentRuntime | null = null
  private initializationPromise: Promise<AgentRuntime> | null = null
  private isInitializing = false

  /**
   * 注册运行时实例
   * 应在应用启动时调用一次
   */
  register(runtime: AgentRuntime): void {
    if (this.runtime) {
      logger.agent.warn('[AgentRuntime] Runtime already registered, overwriting')
    }
    this.runtime = runtime
    this.initializationPromise = null
    this.isInitializing = false
    logger.agent.info('[AgentRuntime] Runtime registered')
  }

  /**
   * 异步初始化（支持延迟加载）
   */
  async initialize(factory: () => Promise<AgentRuntime>): Promise<AgentRuntime> {
    if (this.runtime) {
      return this.runtime
    }

    if (this.initializationPromise) {
      return this.initializationPromise
    }

    if (this.isInitializing) {
      throw new Error('[AgentRuntime] Circular initialization detected')
    }

    this.isInitializing = true
    this.initializationPromise = factory().then((runtime) => {
      this.runtime = runtime
      this.isInitializing = false
      return runtime
    }).catch((error) => {
      this.isInitializing = false
      this.initializationPromise = null
      throw error
    })

    return this.initializationPromise
  }

  /**
   * 获取运行时实例
   * @throws 如果运行时未注册
   */
  get(): AgentRuntime {
    if (!this.runtime) {
      throw new Error(
        '[AgentRuntime] Runtime not initialized. ' +
        'Call register() or initialize() before using the runtime.'
      )
    }
    return this.runtime
  }

  /**
   * 安全获取运行时实例
   * @returns 运行时实例或 null
   */
  getOrNull(): AgentRuntime | null {
    return this.runtime
  }

  /**
   * 检查运行时是否已初始化
   */
  get isReady(): boolean {
    return this.runtime !== null
  }

  /**
   * 注销运行时
   */
  dispose(): void {
    this.runtime = null
    this.initializationPromise = null
    this.isInitializing = false
    logger.agent.info('[AgentRuntime] Runtime disposed')
  }
}

// 全局单例
export const agentRuntime = new AgentRuntimeContainer()

// ===== 便捷 Hook =====

/**
 * 在组件中获取 AgentRuntime
 * 注意：仅在运行时已初始化后使用
 */
export function useAgentRuntime(): AgentRuntime {
  return agentRuntime.get()
}
