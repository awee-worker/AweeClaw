import { useState, useEffect, useCallback } from 'react'
import { Search, Download, Star, Tag, ChevronRight, Shield, Clock, ArrowLeft,  Package, Heart, Stethoscope, Scale, GraduationCap, Code2, BarChart3, PenTool, Sparkles, TrendingUp, BookOpen, Globe, Zap } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '../ui'

interface MarketplaceItem {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon: string
  category: string
  isFree: boolean
  price: number
  enabledTools: string[]
  marketplaceListings: Array<{
    version: string
    rating: number
    downloadCount: number
    tags: string[]
  }>
}

interface MarketplaceCategory {
  id: string
  name: string
  count: number
}

const MOCK_ITEMS: MarketplaceItem[] = [
  {
    id: 'legal-pro', name: 'Legal Pro', nameZh: '法律专业版', icon: '⚖️', category: 'legal',
    description: 'Advanced legal analysis with contract review, compliance checking, and case law research.',
    descriptionZh: '高级法律分析，包含合同审查、合规检查和案例研究。',
    isFree: false, price: 99, enabledTools: ['contract_review', 'compliance_check', 'case_law_search'],
    marketplaceListings: [{ version: '2.1.0', rating: 4.8, downloadCount: 3200, tags: ['legal', 'compliance', 'contract'] }],
  },
  {
    id: 'edu-suite', name: 'Edu Suite', nameZh: '教育套件', icon: '🎓', category: 'education',
    description: 'Complete education toolkit with quiz generation, study planning, and progress tracking.',
    descriptionZh: '完整教育工具包，包含测验生成、学习计划和进度跟踪。',
    isFree: true, price: 0, enabledTools: ['quiz_generator', 'study_planner', 'progress_tracker'],
    marketplaceListings: [{ version: '1.5.0', rating: 4.6, downloadCount: 5800, tags: ['education', 'quiz', 'study'] }],
  },
  {
    id: 'med-assist', name: 'MedAssist', nameZh: '医疗助手', icon: '🏥', category: 'health',
    description: 'Medical symptom analysis, report interpretation, and drug interaction checking.',
    descriptionZh: '医疗症状分析、报告解读和药物相互作用检查。',
    isFree: false, price: 149, enabledTools: ['symptom_checker', 'report_interpreter', 'drug_info'],
    marketplaceListings: [{ version: '3.0.0', rating: 4.9, downloadCount: 2100, tags: ['medical', 'health', 'diagnosis'] }],
  },
  {
    id: 'data-analyst', name: 'Data Analyst', nameZh: '数据分析', icon: '📊', category: 'data',
    description: 'Data visualization, statistical analysis, and automated reporting.',
    descriptionZh: '数据可视化、统计分析和自动化报告。',
    isFree: true, price: 0, enabledTools: ['data_viz', 'stats_analysis', 'auto_report'],
    marketplaceListings: [{ version: '1.2.0', rating: 4.3, downloadCount: 4100, tags: ['data', 'analytics', 'visualization'] }],
  },
  {
    id: 'code-review', name: 'Code Review Pro', nameZh: '代码审查专业版', icon: '🔍', category: 'development',
    description: 'AI-powered code review with security scanning and best practice suggestions.',
    descriptionZh: 'AI 驱动的代码审查，包含安全扫描和最佳实践建议。',
    isFree: false, price: 79, enabledTools: ['code_review', 'security_scan', 'best_practices'],
    marketplaceListings: [{ version: '2.0.0', rating: 4.7, downloadCount: 7200, tags: ['code', 'review', 'security'] }],
  },
  {
    id: 'creative-write', name: 'Creative Writer', nameZh: '创意写作', icon: '✍️', category: 'creative',
    description: 'Creative writing assistant with style analysis and content generation.',
    descriptionZh: '创意写作助手，包含风格分析和内容生成。',
    isFree: true, price: 0, enabledTools: ['style_analysis', 'content_gen', 'grammar_check'],
    marketplaceListings: [{ version: '1.0.0', rating: 4.1, downloadCount: 2800, tags: ['writing', 'creative', 'content'] }],
  },
]

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

const CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
  development: { en: 'Development', zh: '开发' },
  data: { en: 'Data', zh: '数据' },
  creative: { en: 'Creative', zh: '创意' },
  productivity: { en: 'Productivity', zh: '效率' },
  education: { en: 'Education', zh: '教育' },
  business: { en: 'Business', zh: '商业' },
  health: { en: 'Health', zh: '医疗' },
  legal: { en: 'Legal', zh: '法律' },
  research: { en: 'Research', zh: '研究' },
  lifestyle: { en: 'Lifestyle', zh: '生活' },
  custom: { en: 'Custom', zh: '自定义' },
}

