/**
 * PluginCategoryFilter — 分类筛选条
 *
 * 设计改进：
 *   - 从原"横向滚动"改为 flex-wrap 自动换行，所有分类一次性可见
 *   - 分类按钮带 Lucide 图标 + 名称 + 插件数
 *   - "全部" 永远在第一位
 *   - 选中态使用 accent 高亮
 *
 * 数据来源：GET /api/v1/plugins/categories
 */
import {
  Package,
  Zap,
  Code2,
  Cpu,
  BarChart3,
  PenTool,
  Sparkles,
  TrendingUp,
  BookOpen,
  Cloud,
  Search,
  MessageCircle,
  Shield,
  Layers,
  FileText,
  Brain,
  Bot,
  Monitor,
  Wrench,
} from 'lucide-react'
import type { PluginCategory } from '@services/pluginService'
import { t, type Language } from '@renderer/i18n'

/** 分类图标尺寸统一为 w-4 h-4，视觉更饱满 */
const ICON_CLS = 'w-4 h-4'

/** 分类图标映射（与后端 category id 对应） */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  // ── 8 个大类（新发布插件使用） ──
  productivity: <Zap className={ICON_CLS} />,
  development: <Code2 className={ICON_CLS} />,
  automation: <Cpu className={ICON_CLS} />,
  database: <BarChart3 className={ICON_CLS} />,
  design: <PenTool className={ICON_CLS} />,
  office: <FileText className={ICON_CLS} />,
  ai: <Sparkles className={ICON_CLS} />,
  utility: <Wrench className={ICON_CLS} />,
  // ── 兼容旧分类（历史数据可能仍返回这些 id） ──
  data: <BarChart3 className={ICON_CLS} />,
  creative: <PenTool className={ICON_CLS} />,
  business: <TrendingUp className={ICON_CLS} />,
  education: <BookOpen className={ICON_CLS} />,
  cloud: <Cloud className={ICON_CLS} />,
  search: <Search className={ICON_CLS} />,
  communication: <MessageCircle className={ICON_CLS} />,
  security: <Shield className={ICON_CLS} />,
  composite: <Layers className={ICON_CLS} />,
  general: <Package className={ICON_CLS} />,
  'ai-model': <Brain className={ICON_CLS} />,
  channel: <Bot className={ICON_CLS} />,
  desktop: <Monitor className={ICON_CLS} />,
}

interface PluginCategoryFilterProps {
  language: Language
  categories: PluginCategory[]
  selected: string | null
  onSelect: (categoryId: string | null) => void
}

export function PluginCategoryFilter({
  language,
  categories,
  selected,
  onSelect,
}: PluginCategoryFilterProps) {
  const isZh = language === 'zh'

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border/30">
      {/* "全部" 按钮 */}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg transition-all duration-200 ${
          !selected
            ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm shadow-accent/10'
            : 'text-text-muted hover:bg-bg-hover hover:text-text-primary border border-transparent'
        }`}
      >
        <Package className={ICON_CLS} />
        <span>{t('plugin.category.all', language)}</span>
      </button>

      {/* 分类按钮（自动换行） */}
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg transition-all duration-200 ${
            selected === cat.id
              ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm shadow-accent/10'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-primary border border-transparent'
          }`}
          title={isZh ? cat.nameZh : cat.name}
        >
          {CATEGORY_ICONS[cat.id] || <Package className={ICON_CLS} />}
          <span>{isZh ? cat.nameZh : cat.name}</span>
          <span className="text-[12px] opacity-60">({cat.count})</span>
        </button>
      ))}
    </div>
  )
}
