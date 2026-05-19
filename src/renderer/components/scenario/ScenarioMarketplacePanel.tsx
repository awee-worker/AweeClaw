import { useState, useEffect, useCallback } from 'react'
import { Search, Download, Star, Tag, ChevronRight, Shield, Clock, ArrowLeft, Package, Heart, Stethoscope, Scale, GraduationCap, Code2, BarChart3, PenTool, Sparkles, TrendingUp, BookOpen, Globe, Zap, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import { PermissionConfirmDialog } from './PermissionConfirmDialog'
import { ScenarioReviewPanel } from './ScenarioReviewPanel'
import {
  browseScenarios,
  getFeaturedScenarios,
  getMarketplaceCategories,
  installScenarioFromMarketplace,
} from '@services/marketplaceService'
import type {
  MarketplaceScenario,
  MarketplaceCategory,
} from '@scenario-system/marketplace'

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  development: <Code2 className="w-4 h-4" />,
  data: <BarChart3 className="w-4 h-4" />,
  creative: <PenTool className="w-4 h-4" />,
  productivity: <Zap className="w-4 h-4" />,
  education: <GraduationCap className="w-4 h-4" />,
  business: <TrendingUp className="w-4 h-4" />,
  health: <Stethoscope className="w-4 h-4" />,
  legal: <Scale className="w-4 h-4" />,
  research: <BookOpen className="w-4 h-4" />,
  lifestyle: <Heart className="w-4 h-4" />,
  custom: <Sparkles className="w-4 h-4" />,
}

