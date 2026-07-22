/**
 * 预测建议气泡组件
 *
 * 非打扰式展示行为预测结果，提供接受/拒绝/忽略反馈按钮。
 *
 * 设计原则：
 * - 非阻塞：不抢焦点、不打断用户当前操作
 * - 自动消失：30 秒无操作自动忽略
 * - 单条展示：仅显示 Top-1 预测，避免信息过载
 * - 静默失败：感知未启用或无数据时直接返回 null
 *
 * @module chatPanel/components/PredictionBubble
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Eye, Sparkles } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@toolkit/LogEngine'

// ============================================================
// 类型定义
// ============================================================

interface PredictionResult {
  id: string
  predictedAction: {
    type: string
    target: string
  }
  confidence: number
  reason: string
  modelVersion?: string
}

interface Props {
  language: Language
  /** 当前场景上下文（用于触发预测） */
  sceneContext?: {
    app?: string
    activity?: string
    text?: string
    openFiles?: string[]
  }
  /** 是否启用预测（默认根据 perception 配置自动判断） */
  enabled?: boolean
}

// ============================================================
// 常量
// ============================================================

/** 自动忽略超时（ms） */
const AUTO_DISMISS_MS = 30_000

/** 预测请求最小间隔（ms），避免频繁打扰 */
const MIN_INTERVAL_MS = 60_000

/** 最低置信度阈值 */
const MIN_CONFIDENCE = 0.4

/** 已忽略的预测 ID 缓存（防止重复展示） */
const dismissedIds = new Set<string>()

// ============================================================
// 组件
// ============================================================

export function PredictionBubble({ language, sceneContext, enabled = true }: Props) {
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const lastFetchAtRef = useRef(0)
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ============================================================
  // 预测请求
  // ============================================================

  const fetchPrediction = useCallback(async () => {
    if (!enabled) return
    if (!sceneContext?.app || !sceneContext?.text) return

    // 限频：60 秒内只请求一次
    const now = Date.now()
    if (now - lastFetchAtRef.current < MIN_INTERVAL_MS) return
    lastFetchAtRef.current = now

    try {
      const api = (window as Window & { electronAPI?: { perception?: { predictAction?: (req: unknown) => Promise<unknown> } } }).electronAPI
      if (!api?.perception?.predictAction) return

      const res = await api.perception.predictAction({
        sceneText: sceneContext.text,
        app: sceneContext.app,
        activity: sceneContext.activity ?? 'unknown',
        openFiles: sceneContext.openFiles,
        topK: 1,
        confidenceThreshold: MIN_CONFIDENCE,
      }) as { success?: boolean; predictions?: PredictionResult[]; error?: string }

      if (!res?.success) return

      const top = res.predictions?.[0]
      if (!top) return

      // 跳过已忽略的预测
      if (dismissedIds.has(top.id)) return

      setPrediction(top)
    } catch (e) {
      logger.perception?.warn('[PredictionBubble] 预测请求失败:', e)
    }
  }, [enabled, sceneContext?.app, sceneContext?.activity, sceneContext?.text, sceneContext?.openFiles])

  // ============================================================
  // 反馈提交
  // ============================================================

  const submitFeedback = useCallback(
    async (feedback: 'accepted' | 'rejected' | 'ignored') => {
      if (!prediction) return

      // 标记为已处理，避免重复展示
      dismissedIds.add(prediction.id)
      setSubmitting(true)

      // 立即隐藏气泡
      setPrediction(null)
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }

      try {
        const api = (window as Window & { electronAPI?: { perception?: { submitFeedback?: (id: string, f: string, a?: unknown) => Promise<unknown> } } }).electronAPI
        if (api?.perception?.submitFeedback) {
          await api.perception.submitFeedback(prediction.id, feedback)
        }
      } catch (e) {
        logger.perception?.warn('[PredictionBubble] 反馈提交失败:', e)
      } finally {
        setSubmitting(false)
      }
    },
    [prediction],
  )

  // ============================================================
  // 自动忽略计时
  // ============================================================

  useEffect(() => {
    if (!prediction) return

    autoDismissTimerRef.current = setTimeout(() => {
      submitFeedback('ignored')
    }, AUTO_DISMISS_MS)

    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current)
        autoDismissTimerRef.current = null
      }
    }
  }, [prediction, submitFeedback])

  // ============================================================
  // 定时拉取预测
  // ============================================================

  useEffect(() => {
    if (!enabled) return

    // 首次延迟 5 秒，避免应用启动时的拥挤
    const initialTimer = setTimeout(fetchPrediction, 5_000)

    // 之后每 2 分钟拉取一次
    const intervalTimer = setInterval(fetchPrediction, 120_000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalTimer)
    }
  }, [enabled, fetchPrediction])

  // ============================================================
  // 渲染
  // ============================================================

  if (!prediction || submitting) return null

  const confidencePct = Math.round(prediction.confidence * 100)
  const actionLabel = formatActionLabel(prediction.predictedAction, language)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.95 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="mb-2 mx-0 p-3 rounded-xl border border-violet-500/30 bg-violet-500/10 backdrop-blur-md"
        role="region"
        aria-label={t('perception.bubble.ariaLabel', language)}
      >
        <div className="flex items-start gap-2.5">
          {/* 图标 */}
          <div className="p-1.5 bg-violet-500/15 rounded-lg shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          </div>

          {/* 主内容 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] font-medium text-violet-400">
                {t('perception.bubble.title', language)}
              </span>
              <span className="text-[12px] text-text-muted">
                {confidencePct}%
              </span>
            </div>
            <div className="text-sm text-text-primary truncate">
              {actionLabel}
            </div>
            {prediction.reason && (
              <div className="text-[12px] text-text-muted mt-0.5 line-clamp-1">
                {prediction.reason}
              </div>
            )}
          </div>

          {/* 反馈按钮 */}
          <div className="flex items-center gap-1 shrink-0">
            <FeedbackButton
              icon={<Check className="w-3.5 h-3.5" />}
              tooltip={t('perception.bubble.accept', language)}
              onClick={() => submitFeedback('accepted')}
              colorClass="hover:bg-green-500/20 text-green-400"
            />
            <FeedbackButton
              icon={<X className="w-3.5 h-3.5" />}
              tooltip={t('perception.bubble.reject', language)}
              onClick={() => submitFeedback('rejected')}
              colorClass="hover:bg-red-500/20 text-red-400"
            />
            <FeedbackButton
              icon={<Eye className="w-3.5 h-3.5" />}
              tooltip={t('perception.bubble.ignore', language)}
              onClick={() => submitFeedback('ignored')}
              colorClass="hover:bg-text-muted/20 text-text-muted"
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// ============================================================
// 子组件：反馈按钮
// ============================================================

interface FeedbackButtonProps {
  icon: React.ReactNode
  tooltip: string
  onClick: () => void
  colorClass: string
}

function FeedbackButton({ icon, tooltip, onClick, colorClass }: FeedbackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className={`p-1.5 rounded-lg transition-colors ${colorClass}`}
    >
      {icon}
    </button>
  )
}

// ============================================================
// 辅助函数
// ============================================================

/** 格式化动作标签 */
function formatActionLabel(
  action: { type: string; target: string },
  language: Language,
): string {
  if (!action) return ''
  const typeKey = `perception.bubble.actionType.${action.type}`
  const typeLabel = t(typeKey, language)
  const typeText = typeKey === typeLabel ? action.type : typeLabel

  if (!action.target) return typeText

  // target 过长时截断
  const target = action.target.length > 60
    ? action.target.slice(0, 60) + '...'
    : action.target

  return `${typeText} → ${target}`
}
