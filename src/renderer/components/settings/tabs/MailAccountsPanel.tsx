/**
 * 邮箱账户设置面板（收发一体的账户配置）
 *
 * 一个账户同时承载收信（IMAP）与发信（SMTP）能力：收件填 IMAP 主机/端口
 * 与密码（授权码），外发可单独填写 SMTP 主机/端口，留空则按服务商规则从
 * 收件服务器自动推导；账号与凭据只填写一次，收件与发件共用一份。
 *
 * 账户元信息写入 emailConfig.accounts（随设置保存）；密码/授权码经
 * mail:account:set-secret 加密存于本机安全存储，不落配置文件、不上传。
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Plus,
  Trash2,
  TestTube,
  CheckCircle,
  XCircle,
  X,
  Loader2,
  Inbox,
  KeyRound,
  Shield,
  MailOpen,
  Clock,
  Send,
} from 'lucide-react'
import { ActionButton, ToggleSwitch } from '@components/ui'
import { useStore } from '@store'
import { api } from '../../../adapters/electronBridge'
import type {
  EmailAccountDraft,
  EmailConfig,
  MailProviderId,
} from '@shared/configuration/configTypes'
import { resolveSmtpEndpoint } from '@shared/configuration/mailProviders'
import {
  buildEmailAccountFromDraft,
  mailAccountIdFromAddress,
} from '@shared/configuration/mailAccounts'

interface MailAccountsPanelProps {
  language: 'en' | 'zh'
  emailConfig: EmailConfig
  setEmailConfig: (config: EmailConfig) => void
}

/** 表单草稿：非敏感字段继承自 EmailAccountDraft，密码单独存于本地状态 */
interface DraftState extends EmailAccountDraft {
  secret: string
}


/**
 * 输入框基础样式（不含宽度）。
 *
 * 宽度单独声明：同一元素上同时挂 `w-full` 与 `flex-1`/`w-20` 会产生
 * 样式竞争（`w-full` 在 flex 布局下会把 `flex-1` 的基准宽度撑成 0，
 * 导致主机地址输入框被挤成一条窄缝），因此这里统一拆开。
 */
const INPUT_BASE =
  'px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors'

const INPUT_CLS = `w-full ${INPUT_BASE}`

const IMAP_PRESETS: Array<{
  id: MailProviderId
  label: string
  labelZh: string
  host: string
  port: number
  secure: boolean
}> = [
  { id: 'qq', label: 'QQ Mail', labelZh: 'QQ邮箱', host: 'imap.qq.com', port: 993, secure: true },
  { id: '163', label: '163 Mail', labelZh: '163邮箱', host: 'imap.163.com', port: 993, secure: true },
  { id: '126', label: '126 Mail', labelZh: '126邮箱', host: 'imap.126.com', port: 993, secure: true },
  { id: 'gmail', label: 'Gmail', labelZh: 'Gmail', host: 'imap.gmail.com', port: 993, secure: true },
  {
    id: 'outlook',
    label: 'Outlook',
    labelZh: 'Outlook',
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
  },
  {
    id: 'aliyun',
    label: 'Aliyun',
    labelZh: '阿里邮箱',
    host: 'imap.aliyun.com',
    port: 993,
    secure: true,
  },
  { id: 'custom', label: 'Custom', labelZh: '自定义', host: '', port: 993, secure: true },
]

const EMPTY_DRAFT: DraftState = {
  label: '',
  address: '',
  provider: 'qq',
  host: 'imap.qq.com',
  port: 993,
  secure: true,
  // 默认服务商为 QQ：外发端点同步预填，切换服务商时再刷新
  smtpHost: 'smtp.qq.com',
  smtpPort: 465,
  smtpSecure: true,
  secret: '',
}