export function ScenarioMarketplacePanel() {
  const language = useStore(s => s.language)
  const isAuthenticated = useStore(s => s.isAuthenticated)
  const [items, setItems] = useState<MarketplaceScenario[]>([])
  const [featured, setFeatured] = useState<MarketplaceScenario[]>([])
  const [categories, setCategories] = useState<MarketplaceCategory[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<MarketplaceScenario | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [permissionPending, setPermissionPending] = useState<MarketplaceScenario | null>(null)

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])

  useEffect(() => {
    loadFeatured()
    loadCategories()
  }, [isAuthenticated])

  useEffect(() => {
    loadItems()
  }, [searchQuery, selectedCategory, page, isAuthenticated])

  async function loadItems() {
    setIsLoading(true)
    try {
      const result = await browseScenarios({
        category: selectedCategory || undefined,
        search: searchQuery || undefined,
        page,
        limit: 20,
      })
      setItems(result.scenarios)
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
      const result = await getFeaturedScenarios()
      setFeatured(result)
    } catch {
      setFeatured([])
    }
  }

  async function loadCategories() {
    try {
      const result = await getMarketplaceCategories()
      setCategories(result)
    } catch {
      setCategories([])
    }
  }

  async function handleInstall(item: MarketplaceScenario) {
    if (item.permissions && item.permissions.length > 0) {
      setPermissionPending(item)
      return
    }
    await doInstall(item)
  }

  async function doInstall(item: MarketplaceScenario) {
    setInstalling(item.id)
    try {
      const result = await installScenarioFromMarketplace(item.id, item.version)
      if (result.success) {
        toast.success(
          language === 'zh' ? `场景 "${item.nameZh}" 安装成功` : `Scenario "${item.name}" installed successfully`,
        )
        setSelectedItem(null)
        await loadItems()
      } else {
        toast.error(
          language === 'zh' ? `安装失败: ${result.error}` : `Install failed: ${result.error}`,
        )
      }
    } catch (err) {
      toast.error(
        language === 'zh' ? '安装失败' : 'Install failed',
        err instanceof Error ? err.message : '',
      )
    } finally {
      setInstalling(null)
    }
  }

  function renderStars(rating: number) {
    const stars = []
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-border/40'}`}
        />
      )
    }
    return <div className="flex items-center gap-0.5">{stars}</div>
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Globe className="w-8 h-8 text-text-muted/40 mb-3" />
        <p className="text-xs text-text-muted mb-1">{t('请先登录', 'Please log in first')}</p>
        <p className="text-[10px] text-text-muted/60">{t('登录后可浏览和安装在线场景', 'Log in to browse and install online scenarios')}</p>
      </div>
    )
  }

  if (selectedItem) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20">
          <button
            onClick={() => setSelectedItem(null)}
            className="p-1 rounded hover:bg-bg-tertiary/50 text-text-muted"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-text-primary">{t('场景详情', 'Scenario Details')}</span>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
              {CATEGORY_ICONS[selectedItem.category] || <Package className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">
                {language === 'zh' ? selectedItem.nameZh : selectedItem.name}
              </h3>
              <p className="text-[11px] text-text-muted mt-0.5">{selectedItem.category}</p>
            </div>
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">
            {language === 'zh' ? selectedItem.descriptionZh : selectedItem.description}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded-lg bg-bg-tertiary/30">
              <div className="text-sm font-semibold text-text-primary">{selectedItem.rating.toFixed(1)}</div>
              <div className="text-[10px] text-text-muted">{t('评分', 'Rating')}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-bg-tertiary/30">
              <div className="text-sm font-semibold text-text-primary">{selectedItem.downloads}</div>
              <div className="text-[10px] text-text-muted">{t('下载', 'Downloads')}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-bg-tertiary/30">
              <div className="text-sm font-semibold text-text-primary">v{selectedItem.version}</div>
              <div className="text-[10px] text-text-muted">{t('版本', 'Version')}</div>
            </div>
          </div>

          {selectedItem.tags?.length > 0 && (
            <div>
              <h4 className="text-[11px] font-medium text-text-muted mb-1.5">{t('标签', 'Tags')}</h4>
              <div className="flex flex-wrap gap-1">
                {selectedItem.tags.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary/50 text-text-secondary flex items-center gap-0.5">
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedItem.minAppVersion && (
            <div className="text-[11px] text-text-muted">
              {t(`最低应用版本: ${selectedItem.minAppVersion}`, `Min App Version: ${selectedItem.minAppVersion}`)}
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <Shield className="w-3.5 h-3.5 text-green-400" />
            <span>{t('安全审查已通过', 'Security review passed')}</span>
          </div>
        </div>

        <div className="px-3 py-2.5 border-t border-border/20">
          <ActionButton
            className="w-full h-9 text-xs gap-1.5"
            onClick={() => handleInstall(selectedItem)}
            disabled={installing === selectedItem.id}
          >
            {installing === selectedItem.id ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin" />
                {t('安装中...', 'Installing...')}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                {t('安装场景', 'Install Scenario')}
              </>
            )}
          </ActionButton>
        </div>

        <div className="px-3 py-2.5 border-t border-border/20">
          <ScenarioReviewPanel
            scenarioId={selectedItem.id}
            scenarioName={selectedItem.name}
            scenarioNameZh={selectedItem.nameZh}
            currentRating={selectedItem.rating}
            ratingCount={selectedItem.ratingCount}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border/20">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-4 h-4 text-accent" />
          <span className="text-xs font-semibold text-text-primary">{t('场景市场', 'Scenario Marketplace')}</span>
          <button
            onClick={() => { loadItems(); loadFeatured(); loadCategories(); }}
            className="ml-auto p-1 rounded hover:bg-bg-tertiary/50 text-text-muted"
            title={t('刷新', 'Refresh')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder={t('搜索场景...', 'Search scenarios...')}
            className="w-full h-7 pl-7 pr-2 rounded-md bg-bg-tertiary/50 border border-border/15 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/30"
          />
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/10">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => { setSelectedCategory(null); setPage(1) }}
            className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              !selectedCategory
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t('全部', 'All')}
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setSelectedCategory(cat.id === selectedCategory ? null : cat.id); setPage(1) }}
              className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                cat.id === selectedCategory
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {CATEGORY_ICONS[cat.id]}
              <span>{cat.nameZh && language === 'zh' ? cat.nameZh : cat.name}</span>
              <span className="opacity-60">{cat.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {featured.length > 0 && !searchQuery && !selectedCategory && (
          <div className="px-3 pt-3 pb-1">
            <h3 className="text-[11px] font-medium text-text-muted mb-2">{t('✨ 精选推荐', '✨ Featured')}</h3>
            <div className="grid grid-cols-2 gap-2">
              {featured.slice(0, 4).map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="p-2 rounded-lg border border-border/15 bg-bg-tertiary/20 hover:bg-bg-tertiary/40 text-left transition-colors"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-6 h-6 rounded-md bg-accent/10 flex items-center justify-center text-accent">
                      {CATEGORY_ICONS[item.category] || <Package className="w-3 h-3" />}
                    </div>
                    <span className="text-[11px] font-medium text-text-primary truncate">
                      {language === 'zh' ? item.nameZh : item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {renderStars(item.rating)}
                    <span className="text-[9px] text-text-muted">({item.downloads})</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-3 pt-2 pb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-medium text-text-muted">
              {searchQuery || selectedCategory
                ? t('搜索结果', 'Search Results')
                : t('所有场景', 'All Scenarios')}
              {total > 0 && <span className="ml-1 opacity-60">({total})</span>}
            </h3>
            {isLoading && <Clock className="w-3 h-3 text-text-muted animate-spin" />}
          </div>

          {items.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <Package className="w-6 h-6 mb-2 opacity-40" />
              <p className="text-[11px]">{t('暂无场景', 'No scenarios found')}</p>
            </div>
          )}

          <div className="space-y-1.5">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="w-full p-2 rounded-lg border border-border/10 bg-bg-tertiary/15 hover:bg-bg-tertiary/30 text-left transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-accent/8 flex items-center justify-center text-accent flex-shrink-0">
                    {CATEGORY_ICONS[item.category] || <Package className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-text-primary truncate">
                        {language === 'zh' ? item.nameZh : item.name}
                      </span>
                      {item.isFree && (
                        <span className="px-1 py-0.5 text-[8px] rounded bg-green-500/10 text-green-400 font-medium flex-shrink-0">
                          {t('免费', 'FREE')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {renderStars(item.rating)}
                      <span className="text-[9px] text-text-muted">{item.downloads} {t('下载', 'dl')}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-text-muted/40 group-hover:text-text-muted/70 flex-shrink-0" />
                </div>
              </button>
            ))}
          </div>

          {total > 20 && (
            <div className="flex items-center justify-center gap-2 mt-3">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 text-[10px] rounded bg-bg-tertiary/30 text-text-muted disabled:opacity-40"
              >
                {t('上一页', 'Prev')}
              </button>
              <span className="text-[10px] text-text-muted">{page}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * 20 >= total}
                className="px-2 py-1 text-[10px] rounded bg-bg-tertiary/30 text-text-muted disabled:opacity-40"
              >
                {t('下一页', 'Next')}
              </button>
            </div>
          )}
        </div>
      </div>

      {permissionPending && (
        <PermissionConfirmDialog
          scenarioName={permissionPending.name}
          scenarioNameZh={permissionPending.nameZh}
          permissions={permissionPending.permissions || []}
          onConfirm={() => {
            const item = permissionPending
            setPermissionPending(null)
            doInstall(item)
          }}
          onCancel={() => setPermissionPending(null)}
        />
      )}
    </div>
  )
}
