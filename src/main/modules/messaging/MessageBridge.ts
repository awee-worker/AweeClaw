import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { channelService } from './MessagingService'
import { SyncService } from '../ai-provider/services/ModelSyncCoordinator'
import { resolveRuntimeLLMConfig } from '@shared/configuration/modelConfigResolver'
import { getBuiltinProvider } from '@shared/configuration/aiProviders'
import { feishuChannelPlugin } from './adapters/FeishuChannelPlugin'
import { wechatChannelPlugin } from './adapters/WechatChannelPlugin'
import type { InboundMessage, OutboundMessage, OutboundMedia, OutboundResult, ImProcessingStatus } from '@shared/protocols/channel'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@protocols'
import type Store from 'electron-store'

const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  wechat: '微信',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  dingtalk: '钉钉',
  slack: 'Slack',
}

const STATUS_EMOJIS: Record<string, string> = {
  received: 'OnIt',
  thinking: 'THINKING',
  tool: 'Fire',
  done: 'THUMBSUP',
  error: 'SCOWL',
}

type ReactionStatus = keyof typeof STATUS_EMOJIS

class ChannelBridge {
  private getMainWindow: (() => BrowserWindow | null) | null = null
  private activeConversations = new Map<string, { channelId: string; accountId: string; from: string; chatType: string; to: string }>()
  private syncService: SyncService
  private configStore: Store<Record<string, unknown>> | null = null
  private messageReactions = new Map<string, { emoji: string; reactionId: string | null }>()
  private activeImStatuses = new Map<string, ImProcessingStatus>()

  constructor() {
    this.syncService = new SyncService()
  }

