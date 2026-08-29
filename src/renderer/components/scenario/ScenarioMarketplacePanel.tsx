import { useState, useEffect } from 'react'
import { Search, Download, Star, Tag, Shield, Clock, ArrowLeft, Package, Heart, Stethoscope, Scale, GraduationCap, Code2, BarChart3, PenTool, Sparkles, TrendingUp, BookOpen, Globe, Zap, RefreshCw, CheckCircle2, User } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '../ui'
import { toast } from '../foundation/NotificationProvider'
import { PermissionConfirmDialog } from './PermissionConfirmDialog'
import { ScenarioReviewPanel } from './ScenarioReviewPanel'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { registerInstalledScenario } from './scenarioInstallUtils'
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
import { t, type Language } from '@renderer/i18n'

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  development: <Code2 className="w-5 h-5" />,
  data: <BarChart3 className="w-5 h-5" />,
  creative: <PenTool className="w-5 h-5" />,
  productivity: <Zap className="w-5 h-5" />,
  education: <GraduationCap className="w-5 h-5" />,
  business: <TrendingUp className="w-5 h-5" />,
  health: <Stethoscope className="w-5 h-5" />,
  legal: <Scale className="w-5 h-5" />,
  research: <BookOpen className="w-5 h-5" />,
  lifestyle: <Heart className="w-5 h-5" />,
  custom: <Sparkles className="w-5 h-5" />,
}

