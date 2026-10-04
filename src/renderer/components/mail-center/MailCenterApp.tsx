/**
 * 邮件中心主界面
 *
 * 三栏布局：
 * - 左：收件账户与文件夹导航
 * - 中：工具栏（同步 / 进度）+ 邮件列表（虚拟滚动）
 * - 右：邮件阅读器（HTML 消毒渲染）
 *
 * 数据来源：渲染层设置中的 emailConfig.accounts（元信息）+
 * 主进程 mail:* IPC（同步与读取本地缓存）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Inbox,
  RefreshCw,
  Loader2,
  Mail,
  Mail as MailIcon,
  Star,
  Send,
  Upload,
  Trash2,
  ShieldAlert,
  Plus,
  AlertCircle,
  Sparkles,
  FileText,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../../adapters/electronBridge'
import { MailListView } from './MailListView'
import { MailReaderView } from './MailReaderView'
import { MailComposerView, type MailComposerInitial } from './MailComposerView'
import {
  analyzeMail,
  buildDigest,
  metaToDigestInput,
  type MailDigest,
} from '../../composables/mail/mailAi'
import type { EmailAccount } from '@shared/configuration/configTypes'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import type {
  MailAddress,
  MailAttachmentMeta,
  MailDraft,
  MailFolderView,
  MailMessageDetail,
  MailMessageMeta,
  MailOutboxItem,
  MailSyncProgress,
} from '@shared/protocols/mail'

/** 生成简报时纳入的邮件上限（逐封拉正文，需控制耗时） */
const DIGEST_MAIL_LIMIT = 15

/**
 * 左侧导航项
 *
 * folder 指向服务器文件夹别名（由主进程解析为真实路径）；
 * view 指向虚拟视图（未读/星标为本地筛选，草稿/发件箱为本地队列）。
 */
const MAIL_NAV: Array<{
  key: string
  label: string
  labelEn: string
  icon: LucideIcon
  folder?: string
  view?: MailFolderView
}> = [
  { key: 'inbox', label: '收件箱', labelEn: 'Inbox', icon: Inbox, folder: 'inbox' },
  { key: 'unread', label: '未读邮件', labelEn: 'Unread', icon: Mail, view: 'unread' },
  { key: 'flagged', label: '已标星', labelEn: 'Starred', icon: Star, view: 'flagged' },
  { key: 'sent', label: '已发送', labelEn: 'Sent', icon: Send, folder: 'sent' },
  { key: 'drafts', label: '草稿箱', labelEn: 'Drafts', icon: FileText, view: 'drafts' },
  { key: 'outbox', label: '发件箱', labelEn: 'Outbox', icon: Upload, view: 'outbox' },
  { key: 'trash', label: '已删除', labelEn: 'Trash', icon: Trash2, folder: 'trash' },
  { key: 'junk', label: '垃圾邮件', labelEn: 'Junk', icon: ShieldAlert, folder: 'junk' },
]

/** 本地 id（草稿 / 发件箱）→ 稳定整数，用作列表行标识 */
function hashLocalId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return Math.abs(hash)
}

/** 逗号分隔的地址串 → 地址数组（仅列表展示用） */
function parseAddressList(input: string): MailAddress[] {
  return input
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((address) => ({ address }))
}

/** 草稿 → 列表项（复用邮件列表渲染） */
function draftToMeta(draft: MailDraft): MailMessageMeta {
  return {
    uid: hashLocalId(draft.id),
    folder: '__drafts__',
    accountId: draft.accountId,
    subject: draft.subject || '(无主题)',
    from: [{ address: draft.to || '(未填写收件人)' }],
    to: parseAddressList(draft.to),
    date: draft.updatedAt,
    seen: true,
    flagged: false,
    hasAttachments: false,
    attachmentCount: 0,
    size: 0,
    cacheRef: `draft:${draft.id}`,
  }
}

/** 发件箱条目 → 列表项 */
function outboxToMeta(item: MailOutboxItem): MailMessageMeta {
  return {
    uid: hashLocalId(item.id),
    folder: '__outbox__',
    accountId: item.accountId,
    subject: item.subject || '(无主题)',
    from: [{ address: item.to }],
    to: parseAddressList(item.to),
    date: item.createdAt,
    seen: false,
    flagged: false,
    hasAttachments: false,
    attachmentCount: 0,
    size: 0,
    cacheRef: `outbox:${item.id}`,
  }
}

