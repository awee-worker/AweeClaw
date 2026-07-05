/**
 * PluginFeaturedSection — 推荐专区
 *
 * 展示后端手动标记 featured=true 的插件，5 列 × 2 行布局，最多 10 条。
 *
 * 数据来源：GET /api/v1/plugins/featured
 * 仅在没有搜索/分类筛选时展示（与全部列表互斥）。
 */
import { Sparkles } from 'lucide-react'
import type { PluginMarketItem } from '@services/pluginService'
import type { Language } from '@renderer/i18n'
import { PluginCompactCard, SectionHeader } from './PluginCompactCard'

interface PluginFeaturedSectionProps {
  items: PluginMarketItem[]
  language: Language
  installedKeys: Set<string>
  onSelect: (item: PluginMarketItem) => void
}

export function PluginFeaturedSection({
  items,
  language,
  installedKeys,
  onSelect,
}: PluginFeaturedSectionProps) {
  if (items.length === 0) return null

  return (
    <section className="px-4 py-4 border-b border-border/30">
      <SectionHeader
        icon={<Sparkles className="w-4 h-4" />}
        language={language}
        zhTitle="推荐专区"
        enTitle="Featured"
        zhSubtitle="编辑精选"
        enSubtitle="Editor's picks"
      />
      <div className="grid grid-cols-5 gap-2 items-start [align-content:start]">
        {items.slice(0, 10).map((item) => (
          <PluginCompactCard
            key={item.id}
            item={item}
            language={language}
            installed={installedKeys.has(item.pluginKey)}
            onClick={() => onSelect(item)}
          />
        ))}
      </div>
    </section>
  )
}
