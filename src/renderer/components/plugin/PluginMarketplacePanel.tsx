/**
 * PluginMarketplacePanel — 插件市场浏览面板
 *
 * 职责：
 * - 浏览市场插件（分类 / 搜索 / 精选）
 * - 查看插件详情
 * - 触发安装（含付费引导）
 * - 订阅安装进度
 *
 * 数据流：
 *   列表/详情 ← pluginService.browsePlugins / getPluginDetail
 *   安装      ← pluginService.installPluginFromMarketplace → IPC
 *   进度      ← pluginService.onPluginInstallProgress
 */
import { useState, useEffect } from 'react'
import {
  Search,
  Download,
  Star,
  Tag,
  Shield,
  Clock,
  ArrowLeft,
  Package,
  Heart,
  Code2,
  BarChart3,
  PenTool,
  Sparkles,
  TrendingUp,
  BookOpen,
  Globe,
  Zap,
  RefreshCw,
  CheckCircle2,
  Cpu,
  Layers,
} from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import { PluginIcon } from './PluginIcon'
import {
  browsePlugins,
  getFeaturedPlugins,
  getPluginCategories,
  installPluginFromMarketplace,
  onPluginInstallProgress,
  createPluginOrder,
  mockPayPluginOrder,
} from '@services/pluginService'
import type {
  PluginMarketItem,
  PluginCategory,
  PluginInstallProgress,
} from '@services/pluginService'
import { t, type Language } from '@renderer/i18n'

// ─── 分类图标映射 ──────────────────────────────────────

