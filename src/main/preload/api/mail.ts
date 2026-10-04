/**
 * 邮件收件 preload API
 *
 * 封装 mail:* 频道，经 contextBridge 暴露给渲染进程。
 *
 * 频道：
 * - mail:account:test          测试 IMAP 连接
 * - mail:account:test-smtp     测试账户对应的 SMTP 发件（由收件账户推导）
 * - mail:account:set-secret    保存账户凭据（safeStorage 加密）
 * - mail:account:has-secret    查询是否已保存凭据
 * - mail:account:delete-secret 删除账户凭据
 * - mail:sync:account          同步账户（增量收信）
 * - mail:message:list          列出已同步邮件
 * - mail:message:get           读取单封邮件（含正文）
 * - mail:sync-progress         同步进度事件（main→render）
 * - mail:unread-changed        未读总数变化事件（main→render，标记已读 / 同步后触发）
 */

import { invoke, on } from '../ipcHelpers'
import type {
  MailAccountTestParams,
  MailAccountTestResult,
  MailSetSecretParams,
  MailMessageListParams,
  MailMessageGetParams,
  MailMessageSetAiParams,
  MailAttachmentDownloadParams,
  MailAutoOrganizeUpdateParams,
  MailDigestPayload,
  MailMessageMeta,
  MailMessageDetail,
  MailSyncAccountResult,
  MailSyncProgress,
  MailFolderListResult,
  MailDraft,
  MailDraftSaveParams,
  MailOutboxItem,
  MailOutboxRetryParams,
  MailSendParams,
  MailSendResult,
  MailSetFlagsParams,
} from '../../../shared/protocols/mail'

export function createMailApi() {
  return {
    /** 显示邮件中心窗口 */
    showWindow: () => invoke<{ success: boolean }>('mail:window:show')(),

    /** 隐藏邮件中心窗口 */
    hideWindow: () => invoke<{ success: boolean }>('mail:window:hide')(),

    /** 测试 IMAP 连接 */
    accountTest: (params: MailAccountTestParams) =>
      invoke<MailAccountTestResult>('mail:account:test')(params),

    /** 测试账户对应的 SMTP 发件能力（发件服务器由收件账户自动推导） */
    accountTestSmtp: (accountId: string) =>
      invoke<{ success: boolean; error?: string }>('mail:account:test-smtp')(accountId),

    /** 保存账户凭据 */
    accountSetSecret: (params: MailSetSecretParams) =>
      invoke<{ success: boolean; error?: string }>('mail:account:set-secret')(params),

    /** 查询是否已保存凭据 */
    accountHasSecret: (accountId: string) =>
      invoke<{ success: boolean; hasSecret: boolean }>('mail:account:has-secret')(accountId),

    /** 删除账户凭据 */
    accountDeleteSecret: (accountId: string) =>
      invoke<{ success: boolean }>('mail:account:delete-secret')(accountId),

    /** 同步账户 */
    syncAccount: (accountId: string) =>
      invoke<MailSyncAccountResult>('mail:sync:account')(accountId),

    /** 列出已同步邮件 */
    messageList: (params: MailMessageListParams) =>
      invoke<{ success: boolean; messages: MailMessageMeta[] }>('mail:message:list')(params),

    /** 统计未读邮件数（导航角标用） */
    unreadCount: () => invoke<{ success: boolean; count: number }>('mail:unread:count')(),

    /** 读取单封邮件 */
    messageGet: (params: MailMessageGetParams) =>
      invoke<{ success: boolean; data?: MailMessageDetail; error?: string }>('mail:message:get')(params),

    /** 保存邮件的 AI 整理结果 */
    messageSetAi: (params: MailMessageSetAiParams) =>
      invoke<{ success: boolean }>('mail:message:set-ai')(params),

    /** 下载附件（主进程弹出保存对话框） */
    downloadAttachment: (params: MailAttachmentDownloadParams) =>
      invoke<{ success: boolean; path?: string; error?: string }>('mail:attachment:download')(params),

    /** 更新定时自动整理设置 */
    updateAutoOrganize: (params: MailAutoOrganizeUpdateParams) =>
      invoke<{ success: boolean }>('mail:auto-organize:update')(params),

    /** 列出账户在服务器上的文件夹（含已发送/已删除/垃圾邮件识别） */
    folderList: (accountId: string) =>
      invoke<MailFolderListResult>('mail:folder:list')(accountId),

    /** 标记邮件的已读 / 星标状态 */
    messageSetFlags: (params: MailSetFlagsParams) =>
      invoke<{ success: boolean; error?: string }>('mail:message:set-flags')(params),

    /** 发送邮件（发件服务器由账户自动推导） */
    sendMessage: (params: MailSendParams) =>
      invoke<MailSendResult>('mail:send')(params),

    /** 保存草稿 */
    draftSave: (params: MailDraftSaveParams) =>
      invoke<{ success: boolean; draft: MailDraft }>('mail:draft:save')(params),

    /** 列出草稿 */
    draftList: (accountId: string) =>
      invoke<{ success: boolean; drafts: MailDraft[] }>('mail:draft:list')(accountId),

    /** 删除草稿 */
    draftDelete: (id: string) =>
      invoke<{ success: boolean }>('mail:draft:delete')(id),

    /** 列出待重发的发件箱条目 */
    outboxList: (accountId: string) =>
      invoke<{ success: boolean; items: MailOutboxItem[] }>('mail:outbox:list')(accountId),

    /** 重试发送发件箱条目 */
    outboxRetry: (params: MailOutboxRetryParams) =>
      invoke<MailSendResult>('mail:outbox:retry')(params),

    /** 删除发件箱条目 */
    outboxDelete: (id: string) =>
      invoke<{ success: boolean }>('mail:outbox:delete')(id),

    /** 订阅同步进度 */
    onSyncProgress: on<MailSyncProgress>('mail:sync-progress'),

    /** 订阅未读总数变化（已读标记 / 同步后广播，用于导航角标即时刷新） */
    onUnreadChanged: on<{ count: number }>('mail:unread-changed'),

    /** 订阅定时整理完成事件（main→render） */
    onDigestCreated: on<MailDigestPayload>('mail:digest-created'),
  }
}
