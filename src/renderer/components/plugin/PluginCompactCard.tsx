/**
 * PluginCompactCard — 紧凑型插件卡片（专区用）
 *
 * 用于推荐专区、热门专区等需要横向多列布局的场景。
 * 与 PluginCard（列表卡片，水平布局）的区别：
 *   - PluginCompactCard: 垂直布局，更大尺寸，适合 4 列 grid
 *   - PluginCard:        水平布局，行内显示，适合 2 列 grid
 *
 * 设计要点：
 *   - 固定高度（200px），确保 grid 行对齐，留足呼吸感
 *   - 标题/简介支持截断，字体最小 12px（符合 UI 规范）
 *   - 简介精确 3 行截断（line-clamp-3 + 精确行高 + mt-auto），杜绝第 4 行露出
 *   - 支持 rank 徽章（热门专区用，前 3 名高亮）
 *   - 支持 featured 标识（推荐专区用）
 *   - 悬浮时上浮 + 阴影，交互反馈细腻
 */
import { Download, Sparkles, Star } from 'lucide-react'
import type { PluginMarketItem } from '@services/pluginService'
import { type Language } from '@renderer/i18n'
import { PluginIcon } from './PluginIcon'

interface PluginCompactCardProps {
  item: PluginMarketItem
  language: Language
  /** 热门排名（1-10），仅在热门专区使用 */
  rank?: number
  /** 是否已安装 */
  installed?: boolean
  /** 点击回调 */
  onClick: () => void
}

