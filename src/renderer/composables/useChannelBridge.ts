import { useEffect, useRef, useCallback } from 'react'
import { api } from '../adapters/electronBridge'
import { Agent } from '@intelligence/engine/IntelligenceCore'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useStore } from '@store'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { logger } from '@toolkit/LogEngine'
import { channelConversationService } from '@intelligence/runtime/channelConversationService'
import { approvalService } from '@intelligence/engine/toolOrchestrator'
import { getEffectiveLLMConfigAsync } from '@services/modelConfigHelper'
import type { ImProcessingStatus } from '@shared/protocols/channel'
import { activeStatuses, emitChange } from './useImProcessingStatus'
import { t, type Language } from '@renderer/i18n'

interface InboundChannelMessage {
  id: string
  channelId: string
  accountId: string
  chatType: string
  from: string
  fromName?: string
  to: string
  text: string
  conversationKey: string
  timestamp: number
}

const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  wechat: '微信',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  dingtalk: '钉钉',
  slack: 'Slack',
}

export function useChannelBridge() {
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)
  const channelThreads = useRef(new Map<string, string>())
  const processingMessages = useRef(new Set<string>())
  const messageQueue = useRef<InboundChannelMessage[]>([])
  const isProcessingQueue = useRef(false)

  const llmConfigRef = useRef(llmConfig)
  const workspacePathRef = useRef(workspacePath)
  useEffect(() => { llmConfigRef.current = llmConfig }, [llmConfig])
  useEffect(() => { workspacePathRef.current = workspacePath }, [workspacePath])

  const handleInboundMessage = useCallback(async (message: InboundChannelMessage) => {
    if (processingMessages.current.has(message.id)) return
    processingMessages.current.add(message.id)

    const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
    const senderLabel = message.fromName || message.from

    const updateImStatus = (phase: ImProcessingStatus['phase']) => {
      if (phase === 'done' || phase === 'error') {
        activeStatuses.delete(message.id)
      } else {
        activeStatuses.set(message.id, {
          messageId: message.id,
          channelId: message.channelId as any,
          accountId: message.accountId,
          channelLabel,
          senderName: senderLabel,
          phase,
          timestamp: Date.now(),
        })
      }
      emitChange()
    }

    try {
      const currentLLMConfig = llmConfigRef.current
      const currentWorkspace = workspacePathRef.current

      // 渠道消息直接使用客户端当前的 LLM 配置（和桌面端聊天完全一致）
      // 云端模式 → 走后端代理（accessToken 鉴权，后端从 registry 查找 API key）
      // 自定义模式 → 直接用本地 apiKey 调 LLM
      const effectiveLLMConfig = await getEffectiveLLMConfigAsync(currentLLMConfig)

      logger.channel.info('[ChannelBridge] Resolved LLM config for inbound message:', {
        channelId: message.channelId,
        accountId: message.accountId,
        effectiveProvider: effectiveLLMConfig.provider,
        effectiveModel: effectiveLLMConfig.model,
        effectiveCloudMode: effectiveLLMConfig.cloudMode ?? false,
        hasApiKey: !!effectiveLLMConfig.apiKey,
      })

      if (!effectiveLLMConfig.cloudMode && !effectiveLLMConfig.apiKey) {
        logger.channel.error('[ChannelBridge] No API key and no cloud mode available for channel reply:', {
          provider: effectiveLLMConfig.provider,
          model: effectiveLLMConfig.model,
        })
        // 渠道消息不应将客户端内部认证状态暴露给外部用户
        // 不发送任何包含"登录过期"、"请重新登录"等客户端专属提示到外部渠道
        // 但需要给渠道用户一个回复，避免用户认为消息没收到
        try {
          const { language } = useStore.getState()
          const fallbackText = t('app.serviceunavailable', language as Language)
          await api.channel.sendReply(message.conversationKey, fallbackText, message.id)
        } catch (replyErr) {
          logger.channel.error('[ChannelBridge] Failed to send fallback reply:', replyErr)
        }
        updateImStatus('error')
        return
      }

      updateImStatus('thinking')

      // 异步更新飞书 reaction（不阻塞消息处理）
      if (message.channelId === 'feishu') {
        api.channel.updateReaction(message.accountId, message.id, 'thinking').catch(() => {})
      }
      const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const userMessage = `[${channelLabel}] ${senderLabel}: ${message.text}`

      let threadId = channelThreads.current.get(message.conversationKey)

      if (!threadId) {
        const store = useAgentStore.getState()
        const newThreadId = store.createThread({ activate: false })
        if (newThreadId) {
          channelThreads.current.set(message.conversationKey, newThreadId)
          channelConversationService.register(newThreadId, message.conversationKey)
          threadId = newThreadId
        }
      }

      if (!threadId) {
        logger.channel.error('[ChannelBridge] Failed to create thread')
        return
      }

      const agentConfig = getAgentConfig()

      updateImStatus('replying')

      const autoApproveInterval = setInterval(() => {
        const thread = useAgentStore.getState().threads[threadId!]
        if (thread?.streamState?.phase === 'tool_pending') {
          const requestId = thread.streamState.requestId || thread.executionMeta?.requestId
          const pendingToolCalls = thread.streamState.pendingApprovalToolCalls
          if (requestId && pendingToolCalls && pendingToolCalls.length > 0) {
            for (const tc of pendingToolCalls) {
              approvalService.approve(`${requestId}_${tc.id}`)
            }
          } else if (requestId) {
            approvalService.approve(requestId)
          }
        }
      }, 500)

      try {
        const result = await Agent.send(
          userMessage,
          {
            ...effectiveLLMConfig,
            contextLimit: agentConfig.maxContextTokens,
          },
          currentWorkspace,
          'agent',
          {
            customInstructions: `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。你可以使用所有可用工具来帮助用户完成任务，包括创建文件、执行命令等。回复内容将被发送回${channelLabel}平台，回复时不需要包含平台标识和发送者名称，直接给出回答即可。如果执行了工具操作，请简要说明执行结果。

重要：当前时间是 ${currentTime}（系统真实时间），涉及时间判断时必须以此为准，不要使用训练数据中的过时时间。`,
          },
          {
            threadId,
            isChannel: true,
          }
        )

        if (result.threadId) {
          channelThreads.current.set(message.conversationKey, result.threadId)
          channelConversationService.register(result.threadId, message.conversationKey)
        }

        const thread = useAgentStore.getState().threads[result.threadId]
        if (thread) {
          const assistantMessages = thread.messages.filter(m => m.role === 'assistant')
          const lastAssistant = assistantMessages[assistantMessages.length - 1]
          if (lastAssistant && typeof lastAssistant.content === 'string') {
            const replyText = lastAssistant.content.trim()

            if (replyText) {
              if (message.channelId === 'feishu') {
                try {
                  await api.channel.streamReply(
                    message.accountId,
                    message.chatType === 'group' ? message.to : message.from,
                    replyText,
                    message.id
                  )
                } catch {
                  const result = await api.channel.sendReply(message.conversationKey, replyText, message.id)
                  if (!result?.success) {
                    logger.channel.error(`[ChannelBridge] sendReply failed: ${result?.error}`)
                  }
                }
              } else {
                const result = await api.channel.sendReply(message.conversationKey, replyText, message.id)
                if (!result?.success) {
                  logger.channel.error(`[ChannelBridge] sendReply failed for ${message.channelId}: ${result?.error}`)
                }
              }
            }
          }

          // 渠道消息兜底：当 AI 回复为空时（如认证错误导致循环中断），发送通用提示
          const hasReply = thread.messages.some(
            m => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()
          )
          if (!hasReply) {
            const { language } = useStore.getState()
            const fallbackText = t('app.serviceunavailable', language as Language)
            await api.channel.sendReply(message.conversationKey, fallbackText, message.id)
          }
        }

        if (message.channelId === 'feishu') {
          api.channel.updateReaction(message.accountId, message.id, 'done').catch(() => {})
        }

        updateImStatus('done')

        // 如果用户处于 cloud mode，刷新配额信息
        const { cloudMode: storeCloudMode, fetchQuota } = useStore.getState()
        if (storeCloudMode === 'cloud') {
          fetchQuota().catch(() => {})
        }
      } finally {
        clearInterval(autoApproveInterval)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[ChannelBridge] Error: ${errMsg}`)
      if (message.channelId === 'feishu') {
        api.channel.updateReaction(message.accountId, message.id, 'error').catch(() => {})
      }
      // 渠道消息：不将客户端内部错误（如认证过期、API Key无效等）暴露给外部渠道用户
      // 仅发送通用提示，避免泄露客户端状态信息
      const isClientInternalError = /登录|认证|auth|token|api.?key|session|expired|401|403/i.test(errMsg)
      try {
        const { language } = useStore.getState()
        const replyText = isClientInternalError
          ? t('app.serviceunavailable', language as Language)
          : (errMsg || t('app.anerroroccurred', language as Language))
        await api.channel.sendReply(message.conversationKey, replyText, message.id)
      } catch (e) { logger.channel.warn('Failed to send IM reply:', e) }
    } finally {
      processingMessages.current.delete(message.id)
    }
  }, [])

  const processQueue = useCallback(async () => {
    if (isProcessingQueue.current) return
    isProcessingQueue.current = true

    while (messageQueue.current.length > 0) {
      const message = messageQueue.current.shift()!
      await handleInboundMessage(message)
    }

    isProcessingQueue.current = false
  }, [handleInboundMessage])

  useEffect(() => {
    logger.channel.info('[ChannelBridge] Registering inbound message listener')
    const unsubscribe = api.channel.onInboundMessage((message: InboundChannelMessage) => {
      logger.channel.info(`[ChannelBridge] Received inbound message from IPC: channelId=${message.channelId}, from=${message.from}, text=${message.text?.substring(0, 50)}`)
      messageQueue.current.push(message)
      processQueue()
    })

    return () => {
      unsubscribe()
    }
  }, [processQueue])
}
