/**
 * PluginInstalledPanel — 已安装插件管理面板
 *
 * 职责：
 * - 以九宫格卡片形式列出本地已安装的插件
 * - 启用 / 禁用 / 卸载 / 配置 / 更新插件（操作按钮图标 + 文字）
 * - 检查更新
 * - 显示插件元信息（版本 / 类型 / MCP 服务状态）
 *
 * 数据流：
 *   列表 ← pluginService.getInstalledPlugins → IPC
 *   操作 ← pluginService.enable/disable/uninstall → IPC
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Trash2,
  Power,
  PowerOff,
  RefreshCw,
  Package,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Code2,
  Cpu,
  Sparkles,
  Layers,
  Zap,
  PenTool,
  BarChart3,
  BookOpen,
  Heart,
  TrendingUp,
  ExternalLink,
  Settings,
  Download,
  Clock,
  Globe,
  Search,
  X,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import {
  getInstalledPlugins,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  checkPluginUpdate,
  updatePlugin,
} from '@services/pluginService'
import type { InstalledPlugin } from '@services/pluginService'
import type { McpServerStatus } from '@shared/protocols/toolProtocolBridge'
import { type Language } from '@renderer/i18n'
import { PluginConfigEditDialog } from './PluginConfigEditDialog'
import type { PluginConfigField } from './PluginConfigForm'

// ─── 分类图标映射 ──────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  productivity: <Zap className="w-5 h-5" />,
  development: <Code2 className="w-5 h-5" />,
  automation: <Cpu className="w-5 h-5" />,
  data: <BarChart3 className="w-5 h-5" />,
  creative: <PenTool className="w-5 h-5" />,
  ai: <Sparkles className="w-5 h-5" />,
  business: <TrendingUp className="w-5 h-5" />,
  education: <BookOpen className="w-5 h-5" />,
  lifestyle: <Heart className="w-5 h-5" />,
  composite: <Layers className="w-5 h-5" />,
  other: <Clock className="w-5 h-5" />,
}

/** manifest.icon 字符串 → lucide 图标组件映射（与 marketplace 图标名对齐） */
const NAMED_ICONS: Record<string, React.ReactNode> = {
  Clock: <Clock className="w-5 h-5" />,
  Globe: <Globe className="w-5 h-5" />,
  Sparkles: <Sparkles className="w-5 h-5" />,
}

/** 插件类型徽章 */
const TYPE_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  mcp: { zh: 'MCP', en: 'MCP', color: 'bg-purple-500/15 text-purple-400' },
  channel: { zh: '渠道', en: 'Channel', color: 'bg-blue-500/15 text-blue-400' },
  tool: { zh: '工具', en: 'Tool', color: 'bg-green-500/15 text-green-400' },
  hook: { zh: '钩子', en: 'Hook', color: 'bg-orange-500/15 text-orange-400' },
  memory: { zh: '记忆', en: 'Memory', color: 'bg-cyan-500/15 text-cyan-400' },
  desktop: { zh: '桌面', en: 'Desktop', color: 'bg-pink-500/15 text-pink-400' },
  composite: { zh: '复合', en: 'Composite', color: 'bg-indigo-500/15 text-indigo-400' },
}

// ─── 组件 ──────────────────────────────────────────────

