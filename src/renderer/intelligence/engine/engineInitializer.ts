/**
 * 行为引擎和 SubAgent 引擎初始化器
 *
 * 在应用启动时初始化：
 * - BehaviorEngine：主动触发 AI 服务
 * - SubAgentEngine：后台任务执行引擎
 */

import { logger } from '@toolkit/LogEngine'
import { BehaviorEngine } from '../runtime/BehaviorEngine'
import { SubAgentEngine } from './SubAgentEngine'

// 单例引用
let behaviorEngine: BehaviorEngine | null = null
let subAgentEngine: SubAgentEngine | null = null

/**
 * 初始化行为引擎
 * 注册到全局单例，供外部通过 getBehaviorEngine() 访问
 */
export function initializeBehaviorEngine(
  onPromptGenerated?: (prompt: string, ruleId: string) => void,
  onNotification?: (title: string, body: string) => void,
  onToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>,
): BehaviorEngine {
  if (behaviorEngine) {
    logger.agent.info('[EngineInit] BehaviorEngine already initialized')
    return behaviorEngine
  }

  behaviorEngine = new BehaviorEngine(onPromptGenerated, onNotification, onToolCall)
  behaviorEngine.start()
  
  logger.agent.info('[EngineInit] BehaviorEngine initialized and started')
  return behaviorEngine
}

/**
 * 初始化 SubAgent 任务引擎
 * 注册到全局单例，供外部通过 getSubAgentEngine() 访问
 */
export async function initializeSubAgentEngine(
  executeTask?: (taskId: string, prompt: string, onProgress?: (progress: number) => void) => Promise<string>,
  onProgress?: (taskId: string, progress: number) => void,
  onResult?: (taskId: string, success: boolean, result?: string, error?: string) => void,
  onNotification?: (title: string, body: string) => void,
): Promise<SubAgentEngine> {
  if (subAgentEngine) {
    logger.agent.info('[EngineInit] SubAgentEngine already initialized')
    return subAgentEngine
  }

  subAgentEngine = new SubAgentEngine()
  await subAgentEngine.init()

  // 设置执行器（如果提供）
  if (executeTask) {
    subAgentEngine.setExecutor(executeTask)
  }

  // 设置事件回调
  if (onProgress || onResult || onNotification) {
    subAgentEngine.setCallbacks(
      onProgress ? (event) => onProgress(event.taskId, event.progress) : undefined,
      onResult ? (event) => onResult(event.taskId, event.success, event.result, event.error) : undefined,
      onNotification,
    )
  }

  logger.agent.info('[EngineInit] SubAgentEngine initialized')
  return subAgentEngine
}

/**
 * 完整的引擎初始化
 * 在应用启动时调用
 */
export async function initializeEngines(): Promise<{
  behavior: BehaviorEngine
  subAgent: SubAgentEngine
}> {
  logger.agent.info('[EngineInit] Initializing all engines...')

  // 初始化行为引擎
  const behavior = initializeBehaviorEngine()

  // 初始化 SubAgent 引擎
  const subAgent = await initializeSubAgentEngine()

  logger.agent.info('[EngineInit] All engines initialized')

  return { behavior, subAgent }
}

/**
 * 清理所有引擎
 */
export function disposeEngines(): void {
  if (behaviorEngine) {
    behaviorEngine.stop()
    behaviorEngine = null
  }

  if (subAgentEngine) {
    subAgentEngine = null
  }

  logger.agent.info('[EngineInit] All engines disposed')
}

/**
 * 获取已初始化的行为引擎
 */
export function getInitializedBehaviorEngine(): BehaviorEngine | null {
  return behaviorEngine
}

/**
 * 获取已初始化的 SubAgent 引擎
 */
export function getInitializedSubAgentEngine(): SubAgentEngine | null {
  return subAgentEngine
}
