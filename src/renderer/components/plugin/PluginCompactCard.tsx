/**
 * PluginCompactCard — 紧凑型插件卡片
 *
 * 用于推荐专区、热门专区等需要横向多列布局的场景。
 * 与 PluginCard（列表卡片，水平布局）的区别：
 *   - PluginCompactCard: 垂直布局，更小尺寸，适合 5 列 grid
 *   - PluginCard:        水平布局，行内显示，适合 2 列 grid
 *
 * 设计要点：
 *   - 固定高度，确保 grid 行对齐
 *   - 标题/简介支持截断
 *   - 支持 rank 徽章（热门专区用）
 *   - 支持 featured 标识（推荐专区用）
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

  return (
    <div
      onClick={onClick}
      className="relative flex flex-col p-3 h-[140px] rounded-xl border border-border/40 bg-bg-base hover:border-accent/40 hover:bg-bg-hover/30 cursor-pointer transition-all duration-200 group"
    >
      {/* 排名徽章（热门专区用，绝对定位左上角） */}
      {rank !== undefined && (
        <span
          className={`absolute -top-1.5 -left-1.5 w-5 h-5 flex items-center justify-center rounded-full text-[11px] font-bold shadow-md ${
            rank <= 3
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
        <Sparkles
          className="absolute top-2 right-2 w-3 h-3 text-yellow-400"
          aria-label={isZh ? '推荐' : 'Featured'}
        />
      )}

      {/* 头部：图标 + 名称 */}
      <div className="flex items-center gap-2 mb-1.5">
        <PluginIcon icon={item.icon} category={item.category} size={28} />
        <span className="text-xs font-medium truncate flex-1" title={name}>
          {name}
        </span>
      </div>

      {/* 简介（2 行截断） */}
      <p className="text-[11px] text-text-muted line-clamp-2 mb-2 flex-1">
        {desc}
      </p>

      {/* 底部：评分 + 下载量 / 已安装徽章 */}
      <div className="flex items-center justify-between text-[11px] text-text-muted/80">
        {installed ? (
          <span className="flex items-center gap-1 text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {isZh ? '已安装' : 'Installed'}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
            <span>{item.rating.toFixed(1)}</span>
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <Download className="w-3 h-3" />
          <span>{formatDownloads(item.totalDownloads)}</span>
        </span>
      </div>
    </div>
  )
}

/** 空状态占位（保持 grid 高度一致） */
export function PluginCompactCardPlaceholder() {
  return (
    <div className="h-[140px] rounded-xl border border-dashed border-border/30 bg-bg-hover/10" />
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
    <div className="flex items-center gap-2 mb-3">
      <span className="text-accent">{icon}</span>
      <h3 className="text-sm font-semibold text-text-primary">
        {isZh ? zhTitle : enTitle}
      </h3>
      {(zhSubtitle || enSubtitle) && (
        <span className="text-[12px] text-text-muted/70">
          {isZh ? zhSubtitle : enSubtitle}
        </span>
      )}
    </div>
  )
}