export function PluginInstalledPanel() {
  const language = useStore((s) => s.language) as Language
  const mcpServers = useStore(useShallow(s => s.mcpServers))

  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [operating, setOperating] = useState<string | null>(null)
  /** 正在升级的插件 pluginKey（用于按钮 loading 态） */
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, { hasUpdate: boolean; latestVersion?: string }>>({})
  // 配置编辑对话框
  const [configTarget, setConfigTarget] = useState<{ pluginKey: string; name: string; fields: PluginConfigField[] } | null>(null)
  /** 搜索关键字（匹配名称、pluginKey、描述、类型） */
  const [searchQuery, setSearchQuery] = useState('')

  /**
   * 按关键字过滤已安装插件
   *
   * 匹配字段（大小写不敏感）：
   * - 插件名（name / nameZh）
   * - pluginKey
   * - 描述（description / descriptionZh）
   * - 类型徽章（mcp / channel / tool 等）
   * - 分类（category）
   * - 版本号
   *
   * 空关键字返回全部列表（保持原引用，避免无谓重渲染）。
   */
  const filteredPlugins = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return plugins
    return plugins.filter((plugin) => {
      const manifest = plugin.manifest as {
        name?: string
        nameZh?: string
        description?: string
        descriptionZh?: string
        category?: string
      }
      const name = (manifest.name || '').toLowerCase()
      const nameZh = (manifest.nameZh || '').toLowerCase()
      const pluginKey = plugin.pluginKey.toLowerCase()
      const desc = (manifest.description || '').toLowerCase()
      const descZh = (manifest.descriptionZh || '').toLowerCase()
      const category = (manifest.category || '').toLowerCase()
      const types = (plugin.types || []).join(' ').toLowerCase()
      const version = (plugin.version || '').toLowerCase()
      return (
        name.includes(query) ||
        nameZh.includes(query) ||
        pluginKey.includes(query) ||
        desc.includes(query) ||
        descZh.includes(query) ||
        category.includes(query) ||
        types.includes(query) ||
        version.includes(query)
      )
    })
  }, [plugins, searchQuery])

  const loadPlugins = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await getInstalledPlugins()
      setPlugins(list)
    } catch (err) {
      toast.card({
        type: 'error',
        title: language === 'zh' ? '加载失败' : 'Load Failed',
        message: err instanceof Error ? err.message : String(err),
        duration: 3000,
        source: 'PluginInstalled',
      })
      setPlugins([])
    } finally {
      setIsLoading(false)
    }
  }, [language])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  /** 启用插件 */
  async function handleEnable(plugin: InstalledPlugin) {
    setOperating(plugin.pluginKey)
    try {
      const result = await enablePlugin(plugin.pluginKey)
      if (result.success) {
        toast.success(language === 'zh' ? '插件已启用' : 'Plugin enabled')
        await loadPlugins()
      } else {
        toast.error(result.error || (language === 'zh' ? '启用失败' : 'Enable failed'))
      }
    } finally {
      setOperating(null)
    }
  }

  /** 禁用插件 */
  async function handleDisable(plugin: InstalledPlugin) {
    setOperating(plugin.pluginKey)
    try {
      const result = await disablePlugin(plugin.pluginKey)
      if (result.success) {
        toast.success(language === 'zh' ? '插件已禁用' : 'Plugin disabled')
        await loadPlugins()
      } else {
        toast.error(result.error || (language === 'zh' ? '禁用失败' : 'Disable failed'))
      }
    } finally {
      setOperating(null)
    }
  }

  /** 卸载插件 */
  async function handleUninstall(plugin: InstalledPlugin) {
    const confirmMsg =
      language === 'zh'
        ? `确定卸载插件「${plugin.manifest.name as string || plugin.pluginKey}」？相关数据将被清除。`
        : `Uninstall plugin "${(plugin.manifest.name as string) || plugin.pluginKey}"? Related data will be removed.`
    if (!window.confirm(confirmMsg)) return

    setOperating(plugin.pluginKey)
    try {
      const result = await uninstallPlugin(plugin.pluginKey)
      if (result.success) {
        toast.success(language === 'zh' ? '插件已卸载' : 'Plugin uninstalled')
        await loadPlugins()
      } else {
        toast.card({
          type: 'error',
          title: language === 'zh' ? '卸载失败' : 'Uninstall Failed',
          message: result.error || 'Unknown error',
          duration: 5000,
          source: 'PluginInstalled',
        })
      }
    } finally {
      setOperating(null)
    }
  }

  /** 升级插件到最新版本（保留用户原有配置） */
  async function handleUpdate(plugin: InstalledPlugin, latestVersion: string) {
    setUpdatingKey(plugin.pluginKey)
    const displayName =
      language === 'zh'
        ? (plugin.manifest.nameZh as string) || (plugin.manifest.name as string) || plugin.pluginKey
        : (plugin.manifest.name as string) || plugin.pluginKey
    try {
      const result = await updatePlugin(plugin.pluginId, latestVersion)
      if (result.success) {
        toast.success(
          language === 'zh'
            ? `「${displayName}」已更新到 v${latestVersion}`
            : `${displayName} updated to v${latestVersion}`,
        )
        // 清除该插件的更新标记
        setUpdates(prev => {
          const next = { ...prev }
          delete next[plugin.pluginKey]
          return next
        })
        await loadPlugins()
      } else {
        toast.card({
          type: 'error',
          title: language === 'zh' ? '更新失败' : 'Update Failed',
          message: result.error || 'Unknown error',
          duration: 5000,
          source: 'PluginInstalled',
        })
      }
    } finally {
      setUpdatingKey(null)
    }
  }

  /** 检查所有插件更新 */
  async function handleCheckAllUpdates() {
    if (plugins.length === 0) return

    setOperating('__check_updates__')
    try {
      const results: Record<string, { hasUpdate: boolean; latestVersion?: string }> = {}
      await Promise.all(
        plugins.map(async (p) => {
          const info = await checkPluginUpdate(p.pluginKey)
          results[p.pluginKey] = {
            hasUpdate: info.hasUpdate,
            latestVersion: info.latestVersion,
          }
        }),
      )
      setUpdates(results)

      const hasUpdateCount = Object.values(results).filter((r) => r.hasUpdate).length
      if (hasUpdateCount > 0) {
        toast.success(
          language === 'zh'
            ? `发现 ${hasUpdateCount} 个可更新插件`
            : `${hasUpdateCount} plugins have updates`,
        )
      } else {
        toast.success(language === 'zh' ? '所有插件均为最新版本' : 'All plugins are up to date')
      }
    } finally {
      setOperating(null)
    }
  }

  /** 从 manifest 提取 configSchema.fields（类型安全） */
  function extractConfigFields(manifest: Record<string, unknown>): PluginConfigField[] {
    const schema = manifest.configSchema as { fields?: PluginConfigField[] } | undefined
    return schema?.fields || []
  }

  /** 打开配置编辑对话框 */
  function handleOpenConfig(plugin: InstalledPlugin) {
    const manifest = plugin.manifest as Record<string, unknown>
    const fields = extractConfigFields(manifest)
    const name = (manifest.nameZh as string) || (manifest.name as string) || plugin.pluginKey
    setConfigTarget({ pluginKey: plugin.pluginKey, name, fields })
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 flex-shrink-0">
        {/* 搜索框 */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/60 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'zh' ? '搜索已安装插件...' : 'Search installed plugins...'}
            className="w-full h-8 pl-8 pr-7 text-xs bg-bg-hover rounded-md border border-border/40 focus:border-accent/50 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted/60 hover:text-text-primary hover:bg-text-primary/10 transition-colors"
              title={language === 'zh' ? '清除' : 'Clear'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 计数 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium">
            {language === 'zh' ? '已安装' : 'Installed'}
          </span>
          <span className="text-[12px] text-text-muted">
            ({searchQuery ? `${filteredPlugins.length}/${plugins.length}` : plugins.length})
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ActionButton
            onClick={handleCheckAllUpdates}
            variant="ghost"
            size="sm"
            disabled={operating === '__check_updates__' || plugins.length === 0}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${operating === '__check_updates__' ? 'animate-spin' : ''}`} />
            <span>{language === 'zh' ? '检查更新' : 'Check Updates'}</span>
          </ActionButton>
          <ActionButton onClick={loadPlugins} variant="ghost" size="sm" disabled={isLoading} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </ActionButton>
        </div>
      </div>

      {/* 九宫格卡片列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : filteredPlugins.length === 0 ? (
          /* 空状态：区分「无插件」和「搜索无结果」两种情况 */
          <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
            {searchQuery ? (
              <>
                <Search className="w-6 h-6 text-text-muted/40 mb-2" />
                <p className="text-xs text-text-muted">
                  {language === 'zh'
                    ? `未找到匹配「${searchQuery}」的插件`
                    : `No plugins match "${searchQuery}"`}
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-[12px] text-accent hover:underline"
                >
                  {language === 'zh' ? '清除搜索' : 'Clear search'}
                </button>
              </>
            ) : (
              <>
                <Package className="w-8 h-8 text-text-muted/40 mb-3" />
                <p className="text-xs text-text-muted mb-1">
                  {language === 'zh' ? '暂无已安装插件' : 'No installed plugins'}
                </p>
                <p className="text-[12px] text-text-muted/60">
                  {language === 'zh' ? '前往插件市场安装插件' : 'Go to marketplace to install plugins'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
            {filteredPlugins.map((plugin) => {
              // 查找该插件对应的 MCP 服务器状态
              const mcpServer = plugin.mcpServerId
                ? mcpServers.find(s => s.id === plugin.mcpServerId)
                : undefined
              return (
                <PluginCard
                  key={plugin.pluginKey}
                  plugin={plugin}
                  language={language}
                  operating={operating === plugin.pluginKey}
                  updating={updatingKey === plugin.pluginKey}
                  updateInfo={updates[plugin.pluginKey]}
                  mcpStatus={mcpServer?.status}
                  mcpError={mcpServer?.error}
                  onEnable={() => handleEnable(plugin)}
                  onDisable={() => handleDisable(plugin)}
                  onUninstall={() => handleUninstall(plugin)}
                  onOpenConfig={() => handleOpenConfig(plugin)}
                  onUpdate={updates[plugin.pluginKey]?.latestVersion
                    ? () => handleUpdate(plugin, updates[plugin.pluginKey].latestVersion!)
                    : undefined}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* 配置编辑对话框 */}
      <PluginConfigEditDialog
        open={configTarget !== null}
        pluginKey={configTarget?.pluginKey || ''}
        pluginName={configTarget?.name || ''}
        fields={configTarget?.fields || []}
        onClose={() => setConfigTarget(null)}
      />
    </div>
  )
}

// ─── 子组件：插件卡片（九宫格单元） ───────────────────

/**
 * 判断 icon 是否为图片（URL 或 data URL）
 * - http/https URL：远程图片
 * - data: URL：base64 编码的图片（用户上传的图标）
 */
function isImageIcon(icon: string | null | undefined): icon is string {
  if (!icon) return false
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:')
}

/**
 * 卡片操作按钮：图标 + 文字，统一紧凑样式。
 * 字号 12px（符合最小字体限制），高度 28px，圆角 md。
 */
function CardActionButton({
  icon,
  label,
  onClick,
  disabled,
  loading,
  tone = 'default',
  title,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent'
  title?: string
}) {
  const toneCls = {
    default: 'text-text-secondary hover:bg-text-primary/[0.06] hover:text-text-primary',
    success: 'text-green-400 hover:bg-green-500/10 hover:text-green-300',
    warning: 'text-orange-400 hover:bg-orange-500/10 hover:text-orange-300',
    danger: 'text-status-error/80 hover:bg-status-error/10 hover:text-status-error',
    accent: 'text-accent hover:bg-accent/10',
  }[tone]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center gap-1 h-7 px-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${toneCls}`}
    >
      {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : icon}
      <span>{label}</span>
    </button>
  )
}

