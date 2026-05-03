export type ChannelId = 'feishu' | 'wechat' | 'whatsapp' | 'telegram' | 'dingtalk' | 'slack'

export type ChatType = 'direct' | 'group' | 'channel'

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ConnectionMode = 'websocket' | 'webhook'

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'

export type GroupPolicy = 'open' | 'allowlist' | 'disabled'

export interface ChannelMeta {
  id: ChannelId
  label: string
  labelZh: string
  description: string
  descriptionZh: string
  icon: string
  connectionModes: ConnectionMode[]
  defaultConnectionMode: ConnectionMode
  capabilities: ChannelCapabilities
  order: number
}

export interface ChannelCapabilities {
  chatTypes: ChatType[]
  media: boolean
  reactions: boolean
  threads: boolean
  edit: boolean
  streaming: boolean
  voice: boolean
  files: boolean
}

export interface ChannelAccountConfig {
  id: string
  name: string
  enabled: boolean
  credentials: Record<string, string>
  connectionMode?: ConnectionMode
  dmPolicy?: DmPolicy
  allowFrom?: string[]
  groupPolicy?: GroupPolicy
  groupAllowFrom?: string[]
  groups?: Record<string, ChannelGroupConfig>
  llmConfig?: ChannelLLMConfig
}

export interface ChannelLLMConfig {
  provider?: string
  model?: string
  useGlobal?: boolean
}

export interface ChannelGroupConfig {
  name?: string
  enabled?: boolean
  requireMention?: boolean
  allowFrom?: string[]
  prompt?: string
}

export interface ChannelConfig {
  id: ChannelId
  enabled: boolean
  defaultAccount?: string
  accounts: ChannelAccountConfig[]
}

export interface InboundMessage {
  id: string
  channelId: ChannelId
  accountId: string
  chatType: ChatType
  from: string
  fromName?: string
  to: string
  text: string
  media?: InboundMedia[]
  replyToId?: string
  threadId?: string
  timestamp: number
  raw?: unknown
}

export interface InboundMedia {
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker'
  url?: string
  localPath?: string
  mimeType?: string
  fileName?: string
  fileSize?: number
}

export interface OutboundMessage {
  channelId: ChannelId
  accountId?: string
  to: string
  text?: string
  media?: OutboundMedia[]
  replyToId?: string
  threadId?: string
  chatType?: ChatType
}

export interface OutboundMedia {
  type: 'image' | 'video' | 'audio' | 'file'
  url?: string
  localPath?: string
  buffer?: Buffer
  mimeType?: string
  fileName?: string
}

export interface OutboundResult {
  success: boolean
  messageId?: string
  error?: string
}

export interface ChannelAccountSnapshot {
  accountId: string
  name?: string
  enabled: boolean
  configured: boolean
  status: ChannelStatus
  connected: boolean
  lastConnectedAt?: number | null
  lastError?: string | null
  dmPolicy?: DmPolicy
  groupPolicy?: GroupPolicy
}

export interface ChannelSecretSchema {
  key: string
  label: string
  labelZh: string
  description: string
  descriptionZh: string
  required: boolean
  secret: boolean
  placeholder?: string
}

export interface ChannelEvent {
  type: 'message' | 'status' | 'error' | 'typing'
  channelId: ChannelId
  accountId: string
  payload: unknown
  timestamp: number
}

export interface ChannelPlugin {
  id: ChannelId
  meta: ChannelMeta
  secretSchema: ChannelSecretSchema[]
  validateCredentials(credentials: Record<string, string>): Promise<{ valid: boolean; error?: string }>
  connect(account: ChannelAccountConfig): Promise<void>
  disconnect(accountId: string): Promise<void>
  sendMessage(message: OutboundMessage): Promise<OutboundResult>
  getStatus(accountId: string): ChannelAccountSnapshot
  onMessage(callback: (message: InboundMessage) => void): void
  onStatusChange(callback: (snapshot: ChannelAccountSnapshot) => void): void
  onEvent(callback: (event: ChannelEvent) => void): void
  destroy(): void
}

export type ImProcessingPhase = 'received' | 'thinking' | 'replying' | 'done' | 'error'

export interface ImProcessingStatus {
  messageId: string
  channelId: ChannelId
  accountId: string
  channelLabel: string
  senderName: string
  phase: ImProcessingPhase
  timestamp: number
}
