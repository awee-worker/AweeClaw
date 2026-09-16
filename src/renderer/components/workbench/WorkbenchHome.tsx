/**
 * WorkbenchHome — 工作台首页（macOS 桌面小组件风格）
 *
 * 结构：
 * - 顶部栏：问候语 + 日期 + 场景模式分段切换（工作/生活/学习）+ 自定义按钮
 * - 卡片墙：一张卡片一个入口（操作卡 / 工具卡），macOS 桌面小组件式网格布局
 *   - 操作卡：新建任务、打开文件夹、场景市场、场景工具、场景管理、最近工作
 *     · 「新建任务」卡片的描述文案随场景模式动态轮换，与新建任务页（空对话态）欢迎语同源
 *   - 工具卡：当前模式的内置工具，实时展示数据摘要（待办数、今日专注、本周周报等）
 *   - 卡片可添加 / 移除，不同模式拥有独立卡片集合与默认配置
 * - 添加卡片弹层：macOS 小组件库风格，按当前模式分组选择
 *
 * 模式默认卡片（见 layoutSlice WORKBENCH_DEFAULT_WIDGETS）：
 *   work  → 新建任务、待办清单、工作周报、番茄专注钟、最近工作
 *   life  → 新建任务、记账本、喝水打卡、心情日记、最近工作
 *   study → 新建任务、闪卡复习、学习计划、学习番茄钟、最近工作
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowRight,
  Blocks,
  Briefcase,
  Check,
  Clock,
  Eraser,
  FolderOpen,
  GraduationCap,
  Heart,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  MessageSquare,
  Move,
  Palette,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Store,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { WorkbenchBackground, WorkbenchCardPos } from '@/renderer/state/slices/layoutSlice'
import { api } from '@renderer/adapters/electronBridge'
import { workspaceManager, WorkspaceOpenError } from '@services/WorkspaceAdapter'
import { useStore } from '@store'
import { useAgentActions } from '@hooks/useAgent'
import { getLucideIcon } from '@components/foundation/IconMap'
import { logger } from '@toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import { getFileName } from '@shared/toolkit/pathHelper'
import { t, type Language } from '@renderer/i18n'
import { useSceneModeStore } from '@/renderer/modes/sceneModeStore'
import { useModeStore } from '@/renderer/modes/workModeStore'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import type { SceneModeProfile, TimePeriod } from '@intelligence/capabilities/sceneMode/SceneModeDescriptor'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { getToolsByMode, getToolById } from '@components/scene-tools/registry'

import { pluginUiRegistry } from '@renderer/plugins/PluginUiRegistry'
import { usePluginWidgetCards } from '@renderer/plugins/usePluginExtensions'
import type { PluginWidgetCardContribution } from '@shared/plugin-sdk/types'
import type { ScenarioWidgetCardContribution } from '@shared/protocols/scenario'
import { scenarioWidgetRegistry } from '@scenario-system/core/ScenarioWidgetRegistry'
import {
  todayStr,
  useTodoStore,
  useWorkPlanStore,
  usePomodoroStore,
  useMeetingStore,
  useWeeklyReportStore,
  useFileRuleStore,
  useWorkHourStore,
  useSnippetStore,
  useLedgerStore,
  useWaterStore,
  useMoodStore,
  useShoppingStore,
  useAnniversaryStore,
  useRecipeStore,
  useFlashcardStore,
  useMistakeStore,
  useNoteStore,
  useReadingStore,
  usePlanStore,
} from '@components/scene-tools/stores'

/* ===================== 常量定义 ===================== */

/** 场景模式展示元数据 */
const MODE_META: Record<SceneMode, { icon: LucideIcon; color: string; descZh: string; descEn: string }> = {
  work: { icon: Briefcase, color: '#3B82F6', descZh: '高效办公，任务、会议与文档协作', descEn: 'Efficient work, tasks & docs' },
  life: { icon: Heart, color: '#F97316', descZh: '生活记录，账本、打卡与日常', descEn: 'Track life & daily habits' },
  study: { icon: GraduationCap, color: '#10B981', descZh: '专注学习，闪卡、错题与计划', descEn: 'Focus on learning' },
}

/** 操作卡定义（所有模式通用） */
interface ActionCardDef {
  id: string
  icon: LucideIcon
  titleZh: string
  titleEn: string
  descZh: string
  descEn: string
  color: string
}

const ACTION_CARDS: ActionCardDef[] = [
  { id: 'new-chat', icon: MessageSquare, color: '#3B82F6', titleZh: '新建任务', titleEn: 'New Task', descZh: '与 AI 助手开始一项新任务', descEn: 'Start a new task with AI' },
  { id: 'open-folder', icon: FolderOpen, color: '#8B5CF6', titleZh: '打开文件夹', titleEn: 'Open Folder', descZh: '打开或切换工作目录', descEn: 'Open or switch workspace' },
  { id: 'open-market', icon: Store, color: '#F97316', titleZh: '场景市场', titleEn: 'Scenario Market', descZh: '发现并安装新场景', descEn: 'Discover new scenarios' },
  { id: 'open-scene-tools', icon: Blocks, color: '#10B981', titleZh: '场景工具', titleEn: 'Scene Tools', descZh: '全部工具面板', descEn: 'All scene tools' },
  { id: 'scenarios', icon: LayoutGrid, color: '#06B6D4', titleZh: '场景管理', titleEn: 'Scenarios', descZh: '管理已安装的 AI 场景', descEn: 'Manage installed scenarios' },
  { id: 'recent-workspaces', icon: Clock, color: '#EC4899', titleZh: '最近工作', titleEn: 'Recent Work', descZh: '最近打开的工作区', descEn: 'Recently opened workspaces' },
]

/** 工具卡图标色板（按工具 id 循环取色） */
const TOOL_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#10B981', '#06B6D4', '#F59E0B', '#6366F1', '#14B8A6', '#E11D48']

/** 工作台卡片宫格尺寸（一格宽/高，跨格时按倍数放大） */
const CARD_W = 236
const CARD_H = 168
const CARD_GAP = 16
const WALL_PAD = 24
/** 宫格默认列数（桌面端），窄窗口按容器宽度自动收缩 */
const GRID_COLS = 4

/** 卡片尺寸选项（卡片右上角菜单） */
const CARD_SIZE_OPTIONS = [
  { key: '1x1', label: '1×1', w: 1, h: 1 },
  { key: '2x1', label: '2×1', w: 2, h: 1 },
  { key: '1x2', label: '1×2', w: 1, h: 2 },
  { key: '2x2', label: '2×2', w: 2, h: 2 },
]

/** 背景预设（深色渐变，保证卡片可读性） */
const BACKGROUND_PRESETS = [
  'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #141e30 0%, #243b55 100%)',
  'linear-gradient(135deg, #2b5876 0%, #4e4376 100%)',
  'linear-gradient(135deg, #1a2a6c 0%, #b21f1f 50%, #fdbb2d 100%)',
]

interface RecentWorkspace {
  path: string
  name: string
}

/** 问候语时段槽位 */
type GreetingSlot = 'night' | 'morning' | 'noon' | 'afternoon' | 'evening'

/** 各场景模式 × 时间段 的问候语（[中文, 英文]） */
const GREETING_MAP: Record<SceneMode, Record<GreetingSlot, [string, string]>> = {
  work: {
    night: ['夜深了，早点休息', 'Late night'],
    morning: ['早上好，开始今天的工作', 'Good morning'],
    noon: ['中午好，记得休息一下', 'Good noon'],
    afternoon: ['下午好，继续加油', 'Good afternoon'],
    evening: ['晚上好，今天辛苦了', 'Good evening'],
  },
  life: {
    night: ['夜深了', 'Late night'],
    morning: ['早安，新的一天', 'Good morning'],
    noon: ['中午好', 'Good noon'],
    afternoon: ['下午好，放慢节奏', 'Good afternoon'],
    evening: ['晚上好，放松一下吧', 'Good evening'],
  },
  study: {
    night: ['夜深了，养足精神', 'Late night'],
    morning: ['早上好，开始学习', 'Good morning'],
    noon: ['中午好', 'Good noon'],
    afternoon: ['下午好，保持专注', 'Good afternoon'],
    evening: ['晚上好，温故知新', 'Good evening'],
  },
}

