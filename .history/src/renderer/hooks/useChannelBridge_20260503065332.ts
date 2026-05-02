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

  const llmConfigRef = useRef(llmConfig)
  const workspacePathRef = useRef(workspacePath)
  useEffect(() => { llmConfigRef.current = llmConfig }, [llmConfig])
  useEffect(() => { workspacePathRef.current = workspacePath }, [workspacePath])

  const handleInboundMessage = useCallback(async (message: InboundChannelMessage) => {
    if (processingMessages.current.has(message.id)) return
    processingMessages.current.add(message.id)

    try {
      const currentLLMConfig = llmConfigRef.current
      const currentWorkspace = workspacePathRef.current

      if (!currentLLMConfig?.apiKey) {
        logger.channel.warn('[ChannelBridge] No API key configured')
        return
      }

      if (message.channelId === 'feishu') {
        await api.channel.updateReaction(message.accountId, message.id, 'thinking')
      }

      const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
      const senderLabel = message.fromName || message.from
      const currentTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const userMessage = `[${channelLabel}] ${senderLabel}: ${message.text}`

      let threadId = channelThreads.current.get(message.conversationKey)

      if (!threadId) {
        const store = useAgentStore.getState()
        const newThreadId = store.createThread({ activate: false })
        if (newThreadId) {
          channelThreads.current.set(message.conversationKey, newThreadId)
          threadId = newThreadId
        }
      }

      if (!threadId) {
        logger.channel.error('[ChannelBridge] Failed to create thread')
        return
      }

      const agentConfig = getAgentConfig()

      const result = await Agent.send(
        userMessage,
        {
          ...currentLLMConfig,
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
                await api.channel.sendReply(message.conversationKey, replyText, message.id)
              }
            } else {
              await api.channel.sendReply(message.conversationKey, replyText, message.id)
            }
          }
        }
      }

      if (message.channelId === 'feishu') {
        await api.channel.updateReaction(message.accountId, message.id, 'done')
      }
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Error: ${err instanceof Error ? err.message : String(err)}`)
      if (message.channelId === 'feishu') {
        await api.channel.updateReaction(message.accountId, message.id, 'error')
      }
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
    const unsubscribe = api.channel.onInboundMessage((message: InboundChannelMessage) => {
      messageQueue.current.push(message)
      processQueue()
    })

    return () => {
      unsubscribe()
    }
  }, [processQueue])
}
