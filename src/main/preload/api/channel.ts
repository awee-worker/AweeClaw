/**
 * 多渠道通信 / Agent 路由 / 邮件 API
 *
 * 覆盖 IPC 频道：
 * - channel:*  IM 渠道（企微 / 微信 / 飞书等）账号管理 / 消息收发
 * - agent:*    Agent 与渠道绑定 / DM 配对 / 实例查询
 * - email:*    SMTP 邮件测试与发送
 */
import { invoke, on } from '../ipcHelpers'

export function createChannelApi() {
  return {
    // ── 渠道生命周期 ──
    channelInitialize: invoke('channel:initialize'),
    channelShutdown: invoke('channel:shutdown'),
    channelGetRegisteredChannels: invoke('channel:getRegisteredChannels'),

    // ── 账号管理 ──
    channelGetSecretSchema: (channelId: string) =>
      invoke('channel:getSecretSchema')(channelId),
    channelValidateCredentials: (channelId: string, credentials: Record<string, string>) =>
      invoke('channel:validateCredentials')(channelId, credentials),
    channelAddAccount: (channelId: string, account: unknown) =>
      invoke('channel:addAccount')(channelId, account),
    channelRemoveAccount: (channelId: string, accountId: string) =>
      invoke('channel:removeAccount')(channelId, accountId),
    channelUpdateAccount: (channelId: string, account: unknown) =>
      invoke('channel:updateAccount')(channelId, account),
    channelConnectAccount: (channelId: string, accountId: string) =>
      invoke('channel:connectAccount')(channelId, accountId),
    channelDisconnectAccount: (channelId: string, accountId: string) =>
      invoke('channel:disconnectAccount')(channelId, accountId),
    channelGetAccountStatus: (channelId: string, accountId: string) =>
      invoke('channel:getAccountStatus')(channelId, accountId),
    channelGetAllAccountStatuses: invoke('channel:getAllAccountStatuses'),

    // ── 消息收发 ──
    channelSendMessage: (message: unknown) => invoke('channel:sendMessage')(message),
    channelSendReply: (
      conversationKey: string,
      text: string,
      replyToId?: string,
    ) => invoke('channel:sendReply')(conversationKey, text, replyToId),
    channelSendFile: (
      conversationKey: string,
      filePath: string,
      fileName?: string,
      mediaType?: 'file' | 'image' | 'audio' | 'video',
      replyToId?: string,
    ) =>
      invoke('channel:sendFile')(
        conversationKey,
        filePath,
        fileName,
        mediaType,
        replyToId,
      ),
    channelUpdateReaction: (accountId: string, messageId: string, status: string) =>
      invoke('channel:updateReaction')(accountId, messageId, status),
    channelStreamReply: (
      accountId: string,
      to: string,
      fullText: string,
      replyToId?: string,
    ) => invoke('channel:streamReply')(accountId, to, fullText, replyToId),
    channelRendererReply: (messageId: string, replyText: string) =>
      invoke('channel:rendererReply')(messageId, replyText),

    // ── 配置 ──
    channelGetConfig: (channelId: string) => invoke('channel:getConfig')(channelId),
    channelGetAllConfigs: invoke('channel:getAllConfigs'),
    channelSetChannelEnabled: (channelId: string, enabled: boolean) =>
      invoke('channel:setChannelEnabled')(channelId, enabled),
    channelGetWebhookInfo: invoke('channel:getWebhookInfo'),

    // ── 扫码登录（通用，支持所有声明了 qrLogin 能力的渠道） ──
    channelFetchQRCode: (channelId: string) =>
      invoke('channel:fetchQRCode')(channelId),
    channelPollQRStatus: (channelId: string, qrcode: string) =>
      invoke('channel:pollQRStatus')(channelId, qrcode),

    // ── 渠道事件订阅 ──
    onChannelMessage: on<unknown>('channel:message'),
    onChannelInboundMessage: on<unknown>('channel:inboundMessage'),
    onChannelStatusChange: on<unknown>('channel:statusChange'),
    onChannelImProcessingStatus: on<unknown>('channel:imProcessingStatus'),

    // ── Agent 路由与隔离 ──
    agentAddBinding: (binding: unknown) => invoke('agent:addBinding')(binding),
    agentRemoveBinding: (bindingId: string) => invoke('agent:removeBinding')(bindingId),
    agentGetBindings: (agentId?: string) => invoke('agent:getBindings')(agentId),
    agentGetBindingsForChannel: (channelId: string, accountId: string) =>
      invoke('agent:getBindingsForChannel')(channelId, accountId),
    agentSetDmPairing: (
      channelId: string,
      accountId: string,
      userId: string,
      agentId: string,
    ) => invoke('agent:setDmPairing')(channelId, accountId, userId, agentId),
    agentRemoveDmPairing: (channelId: string, accountId: string, userId: string) =>
      invoke('agent:removeDmPairing')(channelId, accountId, userId),
    agentGetInstances: invoke('agent:getInstances'),
    agentGetInstance: (agentId: string) => invoke('agent:getInstance')(agentId),
    agentGetWorkspace: (agentId: string) => invoke('agent:getWorkspace')(agentId),
    agentGetAuthContext: (agentId: string) => invoke('agent:getAuthContext')(agentId),

    // ── 邮件 ──
    emailTestConnection: (config: {
      host: string
      port: number
      secure: boolean
      user: string
      pass: string
    }) => invoke('email:testConnection')(config),
    emailSend: (params: {
      to: string | string[]
      subject: string
      body: string
      html?: boolean
      cc?: string[]
      bcc?: string[]
      attachments?: Array<{ filename: string; content: string; encoding?: string }>
    }) => invoke('email:send')(params),
  }
}