/** 根据场景模式与当前时间返回问候语 */
function getGreeting(hour: number, mode: SceneMode, isZh: boolean): string {
  const slot: GreetingSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : 'evening'
  const pair = GREETING_MAP[mode]?.[slot] ?? GREETING_MAP.work[slot]
  return isZh ? pair[0] : pair[1]
}

/** 本周周一日期（YYYY-MM-DD） */
function getWeekStartStr(d = new Date()): string {
  const day = d.getDay() || 7
  const mon = new Date(d)
  mon.setDate(d.getDate() - day + 1)
  return todayStr(mon)
}

/** 根据当前小时映射问候时段（与新建任务页欢迎语保持同一套规则） */
function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 13) return 'noon'
  if (hour >= 13 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

/**
 * 从当前场景模式的问候语池中动态挑选一条，用作「新建任务」卡片的描述文案。
 *
 * 与新建任务页（空对话态）的欢迎语使用同一数据源（SceneModeProfile.greetings）：
 * - 时段问候（timeGreetings）：按当前时间优先，50% 概率命中，保证文案与真实时间一致；
 * - 静态池（zh / en）：随机轮换，排除上一次结果，避免连续相同。
 *
 * @returns 命中的问候语；无可用数据时返回 null（由调用方回退到默认文案）
 */
function pickNewTaskGreeting(
  greetings: SceneModeProfile['greetings'],
  isZh: boolean,
  last: string
): string | null {
  const timeGreetings = greetings?.timeGreetings
  if (timeGreetings) {
    const period = getTimePeriod(new Date().getHours())
    const pool = isZh ? timeGreetings.zh : timeGreetings.en
    const timeGreeting = pool?.[period]
    if (timeGreeting && Math.random() < 0.5) return timeGreeting
  }
  const pool = isZh ? greetings?.zh : greetings?.en
  if (!pool || pool.length === 0) return null
  if (pool.length === 1) return pool[0]
  const candidates = pool.filter((g) => g !== last)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0]
}

/* ===================== 数据预览小组件 ===================== */

function PreviewStat({ value, unit, hint }: { value: string; unit?: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0 w-full">
      <span className="text-[22px] font-semibold tracking-tight leading-none text-text-primary">{value}</span>
      {unit && <span className="text-[11px] text-text-muted shrink-0">{unit}</span>}
      {hint && <span className="text-[11px] text-text-muted truncate ml-auto">{hint}</span>}
    </div>
  )
}

function PreviewOk({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-500 min-w-0">
      <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
      <span className="truncate">{text}</span>
    </div>
  )
}

function PreviewTodo({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-text-muted min-w-0">
      <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{text}</span>
    </div>
  )
}

/* ---------- 工作模式预览 ---------- */

function TodoCardPreview() {
  const items = useTodoStore((s) => s.items)
  const pending = items.filter((i) => i.status !== 'done').length
  const executing = items.filter((i) => i.status === 'executing').length
  return <PreviewStat value={String(pending)} unit="项待办" hint={executing > 0 ? `${executing} 项执行中` : '点击查看详情'} />
}

function WeeklyCardPreview() {
  const items = useWeeklyReportStore((s) => s.items)
  const weekStart = getWeekStartStr()
  const has = items.some((r) => r.weekStart === weekStart)
  return has ? <PreviewOk text="本周周报已生成" /> : <PreviewTodo text="本周周报待写" />
}

function PomodoroCardPreview() {
  const records = usePomodoroStore((s) => s.records)
  const today = todayStr()
  const minutes = records.filter((r) => r.kind === 'work' && r.date === today).reduce((s, r) => s + r.minutes, 0)
  return <PreviewStat value={String(minutes)} unit="分钟" hint="今日专注" />
}

function MeetingCardPreview() {
  const items = useMeetingStore((s) => s.items)
  const open = items.filter((i) => i.status !== 'done').length
  return <PreviewStat value={String(open)} unit="个会议" hint={open > 0 ? '待处理' : '已清空'} />
}

function WorkPlanCardPreview() {
  const items = useWorkPlanStore((s) => s.items)
  const weekStart = getWeekStartStr()
  const plan = items.find((p) => p.planType === 'week' && p.baseDate === weekStart)
  const count = plan?.entries.length ?? 0
  return <PreviewStat value={String(count)} unit="项任务" hint="本周计划" />
}

function FileRuleCardPreview() {
  const items = useFileRuleStore((s) => s.items)
  return <PreviewStat value={String(items.length)} unit="条规则" hint="文件整理" />
}

function WorkHourCardPreview() {
  const items = useWorkHourStore((s) => s.items)
  const today = todayStr()
  const rec = items.find((i) => i.date === today)
  return rec ? <PreviewOk text={`已打卡 ${rec.start}${rec.end ? ' – ' + rec.end : ''}`} /> : <PreviewTodo text="今日未打卡" />
}

function SnippetCardPreview() {
  const items = useSnippetStore((s) => s.items)
  return <PreviewStat value={String(items.length)} unit="条话术" hint="快捷话术库" />
}

/* ---------- 生活模式预览 ---------- */

function LedgerCardPreview() {
  const items = useLedgerStore((s) => s.items)
  const today = todayStr()
  const expense = items.filter((i) => i.type === 'expense' && i.date === today).reduce((s, i) => s + i.amount, 0)
  const income = items.filter((i) => i.type === 'income' && i.date === today).reduce((s, i) => s + i.amount, 0)
  return <PreviewStat value={`¥${expense}`} hint={income > 0 ? `收 ¥${income}` : '今日支出'} />
}

function WaterCardPreview() {
  const cups = useWaterStore((s) => s.cups)
  const target = useWaterStore((s) => s.target)
  const today = todayStr()
  const count = cups[today] ?? 0
  return <PreviewStat value={String(count)} unit={`/ ${target} 杯`} hint="今日饮水" />
}

function MoodCardPreview() {
  const items = useMoodStore((s) => s.items)
  const today = todayStr()
  const has = items.some((i) => i.date === today)
  return has ? <PreviewOk text="今日心情已记录" /> : <PreviewTodo text="记录今日心情" />
}

function ShoppingCardPreview() {
  const items = useShoppingStore((s) => s.items)
  const pending = items.filter((i) => !i.done).length
  return <PreviewStat value={String(pending)} unit="件待购" hint={pending > 0 ? '去清单看看' : '清单已清空'} />
}

function AnniversaryCardPreview() {
  const items = useAnniversaryStore((s) => s.items)
  return <PreviewStat value={String(items.length)} unit="个纪念日" hint="生日与纪念" />
}

function RecipeCardPreview() {
  const items = useRecipeStore((s) => s.items)
  return <PreviewStat value={String(items.length)} unit="道菜谱" hint="今日吃什么" />
}

/* ---------- 学习模式预览 ---------- */

function FlashcardCardPreview() {
  const cards = useFlashcardStore((s) => s.cards)
  const due = cards.filter((c) => c.nextReview <= Date.now()).length
  return <PreviewStat value={String(due)} unit="张待复习" hint={due > 0 ? '点击开始' : '暂无到期'} />
}

function StudyPomodoroCardPreview() {
  const records = usePomodoroStore((s) => s.records)
  const today = todayStr()
  const minutes = records.filter((r) => r.kind === 'study' && r.date === today).reduce((s, r) => s + r.minutes, 0)
  return <PreviewStat value={String(minutes)} unit="分钟" hint="今日学习" />
}

function MistakeCardPreview() {
  const items = useMistakeStore((s) => s.items)
  const open = items.filter((i) => i.status === 'open').length
  return <PreviewStat value={String(open)} unit="题待攻克" hint="错题本" />
}

function NoteCardPreview() {
  const items = useNoteStore((s) => s.items)
  return <PreviewStat value={String(items.length)} unit="篇笔记" hint="笔记库" />
}

