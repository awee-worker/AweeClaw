import { safeIpcHandle } from './ipcGuard'
import { channelService } from '../modules/messaging'
import { channelBridge } from '../modules/messaging/MessageBridge'
import { weixinChannelPlugin } from '../modules/messaging/adapters/weixin'
import type { ChannelAccountConfig, OutboundMessage } from '@shared/protocols/channel'
import type { BrowserWindow } from 'electron'
import type Store from 'electron-store'

export function registerChannelHandlers(getMainWindow?: () => BrowserWindow | null, configStore?: Store<Record<string, unknown>>): void {
  if (getMainWindow) {
    channelBridge.init(getMainWindow, configStore)
  }

  safeIpcHandle('channel:initialize', async () => {
    await channelService.init()
    return { success: true }
  })

  safeIpcHandle('channel:shutdown', async () => {
    await channelService.shutdown()
    return { success: true }
  })

  safeIpcHandle('channel:getRegisteredChannels', async () => {
    const channels = channelService.getRegisteredChannels()
    return { success: true, channels }
  })

  safeIpcHandle('channel:getSecretSchema', async (_, channelId: string) => {
    const schema = channelService.getChannelSecretSchema(channelId as any)
    return { success: true, schema }
  })

  safeIpcHandle('channel:validateCredentials', async (_, channelId: string, credentials: Record<string, string>) => {
    const result = await channelService.validateCredentials(channelId as any, credentials)
    return { success: true, ...result }
  })

  safeIpcHandle('channel:addAccount', async (_, channelId: string, account: ChannelAccountConfig) => {
    await channelService.addAccount(channelId as any, account)
    return { success: true }
  })

  safeIpcHandle('channel:removeAccount', async (_, channelId: string, accountId: string) => {
    await channelService.removeAccount(channelId as any, accountId)
    return { success: true }
  })

  safeIpcHandle('channel:updateAccount', async (_, channelId: string, account: ChannelAccountConfig) => {
    await channelService.updateAccount(channelId as any, account)
    return { success: true }
  })

  safeIpcHandle('channel:connectAccount', async (_, channelId: string, accountId: string) => {
    await channelService.connectAccount(channelId as any, accountId)
    return { success: true }
  })

  safeIpcHandle('channel:disconnectAccount', async (_, channelId: string, accountId: string) => {
    await channelService.disconnectAccount(channelId as any, accountId)
    return { success: true }
  })

  safeIpcHandle('channel:sendMessage', async (_, message: OutboundMessage) => {
    const result = await channelService.sendMessage(message)
    return { ...result, delivered: result.success }
  })

  safeIpcHandle('channel:sendReply', async (_, conversationKey: string, text: string, replyToId?: string) => {
    const result = await channelBridge.sendReply(conversationKey, text, replyToId)
    return result
  })

  safeIpcHandle('channel:sendFile', async (_, conversationKey: string, filePath: string, fileName?: string, mediaType?: 'file' | 'image' | 'audio' | 'video', replyToId?: string) => {
    const result = await channelBridge.sendFile(conversationKey, filePath, fileName, mediaType || 'file', replyToId)
    return result
  })

  safeIpcHandle('channel:updateReaction', async (_, accountId: string, messageId: string, status: string) => {
    await channelBridge.updateReaction(accountId, messageId, status as any)
    return { success: true }
  })

  safeIpcHandle('channel:streamReply', async (_, accountId: string, to: string, fullText: string, replyToId?: string) => {
    const result = await channelBridge.streamReply(
      accountId,
      to,
      async (controller: any) => {
        const chunkSize = 20
        for (let i = 0; i < fullText.length; i += chunkSize) {
          const chunk = fullText.slice(i, i + chunkSize)
          await controller.append(chunk)
          await new Promise(r => setTimeout(r, 50))
        }
      },
      replyToId
    )
    return result
  })

  safeIpcHandle('channel:getAccountStatus', async (_, channelId: string, accountId: string) => {
    const status = channelService.getAccountStatus(channelId as any, accountId)
    return { success: true, status }
  })

  safeIpcHandle('channel:getAllAccountStatuses', async () => {
    const statuses = channelService.getAllAccountStatuses()
    return { success: true, statuses }
  })

  safeIpcHandle('channel:getConfig', async (_, channelId: string) => {
    const config = channelService.getConfig(channelId as any)
    return { success: true, config }
  })

  safeIpcHandle('channel:getAllConfigs', async () => {
    const configs = channelService.getAllConfigs()
    return { success: true, configs }
  })

  safeIpcHandle('channel:setChannelEnabled', async (_, channelId: string, enabled: boolean) => {
    channelService.setChannelEnabled(channelId as any, enabled)
    return { success: true }
  })

  safeIpcHandle('channel:getWebhookInfo', async () => {
    const info = channelService.getWebhookInfo()
    return { success: true, ...info }
  })

  // 微信个人号 QR 码登录
  safeIpcHandle('channel:weixin:fetchQRCode', async () => {
    try {
      const result = await weixinChannelPlugin.fetchQRCode()
      return { success: true, ...result }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  safeIpcHandle('channel:weixin:pollQRStatus', async (_, qrcode: string) => {
    try {
      const result = await weixinChannelPlugin.pollQRStatus(qrcode)
      return { success: true, ...result }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })
}