const CATEGORY_ICONS_SM: Record<string, React.ReactNode> = {
  productivity: <Zap className="w-4 h-4" />,
  development: <Code2 className="w-4 h-4" />,
  automation: <Cpu className="w-4 h-4" />,
  data: <BarChart3 className="w-4 h-4" />,
  creative: <PenTool className="w-4 h-4" />,
  ai: <Sparkles className="w-4 h-4" />,
  business: <TrendingUp className="w-4 h-4" />,
  education: <BookOpen className="w-4 h-4" />,
  lifestyle: <Heart className="w-4 h-4" />,
  composite: <Layers className="w-4 h-4" />,
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

export function PluginMarketplacePanel() {
  const language = useStore((s) => s.language) as Language
  const authenticated = useStore((s) => s.isAuthenticated)

  const [items, setItems] = useState<PluginMarketItem[]>([])
  const [featured, setFeatured] = useState<PluginMarketItem[]>([])
  const [categories, setCategories] = useState<PluginCategory[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<PluginMarketItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installProgress, setInstallProgress] = useState<PluginInstallProgress | null>(null)
  const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  // 加载精选 / 分类
  useEffect(() => {
    if (authenticated) {
      loadFeatured()
      loadCategories()
      loadInstalledKeys()
    }
  }, [authenticated])

  // 加载列表
  useEffect(() => {
    if (authenticated) {
      loadItems()
    }
  }, [searchQuery, selectedCategory, page, authenticated])

  // 订阅安装进度
  useEffect(() => {
    const unsubscribe = onPluginInstallProgress((progress: PluginInstallProgress) => {
      setInstallProgress(progress)
      if (progress.phase === 'done' || progress.phase === 'error') {
        setTimeout(() => setInstallProgress(null), 1500)
      }
    })
    return unsubscribe
  }, [])

  async function loadItems() {
    setIsLoading(true)
    try {
      const result = await browsePlugins({
        category: selectedCategory || undefined,
        search: searchQuery || undefined,
        page,
        limit: 20,
      })
      setItems(result.items)
      setTotal(result.total)
    } catch {
      setItems([])
      setTotal(0)
    } finally {
      setIsLoading(false)
    }
  }

  async function loadFeatured() {
    try {
      const result = await getFeaturedPlugins()
      setFeatured(result)
    } catch {
      setFeatured([])
    }
  }

  async function loadCategories() {
    try {
      const result = await getPluginCategories()
      setCategories(result)
    } catch {
      setCategories([])
    }
  }

  /** 加载已安装插件 key 列表，用于禁用「安装」按钮 */
  async function loadInstalledKeys() {
    try {
      const { getInstalledPlugins } = await import('@services/pluginService')
      const installed = await getInstalledPlugins()
      setInstalledKeys(new Set(installed.map((p: { pluginKey: string }) => p.pluginKey)))
    } catch {
      // 静默失败
    }
  }

  /** 触发安装（免费直接安装，付费先走支付流程） */
  async function handleInstall(item: PluginMarketItem) {
    if (installedKeys.has(item.pluginKey)) {
      toast.warning(language === 'zh' ? `插件「${item.nameZh}」已安装` : `Plugin "${item.name}" is already installed`)
      return
    }

    setInstalling(item.id)
    try {
      // 付费插件：先创建订单走支付
      if (!item.isFree && item.price > 0) {
        await handlePaidPluginPurchase(item)
        return
      }

      // 免费插件：直接安装（传 marketItem 以便主进程跳过网络请求）
      const result = await installPluginFromMarketplace(
        item.id,
        item.latestVersion || undefined,
        item,
      )

      if (result.success) {
        toast.success(
          language === 'zh'
            ? `插件「${item.nameZh}」安装成功`
            : `Plugin "${item.name}" installed successfully`,
        )
        setInstalledKeys((prev) => new Set(prev).add(item.pluginKey))
        setSelectedItem(null)
      } else if (result.requiresPayment) {
        // 后端再次确认付费（兜底）
        await handlePaidPluginPurchase(item)
      } else {
        toast.card({
          type: 'error',
          title: language === 'zh' ? '安装失败' : 'Install Failed',
          message: result.error || (language === 'zh' ? '未知错误' : 'Unknown error'),
          duration: 5000,
          source: 'PluginMarketplace',
        })
      }
    } catch (err) {
      toast.card({
        type: 'error',
        title: language === 'zh' ? '安装失败' : 'Install Failed',
        message: err instanceof Error ? err.message : String(err),
        duration: 5000,
        source: 'PluginMarketplace',
      })
    } finally {
      setInstalling(null)
    }
  }

  /**
   * 付费插件购买流程：
   * 1. 创建订单 → 拿到支付链接/二维码
   * 2. Mock 模式下自动模拟支付完成
   * 3. 支付完成后再次调用 install 完成安装
   */
  async function handlePaidPluginPurchase(item: PluginMarketItem) {
    const orderResult = await createPluginOrder(item.id, 'ALIPAY')
    if (!orderResult.success || !orderResult.orderNo) {
      toast.card({
        type: 'error',
        title: language === 'zh' ? '创建订单失败' : 'Order Creation Failed',
        message: orderResult.error || (language === 'zh' ? '未知错误' : 'Unknown error'),
        duration: 5000,
        source: 'PluginMarketplace',
      })
      return
    }

    // Mock 模式：直接模拟支付完成
    if (orderResult.mockMode) {
      toast.info(language === 'zh' ? '测试环境：模拟支付中...' : 'Mock mode: simulating payment...')
      const payResult = await mockPayPluginOrder(orderResult.orderNo)
      if (!payResult.success) {
        toast.card({
          type: 'error',
          title: language === 'zh' ? '支付失败' : 'Payment Failed',
          message: payResult.error || (language === 'zh' ? '模拟支付失败' : 'Mock pay failed'),
          duration: 5000,
          source: 'PluginMarketplace',
        })
        return
      }

      // 支付成功，触发安装
      const installResult = await installPluginFromMarketplace(item.id, item.latestVersion || undefined)
      if (installResult.success) {
        toast.success(
          language === 'zh'
            ? `插件「${item.nameZh}」购买并安装成功`
            : `Plugin "${item.name}" purchased and installed successfully`,
        )
        setInstalledKeys((prev) => new Set(prev).add(item.pluginKey))
        setSelectedItem(null)
      } else {
        toast.card({
          type: 'warning',
          title: language === 'zh' ? '支付成功，安装失败' : 'Paid but Install Failed',
          message: installResult.error || (language === 'zh' ? '请稍后在「已安装」中重试' : 'Please retry in "Installed" tab later'),
          duration: 6000,
          source: 'PluginMarketplace',
        })
      }
      return
    }

    // 正式环境：弹出支付链接/二维码
    if (orderResult.paymentUrl || orderResult.qrCodeUrl) {
      toast.card({
        type: 'info',
        title: language === 'zh' ? '请完成支付' : 'Please Complete Payment',
        message: orderResult.paymentUrl || (language === 'zh' ? '请使用手机扫码支付' : 'Scan QR code to pay'),
        duration: 0,
        source: 'PluginMarketplace',
      })
      // TODO: 弹出二维码弹窗，并轮询订单状态
    } else {
      toast.card({
        type: 'error',
        title: language === 'zh' ? '支付链接获取失败' : 'Payment URL Missing',
        message: language === 'zh' ? '未获取到支付链接，请稍后重试' : 'No payment URL returned, please retry later',
        duration: 5000,
        source: 'PluginMarketplace',
      })
    }
  }

  /** 渲染星级 */
  function renderStars(rating: number) {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-border/40'}`}
          />
        ))}
      </div>
    )
  }

  /** 格式化下载量 */
  function formatDownloads(count: number): string {
    if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return String(count)
  }

  // 未登录
  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Globe className="w-8 h-8 text-text-muted/40 mb-3" />
        <p className="text-xs text-text-muted mb-1">
          {t('app.pleaseloginfirst', language)}
        </p>
        <p className="text-[12px] text-text-muted/60">
          {language === 'zh' ? '登录后浏览插件市场' : 'Log in to browse plugins'}
        </p>
      </div>
    )
  }

  // 详情视图
  if (selectedItem) {
    return (
      <PluginDetailView
        item={selectedItem}
        language={language}
        installing={installing === selectedItem.id}
        installProgress={installProgress}
        alreadyInstalled={installedKeys.has(selectedItem.pluginKey)}
        onBack={() => setSelectedItem(null)}
        onInstall={() => handleInstall(selectedItem)}
      />
    )
  }

  // 列表视图
  return (
    <div className="flex flex-col h-full">
      {/* 顶部搜索栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/60" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setPage(1)
              setSearchQuery(e.target.value)
            }}
            placeholder={language === 'zh' ? '搜索插件...' : 'Search plugins...'}
            className="w-full h-8 pl-8 pr-3 text-xs bg-bg-hover rounded-md border border-border/40 focus:border-accent/50 focus:outline-none"
          />
        </div>
        <ActionButton
          onClick={loadItems}
          variant="ghost"
          size="sm"
          title={language === 'zh' ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      {/* 分类筛选（始终显示，"全部"永远第一个） */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/30 overflow-x-auto">
        <button
            onClick={() => {
              setPage(1)
              setSelectedCategory(null)
            }}
            className={`shrink-0 px-2.5 py-1 text-[12px] rounded-md transition-colors ${
              !selectedCategory
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:bg-bg-hover'
            }`}
          >
            {language === 'zh' ? '全部' : 'All'}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setPage(1)
                setSelectedCategory(cat.id)
              }}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:bg-bg-hover'
              }`}
            >
              {CATEGORY_ICONS_SM[cat.id] || <Package className="w-4 h-4" />}
              <span>{language === 'zh' ? cat.nameZh : cat.name}</span>
              <span className="text-[12px] opacity-60">({cat.count})</span>
            </button>
          ))}
      </div>

      {/* 精选区 */}
      {featured.length > 0 && !searchQuery && !selectedCategory && (
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-medium">
              {language === 'zh' ? '精选推荐' : 'Featured'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {featured.slice(0, 4).map((item) => (
              <FeaturedCard
                key={item.id}
                item={item}
                language={language}
                onClick={() => setSelectedItem(item)}
                renderStars={renderStars}
                formatDownloads={formatDownloads}
              />
            ))}
          </div>
        </div>
      )}

      {/* 列表区 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted/60">
            <Package className="w-6 h-6 mb-2 opacity-40" />
            <p className="text-xs">
              {language === 'zh' ? '暂无插件' : 'No plugins found'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 p-3 items-start [align-content:start]">
            {items.map((item) => (
              <PluginCard
                key={item.id}
                item={item}
                language={language}
                installed={installedKeys.has(item.pluginKey)}
                installing={installing === item.id}
                onClick={() => setSelectedItem(item)}
                onInstall={(e) => {
                  e.stopPropagation()
                  handleInstall(item)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 分页 */}
      {total > 20 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/30 text-[12px] text-text-muted">
          <span>
            {language === 'zh' ? `共 ${total} 个` : `${total} total`}
          </span>
          <div className="flex items-center gap-1.5">
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {language === 'zh' ? '上一页' : 'Prev'}
            </ActionButton>
            <span className="px-1.5">{page}</span>
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              {language === 'zh' ? '下一页' : 'Next'}
            </ActionButton>
          </div>
        </div>
      )}

      {/* 安装进度浮条 */}
      {installProgress && (
        <InstallProgressBar progress={installProgress} language={language} />
      )}
    </div>
  )
}

// ─── 子组件：插件卡片（一行两个） ─────────────────────

function PluginCard({
  item,
  language,
  installed,
  installing,
  onClick,
  onInstall,
}: {
  item: PluginMarketItem
  language: Language
  installed: boolean
  installing: boolean
  onClick: () => void
  onInstall: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2.5 p-2.5 h-full rounded-xl border border-border/40 bg-bg-base hover:border-accent/40 hover:bg-bg-hover/30 cursor-pointer transition-all"
    >
      {/* 图标 */}
      <PluginIcon icon={item.icon} category={item.category} size={36} />

      {/* 名称 + 描述（中间区域，自适应宽度） */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-xs font-medium truncate">
            {language === 'zh' ? item.nameZh : item.name}
          </span>
          {item.featured && (
            <Sparkles className="shrink-0 w-3 h-3 text-yellow-400" />
          )}
        </div>
        <p className="text-[11px] text-text-muted line-clamp-1">
          {language === 'zh' ? item.descriptionZh : item.description}
        </p>
      </div>

      {/* 安装按钮（最右侧） */}
      <div className="shrink-0">
        {installed ? (
          <div className="flex items-center justify-center gap-1 h-7 px-2.5 rounded-md bg-green-500/10 text-green-400 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {language === 'zh' ? '已安装' : 'Installed'}
          </div>
        ) : (
          <button
            onClick={onInstall}
            disabled={installing}
            className={`flex items-center justify-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
              installing
                ? 'bg-bg-hover text-text-muted cursor-not-allowed'
                : item.isFree
                  ? 'bg-accent/15 text-accent hover:bg-accent hover:text-white'
                  : 'bg-orange-500/15 text-orange-400 hover:bg-orange-500 hover:text-white'
            }`}
          >
            {installing ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                {language === 'zh' ? '安装中' : 'Installing'}
              </>
            ) : item.isFree ? (
              <>
                <Download className="w-3 h-3" />
                {language === 'zh' ? '安装' : 'Install'}
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                {language === 'zh' ? `¥${item.price}` : `¥${item.price}`}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 子组件：精选卡片 ──────────────────────────────────

function FeaturedCard({
  item,
  language,
  onClick,
  renderStars,
  formatDownloads,
}: {
  item: PluginMarketItem
  language: Language
  onClick: () => void
  renderStars: (rating: number) => React.ReactNode
  formatDownloads: (count: number) => string
}) {
  return (
    <div
      onClick={onClick}
      className="p-2.5 rounded-lg bg-bg-hover/40 hover:bg-bg-hover/70 border border-border/30 cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <PluginIcon icon={item.icon} category={item.category} size={28} />
        <span className="text-xs font-medium truncate">
          {language === 'zh' ? item.nameZh : item.name}
        </span>
      </div>
      <p className="text-[12px] text-text-muted line-clamp-2 mb-1.5">
        {language === 'zh' ? item.descriptionZh : item.description}
      </p>
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted/70">
        {renderStars(item.rating)}
        <span>·</span>
        <span>{formatDownloads(item.totalDownloads)}</span>
      </div>
    </div>
  )
}

// ─── 子组件：详情视图 ──────────────────────────────────

function PluginDetailView({
  item,
  language,
  installing,
  installProgress,
  alreadyInstalled,
  onBack,
  onInstall,
}: {
  item: PluginMarketItem
  language: Language
  installing: boolean
  installProgress: PluginInstallProgress | null
  alreadyInstalled: boolean
  onBack: () => void
  onInstall: () => void
}) {
  const typeLabel = TYPE_LABELS[item.type]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 sticky top-0 bg-bg-base z-10">
        <ActionButton onClick={onBack} variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4" />
        </ActionButton>
        <span className="text-xs font-medium">
          {language === 'zh' ? '插件详情' : 'Plugin Details'}
        </span>
      </div>

      {/* 头部 */}
      <div className="px-4 py-4 border-b border-border/30">
        <div className="flex items-start gap-3 mb-3">
          <PluginIcon icon={item.icon} category={item.category} size={56} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold mb-0.5">
              {language === 'zh' ? item.nameZh : item.name}
            </h2>
            <p className="text-xs text-text-muted line-clamp-2">
              {language === 'zh' ? item.descriptionZh : item.description}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              {typeLabel && (
                <span className={`px-1.5 py-0.5 text-[12px] rounded ${typeLabel.color}`}>
                  {language === 'zh' ? typeLabel.zh : typeLabel.en}
                </span>
              )}
              {item.featured && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[12px] rounded bg-yellow-500/15 text-yellow-400">
                  <Sparkles className="w-2.5 h-2.5" />
                  {language === 'zh' ? '精选' : 'Featured'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <StatBlock
            icon={<Download className="w-3 h-3" />}
            label={language === 'zh' ? '下载' : 'Downloads'}
            value={String(item.totalDownloads)}
          />
          <StatBlock
            icon={<Star className="w-3 h-3" />}
            label={language === 'zh' ? '评分' : 'Rating'}
            value={item.rating.toFixed(1)}
          />
          <StatBlock
            icon={<Clock className="w-3 h-3" />}
            label={language === 'zh' ? '版本' : 'Version'}
            value={item.latestVersion || '-'}
          />
          <StatBlock
            icon={<Shield className="w-3 h-3" />}
            label={language === 'zh' ? '许可' : 'License'}
            value={item.license}
          />
        </div>

        {/* 安装按钮 */}
        <div className="flex items-center gap-2">
          {alreadyInstalled ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md bg-green-500/10 text-green-400 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              {language === 'zh' ? '已安装' : 'Installed'}
            </div>
          ) : (
            <ActionButton
              onClick={onInstall}
              variant="primary"
              size="md"
              disabled={installing}
              className="flex-1"
            >
              {installing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {language === 'zh' ? '安装中...' : 'Installing...'}
                </>
              ) : item.isFree ? (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {language === 'zh' ? '免费安装' : 'Install Free'}
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {language === 'zh' ? `购买 ¥${item.price}` : `Purchase ¥${item.price}`}
                </>
              )}
            </ActionButton>
          )}
        </div>

        {/* 进度条 */}
        {installProgress && installProgress.pluginId === item.id && (
          <InstallProgressBar progress={installProgress} language={language} embedded />
        )}
      </div>

      {/* 标签 */}
      {item.tags.length > 0 && (
        <Section title={language === 'zh' ? '标签' : 'Tags'}>
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag: string) => (
              <span
                key={tag}
                className="flex items-center gap-0.5 px-2 py-0.5 text-[12px] rounded bg-bg-hover text-text-muted"
              >
                <Tag className="w-2.5 h-2.5" />
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* 支持平台 */}
      <Section title={language === 'zh' ? '支持平台' : 'Platforms'}>
        <div className="flex items-center gap-2">
          {item.platforms.map((p: string) => (
            <span
              key={p}
              className="px-2 py-0.5 text-[12px] rounded bg-bg-hover text-text-muted"
            >
              {p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux' : p}
            </span>
          ))}
        </div>
      </Section>

      {/* 链接 */}
      {(item.homepage || item.repository) && (
        <Section title={language === 'zh' ? '相关链接' : 'Links'}>
          <div className="flex flex-col gap-1">
            {item.homepage && (
              <a
                href={item.homepage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-accent hover:underline truncate"
              >
                {item.homepage}
              </a>
            )}
            {item.repository && (
              <a
                href={item.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-accent hover:underline truncate"
              >
                {item.repository}
              </a>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── 子组件：统计块 ────────────────────────────────────

function StatBlock({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 p-2 rounded-md bg-bg-hover/40">
      <div className="text-text-muted/70">{icon}</div>
      <span className="text-[12px] text-text-muted/70">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  )
}

// ─── 子组件：分区标题 ──────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border/20">
      <h3 className="text-xs font-medium mb-2 text-text-muted">{title}</h3>
      {children}
    </div>
  )
}

// ─── 子组件：安装进度条 ────────────────────────────────

function InstallProgressBar({
  progress,
  language,
  embedded = false,
}: {
  progress: PluginInstallProgress
  language: Language
  embedded?: boolean
}) {
  const phaseLabels: Record<string, { zh: string; en: string }> = {
    pending: { zh: '等待中', en: 'Pending' },
    downloading: { zh: '下载中', en: 'Downloading' },
    verifying: { zh: '校验中', en: 'Verifying' },
    extracting: { zh: '解压中', en: 'Extracting' },
    registering: { zh: '注册中', en: 'Registering' },
    mcp_connecting: { zh: '连接 MCP 服务', en: 'Connecting MCP' },
    done: { zh: '完成', en: 'Done' },
    error: { zh: '失败', en: 'Error' },
  }

  const label = phaseLabels[progress.phase] || phaseLabels.pending
  const isError = progress.phase === 'error'
  const isDone = progress.phase === 'done'

  return (
    <div
      className={`${
        embedded ? 'mt-2' : 'fixed bottom-4 left-4 right-4 z-50'
      } p-2.5 rounded-lg border ${
        isError
          ? 'bg-red-500/10 border-red-500/30'
          : isDone
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-bg-elevated border-border/40 shadow-lg'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium">
          {language === 'zh' ? label.zh : label.en}
        </span>
        {!isError && !isDone && progress.bytesTotal > 0 && (
          <span className="text-[12px] text-text-muted">
            {Math.round(progress.percent)}%
          </span>
        )}
      </div>
      {!isError && !isDone && (
        <div className="h-1 bg-bg-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
      {progress.message && (
        <p className="text-[12px] text-text-muted mt-1 truncate">{progress.message}</p>
      )}
    </div>
  )
}
