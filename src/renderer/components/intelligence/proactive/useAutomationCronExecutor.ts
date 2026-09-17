/**
 * 自动化规则 Cron 执行器 Hook
 *
 * 职责：
 * 监听主进程 cronScheduler 的 'cron:task-execute' 事件，
 * 用用户当前配置的模型（自定义或云端）在本地执行 Agent 任务。
 *
 * 本地优先策略：
 * - 客户端在线时由本地 cronScheduler 调度，用 useStore.llmConfig 的模型执行
 * - 执行成功后调 automationApi.reportExecuted 通知后端跳过（避免重复执行）
 * - 客户端离线时后端 AutomationSchedulerService 兜底执行
 *
 * 数据流：
 *   cronScheduler.tick() 命中
 *     → emit('task-execute', { taskId, ruleId, command, ... })
 *     → IPC 广播 'cron:task-execute'
 *     → useAutomationCronExecutor (本 Hook)
 *     → Agent.send(command, effectiveConfig, ..., { isAutomation: true, ruleId })
 *     → automationApi.reportExecuted(ruleId)
 *
 * @module intelligence/proactive/useAutomationCronExecutor
 */

import { useEffect, useRef } from 'react'
import { Agent } from '@intelligence/engine/IntelligenceCore'
import { useStore, useModeStore } from '@store'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import { automationApi } from '@renderer/adapters/taskProjectApi'
import { logger } from '@toolkit/LogEngine'
import { isInternalCronCommand } from '@shared/protocols/cronCommandProtocol'

/** 'cron:task-execute' 频道载荷 */
interface CronTaskExecuteEvent {
  taskId: string
  taskName: string
  command: string
  agentId?: string
  ruleId?: string
  timestamp: number
}

/** 防止短时间重复触发的同一任务 */
const recentExecutedKeys = new Set<string>()
const RECENT_TTL_MS = 60_000

/**
 * 订阅 cron:task-execute 事件，用本地配置的模型执行自动化 Agent 任务
 *
 * 应在 ChatPanel 顶层调用一次，全局生效。
 */
export function useAutomationCronExecutor(): void {
  /** 防止 IPC 重复派发导致 Agent.send 多次调用 */
  const inflightKeysRef = useRef<Set<string>>(new Set())

  /**
   * 执行自动化 Agent 任务
   */
  const executeAutomation = async (event: CronTaskExecuteEvent): Promise<void> => {
    const dedupKey = event.ruleId || event.taskId

    // 防重入：同一任务正在处理中则跳过
    if (inflightKeysRef.current.has(dedupKey)) {
      logger.agent?.debug(
        `[useAutomationCronExecutor] 任务 ${dedupKey} 已在处理中，跳过重复触发`,
      )
      return
    }

    // 短期去重：60 秒内同一任务只触发一次
    if (recentExecutedKeys.has(dedupKey)) {
      logger.agent?.debug(
        `[useAutomationCronExecutor] 任务 ${dedupKey} 60秒内已触发过，跳过`,
      )
      return
    }

    inflightKeysRef.current.add(dedupKey)
    recentExecutedKeys.add(dedupKey)
    setTimeout(() => recentExecutedKeys.delete(dedupKey), RECENT_TTL_MS)

    try {
      const appState = useStore.getState()
      const modeState = useModeStore.getState()
      const agentConfig = getAgentConfig()

      // ★ 关键：用用户当前配置的模型（自定义或云端，用户选择的）
      const effectiveConfig = await getEffectiveLLMConfigAsync(appState.llmConfig)

      const enhancedConfig = {
        ...effectiveConfig,
        contextLimit: agentConfig.maxContextTokens,
      }

      // 构建自动化消息（带规则名标记，便于用户识别）
      const automationMessage = `[自动化任务] ${event.taskName}\n\n${event.command}`

      await Agent.send(
        automationMessage,
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
          proposalId: `automation-${event.ruleId || event.taskId}`,
        },
      )

      logger.agent?.info(
        `[useAutomationCronExecutor] 自动化任务已触发: ${event.taskName} (ruleId=${event.ruleId || 'N/A'})`,
      )

      // 执行成功后通知后端更新 lastExecutedAt（让后端跳过本次执行）
      if (event.ruleId) {
        automationApi.reportExecuted(event.ruleId).catch((err: unknown) => {
          // 上报失败不影响本地执行，后端可能重复执行一次（幂等可接受）
          logger.agent?.warn(
            `[useAutomationCronExecutor] 上报执行状态失败 (ruleId=${event.ruleId}): ${err instanceof Error ? err.message : String(err)}`,
          )
        })
      }
    } catch (err) {
      logger.agent?.error(
        `[useAutomationCronExecutor] 自动化任务执行失败 (${event.taskName}): ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      inflightKeysRef.current.delete(dedupKey)
    }
  }

  // ============================================================
  // 订阅 'cron:task-execute' 频道
  // ============================================================
  useEffect(() => {
    const api = (window as Window & {
      electronAPI?: {
        onCronTaskExecute?: (callback: (event: CronTaskExecuteEvent) => void) => () => void
      }
    }).electronAPI

    if (!api?.onCronTaskExecute) {
      logger.agent?.warn('[useAutomationCronExecutor] onCronTaskExecute API 不可用')
      return
    }

    const unsubscribe = api.onCronTaskExecute((event) => {
      if (!event?.command) {
        logger.agent?.warn('[useAutomationCronExecutor] 收到无效 task-execute 载荷:', event)
        return
      }

      // 内部标记指令（'__' 前缀）由主进程模块自行消费，绝不转发给 Agent。
      // 主进程 bridge 已拦截一次，这里是「发往 Agent 前的最后一道闸」：
      // 防止将来新增广播路径时，内部指令再次被包装成 [自动化任务] 泄漏给用户。
      if (isInternalCronCommand(event.command)) {
        logger.agent?.debug(
          `[useAutomationCronExecutor] 跳过内部标记指令: ${event.taskName} (${event.command})`,
        )
        return
      }

      void executeAutomation(event)
    })
    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