function PluginCard({
  plugin,
  language,
  operating,
  updating,
  updateInfo,
  mcpStatus,
  mcpError,
  onEnable,
  onDisable,
  onUninstall,
  onOpenConfig,
  onUpdate,
}: {
  plugin: InstalledPlugin
  language: Language
  operating: boolean
  /** 正在升级中（更新按钮显示 loading） */
  updating: boolean
  updateInfo?: { hasUpdate: boolean; latestVersion?: string }
  mcpStatus?: McpServerStatus
  mcpError?: string
  onEnable: () => void
  onDisable: () => void
  onUninstall: () => void
  onOpenConfig: () => void
  /** 升级回调（仅当有更新时传入） */
  onUpdate?: () => void
}) {
  const manifest = plugin.manifest as {
    name?: string
    nameZh?: string
    description?: string
    descriptionZh?: string
    category?: string
    icon?: string
    homepage?: string
    configSchema?: { fields?: PluginConfigField[] }
  }

  const displayName =
    language === 'zh'
      ? manifest.nameZh || manifest.name || plugin.pluginKey
      : manifest.name || plugin.pluginKey

  const description =
    language === 'zh'
      ? manifest.descriptionZh || manifest.description || ''
      : manifest.description || ''

  const primaryType = plugin.types?.[0] || 'tool'
  const typeLabel = TYPE_LABELS[primaryType]
  const category = manifest.category || 'other'
  const hasConfigFields = !!(manifest.configSchema?.fields && manifest.configSchema.fields.length > 0)

  /** 解析图标：图片 URL > manifest.icon 命名图标 > 分类图标 > Package 默认 */
  function renderIcon() {
    if (isImageIcon(manifest.icon)) {
      return (
        <img
          src={manifest.icon}
          alt={displayName}
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.currentTarget
            target.style.display = 'none'
            const fallback = target.nextElementSibling as HTMLElement | null
            if (fallback) fallback.style.display = 'flex'
          }}
        />
      )
    }
    // manifest.icon 为命名图标字符串（如 "Clock"）时尝试匹配
    if (manifest.icon && NAMED_ICONS[manifest.icon]) {
      return NAMED_ICONS[manifest.icon]
    }
    return CATEGORY_ICONS[category] || <Package className="w-5 h-5" />
  }

  return (
    <div
      className={`flex flex-col rounded-xl border transition-all duration-200 overflow-hidden group ${
        plugin.enabled
          ? 'border-border/40 bg-bg-base hover:border-accent/40 hover:bg-bg-hover/30'
          : 'border-border/20 bg-bg-hover/20 opacity-75 hover:border-accent/40 hover:opacity-100'
      }`}
    >
      {/* ── 卡片头部：图标 + 名称 + 状态 ── */}
      <div className="flex items-start gap-3 p-3 pb-2">
        {/* 图标 */}
        <div
          className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden ${
            plugin.enabled ? 'bg-accent/10' : 'bg-bg-hover'
          }`}
        >
          <div
            className={`w-full h-full flex items-center justify-center ${
              plugin.enabled ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {renderIcon()}
          </div>
        </div>

        {/* 名称 + 徽章 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-xs font-semibold truncate ${!plugin.enabled && 'text-text-muted'}`}>
              {displayName}
            </span>
            {plugin.enabled ? (
              <CheckCircle2 className="shrink-0 w-3 h-3 text-green-400" />
            ) : (
              <XCircle className="shrink-0 w-3 h-3 text-text-muted/60" />
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {typeLabel && (
              <span className={`shrink-0 px-1.5 py-0.5 text-[12px] rounded ${typeLabel.color}`}>
                {language === 'zh' ? typeLabel.zh : typeLabel.en}
              </span>
            )}
            {updateInfo?.hasUpdate && (
              <span className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 text-[12px] rounded bg-orange-500/15 text-orange-400">
                <AlertCircle className="w-2.5 h-2.5" />
                {language === 'zh' ? '有更新' : 'Update'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 描述（两行截断） ── */}
      {description && (
        <p className="text-[12px] text-text-muted px-3 pb-2 leading-relaxed line-clamp-2 overflow-hidden break-words">
          {description}
        </p>
      )}

      {/* ── 元信息：版本 / 安装时间 / MCP 状态 ── */}
      <div className="flex items-center gap-2 text-[12px] text-text-muted/70 px-3 pb-2 flex-wrap">
        <span>v{plugin.version}</span>
        <span>·</span>
        <span>{new Date(plugin.installedAt).toLocaleDateString()}</span>
        {plugin.mcpServerId && (
          <>
            <span>·</span>
            <span
              className={`flex items-center gap-0.5 ${
                mcpStatus === 'connected'
                  ? 'text-green-400'
                  : mcpStatus === 'error'
                    ? 'text-red-400'
                    : mcpStatus === 'connecting'
                      ? 'text-yellow-400'
                      : 'text-text-muted'
              }`}
              title={mcpStatus === 'error' && mcpError ? mcpError : undefined}
            >
              {mcpStatus === 'error' ? (
                <AlertCircle className="w-2.5 h-2.5" />
              ) : mcpStatus === 'connected' ? (
                <CheckCircle2 className="w-2.5 h-2.5" />
              ) : (
                <Sparkles className="w-2.5 h-2.5" />
              )}
              {mcpStatus === 'connected'
                ? (language === 'zh' ? 'MCP 已连接' : 'MCP Connected')
                : mcpStatus === 'error'
                  ? (language === 'zh' ? 'MCP 错误' : 'MCP Error')
                  : mcpStatus === 'connecting'
                    ? (language === 'zh' ? 'MCP 连接中' : 'MCP Connecting')
                    : (language === 'zh' ? 'MCP 未连接' : 'MCP Disconnected')}
            </span>
          </>
        )}
        {updateInfo?.hasUpdate && updateInfo.latestVersion && (
          <span className="text-orange-400">→ v{updateInfo.latestVersion}</span>
        )}
      </div>

      {/* ── 主页链接（如有） ── */}
      {manifest.homepage && (
        <div className="px-3 pb-2">
          <a
            href={manifest.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[12px] text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-2.5 h-2.5" />
            {language === 'zh' ? '主页' : 'Homepage'}
          </a>
        </div>
      )}

      {/* ── 操作按钮区：图标 + 文字 ── */}
      <div className="mt-auto border-t border-border/20 p-2">
        <div className="flex items-center flex-wrap gap-0.5">
          {/* 更新按钮：仅当检测到新版本时展示，橙色高亮 */}
          {updateInfo?.hasUpdate && onUpdate && (
            <CardActionButton
              icon={<Download className="w-3 h-3" />}
              label={language === 'zh' ? '更新' : 'Update'}
              onClick={onUpdate}
              disabled={operating || updating}
              loading={updating}
              tone="warning"
              title={language === 'zh' ? `更新到 v${updateInfo.latestVersion}` : `Update to v${updateInfo.latestVersion}`}
            />
          )}
          {/* 配置按钮：仅当插件声明了 configSchema.fields 时展示 */}
          {hasConfigFields && (
            <CardActionButton
              icon={<Settings className="w-3 h-3" />}
              label={language === 'zh' ? '配置' : 'Config'}
              onClick={onOpenConfig}
              disabled={operating}
              tone="default"
            />
          )}
          {/* 启用 / 禁用 */}
          {plugin.enabled ? (
            <CardActionButton
              icon={<PowerOff className="w-3 h-3" />}
              label={language === 'zh' ? '禁用' : 'Disable'}
              onClick={onDisable}
              disabled={operating}
              tone="default"
            />
          ) : (
            <CardActionButton
              icon={<Power className="w-3 h-3" />}
              label={language === 'zh' ? '启用' : 'Enable'}
              onClick={onEnable}
              disabled={operating}
              tone="success"
            />
          )}
          {/* 卸载 */}
          <CardActionButton
            icon={<Trash2 className="w-3 h-3" />}
            label={language === 'zh' ? '删除' : 'Delete'}
            onClick={onUninstall}
            disabled={operating}
            loading={operating}
            tone="danger"
          />
        </div>
      </div>
    </div>
  )
}