function ReaderCardPreview() {
  const items = useReadingStore((s) => s.items)
  const reading = items.filter((i) => i.status === 'reading').length
  return <PreviewStat value={String(reading)} unit="本在读" hint="阅读助手" />
}

function StudyPlanCardPreview() {
  const items = usePlanStore((s) => s.items)
  const today = todayStr()
  const pending = items.filter((i) => i.date === today && !i.done).length
  return <PreviewStat value={String(pending)} unit="项待学" hint="今日计划" />
}

/** 工具卡数据摘要分发 */
function ToolCardPreview({ toolId }: { toolId: string }) {
  // 插件卡片：通过 pluginUiRegistry 查找（组件内部自动读取，无需传 component/host）
  const pluginMatch = /^([^:]+):(.+)$/.exec(toolId)
  if (pluginMatch) {
    const [_, pluginKey] = pluginMatch
    const cards = pluginUiRegistry.getWidgetCards(pluginKey)
    if (cards.length > 0) {
      const wc = cards[0]
      return <PluginCardPreview key={toolId} cardId={toolId} pluginKey={pluginKey} contribution={wc.contribution} />
    }
  }
  switch (toolId) {
    case 'work-todo': return <TodoCardPreview />
    case 'work-weekly': return <WeeklyCardPreview />
    case 'work-pomodoro': return <PomodoroCardPreview />
    case 'work-meeting': return <MeetingCardPreview />
    case 'work-plan': return <WorkPlanCardPreview />
    case 'work-files': return <FileRuleCardPreview />
    case 'work-hours': return <WorkHourCardPreview />
    case 'work-snippets': return <SnippetCardPreview />
    case 'life-ledger': return <LedgerCardPreview />
    case 'life-water': return <WaterCardPreview />
    case 'life-mood': return <MoodCardPreview />
    case 'life-shopping': return <ShoppingCardPreview />
    case 'life-anniversary': return <AnniversaryCardPreview />
    case 'life-recipe': return <RecipeCardPreview />
    case 'study-flashcards': return <FlashcardCardPreview />
    case 'study-pomodoro': return <StudyPomodoroCardPreview />
    case 'study-mistakes': return <MistakeCardPreview />
    case 'study-notes': return <NoteCardPreview />
    case 'study-reader': return <ReaderCardPreview />
    case 'study-planner': return <StudyPlanCardPreview />
    default: return null
  }
}

/**
 * PluginCardPreview — 插件工作台卡片预览组件
 *
 * 刷新策略：
 * - core tier：15s 自动刷新
 * - enhanced tier：60s 自动刷新
 * - 手动刷新按钮（用户点击时立即触发）
 * - IntersectionObserver：卡片不可见时暂停刷新
 * - 增量刷新：首次全量加载，后续仅更新数据字段（由插件预览组件自行实现 diff）
 */
function PluginCardPreview({
  cardId,
  pluginKey,
  contribution,
}: {
  cardId: string
  pluginKey: string
  contribution: PluginWidgetCardContribution
}) {
  // 从 registry 获取已加载的组件和 host（懒加载确保 ui.js 已就绪）
  const cards = pluginUiRegistry.getWidgetCards(pluginKey)
  const cardInfo = cards.find((c) => c.contribution.id === cardId)
  const PreviewComponent = cardInfo?.component ?? null
  const host = cardInfo?.host

  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const visibleRef = useRef(true)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    if (!host || !visibleRef.current) return
    setLoading(true)
    try {
      // 插件约定：调用 "getCardData" MCP 工具，传入 { cardId } 参数
      const result = await host.callTool('getCardData', { cardId })
      if (result.success && result.content) {
        const text = result.content[0]?.text
        if (text) {
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>
            setData((prev) => {
              // 增量合并：保留上次已有字段，仅更新返回的字段
              return prev ? { ...prev, ...parsed } : parsed
            })
            return
          } catch {
            // JSON 解析失败，按字符串处理
          }
        }
      }
      setData(null)
    } catch (err) {
      logger.ui.warn(`[PluginCardPreview] Failed to refresh card ${cardId}:`, err)
    } finally {
      setLoading(false)
    }
  }, [host, cardId])

  useEffect(() => {
    if (!host) return
    void refresh()

    // 根据 tier 确定刷新间隔
    const intervalMs = contribution.tier === 'core' ? 15_000 : 60_000

    // IntersectionObserver：卡片不可见时暂停刷新
    const observer = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting },
      { threshold: 0.1 },
    )
    const el = document.querySelector(`[data-card-id="${cardId}"]`)
    if (el) observer.observe(el)

    refreshTimerRef.current = setInterval(refresh, intervalMs)

    // 监听手动刷新事件（由卡片右上角刷新按钮派发）
    const onRefreshEvent = (e: Event) => {
      if ((e as CustomEvent).detail === cardId) {
        void refresh()
      }
    }
    document.addEventListener('plugin-card-refresh', onRefreshEvent as EventListener)

    return () => {
      observer.disconnect()
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      document.removeEventListener('plugin-card-refresh', onRefreshEvent as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, contribution.tier, host])

  const handleManualRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  // 组件未加载时显示占位
  if (!PreviewComponent || !host) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
        {loading ? (
          <span className="animate-pulse">{contribution.labelZh ?? contribution.label}</span>
        ) : (
          <span>组件未就绪</span>
        )}
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <PreviewComponent
        host={host}
        data={data}
        loading={loading}
        onRefresh={handleManualRefresh}
      />
    </div>
  )
}

/**
 * 场景卡片预览组件
 *
 * 从场景卡片注册表获取组件和数据获取方法。
 * 支持自动刷新和手动刷新。
 */
function ScenarioCardPreview({
  cardId,
  contribution,
}: {
  cardId: string
  contribution: ScenarioWidgetCardContribution
}) {
  const cardInfo = scenarioWidgetRegistry.getCard(cardId)
  const PreviewComponent = cardInfo?.component ?? null
  const module = cardInfo?.module

  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const visibleRef = useRef(true)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    if (!module?.getCardData || !visibleRef.current) return
    setLoading(true)
    try {
      const result = await module.getCardData(cardId)
      setData(result)
    } catch (err) {
      logger.ui.warn(`[ScenarioCardPreview] Failed to refresh card ${cardId}:`, err)
    } finally {
      setLoading(false)
    }
  }, [module, cardId])

  useEffect(() => {
    if (!module?.getCardData) {
      setLoading(false)
      return
    }
    void refresh()

    // 根据 tier 确定刷新间隔
    const intervalMs = contribution.tier === 'core' ? 15_000 : 60_000

    // IntersectionObserver：卡片不可见时暂停刷新
    const observer = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting },
      { threshold: 0.1 },
    )
    const el = document.querySelector(`[data-card-id="${cardId}"]`)
    if (el) observer.observe(el)

    refreshTimerRef.current = setInterval(refresh, intervalMs)

    // 监听手动刷新事件
    const onRefreshEvent = (e: Event) => {
      if ((e as CustomEvent).detail === cardId) {
        void refresh()
      }
    }
    document.addEventListener('scenario-card-refresh', onRefreshEvent as EventListener)

    return () => {
      observer.disconnect()
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
      document.removeEventListener('scenario-card-refresh', onRefreshEvent as EventListener)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, contribution.tier, module])

  const handleManualRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  // 组件未加载时显示占位
  if (!PreviewComponent) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-text-muted">
        {loading ? (
          <span className="animate-pulse">{contribution.labelZh ?? contribution.label}</span>
        ) : (
          <span>组件未就绪</span>
        )}
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <PreviewComponent
        data={data}
        loading={loading}
        onRefresh={handleManualRefresh}
      />
    </div>
  )
}

/* ===================== 主组件 ===================== */

