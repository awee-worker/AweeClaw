/**
 * AgentRuntime 初始化器
 * 在应用启动时注册 AgentRuntime 并建立 Store 同步
 * 解耦 IntelligenceCore 与 loopDetector 之间的循环依赖
 *
 * 阶段9 s9-03：集成因果推理 LLM 抽取器初始化
 * 阶段9 s9-04：集成感知层 LLM 行为预测器初始化
 */

import { agentRuntime } from './AgentRuntime'
import { runLoopAdapter } from './loopDetector'
import { useAgentStore } from '../state/IntelligenceStore'
import { useStore } from '@store'
import { Agent } from './IntelligenceCore'
import { logger } from '@toolkit/LogEngine'
import { StoreSynchronizer } from '@store/storeSync'
import { setupCausalLlmExtractor } from '../runtime/causalLlmInitializer'
import { setupPerceptionLlmPredictor } from '../runtime/perceptionLlmInitializer'

let syncInstance: StoreSynchronizer<ReturnType<typeof useAgentStore.getState>, ReturnType<typeof useStore.getState>> | null = null

/**
 * 初始化 AgentRuntime 容器
 * 应在 initializeHarness 之后调用
 */
export function initializeAgentRuntime(): void {
  if (agentRuntime.isReady) {
    logger.agent.info('[AgentRuntime] Already initialized, skipping')
    return
  }

  agentRuntime.register({
    agentStore: useAgentStore.getState(),
    uiStore: useStore.getState(),
    runLoop: runLoopAdapter,
    sendMessage: Agent.send.bind(Agent),
  })

  logger.agent.info('[AgentRuntime] Initialized successfully')
}

/**
 * 启动 Store 同步
 * 建立 AgentStore → UIStore 的单向同步通道
 */
export function startStoreSynchronization(): () => void {
  if (syncInstance) {
    logger.store.warn('[StoreSync] Already running, stopping previous instance')
    syncInstance.stop()
  }

  syncInstance = new StoreSynchronizer(
    useAgentStore,
    useStore,
    { debounceMs: 16, debug: import.meta.env.DEV }
  )

  // 注册同步规则：AgentStore 的 currentThreadId 变更 → UIStore 更新
  syncInstance
    .registerSyncRule('thread-sync', (agentState) => {
      const currentThread = agentState.currentThreadId
        ? agentState.threads[agentState.currentThreadId]
        : null

      if (!currentThread) return {}

      // 同步当前线程的流状态到 UIStore（用于全局状态指示器）
      return {
        // 仅同步必要的 UI 指示状态，避免大量数据复制
        // 实际的消息数据仍通过 useAgentStore selector 直接读取
      } as Partial<ReturnType<typeof useStore.getState>>
    })
    .registerSyncRule('execution-meta-sync', (agentState) => {
      const currentThread = agentState.currentThreadId
        ? agentState.threads[agentState.currentThreadId]
        : null

      if (!currentThread?.executionMeta) return {}

      return {
        // 同步执行元数据用于全局状态显示
      } as Partial<ReturnType<typeof useStore.getState>>
    })
    .start()

  logger.store.info('[StoreSync] Synchronization started')

  // 返回清理函数
  return () => {
    syncInstance?.stop()
    syncInstance = null
    logger.store.info('[StoreSync] Synchronization stopped')
  }
}

/**
 * 完整的 Agent 运行时初始化
 * 包括 Runtime 注册、Store 同步、因果推理 LLM 抽取器初始化（阶段9 s9-03）、
 * 感知层 LLM 行为预测器初始化（阶段9 s9-04）
 */
export function setupAgentRuntime(): () => void {
  initializeAgentRuntime()
  const stopSync = startStoreSynchronization()
  // 阶段9 s9-03：初始化因果推理 LLM 抽取器（异步，不阻塞主流程）
  const stopCausalLlm = setupCausalLlmExtractor()
  // 阶段9 s9-04：初始化感知层 LLM 行为预测器（异步，不阻塞主流程）
  const stopPerceptionLlm = setupPerceptionLlmPredictor()

  return () => {
    stopPerceptionLlm()
    stopCausalLlm()
    stopSync()
    agentRuntime.dispose()
  }
}
