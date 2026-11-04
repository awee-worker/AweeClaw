/**
 * 语言服务器设置面板（设置 → 语言服务器）
 *
 * 管理 AI 代码检查所依赖的 LSP 服务器：
 *   1. 服务器列表 — 每种语言对应的服务器及其安装状态，可逐项安装
 *   2. 安装位置 — 查看 / 更改服务器安装目录
 *
 * 清单来自 shared/languageRegistry 的 LSP_SERVER_DEFINITIONS，
 * 与主进程 installServer 的分支一一对应；安装结果即时生效，无需重启。
 *
 * @module settings/tabs/LspSettingsPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FolderOpen,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { ActionButton } from '@components/ui/ActionButton'
import { useToast } from '@components/foundation/NotificationProvider'
import { api } from '@services/electronBridge'
import { LSP_SERVER_DEFINITIONS, type LspServerDefinition } from '@shared/languageRegistry'

interface LspSettingsPanelProps {
  language: Language
}

type ServerStatusMap = Record<string, { installed: boolean; path?: string }>

interface InstallOutcome {
  type: 'ok' | 'error'
  text: string
}

/** 同一 npm 包承载多个服务器：装一次即可同时点亮 */
const SHARED_PACKAGE_GROUPS: string[][] = [['html', 'css', 'json']]

function groupKeyOf(serverId: string): string {
  for (const group of SHARED_PACKAGE_GROUPS) {
    if (group.includes(serverId)) return group.join('+')
  }
  return serverId
}

