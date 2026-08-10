/**
 * CronBuilder — Cron 表达式可视化生成器
 *
 * 功能：
 * - 通过预设模板快速选择常见 Cron 表达式
 * - 分段编辑（分钟/小时/日/月/周），支持每值、指定值、区间、步进
 * - 实时预览生成的 Cron 表达式 + 人类可读描述
 * - 中英文双语
 *
 * Cron 格式：分 时 日 月 周（5 段）
 */
import { useState, useMemo, useCallback } from 'react'
import { OverlayDialog } from '@components/ui/OverlayDialog'
import { useStore } from '@store'
import { Clock, Calendar, RefreshCw } from 'lucide-react'

interface CronBuilderProps {
  /** 初始 Cron 表达式 */
  value: string
  /** 确认选择时回调，返回新的 Cron 表达式 */
  onConfirm: (cron: string) => void
  onClose: () => void
}

/** Cron 段定义 */
type SegmentKey = 'minute' | 'hour' | 'day' | 'month' | 'weekday'

interface SegmentConfig {
  key: SegmentKey
  labelZh: string
  label: string
  min: number
  max: number
}

const SEGMENTS: SegmentConfig[] = [
  { key: 'minute', labelZh: '分钟', label: 'Minute', min: 0, max: 59 },
  { key: 'hour', labelZh: '小时', label: 'Hour', min: 0, max: 23 },
  { key: 'day', labelZh: '日', label: 'Day', min: 1, max: 31 },
  { key: 'month', labelZh: '月', label: 'Month', min: 1, max: 12 },
  { key: 'weekday', labelZh: '周', label: 'Weekday', min: 0, max: 6 },
]

/** 段模式 */
type SegmentMode = 'every' | 'value' | 'range' | 'step'

/** 段状态 */
interface SegmentState {
  mode: SegmentMode
  value: number
  rangeStart: number
  rangeEnd: number
  stepValue: number
  stepBase: number
}

/** 预设模板 */
interface Preset {
  id: string
  labelZh: string
  label: string
  cron: string
  descZh: string
  desc: string
}

const PRESETS: Preset[] = [
  { id: 'every-min', labelZh: '每分钟', label: 'Every minute', cron: '* * * * *', descZh: '每分钟执行', desc: 'Runs every minute' },
  { id: 'every-5min', labelZh: '每 5 分钟', label: 'Every 5 minutes', cron: '*/5 * * * *', descZh: '每 5 分钟执行', desc: 'Runs every 5 minutes' },
  { id: 'every-15min', labelZh: '每 15 分钟', label: 'Every 15 minutes', cron: '*/15 * * * *', descZh: '每 15 分钟执行', desc: 'Runs every 15 minutes' },
  { id: 'every-30min', labelZh: '每 30 分钟', label: 'Every 30 minutes', cron: '*/30 * * * *', descZh: '每 30 分钟执行', desc: 'Runs every 30 minutes' },
  { id: 'hourly', labelZh: '每小时', label: 'Hourly', cron: '0 * * * *', descZh: '每整点执行', desc: 'Runs at the top of every hour' },
  { id: 'every-2h', labelZh: '每 2 小时', label: 'Every 2 hours', cron: '0 */2 * * *', descZh: '每 2 小时执行一次', desc: 'Runs every 2 hours' },
  { id: 'daily-9', labelZh: '每天 9:00', label: 'Daily at 9:00', cron: '0 9 * * *', descZh: '每天上午 9:00 执行', desc: 'Runs daily at 9:00 AM' },
  { id: 'daily-18', labelZh: '每天 18:00', label: 'Daily at 18:00', cron: '0 18 * * *', descZh: '每天下午 18:00 执行', desc: 'Runs daily at 6:00 PM' },
  { id: 'weekday-9', labelZh: '工作日 9:00', label: 'Weekdays at 9:00', cron: '0 9 * * 1-5', descZh: '周一至周五上午 9:00 执行', desc: 'Runs at 9:00 AM, Monday to Friday' },
  { id: 'weekday-18', labelZh: '工作日 18:00', label: 'Weekdays at 18:00', cron: '0 18 * * 1-5', descZh: '周一至周五下午 18:00 执行', desc: 'Runs at 6:00 PM, Monday to Friday' },
  { id: 'weekly-mon', labelZh: '每周一 9:00', label: 'Weekly Monday 9:00', cron: '0 9 * * 1', descZh: '每周一上午 9:00 执行', desc: 'Runs at 9:00 AM every Monday' },
  { id: 'monthly-1', labelZh: '每月 1 日 0:00', label: 'Monthly 1st at 0:00', cron: '0 0 1 * *', descZh: '每月 1 日凌晨执行', desc: 'Runs at midnight on the 1st of every month' },
  { id: 'quarterly', labelZh: '每季度', label: 'Quarterly', cron: '0 0 1 1,4,7,10 *', descZh: '每季度首月 1 日执行', desc: 'Runs on the 1st of Jan, Apr, Jul, Oct' },
  { id: 'yearly', labelZh: '每年', label: 'Yearly', cron: '0 0 1 1 *', descZh: '每年 1 月 1 日执行', desc: 'Runs at midnight on January 1st' },
]

