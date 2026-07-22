/**
 * 主动建议订阅 Hook（阶段10 s10-06 新增）
 *
 * 职责：
 * 1. 订阅主进程 'proactive:proposal' 频道（medium 级提案）
 * 2. 管理可见提案列表（最多 3 条，FIFO 淘汰）
 * 3. 提供 dismiss(proposalId) 移除单个提案
 * 4. 提供 acceptProposal(proposal) 触发行动：
 *    - action.type='chat'    → 调用 Agent.send 主动发起对话
 *    - action.type='execute' → 调用 Agent.send 执行命令（由 Agent 决定如何执行）
 *    - action.type='notify'/'suggest' → 仅记录反馈，不触发额外动作
 *
 * 数据流：
 *   ProactiveActionTrigger.handleMedium()
 *     → webContents.send('proactive:proposal', proposal)
 *     → useProactiveSuggestions (本 Hook)
 *     → ProactiveSuggestionCard[] 渲染
 *     → 用户点击「采纳」→ acceptProposal() → Agent.send
 *     → 用户点击「拒绝/稍后」→ dismiss() + recordFeedback()
 *
 * @module intelligence/proactive/useProactiveSuggestions
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Agent } from '@intelligence/engine/IntelligenceCore'
import { useStore, useModeStore } from '@store'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import { logger } from '@toolkit/LogEngine'
import type { ProactiveProposal } from './ProactiveSuggestionCard'

/** 同屏最大可见卡片数（超出 FIFO 淘汰最旧的） */
const MAX_VISIBLE = 3

/** 同一 dedupKey 的提案间隔（ms），避免短时间内重复打扰 */
const DEDUP_INTERVAL_MS = 5 * 60 * 1000

/** 已展示过的 dedupKey → 最近展示时间戳 */
const recentDedupKeys = new Map<string, number>()

interface UseProactiveSuggestionsResult {
  /** 当前可见的提案列表（最多 MAX_VISIBLE 条） */
  proposals: ProactiveProposal[]
  /** 移除指定提案（用户已处理或自动消失） */
  dismiss: (proposalId: string) => void
  /**
   * 采纳提案：根据 action.type 触发对应行动
   * - chat/execute → 调用 Agent.send（带 isProactive=true 标记）
   * - notify/suggest → 仅记录反馈，不触发额外动作
   */
  acceptProposal: (proposal: ProactiveProposal) => Promise<void>
}

/**
 * 订阅主动建议并管理状态
 *
 * @returns 提案列表 + dismiss/acceptProposal 回调
 */
export function useProactiveSuggestions(): UseProactiveSuggestionsResult {
  const [proposals, setProposals] = useState<ProactiveProposal[]>([])
  /** 用于在 IPC 回调中读取最新 proposals，避免闭包陷阱 */
  const proposalsRef = useRef<ProactiveProposal[]>([])
  proposalsRef.current = proposals

  // ============================================================
  // 去重过滤：同一 dedupKey 5 分钟内只展示一次
  // ============================================================
  const shouldDisplay = useCallback((proposal: ProactiveProposal): boolean => {
    if (!proposal.dedupKey) return true
    const now = Date.now()
    const lastShown = recentDedupKeys.get(proposal.dedupKey)
    if (lastShown && now - lastShown < DEDUP_INTERVAL_MS) {
      logger.proactive?.debug(
        `[useProactiveSuggestions] 去重拦截: dedupKey=${proposal.dedupKey}`,
      )
      return false
    }
    recentDedupKeys.set(proposal.dedupKey, now)
    // 清理过期的 dedupKey 记录（超过 1 小时）
    if (recentDedupKeys.size > 50) {
      for (const [key, ts] of recentDedupKeys) {
        if (now - ts > 60 * 60 * 1000) {
          recentDedupKeys.delete(key)
        }
      }
    }
    return true
  }, [])

  // ============================================================
  // 订阅 'proactive:proposal' 频道
  // ============================================================
  useEffect(() => {
    const api = (window as Window & {
      electronAPI?: {
        proactive?: {
          onProposal?: (
            callback: (proposal: ProactiveProposal) => void,
          ) => () => void
        }
      }
    }).electronAPI

    if (!api?.proactive?.onProposal) {
      logger.proactive?.warn('[useProactiveSuggestions] proactive.onProposal API 不可用')
      return
    }

    const unsubscribe = api.proactive.onProposal((proposal) => {
      // 基本校验
      if (!proposal?.id || !proposal.title) {
        logger.proactive?.warn('[useProactiveSuggestions] 收到无效提案，已忽略:', proposal)
        return
      }

      // 去重过滤
      if (!shouldDisplay(proposal)) return

      // 加入列表（FIFO 淘汰）
      setProposals((prev) => {
        // 同 ID 不重复加入
        if (prev.some((p) => p.id === proposal.id)) return prev
        const next = [...prev, proposal]
        if (next.length > MAX_VISIBLE) {
          next.shift()
        }
        return next
      })
    })

    return () => {
      unsubscribe()
    }
  }, [shouldDisplay])

  // ============================================================
  // dismiss: 移除指定提案
  // ============================================================
  const dismiss = useCallback((proposalId: string) => {
    setProposals((prev) => prev.filter((p) => p.id !== proposalId))
  }, [])

  // ============================================================
  // acceptProposal: 采纳提案，触发对应行动
  // ============================================================
  const acceptProposal = useCallback(async (proposal: ProactiveProposal) => {
    // 先移除卡片
    dismiss(proposal.id)

    // notify/suggest 类型：仅记录反馈，不触发额外动作
    if (proposal.action.type === 'notify' || proposal.action.type === 'suggest') {
      return
    }

    // chat/execute 类型：调用 Agent.send 发起主动对话
    try {
      const appState = useStore.getState()
      const modeState = useModeStore.getState()
      const agentConfig = getAgentConfig()
      const effectiveConfig = await getEffectiveLLMConfigAsync(appState.llmConfig)

      const enhancedConfig = {
        ...effectiveConfig,
        contextLimit: agentConfig.maxContextTokens,
      }

      // 构建主动消息文本（带来源标记，便于 Agent 识别上下文）
      const proactiveMessage = buildProactiveMessage(proposal)

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
          proposalId: proposal.id,
        },
      )

      logger.proactive?.info(
        `[useProactiveSuggestions] 采纳提案并触发 Agent.send: proposalId=${proposal.id}, actionType=${proposal.action.type}`,
      )
    } catch (err) {
      logger.proactive?.error(
        `[useProactiveSuggestions] 采纳提案失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [dismiss])

  return {
    proposals,
    dismiss,
    acceptProposal,
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据提案构建发送给 Agent 的消息文本
 * 包含来源、标题、理由和行动载荷，便于 Agent 理解上下文
 */
function buildProactiveMessage(proposal: ProactiveProposal): string {
  const parts: string[] = [
    `[主动式助手] ${proposal.title}`,
    '',
    proposal.description,
  ]

  if (proposal.reason) {
    parts.push('', `触发理由: ${proposal.reason}`)
  }

  if (proposal.action.type === 'execute') {
    parts.push('', `建议执行的命令/动作: ${proposal.action.payload}`)
  } else if (proposal.action.type === 'chat') {
    parts.push('', `主动对话内容: ${proposal.action.payload}`)
  }

  if (proposal.signals.length > 0) {
    parts.push('', `感知信号: ${proposal.signals.join(', ')}`)
  }

  return parts.join('\n')
}