const CATEGORY_ICONS_SM: Record<string, React.ReactNode> = {
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
    if (scenarioRegistry.has(item.id)) {
      toast.warning(
        t('scenario.scenarioisalreadyinstalled', language as Language, { name: item.name, nameZh: item.nameZh })
      )
      return
    }
    if (item.permissions && item.permissions.length > 0) {
      setPermissionPending(item)
      return
    }
    await doInstall(item)
  }

  function translateInstallError(error: string): string {
    if (language !== 'zh') return error
    const map: Record<string, string> = {
      'Package archive is corrupted or in an unsupported format. Please verify the scenario package.': '安装包已损坏或格式不受支持，请检查场景包是否正确。',
      'Package archive is corrupted or contains invalid entries. Please verify the scenario package.': '安装包已损坏或包含无效内容，请检查场景包是否正确。',
      'Package archive extraction failed. The package may be corrupted.': '安装包解压失败，安装包可能已损坏。',
      'Checksum verification failed. The package may be corrupted or tampered with.': '校验和验证失败，安装包可能已损坏或被篡改。',
      'Signature verification failed. The package may be tampered with or from an untrusted source.': '签名验证失败，安装包可能被篡改或来自不受信任的来源。',
      'Network error occurred while downloading the scenario package.': '下载场景包时发生网络错误。',
      'File size mismatch': '文件大小不匹配',
      'No download URL returned from server': '服务器未返回下载地址',
      'Not authenticated. Please log in first.': '未登录，请先登录。',
    }
    for (const [en, zh] of Object.entries(map)) {
      if (error.includes(en) || error.startsWith(en)) return zh
    }
    return error
  }

  async function doInstall(item: MarketplaceScenario) {
    setInstalling(item.id)
    try {
      const result = await installScenarioFromMarketplace(item.id, item.version)
      if (result.success) {
        const config = result.config
        const scenarioId = result.scenarioId || item.id

        if (config) {
          await registerInstalledScenario(config as any, {
            scenarioId,
            source: 'marketplace',
            version: result.version,
          })
        }

        toast.success(
          t('scenario.scenarioinstalledsuccessfully', language as Language, { name: item.name, nameZh: item.nameZh }),
        )
        setSelectedItem(null)
        await loadItems()
      } else if (result.requiresPayment) {
        toast.card({
          type: 'warning',
          title: t('scenario.paidscenario', language as Language),
          message: t('scenario.thisisapaidscenario', language as Language, { price: result.price }),
          duration: 5000,
          source: 'ScenarioMarketplace',
        })
      } else {
        const errorMsg = translateInstallError(result.error || (t('scenario.unknownerror', language as Language)))
        toast.card({
          type: 'error',
          title: t('scenario.installfailed', language as Language),
          message: errorMsg,
          duration: 5000,
          source: 'ScenarioMarketplace',
        })
      }
    } catch (err) {
      const errorMsg = translateInstallError(err instanceof Error ? err.message : String(err))
      toast.card({
        type: 'error',
        title: t('scenario.installfailed2', language as Language),
        message: errorMsg,
        duration: 5000,
        source: 'ScenarioMarketplace',
      })
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
          className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-yellow-300 fill-yellow-300' : 'text-border/40'}`}
        />
      )
    }
    return <div className="flex items-center gap-0.5">{stars}</div>
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Globe className="w-8 h-8 text-text-muted/40 mb-3" />
        <p className="text-xs text-text-muted mb-1">{t('app.pleaseloginfirst', language as Language)}</p>
        <p className="text-[10px] text-text-muted/60">{t('app.logintobrowse', language as Language)}</p>
      </div>
    )
  }

  if (selectedItem) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border/20 bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => setSelectedItem(null)}
            className="p-1.5 rounded-lg hover:bg-surface/40 text-text-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-text-primary">{t('app.scenariodetails', language as Language)}</span>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          <div className="flex items-start gap-4">
            {CATEGORY_ICONS[selectedItem.category] || <Package className="w-12 h-12 text-accent flex-shrink-0" strokeWidth={1.5} />}
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-text-primary">
                {language === 'zh' ? selectedItem.nameZh : selectedItem.name}
              </h3>
              <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                <span>{selectedItem.category}</span>
                <span>·</span>
                <span>v{selectedItem.version}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-text-muted/80 leading-relaxed">
            {language === 'zh' ? selectedItem.descriptionZh : selectedItem.description}
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3.5 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
              <div className="text-sm font-semibold text-text-primary">{selectedItem.rating.toFixed(1)}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{t('app.rating', language as Language)}</div>
            </div>
            <div className="text-center p-3.5 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
              <div className="text-sm font-semibold text-text-primary">{selectedItem.downloads}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{t('app.downloads', language as Language)}</div>
            </div>
            <div className="text-center p-3.5 rounded-xl bg-surface/30 border border-border/20 shadow-sm shadow-black/5">
              <div className="text-sm font-semibold text-text-primary">v{selectedItem.version}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{t('app.version', language as Language)}</div>
            </div>
          </div>

          {selectedItem.tags?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted mb-2">{t('app.tags', language as Language)}</h4>
              <div className="flex flex-wrap gap-1.5">
                {selectedItem.tags.map(tag => (
                  <span key={tag} className="text-xs px-2.5 py-1 rounded-lg bg-surface/60 text-text-muted border border-border/20 flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectedItem.minAppVersion && (
            <div className="text-[11px] text-text-muted">
              {t('app.minappversion', language as Language, { minAppVersion: selectedItem.minAppVersion })}
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <Shield className="w-3.5 h-3.5 text-green-400" />
            <span>{t('app.securityreviewpassed', language as Language)}</span>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border/10">
          {scenarioRegistry.has(selectedItem.id) ? (
            <ActionButton
              className="w-full h-9 text-xs gap-1.5"
              disabled
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('app.installed', language as Language)}
            </ActionButton>
          ) : (
            <ActionButton
              className="w-full h-9 text-xs gap-1.5"
              onClick={() => handleInstall(selectedItem)}
              disabled={installing === selectedItem.id}
            >
              {installing === selectedItem.id ? (
                <>
                  <Clock className="w-3.5 h-3.5 animate-spin" />
                  {t('app.installing', language as Language)}
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  {t('app.installscenario', language as Language)}
                </>
              )}
            </ActionButton>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border/10">
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
    <div className="flex flex-col h-full bg-surface/10">
      {/* 顶部搜索栏 - 加深背景提升对比度 */}
      <div className="px-4 py-3 border-b border-border/20 bg-surface/30 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2.5">
          <Globe className="w-4 h-4 text-accent" />
          <span className="text-sm font-semibold text-text-primary">{t('app.scenariomarketplace', language as Language)}</span>
          <button
            onClick={() => { loadItems(); loadFeatured(); loadCategories(); }}
            className="ml-auto p-1 rounded-md hover:bg-surface/40 text-text-muted transition-colors"
            title={t('app.refresh', language as Language)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder={t('app.searchscenarios', language as Language)}
            className="w-full h-9 pl-8 pr-3 rounded-lg bg-background/80 border border-border/25 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/40 focus:bg-background transition-colors shadow-sm"
          />
        </div>
      </div>

      {/* 分类标签栏 */}
      <div className="px-4 py-2 border-b border-border/15 bg-surface/15">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => { setSelectedCategory(null); setPage(1) }}
            className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              !selectedCategory
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-text-muted hover:text-text-secondary border border-transparent hover:border-border/20'
            }`}
          >
            {t('app.all', language as Language)}
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => { setSelectedCategory(cat.id === selectedCategory ? null : cat.id); setPage(1) }}
              className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                cat.id === selectedCategory
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-text-muted hover:text-text-secondary border border-transparent hover:border-border/20'
              }`}
            >
              {CATEGORY_ICONS_SM[cat.id]}
              <span>{cat.nameZh && language === 'zh' ? cat.nameZh : cat.name}</span>
              <span className="opacity-60">{cat.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto">
         {/* 推荐场景 */}
         {featured.length > 0 && !searchQuery && !selectedCategory && (
           <div className="px-5 pt-5 pb-3">
             <h3 className="text-sm font-semibold text-text-primary mb-4">{t('app.featured', language as Language)}</h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
               {featured.slice(0, 4).map(item => (
                 <button
                   key={item.id}
                   onClick={() => setSelectedItem(item)}
                   className="p-4 rounded-2xl border border-border/20 bg-background/60 hover:bg-background/90 hover:border-border/40 shadow-sm shadow-black/5 text-left transition-all duration-200 group"
                 >
                    <div className="flex items-center gap-3 mb-3">
                     {CATEGORY_ICONS_SM[item.category] || <Package className="w-10 h-10 text-accent" strokeWidth={1.5} />}
                     <div className="flex-1 min-w-0">
                       <span className="text-sm font-semibold text-text-primary truncate block">
                         {language === 'zh' ? item.nameZh : item.name}
                       </span>
                       <div className="flex items-center gap-2 mt-1.5">
                         {renderStars(item.rating)}
                         <span className="text-xs text-text-muted">({item.downloads})</span>
                       </div>
                     </div>
                   </div>
                   <p className="text-xs text-text-muted/70 line-clamp-2 leading-relaxed">
                     {language === 'zh' ? item.descriptionZh : item.description}
                   </p>
                 </button>
               ))}
             </div>
           </div>
         )}

        {/* 场景列表 */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">
              {searchQuery || selectedCategory
                ? t('app.searchresults', language as Language)
                : t('app.allscenarios', language as Language)}
              {total > 0 && <span className="ml-1.5 text-text-muted font-normal text-xs">({total})</span>}
            </h3>
            {isLoading && <Clock className="w-3.5 h-3.5 text-text-muted animate-spin" />}
          </div>

          {items.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <Package className="w-10 h-10 mb-3 opacity-30" strokeWidth={1} />
              <p className="text-sm">{t('app.noscenariosfound', language as Language)}</p>
            </div>
          )}

           {/* 大卡片网格 */}
           <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
             {items.map(item => (
               <button
                 key={item.id}
                 onClick={() => setSelectedItem(item)}
                 className="rounded-2xl border border-border/15 bg-background/60 hover:bg-background/90 hover:border-border/40 text-left transition-all duration-200 shadow-sm shadow-black/5 group overflow-hidden"
               >
                 <div className="p-5">
                   {/* 头部：图标 + 名称 + 标签 */}
                   <div className="flex items-start gap-4">
                     {CATEGORY_ICONS[item.category] || <Package className="w-12 h-12 text-text-muted flex-shrink-0 group-hover:text-accent transition-colors" strokeWidth={1.5} />}
                     <div className="flex-1 min-w-0">
                       <div className="flex items-center gap-2 flex-wrap">
                         <span className="text-base font-semibold text-text-primary truncate">
                           {language === 'zh' ? item.nameZh : item.name}
                         </span>
                         {item.isFree ? (
                           <span className="text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-lg flex-shrink-0">
                             {t('app.free', language as Language)}
                           </span>
                         ) : (
                           <span className="text-xs font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-lg flex-shrink-0">
                             ¥{item.price}
                           </span>
                         )}
                         {scenarioRegistry.has(item.id) && (
                           <span className="flex items-center gap-1 text-xs font-medium text-accent bg-accent/10 px-2 py-0.5 rounded-lg flex-shrink-0">
                             <CheckCircle2 className="w-3 h-3" />
                             {t('app.installed2', language as Language)}
                           </span>
                         )}
                       </div>
                       {/* 评分 + 下载 + 版本 */}
                       <div className="flex items-center gap-2 mt-2 text-xs text-text-muted">
                         {renderStars(item.rating)}
                         <span>{item.downloads} {t('app.dl2', language as Language)}</span>
                         <span>·</span>
                         <span>v{item.version}</span>
                       </div>
                     </div>
                   </div>

                   {/* 描述 */}
                   <p className="text-xs text-text-muted/80 mt-4 line-clamp-2 leading-relaxed">
                     {language === 'zh' ? item.descriptionZh : item.description}
                   </p>

                   {/* 标签 */}
                   {item.tags && item.tags.length > 0 && (
                     <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                       {item.tags.slice(0, 3).map(tag => (
                         <span key={tag} className="text-xs px-2 py-0.5 rounded-lg bg-surface/50 text-text-muted/70 border border-border/15 flex items-center gap-1">
                           <Tag className="w-3 h-3" />
                           {tag}
                         </span>
                       ))}
                       {item.tags.length > 3 && (
                         <span className="text-xs text-text-muted/50">+{item.tags.length - 3}</span>
                       )}
                     </div>
                   )}

                   {/* 底部：作者 + 安装按钮 */}
                   <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/10">
                     <div className="flex items-center gap-1.5 text-xs text-text-muted/60">
                       <User className="w-3.5 h-3.5" />
                       <span>{item.author || 'AweeClaw'}</span>
                     </div>
                     {scenarioRegistry.has(item.id) ? (
                       <span className="flex items-center gap-1 text-xs text-accent/70 font-medium">
                         <CheckCircle2 className="w-3.5 h-3.5" />
                         {t('app.installed', language as Language)}
                       </span>
                     ) : (
                       <span className="flex items-center gap-1 text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                         <Download className="w-3.5 h-3.5" />
                         {t('app.installscenario', language as Language)}
                       </span>
                     )}
                   </div>
                 </div>
               </button>
             ))}
           </div>

          {/* 分页 */}
          {total > 20 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-[11px] rounded-lg bg-background/60 border border-border/20 text-text-muted disabled:opacity-40 hover:bg-background/90 transition-colors"
              >
                {t('app.prev', language as Language)}
              </button>
              <span className="text-[11px] text-text-muted">{page}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * 20 >= total}
                className="px-3 py-1.5 text-[11px] rounded-lg bg-background/60 border border-border/20 text-text-muted disabled:opacity-40 hover:bg-background/90 transition-colors"
              >
                {t('app.next', language as Language)}
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
