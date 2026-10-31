/**
 * 空对话态技能建议栏
 *
 * 渲染在输入框容器正上方，宽度与输入框保持一致：
 * - 默认展示一行技能，其后紧跟「插件与技能市场」里已安装的插件（技能在前、插件在后）
 * - 点击带二级选项的技能后整行切换为二级选项，并提供返回入口
 * - 每行固定单行横向滚动，溢出时隐藏滚动条；左右滚动按钮以渐变遮罩悬浮在列表两端，
 *   只有那一侧还存在未展示内容时才淡入，因不占布局所以显隐不会引起列表抖动
 * - 技能与插件各只内联前若干个（MAX_INLINE_SKILLS / MAX_INLINE_PLUGINS），其余收进行尾
 *   固定的「更多技能」按钮，点击在按钮上方弹出可搜索的面板（PluginOverflowPanel）。
 *   面板里技能与插件混排：声明为 skill 型的插件会归并成技能条目，只列插件会让它无处可寻
 * - 按钮不参与横向滚动，否则条目一多就得先滚到最右才看得见，等于没解决问题
 */

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Puzzle,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react'
import PluginOverflowPanel, { type OverflowEntryItem } from './PluginOverflowPanel'
import { useStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import {
  skillService,
  subscribeSkillsChanged,
  type SkillItem,
  type SubSkillItem,
  type SubSkillOption,
  type PluginListEntry,
} from '@intelligence/runtime/skillRepository'
import { runSubSkillAction } from '@intelligence/runtime/subSkillActions'
import {
  deriveSubSelection,
  mergeSubSelections,
  normalizeSubSelections,
} from '@intelligence/runtime/subSelection'
import type { SubSelectionEntry } from '@intelligence/types/contextModel'
import { useAgentStore, selectContextItems } from '@intelligence/state/IntelligenceStore'
import {
  buildPluginServerIndex,
  isPluginIdentityAllowed,
  resolveAgentPluginScope,
  unavailableInAgentTip,
} from '@intelligence/runtime/agentSkillAvailability'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'
import { getInstalledPlugins } from '@services/pluginService'
import { toast } from '@components/foundation/NotificationProvider'
import { clearPluginNotice } from '@renderer/plugins/pluginNoticeStore'
import type { LucideIcon } from 'lucide-react'
import {
  getClickStatsVersion,
  getSkillSortMode,
  pickPinnedEntries,
  recordPluginClick,
  recordSkillClick,
  recordSubSkillClick,
  sortSkills,
  sortSubSkills,
  subscribeClickStats,
  subscribeSkillSortMode,
} from '@intelligence/runtime/skillOrdering'

/** 插件内联展示上限：超出部分收进「更多技能」面板，避免长列表把所有插件的图标一次性挂载 */
const MAX_INLINE_PLUGINS = 10

/**
 * 技能内联展示上限
 *
 * 技能此前全部内联，一行放不下只能靠横向滚动去翻，末尾那几个等于藏了起来；
 * 声明为 skill 型的插件又被归并成技能条目，在「更多技能」面板里同样找不到，
 * 用户装完插件以为没生效。技能与插件共用同一套超出逻辑，面板才是完整入口。
 */
const MAX_INLINE_SKILLS = 8

/** select 下拉菜单与触发按钮之间的间距 */
const MENU_GAP = 6

/**
 * 技能栏条目
 *
 * 技能与插件统一成同一种条目，才能让常用项跨分区置顶——
 * 否则「排在最前面」只会在各自的分区内部生效，插件永远排在技能之后。
 */
type BarEntry =
  | { kind: 'skill'; key: string; skill: SkillItem }
  | { kind: 'plugin'; key: string; plugin: PluginListEntry }

/** 统计键与条目 key 使用同一套前缀，置顶结果可直接按 key 匹配 */
const toSkillEntry = (skill: SkillItem): BarEntry => ({
  kind: 'skill',
  key: `skill:${skill.name}`,
  skill,
})

const toPluginEntry = (plugin: PluginListEntry): BarEntry => ({
  kind: 'plugin',
  key: `plugin:${plugin.pluginKey}`,
  plugin,
})

/** 二级项展示名：与按钮文案保持一致，避免记录下来的选择与用户看到的对不上 */
const subLabelOf = (sub: SubSkillItem, isZh: boolean) =>
  isZh ? sub.label : (sub.labelEn || sub.label)

/**
 * 取出当前线程里该条目已做过的二级项选择
 *
 * 一个技能/插件往往有多个并列二级项，重新挂载上下文（点一级条目、点另一个二级项）
 * 都会整体替换上下文对象，已做的选择必须整组带过去，
 * 否则「先选生成方式、再选模板」时前一项就被冲掉了。
 */
function currentSubSelections(
  entry: BarEntry,
): SubSelectionEntry[] {
  const state = useAgentStore.getState()
  const threadId = state.currentThreadId
  if (!threadId) return []
  const item = state.threads[threadId]?.contextItems.find(candidate => (
    entry.kind === 'skill'
      ? candidate.type === 'Skill' && candidate.skillId === entry.skill.name.toLowerCase()
      : candidate.type === 'Plugin' && candidate.pluginId === entry.plugin.pluginKey
  ))
  if (!item || (item.type !== 'Skill' && item.type !== 'Plugin')) return []
  return normalizeSubSelections(item)
}

/** 技能图标：metadata.icon 支持图片地址与 lucide 图标名，缺省回退通用工具图标 */
function SkillIcon({ icon, fallback = Wrench }: { icon?: string; fallback?: LucideIcon }) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
  }
  const Icon = resolveLucideIcon(icon) || fallback
  return <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
}

