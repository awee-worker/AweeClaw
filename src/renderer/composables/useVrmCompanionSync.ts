/**
 * useVrmCompanionSync — 主窗口 → VRM 桌面伴侣 的联动同步
 *
 * 职责：
 * 1. 观察当前会话最后一条 AI 回复的内容变化：
 *    - 内容仍在增长（流式输出）→ 向伴侣窗口广播「说话中」，驱动口型
 *    - 内容稳定超过静默阈值 → 广播「停止说话」，并从完整回复中提取好感度标签
 * 2. 让伴侣角色的口型与主窗口 AI 输出节奏保持同步（无需侵入 Agent 内部流程）
 * 3. 推送语音上下文到伴侣窗口，支撑「在伴侣窗口里直接语音对话」：
 *    - llmConfig / cloudMode / serverUrl / tokens / voiceModelConfig 等运行时配置
 *    - 主窗口全功能语音是否激活（激活时伴侣应让出麦克风，避免双端录音）
 * 4. 接住伴侣窗口的对话完成事件，落库到主窗口聊天历史
 *
 * 设计取舍：
 * - 不做 Agent 内部埋点，改用「轮询 store 快照 + 内容 diff」的松耦合方式：
 *   主窗口与伴侣窗口彼此独立，任一侧关闭都不影响另一侧。
 * - 轮询间隔 400ms：远低于人对口型同步的敏感阈值，同时避免高频 IPC。
 * - 伴侣窗口未开启时调用无副作用（主进程 send 到不存在的窗口会静默丢弃）。
 *
 * 使用方式：在 AweeApp.tsx 顶层调用一次。
 */

import { useEffect, useRef } from 'react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getMessageText } from '@intelligence/types/conversationModel'
import { api } from '@renderer/adapters/electronBridge'
import { getTokens } from '@renderer/adapters/backendApi'
import { saveVoiceConversationToHistory } from '@intelligence/state/saveConversation'
import { logger } from '@shared/toolkit/LogEngine'

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 400
/** 内容静默多久后判定「说完了」（ms） */
const SILENCE_THRESHOLD_MS = 1200

/** 消息最小结构约束（避免依赖完整类型定义） */
interface MinimalMessage {
  role?: string
  content?: unknown
}