export function MailCenterApp() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const zh = true
  /** 当前导航项 key（见 MAIL_NAV） */
  const [activeNavKey, setActiveNavKey] = useState<string>('inbox')
  /** 写邮件弹层（null 为关闭；草稿与发件箱也复用此面板） */
  const [composer, setComposer] = useState<MailComposerInitial | null>(null)
  const [messages, setMessages] = useState<MailMessageMeta[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<MailMessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // 同步进度只驱动内部状态（列表刷新），不在工具栏展示文案，避免按钮区换行
  const [, setProgress] = useState<MailSyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 左侧导航各项的邮件数量（如「收件箱（78）」） */
  const [navCounts, setNavCounts] = useState<Record<string, number>>({})

  // AI 相关状态
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [digesting, setDigesting] = useState(false)
  const [digest, setDigest] = useState<MailDigest | null>(null)
  const [digestOpen, setDigestOpen] = useState(false)

  // 追踪当前请求，避免快速切换时旧响应覆盖新数据
  const loadSeq = useRef(0)

  // --------------------------------------------
  // 账户加载
  // --------------------------------------------
  const loadAccounts = useCallback(async () => {
    try {
      const appSettings = (await api.settings.get('app-settings')) as
        | { emailConfig?: { accounts?: EmailAccount[] } }
        | undefined
      const list = (appSettings?.emailConfig?.accounts ?? []).filter((a) => a.enabled !== false)
      setAccounts(list)
      setActiveAccountId((current) => {
        if (list.length === 0) return null
        // 保留当前选中账户；若已不存在（被删除）则回退到第一个
        return current && list.some((a) => a.id === current) ? current : list[0].id
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  // 设置中新增/删除收件账户后（app-settings 变化）实时刷新账户列表，
  // 避免邮件中心停留在旧快照上提示「尚未配置收件账户」
  useEffect(() => {
    const unsubscribe = api.settings.onChanged((event) => {
      if (event?.key === 'app-settings') void loadAccounts()
    })
    return unsubscribe
  }, [loadAccounts])

  // --------------------------------------------
  // LLM 配置加载（复用语音上下文缓存）
  // --------------------------------------------
  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    void (async () => {
      try {
        const ctx = await window.electronAPI.floatingAvatar.getVoiceContext()
        if (ctx?.success && ctx.data) {
          setLlmConfig((ctx.data as { llmConfig?: LLMConfig }).llmConfig ?? null)
        }
        unsubscribe = window.electronAPI.floatingAvatar.onVoiceContextUpdated((updated) => {
          const next = updated as { llmConfig?: LLMConfig }
          if (next?.llmConfig) setLlmConfig(next.llmConfig)
        })
      } catch {
        // 语音上下文不可用时不阻塞邮件浏览，仅 AI 功能受限
      }
    })()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])


  // --------------------------------------------
  // 邮件列表加载
  // --------------------------------------------
  const loadMessages = useCallback(async (accountId: string, navKey: string) => {
    const seq = ++loadSeq.current
    const nav = MAIL_NAV.find((n) => n.key === navKey) ?? MAIL_NAV[0]
    setListLoading(true)
    try {
      // 草稿箱 / 发件箱是本地队列，不经过服务器文件夹查询
      if (nav.view === 'drafts') {
        const res = await api.mail.draftList(accountId)
        if (seq !== loadSeq.current) return
        setMessages((res?.drafts ?? []).map(draftToMeta))
        return
      }
      if (nav.view === 'outbox') {
        const res = await api.mail.outboxList(accountId)
        if (seq !== loadSeq.current) return
        setMessages((res?.items ?? []).map(outboxToMeta))
        return
      }
      const result = await api.mail.messageList({ accountId, folder: nav.folder, view: nav.view })
      if (seq !== loadSeq.current) return
      setMessages(result?.success ? result.messages : [])
    } catch (err) {
      if (seq === loadSeq.current) {
        setMessages([])
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      if (seq === loadSeq.current) setListLoading(false)
    }
  }, [])

  /**
   * 统计左侧导航各项的邮件数量
   *
   * 全部读取本地索引（不触发网络），一次并行取回；数量随同步 / 整理 / 标星变化刷新，
   * 用于「收件箱（78）」这类展示。
   */
  const loadNavCounts = useCallback(async (accountId: string) => {
    try {
      const [inbox, unread, flagged, sent, trash, junk, drafts, outbox] = await Promise.all([
        api.mail.messageList({ accountId, folder: 'inbox' }),
        api.mail.messageList({ accountId, view: 'unread' }),
        api.mail.messageList({ accountId, view: 'flagged' }),
        api.mail.messageList({ accountId, folder: 'sent' }),
        api.mail.messageList({ accountId, folder: 'trash' }),
        api.mail.messageList({ accountId, folder: 'junk' }),
        api.mail.draftList(accountId),
        api.mail.outboxList(accountId),
      ])
      setNavCounts({
        inbox: inbox?.messages?.length ?? 0,
        unread: unread?.messages?.length ?? 0,
        flagged: flagged?.messages?.length ?? 0,
        sent: sent?.messages?.length ?? 0,
        trash: trash?.messages?.length ?? 0,
        junk: junk?.messages?.length ?? 0,
        drafts: drafts?.drafts?.length ?? 0,
        outbox: outbox?.items?.length ?? 0,
      })
    } catch {
      // 计数失败不影响邮件浏览
    }
  }, [])

  useEffect(() => {
    if (!activeAccountId) {
      setMessages([])
      return
    }
    setSelectedKey(null)
    setDetail(null)
    void loadMessages(activeAccountId, activeNavKey)
  }, [activeAccountId, activeNavKey, loadMessages])

  // 切换账户时刷新左侧导航数量（与当前文件夹无关，故不随 activeNavKey 触发）
  useEffect(() => {
    if (!activeAccountId) {
      setNavCounts({})
      return
    }
    void loadNavCounts(activeAccountId)
  }, [activeAccountId, loadNavCounts])

  // --------------------------------------------
  // 同步进度订阅
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.mail.onSyncProgress((p) => {
      setProgress(p)
      if (p.accountId === activeAccountId && p.phase === 'done') {
        void loadMessages(activeAccountId, activeNavKey)
        void loadNavCounts(activeAccountId)
      }
    })
    return unsubscribe
  }, [activeAccountId, activeNavKey, loadMessages, loadNavCounts])

  // --------------------------------------------
  // 定时整理完成 → 刷新当前账户列表
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.mail.onDigestCreated(() => {
      if (activeAccountId) {
        void loadMessages(activeAccountId, activeNavKey)
        void loadNavCounts(activeAccountId)
      }
    })
    return unsubscribe
  }, [activeAccountId, activeNavKey, loadMessages, loadNavCounts])

  // --------------------------------------------
  // 交互
  // --------------------------------------------
  const handleSync = useCallback(async () => {
    if (!activeAccountId || syncing) return
    setSyncing(true)
    setError(null)
    setProgress({ accountId: activeAccountId, folder: activeNavKey, fetched: 0, total: 0, phase: 'connecting' })
    try {
      const result = await api.mail.syncAccount(activeAccountId)
      if (!result?.success) {
        setError(result?.error || '同步失败')
      } else {
        await loadMessages(activeAccountId, activeNavKey)
        await loadNavCounts(activeAccountId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
      setProgress(null)
    }
  }, [activeAccountId, activeNavKey, syncing, loadMessages, loadNavCounts])

  const handleSelect = useCallback(
    async (msg: MailMessageMeta) => {
      // 草稿 / 发件箱条目没有服务器正文，直接打开写邮件面板继续编辑或重发
      if (msg.cacheRef?.startsWith('draft:')) {
        const draftId = msg.cacheRef.slice('draft:'.length)
        const res = await api.mail.draftList(msg.accountId)
        const draft = res?.drafts?.find((d) => d.id === draftId)
        if (draft) {
          setComposer({
            accountId: draft.accountId,
            to: draft.to,
            cc: draft.cc,
            subject: draft.subject,
            body: draft.body,
            html: draft.html,
            attachments: draft.attachments,
            draftId: draft.id,
          })
        }
        return
      }
      if (msg.cacheRef?.startsWith('outbox:')) {
        const itemId = msg.cacheRef.slice('outbox:'.length)
        const res = await api.mail.outboxList(msg.accountId)
        const item = res?.items?.find((o) => o.id === itemId)
        if (item) {
          setComposer({
            accountId: item.accountId,
            to: item.to,
            cc: item.cc,
            subject: item.subject,
            body: item.body,
            html: item.html,
            attachments: item.attachments,
            outboxId: item.id,
          })
        }
        return
      }

      setSelectedKey(`${msg.accountId}#${msg.folder}#${msg.uid}`)
      setDetailLoading(true)
      try {
        const result = await api.mail.messageGet({
          accountId: msg.accountId,
          folder: msg.folder,
          uid: msg.uid,
        })
        if (result?.success && result.data) {
          setDetail(result.data)
          // 打开即视为已读：先更新本地列表，再尽力同步服务器标记
          // 打开即视为已读：先更新本地列表，再尽力同步服务器标记
          if (!msg.seen) {
            // 未读视图下已读邮件应立即从列表移除；其余视图只改写已读标记
            setMessages((prev) =>
              activeNavKey === 'unread'
                ? prev.filter(
                    (m) =>
                      !(
                        m.accountId === msg.accountId &&
                        m.folder === msg.folder &&
                        m.uid === msg.uid
                      ),
                  )
                : prev.map((m) =>
                    m.accountId === msg.accountId && m.folder === msg.folder && m.uid === msg.uid
                      ? { ...m, seen: true }
                      : m,
                  ),
            )
            void api.mail
              .messageSetFlags({
                accountId: msg.accountId,
                folder: msg.folder,
                uid: msg.uid,
                seen: true,
              })
              .catch(() => {
                // 离线或服务器拒绝时仅本地生效
              })
            // 未读 / 已标星 / 各文件夹计数均随已读状态变化，刷新左侧导航数量
            void loadNavCounts(msg.accountId)
          }
        } else {
          setDetail(null)
          setError(result?.error || '读取邮件失败')
        }
      } catch (err) {
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setDetailLoading(false)
      }
    },
    [activeNavKey, loadNavCounts],
  )

  /** 切换当前邮件的星标状态（本地先行，服务器尽力同步） */
  const handleToggleFlag = useCallback(async () => {
    if (!detail) return
    const target = detail.meta
    const next = !target.flagged
    setDetail((cur) => (cur ? { ...cur, meta: { ...cur.meta, flagged: next } } : cur))
    setMessages((prev) =>
      prev.map((m) =>
        m.accountId === target.accountId && m.folder === target.folder && m.uid === target.uid
          ? { ...m, flagged: next }
          : m,
      ),
    )
    try {
      await api.mail.messageSetFlags({
        accountId: target.accountId,
        folder: target.folder,
        uid: target.uid,
        flagged: next,
      })
    } catch {
      // 离线或服务器拒绝时仅本地生效
    }
    void loadNavCounts(target.accountId)
  }, [detail, loadNavCounts])

  /** 单封邮件 AI 整理 */
  const handleAnalyze = useCallback(async () => {
    if (!detail || analyzing) return
    if (!llmConfig) {
      setError('未获取到 LLM 配置，请先在主窗口配置模型')
      return
    }
    setAnalyzing(true)
    setError(null)
    try {
      const res = await analyzeMail(llmConfig, {
        subject: detail.meta.subject,
        from: detail.meta.from[0]?.name || detail.meta.from[0]?.address || '',
        date: detail.meta.date,
        text: detail.body?.text || '',
      })
      if (!res.success || !res.result) {
        setError(res.error || 'AI 整理失败')
        return
      }
      const ai = res.result
      const { accountId, folder, uid } = detail.meta
      await api.mail.messageSetAi({ accountId, folder, uid, ai })
      setDetail((cur) => (cur ? { ...cur, meta: { ...cur.meta, ai } } : cur))
      setMessages((prev) =>
        prev.map((m) =>
          m.accountId === accountId && m.folder === folder && m.uid === uid ? { ...m, ai } : m,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }, [detail, analyzing, llmConfig])

  /** 收件箱简报 */
  const handleDigest = useCallback(async () => {
    if (digesting) return
    if (!llmConfig) {
      setError('未获取到 LLM 配置，请先在主窗口配置模型')
      return
    }
    const top = messages.slice(0, DIGEST_MAIL_LIMIT)
    if (top.length === 0) {
      setError('当前文件夹没有可用于生成简报的邮件')
      return
    }
    setDigesting(true)
    setError(null)
    try {
      const inputs = []
      for (const m of top) {
        const r = await api.mail.messageGet({ accountId: m.accountId, folder: m.folder, uid: m.uid })
        inputs.push(metaToDigestInput(m, r?.success ? r.data?.body?.text || '' : ''))
      }
      const res = await buildDigest(llmConfig, inputs)
      if (!res.success || !res.digest) {
        setError(res.error || '简报生成失败')
        return
      }
      setDigest(res.digest)
      setDigestOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDigesting(false)
    }
  }, [messages, digesting, llmConfig])

  /** 下载附件（主进程弹出保存对话框） */
  const handleDownloadAttachment = useCallback(
    async (att: MailAttachmentMeta) => {
      if (!detail) return
      setError(null)
      try {
        const res = await api.mail.downloadAttachment({
          accountId: detail.meta.accountId,
          folder: detail.meta.folder,
          uid: detail.meta.uid,
          filename: att.filename,
        })
        if (!res?.success) setError(res?.error || '附件下载失败')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [detail],
  )


  // --------------------------------------------
  // 阅读器 AI 面板
  // --------------------------------------------
  const aiPanel = (() => {
    if (!detail) return null
    if (analyzing) {
      return (
        <div className="px-6 py-2 border-b border-border/20 flex items-center gap-1.5 text-[11px] text-text-muted">
          <Loader2 className="w-3 h-3 animate-spin" />
          AI 正在整理…
        </div>
      )
    }
    const ai = detail.meta.ai
    if (!ai) return null
    return (
      <div className="px-6 py-3 border-b border-border/20 space-y-2 bg-accent/5 shrink-0">
        <div className="flex items-center gap-2 text-[11px]">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent">{ai.category}</span>
          <span className="text-text-muted">重要度 {ai.importance}/5</span>
        </div>
        <p className="text-xs text-text-primary leading-relaxed">{ai.summary}</p>
        {ai.todos.length > 0 && (
          <div className="space-y-1 pt-1">
            <div className="text-[10px] text-text-muted">待办</div>
            {ai.todos.map((t, i) => (
              <div key={i} className="text-[11px] text-text-secondary flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-accent shrink-0" />
                <span>{t.task}</span>
                {t.dueDate && <span className="text-text-muted shrink-0">{t.dueDate}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  })()


  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  return (
    <div className="w-full h-full flex bg-background text-text-primary overflow-hidden">
      {/* 左侧：账户与文件夹 */}
      <aside className="w-56 shrink-0 border-r border-border/30 flex flex-col overflow-hidden">
        <div className="h-12 px-4 flex items-center gap-2 border-b border-border/30 shrink-0">
          <MailIcon className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold">邮件中心</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {accounts.length === 0 ? (
            <div className="px-4 py-6 text-[11px] text-text-muted leading-relaxed">
              尚未配置收件账户。请前往「设置 → 邮件服务」添加 IMAP 账户。
            </div>
          ) : (
            accounts.map((account) => {
              const isActive = account.id === activeAccountId
              return (
                <div key={account.id} className="mb-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveAccountId(account.id)
                      setActiveNavKey('inbox')
                    }}
                    className={`w-full px-4 py-2 flex items-center gap-2 text-left transition-colors ${
                      isActive ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface/50'
                    }`}
                  >
                    <Inbox className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs truncate">{account.label || account.address}</span>
                  </button>
                  {isActive &&
                    MAIL_NAV.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveNavKey(item.key)}
                        className={`w-full pl-9 pr-4 py-1.5 flex items-center gap-2 text-left text-xs transition-colors ${
                          item.key === activeNavKey
                            ? 'text-accent'
                            : 'text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        <item.icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {zh ? item.label : item.labelEn}
                          {(navCounts[item.key] ?? 0) > 0 ? `（${navCounts[item.key] ?? 0}）` : ''}
                        </span>
                      </button>
                    ))}
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* 中间：工具栏 + 列表 */}
      <section className="w-80 shrink-0 border-r border-border/30 flex flex-col overflow-hidden">
        <div className="h-12 px-3 flex items-center gap-2 border-b border-border/30 shrink-0">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={!activeAccountId || syncing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            同步
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={!detail || analyzing}
            title="对当前邮件生成摘要、分类与待办"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium bg-surface/60 text-text-secondary hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI
          </button>
          <button
            type="button"
            onClick={() => void handleDigest()}
            disabled={messages.length === 0 || digesting}
            title="生成收件箱简报"
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium bg-surface/60 text-text-secondary hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {digesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            简报
          </button>
          <button
            type="button"
            onClick={() => void handleToggleFlag()}
            disabled={!detail}
            title={detail?.meta.flagged ? '取消星标' : '标星'}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium bg-surface/60 text-text-secondary hover:text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Star className={`w-3.5 h-3.5 ${detail?.meta.flagged ? 'fill-amber-400 text-amber-400' : ''}`} />
          </button>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                setComposer({ accountId: activeAccountId ?? '', to: '', subject: '', body: '' })
              }
              disabled={!activeAccountId}
              title="写邮件"
              aria-label="写邮件"
              className="w-8 h-8 flex items-center justify-center rounded-full bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 flex items-start gap-1.5 text-[11px] text-red-400 bg-red-400/10 border-b border-red-400/20">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-all flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="shrink-0">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {listLoading ? (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          <MailListView
            messages={messages}
            selectedKey={selectedKey}
            onSelect={(m) => void handleSelect(m)}
            emptyText={
              !activeAccountId
                ? '请先在设置中添加收件账户'
                : activeNavKey === 'drafts'
                  ? '草稿箱为空'
                  : activeNavKey === 'outbox'
                    ? '发件箱为空'
                    : activeNavKey === 'unread'
                      ? '没有未读邮件'
                      : activeNavKey === 'flagged'
                        ? '没有已标星邮件'
                        : '暂无邮件，点击「同步」从服务器拉取'
            }
          />
        )}
      </section>

      {/* 右侧：阅读器 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <MailReaderView
          detail={detail}
          loading={detailLoading}
          aiPanel={aiPanel}
          onDownloadAttachment={(att) => void handleDownloadAttachment(att)}
        />
      </main>

      {/* 收件箱简报弹层 */}
      {digestOpen && digest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setDigestOpen(false)}
        >
          <div
            className="w-[560px] max-h-[80vh] flex flex-col rounded-xl bg-background border border-border/50 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 px-5 flex items-center justify-between border-b border-border/30 shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold">收件箱简报</span>
              </div>
              <button
                type="button"
                onClick={() => setDigestOpen(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <p className="text-xs text-text-primary leading-relaxed">{digest.overview}</p>

              {digest.highlights.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-text-secondary">重点邮件</div>
                  {digest.highlights.map((h, i) => (
                    <div key={i} className="rounded-lg border border-border/40 bg-surface/40 px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-text-primary truncate">{h.subject || '(无主题)'}</span>
                        <span className="text-[10px] text-accent shrink-0">★{h.importance}</span>
                      </div>
                      <div className="text-[10px] text-text-muted truncate">{h.from}</div>
                      <div className="text-[11px] text-text-secondary leading-relaxed">{h.summary}</div>
                    </div>
                  ))}
                </div>
              )}

              {digest.actionItems.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-text-secondary">待办汇总</div>
                  {digest.actionItems.map((t, i) => (
                    <div key={i} className="text-[11px] text-text-secondary flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-accent shrink-0" />
                      <span>{t.task}</span>
                      {t.dueDate && <span className="text-text-muted shrink-0">{t.dueDate}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 写邮件 / 草稿 / 发件箱 弹层 */}
      {composer && (
        <MailComposerView
          language="zh"
          accounts={accounts}
          initial={composer}
          llmConfig={llmConfig}
          onClose={() => setComposer(null)}
          onDone={() => {
            if (activeAccountId) {
              void loadMessages(activeAccountId, activeNavKey)
              void loadNavCounts(activeAccountId)
            }
          }}
        />
      )}
    </div>
  )
}

export default MailCenterApp
