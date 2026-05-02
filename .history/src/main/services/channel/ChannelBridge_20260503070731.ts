import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { channelService } from './ChannelService'
import { SyncService } from '../llm/services/SyncService'
import { resolveRuntimeLLMConfig } from '@shared/config/llmConfigResolver'
import { getBuiltinProvider } from '@shared/config/providers'
import { feishuChannelPlugin } from './adapters/FeishuChannelPlugin'
import type { InboundMessage, OutboundMessage, OutboundResult } from '@shared/types/channel'
import type { LLMConfig, LLMMessage } from '@shared/types'
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
  received: 'EYES',
  thinking: 'THINKING',
  tool: 'FIRE',
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

  constructor() {
    this.syncService = new SyncService()
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
        const builtin = getBuiltinProvider(account.llmConfig.provider)
        return {
          ...globalConfig,
          provider: account.llmConfig.provider,
          model: account.llmConfig.model,
          baseUrl: builtin?.baseUrl || globalConfig.baseUrl,
          protocol: builtin?.protocol || globalConfig.protocol,
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

    if (message.channelId === 'feishu') {
      await this.updateReaction(message.accountId, message.id, 'received')
    }

    const win = this.getMainWindow?.()
    if (win && !win.isDestroyed()) {
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
      return
    }

    if (message.channelId === 'feishu') {
      await this.updateReaction(message.accountId, message.id, 'thinking')
    }

    const channelLabel = CHANNEL_LABELS[message.channelId] || message.channelId
    const senderLabel = message.fromName || message.from
    const now = new Date()
    const currentDate = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    const currentTime = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

    const systemPrompt = `你是一个多渠道消息助手。当前消息来自${channelLabel}平台的用户${senderLabel}。请直接回复用户的问题，回复内容将被发送回${channelLabel}平台。回复时不需要包含平台标识和发送者名称，直接给出回答即可。

当前时间信息（这是用户系统的真实时间，请以此为准，不要使用你的训练数据中的时间）：
- 日期: ${currentDate} ${weekday}
- 时间: ${currentTime}
- 时区: ${tz}`

    const messages: LLMMessage[] = [
      { role: 'user', content: message.text },
    ]

    try {
      const result = await this.syncService.generate({ config: llmConfig, messages, systemPrompt })
      const replyText = result.data?.trim()
      if (!replyText) {
        logger.channel.warn('[ChannelBridge] LLM returned empty response')
        return
      }

      const sendResult = await this.sendReply(conversationKey, replyText, message.id)
      if (sendResult.success && message.channelId === 'feishu') {
        await this.updateReaction(message.accountId, message.id, 'done')
      }
    } catch (err) {
      if (message.channelId === 'feishu') {
        await this.updateReaction(message.accountId, message.id, 'error')
      }
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
}

export const channelBridge = new ChannelBridge()
