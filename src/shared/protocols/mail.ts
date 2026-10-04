/**
 * 邮件收件功能共享类型契约
 *
 * 主进程与渲染进程共用，定义邮件元数据、正文缓存、同步游标、AI 整理结果
 * 以及各 IPC 的 payload / 返回结构。
 *
 * 本文件不得引入 electron / node 专属类型。
 */

// ============================================
// 基础结构
// ============================================

/** 邮件地址条目 */
export interface MailAddress {
  name?: string
  address: string
}

/** 邮件附件元信息 */
export interface MailAttachmentMeta {
  filename: string
  contentType: string
  size: number
  /** 是否为内联资源（cid 引用） */
  inline?: boolean
}

/** 单封邮件的 AI 整理结果 */
export interface MailAiResult {
  /** 一句话摘要 */
  summary: string
  /** 分类标签（如 工作/通知/营销/账单/其他） */
  category: string
  /** 重要度 1-5（5 最高） */
  importance: number
  /** 提取出的待办事项 */
  todos: Array<{ task: string; dueDate?: string }>
  /** 生成时间戳 */
  generatedAt: number
  /** 生成所用模型标识 */
  model?: string
}

// ============================================
// 邮件数据
// ============================================

/** 邮件元数据索引条目 */
export interface MailMessageMeta {
  /** IMAP 唯一序号 */
  uid: number
  folder: string
  accountId: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  /** 邮件时间（ms） */
  date: number
  seen: boolean
  flagged: boolean
  hasAttachments: boolean
  attachmentCount: number
  /** 邮件大小（字节，近似） */
  size: number
  /** 正文/附件缓存引用（相对 maildata 目录） */
  cacheRef?: string
  /** AI 整理结果（懒生成） */
  ai?: MailAiResult
}

/** 缓存的邮件正文 */
export interface MailBodyCache {
  uid: number
  /** 纯文本正文 */
  text: string
  /** 原始 HTML（渲染层负责消毒后展示） */
  html?: string
  attachments: MailAttachmentMeta[]
  cachedAt: number
}

/** 单封邮件完整内容 */
export interface MailMessageDetail {
  meta: MailMessageMeta
  body: MailBodyCache | null
}

/** 单个文件夹的增量同步游标 */
export interface MailFolderCursor {
  uidValidity: number
  lastUid: number
  lastSyncAt: number
}

/** 全量同步状态 */
export type MailSyncState = Record<string, Record<string, MailFolderCursor>>

/** 定时整理：单个账户的汇总 */
export interface MailDigestAccountSummary {
  accountId: string
  label: string
  address: string
  /** 本轮新增邮件数 */
  added: number
  /** 本地索引邮件总数 */
  total: number
  /** 未读邮件数 */
  unread: number
  /** 最新若干封邮件摘要 */
  latest: Array<{ subject: string; date: number; from: string }>
  /** 该账户同步失败时的错误信息 */
  error?: string
}

/** 定时整理：汇总载荷（主进程 → 渲染层广播） */
export interface MailDigestPayload {
  generatedAt: number
  accounts: MailDigestAccountSummary[]
}

/** 定时自动整理设置入参 */
export interface MailAutoOrganizeUpdateParams {
  enabled: boolean
  expression: string
}

/** 同步进度事件 */
export interface MailSyncProgress {
  accountId: string
  folder: string
  fetched: number
  total: number
  phase: 'connecting' | 'fetching' | 'parsing' | 'done' | 'error'
  message?: string
}

// ============================================
// IPC 契约
// ============================================

