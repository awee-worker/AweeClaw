/**
 * PluginInstalledPanel — 已安装插件管理面板
 *
 * 职责：
 * - 列出本地已安装的插件
 * - 启用 / 禁用 / 卸载插件
 * - 检查更新
 * - 显示插件元信息（版本 / 类型 / MCP 服务状态）
 *
 * 数据流：
 *   列表 ← pluginService.getInstalledPlugins → IPC
 *   操作 ← pluginService.enable/disable/uninstall → IPC
 */
import { useState, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import {
  getInstalledPlugins,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  checkPluginUpdate,
} from '@services/pluginService'
import type { InstalledPlugin } from '@services/pluginService'
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
}

/** 插件类型徽章 */
const TYPE_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  mcp: { zh: 'MCP 工具', en: 'MCP Tool', color: 'bg-purple-500/15 text-purple-400' },
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

  const [plugins, setPlugins] = useState<InstalledPlugin[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [operating, setOperating] = useState<string | null>(null)
  const [updates, setUpdates] = useState<Record<string, { hasUpdate: boolean; latestVersion?: string }>>({})
  // 配置编辑对话框
  const [configTarget, setConfigTarget] = useState<{ pluginKey: string; name: string; fields: PluginConfigField[] } | null>(null)

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

  // 空状态
  if (!isLoading && plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Package className="w-8 h-8 text-text-muted/40 mb-3" />
        <p className="text-xs text-text-muted mb-1">
          {language === 'zh' ? '暂无已安装插件' : 'No installed plugins'}
        </p>
        <p className="text-[12px] text-text-muted/60">
          {language === 'zh' ? '前往插件市场安装插件' : 'Go to marketplace to install plugins'}
        </p>
      </div>
    )
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {language === 'zh' ? '已安装' : 'Installed'}
          </span>
          <span className="text-[12px] text-text-muted">({plugins.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton
            onClick={handleCheckAllUpdates}
            variant="ghost"
            size="sm"
            disabled={operating === '__check_updates__' || plugins.length === 0}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${operating === '__check_updates__' ? 'animate-spin' : ''}`} />
            <span>{language === 'zh' ? '检查更新' : 'Check Updates'}</span>
          </ActionButton>
          <ActionButton onClick={loadPlugins} variant="ghost" size="sm" disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </ActionButton>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {plugins.map((plugin) => (
              <PluginRow
                key={plugin.pluginKey}
                plugin={plugin}
                language={language}
                operating={operating === plugin.pluginKey}
                updateInfo={updates[plugin.pluginKey]}
                onEnable={() => handleEnable(plugin)}
                onDisable={() => handleDisable(plugin)}
                onUninstall={() => handleUninstall(plugin)}
                onOpenConfig={() => handleOpenConfig(plugin)}
              />
            ))}
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

// ─── 子组件：插件行 ────────────────────────────────────

/**
 * 判断 icon 是否为图片（URL 或 data URL）
 * - http/https URL：远程图片
 * - data: URL：base64 编码的图片（用户上传的图标）
 */
function isImageIcon(icon: string | null | undefined): icon is string {
  if (!icon) return false
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:')
}

function PluginRow({
  plugin,
  language,
  operating,
  updateInfo,
  onEnable,
  onDisable,
  onUninstall,
  onOpenConfig,
}: {
  plugin: InstalledPlugin
  language: Language
  operating: boolean
  updateInfo?: { hasUpdate: boolean; latestVersion?: string }
  onEnable: () => void
  onDisable: () => void
  onUninstall: () => void
  onOpenConfig: () => void
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
  const category = manifest.category || 'productivity'

  return (
    <div className="px-4 py-3 hover:bg-bg-hover/30 transition-colors">
      <div className="flex items-start gap-3">
        {/* 图标：优先显示自定义上传的图片，否则回退到分类图标 / Package 默认图标 */}
        <div
          className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden ${
            plugin.enabled ? 'bg-accent/10' : 'bg-bg-hover'
          }`}
        >
          {isImageIcon(manifest.icon) ? (
            <img
              src={manifest.icon}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={(e) => {
                // 图片加载失败时回退到分类图标 / Package 图标
                const target = e.currentTarget
                target.style.display = 'none'
                const fallback = target.nextElementSibling as HTMLElement | null
                if (fallback) fallback.style.display = 'flex'
              }}
            />
          ) : null}
          <div
            className={`w-full h-full flex items-center justify-center ${
              plugin.enabled ? 'text-accent' : 'text-text-muted'
            }`}
            style={isImageIcon(manifest.icon) ? { display: 'none' } : undefined}
          >
            {CATEGORY_ICONS[category] || <Package className="w-5 h-5" />}
          </div>
        </div>

        {/* 主体 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-xs font-medium truncate ${!plugin.enabled && 'text-text-muted'}`}>
              {displayName}
            </span>
            {typeLabel && (
              <span className={`shrink-0 px-1.5 py-0.5 text-[12px] rounded ${typeLabel.color}`}>
                {language === 'zh' ? typeLabel.zh : typeLabel.en}
              </span>
            )}
            {plugin.enabled ? (
              <CheckCircle2 className="shrink-0 w-3 h-3 text-green-400" />
            ) : (
              <XCircle className="shrink-0 w-3 h-3 text-text-muted/60" />
            )}
            {updateInfo?.hasUpdate && (
              <span className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 text-[12px] rounded bg-orange-500/15 text-orange-400">
                <AlertCircle className="w-2.5 h-2.5" />
                {language === 'zh' ? '有更新' : 'Update'}
              </span>
            )}
          </div>

          {description && (
            <p className="text-[12px] text-text-muted line-clamp-1 mb-1">{description}</p>
          )}

          <div className="flex items-center gap-2 text-[12px] text-text-muted/70">
            <span>v{plugin.version}</span>
            <span>·</span>
            <span>{new Date(plugin.installedAt).toLocaleDateString()}</span>
            {plugin.mcpServerId && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-purple-400">
                  <Sparkles className="w-2.5 h-2.5" />
                  MCP
                </span>
              </>
            )}
            {updateInfo?.hasUpdate && updateInfo.latestVersion && (
              <>
                <span>·</span>
                <span className="text-orange-400">
                  → v{updateInfo.latestVersion}
                </span>
              </>
            )}
            {manifest.homepage && (
              <>
                <span>·</span>
                <a
                  href={manifest.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-0.5 text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {language === 'zh' ? '主页' : 'Home'}
                </a>
              </>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="shrink-0 flex items-center gap-1">
          {/* 配置按钮：仅当插件声明了 configSchema.fields 时展示 */}
          {manifest.configSchema?.fields && manifest.configSchema.fields.length > 0 && (
            <ActionButton
              onClick={onOpenConfig}
              variant="ghost"
              size="sm"
              disabled={operating}
              title={language === 'zh' ? '配置' : 'Settings'}
            >
              <Settings className="w-3.5 h-3.5" />
            </ActionButton>
          )}
          {plugin.enabled ? (
            <ActionButton
              onClick={onDisable}
              variant="ghost"
              size="sm"
              disabled={operating}
              title={language === 'zh' ? '禁用' : 'Disable'}
            >
              <PowerOff className="w-3.5 h-3.5" />
            </ActionButton>
          ) : (
            <ActionButton
              onClick={onEnable}
              variant="ghost"
              size="sm"
              disabled={operating}
              title={language === 'zh' ? '启用' : 'Enable'}
            >
              <Power className="w-3.5 h-3.5 text-green-400" />
            </ActionButton>
          )}
          <ActionButton
            onClick={onUninstall}
            variant="ghost"
            size="sm"
            disabled={operating}
            title={language === 'zh' ? '卸载' : 'Uninstall'}
          >
            {operating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-status-error/80" />
            )}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