const WEEKDAY_NAMES_ZH = ['日', '一', '二', '三', '四', '五', '六']
const WEEKDAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES_ZH = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const MONTH_NAMES_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 各段的最小/最大值（供 parseCron 回退使用） */
const SEGMENT_LIMITS: Record<SegmentKey, { min: number; max: number }> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  day: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  weekday: { min: 0, max: 6 },
}

/** 解析 Cron 字符串为段状态 */
function parseCron(cron: string): Record<SegmentKey, SegmentState> {
  const parts = cron.trim().split(/\s+/)
  const defaults: Record<SegmentKey, SegmentState> = {
    minute: { mode: 'every', value: 0, rangeStart: 0, rangeEnd: 59, stepValue: 1, stepBase: 0 },
    hour: { mode: 'every', value: 0, rangeStart: 0, rangeEnd: 23, stepValue: 1, stepBase: 0 },
    day: { mode: 'every', value: 1, rangeStart: 1, rangeEnd: 31, stepValue: 1, stepBase: 1 },
    month: { mode: 'every', value: 1, rangeStart: 1, rangeEnd: 12, stepValue: 1, stepBase: 1 },
    weekday: { mode: 'every', value: 0, rangeStart: 0, rangeEnd: 6, stepValue: 1, stepBase: 0 },
  }

  const keys: SegmentKey[] = ['minute', 'hour', 'day', 'month', 'weekday']
  for (let i = 0; i < 5 && i < parts.length; i++) {
    const part = parts[i]
    const key = keys[i]
    const seg = defaults[key]

    if (part === '*') {
      seg.mode = 'every'
    } else if (part.includes('*/')) {
      seg.mode = 'step'
      seg.stepValue = parseInt(part.slice(2), 10) || 1
      seg.stepBase = 0
    } else if (part.includes('-')) {
      const [s, e] = part.split('-')
      seg.mode = 'range'
      const limits = SEGMENT_LIMITS[key]
      seg.rangeStart = parseInt(s, 10) || limits.min
      seg.rangeEnd = parseInt(e, 10) || limits.max
    } else {
      seg.mode = 'value'
      seg.value = parseInt(part, 10) || 0
    }
  }

  return defaults
}

/** 段状态转 Cron 字符串 */
function segmentToCron(seg: SegmentState): string {
  switch (seg.mode) {
    case 'every': return '*'
    case 'value': return String(seg.value)
    case 'range': return `${seg.rangeStart}-${seg.rangeEnd}`
    case 'step': return `*/${seg.stepValue}`
    default: return '*'
  }
}

/** 生成 Cron 表达式的人类可读描述 */
function describeCron(states: Record<SegmentKey, SegmentState>, isZh: boolean): string {
  const m = states.minute
  const h = states.hour
  const d = states.day
  const mon = states.month
  const w = states.weekday

  const weekdays = isZh ? WEEKDAY_NAMES_ZH : WEEKDAY_NAMES_EN
  const months = isZh ? MONTH_NAMES_ZH : MONTH_NAMES_EN
  const at = isZh ? '' : 'at'
  const every = isZh ? '每' : 'Every '

  // 构建时间部分
  let timePart = ''
  if (h.mode === 'every' && m.mode === 'every') {
    timePart = isZh ? '每分钟' : 'every minute'
  } else if (h.mode === 'every' && m.mode === 'step') {
    timePart = `${every}${m.stepValue}${isZh ? '分钟' : ' minutes'}`
  } else if (h.mode === 'every' && m.mode === 'value') {
    timePart = `${isZh ? '每小时' : 'every hour'} ${at} :${String(m.value).padStart(2, '0')}`
  } else if (h.mode === 'value' && m.mode === 'value') {
    timePart = `${at} ${String(h.value).padStart(2, '0')}:${String(m.value).padStart(2, '0')}`
  } else if (h.mode === 'step' && m.mode === 'value') {
    timePart = `${isZh ? `每 ${h.stepValue} 小时` : `every ${h.stepValue} hours`} ${at} :${String(m.value).padStart(2, '0')}`
  } else if (h.mode === 'step' && m.mode === 'every') {
    timePart = `${every}${h.stepValue}${isZh ? '小时' : ' hours'}`
  } else {
    timePart = isZh ? '自定义时间' : 'custom schedule'
  }

  // 构建日期部分
  let datePart = ''
  if (d.mode === 'every' && mon.mode === 'every' && w.mode === 'every') {
    datePart = isZh ? '每天' : 'every day'
  } else if (d.mode === 'every' && mon.mode === 'every' && w.mode === 'range') {
    datePart = isZh ? `每周${weekdays[w.rangeStart]}至周${weekdays[w.rangeEnd]}` : `every ${weekdays[w.rangeStart]} to ${weekdays[w.rangeEnd]}`
  } else if (d.mode === 'every' && mon.mode === 'every' && w.mode === 'value') {
    datePart = isZh ? `每周${weekdays[w.value]}` : `every ${weekdays[w.value]}`
  } else if (d.mode === 'value' && mon.mode === 'every') {
    datePart = `${isZh ? '每月' : 'on the'} ${d.value}${isZh ? '日' : ''}`
  } else if (d.mode === 'value' && mon.mode === 'value') {
    datePart = `${isZh ? `${months[mon.value]}${d.value}日` : `on ${months[mon.value]} ${d.value}`}`
  } else if (d.mode === 'every' && mon.mode === 'value') {
    datePart = `${isZh ? `每年${months[mon.value]}` : `every ${months[mon.value]}`}`
  } else {
    datePart = isZh ? '自定义日期' : 'custom date'
  }

  return `${datePart} ${timePart}`
}

