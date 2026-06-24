/**
 * 上下文压缩/续接快照卡片
 * 采用「领域配置 + 子组件组合」架构：
 *  - 领域配置层：将等级配色、文案、详情区块抽象为配置对象，便于扩展
 *  - 状态 Hook：封装展开状态与可见列表的派生计算
 *  - 子组件层：拆分时间线、卡片头、统计徽章、详情面板为独立单元
 */
import { memo, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ChevronDown, Layers3, ListTodo, MessageSquareQuote, Sparkles } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import type { ContextSnapshotPart } from '@intelligence/providerTypes'

interface CompressionDigestCardProps {
  part: ContextSnapshotPart
  variant?: 'card' | 'timeline'
}

/** 等级配色方案 */
interface LevelTheme {
  badge: string
  dot: string
  glow: string
}

/** 等级配色注册表，集中管理避免散落 */
const LEVEL_THEME_REGISTRY: Record<number, LevelTheme> = {
  0: { badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
  1: { badge: 'text-blue-300 bg-blue-500/10 border-blue-500/20', dot: 'bg-blue-400', glow: 'shadow-blue-500/10' },
  2: { badge: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20', dot: 'bg-yellow-400', glow: 'shadow-yellow-500/10' },
  3: { badge: 'text-orange-300 bg-orange-500/10 border-orange-500/20', dot: 'bg-orange-400', glow: 'shadow-orange-500/10' },
  4: { badge: 'text-red-300 bg-red-500/10 border-red-500/20', dot: 'bg-red-400', glow: 'shadow-red-500/10' },
}

/** 默认配色（等级越界时回退） */
const DEFAULT_THEME: LevelTheme = LEVEL_THEME_REGISTRY[3]

/** 获取等级配色 */
function resolveLevelTheme(level: number): LevelTheme {
  return LEVEL_THEME_REGISTRY[level] ?? DEFAULT_THEME
}

/** 文案集合 */
interface DigestCopy {
  title: string
  subtitle: string
  objective: string
  lastRequest: string
  pending: string
  tasks: string
  noObjective: string
  completedStat: string
  pendingStat: string
  taskStat: string
}

/** 构建多语言文案 */
function buildDigestCopy(language: Language, part: ContextSnapshotPart, activeTaskCount: number): DigestCopy {
  const lang = language as any
  const isHandoff = part.snapshotKind === 'handoff'
  return {
    title: isHandoff ? t('snapshot.handoffTitle', lang) : t('snapshot.compressionTitle', lang),
    subtitle: isHandoff ? t('snapshot.handoffSubtitle', lang) : t('snapshot.compressionSubtitle', lang),
    objective: t('snapshot.objective', lang),
    lastRequest: t('snapshot.lastRequest', lang),
    pending: t('snapshot.pendingSteps', lang),
    tasks: t('snapshot.taskList', lang),
    noObjective: t('snapshot.noObjective', lang),
    completedStat: t('snapshot.completedStat', lang, { count: part.summary.completedSteps.length }),
    pendingStat: t('snapshot.pendingStat', lang, { count: part.summary.pendingSteps.length }),
    taskStat: t('snapshot.taskStat', lang, { count: activeTaskCount }),
  }
}

/** 统计徽章配置项 */
interface StatBadgeConfig {
  icon: ReactNode
  text: string
}

/** 构建统计徽章列表 */
function buildStatBadges(copy: DigestCopy): StatBadgeConfig[] {
  return [
    { icon: <Sparkles className="h-3 w-3 text-accent/80" />, text: copy.completedStat },
    { icon: <Archive className="h-3 w-3 text-orange-300" />, text: copy.pendingStat },
    { icon: <ListTodo className="h-3 w-3 text-blue-300" />, text: copy.taskStat },
  ]
}

/** 展开图标，根据状态旋转 */
function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronDown className={`h-4 w-4 text-text-muted transition-transform ${expanded ? '' : '-rotate-90'}`} />
  )
}

