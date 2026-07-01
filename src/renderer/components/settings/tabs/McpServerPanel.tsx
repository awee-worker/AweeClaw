/**
 * MCP 设置页面
 * 管理 MCP 服务器配置和状态
 * 单列流式布局，列表式展示服务器
 */

import { api } from '../../../adapters/electronBridge'
import { useState, useEffect, useRef, useMemo } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
  Server,
  RefreshCw,
  Power,
  PowerOff,
  AlertCircle,
  Loader2,
  Wrench,
  FileText,
  MessageSquare,
  ExternalLink,
  FolderOpen,
  Plus,
  Trash2,
  Settings,
  ChevronDown,
  Globe,
  Key,
  Lightbulb,
  Search,
  MoreHorizontal,
  Info,
  Zap,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { mcpService } from '@services/toolProtocolAdapter'
import { ActionButton, ToggleSwitch } from '@components/ui'
import type { McpServerStatus } from '@shared/protocols/toolProtocolBridge'
import { isRemoteConfig, isLocalConfig } from '@shared/protocols/toolProtocolBridge'
import { MCP_PRESETS } from '@shared/configuration/toolProtocolPresets'
import McpServerConnectDialog, { type McpServerFormData } from './McpServerConnectDialog'
import { t, type Language } from '@renderer/i18n'

interface McpSettingsProps {
  language: 'en' | 'zh'
  mcpConfig: { autoConnect?: boolean }
  setMcpConfig: (config: { autoConnect?: boolean }) => void
}

const STATUS_STYLES: Record<McpServerStatus, { dot: string; text: string }> = {
  connected: { dot: 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]', text: 'text-green-400' },
  connecting: { dot: 'bg-yellow-500 animate-pulse', text: 'text-yellow-400' },
  error: { dot: 'bg-red-500', text: 'text-red-400' },
  disconnected: { dot: 'bg-text-muted/40', text: 'text-text-muted' },
  needs_auth: { dot: 'bg-orange-500', text: 'text-orange-400' },
  needs_registration: { dot: 'bg-orange-500', text: 'text-orange-400' },
}