export function useVrmCompanionSync(): void {
  /** 上一次观察到的 AI 回复全文 */
  const lastTextRef = useRef('')
  /** 上次内容变化的时间戳 */
  const lastChangeAtRef = useRef(0)
  /** 当前是否处于「说话中」状态 */
  const speakingRef = useRef(false)
  /** 好感度是否已对当前这段回复结算过 */
  const affectionSettledRef = useRef(true)

  // --------------------------------------------
  // 语音上下文推送（伴侣窗口内独立语音对话所需的运行时配置）
  // --------------------------------------------
  const { llmConfig, cloudMode, serverUrl, language, workspace, agentConfig, voiceConversationActive } =
    useStore(
      useShallow((s) => ({
        llmConfig: s.llmConfig,
        cloudMode: s.cloudMode,
        serverUrl: s.serverUrl,
        language: s.language,
        workspace: s.workspace,
        agentConfig: s.agentConfig,
        voiceConversationActive: s.voiceConversationActive,
      })),
    )
  const workMode = useModeStore((s) => s.currentMode)

  /** 上次推送上下文的指纹，避免同一份配置反复推 IPC */
  const lastContextSignatureRef = useRef('')
  const workspacePath = workspace?.roots?.[0] || null
  const tokens = getTokens()

  useEffect(() => {
    const voiceContext = {
      llmConfig: llmConfig ?? null,
      cloudMode,
      serverUrl: serverUrl || null,
      accessToken: tokens?.accessToken || null,
      refreshToken: tokens?.refreshToken || null,
      // voiceModelConfig 由设置库异步加载，单独推送（见下一个 effect）
      voiceModelConfig: null,
      language: language === 'en' ? ('en' as const) : ('zh' as const),
      workspacePath,
      workMode,
      agentConfig: agentConfig ?? null,
      updatedAt: Date.now(),
    }

    // 指纹只取关键字段：llmConfig / token 末 8 位 / 模式 / 语言 / 工作区
    // token 取末位是为了在刷新后也能检测到变化（accessToken 前缀通常不变）
    const signature = JSON.stringify({
      llmConfig: voiceContext.llmConfig,
      cloudMode: voiceContext.cloudMode,
      serverUrl: voiceContext.serverUrl,
      accessToken: tokens?.accessToken ? tokens.accessToken.slice(-8) : null,
      language: voiceContext.language,
      workspacePath: voiceContext.workspacePath,
      workMode: voiceContext.workMode,
      agentActiveId: agentConfig?.activeCustomAgentId ?? null,
    })

    if (signature === lastContextSignatureRef.current) return
    lastContextSignatureRef.current = signature

    void api.vrmCompanion.updateVoiceContext(voiceContext).catch((err) => {
      logger.system.debug('[VrmCompanionSync] Push voice context failed:', err)
    })
  }, [
    llmConfig,
    cloudMode,
    serverUrl,
    language,
    workspacePath,
    workMode,
    agentConfig,
    tokens?.accessToken,
    tokens?.refreshToken,
  ])

  // STT/TTS 分流配置（voice_model_config）由设置库管理，异步读取后单独推送
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await api.settings.dbGetVoiceModelConfig()
        if (cancelled || !config) return
        // 清空指纹，强制下一次全量推送带上 voiceModelConfig（缓存是增量合并的）
        lastContextSignatureRef.current = ''
        await api.vrmCompanion.updateVoiceContext({ voiceModelConfig: config })
      } catch (err) {
        logger.system.debug('[VrmCompanionSync] Push voice model config failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 主窗口全功能语音对话激活状态 → 伴侣窗口（激活时伴侣暂停自己的麦克风采集）
  useEffect(() => {
    api.vrmCompanion.notifyMainConversationActive(voiceConversationActive)
  }, [voiceConversationActive])

  // 伴侣窗口对话完成 → 落库到主窗口聊天历史（伴侣窗口不维护本地历史）
  useEffect(() => {
    const off = api.vrmCompanion.onSaveConversation((payload) => {
      try {
        saveVoiceConversationToHistory({
          userText: payload.userText,
          aiText: payload.aiText,
          toolCallRecords: payload.toolCallRecords,
        })
      } catch (err) {
        logger.system.error('[VrmCompanionSync] Save companion conversation failed:', err)
      }
    })
    return off
  }, [])

  // 伴侣窗口语音状态变化（供主窗口 UI 联动/日志）
  useEffect(() => {
    const off = api.vrmCompanion.onVoiceStateChanged((payload) => {
      logger.system.debug('[VrmCompanionSync] Companion voice state:', payload.state)
    })
    return off
  }, [])

  useEffect(() => {
    /**
     * 取当前会话最后一条 assistant 消息的纯文本。
     *
     * 全部使用可选链 + try/catch：store 结构在会话切换/清空等过程中可能瞬时不一致，
     * 此处任何异常都不应影响主窗口。
     */
    const readLastAssistantText = (): string | null => {
      try {
        const state = useAgentStore.getState() as unknown as {
          currentThreadId?: string | null
          threads?: Record<string, { messages?: MinimalMessage[] } | undefined>
        }
        const threadId = state.currentThreadId
        if (!threadId || !state.threads) return null
        const thread = state.threads[threadId]
        if (!thread?.messages?.length) return null

        for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
          const msg = thread.messages[i]
          if (msg?.role !== 'assistant') continue
          const text = getMessageText(msg as never)
          return typeof text === 'string' ? text : null
        }
        return null
      } catch (err) {
        logger.system.debug('[VrmCompanionSync] Read thread failed:', err)
        return null
      }
    }

    const timer = window.setInterval(() => {
      const text = readLastAssistantText()
      if (!text) return

      const now = Date.now()

      // 内容发生增长 → 广播说话中
      if (text !== lastTextRef.current) {
        const isFirstObservation = lastTextRef.current === ''
        lastTextRef.current = text
        lastChangeAtRef.current = now

        // 新的一段回复开始（可能换会话），重置好感度结算标记
        if (isFirstObservation) affectionSettledRef.current = false

        speakingRef.current = true
        void api.vrmCompanion
          .broadcastSpeak({ text })
          .catch((err) => logger.system.debug('[VrmCompanionSync] broadcastSpeak failed:', err))
        return
      }

      // 内容稳定超过阈值 → 收尾
      if (speakingRef.current && now - lastChangeAtRef.current >= SILENCE_THRESHOLD_MS) {
        speakingRef.current = false
        void api.vrmCompanion
          .broadcastStopSpeak()
          .catch((err) => logger.system.debug('[VrmCompanionSync] broadcastStopSpeak failed:', err))

        // 从完整回复中提取好感度标签（<user=名称 love=数值>），每段回复只结算一次
        if (!affectionSettledRef.current) {
          affectionSettledRef.current = true
          const settledText = lastTextRef.current
          void api.vrmCompanion
            .checkAffection(settledText)
            .catch((err) => logger.system.debug('[VrmCompanionSync] checkAffection failed:', err))
        }
      }
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      // 卸载时停止伴侣说话，避免「卡住张嘴」
      if (speakingRef.current) {
        speakingRef.current = false
        void api.vrmCompanion.broadcastStopSpeak().catch(() => {})
      }
    }
  }, [])
}
