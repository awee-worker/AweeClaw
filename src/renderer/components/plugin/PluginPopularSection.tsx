/**
 * PluginPopularSection — 热门专区
 *
 * 按下载量降序展示前 10 个插件，5 列 × 2 行布局。
 * 每张卡片左上角带排名徽章 #1 ~ #10（前 3 名高亮）。
 *
 * 数据来源：GET /api/v1/plugins/popular
 * 仅在没有搜索/分类筛选时展示（与全部列表互斥）。
 */
import { Flame } from 'lucide-react'
import type { PluginMarketItem } from '@services/pluginService'
import type { Language } from '@renderer/i18n'
import { PluginCompactCard, SectionHeader } from './PluginCompactCard'

interface PluginPopularSectionProps {
  items: PluginMarketItem[]
  language: Language
  installedKeys: Set<string>
  onSelect: (item: PluginMarketItem) => void
}

export function PluginPopularSection({
  items,
  language,
  installedKeys,
  onSelect,
}: PluginPopularSectionProps) {
  if (items.length === 0) return null

  return (
    <section className="px-4 py-4 border-b border-border/30">
      <SectionHeader
        icon={<Flame className="w-4 h-4" />}
        language={language}
        zhTitle="热门专区"
        enTitle="Popular"
        zhSubtitle="按下载量排序"
        enSubtitle="By downloads"
      />
      <div className="grid grid-cols-5 gap-2 items-start [align-content:start]">
        {items.slice(0, 10).map((item, idx) => (
          <PluginCompactCard
            key={item.id}
            item={item}
            language={language}
            rank={idx + 1}
            installed={installedKeys.has(item.pluginKey)}
            onClick={() => onSelect(item)}
          />
        ))}
      </div>
    </section>
  )
}
