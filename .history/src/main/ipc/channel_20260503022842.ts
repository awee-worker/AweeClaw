import { safeIpcHandle } from './safeHandle'
import { channelService } from '../services/channel'
import type { ChannelAccountConfig, OutboundMessage } from '@shared/types/channel'

export function registerChannelHandlers(): void {
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
}
