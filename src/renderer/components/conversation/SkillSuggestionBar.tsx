/**
 * 空对话态技能建议栏
 *
 * 渲染在输入框容器正上方，宽度与输入框保持一致：
 * - 默认展示一行技能；点击带二级选项的技能后整行切换为二级选项，并提供返回入口
 * - 每行固定单行横向滚动，溢出时隐藏滚动条，左右滚动按钮各自贴在对应一侧，
 *   只有那一侧还存在未展示内容时才出现
 */

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, Wrench } from 'lucide-react'
import { useStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { skillService, subscribeSkillsChanged, type SkillItem, type SubSkillItem } from '@intelligence/runtime/skillRepository'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { resolveLucideIcon, isImageIcon } from '@components/plugin/pluginIconResolver'
import {
  getSkillSortMode,
  recordSkillClick,
  recordSubSkillClick,
  sortSkills,
  sortSubSkills,
  subscribeSkillSortMode,
} from '@intelligence/runtime/skillOrdering'

/** 技能图标：metadata.icon 支持图片地址与 lucide 图标名，缺省回退通用工具图标 */
function SkillIcon({ icon }: { icon?: string }) {
  if (isImageIcon(icon)) {
    return <img src={icon} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
  }
  const Icon = resolveLucideIcon(icon) || Wrench
  return <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
}

/** 横向滚动按钮：只在对应方向还存在未展示内容时渲染 */
function ScrollButton({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  const Icon = direction === -1 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === -1 ? '向左滚动' : '向右滚动'}
      className="shrink-0 p-1 rounded-full border border-border/50 bg-surface/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-all"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

/**
 * 单行横向滚动容器
 *
 * 内容统一贴左排列，与输入框左边缘对齐；
 * 溢出时左右按钮分别在列表两侧，只在该方向还有未展示内容时出现。
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
      {overflowing && !atStart && <ScrollButton direction={-1} onClick={() => step(-1)} />}
      <div ref={trackRef} onScroll={sync} className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
        <div className="flex w-max items-center gap-2 px-0.5 py-0.5">{children}</div>
      </div>
      {overflowing && !atEnd && <ScrollButton direction={1} onClick={() => step(1)} />}
    </div>
  )
}

export default function SkillSuggestionBar() {
  const language = useStore(s => s.language)
  const { currentSceneMode } = useSceneModeStore()
  const isZh = language === 'zh'

  const [skills, setSkills] = useState<SkillItem[]>([])
  const [openSkill, setOpenSkill] = useState<SkillItem | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      // 技能条只展示「启用 + 显示」的技能：被隐藏的技能仍可被 AI 调用，只是不出现在这里
      void skillService.getVisibleSkills()
        .then(list => { if (!cancelled) setSkills(list) })
        .catch(() => { if (!cancelled) setSkills([]) })
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

  // 排序方式（默认 / 按点击率）：在设置面板中切换，订阅后本组件实时跟随
  const sortMode = useSyncExternalStore(subscribeSkillSortMode, getSkillSortMode, getSkillSortMode)

  const orderedSkills = useMemo(
    () => sortSkills(skills, sortMode, currentSceneMode),
    [skills, sortMode, currentSceneMode],
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

  if (skills.length === 0) return null

  return (
    <div className="w-full mb-2">
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
          {orderedSkills.map(skill => (
            <button
              key={skill.name}
              type="button"
              onClick={() => handleSkillClick(skill)}
              title={skill.description}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-accent/20 bg-accent/5 text-text-secondary hover:text-text-primary hover:border-accent/50 hover:bg-accent/10 whitespace-nowrap shrink-0 transition-all duration-200"
            >
              <SkillIcon icon={skill.metadata?.icon} />
              <span>{getSkillLabel(skill)}</span>
            </button>
          ))}
        </ScrollRow>
      )}
    </div>
  )
}