/** 单段编辑器 */
function SegmentEditor({
  config,
  state,
  isZh,
  onChange,
}: {
  config: SegmentConfig
  state: SegmentState
  isZh: boolean
  onChange: (state: SegmentState) => void
}) {
  const modes: Array<{ value: SegmentMode; labelZh: string; label: string }> = [
    { value: 'every', labelZh: '每', label: 'Every' },
    { value: 'value', labelZh: '指定', label: 'At' },
    { value: 'range', labelZh: '区间', label: 'Range' },
    { value: 'step', labelZh: '步进', label: 'Step' },
  ]

  const inputCls = 'w-full px-2 py-1.5 bg-surface/50 rounded-md border border-border/40 focus:border-accent/50 text-[12px] text-text-primary outline-none transition-colors'
  const labelCls = 'text-[12px] text-text-secondary'
  const modeBtnCls = (active: boolean) =>
    `px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${
      active ? 'bg-accent text-accent-foreground' : 'bg-surface/40 text-text-muted hover:text-text-secondary hover:bg-surface-hover/50'
    }`

  return (
    <div className="p-3 rounded-lg bg-surface/30 border border-border/20">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Calendar className="w-3.5 h-3.5 text-accent" />
        <span className="text-[13px] font-medium text-text-primary">{isZh ? config.labelZh : config.label}</span>
        <span className="text-[11px] text-text-muted ml-auto font-mono">
          {config.key === 'weekday' ? `(0-6, 0=${isZh ? '日' : 'Sun'})` : `(${config.min}-${config.max})`}
        </span>
      </div>

      {/* 模式切换 */}
      <div className="flex gap-1 mb-2.5">
        {modes.map(m => (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange({ ...state, mode: m.value })}
            className={modeBtnCls(state.mode === m.value)}
          >
            {isZh ? m.labelZh : m.label}
          </button>
        ))}
      </div>

      {/* 模式对应输入 */}
      <div className="min-h-[34px]">
        {state.mode === 'every' && (
          <p className="text-[12px] text-text-muted py-1.5">
            {isZh ? `每${config.labelZh}` : `Every ${config.label.toLowerCase()}`}
          </p>
        )}
        {state.mode === 'value' && (
          <div className="flex items-center gap-2">
            <span className={labelCls}>{isZh ? '值为' : 'Value'}</span>
            <input
              type="number"
              min={config.min}
              max={config.max}
              value={state.value}
              onChange={e => {
                const v = Math.max(config.min, Math.min(config.max, parseInt(e.target.value, 10) || config.min))
                onChange({ ...state, value: v })
              }}
              className={`${inputCls} w-20`}
            />
          </div>
        )}
        {state.mode === 'range' && (
          <div className="flex items-center gap-2">
            <span className={labelCls}>{isZh ? '从' : 'From'}</span>
            <input
              type="number"
              min={config.min}
              max={config.max}
              value={state.rangeStart}
              onChange={e => {
                const v = Math.max(config.min, Math.min(config.max, parseInt(e.target.value, 10) || config.min))
                onChange({ ...state, rangeStart: v })
              }}
              className={`${inputCls} w-20`}
            />
            <span className={labelCls}>{isZh ? '到' : 'to'}</span>
            <input
              type="number"
              min={config.min}
              max={config.max}
              value={state.rangeEnd}
              onChange={e => {
                const v = Math.max(config.min, Math.min(config.max, parseInt(e.target.value, 10) || config.max))
                onChange({ ...state, rangeEnd: v })
              }}
              className={`${inputCls} w-20`}
            />
          </div>
        )}
        {state.mode === 'step' && (
          <div className="flex items-center gap-2">
            <span className={labelCls}>{isZh ? '每' : 'Every'}</span>
            <input
              type="number"
              min={1}
              max={config.max}
              value={state.stepValue}
              onChange={e => {
                const v = Math.max(1, Math.min(config.max, parseInt(e.target.value, 10) || 1))
                onChange({ ...state, stepValue: v })
              }}
              className={`${inputCls} w-20`}
            />
            <span className="text-[12px] text-text-muted">{config.labelZh}{isZh ? '' : `(s)`}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function CronBuilder({ value, onConfirm, onClose }: CronBuilderProps) {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [states, setStates] = useState<Record<SegmentKey, SegmentState>>(() => parseCron(value || '* * * * *'))
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets')

  /** 当前生成的 Cron 表达式 */
  const cronString = useMemo(() => {
    return [
      segmentToCron(states.minute),
      segmentToCron(states.hour),
      segmentToCron(states.day),
      segmentToCron(states.month),
      segmentToCron(states.weekday),
    ].join(' ')
  }, [states])

  /** 人类可读描述 */
  const description = useMemo(() => describeCron(states, isZh), [states, isZh])

  /** 应用预设 */
  const applyPreset = useCallback((cron: string) => {
    setStates(parseCron(cron))
  }, [])

  /** 更新某一段 */
  const updateSegment = useCallback((key: SegmentKey, seg: SegmentState) => {
    setStates(prev => ({ ...prev, [key]: seg }))
  }, [])

  return (
    <OverlayDialog isOpen onClose={onClose} size="2xl" noPadding>
      <div className="p-5">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-accent" />
          <h2 className="text-[16px] font-semibold text-text-primary">
            {isZh ? 'Cron 表达式生成器' : 'Cron Expression Builder'}
          </h2>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 mb-4 p-1 bg-surface/40 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`flex-1 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              activeTab === 'presets'
                ? 'bg-accent text-accent-foreground'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover/50'
            }`}
          >
            {isZh ? '常用预设' : 'Presets'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            className={`flex-1 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
              activeTab === 'custom'
                ? 'bg-accent text-accent-foreground'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover/50'
            }`}
          >
            {isZh ? '自定义' : 'Custom'}
          </button>
        </div>

        {/* 内容区 */}
        <div className="max-h-[340px] overflow-y-auto custom-scrollbar">
          {activeTab === 'presets' && (
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map(preset => {
                const isActive = preset.cron === cronString
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.cron)}
                    className={`text-left p-2.5 rounded-lg border transition-all ${
                      isActive
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border/20 hover:border-border/40 hover:bg-surface-hover/30'
                    }`}
                  >
                    <div className="text-[13px] font-medium text-text-primary mb-0.5">
                      {isZh ? preset.labelZh : preset.label}
                    </div>
                    <div className="text-[11px] text-text-muted font-mono mb-0.5">{preset.cron}</div>
                    <div className="text-[11px] text-text-secondary">
                      {isZh ? preset.descZh : preset.desc}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="space-y-2">
              {SEGMENTS.map(config => (
                <SegmentEditor
                  key={config.key}
                  config={config}
                  state={states[config.key]}
                  isZh={isZh}
                  onChange={seg => updateSegment(config.key, seg)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 预览区 */}
        <div className="mt-4 p-3 rounded-lg bg-accent/5 border border-accent/20">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-medium text-accent">
              {isZh ? '生成结果' : 'Result'}
            </span>
            <button
              type="button"
              onClick={() => setStates(parseCron('* * * * *'))}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-text-muted hover:text-text-secondary hover:bg-surface-hover/50 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {isZh ? '重置' : 'Reset'}
            </button>
          </div>
          <div className="text-[16px] font-mono font-bold text-text-primary mb-1 tracking-wide">
            {cronString}
          </div>
          <p className="text-[12px] text-text-secondary">{description}</p>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-hover/50 transition-colors"
          >
            {isZh ? '取消' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(cronString)}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-accent-foreground hover:bg-accent-hover transition-colors"
          >
            {isZh ? '确认' : 'Confirm'}
          </button>
        </div>
      </div>
    </OverlayDialog>
  )
}