  private sendImStatus(status: ImProcessingStatus): void {
    if (status.phase === 'done' || status.phase === 'error') {
      this.activeImStatuses.delete(status.messageId)
    } else {
      this.activeImStatuses.set(status.messageId, status)
    }
    const win = this.getMainWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send('channel:imProcessingStatus', status)
    }
  }

  init(getMainWindow: () => BrowserWindow | null, configStore?: Store<Record<string, unknown>>): void {
    this.getMainWindow = getMainWindow
    this.configStore = configStore || null
    channelService.onInboundMessage(msg => this.handleInboundMessage(msg))
    logger.channel.info('[ChannelBridge] Initialized')
  }

  private getLLMConfig(): LLMConfig | null {
    if (!this.configStore) return null
    try {
      const appSettings = this.configStore.get('app-settings') as any
      if (!appSettings) return null
      const llmConfig = resolveRuntimeLLMConfig(appSettings.llmConfig, appSettings.providerConfigs || {})
      if (!llmConfig.apiKey) return null
      return llmConfig
    } catch (err) {
      logger.channel.error(`[ChannelBridge] Failed to resolve LLM config: ${err}`)
      return null
    }
  }

  private resolveAccountLLMConfig(channelId: string, accountId: string): LLMConfig | null {
    const globalConfig = this.getLLMConfig()
    if (!globalConfig) return null
    try {
      const configs = channelService.getAllConfigs()
      const channelConfig = configs.find(c => c.id === channelId)
      const account = channelConfig?.accounts.find(a => a.id === accountId)
      if (account?.llmConfig?.useGlobal === false && account.llmConfig.provider && account.llmConfig.model) {
        const providerId = account.llmConfig.provider
        const builtin = getBuiltinProvider(providerId)
        let providerConfig: any = null
        if (this.configStore) {
          const appSettings = this.configStore.get('app-settings') as any
          providerConfig = appSettings?.providerConfigs?.[providerId]
        }
        return {
          ...globalConfig,
          provider: providerId,
          model: account.llmConfig.model,
          apiKey: providerConfig?.apiKey || (globalConfig.provider === providerId ? globalConfig.apiKey : ''),
          baseUrl: providerConfig?.baseUrl || builtin?.baseUrl || globalConfig.baseUrl,
          protocol: builtin?.protocol || providerConfig?.protocol || globalConfig.protocol,
          headers: providerConfig?.headers || globalConfig.headers,
        }
      }
    } catch {}
    return globalConfig
  }

  private async handleInboundMessage(message: InboundMessage): Promise<void> {
    const conversationKey = `${message.channelId}:${message.chatType === 'group' ? message.to : message.from}`
    this.activeConversations.set(conversationKey, {
      channelId: message.channelId,
      accountId: message.accountId,
      from: message.from,
      chatType: message.chatType,
      to: message.to,
    })

    const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
    let senderLabel = message.fromName || message.from

    if (!message.fromName && message.from) {
      try {
        let resolvedName: string | null = null
        if (message.channelId === 'feishu') {
          resolvedName = await feishuChannelPlugin.resolveSenderName(message.accountId, message.from)
        } else if (message.channelId === 'wechat') {
          resolvedName = await wechatChannelPlugin.resolveSenderName(message.accountId, message.from)
        }
        if (resolvedName) {
          senderLabel = resolvedName
          message.fromName = resolvedName
        }
      } catch {}
    }

    this.sendImStatus({
      messageId: message.id,
      channelId: message.channelId,
      accountId: message.accountId,
      channelLabel,
      senderName: senderLabel,
      phase: 'received',
      timestamp: Date.now(),
    })

    if (message.channelId === 'feishu') {
      await this.updateReaction(message.accountId, message.id, 'received')
    }

    const win = this.getMainWindow?.()
    if (win && !win.isDestroyed()) {
      this.sendImStatus({
        messageId: message.id,
        channelId: message.channelId,
        accountId: message.accountId,
        channelLabel,
        senderName: senderLabel,
        phase: 'thinking',
        timestamp: Date.now(),
      })

      win.webContents.send('channel:inboundMessage', {
        id: message.id,
        channelId: message.channelId,
        accountId: message.accountId,
        chatType: message.chatType,
        from: message.from,
        fromName: message.fromName,
        to: message.to,
        text: message.text,
        media: message.media,
        replyToId: message.replyToId,
        threadId: message.threadId,
        timestamp: message.timestamp,
        conversationKey,
      })
      return
    }

    await this.fallbackToMainProcess(message, conversationKey)
  }

  private async fallbackToMainProcess(message: InboundMessage, conversationKey: string): Promise<void> {
    const llmConfig = this.resolveAccountLLMConfig(message.channelId, message.accountId)
    if (!llmConfig) {
      logger.channel.warn('[ChannelBridge] No LLM config, cannot process message')
      const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
      const senderLabel = message.fromName || message.from
      this.sendImStatus({
        messageId: message.id,
        channelId: message.channelId,
        accountId: message.accountId,
        channelLabel,
        senderName: senderLabel,
        phase: 'error',
        timestamp: Date.now(),
      })
      return
    }

    const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
    const senderLabel = message.fromName || message.from

    this.sendImStatus({
      messageId: message.id,
      channelId: message.channelId,
      accountId: message.accountId,
      channelLabel,
      senderName: senderLabel,
      phase: 'thinking',
      timestamp: Date.now(),
    })

    if (message.channelId === 'feishu') {
      await this.updateReaction(message.accountId, message.id, 'thinking')
    }
    const now = new Date()
    const currentDate = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    const currentTime = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

    const systemPrompt = `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。你可以使用 send_file_to_channel 工具向用户发送文件。回复内容将被发送回${channelLabel}平台，回复时不需要包含平台标识和发送者名称，直接给出回答即可。如果执行了工具操作，请简要说明执行结果。

当前时间信息（这是用户系统的真实时间，请以此为准，不要使用你的训练数据中的时间）：
- 日期: ${currentDate} ${weekday}
- 时间: ${currentTime}
- 时区: ${tz}`

    const sendFileTool: ToolDefinition = {
      name: 'send_file_to_channel',
      description: 'Send a file to the current conversation on the messaging channel. Use this when the user asks you to send a file, document, or image.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the local file to send' },
          file_name: { type: 'string', description: 'Display name for the file' },
          media_type: { type: 'string', description: 'Type of media: file, image, audio, or video', enum: ['file', 'image', 'audio', 'video'] },
        },
        required: ['file_path'],
      },
    }

    const messages: LLMMessage[] = [
      { role: 'user', content: message.text },
    ]

    try {
      this.sendImStatus({
        messageId: message.id,
        channelId: message.channelId,
        accountId: message.accountId,
        channelLabel,
        senderName: senderLabel,
        phase: 'replying',
        timestamp: Date.now(),
      })

      const MAX_TOOL_ROUNDS = 5
      let lastReplyText = ''

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await this.syncService.generate({
          config: llmConfig,
          messages,
          systemPrompt,
          tools: [sendFileTool],
        })

        const toolCalls = result.toolCalls

        if (!toolCalls || toolCalls.length === 0) {
          lastReplyText = result.data?.trim() || ''
          break
        }

        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: result.data || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.toolCallId,
            type: 'function' as const,
            function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
          })),
        }
        messages.push(assistantMsg)

        for (const tc of toolCalls) {
          if (tc.toolName === 'send_file_to_channel') {
            const filePath = tc.args.file_path as string
            const fileName = (tc.args.file_name as string) || undefined
            const mediaType = (tc.args.media_type as 'file' | 'image' | 'audio' | 'video') || 'file'
            const toolResult = await this.sendFile(conversationKey, filePath, fileName, mediaType, message.id)
            messages.push({
              role: 'tool',
              content: toolResult.success ? `File sent successfully: ${filePath}` : `Failed to send file: ${toolResult.error}`,
              tool_call_id: tc.toolCallId,
              name: tc.toolName,
            })
          } else {
            messages.push({
              role: 'tool',
              content: `Unknown tool: ${tc.toolName}`,
              tool_call_id: tc.toolCallId,
              name: tc.toolName,
            })
          }
        }
      }

      if (!lastReplyText) {
        logger.channel.warn('[ChannelBridge] LLM returned empty response after tool calls')
        this.sendImStatus({
          messageId: message.id,
          channelId: message.channelId,
          accountId: message.accountId,
          channelLabel,
          senderName: senderLabel,
          phase: 'done',
          timestamp: Date.now(),
        })
        return
      }

      const sendResult = await this.sendReply(conversationKey, lastReplyText, message.id)
      if (sendResult.success) {
        if (message.channelId === 'feishu') {
          await this.updateReaction(message.accountId, message.id, 'done')
        }
        this.sendImStatus({
          messageId: message.id,
          channelId: message.channelId,
          accountId: message.accountId,
          channelLabel,
          senderName: senderLabel,
          phase: 'done',
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      if (message.channelId === 'feishu') {
        await this.updateReaction(message.accountId, message.id, 'error')
      }
      this.sendImStatus({
        messageId: message.id,
        channelId: message.channelId,
        accountId: message.accountId,
        channelLabel,
        senderName: senderLabel,
        phase: 'error',
        timestamp: Date.now(),
      })
      logger.channel.error(`[ChannelBridge] Fallback LLM error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async sendReply(conversationKey: string, text: string, replyToId?: string): Promise<OutboundResult> {
    const conversation = this.activeConversations.get(conversationKey)
    if (!conversation) {
      return { success: false, error: 'No active conversation found for key: ' + conversationKey }
    }

    const outbound: OutboundMessage = {
      channelId: conversation.channelId as any,
      accountId: conversation.accountId,
      to: conversation.chatType === 'group' ? conversation.to : conversation.from,
      text,
      replyToId,
      chatType: conversation.chatType as any,
    }

    try {
      return await channelService.sendMessage(outbound)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[ChannelBridge] Failed to send reply: ${msg}`)
      return { success: false, error: msg }
    }
  }

  async updateReaction(accountId: string, messageId: string, status: ReactionStatus): Promise<void> {
    const prev = this.messageReactions.get(messageId)
    if (prev) {
      await feishuChannelPlugin.removeReaction(accountId, messageId, prev.emoji)
    }
    const emoji = STATUS_EMOJIS[status]
    const reactionId = await feishuChannelPlugin.addReaction(accountId, messageId, emoji)
    this.messageReactions.set(messageId, { emoji, reactionId })
  }

  async streamReply(
    accountId: string,
    to: string,
    producer: (controller: any) => Promise<void>,
    replyToId?: string
  ): Promise<OutboundResult> {
    return feishuChannelPlugin.streamReply(accountId, to, producer, replyToId)
  }

  async sendFile(
    conversationKey: string,
    filePath: string,
    fileName?: string,
    mediaType: 'file' | 'image' | 'audio' | 'video' = 'file',
    replyToId?: string
  ): Promise<OutboundResult> {
    const conversation = this.activeConversations.get(conversationKey)
    if (!conversation) {
      return { success: false, error: 'No active conversation found for key: ' + conversationKey }
    }

    const media: OutboundMedia = {
      type: mediaType,
      localPath: filePath,
      fileName,
    }

    const outbound: OutboundMessage = {
      channelId: conversation.channelId as any,
      accountId: conversation.accountId,
      to: conversation.chatType === 'group' ? conversation.to : conversation.from,
      media: [media],
      replyToId,
      chatType: conversation.chatType as any,
    }

    try {
      return await channelService.sendMessage(outbound)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.channel.error(`[ChannelBridge] Failed to send file: ${msg}`)
      return { success: false, error: msg }
    }
  }
}

export const channelBridge = new ChannelBridge()