/** 格式化下载量（10w / 1.2k） */
function formatDownloads(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}w`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

export function PluginCompactCard({
  item,
  language,
  rank,
  installed = false,
  onClick,
}: PluginCompactCardProps) {
  const isZh = language === 'zh'
  const name = isZh ? item.nameZh : item.name
  const desc = isZh ? item.descriptionZh : item.description
  const isTopRank = rank !== undefined && rank <= 3

  return (
    <div
      onClick={onClick}
      className={`relative flex flex-col p-4 h-[200px] rounded-2xl border cursor-pointer transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 ${
        isTopRank
          ? 'border-orange-500/30 bg-gradient-to-br from-orange-500/[0.04] to-transparent hover:border-orange-500/50'
          : 'border-border/40 bg-bg-base hover:border-accent/40 hover:bg-bg-hover/30'
      }`}
    >
      {/* 排名徽章（热门专区用，绝对定位左上角） */}
      {rank !== undefined && (
        <span
          className={`absolute -top-2 -left-2 w-7 h-7 flex items-center justify-center rounded-full text-[12px] font-bold shadow-md ${
            isTopRank
              ? 'bg-gradient-to-br from-orange-400 to-red-500 text-white'
              : 'bg-bg-elevated text-text-muted border border-border/60'
          }`}
          title={isZh ? `排名第 ${rank}` : `Rank #${rank}`}
        >
          {rank}
        </span>
      )}

      {/* 推荐标识（推荐专区用，绝对定位右上角） */}
      {item.featured && rank === undefined && (
        <span className="absolute top-3 right-3 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
          <Sparkles className="w-3 h-3" />
        </span>
      )}

      {/* 头部：图标 + 名称 */}
      <div className="flex items-center gap-2.5 mb-2">
        <PluginIcon icon={item.icon} category={item.category} size={44} />
        <span
          className="text-[13px] font-semibold truncate flex-1"
          title={name}
        >
          {name}
        </span>
      </div>

      {/*
        简介（精确 3 行截断）
        - line-clamp-3：限制 3 行
        - leading-[1.5]：精确行高 18px，避免 leading-relaxed(1.625) 导致第 4 行像素露出
        - 不使用 flex-1：避免容器拉伸引起渲染截断不干净
        - 底部用 mt-auto 推至卡片底部，中间留白自然
      */}
      <p className="text-[12px] leading-[1.5] text-text-muted line-clamp-3 mb-3 overflow-hidden">
        {desc}
      </p>

      {/* 底部：评分 + 下载量 / 已安装徽章（mt-auto 推至卡片底部） */}
      <div className="flex items-center justify-between text-[12px] text-text-muted/80 mt-auto">
        {installed ? (
          <span className="flex items-center gap-1 text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {isZh ? '已安装' : 'Installed'}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
            <span className="font-medium">{item.rating.toFixed(1)}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <Download className="w-3.5 h-3.5" />
          <span>{formatDownloads(item.totalDownloads)}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * PluginPopularHeroCard — 热门专区前 2 名横向大卡片
 *
 * 用于热门专区第一行，2 列布局，每张占半行宽度。
 * 横向布局（图标在左，内容在右）更好利用宽度，视觉上突出 Top 2。
 *
 * 与 PluginCompactCard 的区别：
 *   - 横向布局（flex-row），适合 2 列 grid
 *   - 更大图标（64px）、更大标题（15px）
 *   - 固定高度 140px（横向布局信息密度足够，无需太高）
 *   - 橙色渐变背景 + 悬浮橙色阴影，强化"热门"视觉
 */
interface PluginPopularHeroCardProps {
  item: PluginMarketItem
  language: Language
  /** 热门排名（1 或 2） */
  rank: number
  /** 是否已安装 */
  installed?: boolean
  /** 点击回调 */
  onClick: () => void
}

export function PluginPopularHeroCard({
  item,
  language,
  rank,
  installed = false,
  onClick,
}: PluginPopularHeroCardProps) {
  const isZh = language === 'zh'
  const name = isZh ? item.nameZh : item.name
  const desc = isZh ? item.descriptionZh : item.description

  return (
    <div
      onClick={onClick}
      className="relative flex items-center gap-4 p-5 h-[140px] rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-500/[0.06] to-transparent hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10 cursor-pointer transition-all duration-200 group hover:-translate-y-0.5"
    >
      {/* 排名徽章（更大，渐变橙红） */}
      <span
        className="absolute -top-2.5 -left-2.5 w-8 h-8 flex items-center justify-center rounded-full text-[13px] font-bold shadow-md bg-gradient-to-br from-orange-400 to-red-500 text-white"
        title={isZh ? `排名第 ${rank}` : `Rank #${rank}`}
      >
        {rank}
      </span>

      {/* 图标（更大 64px） */}
      <PluginIcon icon={item.icon} category={item.category} size={64} />

      {/* 内容区 */}
      <div className="flex-1 min-w-0 flex flex-col h-full py-0.5">
        <h4
          className="text-[15px] font-semibold mb-1 truncate"
          title={name}
        >
          {name}
        </h4>
        {/* 简介 2 行截断（横向卡片宽度足够，2 行即可） */}
        <p className="text-[12px] leading-[1.5] text-text-muted line-clamp-2 mb-2 overflow-hidden">
          {desc}
        </p>
        {/* 底部统计（mt-auto 推至底部） */}
        <div className="flex items-center gap-4 text-[12px] text-text-muted/80 mt-auto">
          {installed ? (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              {isZh ? '已安装' : 'Installed'}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              <span className="font-medium">{item.rating.toFixed(1)}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <Download className="w-3.5 h-3.5" />
            <span>{formatDownloads(item.totalDownloads)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

/** 空状态占位（保持 grid 高度一致） */
export function PluginCompactCardPlaceholder() {
  return (
    <div className="h-[200px] rounded-2xl border border-dashed border-border/30 bg-bg-hover/10" />
  )
}

/** 区块标题 */
export function SectionHeader({
  icon,
  language,
  zhTitle,
  enTitle,
  zhSubtitle,
  enSubtitle,
}: {
  icon: React.ReactNode
  language: Language
  zhTitle: string
  enTitle: string
  zhSubtitle?: string
  enSubtitle?: string
}) {
  const isZh = language === 'zh'
  return (
    <div className="flex items-center gap-2.5 mb-4">
      {/* 左侧装饰色条 */}
      <span className="w-1 h-5 rounded-full bg-gradient-to-b from-accent to-accent/60" />
      <span className="text-accent">{icon}</span>
      <h3 className="text-base font-semibold text-text-primary tracking-tight">
        {isZh ? zhTitle : enTitle}
      </h3>
      {(zhSubtitle || enSubtitle) && (
        <span className="text-[12px] text-text-muted/60">
          {isZh ? zhSubtitle : enSubtitle}
        </span>
      )}
    </div>
  )
}