export default function WorkbenchHome() {
  const language = useStore((s) => s.language) as Language
  const workbenchWidgets = useStore((s) => s.workbenchWidgets)
  const setWorkbenchWidget = useStore((s) => s.setWorkbenchWidget)
  const resetWorkbenchWidgets = useStore((s) => s.resetWorkbenchWidgets)
  const workbenchPositions = useStore((s) => s.workbenchPositions)
  const setWorkbenchPositions = useStore((s) => s.setWorkbenchPositions)
  const workbenchBackgrounds = useStore((s) => s.workbenchBackgrounds)
  const setWorkbenchBackground = useStore((s) => s.setWorkbenchBackground)
  const setChatVisible = useStore((s) => s.setChatVisible)
  const setShowWelcomePage = useStore((s) => s.setShowWelcomePage)
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const setPendingSceneToolId = useStore((s) => s.setPendingSceneToolId)
  const { createThread } = useAgentActions()

  const { currentSceneMode, setSceneMode } = useSceneModeStore()
  const { setMode: setWorkMode } = useModeStore()

  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  // 拖拽期间的实时位置快照（拖拽结束统一写入 store）
  const [dragId, setDragId] = useState<string | null>(null)
  // 拖拽中跟随鼠标的「幽灵卡片」（fixed 定位）
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  // 拖拽目标宫格（用于高亮显示）
  const [dropTarget, setDropTarget] = useState<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null)
  // 当前打开尺寸菜单的卡片 id
  const [resizeMenuId, setResizeMenuId] = useState<string | null>(null)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    moved: boolean
    rect: DOMRect
    scrollLeft: number
    scrollTop: number
    maxCol: number
    colSpan: number
    rowSpan: number
    grabDX: number
    grabDY: number
    targetCol: number
    targetRow: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const posMapRef = useRef<Record<string, WorkbenchCardPos>>({})
  // 宫格容器与滚动容器引用（拖拽时计算网格坐标用）
  const gridRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const isZh = language === 'zh'

  /* ---------- 数据加载 ---------- */
  useEffect(() => {
    void loadRecentWorkspaces()
    // 确保所有插件卡片组件已加载
    void pluginUiRegistry.ensureWidgetCardsLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- 宫格位置：为缺失位置/旧版坐标的卡片补默认流式排布 ---------- */
  useEffect(() => {
    const ids = workbenchWidgets[currentSceneMode] ?? []
    const existing = workbenchPositions[currentSceneMode] ?? {}
    let changed = false
    const next = { ...existing }
    ids.forEach((id, i) => {
      const cur = next[id]
      if (!cur || typeof cur.col !== 'number' || typeof cur.row !== 'number') {
        changed = true
        next[id] = {
          col: (i % GRID_COLS) + 1,
          row: Math.floor(i / GRID_COLS) + 1,
          colSpan: 1,
          rowSpan: 1,
        }
      } else if (!cur.colSpan || !cur.rowSpan) {
        changed = true
        next[id] = { ...cur, colSpan: 1, rowSpan: 1 }
      }
    })
    if (changed) setWorkbenchPositions(currentSceneMode, next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbenchWidgets, currentSceneMode])

  /* 同步最新位置到 ref（拖拽回调避免闭包过期） */
  useEffect(() => {
    posMapRef.current = { ...(workbenchPositions[currentSceneMode] ?? {}) }
  }, [workbenchPositions, currentSceneMode])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 5).map((path: string) => ({
          path,
          name: getFileName(path),
        }))
      )
    } catch (e) {
      logger.ui.error('[WorkbenchHome] Failed to load recent workspaces:', e)
    }
  }

  /* ---------- 场景模式切换 ---------- */
  const handleModeSelect = useCallback(
    async (mode: SceneMode) => {
      if (mode === currentSceneMode) return
      await setSceneMode(mode)
      const newProfile = sceneModeRegistry.getOrDefault(mode)
      setWorkMode(newProfile.defaultWorkMode)
    },
    [currentSceneMode, setSceneMode, setWorkMode]
  )

  /* ---------- 操作入口 ---------- */
  const handleNewChat = useCallback(() => {
    // 有已选工作区时，进入新建任务页面默认打开工作区面板
    if (useStore.getState().workspace?.roots?.length) {
      setActiveSidePanel('explorer')
    }
    setChatVisible(true)
    setShowWelcomePage(false)
    // 创建全新空会话（与右上角「新对话」入口一致）
    createThread()
  }, [setChatVisible, setShowWelcomePage, setActiveSidePanel, createThread])

  const handleOpenFolder = useCallback(async () => {
    try {
      const result = await api.file.openFolder()
      if (result && typeof result === 'string') {
        await workspaceManager.openFolder(result)
        setShowWelcomePage(false)
      }
    } catch (e) {
      logger.ui.error('[WorkbenchHome] Failed to open folder:', e)
      toast.error(t('workspace.openFolderFailed', language))
    }
  }, [language, setShowWelcomePage])

  const handleOpenRecent = useCallback(
    async (path: string) => {
      try {
        await workspaceManager.openFolder(path)
        setShowWelcomePage(false)
      } catch (e) {
        if (e instanceof WorkspaceOpenError && e.code === 'missing-workspace') {
          toast.error(t('workspace.folderNotExist', language), getFileName(path))
          void loadRecentWorkspaces()
          return
        }
        logger.ui.error('[WorkbenchHome] Failed to open recent workspace:', e)
        toast.error(t('workspace.openFolderFailed', language), getFileName(path))
      }
    },
    [language, setShowWelcomePage]
  )

  const handleOpenMarket = useCallback(() => {
    useStore.getState().setScenarioPageTab('marketplace')
    useStore.getState().setShowScenarioPage(true)
    setShowWelcomePage(false)
  }, [setShowWelcomePage])

  const handleOpenScenarioManager = useCallback(() => {
    useStore.getState().setScenarioPageTab('installed')
    useStore.getState().setShowScenarioPage(true)
    setShowWelcomePage(false)
  }, [setShowWelcomePage])

  const handleOpenSceneTools = useCallback(() => {
    setShowWelcomePage(false)
    setActiveSidePanel('scene-tools')
  }, [setShowWelcomePage, setActiveSidePanel])

  /* ---------- 工具卡点击 ---------- */
  const handleToolClick = useCallback(
    (toolId: string) => {
      setShowWelcomePage(false)
      setActiveSidePanel('scene-tools')
      setPendingSceneToolId(toolId)
    },
    [setShowWelcomePage, setActiveSidePanel, setPendingSceneToolId]
  )

  /* ---------- 卡片拖拽（宫格换位 + 碰撞自动避让） ---------- */
  const handleDragStart = useCallback((e: ReactPointerEvent, cardId: string) => {
    if (e.button !== 0) return
    const gridEl = gridRef.current
    if (!gridEl) return
    const rect = gridEl.getBoundingClientRect()
    const scrollEl = scrollRef.current
    const maxCol = Math.max(1, Math.floor((rect.width + CARD_GAP) / (CARD_W + CARD_GAP)))
    // 被拖动卡片当前的位置/尺寸，以及鼠标相对卡片左上角的抓取偏移
    const pos = posMapRef.current[cardId]
    const cardEl = gridEl.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null
    const cardRect = cardEl?.getBoundingClientRect()
    dragRef.current = {
      id: cardId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      rect,
      scrollLeft: scrollEl?.scrollLeft ?? 0,
      scrollTop: scrollEl?.scrollTop ?? 0,
      maxCol,
      colSpan: Math.max(1, pos?.colSpan ?? 1),
      rowSpan: Math.max(1, pos?.rowSpan ?? 1),
      grabDX: cardRect ? e.clientX - cardRect.left : CARD_W / 2,
      grabDY: cardRect ? e.clientY - cardRect.top : 12,
      targetCol: Math.max(1, pos?.col ?? 1),
      targetRow: Math.max(1, pos?.row ?? 1),
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragId(cardId)
    setResizeMenuId(null)
  }, [])

  const handleDragMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true
    if (!d.moved) return
    // 幽灵卡片跟随鼠标（fixed 定位，保持抓取偏移）
    const ghostW = d.colSpan * CARD_W + (d.colSpan - 1) * CARD_GAP
    const ghostH = d.rowSpan * CARD_H + (d.rowSpan - 1) * CARD_GAP
    setDragGhost({ x: e.clientX - d.grabDX, y: e.clientY - d.grabDY, w: ghostW, h: ghostH })
    // 计算目标宫格并高亮（拖动期间不重排其他卡片）
    const x = e.clientX - d.rect.left + d.scrollLeft
    const y = e.clientY - d.rect.top + d.scrollTop
    const col = Math.min(d.maxCol, Math.max(1, Math.floor(x / (CARD_W + CARD_GAP)) + 1))
    const row = Math.max(1, Math.floor(y / (CARD_H + CARD_GAP)) + 1)
    d.targetCol = col
    d.targetRow = row
    setDropTarget({ col, row, colSpan: d.colSpan, rowSpan: d.rowSpan })
  }, [])

  const handleDragEnd = useCallback(() => {
    const d = dragRef.current
    dragRef.current = null
    setDragId(null)
    setDragGhost(null)
    setDropTarget(null)
    if (d?.moved) {
      // 松手时一次性计算最终排布：被拖动卡片插入目标宫格，其余卡片保持相对顺序紧凑排布
      const resolved = packGridPositions(posMapRef.current, d.id, d.targetCol, d.targetRow, d.maxCol)
      suppressClickRef.current = true
      setWorkbenchPositions(currentSceneMode, resolved)
      posMapRef.current = resolved
    }
  }, [currentSceneMode, setWorkbenchPositions])

  /* ---------- 移除卡片 ---------- */
  const handleRemoveCard = useCallback(
    (cardId: string) => {
      setWorkbenchWidget(currentSceneMode, cardId, false)
    },
    [currentSceneMode, setWorkbenchWidget]
  )

  /* ---------- 调整卡片尺寸（支持跨格） ---------- */
  const handleResizeCard = useCallback(
    (cardId: string, colSpan: number, rowSpan: number) => {
      const base = { ...posMapRef.current }
      const cur = base[cardId] ?? { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
      const gridEl = gridRef.current
      const maxCol = gridEl
        ? Math.max(1, Math.floor((gridEl.getBoundingClientRect().width + CARD_GAP) / (CARD_W + CARD_GAP)))
        : GRID_COLS
      base[cardId] = { ...cur, colSpan: Math.min(colSpan, maxCol), rowSpan: Math.max(1, rowSpan) }
      const resolved = packGridPositions(base, cardId, cur.col, cur.row, maxCol)
      posMapRef.current = resolved
      setWorkbenchPositions(currentSceneMode, resolved)
    },
    [currentSceneMode, setWorkbenchPositions]
  )

  /* ---------- 背景图片上传 ---------- */
  const handleUploadBackground = useCallback(async () => {
    try {
      const paths = await api.file.selectForImport({
        title: isZh ? '选择背景图片' : 'Select background image',
        allowFiles: true,
        multiSelection: false,
      })
      const filePath = paths?.[0]
      if (!filePath) return
      const mime = getImageMime(filePath)
      if (!mime) {
        toast.warning(isZh ? '请选择图片文件（png / jpg / webp / svg / gif）' : 'Please select an image (png/jpg/webp/svg/gif)')
        return
      }
      const base64 = await api.file.readBinary(filePath)
      if (!base64) return
      setWorkbenchBackground(currentSceneMode, { type: 'image', value: `data:${mime};base64,${base64}` })
      setCustomizeOpen(false)
      toast.success(isZh ? '背景图片已设置' : 'Background image set')
    } catch (err) {
      logger.ui.error('[WorkbenchHome] Failed to load background image:', err)
      toast.error(isZh ? '背景图片加载失败' : 'Failed to load background image')
    }
  }, [isZh, currentSceneMode, setWorkbenchBackground])

  /* ---------- 「新建任务」卡片描述：随场景模式动态轮换（与新建任务页欢迎语同源） ---------- */
  const lastCardGreetingRef = useRef<string>('')
  const newTaskDesc = useMemo(() => {
    const greetings = sceneModeRegistry.getOrDefault(currentSceneMode).greetings
    const picked = pickNewTaskGreeting(greetings, isZh, lastCardGreetingRef.current)
    if (picked) lastCardGreetingRef.current = picked
    return picked ?? (isZh ? '与 AI 助手开始一项新任务' : 'Start a new task with AI')
  }, [currentSceneMode, isZh])

  /* ---------- 卡片解析 ---------- */
  const cards = useMemo(() => {
    const ids = workbenchWidgets[currentSceneMode] ?? []
    return ids
      .map((id) => resolveCardMeta(id, currentSceneMode))
      .filter((c): c is CardMeta => c !== null)
      .map((c) => (c.id === 'new-chat' ? { ...c, descZh: newTaskDesc, descEn: newTaskDesc } : c))
  }, [workbenchWidgets, currentSceneMode, newTaskDesc])

  /* 背景样式 */
  const background: WorkbenchBackground | null = workbenchBackgrounds[currentSceneMode] ?? null
  const bgStyle: CSSProperties | undefined = background
    ? background.type === 'image'
      ? { backgroundImage: `url("${background.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: background.value }
    : undefined
  /* 卡片宫格位置 */
  const posMap = workbenchPositions[currentSceneMode] ?? {}

  const now = new Date()
  const greeting = getGreeting(now.getHours(), currentSceneMode, isZh)
  const dateStr = now.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return (
    <div
      className="h-full w-full overflow-hidden bg-background text-text-primary relative flex flex-col"
      style={bgStyle}
    >
      {background?.type === 'image' && <div className="absolute inset-0 bg-black/25 pointer-events-none z-[1]" />}

      {/* ===== 顶部栏 ===== */}
      <header className="shrink-0 flex items-center justify-between gap-4 px-8 pt-7 pb-5 select-none relative z-40">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight truncate">{greeting}</h1>
          <p className="text-xs text-text-muted mt-0.5 truncate">{dateStr}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* 场景模式分段切换 */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-surface/70 border border-border/30">
            {(Object.keys(MODE_META) as SceneMode[]).map((mode) => {
              const meta = MODE_META[mode]
              const ModeIcon = meta.icon
              const profile = sceneModeRegistry.getOrDefault(mode)
              const label = isZh ? profile.displayNameZh : profile.displayName
              const selected = currentSceneMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => void handleModeSelect(mode)}
                  className={`
                    flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200
                    ${selected ? 'text-white shadow-sm' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}
                  `}
                  style={selected ? { background: meta.color, boxShadow: `0 4px 14px -6px ${meta.color}b0` } : undefined}
                  title={isZh ? meta.descZh : meta.descEn}
                >
                  <ModeIcon className="w-3.5 h-3.5" strokeWidth={2} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* 添加卡片 */}
          <button
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-accent border border-accent/25 bg-accent/10 hover:bg-accent/15 transition-all duration-200"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            {isZh ? '添加卡片' : 'Add Cards'}
          </button>

          {/* 自定义：背景与布局 */}
          <div className="relative">
            <button
              onClick={() => setCustomizeOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-200 border ${
                customizeOpen
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'text-text-secondary hover:text-text-primary border-border/30 hover:border-border/60 hover:bg-surface-hover'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" strokeWidth={1.8} />
              {isZh ? '自定义' : 'Customize'}
            </button>
            {customizeOpen && (
              <>
                <div className="fixed inset-0 z-[80]" onClick={() => setCustomizeOpen(false)} />
                <div className="absolute right-0 top-full mt-2 z-[81] w-[300px] rounded-2xl border border-border/40 bg-surface shadow-2xl p-4 space-y-4">
                  {/* 背景 */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-semibold text-text-secondary">{isZh ? '背景' : 'Background'}</span>
                      {background && (
                        <button
                          onClick={() => setWorkbenchBackground(currentSceneMode, null)}
                          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-red-400 transition-colors"
                        >
                          <Eraser className="w-3 h-3" />
                          {isZh ? '移除背景' : 'Remove'}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      {BACKGROUND_PRESETS.map((preset) => {
                        const active = background?.type === 'color' && background.value === preset
                        return (
                          <button
                            key={preset}
                            onClick={() => setWorkbenchBackground(currentSceneMode, { type: 'color', value: preset })}
                            className={`h-9 rounded-xl border transition-all ${active ? 'ring-2 ring-accent border-transparent' : 'border-border/30 hover:border-border/60'}`}
                            style={{ background: preset }}
                            title={preset}
                          />
                        )
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="relative flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-border/30 bg-surface/40 hover:bg-surface-hover cursor-pointer transition-colors">
                        <Palette className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-xs text-text-secondary truncate">{isZh ? '自定义颜色' : 'Custom color'}</span>
                        <input
                          type="color"
                          className="sr-only"
                          value={background?.type === 'color' && !BACKGROUND_PRESETS.includes(background.value) ? background.value : '#3B82F6'}
                          onChange={(e) => setWorkbenchBackground(currentSceneMode, { type: 'color', value: e.target.value })}
                        />
                      </label>
                      <button
                        onClick={() => void handleUploadBackground()}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/30 bg-surface/40 hover:bg-surface-hover transition-colors"
                      >
                        <ImagePlus className="w-3.5 h-3.5 text-accent shrink-0" />
                        <span className="text-xs text-text-secondary">{isZh ? '上传图片' : 'Upload'}</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-text-muted mt-2 leading-relaxed">
                      {isZh
                        ? '提示：将鼠标悬停在卡片上会显示操作按钮，可拖动调整位置、调整卡片大小或移除卡片。'
                        : 'Tip: hover a card to reveal actions — drag to move, resize, or remove it.'}
                    </p>
                  </div>
                  <div className="h-px bg-border/30" />
                  {/* 布局 */}
                  <div>
                    <span className="block text-xs font-semibold text-text-secondary mb-2">{isZh ? '布局' : 'Layout'}</span>
                    <button
                      onClick={() => resetWorkbenchWidgets(currentSceneMode)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-text-secondary hover:text-text-primary border border-border/30 bg-surface/40 hover:bg-surface-hover transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {isZh ? '恢复默认布局' : 'Reset layout'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===== 卡片墙（宫格布局） ===== */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto custom-scrollbar px-8 pt-6 pb-10 relative z-10">
        <div
          ref={gridRef}
          className="relative"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`,
            gridAutoRows: `${CARD_H}px`,
            gap: `${CARD_GAP}px`,
            padding: `${WALL_PAD}px`,
            minWidth: '100%',
            minHeight: '100%',
            boxSizing: 'border-box',
            alignContent: 'start',
          }}
        >
          {/* 拖拽目标宫格高亮 */}
          {dropTarget && (
            <div
              className="absolute pointer-events-none rounded-2xl border-2 border-dashed border-accent/70 bg-accent/10 z-[5]"
              style={{
                left: WALL_PAD + (dropTarget.col - 1) * (CARD_W + CARD_GAP),
                top: WALL_PAD + (dropTarget.row - 1) * (CARD_H + CARD_GAP),
                width: dropTarget.colSpan * CARD_W + (dropTarget.colSpan - 1) * CARD_GAP,
                height: dropTarget.rowSpan * CARD_H + (dropTarget.rowSpan - 1) * CARD_GAP,
              }}
            />
          )}

          {cards.map((card) => {
            const pos = posMap[card.id] ?? { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
            return (
              <WorkbenchCard
                key={card.id}
                card={card}
                isZh={isZh}
                pos={pos}
                dragging={dragId === card.id}
                dragGhost={dragGhost}
                recentWorkspaces={recentWorkspaces}
                onOpen={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  handleCardOpen(card.id)
                }}
                onOpenRecent={handleOpenRecent}
                onDragStart={(e) => handleDragStart(e, card.id)}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
                onRemove={() => handleRemoveCard(card.id)}
                onResize={(w, h) => {
                  setResizeMenuId(null)
                  handleResizeCard(card.id, w, h)
                }}
                resizeMenuOpen={resizeMenuId === card.id}
                onToggleResizeMenu={() => setResizeMenuId((cur) => (cur === card.id ? null : card.id))}
              />
            )
          })}

          {cards.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center gap-3 py-24">
              <div className="w-12 h-12 rounded-2xl bg-surface/60 border border-border/30 flex items-center justify-center">
                <LayoutGrid className="w-5 h-5 text-text-muted" strokeWidth={1.8} />
              </div>
              <p className="text-sm text-text-muted">{isZh ? '工作台还没有卡片' : 'No cards yet'}</p>
              <button
                onClick={() => setLibraryOpen(true)}
                className="text-xs text-accent hover:underline"
              >
                {isZh ? '添加一张卡片' : 'Add a card'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== 添加卡片弹层（macOS 小组件库） ===== */}
      {libraryOpen && (
        <CardLibrary
          mode={currentSceneMode}
          isZh={isZh}
          addedIds={cards.map((c) => c.id)}
          onAdd={(id) => setWorkbenchWidget(currentSceneMode, id, true)}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  )

  /* ---------- 卡片点击分发 ---------- */
  function handleCardOpen(id: string) {
    if (id === 'new-chat') return handleNewChat()
    if (id === 'open-folder') return void handleOpenFolder()
    if (id === 'open-market') return handleOpenMarket()
    if (id === 'open-scene-tools') return handleOpenSceneTools()
    if (id === 'scenarios') return handleOpenScenarioManager()
    handleToolClick(id)
  }
}

/* ===================== 卡片元数据 ===================== */

type CardKind = 'action' | 'tool' | 'plugin' | 'scenario'

interface CardMeta {
  id: string
  kind: CardKind
  icon: LucideIcon
  titleZh: string
  titleEn: string
  descZh: string
  descEn: string
  color: string
  /** 插件卡片元数据（kind==='plugin' 时有效） */
  pluginMeta?: { pluginKey: string; contribution: PluginWidgetCardContribution }
  /** 场景卡片元数据（kind==='scenario' 时有效） */
  scenarioMeta?: { scenarioId: string; contribution: ScenarioWidgetCardContribution }
}
function resolveCardMeta(id: string, mode: SceneMode): CardMeta | null {
  const action = ACTION_CARDS.find((a) => a.id === id)
  if (action) {
    return { ...action, kind: 'action' }
  }
  // 插件卡片：id 格式为 "<pluginKey>:<cardName>"
  const pluginMatch = /^([^:]+):(.+)$/.exec(id)
  if (pluginMatch) {
    const [_, pluginKey] = pluginMatch
    const cards = pluginUiRegistry.getWidgetCards(pluginKey, mode)
    if (cards.length > 0) {
      const wc = cards[0]
      const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(id)) % TOOL_COLORS.length : 0
      return {
        id,
        kind: 'plugin',
        icon: getLucideIcon(wc.contribution.icon) || Zap,
        titleZh: wc.contribution.labelZh ?? wc.contribution.label,
        titleEn: wc.contribution.label,
        descZh: wc.contribution.descriptionZh ?? wc.contribution.description ?? '',
        descEn: wc.contribution.description ?? '',
        color: TOOL_COLORS[idx],
        pluginMeta: { pluginKey, contribution: wc.contribution },
      }
    }
  }
  // 场景卡片：id 格式为 "<scenarioId>:<cardName>"
  if (pluginMatch) {
    const [_, scenarioId] = pluginMatch
    const card = scenarioWidgetRegistry.getCard(id)
    if (card) {
      const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(id)) % TOOL_COLORS.length : 0
      return {
        id,
        kind: 'scenario',
        icon: getLucideIcon(card.icon) || Zap,
        titleZh: card.labelZh ?? card.label,
        titleEn: card.label,
        descZh: card.descriptionZh ?? card.description ?? '',
        descEn: card.description ?? '',
        color: TOOL_COLORS[idx],
        scenarioMeta: {
          scenarioId,
          contribution: {
            id: card.id,
            icon: card.icon,
            label: card.label,
            labelZh: card.labelZh,
            description: card.description,
            descriptionZh: card.descriptionZh,
            tier: card.tier,
            previewComponent: '',
          },
        },
      }
    }
  }
  const tool = getToolById(id)
  if (tool && tool.mode === mode) {
    const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(tool.id)) % TOOL_COLORS.length : 0
    return {
      id: tool.id,
      kind: 'tool',
      icon: getLucideIcon(tool.icon) || Zap,
      titleZh: tool.name,
      titleEn: tool.nameEn,
      descZh: tool.description,
      descEn: tool.description,
      color: TOOL_COLORS[idx],
    }
  }
  return null
}