export default function McpServerPanel({ language, mcpConfig, setMcpConfig }: McpSettingsProps) {
  const { mcpServers, mcpLoading, mcpError } = useStore(useShallow(s => ({
    mcpServers: s.mcpServers,
    mcpLoading: s.mcpLoading,
    mcpError: s.mcpError,
  })))

  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [configPaths, setConfigPaths] = useState<{ user: string; workspace: string[] } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [oauthPendingServers, setOauthPendingServers] = useState<Set<string>>(new Set())
  const [serverSearch, setServerSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'connected' | 'disconnected' | 'error'>('all')

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null)
  const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  useEffect(() => {
    loadConfigPaths()
  }, [])

  useEffect(() => {
    setOauthPendingServers(prev => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      let changed = false
      for (const serverId of prev) {
        const server = mcpServers.find(s => s.id === serverId)
        if (!server || server.status === 'connected' || server.status === 'error' || server.status === 'needs_auth') {
          next.delete(serverId)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [mcpServers])

  useEffect(() => {
    if (!activeMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-mcp-menu]')) {
        setActiveMenu(null)
        setMenuPosition(null)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [activeMenu])

  const loadConfigPaths = async () => {
    const paths = await mcpService.getConfigPaths()
    setConfigPaths(paths)
  }

  const handleReloadConfig = async () => {
    setActionLoading('reload')
    await mcpService.reloadConfig()
    setActionLoading(null)
  }

  const handleConnectServer = async (serverId: string) => {
    setActionLoading(serverId)
    await mcpService.connectServer(serverId)
    setActionLoading(null)
  }

  const handleDisconnectServer = async (serverId: string) => {
    setActionLoading(serverId)
    await mcpService.disconnectServer(serverId)
    setActionLoading(null)
  }

  const handleRefreshCapabilities = async (serverId: string) => {
    setActionLoading(`refresh-${serverId}`)
    await mcpService.refreshCapabilities(serverId)
    setActionLoading(null)
  }

  const handleAddServer = async (config: McpServerFormData): Promise<boolean> => {
    try {
      const success = await mcpService.addServer(config, config.saveLevel)
      if (success) {
        await mcpService.reloadConfig()
      }
      return success
    } catch (err) {
      logger.settings.error('Failed to add server:', err)
      return false
    }
  }

  const handleDeleteServer = async (serverId: string) => {
    setActionLoading(`delete-${serverId}`)
    try {
      const success = await mcpService.removeServer(serverId)
      if (success) {
        await mcpService.reloadConfig()
      }
    } catch (err) {
      logger.settings.error('Failed to delete server:', err)
    }
    setActionLoading(null)
    setDeleteConfirm(null)
    setActiveMenu(null)
    setMenuPosition(null)
  }

  const handleToggleServer = async (serverId: string, disabled: boolean) => {
    setActionLoading(`toggle-${serverId}`)
    try {
      await mcpService.toggleServer(serverId, disabled)
      await mcpService.reloadConfig()
    } catch (err) {
      logger.settings.error('Failed to toggle server:', err)
    }
    setActionLoading(null)
  }

  const openConfigFile = async (path: string) => {
    try {
      await api.file.showInFolder(path)
    } catch (err) {
      logger.settings.error('Failed to open config file:', err)
    }
  }

  const handleStartOAuth = async (serverId: string) => {
    setActionLoading(`oauth-${serverId}`)
    try {
      await mcpService.startOAuth(serverId)
      setOauthPendingServers(prev => new Set(prev).add(serverId))
    } catch (err) {
      logger.settings.error('Failed to start OAuth:', err)
    }
    setActionLoading(null)
  }

  const handleCancelOAuth = async (serverId: string) => {
    setOauthPendingServers(prev => { const s = new Set(prev); s.delete(serverId); return s })
    await mcpService.disconnectServer(serverId)
  }

  const getStatusText = (status: McpServerStatus) => {
    const texts: Record<McpServerStatus, string> = {
      connected: t('mcp.statusConnected', language as Language),
      connecting: t('mcp.statusConnecting', language as Language),
      error: t('mcp.statusError', language as Language),
      disconnected: t('mcp.statusDisconnected', language as Language),
      needs_auth: t('mcp.statusNeedsAuth', language as Language),
      needs_registration: t('mcp.statusNeedsRegistration', language as Language),
    }
    return texts[status]
  }

  const filteredServers = useMemo(() => {
    let result = mcpServers
    if (filterStatus !== 'all') {
      result = result.filter(s => {
        if (filterStatus === 'connected') return s.status === 'connected'
        if (filterStatus === 'disconnected') return s.status === 'disconnected'
        if (filterStatus === 'error') return s.status === 'error'
        return true
      })
    }
    if (serverSearch.trim()) {
      const q = serverSearch.toLowerCase()
      result = result.filter(s =>
        s.config.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (isLocalConfig(s.config) && s.config.command?.toLowerCase().includes(q)) ||
        (isRemoteConfig(s.config) && s.config.url?.toLowerCase().includes(q))
      )
    }
    return result
  }, [mcpServers, filterStatus, serverSearch])

  const connectedCount = mcpServers.filter(s => s.status === 'connected').length
  const errorCount = mcpServers.filter(s => s.status === 'error').length
  const disconnectedCount = mcpServers.filter(s => s.status === 'disconnected').length

  
  const activeMenuServer = activeMenu ? mcpServers.find(s => s.id === activeMenu) : null

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* 已配置服务器 */}
      <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        <div className="relative">
          {/* 标题栏 */}
          <div className="flex items-center justify-between p-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h5 className="text-sm font-semibold text-text-primary">{t('mcp.servers', language as Language)}</h5>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {connectedCount}/{mcpServers.length} {t('mcp.connected', language as Language)}
                  {errorCount > 0 && (
                    <span className="ml-2 text-red-400">{errorCount} {t('mcp.error', language as Language)}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReloadConfig}
                disabled={actionLoading === 'reload'}
                className="p-1.5 text-text-muted hover:text-accent transition-colors rounded-md hover:bg-accent/10 disabled:opacity-50"
                title={t('mcp.refreshConfig', language as Language)}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'reload' ? 'animate-spin' : ''}`} />
              </button>
              <ActionButton
                variant="primary"
                size="sm"
                onClick={() => setShowAddModal(true)}
                className="text-xs"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {t('mcp.add', language as Language)}
              </ActionButton>
            </div>
          </div>

          {/* 搜索和筛选 */}
          <div className="px-5 pb-3 flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/50" />
              <input
                type="text"
                value={serverSearch}
                onChange={(e) => setServerSearch(e.target.value)}
                placeholder={t('mcp.searchServers', language as Language)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background/40 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all"
              />
              {serverSearch && (
                <button onClick={() => setServerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted text-xs">✕</button>
              )}
            </div>
            <div className="flex items-center rounded-lg border border-border/50 bg-background/30 overflow-hidden">
              {([
                ['all', t('mcp.filterAll', language as Language), mcpServers.length],
                ['connected', t('mcp.filterConnected', language as Language), connectedCount],
                ['disconnected', t('mcp.filterDisconnected', language as Language), disconnectedCount],
                ['error', t('mcp.filterError', language as Language), errorCount],
              ] as [string, string, number][]).filter(([, , count]) => count > 0 || filterStatus === 'all').map(([val, label, count]) => (
                <button
                  key={val}
                  onClick={() => setFilterStatus(val as typeof filterStatus)}
                  className={`text-[11px] px-2 py-1 transition-colors flex items-center gap-1 ${filterStatus === val
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                  }`}
                >
                  {label}
                  <span className="text-[10px] opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 说明 */}
          <div className="px-5 pb-3">
            <p className="text-[11px] text-text-muted/70">
              {t('app.mcpserversextendai', language as Language)}
            </p>
          </div>

          {/* 自动连接开关 */}
          <div className="px-5 pb-3">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/20 border border-border/30">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-accent/60" />
                <span className="text-[11px] text-text-secondary">{t('mcp.autoConnect', language as Language)}</span>
              </div>
              <ToggleSwitch
                checked={mcpConfig.autoConnect ?? true}
                onChange={(e) => setMcpConfig({ autoConnect: e.target.checked })}
              />
            </div>
          </div>

          {/* 服务器列表 */}
          <div className="px-5 pb-5">
            {mcpError && (
              <div className="flex items-start gap-2 p-3 mb-3 bg-red-500/10 rounded-lg text-red-400 text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{mcpError}</span>
              </div>
            )}

            {mcpLoading ? (
              <div className="h-32 flex items-center justify-center text-text-muted">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : mcpServers.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-text-muted border border-dashed border-border/50 rounded-xl gap-2">
                <Server className="w-10 h-10 opacity-30" />
                <span className="text-xs">{t('mcp.noServers', language as Language)}</span>
              </div>
            ) : filteredServers.length === 0 ? (
              <div className="h-24 flex items-center justify-center text-text-muted text-xs">
                {serverSearch
                  ? t('mcp.noMatchingServers', language as Language)
                  : t('mcp.noFilterMatch', language as Language)}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredServers.map((server) => {
                  const isExpanded = expandedServer === server.id
                  const isLoading = actionLoading?.startsWith(server.id) || actionLoading === `refresh-${server.id}` || actionLoading === `oauth-${server.id}`
                  const isRemote = server.config.type === 'remote'
                  const isOAuthPending = oauthPendingServers.has(server.id)
                  const style = STATUS_STYLES[server.status] || STATUS_STYLES.disconnected

                  return (
                    <div
                      key={server.id}
                      className={`rounded-xl border transition-all duration-200 overflow-hidden ${server.config.disabled
                        ? 'bg-surface/10 border-border/30 opacity-50'
                        : 'bg-surface/40 border-border/60 hover:border-accent/30'
                      }`}
                    >
                      {/* 主内容行 */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        {/* 图标 + 状态点 */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${server.config.disabled ? 'bg-white/5' : isRemote ? 'bg-blue-500/10' : 'bg-accent/10'}`}>
                            {isRemote ? (
                              <Globe className={`w-4 h-4 ${server.config.disabled ? 'text-text-muted/50' : 'text-blue-400'}`} />
                            ) : (
                              <Server className={`w-4 h-4 ${server.config.disabled ? 'text-text-muted/50' : 'text-accent'}`} />
                            )}
                          </div>
                          {!server.config.disabled && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background">
                              <div className={`w-full h-full rounded-full ${style.dot}`} />
                            </div>
                          )}
                        </div>

                        {/* 名称和信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-text-primary">{server.config.name}</span>
                            {server.config.source && (
                              <span className={`text-[10px] px-1.5 py-px rounded ${server.config.source === 'workspace'
                                ? 'bg-green-500/15 text-green-400'
                                : 'bg-purple-500/15 text-purple-400'
                              }`}>
                                {server.config.source === 'workspace' ? t('mcp.workspace', language as Language) : t('mcp.global', language as Language)}
                              </span>
                            )}
                            {isRemote && (
                              <span className="text-[10px] px-1.5 py-px rounded bg-blue-500/15 text-blue-400">Remote</span>
                            )}
                            {!server.config.disabled && (
                              <span className={`text-[10px] px-1.5 py-px rounded ${style.text} bg-white/5`}>
                                {getStatusText(server.status)}
                              </span>
                            )}
                            {server.config.disabled && (
                              <span className="text-[10px] px-1.5 py-px rounded bg-white/5 text-text-muted/50">{t('mcp.disabled', language as Language)}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-text-muted/60 mt-0.5 truncate font-mono">
                            {server.config.type === 'builtin'
                              ? (language === 'zh' ? '内置进程内服务' : 'Built-in in-process')
                              : isRemote
                                ? ('url' in server.config ? server.config.url : '')
                                : `${'command' in server.config ? server.config.command : ''}${isLocalConfig(server.config) && server.config.args?.length ? ' ' + server.config.args.join(' ') : ''}`
                            }
                          </p>
                        </div>

                        {/* 工具数量 */}
                        {server.tools.length > 0 && !server.config.disabled && (
                          <div className="hidden md:flex items-center gap-1 text-[10px] text-text-muted/50 flex-shrink-0">
                            <Wrench className="w-3 h-3" />
                            {server.tools.length}
                          </div>
                        )}

                        {/* OAuth 等待状态 */}
                        {isOAuthPending && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                            <span className="text-[11px] text-orange-400">{t('mcp.authInProgress', language as Language)}</span>
                            <button
                              onClick={() => handleCancelOAuth(server.id)}
                              className="text-[11px] text-text-muted hover:text-red-400 ml-1"
                            >
                              {t('mcp.cancelOAuth', language as Language)}
                            </button>
                          </div>
                        )}

                        {/* 快捷操作：连接/断开/认证 */}
                        {!server.config.disabled && !isOAuthPending && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(server.status === 'needs_auth' || server.status === 'needs_registration') && (
                              <button
                                onClick={() => handleStartOAuth(server.id)}
                                disabled={isLoading}
                                className="p-1 text-orange-400 hover:bg-orange-500/10 rounded-md transition-colors"
                                title={t('mcp.auth', language as Language)}
                              >
                                <Key className="w-4 h-4" />
                              </button>
                            )}
                            {server.status === 'connected' && (
                              <button
                                onClick={() => handleDisconnectServer(server.id)}
                                disabled={isLoading}
                                className="p-1 text-text-muted/50 hover:text-text-secondary hover:bg-surface-hover/50 rounded-md transition-colors"
                                title={t('mcp.disconnect', language as Language)}
                              >
                                <PowerOff className="w-4 h-4" />
                              </button>
                            )}
                            {server.status === 'disconnected' && (
                              <button
                                onClick={() => handleConnectServer(server.id)}
                                disabled={isLoading}
                                className="p-1 text-green-400/70 hover:text-green-400 hover:bg-green-500/10 rounded-md transition-colors"
                                title={t('mcp.connect', language as Language)}
                              >
                                <Power className="w-4 h-4" />
                              </button>
                            )}
                            {server.status === 'connecting' && (
                              <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                            )}
                          </div>
                        )}

                        {/* 启用/禁用开关 */}
                        <button
                          onClick={() => handleToggleServer(server.id, !server.config.disabled)}
                          disabled={isLoading}
                          className={`flex-shrink-0 transition-colors ${server.config.disabled ? 'text-text-muted/40' : 'text-accent'}`}
                          title={server.config.disabled ? t('mcp.enable', language as Language) : t('mcp.disable', language as Language)}
                        >
                          {server.config.disabled ? (
                            <ToggleLeft className="w-5 h-5" />
                          ) : (
                            <ToggleRight className="w-5 h-5" />
                          )}
                        </button>

                        {/* 更多操作 */}
                        <div className="relative flex-shrink-0" data-mcp-menu={server.id}>
                          <button
                            ref={(el) => {
                              if (el) menuButtonRefs.current.set(server.id, el)
                              else menuButtonRefs.current.delete(server.id)
                            }}
                            onClick={() => {
                              if (activeMenu === server.id) {
                                setActiveMenu(null)
                                setMenuPosition(null)
                              } else {
                                const btn = menuButtonRefs.current.get(server.id)
                                if (btn) {
                                  const rect = btn.getBoundingClientRect()
                                  setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                                }
                                setActiveMenu(server.id)
                              }
                            }}
                            className="p-1 text-text-muted/50 hover:text-text-secondary hover:bg-surface-hover/50 rounded-md transition-colors"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* 展开详情 */}
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-0 animate-fade-in">
                          <div className="ml-11 p-3 rounded-lg bg-background/30 border border-border/30 space-y-4">
                            {/* 错误信息 */}
                            {server.error && !isOAuthPending && (
                              <div className="flex items-start gap-2 p-2.5 bg-red-500/10 rounded-lg border border-red-500/20 text-red-400 text-[11px]">
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <span className="leading-relaxed">{server.error}</span>
                              </div>
                            )}

                            {/* OAuth 等待提示 */}
                            {isOAuthPending && (
                              <div className="flex items-start gap-2 p-2.5 bg-orange-500/10 rounded-lg border border-orange-500/20 text-orange-300 text-[11px]">
                                <Loader2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 animate-spin" />
                                <span>{t('mcp.authBrowserHint', language as Language)}</span>
                              </div>
                            )}

                            {/* 认证状态 */}
                            {isRemote && server.authStatus && (
                              <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${
                                server.authStatus === 'authenticated'
                                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                  : server.authStatus === 'expired'
                                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                                  : 'bg-white/5 text-text-muted border-border/50'
                              }`}>
                                <Key className="w-3.5 h-3.5" />
                                {server.authStatus === 'authenticated' && t('mcp.authenticated', language as Language)}
                                {server.authStatus === 'expired' && t('mcp.authExpired', language as Language)}
                                {server.authStatus === 'not_authenticated' && t('mcp.notAuthenticated', language as Language)}
                              </div>
                            )}

                            {/* 配置详情 */}
                            <div>
                              <span className="text-[10px] text-text-muted/60 uppercase tracking-wider">{t('mcp.configDetails', language as Language)}</span>
                              <div className="text-[11px] text-text-secondary space-y-1 font-mono bg-black/20 p-3 rounded-lg border border-border/30 mt-1">
                                <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">id:</span> <span className="select-all">{server.id}</span></div>
                                <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">type:</span> <span>{server.config.type}</span></div>
                                {isRemote ? (
                                  <>
                                    {isRemoteConfig(server.config) && (
                                      <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">url:</span> <span className="select-all">{server.config.url}</span></div>
                                    )}
                                    {isRemoteConfig(server.config) && server.config.oauth !== false && (
                                      <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">oauth:</span> <span>enabled</span></div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {isLocalConfig(server.config) && (
                                      <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">command:</span> <span className="text-accent">{server.config.command}</span></div>
                                    )}
                                    {isLocalConfig(server.config) && server.config.args && server.config.args.length > 0 && (
                                      <div className="flex"><span className="text-text-muted/60 w-16 shrink-0">args:</span> <span>{server.config.args.join(' ')}</span></div>
                                    )}
                                    {isLocalConfig(server.config) && server.config.env && Object.keys(server.config.env).length > 0 && (
                                      <div>
                                        <span className="text-text-muted/60 block mb-0.5">env:</span>
                                        {Object.entries(server.config.env as Record<string, string>).map(([k, v]) => (
                                          <div key={k} className="ml-4 flex gap-1"><span className="text-text-primary">{k}</span>=<span className="text-text-muted/60">{v.length > 20 ? v.slice(0, 8) + '***' : v}</span></div>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            {/* 工具列表 */}
                            {server.tools.length > 0 && (
                              <div>
                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider flex items-center gap-1">
                                  <Wrench className="w-3 h-3" />
                                  {t('mcp.tools', language as Language)} ({server.tools.length})
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                                  {server.tools.map((tool) => (
                                    <div
                                      key={tool.name}
                                      className="px-2.5 py-1.5 bg-black/20 rounded-md border border-border/30 hover:border-accent/30 transition-colors"
                                      title={tool.description}
                                    >
                                      <div className="text-[11px] font-medium text-text-primary truncate">{tool.name}</div>
                                      {tool.description && (
                                        <div className="text-[10px] text-text-muted/60 line-clamp-1 mt-0.5">{tool.description}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 资源 */}
                            {server.resources.length > 0 && (
                              <div>
                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  {t('mcp.resources', language as Language)} ({server.resources.length})
                                </span>
                                <div className="space-y-1 mt-1">
                                  {server.resources.map((resource) => (
                                    <div key={resource.uri} className="px-2.5 py-1.5 bg-black/20 rounded-md border border-border/30">
                                      <div className="text-[11px] font-medium text-text-primary truncate">{resource.name}</div>
                                      <div className="text-[10px] text-text-muted/60 truncate">{resource.uri}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 提示模板 */}
                            {server.prompts.length > 0 && (
                              <div>
                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  {t('mcp.prompts', language as Language)} ({server.prompts.length})
                                </span>
                                <div className="space-y-1 mt-1">
                                  {server.prompts.map((prompt) => (
                                    <div key={prompt.name} className="px-2.5 py-1.5 bg-black/20 rounded-md border border-border/30">
                                      <div className="text-[11px] font-medium text-text-primary">{prompt.name}</div>
                                      {prompt.description && (
                                        <div className="text-[10px] text-text-muted/60 truncate">{prompt.description}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 自动批准 */}
                            {server.config.autoApprove && server.config.autoApprove.length > 0 && (
                              <div>
                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider">{t('mcp.autoApproved', language as Language)}</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {server.config.autoApprove.map((tool) => (
                                    <span key={tool} className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded">{tool}</span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 使用示例 */}
                            {(() => {
                              const presetId = server.config.presetId
                              const preset = presetId ? MCP_PRESETS.find(p => p.id === presetId) : undefined
                              const usageExamples = language === 'zh' ? preset?.usageExamplesZh : preset?.usageExamples
                              if (!usageExamples || usageExamples.length === 0) return null
                              return (
                                <div>
                                  <span className="text-[10px] text-text-muted/60 uppercase tracking-wider flex items-center gap-1">
                                    <Lightbulb className="w-3 h-3" />
                                    {t('mcp.examples', language as Language)}
                                  </span>
                                  <div className="space-y-1 mt-1">
                                    {usageExamples.map((example) => (
                                      <div key={example.slice(0, 30)} className="px-2.5 py-1.5 bg-yellow-500/5 border border-yellow-500/15 rounded-md text-[11px] text-text-secondary">
                                        {example}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 配置文件位置 */}
      {configPaths && (
        <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <button
            onClick={() => setExpandedServer(expandedServer === '__config__' ? null : '__config__')}
            className="w-full flex items-center justify-between p-5 cursor-pointer focus:outline-none relative z-10"
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                <Settings className="w-4 h-4" />
              </div>
              <div className="text-left">
                <h5 className="text-sm font-semibold text-text-primary">{t('mcp.configFiles', language as Language)}</h5>
                <p className="text-[11px] text-text-muted mt-0.5">{t('mcp.configFilesDesc', language as Language)}</p>
              </div>
            </div>
            <div className={`p-1.5 rounded-full bg-surface-hover transition-transform duration-300 ${expandedServer === '__config__' ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            </div>
          </button>

          <div className={`grid transition-all duration-300 ease-in-out ${expandedServer === '__config__' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="overflow-hidden">
              <div className="px-5 pb-5 space-y-2 relative z-10">
                <div
                  className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-border/40 cursor-pointer hover:border-accent/30 transition-colors"
                  onClick={() => openConfigFile(configPaths.user)}
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs text-text-secondary">{t('mcp.userConfig', language as Language)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted/60 font-mono truncate max-w-[250px]">{configPaths.user}</span>
                    <ExternalLink className="w-3 h-3 text-text-muted/50" />
                  </div>
                </div>
                {configPaths.workspace.map((path, index) => (
                  <div
                    key={path}
                    className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-border/40 cursor-pointer hover:border-accent/30 transition-colors"
                    onClick={() => openConfigFile(path)}
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
                      <span className="text-xs text-text-secondary">{t('app.workspaceconfig', language as Language, { p0: index + 1 })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-muted/60 font-mono truncate max-w-[250px]">{path}</span>
                      <ExternalLink className="w-3 h-3 text-text-muted/50" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 使用提示 */}
      <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 text-xs text-text-muted">
        <p className="font-medium text-accent/80 mb-2">{t('mcp.tips', language as Language)}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <Server className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-text-secondary font-medium">{t('mcp.localServer', language as Language)}</span>
              <p className="text-[11px] text-text-muted/70 mt-0.5">{t('mcp.localServerDesc', language as Language)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Globe className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-text-secondary font-medium">{t('mcp.remoteServer', language as Language)}</span>
              <p className="text-[11px] text-text-muted/70 mt-0.5">{t('mcp.remoteServerDesc', language as Language)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Wrench className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-text-secondary font-medium">{t('mcp.toolExtension', language as Language)}</span>
              <p className="text-[11px] text-text-muted/70 mt-0.5">{t('mcp.toolExtensionDesc', language as Language)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 浮动菜单 */}
      {activeMenu && menuPosition && activeMenuServer && (() => {
        const server = activeMenuServer
        return (
          <div
            style={{ position: 'fixed', top: menuPosition.top, right: menuPosition.right, zIndex: 9999 }}
            className="w-36 bg-surface border border-border/60 rounded-lg shadow-xl py-1 animate-fade-in"
            data-mcp-menu={server.id}
          >
            {server.status === 'connected' && (
              <button
                onClick={() => {
                  setActiveMenu(null)
                  setMenuPosition(null)
                  handleRefreshCapabilities(server.id)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('mcp.refreshCapabilities', language as Language)}
              </button>
            )}
            <button
              onClick={() => {
                setActiveMenu(null)
                setMenuPosition(null)
                setExpandedServer(expandedServer === server.id ? null : server.id)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
            >
              <Info className="w-3.5 h-3.5" />
              {t('mcp.details', language as Language)}
            </button>
            <div className="border-t border-border/30 my-1"></div>
            <button
              onClick={() => {
                if (deleteConfirm === server.id) {
                  handleDeleteServer(server.id)
                } else {
                  setDeleteConfirm(server.id)
                  setTimeout(() => setDeleteConfirm(null), 3000)
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${deleteConfirm === server.id
                ? 'text-red-400 bg-red-500/10 font-medium'
                : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-400'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteConfirm === server.id ? t('mcp.confirmDelete', language as Language) : t('mcp.delete', language as Language)}
            </button>
          </div>
        )
      })()}

      {/* 添加服务器弹窗 */}
      <McpServerConnectDialog
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddServer}
        language={language}
        existingServerIds={mcpServers.map(s => s.id)}
      />
    </div>
  )
}