export default function MailAccountsPanel({
  language,
  emailConfig,
  setEmailConfig,
}: MailAccountsPanelProps) {
  const zh = language === 'zh'
  /**
   * 表单草稿的非敏感字段随设置保存。
   *
   * 这样「填写表单」本身即计入未保存变更，设置面板底部的统一「保存」按钮
   * 会随输入出现（与发件 SMTP 表单一致）；关闭设置后再次进入也能恢复上次
   * 填了一半的内容。密码/授权码不在此结构内，见下方 secret。
   */
  const draft: DraftState = useMemo(
    () => ({ ...EMPTY_DRAFT, ...(emailConfig.accountDraft ?? {}) }),
    [emailConfig.accountDraft],
  )
  /** 密码/授权码：仅存活于本组件，交由主进程安全存储加密保存 */
  const [secret, setSecret] = useState('')
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  /**
   * 账户表单是否展开
   *
   * 默认收起，仅保留已有账户列表；点「添加邮件账户」才展开录入表单，
   * 避免未配置用户一进设置页就看到一长串字段。
   */
  const [showForm, setShowForm] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  /**
   * 各账户的发件测试结果（按账户 id 记录）
   *
   * 发件复用账户凭据：主进程按账户的外发设置或服务商规则推导 SMTP 后完成一次 AUTH。
   */
  const [smtpTest, setSmtpTest] = useState<
    Record<string, { busy: boolean; ok?: boolean; message?: string }>
  >({})

  /** 由草稿的收件服务器推导出的默认外发端点（仅用于输入框占位提示） */
  const derivedSmtp = useMemo(
    () => resolveSmtpEndpoint(draft.provider, draft.host),
    [draft.provider, draft.host],
  )

  /** 测试某账户的发件能力 */
  const handleTestSmtp = useCallback(
    async (accountId: string) => {
      setSmtpTest((current) => ({ ...current, [accountId]: { busy: true } }))
      try {
        const res = await api.mail.accountTestSmtp(accountId)
        setSmtpTest((current) => ({
          ...current,
          [accountId]: {
            busy: false,
            ok: Boolean(res?.success),
            message: res?.success
              ? zh
                ? '发件可用'
                : 'Sending works'
              : res?.error || (zh ? '发件不可用' : 'Cannot send'),
          },
        }))
      } catch (err) {
        setSmtpTest((current) => ({
          ...current,
          [accountId]: {
            busy: false,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          },
        }))
      }
    },
    [zh],
  )

  const accounts = emailConfig.accounts ?? []

  // 定时自动整理设置
  const autoOrganize = emailConfig.autoOrganize
  const [cronDraft, setCronDraft] = useState(autoOrganize?.expression || '0 8 * * *')

  /** 应用定时整理配置：写入设置 + 通知主进程更新 Cron 任务 */
  const applyAutoOrganize = useCallback(
    async (enabled: boolean, expression: string) => {
      setEmailConfig({ ...emailConfig, autoOrganize: { enabled, expression, ruleId: '' } })
      try {
        await api.mail.updateAutoOrganize({ enabled, expression })
      } catch {
        // 主进程未就绪时忽略，配置已存入设置，下次启动生效
      }
    },
    [emailConfig, setEmailConfig],
  )

  // 查询各账户是否已保存凭据
  useEffect(() => {
    const list = emailConfig.accounts ?? []
    let cancelled = false
    void (async () => {
      const entries: Record<string, boolean> = {}
      for (const account of list) {
        try {
          const result = await api.mail.accountHasSecret(account.id)
          entries[account.id] = Boolean(result?.hasSecret)
        } catch {
          entries[account.id] = false
        }
      }
      if (!cancelled) setSecretStatus(entries)
    })()
    return () => {
      cancelled = true
    }
  }, [emailConfig.accounts])

  /** 在主窗口内打开邮件中心（宽屏面板），并退出设置页 */
  const openMailCenter = useCallback(() => {
    const store = useStore.getState()
    store.closeAllFullPages()
    store.closeInternalBrowser()
    store.setActiveSidePanel('mail-center')
  }, [])

  const updateDraft = useCallback(
    (updates: Partial<DraftState>) => {
      // 密码单独走本地状态，绝不写入设置结构
      if (updates.secret !== undefined) {
        setSecret(updates.secret)
        return
      }
      setEmailConfig({ ...emailConfig, accountDraft: { ...draft, ...updates } })
    },
    [draft, emailConfig, setEmailConfig],
  )

  const applyPreset = useCallback(
    (preset: (typeof IMAP_PRESETS)[number]) => {
      // 选中服务商后连带预填推荐的外发（SMTP）端点：
      // 多数用户不知道发件服务器地址，预填后只需补账号与授权码
      const smtp = preset.id === 'custom' ? null : resolveSmtpEndpoint(preset.id, preset.host)
      setEmailConfig({
        ...emailConfig,
        accountDraft: {
          ...draft,
          provider: preset.id,
          host: preset.host,
          port: preset.port,
          secure: preset.secure,
          smtpHost: smtp?.host ?? '',
          smtpPort: smtp?.port ?? 465,
          smtpSecure: smtp?.secure ?? true,
        },
      })
    },
    [draft, emailConfig, setEmailConfig],
  )
  const handleTest = useCallback(async () => {
    if (!draft.host || !draft.address || !secret) {
      setTestResult({
        success: false,
        message: zh ? '请填写邮箱地址、IMAP 主机与密码/授权码' : 'Fill in address, IMAP host and password',
      })
      return
    }
    setBusy(true)
    setTestResult(null)
    try {
      const result = await api.mail.accountTest({
        host: draft.host,
        port: draft.port,
        secure: draft.secure,
        user: draft.address,
        pass: secret,
      })
      setTestResult({
        success: Boolean(result?.success),
        message: result?.success
          ? zh
            ? '连接成功'
            : 'Connected'
          : result?.error || (zh ? '连接失败' : 'Failed'),
      })
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }, [draft, secret, zh])

  const handleAdd = useCallback(async () => {
    if (!draft.address || !draft.host) {
      setTestResult({ success: false, message: zh ? '请填写邮箱地址与 IMAP 主机' : 'Address and host required' })
      return
    }
    setBusy(true)
    try {
      const account = buildEmailAccountFromDraft(draft)
      if (!account) return

      // 账户 id 由邮箱地址派生：与密码输入框失焦时预存的凭据 id 保持一致
      let hasSecret = false
      if (secret) {
        const saved = await api.mail.accountSetSecret({ accountId: account.id, secret })
        hasSecret = Boolean(saved?.success)
        if (!hasSecret) {
          setTestResult({
            success: false,
            message: saved?.error || (zh ? '凭据保存失败' : 'Failed to save credential'),
          })
        }
      }

      const finalAccount = { ...account, auth: { ...account.auth, hasSecret } }
      // 账户落库的同时清空草稿（底部未保存标记随之消失）
      setEmailConfig({
        ...emailConfig,
        accounts: [...accounts, finalAccount],
        accountDraft: undefined,
      })
      setSecretStatus((current) => ({ ...current, [finalAccount.id]: hasSecret }))
      setSecret('')
      setTestResult(null)
      // 账户已落地，收起表单回到列表视图
      setShowForm(false)
    } finally {
      setBusy(false)
    }
  }, [draft, secret, accounts, emailConfig, setEmailConfig, zh])

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await api.mail.accountDeleteSecret(id)
      } catch {
        // 凭据删除失败不阻塞账户移除
      }
      setEmailConfig({ ...emailConfig, accounts: accounts.filter((a) => a.id !== id) })
      setSecretStatus((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    },
    [accounts, emailConfig, setEmailConfig],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5" />
          {zh ? '邮箱账户（收件 + 外发）' : 'Mail accounts (incoming + outgoing)'}
        </label>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <button
              type="button"
              onClick={openMailCenter}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
            >
              <MailOpen className="w-3 h-3" />
              {zh ? '打开邮件中心' : 'Open Mail Center'}
            </button>
          )}
          <span className="text-xs text-text-muted">
            {accounts.length} {zh ? '个账户' : 'accounts'}
          </span>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
          >
            {showForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            {showForm
              ? zh
                ? '收起'
                : 'Collapse'
              : zh
                ? '添加邮件账户'
                : 'Add mail account'}
          </button>
        </div>
      </div>

      {/* 已添加账户列表 */}
      {accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => {
            const test = smtpTest[account.id]
            return (
              <div
                key={account.id}
                className="rounded-lg bg-surface/60 border border-border/40 px-3 py-2 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-text-primary truncate">
                      {account.label || account.address}
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {account.address} · {account.imap.host}:{account.imap.port}
                      {account.smtp?.host
                        ? ` · ${zh ? '发件' : 'SMTP'} ${account.smtp.host}:${account.smtp.port}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`flex items-center gap-1 text-xs ${secretStatus[account.id] ? 'text-green-400' : 'text-amber-400'}`}
                    >
                      {secretStatus[account.id] ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <KeyRound className="w-3 h-3" />
                      )}
                      {secretStatus[account.id]
                        ? zh
                          ? '凭据已保存'
                          : 'Saved'
                        : zh
                          ? '缺凭据'
                          : 'No credential'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleTestSmtp(account.id)}
                      disabled={test?.busy}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50 transition-colors"
                    >
                      {test?.busy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      {zh ? '测试发件' : 'Test send'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(account.id)}
                      className="text-text-muted hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {test && !test.busy && test.message && (
                  <div
                    className={`flex items-center gap-1.5 text-xs ${test.ok ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {test.ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    <span className="break-all">{test.message}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 添加账户表单（默认收起，点「添加邮件账户」展开） */}
      {showForm && (
      <div className="rounded-lg border border-border/40 p-3 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {IMAP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                draft.provider === preset.id
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'bg-surface/60 text-text-secondary border-border/40 hover:border-accent/30'
              }`}
            >
              {zh ? preset.labelZh : preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            value={draft.label}
            onChange={(e) => updateDraft({ label: e.target.value })}
            placeholder={zh ? '显示名（可选）' : 'Display name (optional)'}
            className={INPUT_CLS}
          />
          <input
            type="text"
            value={draft.address}
            onChange={(e) => updateDraft({ address: e.target.value })}
            placeholder={zh ? '邮箱地址' : 'Email address'}
            className={INPUT_CLS}
          />
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={draft.host}
            onChange={(e) => updateDraft({ host: e.target.value })}
            placeholder="imap.example.com"
            className={`${INPUT_BASE} flex-1 min-w-0`}
          />
          <input
            type="number"
            value={draft.port || ''}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10)
              if (!isNaN(value) && value > 0 && value <= 65535) updateDraft({ port: value })
            }}
            placeholder="993"
            className={`${INPUT_BASE} w-20 shrink-0`}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-text-secondary flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            SSL/TLS
          </label>
          <ToggleSwitch
            checked={draft.secure}
            onChange={() => updateDraft({ secure: !draft.secure })}
          />
        </div>

        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          onBlur={() => {
            // 失焦即把授权码写入安全存储（id 与账户落库规则一致）：
            // 用户填完密码后直接点「保存」时，设置保存会自动把完整草稿落为账户，
            // 此时凭据已就位，无需再单独点「添加账户」。
            if (secret && draft.address?.trim() && draft.host?.trim()) {
              void api.mail.accountSetSecret({
                accountId: mailAccountIdFromAddress(draft.address),
                secret,
              })
            }
          }}
          placeholder={zh ? '邮箱密码 / 授权码' : 'Password / app-specific code'}
          className={INPUT_CLS}
        />

        {/* 外发设置（可选）：发件服务器地址/端口与收件不同时填写，留空自动推导 */}
        <div className="pt-3 border-t border-border/30 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {zh ? '外发设置（可选）' : 'Outgoing (optional)'}
            </label>
            <span className="text-xs text-text-muted">
              {draft.smtpHost ? (zh ? '已自定义' : 'Custom') : zh ? '自动推导' : 'Auto'}
            </span>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={draft.smtpHost ?? ''}
              onChange={(e) => updateDraft({ smtpHost: e.target.value })}
              placeholder={derivedSmtp?.host || 'smtp.example.com'}
              className={`${INPUT_BASE} flex-1 min-w-0`}
            />
            <input
              type="number"
              value={draft.smtpPort ?? ''}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10)
                if (!isNaN(value) && value > 0 && value <= 65535) updateDraft({ smtpPort: value })
              }}
              placeholder="465"
              className={`${INPUT_BASE} w-20 shrink-0`}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              SSL/TLS
            </label>
            <ToggleSwitch
              checked={draft.smtpSecure ?? true}
              onChange={() => updateDraft({ smtpSecure: !(draft.smtpSecure ?? true) })}
            />
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            {zh
              ? '留空则按收件服务器自动推导（如 imap.qq.com → smtp.qq.com:465）。登录账号与密码复用上方收件凭据，无需重复填写。'
              : 'Leave empty to derive from the incoming server (e.g. imap.qq.com → smtp.qq.com:465). Credentials are reused — no need to enter them twice.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={() => void handleTest()}
            disabled={busy}
            className="flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube className="w-3.5 h-3.5" />}
            {zh ? '测试连接' : 'Test'}
          </ActionButton>
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={busy || !draft.address || !draft.host}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {zh ? '添加账户' : 'Add account'}
          </ActionButton>
          {testResult && (
            <div
              className={`flex items-center gap-1.5 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}
            >
              {testResult.success ? (
                <CheckCircle className="w-3.5 h-3.5" />
              ) : (
                <XCircle className="w-3.5 h-3.5" />
              )}
              <span className="truncate max-w-[240px]">{testResult.message}</span>
            </div>
          )}
          <ActionButton
            variant="secondary"
            size="sm"
            onClick={() => setShowForm(false)}
            className="flex items-center gap-1.5"
          >
            {zh ? '取消' : 'Cancel'}
          </ActionButton>
        </div>

        <p className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '多数邮箱需使用「授权码」而非登录密码（QQ / 163 / Gmail 等需先在邮箱设置中开启 IMAP 并生成授权码）。密码或授权码加密保存在本机，不会上传。'
            : 'Most providers require an app-specific password (enable IMAP and generate one first). Credentials are encrypted and stored locally only.'}
        </p>
      </div>
      )}

      {/* 定时自动整理 */}
      <div className="rounded-lg border border-border/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {zh ? '定时自动整理' : 'Scheduled auto-organize'}
          </label>
          <ToggleSwitch
            checked={Boolean(autoOrganize?.enabled)}
            onChange={() =>
              void applyAutoOrganize(!autoOrganize?.enabled, cronDraft || '0 8 * * *')
            }
          />
        </div>
        <input
          type="text"
          value={cronDraft}
          onChange={(e) => setCronDraft(e.target.value)}
          onBlur={() => {
            const expression = cronDraft.trim() || '0 8 * * *'
            if (expression !== (autoOrganize?.expression ?? '')) {
              void applyAutoOrganize(Boolean(autoOrganize?.enabled), expression)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder="0 8 * * *"
          className={`${INPUT_CLS} font-mono`}
        />
        <p className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '按 cron 表达式（分 时 日 月 周）定时在主进程同步所有收件账户并汇总，例如「0 8 * * *」为每天 08:00。开启后可在邮件中心同步查看结果。'
            : 'Runs in the background on the given cron schedule (min hour day month weekday), syncing all incoming accounts and summarizing. Example: 0 8 * * * = daily 08:00.'}
        </p>
      </div>
    </div>
  )
}
