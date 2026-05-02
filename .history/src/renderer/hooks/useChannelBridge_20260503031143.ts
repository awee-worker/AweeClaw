import { useEffect, useRef, useCallback } from 'react'
import { getAPI } from '@renderer/services/electronAPI'
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
  const api = getAPI()
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)
  const channelThreads = useRef(new Map<string, string>())
  const processingMessages = useRef(new Set<string>())

  const handleInboundMessage = useCallback(async (message: InboundChannelMessage) => {
    if (processingMessages.current.has(message.id)) return
    processingMessages.current.add(message.id)

    try {
      const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
      const senderLabel = message.fromName || message.from
      const prefix = `[${channelLabel}]`
      const userMessage = `${prefix} ${senderLabel}: ${message.text}`

      let threadId = channelThreads.current.get(message.conversationKey)

      if (!threadId) {
        const store = useAgentStore.getState()
        const newThreadId = store.createThread()
        if (newThreadId) {
          channelThreads.current.set(message.conversationKey, newThreadId)
          threadId = newThreadId
        }
      }

      if (!threadId) {
        logger.channel.error('Failed to create thread for channel message')
        return
      }

      const agentConfig = getAgentConfig()

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

      const thread = useAgentStore.getState().threads[result.threadId]
      if (thread) {
        const assistantMessages = thread.messages.filter(m => m.role === 'assistant')
        const lastAssistant = assistantMessages[assistantMessages.length - 1]
        if (lastAssistant && typeof lastAssistant.content === 'string') {
          const replyText = lastAssistant.content
            .replace(/^\[.*?\]\s*/m, '')
            .trim()

          if (replyText) {
            await api.channel.sendReply(message.conversationKey, replyText)
            logger.channel.info(`Reply sent to ${message.conversationKey}`)
          }
        }
      }
    } catch (err) {
      logger.channel.error(`Channel bridge error: ${err}`)
    } finally {
      processingMessages.current.delete(message.id)
    }
  }, [api, llmConfig, workspacePath])

  useEffect(() => {
    const unsubscribe = api.channel.onInboundMessage((message: InboundChannelMessage) => {
      handleInboundMessage(message)
    })

    return () => {
      unsubscribe()
    }
  }, [api, handleInboundMessage])
}