/** IMAP 连接测试入参 */
export interface MailAccountTestParams {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

/** IMAP 连接测试返回 */
export interface MailAccountTestResult {
  success: boolean
  error?: string
  folders?: string[]
}

/** 保存账户凭据入参 */
export interface MailSetSecretParams {
  accountId: string
  secret: string
}

/**
 * 邮件列表虚拟视图
 *
 * 未读 / 已标星是跨文件夹的本地筛选结果，草稿与发件箱是本地队列，
 * 都不是服务器上的真实文件夹，因此与 folder 区分开。
 */
export type MailFolderView = 'unread' | 'flagged' | 'drafts' | 'outbox'

/** 邮件列表查询入参 */
export interface MailMessageListParams {
  accountId: string
  /** 服务器上的真实文件夹路径；与 view 二选一 */
  folder?: string
  /** 虚拟视图（未读/已标星/草稿箱/发件箱），传入时忽略 folder */
  view?: MailFolderView
}

/** 单封邮件查询入参 */
export interface MailMessageGetParams {
  accountId: string
  folder: string
  uid: number
}

/** 保存 AI 整理结果入参 */
export interface MailMessageSetAiParams {
  accountId: string
  folder: string
  uid: number
  ai: MailAiResult
}

/** 附件下载入参 */
export interface MailAttachmentDownloadParams {
  accountId: string
  folder: string
  uid: number
  filename: string
}

/** 账户同步返回 */
export interface MailSyncAccountResult {
  success: boolean
  accountId: string
  added: number
  scanned: number
  error?: string
}

// ============================================
// 文件夹识别
// ============================================

/**
 * 标准邮箱文件夹别名
 *
 * 各服务商对「已发送 / 草稿 / 已删除 / 垃圾邮件」的命名与层级不一致
 * （Sent / Sent Messages / INBOX.Sent …），IMAP 用 special-use 标记
 * （\Sent \Drafts \Trash \Junk）统一标识，这里映射为稳定别名。
 */
export type MailFolderAlias = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk'

/** 标准文件夹别名 → 服务器真实路径（缺失表示服务器无此文件夹） */
export type MailFolderMap = Partial<Record<MailFolderAlias, string>>

/** 服务器文件夹信息 */
export interface MailFolderInfo {
  /** 服务器上的真实路径（如 INBOX / Sent Messages） */
  path: string
  /** IMAP special-use 归一化后的别名，无法识别时为空 */
  alias?: MailFolderAlias
  /** 展示用名称（路径最后一段，配合别名做本地化） */
  name: string
}

/** 查询账户文件夹列表的返回 */
export interface MailFolderListResult {
  success: boolean
  folders: MailFolderInfo[]
  /** 别名 → 真实路径映射 */
  map: MailFolderMap
  error?: string
}

// ============================================
// 写邮件 / 草稿 / 发件箱
// ============================================

/**
 * 邮件附件
 *
 * 正文内联图与普通附件共用同一结构：带 contentId 的作为 multipart/related
 * 内联资源（正文用 cid:<contentId> 引用），不带 contentId 的作为普通附件。
 */
export interface MailAttachment {
  filename: string
  /** base64 编码的文件内容（不含 data: 前缀） */
  content: string
  encoding?: 'base64'
  /** MIME 类型，如 image/png */
  contentType?: string
  /** 有值时作为正文内联资源 */
  contentId?: string
}

/** 一封可编辑邮件的内容（地址以逗号分隔的字符串传递） */
export interface MailComposePayload {
  to: string
  cc?: string
  subject: string
  body: string
  /** 正文是否按 HTML 发送（默认 false） */
  html?: boolean
  /** 附件（含正文内联图） */
  attachments?: MailAttachment[]
}

/** 本地草稿 */
export interface MailDraft extends MailComposePayload {
  id: string
  accountId: string
  updatedAt: number
}

/** 本地发件箱条目（发送失败待重试） */
export interface MailOutboxItem extends MailComposePayload {
  id: string
  accountId: string
  createdAt: number
  /** 已尝试发送次数 */
  attempts: number
  /** 最近一次失败原因 */
  lastError?: string
}

/** 发送邮件入参 */
export interface MailSendParams extends MailComposePayload {
  accountId: string
  /** 来源草稿 id：发送成功后自动移出草稿箱 */
  draftId?: string
}

/** 发送邮件返回 */
export interface MailSendResult {
  success: boolean
  error?: string
  /** 发送失败时落入发件箱的条目 id（可稍后重试） */
  outboxId?: string
}

/** 保存草稿入参（id 存在为更新，否则新建） */
export interface MailDraftSaveParams extends MailComposePayload {
  accountId: string
  id?: string
}

/** 重试发件箱条目入参 */
export interface MailOutboxRetryParams {
  id: string
}

/** 标记邮件状态入参（已读 / 星标） */
export interface MailSetFlagsParams {
  accountId: string
  folder: string
  uid: number
  seen?: boolean
  flagged?: boolean
}
