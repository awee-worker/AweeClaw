/**
 * 感知层 LLM 行为预测器初始化器（阶段9 s9-04 新增）
 *
 * 职责：
 * - 在渲染层启动时从 Store 获取 LLM 配置，通过 IPC 注入主进程的
 *   BehaviorPredictorLlm，激活 LLM 双模式行为预测能力
 * - 监听 Store 中 LLM 配置变化，配置更新时自动重新初始化
 * - 失败静默，不影响渲染层主流程（自动降级到纯统计模式）
 *
 * 背景：
 * - 阶段2 已实现 BehaviorPredictor（统计模式：频次统计 + 时间衰减 + 场景匹配）
 * - 阶段9 s9-04 新增 BehaviorPredictorLlm，支持 LLM 提示词工程双模式
 * - LLM 模式需主进程持有 LLMService 句柄，由本初始化器通过 IPC 触发
 *
 * 数据流：
 *   渲染层 Store (llmConfig)
 *     → perceptionLlmInitializer
 *     → window.electronAPI.perception.initLlmPredictor({model, apiKey, baseUrl})
 *     → 主进程 PerceptionIpc 创建 LLMService + BehaviorPredictor.initLlmExtractor()
 *     → BehaviorPredictorLlm.initialize(llmService, config)
 *     → predict() 自动启用双模式融合（统计 + LLM）
 *
 * @module intelligence/runtime/perceptionLlmInitializer
 */

import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'

/** 初始化状态跟踪 */
let initialized = false
let unsubscribe: (() => void) | null = null
let lastConfigKey = ''

/**
 * 初始化感知层 LLM 行为预测器
 *
 * 从 Store 获取当前 LLM 配置，通过 IPC 注入主进程。
 * 应在应用启动后调用（例如在 setupAgentRuntime 中）。
 *
 * 幂等性：重复调用会先检查配置是否变化，仅在配置变化时重新初始化。
 */
export async function initPerceptionLlmPredictor(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.perception) {
      return
    }

    const store = useStore.getState()
    const llmConfig = store.llmConfig

    // 检查是否有可用的 LLM 配置
    if (!llmConfig?.model || !llmConfig?.apiKey) {
      logger.agent?.debug(
        '[PerceptionLlmInit] LLM 配置不完整，跳过初始化（model/apiKey 缺失）',
      )
      return
    }

    // 构造配置 key 用于变更检测
    const configKey = `${llmConfig.provider}:${llmConfig.model}:${llmConfig.apiKey?.slice(-4)}:${llmConfig.baseUrl ?? ''}`
    if (initialized && configKey === lastConfigKey) {
      // 配置未变化，跳过
      return
    }

    // 调用 IPC 初始化主进程的 BehaviorPredictorLlm
    const initResult = await window.electronAPI.perception.initLlmPredictor({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      temperature: 0.4, // 行为预测使用中等温度平衡稳定性与多样性
    })

    if (!initResult?.success) {
      logger.agent?.warn(
        '[PerceptionLlmInit] LLM 预测器初始化失败:',
        initResult?.error ?? '未知错误',
      )
      return
    }

    initialized = true
    lastConfigKey = configKey
    logger.agent?.info(
      `[PerceptionLlmInit] LLM 预测器已初始化（model=${llmConfig.model}），双模式行为预测已启用`,
    )
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionLlmInit] 初始化异常: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * 启动 LLM 配置变更监听
 *
 * 当 Store 中的 llmConfig 变化时，自动重新初始化预测器。
 * 应在 initPerceptionLlmPredictor 之后调用。
 *
 * @returns 清理函数（取消订阅）
 */
export function startPerceptionLlmConfigWatcher(): () => void {
  if (unsubscribe) {
    // 已在监听，先清理
    unsubscribe()
    unsubscribe = null
  }

  // 订阅 Store 中 llmConfig 变化
  unsubscribe = useStore.subscribe(
    (state, prevState) => {
      const newConfig = state.llmConfig
      const prevConfig = prevState.llmConfig
      // 仅在 model/apiKey/baseUrl/provider 变化时触发重新初始化
      const changed =
        newConfig?.model !== prevConfig?.model ||
        newConfig?.apiKey !== prevConfig?.apiKey ||
        newConfig?.baseUrl !== prevConfig?.baseUrl ||
        newConfig?.provider !== prevConfig?.provider

      if (changed) {
        logger.agent?.info(
          '[PerceptionLlmInit] 检测到 LLM 配置变更，重新初始化感知层 LLM 预测器',
        )
        // 重置状态，强制下次 initPerceptionLlmPredictor 重新初始化
        initialized = false
        lastConfigKey = ''
        initPerceptionLlmPredictor().catch((e) => {
          logger.agent?.warn(
            `[PerceptionLlmInit] 配置变更后重新初始化失败: ${e instanceof Error ? e.message : String(e)}`,
          )
        })
      }
    },
  )

  return () => {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

/**
 * 完整启动感知层 LLM 行为预测器
 *
 * 组合初始化 + 配置监听，应在应用启动时调用。
 *
 * @returns 清理函数（取消配置监听 + 重置主进程预测器）
 */
export function setupPerceptionLlmPredictor(): () => void {
  // 异步初始化（不阻塞主流程）
  initPerceptionLlmPredictor().catch((e) => {
    logger.agent?.warn(
      `[PerceptionLlmInit] 启动初始化失败: ${e instanceof Error ? e.message : String(e)}`,
    )
  })

  // 启动配置变更监听
  const stopWatcher = startPerceptionLlmConfigWatcher()

  return () => {
    stopWatcher()
    // 重置主进程的 LLM 预测器（降级为纯统计模式）
    if (initialized && window.electronAPI?.perception) {
      window.electronAPI.perception.resetLlmPredictor().catch(() => {
        // 静默处理重置失败
      })
    }
    initialized = false
    lastConfigKey = ''
  }
}
