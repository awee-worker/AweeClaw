/**
 * 行为热力图组件
 *
 * 渲染 GitHub 风格的活动热力图：
 * - 行：日期（按时间升序，最新在底部）
 * - 列：小时（0-23）
 * - 颜色深浅：行为数量
 *
 * 鼠标悬浮显示该时段的详细统计（数量、主要活动）。
 */
import { memo, useMemo } from 'react'
import type { BehaviorHeatmapCell } from '@main/preload/api/perception'
import { t, type Language } from '@renderer/i18n'

interface BehaviorHeatmapProps {
  /** 热力图单元格数据 */
  cells: BehaviorHeatmapCell[]
  /** 语言 */
  language: Language
}

/** 活动类型颜色映射 */
const ACTIVITY_COLORS: Record<string, string> = {
  coding: '#8b5cf6',     // 紫色
  browsing: '#06b6d4',   // 青色
  chatting: '#10b981',   // 绿色
  reading: '#f59e0b',    // 黄色
  writing: '#ec4899',    // 粉色
  debugging: '#ef4444',  // 红色
  idle: '#6b7280',       // 灰色
  unknown: '#9ca3af',    // 浅灰
}

/**
 * 根据数量计算热力图单元格颜色深浅
 * 使用 5 级渐变：0 / 1-3 / 4-7 / 8-12 / 13+
 */
function getCellIntensity(count: number, maxCount: number): number {
  if (count === 0 || maxCount === 0) return 0
  const ratio = count / maxCount
  if (ratio < 0.2) return 1
  if (ratio < 0.4) return 2
  if (ratio < 0.7) return 3
  return 4
}

/** 强度等级对应的透明度 */
const INTENSITY_OPACITY = [0.08, 0.25, 0.5, 0.75, 1.0]

export const BehaviorHeatmap = memo(function BehaviorHeatmap({
  cells,
  language,
}: BehaviorHeatmapProps) {
  // 重组数据为 { date -> { hour -> cell } } 结构
  const { dateList, cellMap, maxCount } = useMemo(() => {
    const map = new Map<string, Map<number, BehaviorHeatmapCell>>()
    let max = 0

    for (const cell of cells) {
      let dayMap = map.get(cell.date)
      if (!dayMap) {
        dayMap = new Map()
        map.set(cell.date, dayMap)
      }
      dayMap.set(cell.hour, cell)
      if (cell.count > max) max = cell.count
    }

    const dates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b))

    return {
      dateList: dates,
      cellMap: map,
      maxCount: max,
    }
  }, [cells])

  // 周几标签
  const weekdayLabels = useMemo(() => {
    const raw = t('perception.timeline.weekdayShort', language)
    return raw.split(',')
  }, [language])

  if (dateList.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        {t('perception.timeline.noScenes', language)}
      </div>
    )
  }

  // 小时列标签（0, 3, 6, 9, 12, 15, 18, 21）
  const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21]

  return (
    <div className="space-y-3">
      {/* 热力图主体 */}
      <div className="overflow-x-auto custom-scrollbar">
        <div className="inline-block min-w-full">
          {/* 小时列头 */}
          <div
            className="grid gap-[3px] mb-1 ml-8"
            style={{ gridTemplateColumns: 'repeat(24, 16px)' }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={`hour-${h}`}
                className="text-[10px] text-text-muted text-center leading-none"
                style={{ visibility: hourLabels.includes(h) ? 'visible' : 'hidden' }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* 日期行 */}
          <div className="space-y-[3px]">
            {dateList.map(date => {
              const dayMap = cellMap.get(date)!
              const d = new Date(date + 'T00:00:00')
              const weekday = d.getDay()
              const weekdayLabel = weekdayLabels[weekday] ?? ''
              // 每隔几行显示一次日期标签，避免过密
              const dateIndex = dateList.indexOf(date)
              const showDateLabel = dateIndex % Math.max(1, Math.floor(dateList.length / 6)) === 0
              const dateLabel = showDateLabel
                ? t('perception.timeline.dateFormat', language, {
                    month: String(d.getMonth() + 1),
                    day: String(d.getDate()),
                  })
                : ''

              return (
                <div key={date} className="flex items-center gap-2">
                  {/* 日期 + 周几 标签 */}
                  <div className="w-8 shrink-0 flex items-center gap-1">
                    <span className="text-[10px] text-text-muted" title={dateLabel}>
                      {dateLabel}
                    </span>
                    <span className="text-[9px] text-text-muted/60" title={weekdayLabel}>
                      {weekdayLabel.slice(0, 1)}
                    </span>
                  </div>

                  {/* 24 小时单元格 */}
                  <div
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: 'repeat(24, 16px)' }}
                  >
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = dayMap.get(h)
                      const count = cell?.count ?? 0
                      const activity = cell?.topActivity ?? 'unknown'
                      const intensity = getCellIntensity(count, maxCount)
                      const opacity = INTENSITY_OPACITY[intensity]
                      const baseColor = ACTIVITY_COLORS[activity] ?? ACTIVITY_COLORS.unknown

                      const tooltip = count > 0
                        ? `${date} ${h}:00 - ${h + 1}:00\n${t('perception.timeline.behaviorCount', language)}: ${count}\n${t('perception.timeline.topActivity', language)}: ${activity}`
                        : `${date} ${h}:00 - ${h + 1}:00\n${t('perception.timeline.behaviorCount', language)}: 0`

                      return (
                        <div
                          key={`${date}-${h}`}
                          className="w-4 h-4 rounded-[3px] transition-transform hover:scale-125 hover:z-10 relative"
                          style={{
                            backgroundColor: count > 0 ? baseColor : 'rgba(107, 114, 128, 0.08)',
                            opacity: count > 0 ? opacity : 1,
                            border: count > 0 ? `0.5px solid ${baseColor}` : '0.5px solid rgba(107, 114, 128, 0.15)',
                          }}
                          title={tooltip}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex items-center justify-between pt-3 border-t border-border/30">
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span>{t('perception.timeline.heatmapLegend', language)}</span>
          <div className="flex items-center gap-1">
            {INTENSITY_OPACITY.map((opacity, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-[2px]"
                style={{
                  backgroundColor: i === 0
                    ? 'rgba(107, 114, 128, 0.08)'
                    : ACTIVITY_COLORS.coding,
                  opacity: i === 0 ? 1 : opacity,
                }}
              />
            ))}
          </div>
          <span className="text-[10px]">{t('perception.timeline.less', language)}</span>
          <span className="text-[10px]">{t('perception.timeline.more', language)}</span>
        </div>

        {/* 活动类型色块 */}
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          {Object.entries(ACTIVITY_COLORS).slice(0, 6).map(([activity, color]) => (
            <div key={activity} className="flex items-center gap-1">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span>{activity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