function hashCode(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return h
}

/** 根据文件扩展名推断图片 MIME 类型；非图片返回 null */
function getImageMime(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  }
  return map[ext] ?? null
}

/* ===================== 宫格布局工具 ===================== */

/**
 * 宫格重排：将 movedId 插入 (targetCol, targetRow) 目标宫格。
 *
 * 采用「插入排序」语义（类似 iOS 主屏 / macOS 桌面整理）：
 * - 其余卡片保持原有相对顺序，被越过的卡片向前补齐空位；
 * - 不再出现「其余卡片整体向后顺延」的跳变（例如拖动第 2 张向右时，
 *   第 3、4 张不会一起被挤到后面，而是保持原位、由被拖动卡片插入）。
 */
function packGridPositions(
  positions: Record<string, WorkbenchCardPos>,
  movedId: string,
  targetCol: number,
  targetRow: number,
  maxCol: number
): Record<string, WorkbenchCardPos> {
  const result: Record<string, WorkbenchCardPos> = { ...positions }

  const occupied = new Set<string>()
  const placed: Record<string, WorkbenchCardPos> = {}
  const clash = (col: number, row: number, colSpan: number, rowSpan: number) => {
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        if (occupied.has(`${c},${r}`)) return true
      }
    }
    return false
  }
  const occupy = (col: number, row: number, colSpan: number, rowSpan: number) => {
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) occupied.add(`${c},${r}`)
    }
  }

  // 1. 被拖动卡片「绝对放置」到目标宫格（拖到哪就放哪，越界时向内收拢）
  const moved = result[movedId] ?? { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
  const mColSpan = Math.min(Math.max(1, moved.colSpan), Math.max(1, maxCol))
  const mRowSpan = Math.max(1, moved.rowSpan)
  const tCol = Math.min(Math.max(1, targetCol), Math.max(1, maxCol - mColSpan + 1))
  const tRow = Math.max(1, targetRow)
  placed[movedId] = { ...moved, col: tCol, row: tRow, colSpan: mColSpan, rowSpan: mRowSpan }
  occupy(tCol, tRow, mColSpan, mRowSpan)

  // 2. 其余卡片保持原位置（row-major 顺序），仅在与已放置卡片重叠时向右/下顺延到最近空位
  const others = Object.keys(result)
    .filter((id) => id !== movedId)
    .sort((a, b) => {
      const pa = result[a]
      const pb = result[b]
      return pa.row - pb.row || pa.col - pb.col || a.localeCompare(b)
    })
  for (const id of others) {
    const p = result[id] ?? { col: 1, row: 1, colSpan: 1, rowSpan: 1 }
    const colSpan = Math.min(p.colSpan, Math.max(1, maxCol))
    const rowSpan = Math.max(1, p.rowSpan)
    let col = Math.max(1, p.col)
    let row = Math.max(1, p.row)
    let guard = 0
    while (clash(col, row, colSpan, rowSpan)) {
      col += 1
      if (col + colSpan - 1 > maxCol) {
        col = 1
        row += 1
      }
      if (++guard > 500) break
    }
    placed[id] = { ...p, col, row, colSpan, rowSpan }
    occupy(col, row, colSpan, rowSpan)
  }
  return placed
}

