/**
 * 主动式助手 high/critical 级派发 Hook（阶段10 s10-06 新增）
 *
 * 职责：
 * 1. 订阅 'proactive:invoke-agent' 频道（high 级）→ 直接调用 Agent.send 发起主动对话
 * 2. 订阅 'proactive:execute-action' 频道（critical 级）→ 调用 Agent.send 执行预授权动作
 *
 * 与 useProactiveSuggestions 的区别：
 * - useProactiveSuggestions 处理 medium 级，需要用户在 SuggestionCard 上点击「采纳」才触发
 * - useProactiveInvoker 处理 high/critical 级，自动触发，无需用户交互
 *   （权限校验在主进程 ProactivePermission 中已完成，到达渲染层即表示已获授权）
 *
 * 数据流：
 *   ProactiveActionTrigger.handleHigh()
 *     → webContents.send('proactive:invoke-agent', { proposalId, message, ... })
 *     → useProactiveInvoker (本 Hook)
 *     → Agent.send(message, config, ..., { isProactive: true, proposalId })
 *
 *   ProactiveActionTrigger.handleCritical()
 *     → webContents.send('proactive:execute-action', { proposalId, action, ... })
 *     → useProactiveInvoker (本 Hook)
 *     → Agent.send(action.payload, config, ..., { isProactive: true, proposalId })
 *
 * @module intelligence/proactive/useProactiveInvoker
 */

import { useEffect, useRef } from 'react'
import { Agent } from '@intelligence/engine/IntelligenceCore'
import { useStore, useModeStore } from '@store'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import { logger } from '@toolkit/LogEngine'

/** 'proactive:invoke-agent' 频道载荷 */
interface InvokeAgentPayload {
  proposalId: string
  message: string
  source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
  title: string
  reason: string
}

/** 'proactive:execute-action' 频道载荷 */
interface ExecuteActionPayload {
  proposalId: string
  action: {
    type: 'notify' | 'suggest' | 'chat' | 'execute'
    payload: string
  }
  source: 'coding' | 'iot' | 'system' | 'time' | 'fusion'
  title: string
  reason: string
}

/** 防止短时间重复触发的同一 proposalId */
const recentInvokedIds = new Set<string>()
const RECENT_INVOKE_TTL_MS = 30_000

/**
 * 订阅 high/critical 级主动派发，自动触发 Agent.send
 *
 * 应在 ChatPanel 顶层调用一次，全局生效。
 */
export function useProactiveInvoker(): void {
  /** 防止 IPC 重复派发导致 Agent.send 多次调用 */
  const inflightProposalIdsRef = useRef<Set<string>>(new Set())

  // ============================================================
  // 公共：调用 Agent.send 发起主动对话
  // ============================================================
  const invokeAgent = async (
    message: string,
    proposalId: string,
    source: string,
    title: string,
  ): Promise<void> => {
    // 防重入：同一 proposalId 正在处理中则跳过
    if (inflightProposalIdsRef.current.has(proposalId)) {
      logger.proactive?.debug(
        `[useProactiveInvoker] proposalId=${proposalId} 已在处理中，跳过重复触发`,
      )
      return
    }

    // 短期去重：30 秒内同一 proposalId 只触发一次
    if (recentInvokedIds.has(proposalId)) {
      logger.proactive?.debug(
        `[useProactiveInvoker] proposalId=${proposalId} 30秒内已触发过，跳过`,
      )
      return
    }

    inflightProposalIdsRef.current.add(proposalId)
    recentInvokedIds.add(proposalId)
    setTimeout(() => recentInvokedIds.delete(proposalId), RECENT_INVOKE_TTL_MS)

    try {
      const appState = useStore.getState()
      const modeState = useModeStore.getState()
      const agentConfig = getAgentConfig()
      const effectiveConfig = await getEffectiveLLMConfigAsync(appState.llmConfig)

      const enhancedConfig = {
        ...effectiveConfig,
        contextLimit: agentConfig.maxContextTokens,
      }

      // 构建主动消息（带来源标记）
      const proactiveMessage = `[主动式助手 - ${source}] ${title}\n\n${message}`

      await Agent.send(
        proactiveMessage,
        enhancedConfig,
        appState.workspacePath,
        modeState.currentMode,
        {
          openFiles: appState.openFiles.map((file) => file.path),
          activeFile: appState.activeFilePath || undefined,
          customInstructions: appState.aiInstructions,
          promptTemplateId: appState.promptTemplateId,
        },
        {
          isProactive: true,
          proposalId,
        },
      )

      logger.proactive?.info(
        `[useProactiveInvoker] 主动对话已触发: proposalId=${proposalId}, source=${source}`,
      )
    } catch (err) {
      logger.proactive?.error(
        `[useProactiveInvoker] 主动对话触发失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      inflightProposalIdsRef.current.delete(proposalId)
    }
  }

  // ============================================================
  // 订阅 'proactive:invoke-agent' 频道（high 级）
  // ============================================================
  useEffect(() => {
    const api = (window as Window & {
      electronAPI?: {
        proactive?: {
          onInvokeAgent?: (
            callback: (payload: InvokeAgentPayload) => void,
          ) => () => void
        }
      }
    }).electronAPI

    if (!api?.proactive?.onInvokeAgent) {
      logger.proactive?.warn('[useProactiveInvoker] proactive.onInvokeAgent API 不可用')
      return
    }

    const unsubscribe = api.proactive.onInvokeAgent((payload) => {
      if (!payload?.proposalId || !payload.message) {
        logger.proactive?.warn('[useProactiveInvoker] 收到无效 invoke-agent 载荷:', payload)
        return
      }
      void invokeAgent(payload.message, payload.proposalId, payload.source, payload.title)
    })

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // 订阅 'proactive:execute-action' 频道（critical 级）
  // ============================================================
  useEffect(() => {
    const api = (window as Window & {
      electronAPI?: {
        proactive?: {
          onExecuteAction?: (
            callback: (payload: ExecuteActionPayload) => void,
          ) => () => void
        }
      }
    }).electronAPI

    if (!api?.proactive?.onExecuteAction) {
      logger.proactive?.warn('[useProactiveInvoker] proactive.onExecuteAction API 不可用')
      return
    }

    const unsubscribe = api.proactive.onExecuteAction((payload) => {
      if (!payload?.proposalId || !payload.action?.payload) {
        logger.proactive?.warn('[useProactiveInvoker] 收到无效 execute-action 载荷:', payload)
        return
      }

      // critical 级执行动作：通过 Agent.send 让 Agent 决定如何执行
      // （Agent 拥有完整的工具集：终端、文件、IoT 联动等）
      const message = `执行预授权动作: ${payload.action.payload}\n\n来源: ${payload.source}\n标题: ${payload.title}${payload.reason ? `\n理由: ${payload.reason}` : ''}`
      void invokeAgent(message, payload.proposalId, payload.source, payload.title)
    })

    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
