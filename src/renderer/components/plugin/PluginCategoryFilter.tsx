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
} from 'lucide-react'
import type { PluginCategory } from '@services/pluginService'
import type { Language } from '@renderer/i18n'

/** 分类图标映射（与后端 category id 对应） */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  productivity: <Zap className="w-3.5 h-3.5" />,
  development: <Code2 className="w-3.5 h-3.5" />,
  automation: <Cpu className="w-3.5 h-3.5" />,
  data: <BarChart3 className="w-3.5 h-3.5" />,
  creative: <PenTool className="w-3.5 h-3.5" />,
  ai: <Sparkles className="w-3.5 h-3.5" />,
  business: <TrendingUp className="w-3.5 h-3.5" />,
  education: <BookOpen className="w-3.5 h-3.5" />,
  cloud: <Cloud className="w-3.5 h-3.5" />,
  search: <Search className="w-3.5 h-3.5" />,
  communication: <MessageCircle className="w-3.5 h-3.5" />,
  security: <Shield className="w-3.5 h-3.5" />,
  composite: <Layers className="w-3.5 h-3.5" />,
  general: <Package className="w-3.5 h-3.5" />,
  office: <FileText className="w-3.5 h-3.5" />,
  design: <PenTool className="w-3.5 h-3.5" />,
  'ai-model': <Brain className="w-3.5 h-3.5" />,
  channel: <Bot className="w-3.5 h-3.5" />,
  desktop: <Monitor className="w-3.5 h-3.5" />,
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
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-border/30">
      {/* "全部" 按钮 */}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md transition-colors ${
          !selected
            ? 'bg-accent/15 text-accent border border-accent/30'
            : 'text-text-muted hover:bg-bg-hover border border-transparent'
        }`}
      >
        <Package className="w-3.5 h-3.5" />
        <span>{isZh ? '全部' : 'All'}</span>
      </button>

      {/* 分类按钮（自动换行） */}
      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md transition-colors ${
            selected === cat.id
              ? 'bg-accent/15 text-accent border border-accent/30'
              : 'text-text-muted hover:bg-bg-hover border border-transparent'
          }`}
          title={isZh ? cat.nameZh : cat.name}
        >
          {CATEGORY_ICONS[cat.id] || <Package className="w-3.5 h-3.5" />}
          <span>{isZh ? cat.nameZh : cat.name}</span>
          <span className="text-[11px] opacity-60">({cat.count})</span>
        </button>
      ))}
    </div>
  )
}