/* ===================== 卡片组件 ===================== */

function WorkbenchCard({
  card,
  isZh,
  pos,
  dragging,
  dragGhost,
  recentWorkspaces,
  onRemove,
  onOpen,
  onOpenRecent,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResize,
  resizeMenuOpen,
  onToggleResizeMenu,
}: {
  card: CardMeta
  isZh: boolean
  pos: WorkbenchCardPos
  dragging: boolean
  dragGhost: { x: number; y: number; w: number; h: number } | null
  recentWorkspaces: RecentWorkspace[]
  onRemove: () => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onDragStart: (e: ReactPointerEvent) => void
  onDragMove: (e: ReactPointerEvent) => void
  onDragEnd: (e: ReactPointerEvent) => void
  onResize: (colSpan: number, rowSpan: number) => void
  resizeMenuOpen: boolean
  onToggleResizeMenu: () => void
}) {
  const Icon = card.icon
  const title = isZh ? card.titleZh : card.titleEn
  const desc = isZh ? card.descZh : card.descEn

  const isRecent = card.id === 'recent-workspaces'
  const isAction = card.kind === 'action'
  const sizeKey = `${pos.colSpan}x${pos.rowSpan}`

  return (
    <div
      data-card-id={card.id}
      className={`
        relative flex flex-col rounded-2xl border bg-surface/40 p-4 transition-all duration-200 min-h-0 overflow-hidden group
        ${isAction ? 'cursor-pointer hover:bg-surface-hover hover:border-border/60' : 'hover:bg-surface-hover hover:border-border/60'}
        ${dragging ? 'border-accent/60 shadow-xl scale-[1.03] z-20' : 'border-border/30 z-10'}
      `}
      style={{
        gridColumn: `${pos.col} / span ${pos.colSpan}`,
        gridRow: `${pos.row} / span ${pos.rowSpan}`,
        ...(isAction ? { boxShadow: `0 10px 30px -18px ${card.color}50` } : {}),
        // 拖拽中：脱离宫格跟随鼠标（fixed 定位）
        ...(dragging && dragGhost
          ? {
              position: 'fixed' as const,
              left: dragGhost.x,
              top: dragGhost.y,
              width: dragGhost.w,
              height: dragGhost.h,
              margin: 0,
              zIndex: 999,
              pointerEvents: 'none' as const,
              transform: 'scale(1.03) rotate(0.5deg)',
              transition: 'transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease',
            }
          : {}),
      }}
      onPointerMove={onDragMove}
      onClick={isAction ? onOpen : undefined}
    >
      {/* 头部：图标 + 标题 */}
      <div className="flex items-center gap-2.5 w-full pr-16">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
          style={{ background: `${card.color}1a`, color: card.color }}
        >
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </div>
        <span className="text-[13px] font-semibold text-text-primary truncate">{title}</span>
      </div>

      {/* 主体：预览或描述 */}
      <div className="flex-1 flex items-center mt-2.5 min-h-0">
        {isRecent ? (
          <RecentWorkspacesList isZh={isZh} items={recentWorkspaces} onOpenRecent={onOpenRecent} />
        ) : isAction ? (
          <p className="text-[11px] text-text-muted leading-relaxed line-clamp-2">{desc}</p>
        ) : card.kind === 'plugin' && card.pluginMeta ? (
          <PluginCardPreview
            cardId={card.id}
            pluginKey={card.pluginMeta.pluginKey}
            contribution={card.pluginMeta.contribution}
          />
        ) : card.kind === 'scenario' && card.scenarioMeta ? (
          <ScenarioCardPreview
            cardId={card.id}
            contribution={card.scenarioMeta.contribution}
          />
        ) : (
          <ToolCardPreview toolId={card.id} />
        )}
      </div>

      {/* 底部：工具卡/插件卡/场景卡描述 */}
      {(card.kind === 'tool' || card.kind === 'plugin' || card.kind === 'scenario') && (
        <p className="text-[11px] text-text-muted truncate w-full mt-1.5">{desc}</p>
      )}

      {/* 右上角操作按钮：移动 + 尺寸 + 移除（hover 卡片时显示） */}
      <div
        className={`absolute top-2 right-2 flex items-center gap-0.5 z-20 transition-opacity duration-150 ${
          dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <button
          title={isZh ? '按住拖动移动卡片' : 'Drag to move'}
          onPointerDown={(e) => {
            e.stopPropagation()
            onDragStart(e)
          }}
          onPointerMove={(e) => {
            e.stopPropagation()
            onDragMove(e)
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            onDragEnd(e)
          }}
          onClick={(e) => e.stopPropagation()}
          className="p-1 rounded-md text-text-muted/70 hover:text-accent hover:bg-accent/10 transition-colors cursor-grab active:cursor-grabbing touch-none"
        >
          <Move className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        {/* 刷新：插件卡片/场景卡片显示，点击立即重新拉取数据 */}
        {(card.kind === 'plugin' || card.kind === 'scenario') && (
          <button
            title={isZh ? '刷新数据' : 'Refresh'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              // 触发对应预览组件的刷新：通过 dispatch 自定义事件
              const eventName = card.kind === 'plugin' ? 'plugin-card-refresh' : 'scenario-card-refresh'
              document.dispatchEvent(new CustomEvent(eventName, { detail: card.id }))
            }}
            className="p-1 rounded-md text-text-muted/70 hover:text-accent hover:bg-accent/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        )}
        {/* 尺寸：点击图标弹出大小选择菜单 */}
        <div className="relative">
          <button
            title={isZh ? '调整卡片大小' : 'Resize card'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onToggleResizeMenu()
            }}
            className={`p-1 rounded-md transition-colors ${
              resizeMenuOpen ? 'text-accent bg-accent/10' : 'text-text-muted/70 hover:text-accent hover:bg-accent/10'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          {resizeMenuOpen && (
            <div
              className="absolute top-8 right-0 z-30 w-[92px] rounded-xl border border-border/40 bg-surface shadow-xl p-1 space-y-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {CARD_SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={(e) => {
                    e.stopPropagation()
                    onResize(opt.w, opt.h)
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] transition-colors ${
                    sizeKey === opt.key
                      ? 'text-accent bg-accent/10'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  <span>{opt.label}</span>
                  {sizeKey === opt.key && <Check className="w-3 h-3" strokeWidth={2} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          title={isZh ? '移除卡片' : 'Remove'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="p-1 rounded-md text-text-muted/70 hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/* ---------- 最近工作区列表（卡片内嵌） ---------- */
function RecentWorkspacesList({
  isZh,
  items,
  onOpenRecent,
}: {
  isZh: boolean
  items: RecentWorkspace[]
  onOpenRecent: (path: string) => void
}) {
  if (items.length === 0) {
    return <PreviewTodo text={isZh ? '暂无最近工作区' : 'No recent workspaces'} />
  }
  return (
    <div className="w-full space-y-1.5">
      {items.slice(0, 3).map((item) => (
        <button
          key={item.path}
          onClick={(e) => {
            e.stopPropagation()
            onOpenRecent(item.path)
          }}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/60 hover:bg-surface-hover border border-border/20 text-left min-w-0 transition-colors"
        >
          <FolderOpen className="w-3 h-3 text-text-muted shrink-0" strokeWidth={1.6} />
          <span className="text-[11px] text-text-primary truncate">{item.name}</span>
          <ArrowRight className="w-2.5 h-2.5 text-text-muted/40 shrink-0 ml-auto" />
        </button>
      ))}
    </div>
  )
}

/* ===================== 添加卡片弹层（macOS 小组件库） ===================== */

/**
 * 获取场景卡片列表
 */
function useScenarioWidgetCards() {
  const [cards, setCards] = useState(scenarioWidgetRegistry.getAllCards())

  useEffect(() => {
    return scenarioWidgetRegistry.subscribe(() => {
      setCards(scenarioWidgetRegistry.getAllCards())
    })
  }, [])

  return cards
}

function CardLibrary({
  mode,
  isZh,
  addedIds,
  onAdd,
  onClose,
}: {
  mode: SceneMode
  isZh: boolean
  addedIds: string[]
  onAdd: (id: string) => void
  onClose: () => void
}) {
  const toolCards = getToolsByMode(mode)
  const pluginCards = usePluginWidgetCards(mode)
  const scenarioCards = useScenarioWidgetCards()
  const modeMeta = MODE_META[mode]
  const modeLabel = isZh
    ? sceneModeRegistry.getOrDefault(mode).displayNameZh
    : sceneModeRegistry.getOrDefault(mode).displayName

  const renderItem = (item: { id: string; icon: LucideIcon; titleZh: string; titleEn: string; color: string }) => {
    const added = addedIds.includes(item.id)
    const Icon = item.icon
    return (
      <button
        key={item.id}
        onClick={() => {
          if (!added) onAdd(item.id)
        }}
        disabled={added}
        className={`
          flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all duration-200 min-w-0
          ${
            added
              ? 'border-border/20 bg-surface/30 opacity-50 cursor-default'
              : 'border-border/30 bg-surface/40 hover:bg-surface-hover hover:border-accent/50 cursor-pointer'
          }
        `}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${item.color}1a`, color: item.color }}
        >
          <Icon className="w-4 h-4" strokeWidth={1.8} />
        </div>
        <span className="text-xs font-medium text-text-primary truncate">{isZh ? item.titleZh : item.titleEn}</span>
        {added && <Check className="w-3.5 h-3.5 text-accent ml-auto shrink-0" strokeWidth={2.2} />}
      </button>
    )
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-[calc(100vw-4rem)] max-h-[74vh] rounded-2xl border border-border/40 bg-surface shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30 shrink-0">
          <div>
            <h4 className="text-sm font-semibold text-text-primary">{isZh ? '添加卡片' : 'Add Cards'}</h4>
            <p className="text-[11px] text-text-muted mt-0.5">
              {isZh ? `当前模式：${modeLabel}，选择卡片添加到工作台` : `Mode: ${modeLabel} — pick cards to add`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5">
          {/* 通用卡片 */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-accent/70" strokeWidth={1.8} />
              <span className="text-xs font-semibold text-text-secondary">{isZh ? '通用' : 'General'}</span>
              <div className="flex-1 h-px bg-border/30" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ACTION_CARDS.map((a) => renderItem({ id: a.id, icon: a.icon, titleZh: a.titleZh, titleEn: a.titleEn, color: a.color }))}
            </div>
          </div>

          {/* 当前模式工具卡片 */}
          {toolCards.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <modeMeta.icon className="w-3.5 h-3.5" style={{ color: modeMeta.color }} strokeWidth={1.8} />
                <span className="text-xs font-semibold text-text-secondary">
                  {modeLabel}
                  {isZh ? '工具' : ' Tools'}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {toolCards.map((tool) => {
                  const Icon = getLucideIcon(tool.icon) || Zap
                  const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(tool.id)) % TOOL_COLORS.length : 0
                  return renderItem({ id: tool.id, icon: Icon, titleZh: tool.name, titleEn: tool.nameEn, color: TOOL_COLORS[idx] })
                })}
              </div>
            </div>
          )}

          {/* 插件卡片 */}
          {pluginCards.length > 0 && (
            <div className={toolCards.length > 0 ? 'mt-5' : ''}>
              <div className="flex items-center gap-2 mb-2.5">
                <Blocks className="w-3.5 h-3.5 text-purple-500/70" strokeWidth={1.8} />
                <span className="text-xs font-semibold text-text-secondary">
                  {isZh ? '插件卡片' : 'Plugin Cards'}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {pluginCards.map((card) => {
                  const Icon = getLucideIcon(card.icon) || Blocks
                  const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(card.cardId)) % TOOL_COLORS.length : 0
                  return renderItem({ id: card.cardId, icon: Icon, titleZh: card.labelZh, titleEn: card.label, color: TOOL_COLORS[idx] })
                })}
              </div>
            </div>
          )}

          {/* 场景卡片 */}
          {scenarioCards.length > 0 && (
            <div className={(toolCards.length > 0 || pluginCards.length > 0) ? 'mt-5' : ''}>
              <div className="flex items-center gap-2 mb-2.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500/70" strokeWidth={1.8} />
                <span className="text-xs font-semibold text-text-secondary">
                  {isZh ? '场景卡片' : 'Scenario Cards'}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {scenarioCards.map((card) => {
                  const Icon = getLucideIcon(card.icon) || Sparkles
                  const idx = TOOL_COLORS.length > 0 ? Math.abs(hashCode(card.id)) % TOOL_COLORS.length : 0
                  return renderItem({ id: card.id, icon: Icon, titleZh: card.labelZh ?? card.label, titleEn: card.label, color: TOOL_COLORS[idx] })
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
