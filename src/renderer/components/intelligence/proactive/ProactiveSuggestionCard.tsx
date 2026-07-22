/**
 * 主动建议卡片组件（阶段10 s10-06 新增）
 *
 * 展示 ProactiveDecisionEngine 产出的 medium 级主动提案。
 * 与 PredictionBubble（被动行为预测）的区别：
 * - 位置：ChatPanel 顶部（PredictionBubble 在底部输入框附近）
 * - 触发：由决策引擎主动推送（PredictionBubble 由场景拉取）
 * - 交互：4 个反馈按钮（采纳/拒绝/稍后/详情），PredictionBubble 仅 3 个
 * - 堆叠：支持多个卡片同时展示（最多 3 条，FIFO 淘汰）
 *
 * 数据流：
 *   ProactiveActionTrigger (main)
 *     → webContents.send('proactive:proposal', proposal)
 *     → useProactiveSuggestions hook (renderer)
 *     → ProactiveSuggestionCard[] 渲染
 *     → 用户反馈 → electronAPI.proactive.recordFeedback()
 *
 * @module intelligence/proactive/ProactiveSuggestionCard
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  X,
  Clock,
  Info,
  AlertTriangle,
  AlertCircle,
  Zap,
  ChevronDown,
  ChevronUp,
  Bell,
  MessageSquare,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@toolkit/LogEngine'

// ============================================================
// 类型定义
// ============================================================

/** 主动提案来源场景 */
export type ProactiveSource = 'coding' | 'iot' | 'system' | 'time' | 'fusion'

/** 严重度（5 级，决定卡片视觉样式） */
export type ProactiveSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** 行动类型 */
export type ProactiveActionType = 'notify' | 'suggest' | 'chat' | 'execute'

/** 主动提案（与主进程 ProactiveInterface.ProactiveProposal 结构一致） */
export interface ProactiveProposal {
  id: string
  source: ProactiveSource
  trigger: string
  severity: ProactiveSeverity
  title: string
  description: string
  action: {
    type: ProactiveActionType
    payload: string
  }
  confidence: number
  reason: string
  signals: string[]
  dedupKey: string
  createdAt: number
}

/** 用户反馈类型 */
export type ProposalFeedback = 'accepted' | 'rejected' | 'later' | 'ignored'

interface Props {
  proposal: ProactiveProposal
  language: Language
  /** 反馈回调（卡片自行调用 IPC，同时通知父组件移除） */
  onDismiss: (proposalId: string) => void
  /** 采纳回调：父组件根据 action.type 触发对应行动（Agent.send 等） */
  onAccept: (proposal: ProactiveProposal) => void
}

// ============================================================
// 常量
// ============================================================

/** 自动消失时间（ms），hover 时暂停 */
const AUTO_DISMISS_MS = 30_000

/** severity → 视觉样式映射 */
const SEVERITY_STYLES: Record<
  ProactiveSeverity,
  {
    container: string
    iconBg: string
    iconColor: string
    badge: string
    icon: LucideIcon
  }
> = {
  info: {
    container: 'border-blue-500/30 bg-blue-500/10',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    badge: 'bg-blue-500/20 text-blue-300',
    icon: Info,
  },
  low: {
    container: 'border-cyan-500/30 bg-cyan-500/10',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-400',
    badge: 'bg-cyan-500/20 text-cyan-300',
    icon: Bell,
  },
  medium: {
    container: 'border-amber-500/30 bg-amber-500/10',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-300',
    icon: AlertTriangle,
  },
  high: {
    container: 'border-orange-500/30 bg-orange-500/10',
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-400',
    badge: 'bg-orange-500/20 text-orange-300',
    icon: AlertCircle,
  },
  critical: {
    container: 'border-red-500/40 bg-red-500/15',
    iconBg: 'bg-red-500/20',
    iconColor: 'text-red-400',
    badge: 'bg-red-500/25 text-red-300',
    icon: Zap,
  },
}

