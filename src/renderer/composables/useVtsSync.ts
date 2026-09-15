/**
 * useVtsSync — 主窗口 AI 输出 → VTS（VTube Studio）联动
 *
 * 与 `useVrmCompanionSync` 的分工：
 *   - 口型：**不在本 hook 里**。音频走 `services/vtsAudioTap` 的旁路（在 TTS 产出点
 *     转发给主进程做 PCM 分析），比轮询文本精确得多。
 *   - 本 hook 只负责两件「基于文本」的事：
 *       1. 新回复开始 → 打断上一段口型（否则长回复叠话时嘴型会错位）
 *       2. 回复收尾 → 提取 `<表情名>` / `<热键名>` 标签并触发
 *
 * 为什么要等「收尾」再触发标签：
 *   流式输出期间文本每几百毫秒就变一次，若边流边触发，一句
 *   `<开心>今天天气不错<挥手>哦` 会在几秒内反复切表情与动作，
 *   模型看起来像抽搐。等静默阈值过了再一次性触发，行为与真人播报一致。
 *
 * 设计取舍：与 VRM 同步一样采用「轮询 store 快照 + 内容 diff」，不侵入 Agent 内部流程。
 * 两个 hook 各自独立轮询（400ms 读内存快照，成本可忽略），任一侧关闭都不影响另一侧。
 *
 * 使用方式：在 AweeApp.tsx 顶层调用一次。
 */

import { useEffect, useRef } from 'react'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getMessageText } from '@intelligence/types/conversationModel'
import { api } from '@renderer/adapters/electronBridge'
import { setVtsAudioReady } from '@renderer/services/vtsAudioTap'
import { logger } from '@shared/toolkit/LogEngine'

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 400
/** 内容静默多久后判定「说完了」（ms）—— 与 VRM 同步保持一致的口径 */
const SILENCE_THRESHOLD_MS = 1200

/** 消息最小结构约束（避免依赖完整类型定义） */
interface MinimalMessage {
  role?: string
  content?: unknown
}

export function useVtsSync(): void {
  /** 上一次观察到的 AI 回复全文 */
  const lastTextRef = useRef('')
  /** 上次内容变化的时间戳 */
  const lastChangeAtRef = useRef(0)
  /** 当前是否处于「回复进行中」状态 */
  const replyingRef = useRef(false)
  /** 本段回复的标签是否已触发过 */
  const triggeredRef = useRef(true)
  /** VTS 是否已启用（未启用时轮询到内容也不发 IPC） */
  const enabledRef = useRef(false)

  // --------------------------------------------
  // 状态订阅：维护「音频旁路可用」标志
  // --------------------------------------------
  useEffect(() => {
    const applyStatus = (status: {
      enabled: boolean
      authenticated: boolean
    }): void => {
      enabledRef.current = status.enabled
      // 只有「已启用 + 已鉴权」才允许转发音频：
      // 未鉴权时转发只会让主进程白白 spawn 一次 ffmpeg（转完发现连不上，丢弃）
      setVtsAudioReady(status.enabled && status.authenticated)
      if (!status.enabled) replyingRef.current = false
    }

    const off = api.vts.onStatus(payload => {
      try {
        applyStatus(payload.status)
      } catch (err) {
        logger.system.debug('[VtsSync] 处理状态推送失败：', err)
      }
    })

    // 订阅只覆盖「变化」，挂载瞬间需要主动拉一次当前状态
    void api.vts
      .getStatus()
      .then(res => {
        if (res.success && res.data) applyStatus(res.data)
      })
      .catch(err => logger.system.debug('[VtsSync] 读取初始状态失败：', err))

    return () => {
      off()
      // 卸载后不再转发音频，避免 hook 已销毁但旁路还在推
      setVtsAudioReady(false)
    }
  }, [])

  // --------------------------------------------
  // 回复文本轮询：打断 + 标签触发
  // --------------------------------------------
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
        logger.system.debug('[VtsSync] 读取会话失败：', err)
        return null
      }
    }

    const timer = window.setInterval(() => {
      if (!enabledRef.current) return

      const text = readLastAssistantText()
      if (!text) return

      const now = Date.now()

      if (text !== lastTextRef.current) {
        const previous = lastTextRef.current
        // 用「前缀包含」区分「同一段回复在增长」与「换了一段新回复」：
        // 流式输出永远是在旧文本尾部追加，一旦不是前缀关系就说明开了新一段。
        const isContinuation = previous !== '' && text.startsWith(previous)

        if (!isContinuation) {
          // 新回复开始 → 打断上一段可能还在播的口型，避免两段音频叠在一起
          void api.vts
            .clearAudio()
            .catch(err => logger.system.debug('[VtsSync] 打断口型失败：', err))
          triggeredRef.current = false
        }

        lastTextRef.current = text
        lastChangeAtRef.current = now
        replyingRef.current = true
        return
      }

      // 内容稳定超过阈值 → 收尾：触发标签（每段回复只结算一次）
      if (replyingRef.current && now - lastChangeAtRef.current >= SILENCE_THRESHOLD_MS) {
        replyingRef.current = false

        if (!triggeredRef.current) {
          triggeredRef.current = true
          const finalText = lastTextRef.current
          void api.vts
            .triggerText(finalText)
            .then(res => {
              if (res.success && res.data?.hits?.length) {
                logger.system.info(
                  '[VtsSync] 触发：',
                  res.data.hits.map(h => `${h.kind}:${h.name}`).join(', '),
                )
              }
            })
            .catch(err => logger.system.debug('[VtsSync] 触发标签失败：', err))
        }
      }
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])
}
