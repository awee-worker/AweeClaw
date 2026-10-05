/**
 * 通讯录页面（全屏）
 *
 * 入口：左下角用户菜单「通讯录」。支持联系人增删改查、搜索、关系/星标筛选、
 * 生日提醒与导出。数据存于 useContactStore（SQLite 持久化），与 AI 通过
 * scene_tools_* 读写的为同一数据源。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookUser,
  Plus,
  Search,
  Trash2,
  Star,
  Mail,
  Phone,
  Cake,
  Briefcase,
  MapPin,
  Tag,
  Download,
  Pencil,
  X,
  Check,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '@store'
import { api } from '../../adapters/electronBridge'
import { useContactStore, type ContactItem } from '../scene-tools/stores'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { t, type Language } from '@renderer/i18n'
import { MailComposerView, type MailComposerInitial } from '../mail-center/MailComposerView'
import type { EmailAccount } from '@shared/configuration/configTypes'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import { ContactForm, type ContactDraft } from './ContactForm'
import {
  RELATION_OPTIONS,
  GENDER_LABELS,
  relationStyle,
  contactInitial,
  daysUntilBirthday,
  isBirthdaySoon,
  exportContactsJson,
} from './contactUtils'

/** macOS 平台判定：无边框窗口下左上角交通灯占据顶部左侧，返回按钮需要让位 */
const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

type Mode = 'view' | 'create' | 'edit'

