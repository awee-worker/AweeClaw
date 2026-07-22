/**
 * 场景列表面板
 *
 * 展示历史场景列表，支持：
 * - 滚动浏览（虚拟化未启用，假设单次加载 ≤500 条）
 * - 点击查看场景详情
 * - 按应用/活动类型筛选
 */
import { memo, useState, useMemo } from 'react'
import { Clock, Filter, X, FileText, AppWindow } from 'lucide-react'
import type { SceneTimelineItem } from '@main/preload/api/perception'
import { t, type Language } from '@renderer/i18n'

interface SceneListPanelProps {
  /** 场景列表 */
  scenes: SceneTimelineItem[]
  /** 语言 */
  language: Language
}

/** 活动类型颜色映射（与 BehaviorHeatmap 保持一致） */
const ACTIVITY_COLORS: Record<string, string> = {
  coding: 'bg-violet-500/15 text-violet-500 border-violet-500/20',
  browsing: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/20',
  chatting: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  reading: 'bg-amber-500/15 text-amber-500 border-amber-500/20',
  writing: 'bg-pink-500/15 text-pink-500 border-pink-500/20',
  debugging: 'bg-red-500/15 text-red-500 border-red-500/20',
  idle: 'bg-gray-500/15 text-gray-500 border-gray-500/20',
  unknown: 'bg-gray-500/10 text-text-muted border-border/40',
}

/** 格式化时间戳为可读字符串 */
function formatTimestamp(ts: number, language: Language): string {
  const d = new Date(ts)
  const dateStr = t('perception.timeline.dateFormat', language, {
    month: String(d.getMonth() + 1),
    day: String(d.getDate()),
  })
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dateStr} ${hh}:${mm}`
}

export const SceneListPanel = memo(function SceneListPanel({
  scenes,
  language,
}: SceneListPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [appFilter, setAppFilter] = useState<string>('')
  const [activityFilter, setActivityFilter] = useState<string>('')

  // 提取应用列表与活动类型列表（去重）
  const { appOptions, activityOptions } = useMemo(() => {
    const apps = new Set<string>()
    const activities = new Set<string>()
    for (const s of scenes) {
      if (s.app) apps.add(s.app)
      if (s.activity) activities.add(s.activity)
    }
    return {
      appOptions: Array.from(apps).sort(),
      activityOptions: Array.from(activities).sort(),
    }
  }, [scenes])

  // 应用筛选
  const filteredScenes = useMemo(() => {
    return scenes.filter(s => {
      if (appFilter && s.app !== appFilter) return false
      if (activityFilter && s.activity !== activityFilter) return false
      return true
    })
  }, [scenes, appFilter, activityFilter])

  // 当前选中场景
  const selectedScene = useMemo(
    () => filteredScenes.find(s => s.id === selectedId) ?? null,
    [filteredScenes, selectedId],
  )

  if (scenes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted text-sm">
        {t('perception.timeline.noScenes', language)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap p-2 bg-surface/30 rounded-xl border border-border/40">
        <div className="flex items-center gap-1 text-text-muted">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[11px] uppercase tracking-wider">Filter</span>
        </div>

        {/* 应用筛选 */}
        <select
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="text-[12px] bg-surface border border-border/60 rounded-md px-2 py-1 text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">{t('perception.timeline.app', language)}</option>
          {appOptions.map(app => (
            <option key={app} value={app}>{app}</option>
          ))}
        </select>

        {/* 活动类型筛选 */}
        <select
          value={activityFilter}
          onChange={(e) => setActivityFilter(e.target.value)}
          className="text-[12px] bg-surface border border-border/60 rounded-md px-2 py-1 text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="">{t('perception.timeline.activity', language)}</option>
          {activityOptions.map(act => (
            <option key={act} value={act}>{act}</option>
          ))}
        </select>

        {(appFilter || activityFilter) && (
          <button
            onClick={() => { setAppFilter(''); setActivityFilter('') }}
            className="text-[11px] text-text-muted hover:text-text-primary flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-hover"
          >
            <X className="w-3 h-3" />
            {t('perception.timeline.retry', language) === '重试' ? '清除' : 'Clear'}
          </button>
        )}

        <span className="ml-auto text-[11px] text-text-muted">
          {filteredScenes.length} / {scenes.length}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 场景列表 */}
        <div className="space-y-1 max-h-[460px] overflow-y-auto custom-scrollbar pr-1">
          {filteredScenes.map(scene => {
            const isSelected = scene.id === selectedId
            const activityCls = ACTIVITY_COLORS[scene.activity] ?? ACTIVITY_COLORS.unknown
            return (
              <button
                key={scene.id}
                onClick={() => setSelectedId(scene.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-accent/40 bg-accent/5 shadow-sm'
                    : 'border-border/40 bg-surface/30 hover:bg-surface/50 hover:border-border/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <AppWindow className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {scene.app || '(unknown)'}
                    </span>
                  </div>
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${activityCls}`}>
                    {scene.activity}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-text-muted">
                  <Clock className="w-3 h-3" />
                  <span>{formatTimestamp(scene.timestamp, language)}</span>
                  {scene.windowTitle && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="truncate">{scene.windowTitle}</span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* 场景详情 */}
        <div className="p-4 bg-surface/30 rounded-xl border border-border/40 min-h-[200px]">
          {selectedScene ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-border/30 pb-2">
                <h5 className="text-sm font-bold text-text-primary">
                  {t('perception.timeline.sceneDetail', language)}
                </h5>
                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${ACTIVITY_COLORS[selectedScene.activity] ?? ACTIVITY_COLORS.unknown}`}>
                  {selectedScene.activity}
                </span>
              </div>

              <DetailRow
                icon={<Clock className="w-3.5 h-3.5" />}
                label={t('perception.timeline.timestamp', language)}
                value={formatTimestamp(selectedScene.timestamp, language)}
              />

              <DetailRow
                icon={<AppWindow className="w-3.5 h-3.5" />}
                label={t('perception.timeline.app', language)}
                value={selectedScene.app || '(unknown)'}
              />

              {selectedScene.windowTitle && (
                <DetailRow
                  icon={<AppWindow className="w-3.5 h-3.5" />}
                  label={t('perception.timeline.windowTitle', language)}
                  value={selectedScene.windowTitle}
                />
              )}

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-wider">
                  <FileText className="w-3.5 h-3.5" />
                  {t('perception.timeline.textSummary', language)}
                </div>
                <div className="text-[12px] text-text-primary bg-surface/50 rounded-lg p-3 leading-relaxed max-h-[200px] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                  {selectedScene.textSummary || t('perception.timeline.noTextSummary', language)}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm py-12">
              {t('perception.timeline.scenes', language)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

/** 详情行 */
function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-wider min-w-[80px] pt-0.5">
        {icon}
        {label}
      </div>
      <div className="flex-1 text-[12px] text-text-primary break-words">{value}</div>
    </div>
  )
}