export function ScenarioMarketplacePanel() {
  const language = useStore(s => s.language)
  const [items, setItems] = useState<MarketplaceItem[]>([])
  const [featured, setFeatured] = useState<MarketplaceItem[]>([])
  const [categories, setCategories] = useState<MarketplaceCategory[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<MarketplaceItem | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language])

  useEffect(() => {
    loadFeatured()
    loadCategories()
  }, [])

  useEffect(() => {
    loadItems()
  }, [searchQuery, selectedCategory])

  async function loadItems() {
    setIsLoading(true)
    try {
      await new Promise(r => setTimeout(r, 200))
      let filtered = MOCK_ITEMS
      if (selectedCategory) {
        filtered = filtered.filter(i => i.category === selectedCategory)
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        filtered = filtered.filter(i =>
          i.name.toLowerCase().includes(q) ||
          i.nameZh.includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.descriptionZh.includes(q)
        )
      }
      setItems(filtered)
    } catch {
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }

  async function loadFeatured() {
    try {
      await new Promise(r => setTimeout(r, 100))
      setFeatured(MOCK_ITEMS.filter(i => (i.marketplaceListings?.[0]?.rating ?? 0) >= 4.5).slice(0, 4))
    } catch {
      setFeatured([])
    }
  }

  async function loadCategories() {
    try {
      const catMap = new Map<string, number>()
      for (const item of MOCK_ITEMS) {
        catMap.set(item.category, (catMap.get(item.category) || 0) + 1)
      }
      setCategories(Array.from(catMap.entries()).map(([id, count]) => ({ id, name: CATEGORY_LABELS[id]?.[language === 'zh' ? 'zh' : 'en'] || id, count })))
    } catch {
      setCategories([])
    }
  }

  async function handleInstall(item: MarketplaceItem) {
    setInstalling(item.id)
    try {
      await new Promise(r => setTimeout(r, 1500))
    } catch {
      // silent
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

  function getListingData(item: MarketplaceItem) {
    return item.marketplaceListings?.[0] || { version: '1.0.0', rating: 0, downloadCount: 0, tags: [] }
  }

  if (selectedItem) {
    const listing = getListingData(selectedItem)
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
              <div className="text-sm font-semibold text-text-primary">{listing.rating.toFixed(1)}</div>
              <div className="text-[10px] text-text-muted">{t('评分', 'Rating')}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-bg-tertiary/30">
              <div className="text-sm font-semibold text-text-primary">{listing.downloadCount}</div>
              <div className="text-[10px] text-text-muted">{t('下载', 'Downloads')}</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-bg-tertiary/30">
              <div className="text-sm font-semibold text-text-primary">v{listing.version}</div>
              <div className="text-[10px] text-text-muted">{t('版本', 'Version')}</div>
            </div>
          </div>

          {selectedItem.enabledTools?.length > 0 && (
            <div>
              <h4 className="text-[11px] font-medium text-text-muted mb-1.5">{t('可用工具', 'Available Tools')}</h4>
              <div className="flex flex-wrap gap-1">
                {selectedItem.enabledTools.map(tool => (
                  <span key={tool} className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {listing.tags?.length > 0 && (
            <div>
              <h4 className="text-[11px] font-medium text-text-muted mb-1.5">{t('标签', 'Tags')}</h4>
              <div className="flex flex-wrap gap-1">
                {listing.tags.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary/50 text-text-secondary flex items-center gap-0.5">
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
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
            ) : selectedItem.isFree ? (
              <>
                <Download className="w-3.5 h-3.5" />
                {t('免费安装', 'Install Free')}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                {t(`¥${selectedItem.price} 购买安装`, `$${selectedItem.price} Purchase & Install`)}
              </>
            )}
          </ActionButton>
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
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('搜索场景...', 'Search scenarios...')}
            className="w-full h-7 pl-7 pr-2 rounded-md bg-bg-tertiary/50 border border-border/15 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-accent/30"
          />
        </div>
      </div>

      <div className="px-3 py-2 border-b border-border/10">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategory(null)}
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
              onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
              className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                cat.id === selectedCategory
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {CATEGORY_ICONS[cat.id]}
              <span>{CATEGORY_LABELS[cat.id]?.[language === 'zh' ? 'zh' : 'en'] || cat.name}</span>
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
              {featured.slice(0, 4).map(item => {
                const listing = getListingData(item)
                return (
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
                      {renderStars(listing.rating)}
                      <span className="text-[9px] text-text-muted">({listing.downloadCount})</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="px-3 pt-2 pb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-medium text-text-muted">
              {searchQuery || selectedCategory
                ? t('搜索结果', 'Search Results')
                : t('所有场景', 'All Scenarios')}
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
            {items.map(item => {
              const listing = getListingData(item)
              return (
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
                        {renderStars(listing.rating)}
                        <span className="text-[9px] text-text-muted">{listing.downloadCount} {t('下载', 'dl')}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted/40 group-hover:text-text-muted/70 flex-shrink-0" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