export default function ContactsPage() {
  const items = useContactStore((s) => s.items)
  const add = useContactStore((s) => s.add)
  const update = useContactStore((s) => s.update)
  const remove = useContactStore((s) => s.remove)
  const setShowContactsPage = useStore((s) => s.setShowContactsPage)
  const language = useStore((s) => s.language) as Language
  const zh = language === 'zh'

  const [keyword, setKeyword] = useState('')
  const [relationFilter, setRelationFilter] = useState('全部')
  const [starOnly, setStarOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('view')

  /** 写邮件弹层：留在通讯录内撰写，不跳转邮件中心 */
  const [mailCompose, setMailCompose] = useState<MailComposerInitial | null>(null)
  /** 邮件账户与当前会话模型，供写邮件面板选择发件账户 / AI 帮写 */
  const [mailAccounts, setMailAccounts] = useState<EmailAccount[]>([])
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null)

  // 邮件账户与模型配置按需加载：仅服务于通讯录内直接发邮件
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const appSettings = (await api.settings.get('app-settings')) as
          | { emailConfig?: { accounts?: EmailAccount[] } }
          | undefined
        if (cancelled) return
        setMailAccounts(
          (appSettings?.emailConfig?.accounts ?? []).filter((a) => a.enabled !== false),
        )
      } catch {
        // 账户读取失败：写邮件面板会提示未配置账户
      }
      try {
        const ctx = await window.electronAPI.floatingAvatar.getVoiceContext()
        if (!cancelled && ctx?.success && ctx.data) {
          setLlmConfig((ctx.data as { llmConfig?: LLMConfig }).llmConfig ?? null)
        }
      } catch {
        // 模型配置不可用：仅 AI 帮写不可用，不影响正常发送
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const relations = useMemo(() => {
    const set = new Set<string>(RELATION_OPTIONS as readonly string[])
    items.forEach((i) => i.relation && set.add(i.relation))
    return ['全部', ...Array.from(set)]
  }, [items])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list = items.filter((i) => {
      if (relationFilter !== '全部' && (i.relation || '') !== relationFilter) return false
      if (starOnly && !((i.star ?? 0) > 0)) return false
      if (!kw) return true
      return [i.name, i.phone, i.email, i.company, i.address, i.relation, ...(i.tags ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(kw))
    })
    return list.sort((a, b) => (b.star ?? 0) - (a.star ?? 0) || a.name.localeCompare(b.name, 'zh'))
  }, [items, keyword, relationFilter, starOnly])

  const birthdaySoon = useMemo(() => items.filter((i) => isBirthdaySoon(i.birthday, 7)), [items])

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setMode('view')
  }

  const handleCreate = (values: ContactDraft) => {
    const created = add(values)
    setSelectedId(created.id)
    setMode('view')
  }

  const handleUpdate = (values: ContactDraft) => {
    if (!selected) return
    update(selected.id, { ...values, updatedAt: Date.now() })
    setMode('view')
  }

  const handleDelete = async (contact: ContactItem) => {
    const ok = await globalConfirm({
      title: zh ? '删除联系人' : 'Delete contact',
      message: zh
        ? `确定删除「${contact.name}」吗？此操作不可撤销。`
        : `Delete "${contact.name}"? This cannot be undone.`,
      confirmText: zh ? '删除' : 'Delete',
      cancelText: zh ? '取消' : 'Cancel',
      variant: 'danger',
    })
    if (ok === true) {
      remove(contact.id)
      setSelectedId(null)
      setMode('view')
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* 顶栏 */}
      <header
        className={`flex items-center gap-3 py-3 pr-5 border-b border-border/40 shrink-0 ${isMac ? 'pl-[100px]' : 'pl-5'}`}
      >
        <button
          onClick={() => setShowContactsPage(false)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-all"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          <span>{zh ? '返回' : 'Back'}</span>
        </button>
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{
            background:
              'linear-gradient(135deg, rgb(var(--accent)) 0%, color-mix(in srgb, rgb(var(--accent)) 60%, #ffffff 40%) 100%)',
          }}
        >
          <BookUser className="w-[17px] h-[17px]" strokeWidth={2} />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-text-primary">
              {t('layout.contacts', language)}
            </span>
            <span className="text-[12px] text-text-muted/70">
              {items.length} {zh ? '人' : 'contacts'}
            </span>
          </div>
          {birthdaySoon.length > 0 && (
            <span className="text-[11px] text-amber-500 flex items-center gap-1">
              <Cake className="w-3 h-3" strokeWidth={1.8} />
              {zh ? `近 7 天 ${birthdaySoon.length} 人生日` : `${birthdaySoon.length} upcoming birthdays`}
            </span>
          )}
        </div>
        <div className="flex-1" />
        {items.length > 0 && (
          <button
            onClick={() => exportContactsJson(items)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] text-text-secondary border border-border/50 hover:bg-surface-hover transition-colors"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
            <span>{zh ? '导出' : 'Export'}</span>
          </button>
        )}
        <button
          onClick={() => {
            setMode('create')
            setSelectedId(null)
          }}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-white transition-colors"
          style={{ background: 'rgb(var(--accent))' }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.2} />
          <span>{zh ? '添加联系人' : 'Add contact'}</span>
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 左栏：搜索 + 筛选 + 列表 */}
        <aside className="w-[300px] shrink-0 border-r border-border/40 flex flex-col min-h-0">
          <div className="p-3 space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" strokeWidth={1.8} />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={zh ? '搜索姓名 / 手机 / 公司 / 标签' : 'Search name / phone / company / tags'}
                className="w-full h-8 pl-8 pr-7 rounded-lg bg-surface/60 border border-border/50 text-[13px] text-text-primary outline-none focus:border-accent/60 transition-colors"
              />
              {keyword && (
                <button
                  onClick={() => setKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-text-muted" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {relations.map((r) => (
                <button
                  key={r}
                  onClick={() => setRelationFilter(r)}
                  className={`px-2 h-6 rounded-md text-[12px] transition-colors ${
                    relationFilter === r
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-muted hover:bg-text-primary/[0.06]'
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => setStarOnly((v) => !v)}
                title={zh ? '只看星标' : 'Starred only'}
                className={`px-2 h-6 rounded-md text-[12px] flex items-center gap-0.5 transition-colors ${
                  starOnly ? 'bg-amber-500/15 text-amber-500' : 'text-text-muted hover:bg-text-primary/[0.06]'
                }`}
              >
                <Star className="w-3 h-3" fill={starOnly ? 'currentColor' : 'none'} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-3">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-text-muted/50">
                <BookUser className="w-7 h-7" strokeWidth={1.5} />
                <span className="text-[12px]">
                  {items.length === 0
                    ? zh
                      ? '还没有联系人，点击右上角添加'
                      : 'No contacts yet'
                    : zh
                      ? '没有匹配的联系人'
                      : 'No matching contacts'}
                </span>
              </div>
            ) : (
              filtered.map((c) => (
                <ContactRow key={c.id} contact={c} active={c.id === selectedId} onClick={() => handleSelect(c.id)} />
              ))
            )}
          </div>
        </aside>

        {/* 右栏：详情 / 表单 */}
        <section className="flex-1 min-w-0 flex flex-col min-h-0">
          {mode === 'create' && (
            <ContactForm
              submitLabel={zh ? '添加' : 'Add'}
              onSubmit={handleCreate}
              onCancel={() => setMode('view')}
            />
          )}
          {mode === 'edit' && selected && (
            <ContactForm
              initial={selected}
              submitLabel={zh ? '保存' : 'Save'}
              onSubmit={handleUpdate}
              onCancel={() => setMode('view')}
            />
          )}
          {mode === 'view' && selected && (
            <ContactDetail
              contact={selected}
              language={language}
              onEdit={() => setMode('edit')}
              onDelete={() => handleDelete(selected)}
              onSendMail={() => {
                if (!selected.email) return
                setMailCompose({
                  // 账户列表尚未就绪时留空，由写邮件面板在账户到位后回落
                  accountId: mailAccounts[0]?.id ?? '',
                  to: selected.email,
                  subject: '',
                  body: '',
                })
              }}
            />
          )}
          {mode === 'view' && !selected && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted/50">
              <BookUser className="w-10 h-10" strokeWidth={1.2} />
              <span className="text-[13px]">
                {zh ? '从左侧选择联系人查看详情，或点击右上角添加' : 'Select a contact to view details'}
              </span>
            </div>
          )}
        </section>
      </div>

      {/* 写邮件弹层：留在通讯录内撰写，发送 / 存草稿后由面板自身关闭 */}
      {mailCompose && (
        <MailComposerView
          language={language}
          accounts={mailAccounts}
          initial={mailCompose}
          llmConfig={llmConfig}
          onClose={() => setMailCompose(null)}
          onDone={() => {}}
        />
      )}
    </div>
  )
}

function ContactRow({
  contact,
  active,
  onClick,
}: {
  contact: ContactItem
  active: boolean
  onClick: () => void
}) {
  const style = relationStyle(contact.relation)
  const bday = isBirthdaySoon(contact.birthday)
  const star = contact.star ?? 0
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
        active ? 'bg-accent/10' : 'hover:bg-text-primary/[0.05]'
      }`}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0"
        style={{ background: style.bg, color: style.color }}
      >
        {contactInitial(contact.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-text-primary truncate">{contact.name}</span>
          {bday && <Cake className="w-3 h-3 text-amber-500 shrink-0" strokeWidth={1.8} />}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {contact.phone}
          {contact.relation ? ` · ${contact.relation}` : ''}
        </div>
      </div>
      {star > 0 && (
        <div className="flex shrink-0">
          {Array.from({ length: star }).map((_, i) => (
            <Star key={i} className="w-2.5 h-2.5" style={{ color: '#F59E0B' }} fill="#F59E0B" />
          ))}
        </div>
      )}
    </button>
  )
}

function ContactDetail({
  contact,
  language,
  onEdit,
  onDelete,
  onSendMail,
}: {
  contact: ContactItem
  language: Language
  onEdit: () => void
  onDelete: () => void
  /** 在当前页面弹出写邮件面板，收件人预填联系人邮箱 */
  onSendMail: () => void
}) {
  const zh = language === 'zh'
  const style = relationStyle(contact.relation)
  const star = contact.star ?? 0
  const bdayDays = daysUntilBirthday(contact.birthday)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-5">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-[22px] font-semibold shrink-0"
            style={{ background: style.bg, color: style.color }}
          >
            {contactInitial(contact.name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-text-primary truncate">{contact.name}</h2>
              {contact.relation && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: style.bg, color: style.color }}
                >
                  {contact.relation}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className="w-3.5 h-3.5"
                  style={{ color: n <= star ? '#F59E0B' : '#D1D5DB' }}
                  fill={n <= star ? '#F59E0B' : 'none'}
                  strokeWidth={1.6}
                />
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] text-text-secondary border border-border/50 hover:bg-surface-hover transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
            <span>{zh ? '编辑' : 'Edit'}</span>
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
            <span>{zh ? '删除' : 'Delete'}</span>
          </button>
        </div>

        <div className="mt-5">
          <InfoRow icon={Phone} label={zh ? '手机号' : 'Phone'}>
            <span className="text-[13px] text-text-primary">{contact.phone}</span>
            <CopyButton text={contact.phone} />
          </InfoRow>
          {contact.email && (
            <InfoRow icon={Mail} label={zh ? '邮箱' : 'Email'}>
              <span className="text-[13px] text-text-primary break-all">{contact.email}</span>
              <button
                onClick={onSendMail}
                className="text-[12px] text-accent hover:underline shrink-0"
              >
                {zh ? '发邮件' : 'Send'}
              </button>
              <CopyButton text={contact.email} />
            </InfoRow>
          )}
          {contact.gender && (
            <InfoRow icon={BookUser} label={zh ? '性别' : 'Gender'}>
              <span className="text-[13px] text-text-primary">{GENDER_LABELS[contact.gender]}</span>
            </InfoRow>
          )}
          {contact.birthday && (
            <InfoRow icon={Cake} label={zh ? '出生日期' : 'Birthday'}>
              <span className="text-[13px] text-text-primary">{contact.birthday}</span>
              {bdayDays !== null && (
                <span className={`text-[12px] shrink-0 ${bdayDays <= 7 ? 'text-amber-500' : 'text-text-muted'}`}>
                  {bdayDays === 0 ? (zh ? '今天生日 🎂' : 'Today 🎂') : zh ? `还有 ${bdayDays} 天生日` : `in ${bdayDays} days`}
                </span>
              )}
            </InfoRow>
          )}
          {contact.company && (
            <InfoRow icon={Briefcase} label={zh ? '公司 / 单位' : 'Company'}>
              <span className="text-[13px] text-text-primary">{contact.company}</span>
            </InfoRow>
          )}
          {contact.title && (
            <InfoRow label={zh ? '职位' : 'Title'}>
              <span className="text-[13px] text-text-primary">{contact.title}</span>
            </InfoRow>
          )}
          {contact.address && (
            <InfoRow icon={MapPin} label={zh ? '地址' : 'Address'}>
              <span className="text-[13px] text-text-primary">{contact.address}</span>
            </InfoRow>
          )}
          {contact.tags && contact.tags.length > 0 && (
            <InfoRow icon={Tag} label={zh ? '标签' : 'Tags'}>
              <div className="flex flex-wrap gap-1">
                {contact.tags.map((tag) => (
                  <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent">
                    {tag}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}
          {contact.note && (
            <InfoRow label={zh ? '备注' : 'Note'}>
              <span className="text-[13px] text-text-primary whitespace-pre-wrap break-words">{contact.note}</span>
            </InfoRow>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon?: LucideIcon
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-1 py-2.5 border-b border-border/20 last:border-0">
      <div className="w-24 shrink-0 flex items-center gap-1.5 text-[12px] text-text-muted pt-0.5">
        {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />}
        <span>{label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 text-text-muted hover:text-accent transition-colors"
      title="复制"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <CopyIcon />}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}
