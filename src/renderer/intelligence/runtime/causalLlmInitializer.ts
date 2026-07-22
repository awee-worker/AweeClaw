/**
 * 因果推理 LLM 抽取器初始化器（阶段9 s9-03 新增）
 *
 * 职责：
 * - 在渲染层启动时从 Store 获取 LLM 配置，通过 IPC 注入主进程的
 *   LlmAssertionExtractor，激活因果断言的 LLM 自动抽取能力
 * - 监听 Store 中 LLM 配置变化，配置更新时自动重新初始化
 * - 失败静默，不影响渲染层主流程
 *
 * 背景：
 * - 阶段5/6 已实现 LlmAssertionExtractor 类和 causal:initLlmExtractor IPC
 * - 但渲染层从未调用此 IPC，导致 LLM 断言抽取能力完全未启用
 * - 阶段9 s9-03 补齐这一缺口
 *
 * 数据流：
 *   渲染层 Store (llmConfig)
 *     → causalLlmInitializer
 *     → window.electronAPI.causal.initLlmExtractor({model, apiKey, baseUrl})
 *     → 主进程 LlmAssertionExtractor.initialize(llmService, config)
 *     → window.electronAPI.causal.registerLlmCallback()
 *     → 主进程 CausalReasoningService.setLlmCallback(extractor.extract)
 *
 * @module intelligence/runtime/causalLlmInitializer
 */

import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'

/** 初始化状态跟踪 */
let initialized = false
let unsubscribe: (() => void) | null = null
let lastConfigKey = ''

/**
 * 初始化因果推理 LLM 抽取器
 *
 * 从 Store 获取当前 LLM 配置，通过 IPC 注入主进程。
 * 应在应用启动后调用（例如在 setupAgentRuntime 中）。
 *
 * 幂等性：重复调用会先检查配置是否变化，仅在配置变化时重新初始化。
 */
export async function initCausalLlmExtractor(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.electronAPI?.causal) {
      return
    }

    const store = useStore.getState()
    const llmConfig = store.llmConfig

    // 检查是否有可用的 LLM 配置
    if (!llmConfig?.model || !llmConfig?.apiKey) {
      logger.agent?.debug(
        '[CausalLlmInit] LLM 配置不完整，跳过初始化（model/apiKey 缺失）',
      )
      return
    }

    // 检查因果推理是否启用
    const causalConfigResult = await window.electronAPI.causal.getConfig()
    if (!causalConfigResult?.success || !causalConfigResult.data?.enabled) {
      logger.agent?.debug(
        '[CausalLlmInit] 因果推理未启用，跳过 LLM 抽取器初始化',
      )
      return
    }

    // 构造配置 key 用于变更检测
    const configKey = `${llmConfig.provider}:${llmConfig.model}:${llmConfig.apiKey?.slice(-4)}:${llmConfig.baseUrl ?? ''}`
    if (initialized && configKey === lastConfigKey) {
      // 配置未变化，跳过
      return
    }

    // 调用 IPC 初始化主进程的 LlmAssertionExtractor
    const initResult = await window.electronAPI.causal.initLlmExtractor({
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      temperature: 0.3, // 因果断言抽取使用较低温度提高一致性
    })

    if (!initResult?.success) {
      logger.agent?.warn(
        '[CausalLlmInit] LLM 抽取器初始化失败:',
        initResult?.error ?? '未知错误',
      )
      return
    }

    // 注册 LLM 回调，启用自动抽取
    const registerResult =
      await window.electronAPI.causal.registerLlmCallback()
    if (!registerResult?.success) {
      logger.agent?.warn(
        '[CausalLlmInit] LLM 回调注册失败:',
        registerResult?.error ?? '未知错误',
      )
      return
    }

    initialized = true
    lastConfigKey = configKey
    logger.agent?.info(
      `[CausalLlmInit] LLM 抽取器已初始化（model=${llmConfig.model}），因果断言自动抽取已启用`,
    )
  } catch (e) {
    logger.agent?.warn(
      `[CausalLlmInit] 初始化异常: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/**
 * 启动 LLM 配置变更监听
 *
 * 当 Store 中的 llmConfig 变化时，自动重新初始化抽取器。
 * 应在 initCausalLlmExtractor 之后调用。
 *
 * @returns 清理函数（取消订阅）
 */
export function startCausalLlmConfigWatcher(): () => void {
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
      // 仅在 model/apiKey/baseUrl 变化时触发重新初始化
      const changed =
        newConfig?.model !== prevConfig?.model ||
        newConfig?.apiKey !== prevConfig?.apiKey ||
        newConfig?.baseUrl !== prevConfig?.baseUrl ||
        newConfig?.provider !== prevConfig?.provider

      if (changed) {
        logger.agent?.info(
          '[CausalLlmInit] 检测到 LLM 配置变更，重新初始化因果抽取器',
        )
        // 重置状态，强制下次 initCausalLlmExtractor 重新初始化
        initialized = false
        lastConfigKey = ''
        initCausalLlmExtractor().catch((e) => {
          logger.agent?.warn(
            `[CausalLlmInit] 配置变更后重新初始化失败: ${e instanceof Error ? e.message : String(e)}`,
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
 * 完整启动因果推理 LLM 抽取器
 *
 * 组合初始化 + 配置监听，应在应用启动时调用。
 *
 * @returns 清理函数（取消配置监听）
 */
export function setupCausalLlmExtractor(): () => void {
  // 异步初始化（不阻塞主流程）
  initCausalLlmExtractor().catch((e) => {
    logger.agent?.warn(
      `[CausalLlmInit] 启动初始化失败: ${e instanceof Error ? e.message : String(e)}`,
    )
  })

  // 启动配置变更监听
  const stopWatcher = startCausalLlmConfigWatcher()

  return () => {
    stopWatcher()
    // 注销 LLM 回调（降级为仅规则抽取）
    if (initialized && window.electronAPI?.causal) {
      window.electronAPI.causal.unregisterLlmCallback().catch(() => {
        // 静默处理注销失败
      })
    }
    initialized = false
    lastConfigKey = ''
  }
}
