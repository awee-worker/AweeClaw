/**
 * PluginPopularSection — 热门专区
 *
 * 按下载量降序展示前 10 个插件。
 * 布局采用 2 + 4 + 4 排列，确保整齐：
 *   - 第一行：前 2 名用横向 Hero 大卡片，2 列布局（突出 Top 2）
 *   - 第二、三行：第 3~10 名用垂直标准卡片，4 列布局
 *
 * 每张卡片左上角带排名徽章 #1 ~ #10（前 3 名高亮 + 卡片渐变背景）。
 *
 * 数据来源：GET /api/v1/plugins/popular
 * 仅在没有搜索/分类筛选时展示（与全部列表互斥）。
 */
import { Flame } from 'lucide-react'
import type { PluginMarketItem } from '@services/pluginService'
import type { Language } from '@renderer/i18n'
import { PluginCompactCard, PluginPopularHeroCard, SectionHeader } from './PluginCompactCard'

interface PluginPopularSectionProps {
  items: PluginMarketItem[]
  language: Language
  installedKeys: Set<string>
  onSelect: (item: PluginMarketItem) => void
}

/** Hero 卡片数量（前 2 名独占一行） */
const HERO_COUNT = 2

export function PluginPopularSection({
  items,
  language,
  installedKeys,
  onSelect,
}: PluginPopularSectionProps) {
  if (items.length === 0) return null

  const topItems = items.slice(0, HERO_COUNT)
  const restItems = items.slice(HERO_COUNT, 10)

  return (
    <section className="px-5 py-5 border-b border-border/30">
      <SectionHeader
        icon={<Flame className="w-4 h-4" />}
        language={language}
        zhTitle="热门专区"
        enTitle="Popular"
        zhSubtitle="按下载量排序"
        enSubtitle="By downloads"
      />

      {/* 第一行：前 2 名 Hero 大卡片 */}
      {topItems.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {topItems.map((item, idx) => (
            <PluginPopularHeroCard
              key={item.id}
              item={item}
              language={language}
              rank={idx + 1}
              installed={installedKeys.has(item.pluginKey)}
              onClick={() => onSelect(item)}
            />
          ))}
        </div>
      )}

      {/* 剩余插件标准卡片 */}
      {restItems.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start [align-content:start]">
          {restItems.map((item, idx) => (
            <PluginCompactCard
              key={item.id}
              item={item}
              language={language}
              rank={idx + HERO_COUNT + 1}
              installed={installedKeys.has(item.pluginKey)}
              onClick={() => onSelect(item)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
