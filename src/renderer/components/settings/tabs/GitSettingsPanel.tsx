/**
 * Git 设置面板（设置 → Git）
 *
 * 区域划分：
 *   1. 仓库状态 — 工作区是否 Git 仓库、分支、远程、变更概览；非仓库时提供一键初始化
 *   2. 仓库身份 — user.name / user.email（本仓库 或 全局）
 *   3. 凭证管理 — 已保存凭证（掩码展示 + 删除 / 清空）；明文永不回渲染进程
 *   4. AI 能力   — 允许 AI 写仓库 / 远程同步（工具级开关，实时生效）
 *   5. 行为      — 自动刷新、打开工作区自动 fetch、凭证弹窗默认记住
 *
 * 持久化：读写 editorConfig.git（与 EditorConfig 同通道，无需新增设置项）。
 *
 * @module settings/tabs/GitSettingsPanel
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FolderGit2,
  GitBranch,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { ToggleSwitch } from '@components/ui/ToggleSwitch'
import { ActionButton } from '@components/ui/ActionButton'
import { gitService, type GitStatus } from '@services/gitAdapter'
import { api } from '@services/electronBridge'
import type { GitConfig } from '@shared/configuration/configTypes'

interface GitSettingsPanelProps {
  language: Language
  settings: GitConfig
  setSettings: (patch: Partial<GitConfig>) => void
}

interface CredentialEntry {
  host: string
  protocol: 'https' | 'http' | 'ssh'
  username: string
  secretMask: string
  remember: boolean
  updatedAt: number
}

interface RepoState {
  loading: boolean
  isRepo: boolean
  status: GitStatus | null
  remoteUrl: string
  localName: string
  localEmail: string
  globalName: string
  globalEmail: string
}

const EMPTY_REPO: RepoState = {
  loading: false,
  isRepo: false,
  status: null,
  remoteUrl: '',
  localName: '',
  localEmail: '',
  globalName: '',
  globalEmail: '',
}

export function GitSettingsPanel({ language, settings, setSettings }: GitSettingsPanelProps) {
  const zh = language === 'zh'
  const workspacePath = useStore((s) => s.workspacePath)

  const [repo, setRepo] = useState<RepoState>({ ...EMPTY_REPO, loading: true })
  const [credentials, setCredentials] = useState<CredentialEntry[]>([])
  const [identityScope, setIdentityScope] = useState<'local' | 'global'>('local')
  const [identityDraft, setIdentityDraft] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const refreshRepo = useCallback(async () => {
    if (!workspacePath) {
      setRepo({ ...EMPTY_REPO })
      return
    }

    setRepo((prev) => ({ ...prev, loading: true }))
    try {
      const isRepo = await gitService.isGitRepo(workspacePath)
      if (!isRepo) {
        setRepo({ ...EMPTY_REPO })
        setIdentityDraft({ name: '', email: '' })
        return
      }

      const [status, remotes, localName, localEmail, globalName, globalEmail] = await Promise.all([
        gitService.getStatus(workspacePath),
        gitService.getRemotes(workspacePath),
        gitService.getGitConfig('user.name', workspacePath),
        gitService.getGitConfig('user.email', workspacePath),
        gitService.getGitConfig('user.name', workspacePath, true),
        gitService.getGitConfig('user.email', workspacePath, true),
      ])

      const origin =
        remotes.find((r) => r.name === 'origin' && r.type === 'fetch') ||
        remotes.find((r) => r.type === 'fetch')

      setRepo({
        loading: false,
        isRepo: true,
        status,
        remoteUrl: origin?.url || '',
        localName: localName || '',
        localEmail: localEmail || '',
        globalName: globalName || '',
        globalEmail: globalEmail || '',
      })
      setIdentityDraft({ name: localName || '', email: localEmail || '' })
    } catch {
      setRepo((prev) => ({ ...prev, loading: false }))
    }
  }, [workspacePath])

  const refreshCredentials = useCallback(async () => {
    try {
      const result = await api.git.credentialList()
      setCredentials((result?.credentials as CredentialEntry[]) || [])
    } catch {
      setCredentials([])
    }
  }, [])

  useEffect(() => {
    void refreshRepo()
    void refreshCredentials()
  }, [refreshRepo, refreshCredentials])

  const flash = (type: 'ok' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleInitRepo = async () => {
    if (!workspacePath) return
    setBusy('init')
    try {
      const ok = await gitService.init(workspacePath)
      if (ok) {
        flash('ok', zh ? '已初始化 Git 仓库' : 'Git repository initialized')
        await refreshRepo()
      } else {
        flash('error', zh ? '初始化失败，请检查目录权限' : 'Failed to initialize repository')
      }
    } finally {
      setBusy(null)
    }
  }

  const handleSaveIdentity = async () => {
    if (!workspacePath) return
    setBusy('identity')
    try {
      const global = identityScope === 'global'
      const nameOk = await gitService.setGitConfig('user.name', identityDraft.name.trim(), global, workspacePath)
      const emailOk = identityDraft.email.trim()
        ? await gitService.setGitConfig('user.email', identityDraft.email.trim(), global, workspacePath)
        : true

      if (nameOk && emailOk) {
        flash('ok', zh ? '身份配置已保存' : 'Identity saved')
        await refreshRepo()
      } else {
        flash('error', zh ? '保存失败，请检查仓库是否可写' : 'Failed to save identity')
      }
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveCredential = async (host: string) => {
    setBusy(`cred-${host}`)
    try {
      await api.git.credentialRemove(host)
      await refreshCredentials()
    } finally {
      setBusy(null)
    }
  }

  const handleClearCredentials = async () => {
    setBusy('cred-all')
    try {
      await api.git.credentialClear()
      await refreshCredentials()
      flash('ok', zh ? '已清空全部凭证' : 'All credentials cleared')
    } finally {
      setBusy(null)
    }
  }

  const changeCount = repo.status
    ? repo.status.staged.length + repo.status.unstaged.length + repo.status.untracked.length
    : 0

  // 旧版本保存过的配置可能缺少新增字段，这里按默认值语义兜底：
  // worktree 属"有副作用的重操作" → 缺省关闭；审计封存 → 缺省开启。
  // 判断方式与 toolExecutors 中的工具门禁保持一致，避免「UI 显示开、工具却被拦」。
  const worktreeEnabled = settings.aiWorktreeEnabled === true
  const auditSealEnabled = settings.auditSealEnabled !== false

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 顶部提示 */}
      {message && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
            message.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}
        >
          {message.type === 'ok' ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* 1. 仓库状态 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text-primary">{zh ? '仓库状态' : 'Repository'}</h3>
          </div>
          <button
            onClick={() => void refreshRepo()}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-active/50 transition-colors"
            title={zh ? '刷新' : 'Refresh'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${repo.loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {!workspacePath ? (
          <p className="text-xs text-text-muted">{zh ? '请先打开一个工作区目录。' : 'Open a workspace folder first.'}</p>
        ) : repo.loading ? (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {zh ? '读取仓库信息…' : 'Loading repository…'}
          </div>
        ) : !repo.isRepo ? (
          <div className="space-y-3">
            <p className="text-xs text-text-muted leading-relaxed">
              {zh
                ? '当前工作区不是 Git 仓库。初始化后 AI 即可使用版本控制工具（状态查看、提交、分支、远程同步）。'
                : 'This workspace is not a Git repository. Initialize it to let the AI use version-control tools.'}
            </p>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => void handleInitRepo()}
              disabled={busy === 'init'}
            >
              {busy === 'init' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {zh ? '初始化 Git 仓库' : 'Initialize repository'}
            </ActionButton>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-text-muted" />
              <dt className="text-text-muted">{zh ? '当前分支' : 'Branch'}</dt>
            </div>
            <dd className="text-text-primary truncate">{repo.status?.branch || '-'}</dd>

            <dt className="text-text-muted">{zh ? '远程仓库' : 'Remote'}</dt>
            <dd className="text-text-primary truncate" title={repo.remoteUrl}>
              {repo.remoteUrl || (zh ? '未配置' : 'not configured')}
            </dd>

            <dt className="text-text-muted">{zh ? '变更文件' : 'Changes'}</dt>
            <dd className="text-text-primary">
              {changeCount}
              {repo.status?.hasConflicts ? (zh ? '（存在冲突）' : ' (conflicts)') : ''}
            </dd>

            <dt className="text-text-muted">{zh ? '领先 / 落后' : 'Ahead / Behind'}</dt>
            <dd className="text-text-primary">
              {repo.status ? `${repo.status.ahead} / ${repo.status.behind}` : '-'}
            </dd>
          </dl>
        )}
      </section>

      {/* 2. 仓库身份 */}
      {workspacePath && repo.isRepo && (
        <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">{zh ? '提交身份' : 'Commit identity'}</h3>
          <p className="text-xs text-text-muted leading-relaxed">
            {zh
              ? '用于生成提交记录的作者信息（git config user.name / user.email）。'
              : 'Author information written into commits (git config user.name / user.email).'}
          </p>

          <div className="flex items-center gap-1 p-1 bg-surface-active/50 rounded-lg border border-border/40 w-fit">
            {(['local', 'global'] as const).map((scope) => (
              <button
                key={scope}
                onClick={() => {
                  setIdentityScope(scope)
                  setIdentityDraft(
                    scope === 'local'
                      ? { name: repo.localName, email: repo.localEmail }
                      : { name: repo.globalName, email: repo.globalEmail },
                  )
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  identityScope === scope
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {scope === 'local' ? (zh ? '仅本仓库' : 'This repo') : zh ? '全局' : 'Global'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted">{zh ? '用户名' : 'Name'}</label>
              <input
                type="text"
                value={identityDraft.name}
                onChange={(e) => setIdentityDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={zh ? '你的名字' : 'Your name'}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-text-muted">{zh ? '邮箱' : 'Email'}</label>
              <input
                type="text"
                value={identityDraft.email}
                onChange={(e) => setIdentityDraft((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="name@example.com"
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>

          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => void handleSaveIdentity()}
            disabled={busy === 'identity' || !identityDraft.name.trim()}
          >
            {busy === 'identity' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {zh ? '保存身份' : 'Save identity'}
          </ActionButton>
        </section>
      )}

      {/* 3. 凭证管理 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-text-primary">{zh ? 'Git 凭证' : 'Git credentials'}</h3>
          </div>
          {credentials.length > 0 && (
            <button
              onClick={() => void handleClearCredentials()}
              disabled={busy === 'cred-all'}
              className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {zh ? '清空全部' : 'Clear all'}
            </button>
          )}
        </header>

        <p className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '推送 / 拉取时所需的账号与密码（或 Personal Access Token）。密钥使用系统级加密保存在本机，AI 只能看到掩码，无法读取明文。'
            : 'Accounts used for push/pull. Secrets are encrypted with the OS keychain and never exposed to the AI (masked only).'}
        </p>

        {credentials.length === 0 ? (
          <p className="text-xs text-text-muted/70">
            {zh ? '暂无已保存凭证。执行 push / pull 时可按提示输入并勾选「记住凭证」。' : 'No stored credentials yet.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {credentials.map((cred) => (
              <li
                key={cred.host}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-active/30 border border-border/40"
              >
                <div className="min-w-0">
                  <p className="text-xs text-text-primary truncate">
                    {cred.host}
                    <span className="text-text-muted"> · {cred.username || '(no username)'}</span>
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {cred.secretMask}
                    {' · '}
                    {cred.remember ? (zh ? '已加密保存' : 'saved') : zh ? '仅本次会话' : 'session only'}
                  </p>
                </div>
                <button
                  onClick={() => void handleRemoveCredential(cred.host)}
                  disabled={busy === `cred-${cred.host}`}
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  title={zh ? '删除' : 'Delete'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. AI 能力 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">{zh ? 'AI 版本控制能力' : 'AI version control'}</h3>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '允许 AI 提交与分支操作' : 'Allow AI to commit & manage branches'}</p>
            <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">
              {zh
                ? '对应 git_commit / git_branch 工具；关闭后 AI 只能查看状态、差异与历史。'
                : 'Gates the git_commit / git_branch tools.'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={settings.aiWriteEnabled}
            onChange={(e) => setSettings({ aiWriteEnabled: e.target.checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '允许 AI 同步远程仓库' : 'Allow AI to sync with remote'}</p>
            <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">
              {zh
                ? '对应 git_sync 工具（pull / push / fetch / clone）；需要凭证时会弹出输入框，由你确认。'
                : 'Gates the git_sync tool (pull / push / fetch / clone). Credentials are always confirmed by you.'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={settings.aiSyncEnabled}
            onChange={(e) => setSettings({ aiSyncEnabled: e.target.checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '允许 AI 创建隔离工作区' : 'Allow AI to use worktrees'}</p>
            <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">
              {zh
                ? '对应 git_worktree 工具：在工作区同级目录新建独立工作目录，让并行任务互不污染未提交改动。默认关闭。'
                : 'Gates the git_worktree tool — adds a sibling working directory so parallel tasks never collide. Off by default.'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={worktreeEnabled}
            onChange={(e) => setSettings({ aiWorktreeEnabled: e.target.checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '允许 AI 封存审计轨迹' : 'Allow AI to seal audit trails'}</p>
            <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">
              {zh
                ? '对应 git_audit 工具：提交待提交变更并打带注记的审计 tag（可用于法律 / 医疗等合规场景）。'
                : 'Gates the git_audit tool — commits pending work and tags an annotated, verifiable audit point.'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={auditSealEnabled}
            onChange={(e) => setSettings({ auditSealEnabled: e.target.checked })}
          />
        </div>
      </section>

      {/* 5. 行为 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">{zh ? '行为' : 'Behavior'}</h3>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '自动刷新仓库状态' : 'Auto refresh status'}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {zh ? '文件变更后自动重新读取 git 状态' : 'Re-read git status after file changes'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={settings.autoRefresh}
            onChange={(e) => setSettings({ autoRefresh: e.target.checked })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '打开工作区时自动 fetch' : 'Fetch on workspace open'}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {zh ? '静默更新远程分支信息，失败不会打扰你' : 'Silently updates remote refs; failures are ignored'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={settings.autoFetchOnOpen}
            onChange={(e) => setSettings({ autoFetchOnOpen: e.target.checked })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-text-primary">{zh ? '默认记住凭证' : 'Remember credentials by default'}</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {zh ? '凭证输入框中「记住凭证」的默认勾选状态' : 'Default state of the "remember" checkbox'}
            </p>
          </div>
          <ToggleSwitch
            switchSize="sm"
            checked={settings.rememberCredentials}
            onChange={(e) => setSettings({ rememberCredentials: e.target.checked })}
          />
        </div>
      </section>
    </div>
  )
}

export default GitSettingsPanel

/** 面板标题（供 PreferencesDialog 复用） */
export function getGitSettingsTabLabel(language: Language): string {
  return t('settings.git', language)
}
