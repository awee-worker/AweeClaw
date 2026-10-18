/**
 * 空对话态技能建议栏
 *
 * 渲染在输入框容器正上方，宽度与输入框保持一致：
 * - 默认展示一行技能，其后紧跟「插件与技能市场」里已安装的插件（技能在前、插件在后）
 * - 点击带二级选项的技能后整行切换为二级选项，并提供返回入口
 * - 每行固定单行横向滚动，溢出时隐藏滚动条；左右滚动按钮以渐变遮罩悬浮在列表两端，
 *   只有那一侧还存在未展示内容时才淡入，因不占布局所以显隐不会引起列表抖动
 * - 插件只内联展示前 MAX_INLINE_PLUGINS 个，其余收进行尾固定的「更多技能」按钮，
 *   点击在按钮上方弹出可搜索的面板（PluginOverflowPanel）。按钮不参与横向滚动，
 *   否则技能一多就得先滚到最右才看得见，等于没解决问题
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
import PluginOverflowPanel from './PluginOverflowPanel'
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
import { useAgentStore, selectContextItems } from '@intelligence/state/IntelligenceStore'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'
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
      className="fixed z-[70] flex flex-col gap-0.5 rounded-xl border border-border/60 bg-surface p-1 shadow-2xl"
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

  useEffect(() => {
    let cancelled = false
    const load = () => {
      // 技能条只展示「启用 + 显示」的技能：被隐藏的技能仍可被 AI 调用，只是不出现在这里
      void Promise.all([
        skillService.getVisibleSkills(),
        skillService.getSkillListPlugins(),
      ])
        .then(([skillList, pluginList]) => {
          if (cancelled) return
          setSkills(skillList)
          setPlugins(pluginList)
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

  /** 技能展示名：中文界面取中文名，回退到技能 ID */
  const getSkillLabel = useCallback((skill: SkillItem) => (
    isZh ? (skill.metadata?.nameZh || skill.name) : (skill.metadata?.nameEn || skill.name)
  ), [isZh])

  /** 写入技能上下文（skillId 保持英文以便后端定位，展示名走中文） */
  const attachSkill = useCallback((skill: SkillItem) => {
    const label = getSkillLabel(skill)
    useAgentStore.getState().addContextItem({
      type: 'Skill',
      skillId: skill.name.toLowerCase(),
      name: label,
      displayName: label,
      description: skill.description,
    })
  }, [getSkillLabel])

  /** 插件展示名：中文界面取中文名，回退到插件英文名 */
  const getPluginLabel = useCallback((plugin: PluginListEntry) => (
    isZh ? (plugin.nameZh || plugin.name) : plugin.name
  ), [isZh])

  /**
   * 点击插件：写入插件上下文
   *
   * 插件没有 SKILL.md 正文，不能走技能上下文；按插件上下文下发后，
   * 上下文管道会列出该插件已注册的工具，并提示 AI 直接调用而不是加载技能。
   */
  const attachPlugin = useCallback((plugin: PluginListEntry) => {
    // 与技能同等对待：插件点击也要进统计，否则常用插件永远进不了置顶区
    recordPluginClick(plugin.pluginKey)
    const label = getPluginLabel(plugin)
    useAgentStore.getState().addContextItem({
      type: 'Plugin',
      pluginId: plugin.pluginKey,
      name: plugin.name,
      displayName: label,
      description: (isZh && plugin.descriptionZh) || plugin.description,
      mcpServerId: plugin.mcpServerId,
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
   * 点击一级条目：先写入上下文，再展开二级行
   *
   * 技能与插件走同一入口：两者都有 subSkills 时都能展开二级行，
   * 没有二级项时保持原有「点一下即选中」的行为。
   */
  const handleEntryClick = useCallback((entry: BarEntry) => {
    const subSkills = entry.kind === 'skill' ? entry.skill.subSkills : entry.plugin.subSkills
    if (entry.kind === 'skill') {
      recordSkillClick(entry.skill.name)
      attachSkill(entry.skill)
    } else {
      attachPlugin(entry.plugin)
    }
    setOpenSelect(null)
    setOpenEntry(subSkills && subSkills.length > 0 ? entry : null)
  }, [attachPlugin, attachSkill])

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
    if (entry.kind === 'skill') attachSkill(entry.skill)
    setOpenSelect(null)
  }, [attachSkill, isZh])

  /**
   * 选中选项：把值填进提示词模板
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
    useAgentStore.getState().setChatDraft(text)
    if (entry.kind === 'skill') attachSkill(entry.skill)
    // 只收起下拉、保留二级行：选完一项通常还要接着选别的，退回一级会把操作打断
    setOpenSelect(null)
  }, [attachSkill, isZh])

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

  // 插件内联只展示前 MAX_INLINE_PLUGINS 个，其余收进「更多技能」面板
  const visibleRestPlugins = useMemo(
    () => restPlugins.slice(0, MAX_INLINE_PLUGINS),
    [restPlugins],
  )
  const hiddenPluginCount = restPlugins.length - visibleRestPlugins.length

  // 插件是单选上下文（contextItems 里最多一个 Plugin）：取它作为行内按钮与面板的选中态
  const contextItems = useAgentStore(selectContextItems)
  const selectedPluginIndex = useMemo(
    () => contextItems.findIndex(item => item.type === 'Plugin'),
    [contextItems],
  )
  const selectedPluginId = useMemo(() => {
    const item = contextItems[selectedPluginIndex]
    return item?.type === 'Plugin' ? item.pluginId : undefined
  }, [contextItems, selectedPluginIndex])

  // 面板里再点一次已选插件即取消选择
  const handlePluginDeselect = useCallback(() => {
    if (selectedPluginIndex < 0) return
    useAgentStore.getState().removeContextItem(selectedPluginIndex)
  }, [selectedPluginIndex])

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

    if (entry.kind === 'skill') {
      return (
        <button
          key={entry.key}
          type="button"
          onClick={() => handleEntryClick(entry)}
          title={entry.skill.description}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-accent/20 bg-accent/5 text-text-secondary hover:text-text-primary hover:border-accent/50 hover:bg-accent/10 whitespace-nowrap shrink-0 transition-all duration-200"
        >
          <SkillIcon icon={entry.skill.metadata?.icon} />
          <span>{getSkillLabel(entry.skill)}</span>
          {hasSub && <ChevronRight className="w-3 h-3 opacity-60" strokeWidth={1.5} />}
        </button>
      )
    }

    const { plugin } = entry
    const selected = plugin.pluginKey === selectedPluginId
    return (
      <button
        key={entry.key}
        type="button"
        onClick={() => handleEntryClick(entry)}
        title={(isZh && plugin.descriptionZh) || plugin.description}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border',
          selected
            ? 'border-purple-500/60 bg-purple-500/15 text-text-primary'
            : 'border-purple-500/20 bg-purple-500/5 text-text-secondary hover:text-text-primary hover:border-purple-500/50 hover:bg-purple-500/10',
        ].join(' ')}
      >
        <SkillIcon icon={plugin.icon} fallback={Puzzle} />
        <span>{getPluginLabel(plugin)}</span>
        {selected && <Check className="w-3 h-3 text-purple-400" strokeWidth={2} />}
        {hasSub && <ChevronRight className="w-3 h-3 opacity-60" strokeWidth={1.5} />}
      </button>
    )
  }

  // 切到二级行、或插件数量回落到上限内时收起面板，避免面板失去锚点后悬空
  useEffect(() => {
    if (openEntry || hiddenPluginCount <= 0) setPluginPanelOpen(false)
  }, [openEntry, hiddenPluginCount])

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
              const SubIcon = sub.type === 'select' ? ChevronDown : sub.type === 'action' ? Zap : Sparkles
              return (
                <button
                  key={sub.label}
                  type="button"
                  onClick={e => handleSubClick(openEntry, sub, e.currentTarget)}
                  aria-expanded={sub.type === 'select' ? active : undefined}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border',
                    active
                      ? 'bg-accent/10 border-accent/50 text-text-primary'
                      : 'bg-surface border-border/50 text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-accent/10',
                  ].join(' ')}
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
              selectedValue={openSelect.sub.defaultOption}
              isZh={isZh}
              onSelect={option => handleOptionSelect(openEntry, openSelect.sub, option)}
              onClose={() => setOpenSelect(null)}
            />
          )}
        </div>
      ) : (
        <ScrollRow
          trailing={
            hiddenPluginCount > 0 ? (
              <div ref={pluginMoreRef} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setPluginPanelOpen(open => !open)}
                  aria-expanded={pluginPanelOpen}
                  aria-haspopup="dialog"
                  title={isZh ? `还有 ${hiddenPluginCount} 个技能` : `${hiddenPluginCount} more skills`}
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
          {restSkills.map(skill => renderEntry(toSkillEntry(skill)))}
          {/* 其余插件：内联前 MAX_INLINE_PLUGINS 个，其余收进「更多技能」面板 */}
          {visibleRestPlugins.map(plugin => renderEntry(toPluginEntry(plugin)))}
        </ScrollRow>
      )}
      {pluginPanelOpen && hiddenPluginCount > 0 && (
        <PluginOverflowPanel
          anchorEl={pluginMoreRef.current}
          alignEl={barRef.current}
          plugins={plugins}
          isZh={isZh}
          selectedPluginId={selectedPluginId}
          onSelect={attachPlugin}
          onDeselect={handlePluginDeselect}
          onClose={() => setPluginPanelOpen(false)}
        />
      )}
    </div>
  )
}