/** actionType → 图标映射 */
const ACTION_ICONS: Record<ProactiveActionType, LucideIcon> = {
  notify: Bell,
  suggest: AlertTriangle,
  chat: MessageSquare,
  execute: Terminal,
}

/** source → 显示标签 i18n key */
const SOURCE_LABEL_KEYS: Record<ProactiveSource, string> = {
  coding: 'proactive.card.source.coding',
  iot: 'proactive.card.source.iot',
  system: 'proactive.card.source.system',
  time: 'proactive.card.source.time',
  fusion: 'proactive.card.source.fusion',
}

// ============================================================
// 组件
// ============================================================

/**
 * 单个主动建议卡片
 *
 * 使用 memo 优化重渲染（proposal 不变时不重渲染）
 */
export const ProactiveSuggestionCard = memo(function ProactiveSuggestionCard({
  proposal,
  language,
  onDismiss,
  onAccept,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [paused, setPaused] = useState(false)
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remainingMsRef = useRef(AUTO_DISMISS_MS)
  const startTimestampRef = useRef<number>(0)

  const style = SEVERITY_STYLES[proposal.severity] ?? SEVERITY_STYLES.medium
  const ActionIcon = ACTION_ICONS[proposal.action.type] ?? Bell
  const SeverityIcon = style.icon
  const confidencePct = Math.round(proposal.confidence * 100)
  const sourceLabel = t(SOURCE_LABEL_KEYS[proposal.source], language)

  // ============================================================
  // 反馈提交
  // ============================================================

  const submitFeedback = useCallback(
    async (feedback: ProposalFeedback, actualAction?: string) => {
      if (submitting) return
      setSubmitting(true)

      // 立即隐藏卡片
      onDismiss(proposal.id)

      // 清除自动消失计时
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }

      try {
        const api = (window as Window & {
          electronAPI?: {
            proactive?: {
              recordFeedback?: (
                id: string,
                feedback: string,
                actualAction?: string,
              ) => Promise<unknown>
            }
          }
        }).electronAPI

        if (api?.proactive?.recordFeedback) {
          await api.proactive.recordFeedback(proposal.id, feedback, actualAction)
        }
      } catch (e) {
        logger.proactive?.warn('[ProactiveSuggestionCard] 反馈提交失败:', e)
      } finally {
        setSubmitting(false)
      }
    },
    [proposal.id, submitting, onDismiss],
  )

  // ============================================================
  // 采纳：触发 action（chat → 调用 Agent.send，execute → 执行命令）
  // ============================================================

  const handleAccept = useCallback(() => {
    // 记录实际动作（用于审计）
    const actualAction = `${proposal.action.type}:${proposal.action.payload.slice(0, 100)}`
    submitFeedback('accepted', actualAction)
    // 通知父组件触发对应行动
    onAccept(proposal)
  }, [proposal, submitFeedback, onAccept])

  // ============================================================
  // 自动消失计时（hover 暂停）
  // ============================================================

  const startTimer = useCallback(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current)
    }
    startTimestampRef.current = Date.now()
    autoDismissTimerRef.current = setTimeout(() => {
      submitFeedback('ignored')
    }, remainingMsRef.current)
  }, [submitFeedback])

  const pauseTimer = useCallback(() => {
    if (!autoDismissTimerRef.current) return
    clearTimeout(autoDismissTimerRef.current)
    autoDismissTimerRef.current = null
    // 记录剩余时间
    const elapsed = Date.now() - startTimestampRef.current
    remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed)
    setPaused(true)
  }, [])

  const resumeTimer = useCallback(() => {
    if (remainingMsRef.current <= 0) {
      submitFeedback('ignored')
      return
    }
    startTimer()
    setPaused(false)
  }, [startTimer, submitFeedback])

  useEffect(() => {
    startTimer()
    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }
    }
  }, [startTimer])

  // ============================================================
  // 渲染
  // ============================================================

  if (submitting) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.96 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={`mb-2 mx-0 p-3 rounded-xl border backdrop-blur-md ${style.container}`}
        role="region"
        aria-label={t('proactive.card.ariaLabel', language)}
        onMouseEnter={pauseTimer}
        onMouseLeave={resumeTimer}
      >
        <div className="flex items-start gap-2.5">
          {/* 严重度图标 */}
          <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${style.iconBg}`}>
            <SeverityIcon className={`w-4 h-4 ${style.iconColor}`} />
          </div>

          {/* 主内容 */}
          <div className="flex-1 min-w-0">
            {/* 标题行 */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-text-primary truncate flex-1">
                {proposal.title}
              </span>
              {/* severity 徽章 */}
              <span
                className={`text-[12px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${style.badge}`}
              >
                {t(`proactive.card.severity.${proposal.severity}`, language)}
              </span>
            </div>

            {/* 描述 */}
            <div className="text-[13px] text-text-secondary line-clamp-2 mb-1.5">
              {proposal.description}
            </div>

            {/* 元信息行 */}
            <div className="flex items-center gap-3 text-[12px] text-text-muted">
              <span className="flex items-center gap-1">
                <ActionIcon className="w-3 h-3" />
                {sourceLabel}
              </span>
              <span>{confidencePct}%</span>
              {paused && (
                <span className="text-amber-400">{t('proactive.card.paused', language)}</span>
              )}
            </div>

            {/* 展开详情 */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-2 pt-2 border-t border-border/50 overflow-hidden"
                >
                  {/* 理由 */}
                  {proposal.reason && (
                    <div className="mb-2">
                      <div className="text-[12px] text-text-muted mb-0.5">
                        {t('proactive.card.reason', language)}
                      </div>
                      <div className="text-[13px] text-text-secondary">{proposal.reason}</div>
                    </div>
                  )}

                  {/* 行动载荷 */}
                  <div className="mb-2">
                    <div className="text-[12px] text-text-muted mb-0.5">
                      {t('proactive.card.actionPayload', language)}
                    </div>
                    <div className="text-[13px] text-text-secondary font-mono bg-black/20 rounded p-1.5 break-all">
                      {proposal.action.payload}
                    </div>
                  </div>

                  {/* 信号标签 */}
                  {proposal.signals.length > 0 && (
                    <div>
                      <div className="text-[12px] text-text-muted mb-0.5">
                        {t('proactive.card.signals', language)}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {proposal.signals.map((sig, i) => (
                          <span
                            key={`${sig}-${i}`}
                            className="text-[12px] px-1.5 py-0.5 rounded bg-black/20 text-text-muted"
                          >
                            {sig}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* 操作按钮 */}
            <div className="flex items-center gap-1.5 mt-2">
              <ActionButton
                icon={<Check className="w-3.5 h-3.5" />}
                label={t('proactive.card.accept', language)}
                onClick={handleAccept}
                colorClass="bg-green-500/15 hover:bg-green-500/25 text-green-400 border border-green-500/30"
              />
              <ActionButton
                icon={<X className="w-3.5 h-3.5" />}
                label={t('proactive.card.reject', language)}
                onClick={() => submitFeedback('rejected')}
                colorClass="bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30"
              />
              <ActionButton
                icon={<Clock className="w-3.5 h-3.5" />}
                label={t('proactive.card.later', language)}
                onClick={() => submitFeedback('later')}
                colorClass="bg-text-muted/15 hover:bg-text-muted/25 text-text-muted border border-text-muted/30"
              />
              <ActionButton
                icon={
                  expanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )
                }
                label={t('proactive.card.details', language)}
                onClick={() => setExpanded((v) => !v)}
                colorClass="bg-transparent hover:bg-text-muted/15 text-text-muted"
              />
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
})

// ============================================================
// 子组件：操作按钮
// ============================================================

interface ActionButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  colorClass: string
}

function ActionButton({ icon, label, onClick, colorClass }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium transition-colors ${colorClass}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
