import { useEffect, useRef, useCallback } from 'react'
import { api } from '@renderer/services/electronAPI'
import { Agent } from '@renderer/agent/core/Agent'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { useStore } from '@store'
import { getAgentConfig } from '@renderer/agent/utils/AgentConfig'
import { logger } from '@renderer/utils/Logger'

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

  const processQueue = useCallback(async () => {
    if (isProcessingQueue.current) return
    isProcessingQueue.current = true

    while (messageQueue.current.length > 0) {
      const message = messageQueue.current.shift()!
      await handleInboundMessage(message)
    }

    isProcessingQueue.current = false
  }, [])

  const handleInboundMessage = useCallback(async (message: InboundChannelMessage) => {
    if (processingMessages.current.has(message.id)) return
    processingMessages.current.add(message.id)

    try {
      logger.channel.info(`[ChannelBridge] Processing inbound message from ${message.channelId}: ${message.text?.slice(0, 50)}`)

      if (!llmConfig?.apiKey) {
        logger.channel.warn('[ChannelBridge] No API key configured, cannot process channel message')
        return
      }

      const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
      const senderLabel = message.fromName || message.from
      const userMessage = `[${channelLabel}] ${senderLabel}: ${message.text}`

      let threadId = channelThreads.current.get(message.conversationKey)

      if (!threadId) {
        const store = useAgentStore.getState()
        const newThreadId = store.createThread()
        if (newThreadId) {
          channelThreads.current.set(message.conversationKey, newThreadId)
          threadId = newThreadId
          logger.channel.info(`[ChannelBridge] Created thread ${newThreadId} for ${message.conversationKey}`)
        }
      }

      if (!threadId) {
        logger.channel.error('[ChannelBridge] Failed to create thread for channel message')
        return
      }

      const agentConfig = getAgentConfig()

      logger.channel.info(`[ChannelBridge] Sending to Agent: ${userMessage.slice(0, 80)}`)

      const result = await Agent.send(
        userMessage,
        {
          ...llmConfig,
          contextLimit: agentConfig.maxContextTokens,
        },
        workspacePath,
        'chat',
        {
          customInstructions: `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。请直接回复用户的问题，回复内容将被发送回${channelLabel}平台。回复时不需要包含平台标识和发送者名称，直接给出回答即可。`,
        },
        {
          threadId,
        }
      )

      if (result.threadId) {
        channelThreads.current.set(message.conversationKey, result.threadId)
      }

      logger.channel.info(`[ChannelBridge] Agent response received, extracting reply...`)

      const thread = useAgentStore.getState().threads[result.threadId]
      if (thread) {
        const assistantMessages = thread.messages.filter(m => m.role === 'assistant')
        const lastAssistant = assistantMessages[assistantMessages.length - 1]
        if (lastAssistant && typeof lastAssistant.content === 'string') {
          const replyText = lastAssistant.content
            .replace(/^\[.*?\]\s*/m, '')
            .trim()

          logger.channel.info(`[ChannelBridge] Reply text (${replyText.length} chars): ${replyText.slice(0, 80)}`)

          if (replyText) {
            const replyResult = await api.channel.sendReply(message.conversationKey, replyText)
            logger.channel.info(`[ChannelBridge] Reply sent to ${message.conversationKey}, success=${replyResult.success}`)
            if (!replyResult.success) {
              logger.channel.error(`[ChannelBridge] Reply failed: ${replyResult.error}`)
            }
          }
        } else {
          logger.channel.warn('[ChannelBridge] No assistant message content found after Agent.send')
        }
      }
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      processingMessages.current.delete(message.id)
    }
  }, [llmConfig, workspacePath])

  useEffect(() => {
    logger.channel.info('[ChannelBridge] Hook mounted, listening for inbound messages')
    console.log('[ChannelBridge] Hook mounted, listening for inbound messages')

    const unsubscribe = api.channel.onInboundMessage((message: InboundChannelMessage) => {
      console.log('[ChannelBridge] Received inbound message:', message)
      logger.channel.info(`[ChannelBridge] Received inbound message: ${message.channelId} from ${message.from}`)
      messageQueue.current.push(message)
      processQueue()
    })

    return () => {
      logger.channel.info('[ChannelBridge] Hook unmounted')
      unsubscribe()
    }
  }, [processQueue])
}