/**
 * 单侧滚动控件：渐变遮罩 + 圆形按钮，绝对定位浮在列表两端
 *
 * 用绝对定位而不是流内排版，显隐只切换透明度与指针事件，
 * 不占用横向空间，因此列表宽度恒定，滚动到两端时不会因按钮消失而抖动。
 * 遮罩自身不接收指针事件（pointer-events-none），只有按钮可点，
 * 这样覆盖区域内的技能按钮依然可以正常点击与滚动。
 */
function ScrollEdge({
  direction,
  visible,
  onClick,
}: {
  direction: 1 | -1
  visible: boolean
  onClick: () => void
}) {
  const isLeft = direction === -1
  const Icon = isLeft ? ChevronLeft : ChevronRight
  return (
    <div
      aria-hidden={!visible}
      className={[
        'absolute inset-y-0 z-10 flex items-center pointer-events-none',
        'transition-opacity duration-200',
        isLeft
          ? 'left-0 pr-10 bg-gradient-to-r from-background-chat via-background-chat/75 to-transparent'
          : 'right-0 pl-10 bg-gradient-to-l from-background-chat via-background-chat/75 to-transparent',
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        tabIndex={visible ? 0 : -1}
        aria-label={isLeft ? '向左滚动' : '向右滚动'}
        className={[
          'shrink-0 p-1 rounded-full border border-border/50 bg-surface/80 text-text-muted shadow-sm',
          'hover:text-text-primary hover:border-accent/40 transition-all',
          visible ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/**
 * 单行横向滚动容器
 *
 * 内容统一贴左排列，与输入框左边缘对齐；
 * 左右滚动控件悬浮在列表两端，仅在该方向还有未展示内容时淡入，
 * 因为不参与布局，出现与消失都不会改变列表宽度。
 *
 * leading 固定在行首（如二级选项的返回入口）、trailing 固定在行尾（如「更多技能」入口），
 * 两者都在滚动区之外，因此始终可见；只有中间的内容随列表横向移动。
 */
function ScrollRow({
  leading,
  trailing,
  children,
}: {
  leading?: React.ReactNode
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setOverflowing(max > 1)
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1)
  }, [])

  // 技能异步加载、场景切换、技能行与二级行互切都会改变内容宽度，每次渲染后重新测量
  useEffect(sync)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sync])

  const step = useCallback((direction: 1 | -1) => {
    trackRef.current?.scrollBy({ left: direction * 240, behavior: 'smooth' })
  }, [])

  return (
    <div ref={wrapRef} className="flex items-center gap-1.5 w-full min-w-0">
      {leading}
      <div className="relative flex-1 min-w-0">
        <div ref={trackRef} onScroll={sync} className="w-full overflow-x-auto scrollbar-none">
          <div className="flex w-max items-center gap-2 px-0.5 py-0.5">{children}</div>
        </div>
        <ScrollEdge direction={-1} visible={overflowing && !atStart} onClick={() => step(-1)} />
        <ScrollEdge direction={1} visible={overflowing && !atEnd} onClick={() => step(1)} />
      </div>
      {trailing}
    </div>
  )
}

/**
 * select 类型二级选项的下拉菜单
 *
 * 技能栏所在容器带 overflow-y-auto，absolute 展开会被裁剪，因此与插件溢出面板
 * 采用同一种做法：portal 到 body + fixed 定位，贴着触发按钮上方展开。
 * 向上展开而不是向下，是因为下方紧邻输入框，向下会把正在使用的输入区盖住。
 */
function SubSkillSelectMenu({
  anchorEl,
  options,
  selectedValue,
  isZh,
  onSelect,
  onClose,
}: {
  anchorEl: HTMLElement | null
  options: SubSkillOption[]
  selectedValue?: string
  isZh: boolean
  onSelect: (option: SubSkillOption) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ left: number; bottom: number; minWidth: number } | null>(null)

  // 底边对齐按钮顶部，宽度不小于按钮宽度；右侧越界时回推，避免菜单被窗口裁掉
  useLayoutEffect(() => {
    if (!anchorEl) return
    const place = () => {
      const rect = anchorEl.getBoundingClientRect()
      const width = Math.max(rect.width, 168)
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      setPlacement({
        left: Math.max(8, left),
        bottom: window.innerHeight - rect.top + MENU_GAP,
        minWidth: width,
      })
    }
    place()
    window.addEventListener('resize', place)
    // capture 用于捕获中间滚动容器的滚动事件，避免菜单与锚点错位
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorEl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 点击菜单与锚点之外关闭；锚点自己负责 toggle，这里排除掉避免「关了又被打开」
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorEl, onClose])

  if (!placement) return null

  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label={isZh ? '选择选项' : 'Choose an option'}
      style={{ left: placement.left, bottom: placement.bottom, minWidth: placement.minWidth }}
      // bg-popover 固定 96%：这个下拉挂在输入框上方，壁纸模式下若跟着
      // --panel-alpha 变透明，菜单会和输入框、对话内容叠在一起。
      className="fixed z-[70] flex flex-col gap-0.5 rounded-xl border border-border/60 bg-popover p-1 shadow-2xl"
    >
      {options.map(option => {
        const label = isZh ? option.label : (option.labelEn || option.label)
        const active = option.value === selectedValue
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onSelect(option)}
            className={[
              'flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              active
                ? 'bg-accent/10 text-text-primary'
                : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary',
            ].join(' ')}
          >
            <span>{label}</span>
            {active && <Check className="w-3 h-3 shrink-0 text-accent" strokeWidth={2} />}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

export default function SkillSuggestionBar() {
  const language = useStore(s => s.language)
  const { currentSceneMode } = useSceneModeStore()
  const isZh = language === 'zh'

  const [skills, setSkills] = useState<SkillItem[]>([])
  // 已安装插件：技能之后紧跟同一条目行展示，点击后按插件上下文下发
  const [plugins, setPlugins] = useState<PluginListEntry[]>([])
  // 插件 key → MCP 服务 id：技能条目只带 pluginKey，需借此回溯到智能体的插件授权项
  const [pluginServerIndex, setPluginServerIndex] = useState<Map<string, string | undefined>>(new Map())
  // 展开二级行的条目：技能与插件共用同一套二级机制，因此记录整条目而不是单个技能
  const [openEntry, setOpenEntry] = useState<BarEntry | null>(null)
  // 展开中的 select 下拉：带 entryKey 防止菜单串到其他条目上，anchorEl 供菜单定位
  const [openSelect, setOpenSelect] = useState<{
    entryKey: string
    sub: SubSkillItem
    anchorEl: HTMLElement | null
  } | null>(null)
  // 「更多技能」面板：锚点是列表末尾按钮，面板贴它上方展开
  const [pluginPanelOpen, setPluginPanelOpen] = useState(false)
  const pluginMoreRef = useRef<HTMLDivElement>(null)
  // 整条技能栏容器：给弹出面板提供左右边界与宽度
  const barRef = useRef<HTMLDivElement>(null)
  // 当前会话：技能栏常驻在空会话视图里，新建任务不会卸载本组件，
  // 因此展开状态必须显式跟随会话切换复位
  const currentThreadId = useAgentStore(s => s.currentThreadId)

  // 技能与插件都是多选上下文：同一类可以同时挂载多个条目，
  // 选中态因此按集合判断，而不是只看「第一个同类项」。
  // 定义在点击处理之前，下面所有回调和渲染都直接复用。
  const contextItems = useAgentStore(selectContextItems)

  /** 已挂载的技能 id 集合（小写），行内按钮与面板的勾选态共用 */
  const selectedSkillIds = useMemo(
    () => new Set(
      contextItems
        .filter(item => item.type === 'Skill')
        .map(item => item.skillId),
    ),
    [contextItems],
  )

  /** 已挂载的插件 key 集合 */
  const selectedPluginIds = useMemo(
    () => new Set(
      contextItems
        .filter(item => item.type === 'Plugin')
        .map(item => item.pluginId),
    ),
    [contextItems],
  )

  useEffect(() => {
    let cancelled = false
    const load = () => {
      // 技能条只展示「启用 + 显示」的技能：被隐藏的技能仍可被 AI 调用，只是不出现在这里
      void Promise.all([
        skillService.getVisibleSkills(),
        skillService.getSkillListPlugins(),
        // 插件安装记录单独兜底：读取失败只影响可用性判断的精确度，不应让技能栏整条加载失败
        getInstalledPlugins().catch(() => []),
      ])
        .then(([skillList, pluginList, installedPlugins]) => {
          if (cancelled) return
          setSkills(skillList)
          setPlugins(pluginList)
          setPluginServerIndex(buildPluginServerIndex(installedPlugins))
        })
        .catch(() => {
          if (cancelled) return
          setSkills([])
          setPlugins([])
        })
    }
    load()
    // 技能启用或显示状态、来源变化（如已安装插件上切换「显示到技能列表」）后即时刷新
    const unsubscribe = subscribeSkillsChanged(load)
    return () => { cancelled = true; unsubscribe() }
  }, [currentSceneMode])

  // 列表刷新后展开的条目可能已不存在（技能被隐藏、插件被卸载），此时收起二级行
  useEffect(() => {
    if (!openEntry) return
    const alive = openEntry.kind === 'skill'
      ? skills.some(s => s.name === openEntry.skill.name)
      : plugins.some(p => p.pluginKey === openEntry.plugin.pluginKey)
    if (!alive) {
      setOpenEntry(null)
      setOpenSelect(null)
    }
  }, [skills, plugins, openEntry])

  /**
   * 切换会话（新建任务、或打开另一条历史会话）时收起二级行与下拉
   *
   * 二级项与下拉属于「本轮输入」的临时展开，只对当时选中的上下文有意义。
   * 新建任务时 contextItems 随新线程清空，若继续保留展开的那一行，
   * 新会话一打开就停在上一轮的技能二级项上，与空会话的语义直接冲突。
   *
   * 「空会话 → 首个新线程」不算切换：空会话里没有任何线程，用户点第一个技能时
   * contextItems 的写入会顺带创建线程（addContextItem 内部 createThread），
   * 若把这次变化也当成切换，刚展开的二级行会被立刻收起，
   * 表现为「第一次点技能展不开、要点第二次」。这里只在两个真实线程之间跳转时复位。
   */
  const prevThreadIdRef = useRef(currentThreadId)
  useEffect(() => {
    const previousThreadId = prevThreadIdRef.current
    prevThreadIdRef.current = currentThreadId
    if (!previousThreadId || previousThreadId === currentThreadId) return
    setOpenEntry(null)
    setOpenSelect(null)
    setPluginPanelOpen(false)
  }, [currentThreadId])

  /** 技能展示名：中文界面取中文名，回退到技能 ID */
  const getSkillLabel = useCallback((skill: SkillItem) => (
    isZh ? (skill.metadata?.nameZh || skill.name) : (skill.metadata?.nameEn || skill.name)
  ), [isZh])

  /**
   * 写入技能上下文（skillId 保持英文以便后端定位，展示名走中文）
   *
   * 二级项的选择必须随对象一起写入，不能事后单独补：上下文项是发送时整对象
   * 快照进消息的，晚一步写只会落在 store 上，用户气泡里仍然只剩技能名。
   *
   * created 只是本次新选的一项，写入前先与该条目已有的选择合并——
   * 生成方式、模板风格这类并列项必须同时留在上下文里。
   */
  const attachSkill = useCallback((skill: SkillItem, created?: SubSelectionEntry) => {
    const label = getSkillLabel(skill)
    const merged = mergeSubSelections(currentSubSelections(toSkillEntry(skill)), created ? [created] : [])
    const derived = deriveSubSelection(merged)
    useAgentStore.getState().addContextItem({
      type: 'Skill',
      skillId: skill.name.toLowerCase(),
      name: label,
      displayName: label,
      description: skill.description,
      ...(merged.length > 0 ? { subSelections: merged } : {}),
      ...(derived.subSelection ? { subSelection: derived.subSelection } : {}),
    })
  }, [getSkillLabel])

  /** 插件展示名：中文界面取中文名，回退到插件英文名 */
  const getPluginLabel = useCallback((plugin: PluginListEntry) => (
    isZh ? (plugin.nameZh || plugin.name) : plugin.name
  ), [isZh])

  /**
   * 当前智能体授权的插件范围
   *
   * 未选择智能体或智能体未配置插件（旧数据）时返回 null，表示不限制；
   * 返回空集合表示智能体明确未启用任何插件。
   */
  const agentConfig = useStore(s => s.agentConfig)
  const pluginScope = useMemo(() => {
    const activeId = agentConfig?.activeCustomAgentId
    if (!activeId) return null
    const profile = agentConfig?.customAgentProfiles?.find(p => p.id === activeId && p.enabled) ?? null
    return resolveAgentPluginScope(profile)
  }, [agentConfig])

  /** 条目在当前智能体中是否可用：技能按来源插件回溯，插件直接取自身 MCP 服务 id */
  const isEntryAvailable = useCallback((entry: BarEntry) => {
    if (entry.kind === 'plugin') {
      return isPluginIdentityAllowed(
        { pluginKey: entry.plugin.pluginKey, mcpServerId: entry.plugin.mcpServerId },
        pluginScope,
      )
    }
    const pluginKey = entry.skill.pluginKey
    return isPluginIdentityAllowed(
      { pluginKey, mcpServerId: pluginKey ? pluginServerIndex.get(pluginKey) : undefined },
      pluginScope,
    )
  }, [pluginScope, pluginServerIndex])

  /**
   * 点击插件：写入插件上下文
   *
   * 插件没有 SKILL.md 正文，不能走技能上下文；按插件上下文下发后，
   * 上下文管道会列出该插件已注册的工具，并提示 AI 直接调用而不是加载技能。
   */
  const attachPlugin = useCallback((plugin: PluginListEntry, created?: SubSelectionEntry) => {
    // 与技能同等对待：插件点击也要进统计，否则常用插件永远进不了置顶区
    recordPluginClick(plugin.pluginKey)
    const label = getPluginLabel(plugin)
    // 插件支持多选挂载：同一插件再次写入时按 pluginId 合并（而非替换其他插件），
    // 且已有的二级项选择与静默说明必须先接管过来，
    // 否则「先选生成方式、再选模板」这一步会把前一项连同它的约束说明一起冲掉，
    // AI 收到的上下文里就只剩最后选的那一项。
    const merged = mergeSubSelections(currentSubSelections(toPluginEntry(plugin)), created ? [created] : [])
    const derived = deriveSubSelection(merged)
    useAgentStore.getState().addContextItem({
      type: 'Plugin',
      pluginId: plugin.pluginKey,
      name: plugin.name,
      displayName: label,
      description: (isZh && plugin.descriptionZh) || plugin.description,
      mcpServerId: plugin.mcpServerId,
      ...(derived.stateNote ? { stateNote: derived.stateNote } : {}),
      ...(merged.length > 0 ? { subSelections: merged } : {}),
      ...(derived.subSelection ? { subSelection: derived.subSelection } : {}),
    })
  }, [getPluginLabel, isZh])

  // 排序方式（默认 / 按点击率）：在设置面板中切换，订阅后本组件实时跟随
  const sortMode = useSyncExternalStore(subscribeSkillSortMode, getSkillSortMode, getSkillSortMode)

  // 点击统计版本：每次点击后自增，让置顶与点击率排序立刻反映新数据
  const statsVersion = useSyncExternalStore(subscribeClickStats, getClickStatsVersion, getClickStatsVersion)

  const orderedSkills = useMemo(
    () => sortSkills(skills, sortMode, currentSceneMode),
    // statsVersion 不参与计算，仅用于点击后触发重排
    [skills, sortMode, currentSceneMode, statsVersion],
  )

  const orderedSubSkills = useMemo(() => {
    if (!openEntry) return []
    const items = openEntry.kind === 'skill'
      ? (openEntry.skill.subSkills ?? [])
      : (openEntry.plugin.subSkills ?? [])
    // 排序沿用点击率逻辑，插件用插件标识做统计键
    const statsKey = openEntry.kind === 'skill' ? openEntry.skill.name : openEntry.plugin.pluginKey
    return sortSubSkills(items, statsKey, sortMode)
  }, [openEntry, sortMode])

  /**
   * 点击一级条目
   *
   * 技能与插件走同一入口，语义分三种：
   * - 未挂载 → 追加挂载（多选，同类的其它条目不受影响）
   * - 已挂载且有二级项 → 展开/收起二级行，不动挂载状态
   * - 已挂载且无二级项 → 再点一次即取消，与标签上的 × 等价
   */
  const handleEntryClick = useCallback((entry: BarEntry) => {
    // 智能体未启用该插件时，技能/插件在执行层同样用不了：
    // 这里直接拦下并说明去向，而不是先挂上上下文、发送后才失败
    if (!isEntryAvailable(entry)) {
      toast.warning(unavailableInAgentTip(entry.kind, isZh))
      return
    }

    const subSkills = entry.kind === 'skill' ? entry.skill.subSkills : entry.plugin.subSkills
    const hasSub = Boolean(subSkills && subSkills.length > 0)

    const mountedIndex = contextItems.findIndex(item => (
      entry.kind === 'skill'
        ? item.type === 'Skill' && item.skillId === entry.skill.name.toLowerCase()
        : item.type === 'Plugin' && item.pluginId === entry.plugin.pluginKey
    ))

    // 已挂载且没有二级项：这次点击就是取消选择。
    // 带二级项的条目不这么处理——它的点击语义是展开/收起二级行，
    // 顺带取消挂载会让用户无法修改自己的选项。
    if (mountedIndex >= 0 && !hasSub) {
      if (entry.kind === 'plugin') clearPluginNotice()
      useAgentStore.getState().removeContextItem(mountedIndex)
      setOpenSelect(null)
      setOpenEntry(null)
      return
    }

    // 各条目在二级项里的选择互相独立：多选下点一个新条目，
    // 不能把其他条目已选好的结果清掉，否则「技能 A 选深色模板 + 技能 B 选商务风」会丢一半。
    // 因此这里不再做跨条目的选择清理，只重置插件侧的一次性提示。
    clearPluginNotice()

    if (entry.kind === 'skill') {
      recordSkillClick(entry.skill.name)
      attachSkill(entry.skill)
    } else {
      attachPlugin(entry.plugin)
    }
    setOpenSelect(null)
    setOpenEntry(hasSub ? entry : null)
  }, [attachPlugin, attachSkill, contextItems, isEntryAvailable, isZh])

  /**
   * 点击二级选项
   *
   * 三种类型共用一个入口，但只有 prompt 直接写输入框：
   * select 先展开选项行，action 交给动作注册表派发。
   */
  const handleSubClick = useCallback((entry: BarEntry, sub: SubSkillItem, anchorEl?: HTMLElement) => {
    const statsKey = entry.kind === 'skill' ? entry.skill.name : entry.plugin.pluginKey
    recordSubSkillClick(statsKey, sub.label)

    if (sub.type === 'select') {
      // 再次点击同一个选择器即收起，行为与普通下拉一致
      setOpenSelect(prev => (
        prev && prev.entryKey === entry.key && prev.sub.label === sub.label
          ? null
          : { entryKey: entry.key, sub, anchorEl: anchorEl ?? null }
      ))
      return
    }

    if (sub.type === 'action') {
      if (!sub.action) return
      void runSubSkillAction(sub.action.id, sub.action.payload, {
        isZh,
        skillName: entry.kind === 'skill' ? entry.skill.name : undefined,
        pluginKey: entry.kind === 'plugin' ? entry.plugin.pluginKey : undefined,
        setDraft: text => useAgentStore.getState().setChatDraft(text),
        sendMessage: text => {
          // 发送能力非必需，宿主未提供时静默跳过（动作本身不依赖它）
          const store = useAgentStore.getState() as { sendMessage?: (t: string) => void }
          store.sendMessage?.(text)
        },
      }).then(result => {
        if (!result.ok) console.warn('[SkillBar] 二级选项动作执行失败:', result.error)
      })
      return
    }

    const prompt = isZh ? sub.prompt : (sub.promptEn || sub.prompt)
    if (!prompt) return
    useAgentStore.getState().setChatDraft(prompt)
    // 二级项一旦写进输入框就只剩技能/插件标签，选择结果必须随上下文项一起带出去
    const created: SubSelectionEntry = { key: sub.label, label: subLabelOf(sub, isZh) }
    if (entry.kind === 'skill') attachSkill(entry.skill, created)
    else attachPlugin(entry.plugin, created)
    setOpenSelect(null)
  }, [attachPlugin, attachSkill, isZh])

  /**
   * 选中选项：按声明决定模板去向
   *
   * silent 的选项是开关型设置（生成方式、输出比例一类），选它是给 AI 下约束，
   * 不是要发一条需求：写进输入框会顶掉用户正在敲的内容，还得自己删干净重写。
   * 这类选项把模板渲染结果写进插件的 stateNote（随上下文注入 AI），
   * 输入框一律不动；未声明 silent 的仍按原行为填进输入框。
   *
   * 模板缺省时退化为「二级项名: 选项名」，保证没写模板的选择器也能用。
   */
  const handleOptionSelect = useCallback((entry: BarEntry, sub: SubSkillItem, option: SubSkillOption) => {
    const template = isZh
      ? (sub.promptTemplate || sub.promptTemplateEn)
      : (sub.promptTemplateEn || sub.promptTemplate)
    const optionLabel = isZh ? option.label : (option.labelEn || option.label)
    const text = template
      ? template.replace(/\{value\}/g, option.value).replace(/\{label\}/g, optionLabel)
      : `${isZh ? sub.label : (sub.labelEn || sub.label)}: ${optionLabel}`
    // 标签后面要能看出选的是哪一项，因此连二级项名一起记；
    // key 用二级项名，保证「生成方式」与「模板风格」各自占一条，互不覆盖
    const created: SubSelectionEntry = {
      key: sub.label,
      label: `${subLabelOf(sub, isZh)}：${optionLabel}`,
      // 说明正文随该项一起存：换另一个二级项时它必须留在上下文里
      note: text,
    }

    if (sub.silent) {
      // 开关型设置不写输入框，约束全部经由上下文带给 AI
      if (entry.kind === 'skill') attachSkill(entry.skill, created)
      else attachPlugin(entry.plugin, created)
      setOpenSelect(null)
      return
    }

    useAgentStore.getState().setChatDraft(text)
    if (entry.kind === 'skill') attachSkill(entry.skill, created)
    else attachPlugin(entry.plugin, created)
    // 只收起下拉、保留二级行：选完一项通常还要接着选别的，退回一级会把操作打断
    setOpenSelect(null)
  }, [attachPlugin, attachSkill, isZh])

  // 置顶候选池：技能与插件投进同一个池子，常用项因此能越过场景内置技能排到最前
  const pinnedKeys = useMemo(
    () => pickPinnedEntries([
      ...skills.map(skill => ({ kind: 'skill' as const, id: skill.name })),
      ...plugins.map(plugin => ({ kind: 'plugin' as const, id: plugin.pluginKey })),
    ]),
    // statsVersion 不参与计算，仅用于点击后重新挑选
    [skills, plugins, statsVersion],
  )

  const pinnedKeySet = useMemo(() => new Set(pinnedKeys), [pinnedKeys])

  const pinnedEntries = useMemo(() => {
    const byKey = new Map<string, BarEntry>()
    skills.forEach(skill => byKey.set(`skill:${skill.name}`, toSkillEntry(skill)))
    plugins.forEach(plugin => byKey.set(`plugin:${plugin.pluginKey}`, toPluginEntry(plugin)))
    return pinnedKeys
      .map(key => byKey.get(key))
      .filter((entry): entry is BarEntry => Boolean(entry))
  }, [pinnedKeys, skills, plugins])

  // 置顶项已在上方展示，从各自分区里剔除，避免同一条目前后出现两次
  const restSkills = useMemo(
    () => orderedSkills.filter(skill => !pinnedKeySet.has(`skill:${skill.name}`)),
    [orderedSkills, pinnedKeySet],
  )
  const restPlugins = useMemo(
    () => plugins.filter(plugin => !pinnedKeySet.has(`plugin:${plugin.pluginKey}`)),
    [plugins, pinnedKeySet],
  )

  // 其余技能内联前 MAX_INLINE_SKILLS 个，其余收进「更多技能」面板
  const visibleRestSkills = useMemo(
    () => restSkills.slice(0, MAX_INLINE_SKILLS),
    [restSkills],
  )
  const hiddenSkillCount = restSkills.length - visibleRestSkills.length

  // 插件内联只展示前 MAX_INLINE_PLUGINS 个，其余收进「更多技能」面板
  const visibleRestPlugins = useMemo(
    () => restPlugins.slice(0, MAX_INLINE_PLUGINS),
    [restPlugins],
  )
  const hiddenPluginCount = restPlugins.length - visibleRestPlugins.length

  /** 面板入口的展示条件：技能与插件任一侧有溢出就需要它 */
  const hiddenEntryCount = hiddenSkillCount + hiddenPluginCount


  /**
   * 发送后收起二级行
   *
   * 发送会清空线程上下文，此时展开的二级项已经没有任何归属：继续留着，
   * 输入框上方就会停在上一轮的选择上，新建任务时看到的更是上一个会话的残影。
   * 用「该技能是否还挂在上下文里」判断，比监听发送事件更稳——
   * 用户手动删掉技能标签时同样应该收起。
   */
  useEffect(() => {
    if (!openEntry) return
    // 展开的二级行只属于它自己的条目：该条目从上下文里消失（被取消、或发送后清空）就失去归属
    const stillMounted = openEntry.kind === 'skill'
      ? contextItems.some(
          item => item.type === 'Skill' && item.skillId === openEntry.skill.name.toLowerCase(),
        )
      : contextItems.some(
          item => item.type === 'Plugin' && item.pluginId === openEntry.plugin.pluginKey,
        )
    if (!stillMounted) {
      setOpenEntry(null)
      setOpenSelect(null)
    }
  }, [contextItems, openEntry])

  /**
   * 取消某个插件的挂载
   *
   * 多选下必须按 pluginId 定位：沿用「删第一个 Plugin」的写法，
   * 挂载了多个插件时会删掉用户没想删的那一个。
   * 省略 pluginKey 时退回第一个插件，与早前的单插件调用保持一致。
   */
  const handlePluginDeselect = useCallback((pluginKey?: string) => {
    const index = contextItems.findIndex(item => (
      item.type === 'Plugin' && (pluginKey ? item.pluginId === pluginKey : true)
    ))
    if (index >= 0) useAgentStore.getState().removeContextItem(index)
  }, [contextItems])

  /**
   * 「更多技能」面板的条目集合
   *
   * 传全量而不是只有溢出的那几个：面板本身就是「横向滚动翻不动时的检索入口」，
   * 带上全部条目才能用搜索一次性定位，否则还得先判断目标在行内还是在面板里。
   */
  const overflowItems = useMemo<OverflowEntryItem[]>(() => {
    return [
      ...orderedSkills.map(skill => {
        const available = isEntryAvailable(toSkillEntry(skill))
        return {
          key: `skill:${skill.name}`,
          kind: 'skill' as const,
          label: getSkillLabel(skill),
          description: skill.description || '',
          icon: skill.metadata?.icon,
          selected: selectedSkillIds.has(skill.name.toLowerCase()),
          // 面板里保留条目：用户需要看见「装了但当前智能体没启用」，直接筛掉会被当成技能丢失
          disabled: !available,
          hint: available ? undefined : unavailableInAgentTip('skill', isZh),
        }
      }),
      ...plugins.map(plugin => {
        const available = isEntryAvailable(toPluginEntry(plugin))
        return {
          key: `plugin:${plugin.pluginKey}`,
          kind: 'plugin' as const,
          label: getPluginLabel(plugin),
          description: (isZh && plugin.descriptionZh) || plugin.description || '',
          icon: plugin.icon,
          selected: selectedPluginIds.has(plugin.pluginKey),
          disabled: !available,
          hint: available ? undefined : unavailableInAgentTip('plugin', isZh),
        }
      }),
    ]
  }, [selectedSkillIds, selectedPluginIds, orderedSkills, plugins, getSkillLabel, getPluginLabel, isZh, isEntryAvailable])

  /** 面板选中/取消：技能与插件分别回落到各自的一级点击语义 */
  const handleOverflowSelect = useCallback((item: OverflowEntryItem) => {
    if (item.kind === 'skill') {
      const name = item.key.slice('skill:'.length)
      const skill = skills.find(candidate => candidate.name === name)
      if (skill) handleEntryClick(toSkillEntry(skill))
      return
    }
    const pluginKey = item.key.slice('plugin:'.length)
    const plugin = plugins.find(candidate => candidate.pluginKey === pluginKey)
    if (plugin) handleEntryClick(toPluginEntry(plugin))
  }, [handleEntryClick, skills, plugins])

  const handleOverflowDeselect = useCallback((item: OverflowEntryItem) => {
    if (item.kind === 'plugin') {
      handlePluginDeselect(item.key.slice('plugin:'.length))
      return
    }
    const skillId = item.key.slice('skill:'.length).toLowerCase()
    const index = contextItems.findIndex(candidate => (
      candidate.type === 'Skill' && candidate.skillId === skillId
    ))
    if (index >= 0) useAgentStore.getState().removeContextItem(index)
  }, [contextItems, handlePluginDeselect])

  /**
   * 渲染单个条目
   *
   * 置顶区里技能与插件混排，因此按条目类型分别出样式：
   * 技能沿用强调色，插件保持紫色标识，混排后仍能一眼区分来源。
   */
  const renderEntry = (entry: BarEntry) => {
    // 有二级选项的条目在末尾多一个箭头，明确提示点开还有下一层
    const subSkills = entry.kind === 'skill' ? entry.skill.subSkills : entry.plugin.subSkills
    const hasSub = Boolean(subSkills && subSkills.length > 0)
    // 智能体未启用来源插件时条目仍然展示，只做灰化并用悬停提示说明原因，避免点了没反应
    const available = isEntryAvailable(entry)
    const unavailableTip = available ? undefined : unavailableInAgentTip(entry.kind, isZh)

    if (entry.kind === 'skill') {
      // 多选下必须能看出「哪几个已经挂上了」，否则用户不知道再点一次是加还是减
      const selected = selectedSkillIds.has(entry.skill.name.toLowerCase())
      return (
        <button
          key={entry.key}
          type="button"
          onClick={() => handleEntryClick(entry)}
          title={unavailableTip ?? entry.skill.description}
          aria-disabled={!available}
          aria-pressed={selected}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-all duration-200',
            !available
              ? 'border-border/40 bg-surface/60 text-text-muted/70 opacity-60'
              : selected
                ? 'border-accent/60 bg-accent/15 text-text-primary'
                : 'border-accent/20 bg-accent/5 text-text-secondary hover:text-text-primary hover:border-accent/50 hover:bg-accent/10',
          ].join(' ')}
        >
          <SkillIcon icon={entry.skill.metadata?.icon} />
          <span>{getSkillLabel(entry.skill)}</span>
          {selected && available && <Check className="w-3 h-3 text-accent" strokeWidth={2} />}
          {hasSub && <ChevronRight className="w-3 h-3 opacity-60" strokeWidth={1.5} />}
        </button>
      )
    }

    const { plugin } = entry
    const selected = selectedPluginIds.has(plugin.pluginKey)
    return (
      <button
        key={entry.key}
        type="button"
        onClick={() => handleEntryClick(entry)}
        title={unavailableTip ?? ((isZh && plugin.descriptionZh) || plugin.description)}
        aria-disabled={!available}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border',
          !available
            ? 'border-border/40 bg-surface/60 text-text-muted/70 opacity-60'
            : selected
              ? 'border-purple-500/60 bg-purple-500/15 text-text-primary'
              : 'border-purple-500/20 bg-purple-500/5 text-text-secondary hover:text-text-primary hover:border-purple-500/50 hover:bg-purple-500/10',
        ].join(' ')}
      >
        <SkillIcon icon={plugin.icon} fallback={Puzzle} />
        <span>{getPluginLabel(plugin)}</span>
        {selected && available && <Check className="w-3 h-3 text-purple-400" strokeWidth={2} />}
        {hasSub && <ChevronRight className="w-3 h-3 opacity-60" strokeWidth={1.5} />}
      </button>
    )
  }

  /**
   * 展开条目下各二级项已选的值（二级项名 → 选项名）
   *
   * 只看当前展开的那一个条目：别的条目上的选择与本行无关，
   * 混进来会让按钮显示成「生成方式：商务浅色」这种对不上的组合。
   */
  const chosenOptionLabels = useMemo(() => {
    const labels = new Map<string, string>()
    if (!openEntry) return labels
    const mounted = contextItems.find(candidate => (
      openEntry.kind === 'skill'
        ? candidate.type === 'Skill' && candidate.skillId === openEntry.skill.name.toLowerCase()
        : candidate.type === 'Plugin' && candidate.pluginId === openEntry.plugin.pluginKey
    ))
    if (!mounted || (mounted.type !== 'Skill' && mounted.type !== 'Plugin')) return labels
    for (const selection of normalizeSubSelections(mounted)) {
      // 标签是「二级项：选项」，按钮已经写着二级项名，这里只取选项那一段
      const separator = selection.label.search(/[：:]/)
      labels.set(
        selection.key,
        separator >= 0 ? selection.label.slice(separator + 1).trim() : selection.label,
      )
    }
    return labels
  }, [contextItems, openEntry])

  // 切到二级行、或条目数量回落到上限内时收起面板，避免面板失去锚点后悬空
  useEffect(() => {
    if (openEntry || hiddenEntryCount <= 0) setPluginPanelOpen(false)
  }, [openEntry, hiddenEntryCount])

  if (skills.length === 0 && plugins.length === 0) return null

  return (
    <div ref={barRef} className="w-full mb-2">
      {openEntry && orderedSubSkills.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <ScrollRow
            leading={
              <button
                type="button"
                onClick={() => { setOpenEntry(null); setOpenSelect(null) }}
                title={isZh ? '返回列表' : 'Back to list'}
                className="shrink-0 flex items-center gap-0.5 pl-1.5 pr-2 py-1 rounded-full text-xs font-medium border border-border/50 bg-surface/60 text-text-muted hover:text-text-primary hover:border-accent/40 hover:bg-accent/5 transition-all"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="max-w-[120px] truncate">
                  {openEntry.kind === 'skill' ? getSkillLabel(openEntry.skill) : getPluginLabel(openEntry.plugin)}
                </span>
              </button>
            }
          >
            {orderedSubSkills.map(sub => {
              const active = openSelect?.entryKey === openEntry.key && openSelect.sub.label === sub.label
              const subLabel = isZh ? sub.label : (sub.labelEn || sub.label)
              // 该二级项已选过的值：只用来点亮按钮与给悬停提示，不再拼到按钮文字后面——
              // 选择结果在输入框上方的上下文标签里已经有了，两处同时显示会显得重复
              const chosen = chosenOptionLabels.get(sub.label)
              // 插件可在 subSkills[].icon 里指定图标；未声明时按交互类型回退
              const SubIcon =
                resolveLucideIcon(sub.icon) ||
                (sub.type === 'select' ? ChevronDown : sub.type === 'action' ? Zap : Sparkles)
              return (
                <button
                  key={sub.label}
                  type="button"
                  onClick={e => handleSubClick(openEntry, sub, e.currentTarget)}
                  aria-expanded={sub.type === 'select' ? active : undefined}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border',
                    active || chosen
                      ? 'bg-accent/10 border-accent/50 text-text-primary'
                      : 'bg-surface border-border/50 text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-accent/10',
                  ].join(' ')}
                  title={chosen ? `${subLabel}：${chosen}` : undefined}
                >
                  <SubIcon className="w-3 h-3" strokeWidth={1.5} />
                  {subLabel}
                </button>
              )
            })}
          </ScrollRow>
          {/* select 下拉：portal 到 body，贴在触发按钮上方展开 */}
          {openSelect && openSelect.entryKey === openEntry.key && openSelect.sub.options && (
            <SubSkillSelectMenu
              anchorEl={openSelect.anchorEl}
              options={openSelect.sub.options}
              selectedValue={
                // 已选过的值优先于声明里的默认值，否则重开下拉会高亮回默认项
                openSelect.sub.options?.find(option =>
                  (isZh ? option.label : (option.labelEn || option.label))
                  === chosenOptionLabels.get(openSelect.sub.label),
                )?.value ?? openSelect.sub.defaultOption
              }
              isZh={isZh}
              onSelect={option => handleOptionSelect(openEntry, openSelect.sub, option)}
              onClose={() => setOpenSelect(null)}
            />
          )}
        </div>
      ) : (
        <ScrollRow
          trailing={
            hiddenEntryCount > 0 ? (
              <div ref={pluginMoreRef} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setPluginPanelOpen(open => !open)}
                  aria-expanded={pluginPanelOpen}
                  aria-haspopup="dialog"
                  title={isZh ? `还有 ${hiddenEntryCount} 个技能` : `${hiddenEntryCount} more skills`}
                  className="flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border border-border/60 bg-surface/80 text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-accent/10"
                >
                  <span>{isZh ? '更多技能' : 'More skills'}</span>
                </button>
              </div>
            ) : undefined
          }
        >
          {/* 常用置顶：技能与插件按常用分数混排，因此常用插件会排在场景内置技能之前 */}
          {pinnedEntries.map(renderEntry)}
          {/* 其余技能：已被置顶的条目不再重复出现，顺序仍遵循当前排序方式 */}
          {visibleRestSkills.map(skill => renderEntry(toSkillEntry(skill)))}
          {/* 其余插件：内联前 MAX_INLINE_PLUGINS 个，其余收进「更多技能」面板 */}
          {visibleRestPlugins.map(plugin => renderEntry(toPluginEntry(plugin)))}
        </ScrollRow>
      )}
      {pluginPanelOpen && hiddenEntryCount > 0 && (
        <PluginOverflowPanel
          anchorEl={pluginMoreRef.current}
          alignEl={barRef.current}
          items={overflowItems}
          isZh={isZh}
          // 走 handleEntryClick 而非 attachSkill/attachPlugin：面板里的点击与技能栏一致，
          // 有二级项时同样需要展开二级行，否则从「更多技能」选条目就没有下一步可选
          onSelect={handleOverflowSelect}
          onDeselect={handleOverflowDeselect}
          onClose={() => setPluginPanelOpen(false)}
        />
      )}

    </div>
  )
}

