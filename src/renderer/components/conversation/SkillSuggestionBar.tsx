/**
 * 空对话态技能建议栏
 *
 * 渲染在输入框容器正上方，宽度与输入框保持一致：
 * - 默认展示一行技能，其后紧跟「插件与技能市场」里已安装的插件（技能在前、插件在后）
 * - 点击带二级选项的技能后整行切换为二级选项，并提供返回入口
 * - 每行固定单行横向滚动，溢出时隐藏滚动条；左右滚动按钮以渐变遮罩悬浮在列表两端，
 *   只有那一侧还存在未展示内容时才淡入，因不占布局所以显隐不会引起列表抖动
 * - 插件只内联展示前 MAX_INLINE_PLUGINS 个，其余收进行尾固定的「更多插件」按钮，
 *   点击在按钮上方弹出可搜索的面板（PluginOverflowPanel）。按钮不参与横向滚动，
 *   否则技能一多就得先滚到最右才看得见，等于没解决问题
 */

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Check, ChevronLeft, ChevronRight, Puzzle, Sparkles, Wrench } from 'lucide-react'
import PluginOverflowPanel from './PluginOverflowPanel'
import { useStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import {
  skillService,
  subscribeSkillsChanged,
  type SkillItem,
  type SubSkillItem,
  type PluginListEntry,
} from '@intelligence/runtime/skillRepository'
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

/** 插件内联展示上限：超出部分收进「更多插件」面板，避免长列表把所有插件的图标一次性挂载 */
const MAX_INLINE_PLUGINS = 10

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
 * leading 固定在行首（如二级选项的返回入口），不随列表滚动；
 * 其余条目（含末尾的「更多插件」入口）都在滚动区内，跟着列表一起横向移动。
 */
function ScrollRow({
  leading,
  children,
}: {
  leading?: React.ReactNode
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
    </div>
  )
}

export default function SkillSuggestionBar() {
  const language = useStore(s => s.language)
  const { currentSceneMode } = useSceneModeStore()
  const isZh = language === 'zh'

  const [skills, setSkills] = useState<SkillItem[]>([])
  // 已安装插件：技能之后紧跟同一条目行展示，点击后按插件上下文下发
  const [plugins, setPlugins] = useState<PluginListEntry[]>([])
  const [openSkill, setOpenSkill] = useState<SkillItem | null>(null)
  // 「更多插件」面板：锚点是行尾按钮，面板贴它上方展开
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

  // 场景切换后重建的技能列表可能不再包含当前展开的技能，此时收起二级行
  useEffect(() => {
    if (openSkill && !skills.some(s => s.name === openSkill.name)) setOpenSkill(null)
  }, [skills, openSkill])

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

  const orderedSubSkills = useMemo(
    () => (openSkill ? sortSubSkills(openSkill.subSkills ?? [], openSkill.name, sortMode) : []),
    [openSkill, sortMode],
  )

  // 点击技能：先选中（输入框上方出现 @技能 标签）；带二级选项的切换为二级行
  const handleSkillClick = useCallback((skill: SkillItem) => {
    recordSkillClick(skill.name)
    attachSkill(skill)
    setOpenSkill(skill.subSkills && skill.subSkills.length > 0 ? skill : null)
  }, [attachSkill])

  // 点击二级选项：用需求提示词替换输入框内容（直接替换不拼接，连续点选不会堆积）
  const handleSubClick = useCallback((skill: SkillItem, sub: SubSkillItem) => {
    recordSubSkillClick(skill.name, sub.label)
    const store = useAgentStore.getState()
    const prompt = isZh ? sub.prompt : (sub.promptEn || sub.prompt)
    store.setChatDraft(prompt)
    attachSkill(skill)
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

  // 插件内联只展示前 MAX_INLINE_PLUGINS 个，其余收进「更多插件」面板
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
    if (entry.kind === 'skill') {
      return (
        <button
          key={entry.key}
          type="button"
          onClick={() => handleSkillClick(entry.skill)}
          title={entry.skill.description}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-accent/20 bg-accent/5 text-text-secondary hover:text-text-primary hover:border-accent/50 hover:bg-accent/10 whitespace-nowrap shrink-0 transition-all duration-200"
        >
          <SkillIcon icon={entry.skill.metadata?.icon} />
          <span>{getSkillLabel(entry.skill)}</span>
        </button>
      )
    }

    const { plugin } = entry
    const selected = plugin.pluginKey === selectedPluginId
    return (
      <button
        key={entry.key}
        type="button"
        onClick={() => attachPlugin(plugin)}
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
      </button>
    )
  }

  // 切到二级技能行、或插件数量回落到上限内时收起面板，避免面板失去锚点后悬空
  useEffect(() => {
    if (openSkill || hiddenPluginCount <= 0) setPluginPanelOpen(false)
  }, [openSkill, hiddenPluginCount])

  if (skills.length === 0 && plugins.length === 0) return null

  return (
    <div ref={barRef} className="w-full mb-2">
      {openSkill && orderedSubSkills.length > 0 ? (
        <ScrollRow
          leading={
            <button
              type="button"
              onClick={() => setOpenSkill(null)}
              title={isZh ? '返回技能列表' : 'Back to skills'}
              className="shrink-0 flex items-center gap-0.5 pl-1.5 pr-2 py-1 rounded-full text-xs font-medium border border-border/50 bg-surface/60 text-text-muted hover:text-text-primary hover:border-accent/40 hover:bg-accent/5 transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="max-w-[120px] truncate">{getSkillLabel(openSkill)}</span>
            </button>
          }
        >
          {orderedSubSkills.map(sub => (
            <button
              key={sub.label}
              type="button"
              onClick={() => handleSubClick(openSkill, sub)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-surface border border-border/50 text-text-secondary hover:text-text-primary hover:border-accent/40 hover:bg-accent/10 whitespace-nowrap shrink-0 transition-all duration-200"
            >
              <Sparkles className="w-3 h-3" strokeWidth={1.5} />
              {isZh ? sub.label : (sub.labelEn || sub.label)}
            </button>
          ))}
        </ScrollRow>
      ) : (
        <ScrollRow>
          {/* 常用置顶：技能与插件按常用分数混排，因此常用插件会排在场景内置技能之前 */}
          {pinnedEntries.map(renderEntry)}
          {/* 其余技能：已被置顶的条目不再重复出现，顺序仍遵循当前排序方式 */}
          {restSkills.map(skill => renderEntry(toSkillEntry(skill)))}
          {/* 其余插件：内联前 MAX_INLINE_PLUGINS 个，其余收进「更多插件」面板 */}
          {visibleRestPlugins.map(plugin => renderEntry(toPluginEntry(plugin)))}
          {/* 「更多插件」排在插件之后，随列表一起横向滚动，不额外占行 */}
          {hiddenPluginCount > 0 && (
            <div ref={pluginMoreRef} className="shrink-0">
              <button
                type="button"
                onClick={() => setPluginPanelOpen(open => !open)}
                aria-expanded={pluginPanelOpen}
                aria-haspopup="dialog"
                title={isZh ? `还有 ${hiddenPluginCount} 个插件` : `${hiddenPluginCount} more plugins`}
                className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all duration-200 border border-purple-500/30 bg-purple-500/10 text-text-secondary hover:text-text-primary hover:border-purple-500/60 hover:bg-purple-500/15"
              >
                <Puzzle className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span>{isZh ? '更多插件' : 'More'}</span>
                <span className="rounded-full bg-purple-500/25 px-1.5 text-[10px] leading-4 tabular-nums">
                  {hiddenPluginCount}
                </span>
              </button>
            </div>
          )}
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