export function LspSettingsPanel({ language }: LspSettingsPanelProps) {
  const zh = language === 'zh'
  const toast = useToast()

  const [status, setStatus] = useState<ServerStatusMap>({})
  const [binDir, setBinDir] = useState('')
  const [defaultBinDir, setDefaultBinDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  /** 按服务器记录安装结果，直接显示在对应行下方——列表较长时顶部横幅会被滚出视野 */
  const [rowOutcome, setRowOutcome] = useState<Record<string, InstallOutcome>>({})

  const refresh = useCallback(async () => {
    try {
      const [serverStatus, currentDir, fallbackDir] = await Promise.all([
        api.lsp.getServerStatus(),
        api.lsp.getBinDir(),
        api.lsp.getDefaultBinDir(),
      ])
      setStatus(serverStatus || {})
      setBinDir(currentDir || '')
      setDefaultBinDir(fallbackDir || '')
    } catch {
      setStatus({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const servers = useMemo(
    () => LSP_SERVER_DEFINITIONS.filter((server) => server.languages.length > 0),
    [],
  )

  const installedCount = useMemo(
    () => servers.filter((server) => status[server.id]?.installed).length,
    [servers, status],
  )

  const installOne = useCallback(
    async (server: LspServerDefinition) => {
      if (busy) return
      setBusy(server.id)
      setOutcome(null)
      setRowOutcome((prev) => {
        if (!prev[server.id]) return prev
        const next = { ...prev }
        delete next[server.id]
        return next
      })
      try {
        const result = await api.lsp.installServer(server.id)
        if (result?.success) {
          const text = result.warning
            ? result.warning
            : zh
              ? `${server.name} 安装完成，代码检查已可覆盖 ${server.displayLanguages.join(' / ')}。`
              : `${server.name} installed. Lint now covers ${server.displayLanguages.join(' / ')}.`
          // 降级安装（如 JDK 版本不足时的兼容版 jdtls）按警告提示，避免用户误以为是最新能力
          if (result.warning) toast.warning(result.warning, zh ? '安装完成，但使用了兼容方案' : 'Installed with a compatibility fallback')
          else toast.success(zh ? `${server.name} 安装完成` : `${server.name} installed`)
          setOutcome({ type: 'ok', text })
          setRowOutcome((prev) => ({ ...prev, [server.id]: { type: 'ok', text } }))
        } else {
          const text = result?.error || (zh ? '安装失败，请查看日志。' : 'Installation failed. Check the logs.')
          toast.error(zh ? `${server.name} 安装失败` : `${server.name} installation failed`, text)
          setOutcome({ type: 'error', text })
          setRowOutcome((prev) => ({ ...prev, [server.id]: { type: 'error', text } }))
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        toast.error(zh ? `${server.name} 安装失败` : `${server.name} installation failed`, text)
        setOutcome({ type: 'error', text })
        setRowOutcome((prev) => ({ ...prev, [server.id]: { type: 'error', text } }))
      } finally {
        await refresh()
        setBusy(null)
      }
    },
    [busy, refresh, zh, toast],
  )

  const installBasic = useCallback(async () => {
    if (busy) return
    setBusy('basic')
    setOutcome(null)
    try {
      const result = await api.lsp.installBasicServers()
      if (result?.success) {
        toast.success(zh ? '基础服务器已就绪' : 'Basic servers are ready')
        setOutcome({ type: 'ok', text: zh ? '基础服务器已就绪。' : 'Basic servers are ready.' })
      } else {
        const text = result?.error || (zh ? '部分服务器安装失败。' : 'Some servers failed to install.')
        toast.error(zh ? '基础服务器安装未全部成功' : 'Some servers failed to install', text)
        setOutcome({ type: 'error', text })
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      toast.error(zh ? '基础服务器安装失败' : 'Basic servers installation failed', text)
      setOutcome({ type: 'error', text })
    } finally {
      await refresh()
      setBusy(null)
    }
  }, [busy, refresh, zh, toast])

  const changeBinDir = useCallback(async () => {
    const picked = await api.file.selectFolder()
    if (!picked) return
    await api.lsp.setCustomBinDir(picked)
    await refresh()
    setOutcome({
      type: 'ok',
      text: zh
        ? '安装目录已更新，已装的服务器需要在新目录重新安装。'
        : 'Install directory updated. Servers installed elsewhere need reinstalling here.',
    })
  }, [refresh, zh])

  const resetBinDir = useCallback(async () => {
    await api.lsp.setCustomBinDir(null)
    await refresh()
  }, [refresh])

  const renderStatusBadge = (server: LspServerDefinition) => {
    const installed = status[server.id]?.installed
    if (installed) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
          <Check className="w-3 h-3" />
          {zh ? '已安装' : 'Installed'}
        </span>
      )
    }
    if (!server.installable) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-active/60 text-text-muted border border-border/40">
          {zh ? '需手动安装' : 'Manual install'}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
        {zh ? '未安装' : 'Not installed'}
      </span>
    )
  }

  const manualHint = (serverId: string): string | null => {
    if (serverId === 'rust') return zh ? '通过 rustup component add rust-analyzer 安装' : 'rustup component add rust-analyzer'
    if (serverId === 'deno') return zh ? '从 https://deno.land 安装后自动可用' : 'Install from https://deno.land'
    if (serverId === 'java') {
      return zh
        ? '优先使用 JDK 21+：本机不足时会自动下载 JDK 21（仅给语言服务用），下载失败则退回兼容 JDK 17 的旧版本。安装包约 50MB，首次索引较慢'
        : 'Prefers JDK 21+: if your local JDK is older, JDK 21 is downloaded for the server only; if that fails, a Java 17-compatible build is installed. Archive is ~50MB and the first index takes a while'
    }
    return null
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* 顶部说明 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-text-primary">{zh ? '代码检查依赖' : 'Lint backends'}</h3>
            <p className="text-xs text-text-muted leading-relaxed max-w-xl">
              {zh
                ? 'AI 在改完代码后通过语言服务器读取类型与语法诊断。可自动安装的服务器会在首次遇到对应文件时静默安装一次（等待超时则转后台继续），装好后立即生效、无需重启；Vue 还可以用项目自带的 ESLint 兜底检查。'
                : 'After editing, the AI reads type and syntax diagnostics from language servers. Installable servers are installed silently the first time a matching file is linted (falling back to a background install if it takes too long), and take effect without restart. Vue can also fall back to the project\u2019s own ESLint.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void refresh()}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-active/50 transition-colors"
              title={zh ? '刷新状态' : 'Refresh status'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={() => void installBasic()}
              disabled={busy !== null}
            >
              {busy === 'basic' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <PackageCheck className="w-3.5 h-3.5 mr-1.5" />
              )}
              {zh ? '安装基础服务器' : 'Install basics'}
            </ActionButton>
          </div>
        </div>

        <p className="text-[11px] text-text-muted">
          {zh
            ? `已完成 ${installedCount} / ${servers.length}`
            : `${installedCount} / ${servers.length} installed`}
        </p>

        {outcome && (
          <div
            className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
              outcome.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}
          >
            {outcome.type === 'ok' ? (
              <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            )}
            <span className="leading-relaxed break-words">{outcome.text}</span>
          </div>
        )}
      </section>

      {/* 服务器列表 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">{zh ? '语言服务器' : 'Language servers'}</h3>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {zh ? '读取安装状态…' : 'Reading status…'}
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {servers.map((server) => {
              const entry = status[server.id]
              const hint = manualHint(server.id)
              const isOpen = expanded === server.id
              const sharedKey = groupKeyOf(server.id)
              const installing = busy === sharedKey || busy === server.id

              return (
                <li key={server.id} className="py-3 first:pt-1 last:pb-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary">{server.name}</span>
                        {renderStatusBadge(server)}
                        {server.builtin && (
                          <span className="text-[11px] text-text-muted">
                            {zh ? '随客户端分发' : 'bundled'}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                        <code className="px-1.5 py-0.5 rounded bg-surface-active/50 border border-border/30">
                          {server.description}
                        </code>
                        <span>{server.displayLanguages.join(' / ')}</span>
                        {entry?.installed && entry.path && (
                          <button
                            onClick={() => setExpanded(isOpen ? null : server.id)}
                            className="underline decoration-dotted underline-offset-2 hover:text-text-primary transition-colors"
                          >
                            {zh ? '路径' : 'path'}
                          </button>
                        )}
                      </div>
                    </div>

                    {server.installable && !entry?.installed && (
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        onClick={() => void installOne(server)}
                        disabled={busy !== null}
                      >
                        {installing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {installing ? (zh ? '安装中' : 'Installing') : zh ? '安装' : 'Install'}
                      </ActionButton>
                    )}
                  </div>

                  {hint && !entry?.installed && (
                    <p className="text-[11px] text-text-muted">{hint}</p>
                  )}

                  {installing && server.id === 'java' && (
                    <p className="text-[11px] text-amber-300/90">
                      {zh
                        ? '首次安装可能需要先下载 JDK 或语言服务器包，请耐心等待，窗口可以继续操作。'
                        : 'The first install may download a JDK or the server archive — this can take a while.'}
                    </p>
                  )}

                  {!installing && rowOutcome[server.id] && (
                    <div
                      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-[11px] border ${
                        rowOutcome[server.id].type === 'ok'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/20 text-red-300'
                      }`}
                    >
                      {rowOutcome[server.id].type === 'ok' ? (
                        <Check className="w-3 h-3 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      )}
                      <span className="leading-relaxed break-words">{rowOutcome[server.id].text}</span>
                    </div>
                  )}

                  {isOpen && entry?.path && (
                    <p className="text-[11px] text-text-muted font-mono break-all bg-surface-active/30 rounded-md px-2 py-1.5">
                      {entry.path}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-[11px] text-text-muted leading-relaxed">
          {zh
            ? 'HTML / CSS / JSON 由同一个 npm 包提供，安装其中任意一项会同时就绪。'
            : 'HTML / CSS / JSON come from one npm package — installing any of them readies all three.'}
        </p>
      </section>

      {/* 安装位置 */}
      <section className="rounded-xl border border-border/50 bg-surface/40 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">{zh ? '安装位置' : 'Install location'}</h3>
        <p className="text-xs text-text-muted leading-relaxed">
          {zh
            ? '服务器安装在该目录下，切换目录后需要在新位置重新安装已用的服务器。'
            : 'Servers are installed into this directory. After switching, reinstall the ones you use.'}
        </p>

        <div className="rounded-lg bg-surface-active/30 border border-border/30 px-3 py-2">
          <p className="text-[11px] text-text-muted font-mono break-all">{binDir || '—'}</p>
        </div>

        <div className="flex items-center gap-2">
          <ActionButton variant="secondary" size="sm" onClick={() => void changeBinDir()}>
            <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
            {zh ? '更改目录' : 'Change directory'}
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="sm"
            onClick={() => void resetBinDir()}
            disabled={!defaultBinDir || binDir === defaultBinDir}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            {zh ? '恢复默认' : 'Reset to default'}
          </ActionButton>
        </div>

        {defaultBinDir && binDir !== defaultBinDir && (
          <p className="text-[11px] text-text-muted">
            {zh ? '默认目录：' : 'Default: '}
            <span className="font-mono break-all">{defaultBinDir}</span>
          </p>
        )}
      </section>
    </div>
  )
}