/** 统计徽章组 */
function StatBadgeGroup({ badges }: { badges: StatBadgeConfig[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted/90">
      {badges.map((badge, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-text-primary/[0.04] px-2 py-0.5"
        >
          {badge.icon}
          {badge.text}
        </span>
      ))}
    </div>
  )
}

/** 详情区块通用容器 */
function DetailSection({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/25 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted/85">
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}

/** 折叠动画容器 */
function CollapsiblePanel({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 时间线变体 */
function DigestTimeline({
  part,
  copy,
  tone,
  expanded,
  onToggle,
  language,
}: {
  part: ContextSnapshotPart
  copy: DigestCopy
  tone: LevelTheme
  expanded: boolean
  onToggle: () => void
  language: Language
}) {
  const title = t('snapshot.compressedTitle', language as any)
  const detailLabel = expanded
    ? t('snapshot.hideDetails', language as any)
    : t('snapshot.viewDetails', language as any)

  return (
    <div className="my-4 w-full">
      <button
        onClick={onToggle}
        className="group flex w-full items-center gap-3 text-left text-text-muted transition-colors hover:text-text-secondary"
      >
        <div className="h-px flex-1 bg-border/50 transition-colors group-hover:bg-border" />
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-border/50 bg-surface px-3 py-1.5 text-[12px] shadow-sm">
          <div className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          <span className="truncate font-medium text-text-secondary">{title}</span>
          <span className="shrink-0 text-text-muted/85">· {detailLabel}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </div>
        <div className="h-px flex-1 bg-border/50 transition-colors group-hover:bg-border" />
      </button>

      <CollapsiblePanel expanded={expanded}>
        <div className="mx-8 mt-3 space-y-2 rounded-xl border border-border/40 bg-surface/25 px-3 py-3 text-[12px] text-text-secondary">
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-text-muted/85">{copy.objective}</div>
            <div className="leading-relaxed">{part.summary.objective || copy.noObjective}</div>
          </div>

          {part.lastUserRequest && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-text-muted/85">{copy.lastRequest}</div>
              <div className="leading-relaxed">{part.lastUserRequest}</div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 text-[11px] text-text-muted/90">
            <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.completedStat}</span>
            <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.pendingStat}</span>
            <span className="rounded-full bg-text-primary/[0.04] px-2 py-0.5">{copy.taskStat}</span>
          </div>
        </div>
      </CollapsiblePanel>
    </div>
  )
}

/** 卡片变体 */
function DigestCard({
  part,
  copy,
  tone,
  expanded,
  onToggle,
  visiblePending,
  visibleTodos,
}: {
  part: ContextSnapshotPart
  copy: DigestCopy
  tone: LevelTheme
  expanded: boolean
  onToggle: () => void
  visiblePending: string[]
  visibleTodos: NonNullable<ContextSnapshotPart['summary']['todos']>
}) {
  const note = part.note || copy.subtitle
  const badges = buildStatBadges(copy)

  return (
    <div
      className={`my-3 overflow-hidden rounded-2xl border border-border/50 bg-surface shadow-[0_10px_30px_-18px_rgba(0,0,0,0.45)] transition-all ${tone.glow}`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-text-primary/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className="text-[12px] font-semibold tracking-wide text-text-primary">{copy.title}</span>
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${tone.badge}`}
            >
              L{part.level}
            </span>
          </div>

          <div className="text-[12px] leading-relaxed text-text-muted">{note}</div>

          <StatBadgeGroup badges={badges} />
        </div>

        <ExpandChevron expanded={expanded} />
      </button>

      <CollapsiblePanel expanded={expanded}>
        <div className="space-y-3 px-4 pb-4">
          {part.lastUserRequest && (
            <DetailSection icon={<MessageSquareQuote className="h-3 w-3" />} label={copy.lastRequest}>
              <div className="text-[12px] leading-relaxed text-text-secondary">{part.lastUserRequest}</div>
            </DetailSection>
          )}

          <DetailSection icon={<Layers3 className="h-3 w-3" />} label={copy.objective}>
            <div className="text-[12px] leading-relaxed text-text-primary/90">
              {part.summary.objective || copy.noObjective}
            </div>
          </DetailSection>

          {visiblePending.length > 0 && (
            <DetailSection icon={<ListTodo className="h-3 w-3" />} label={copy.pending}>
              <div className="space-y-1.5">
                {visiblePending.map((step, index) => (
                  <div
                    key={`${part.id}-pending-${index}`}
                    className="text-[12px] leading-relaxed text-text-secondary"
                  >
                    {index + 1}. {step}
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {visibleTodos.length > 0 && (
            <DetailSection icon={<ListTodo className="h-3 w-3" />} label={copy.tasks}>
              <div className="space-y-1.5">
                {visibleTodos.map((todo, index) => (
                  <div
                    key={`${part.id}-todo-${index}`}
                    className="flex items-start gap-2 text-[12px] leading-relaxed text-text-secondary"
                  >
                    <span
                      className={`mt-[4px] h-1.5 w-1.5 rounded-full ${
                        todo.status === 'in_progress' ? 'bg-accent animate-pulse' : 'bg-text-muted/40'
                      }`}
                    />
                    <span>{todo.status === 'in_progress' ? todo.activeForm : todo.content}</span>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
        </div>
      </CollapsiblePanel>
    </div>
  )
}

export const CompressionDigestCard = memo(({ part, variant = 'card' }: CompressionDigestCardProps) => {
  const language = useStore((state) => state.language || 'zh')
  const expandToolCallsByDefault = useStore(
    (state) => state.agentConfig.expandToolCallsByDefault ?? false,
  )
  const [expanded, setExpanded] = useState(expandToolCallsByDefault && variant === 'card')

  const activeTodos = useMemo(() => {
    const todos = part.summary.todos || []
    return todos.filter((todo) => todo.status !== 'completed')
  }, [part.summary.todos])

  const tone = resolveLevelTheme(part.level)
  const copy = buildDigestCopy(language, part, activeTodos.length)

  const visiblePending = useMemo(() => (part.summary.pendingSteps || []).slice(0, 5), [part.summary.pendingSteps])
  const visibleTodos = useMemo(() => activeTodos.slice(0, 5), [activeTodos])

  const toggle = () => setExpanded((v) => !v)

  if (variant === 'timeline') {
    return (
      <DigestTimeline
        part={part}
        copy={copy}
        tone={tone}
        expanded={expanded}
        onToggle={toggle}
        language={language}
      />
    )
  }

  return (
    <DigestCard
      part={part}
      copy={copy}
      tone={tone}
      expanded={expanded}
      onToggle={toggle}
      visiblePending={visiblePending}
      visibleTodos={visibleTodos}
    />
  )
})

CompressionDigestCard.displayName = 'CompressionDigestCard'
