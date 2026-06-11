/**
 * Gateway 进程间通信协议
 *
 * 定义 Electron 客户端与 Gateway 守护进程之间的通信协议。
 *
 * 通信方式：基于 JSON-RPC 2.0 的 Unix Socket / Named Pipe
 *
 * @module gateway/protocol
 */

// ============================================
// 基础协议类型
// ============================================

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: unknown
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

/** JSON-RPC 2.0 错误 */
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

/** JSON-RPC 2.0 通知（无 id，不需要响应） */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

// ============================================
// Gateway 方法名
// ============================================

export const GatewayMethod = {
  // 生命周期
  PING: 'gateway.ping',
  SHUTDOWN: 'gateway.shutdown',
  GET_STATUS: 'gateway.getStatus',

  // Channel 管理
  CHANNEL_LIST: 'channel.list',
  CHANNEL_GET_PLUGIN: 'channel.getPlugin',
  CHANNEL_CONNECT: 'channel.connect',
  CHANNEL_DISCONNECT: 'channel.disconnect',
  CHANNEL_SEND_MESSAGE: 'channel.sendMessage',
  CHANNEL_GET_STATUS: 'channel.getStatus',
  CHANNEL_GET_ALL_STATUS: 'channel.getAllStatus',
  CHANNEL_ADD_ACCOUNT: 'channel.addAccount',
  CHANNEL_REMOVE_ACCOUNT: 'channel.removeAccount',
  CHANNEL_UPDATE_ACCOUNT: 'channel.updateAccount',
  CHANNEL_GET_SECRET_SCHEMA: 'channel.getSecretSchema',
  CHANNEL_VALIDATE_CREDENTIALS: 'channel.validateCredentials',
  CHANNEL_SET_ENABLED: 'channel.setEnabled',
  CHANNEL_GET_CONFIG: 'channel.getConfig',
  CHANNEL_GET_ALL_CONFIGS: 'channel.getAllConfigs',

  // Webhook 管理
  WEBHOOK_GET_INFO: 'webhook.getInfo',
  WEBHOOK_RESTART: 'webhook.restart',
} as const

export type GatewayMethodName = typeof GatewayMethod[keyof typeof GatewayMethod]

// ============================================
// Gateway 通知名（Gateway → Client 推送）
// ============================================

export const GatewayNotification = {
  // 消息事件
  INBOUND_MESSAGE: 'notification.inboundMessage',

  // 连接状态变更
  CONNECTION_STATUS_CHANGED: 'notification.connectionStatusChanged',

  // Channel 事件
  CHANNEL_EVENT: 'notification.channelEvent',

  // Gateway 状态变更
  GATEWAY_STATUS_CHANGED: 'notification.gatewayStatusChanged',

  // 错误通知
  GATEWAY_ERROR: 'notification.gatewayError',
} as const

export type GatewayNotificationName = typeof GatewayNotification[keyof typeof GatewayNotification]

// ============================================
// 请求/响应类型
// ============================================

// --- 生命周期 ---

export interface PingParams {}
export interface PingResult { pong: boolean; uptime: number; version: string }

export interface GetStatusParams {}
export interface GetStatusResult {
  running: boolean
  uptime: number
  channels: { id: string; connected: boolean; accountCount: number }[]
  webhook: { running: boolean; port: number }
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number }
}

// --- Channel 管理 ---

export interface ChannelListParams {}
export interface ChannelListResult { channels: Array<{ id: string; meta: ChannelMetaBrief }> }

export interface ChannelMetaBrief {
  id: string
  label: string
  labelZh: string
  description: string
  descriptionZh: string
  icon: string
  connectionModes: string[]
  capabilities: {
    chatTypes: string[]
    media: boolean
    reactions: boolean
    threads: boolean
    streaming: boolean
  }
}

export interface ChannelConnectParams { channelId: string; accountId: string }
export interface ChannelConnectResult { success: boolean; error?: string }

export interface ChannelDisconnectParams { channelId: string; accountId: string }
export interface ChannelDisconnectResult { success: boolean; error?: string }

export interface ChannelSendMessageParams {
  channelId: string
  accountId: string
  to: string
  content: string
  media?: { type: string; url: string; mimeType?: string }[]
  replyTo?: string
}
export interface ChannelSendMessageResult { success: boolean; messageId?: string; error?: string }

export interface ChannelGetStatusParams { channelId: string; accountId: string }
export interface ChannelGetStatusResult {
  accountId: string
  name: string
  enabled: boolean
  status: string
  connected: boolean
  lastConnectedAt: number | null
  lastError: string | null
}

export interface ChannelGetAllStatusParams {}
export interface ChannelGetAllStatusResult { statuses: ChannelGetStatusResult[] }

export interface ChannelAddAccountParams { channelId: string; account: AccountConfigBrief }
export interface ChannelAddAccountResult { success: boolean; error?: string }

export interface ChannelRemoveAccountParams { channelId: string; accountId: string }
export interface ChannelRemoveAccountResult { success: boolean; error?: string }

export interface ChannelUpdateAccountParams { channelId: string; account: AccountConfigBrief }
export interface ChannelUpdateAccountResult { success: boolean; error?: string }

export interface ChannelGetSecretSchemaParams { channelId: string }
export interface ChannelGetSecretSchemaResult { schema: SecretSchemaBrief[] }

export interface ChannelValidateCredentialsParams { channelId: string; credentials: Record<string, string> }
export interface ChannelValidateCredentialsResult { valid: boolean; error?: string }

export interface ChannelSetEnabledParams { channelId: string; enabled: boolean }
export interface ChannelSetEnabledResult { success: boolean }

export interface ChannelGetConfigParams { channelId: string }
export interface ChannelGetConfigResult { config: ChannelConfigBrief | null }

export interface ChannelGetAllConfigsParams {}
export interface ChannelGetAllConfigsResult { configs: ChannelConfigBrief[] }

// --- Webhook ---

export interface WebhookGetInfoParams {}
export interface WebhookGetInfoResult { running: boolean; port: number; url: string }

export interface WebhookRestartParams {}
export interface WebhookRestartResult { success: boolean; port: number; error?: string }

// ============================================
// 通知类型
// ============================================

export interface InboundMessageNotification {
  channelId: string
  accountId: string
  from: string
  fromName: string
  content: string
  chatType: string
  chatId: string
  messageId: string
  timestamp: number
  media?: { type: string; url: string; mimeType?: string }[]
  replyTo?: string
}

export interface ConnectionStatusNotification {
  channelId: string
  accountId: string
  status: string
  connected: boolean
  error?: string
}

export interface GatewayStatusNotification {
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
  error?: string
}

export interface GatewayErrorNotification {
  code: string
  message: string
  channelId?: string
  accountId?: string
}

// ============================================
// 辅助类型
// ============================================

export interface AccountConfigBrief {
  id: string
  name: string
  enabled: boolean
  credentials: Record<string, string>
  settings?: Record<string, unknown>
}

export interface SecretSchemaBrief {
  key: string
  label: string
  labelZh: string
  description: string
  descriptionZh: string
  type: string
  required: boolean
  placeholder?: string
  secret: boolean
}

export interface ChannelConfigBrief {
  id: string
  enabled: boolean
  accounts: AccountConfigBrief[]
}
