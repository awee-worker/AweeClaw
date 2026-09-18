/**
 * 流式阶段指示器
 * 在等待响应或流式输出时显示当前状态（连接中、等待模型响应、思考中、工具执行中等）
 */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore } from '@store'
import { playNotificationSound } from '@utils/notificationSound'
import { t } from '@renderer/i18n'
import type { StreamingPhaseProps } from '../types'

/**
 * 等待转圈：等待提示必须无条件可见。
 *
 * 之前用呼吸点 + 小圆点表示「正在等待」，两者的可见度都来自 CSS 动画的关键帧
 * （opacity 0.3~1）。渲染预算服务在实测掉帧时会把它们置为 `animation: none`，
 * 系统开启「减弱动态效果」时同理；动画一旦停住，2px 的半透明小点就退成静态
 * 像素，长等待时界面看起来像卡死。spinner 不在收敛名单里，是唯一在各状态下
 * 都保持转动的信号，因此等待态统一由它承载。
 */
const SLOW_RESPONSE_SECONDS = 12

function StreamingPhaseIndicatorBase({
  mode,
  waitPhase,
  streamStartTime,
  streamDetail,
  retryAttempt,
  retryDelay,
  hasReasoningBlock,
}: StreamingPhaseProps) {
  const language = useStore(s => s.language)
  const [elapsed, setElapsed] = useState(0)
  const [retryCountdown, setRetryCountdown] = useState(0)

  /** 流式计时 */
  useEffect(() => {
    if (!streamStartTime) return
    const update = () => setElapsed(Math.floor((Date.now() - streamStartTime) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [streamStartTime])

  /** 重试倒计时 */
  useEffect(() => {
    if (!retryDelay || !retryAttempt || retryAttempt <= 0) {
      setRetryCountdown(0)
      return
    }
    const endTime = Date.now() + retryDelay
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000))
      setRetryCountdown(remaining)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [retryDelay, retryAttempt])

  const isRetrying = retryAttempt && retryAttempt > 0
  const prevRetryAttemptRef = useRef(0)

  /** 重试时播放提示音 */
  useEffect(() => {
    if (retryAttempt && retryAttempt > prevRetryAttemptRef.current) {
      playNotificationSound('attention')
    }
    prevRetryAttemptRef.current = retryAttempt ?? 0
  }, [retryAttempt])

  /** 生成状态文案 */
  const computedLabel = useMemo(() => {
    if (isRetrying) {
      const base = t('waitPhase.retrying', language as any, { attempt: retryAttempt })
      return retryCountdown > 0 ? `${base} ${retryCountdown}s` : base
    }
    if (mode === 'waiting') {
      switch (waitPhase) {
        case 'connecting': return t('waitPhase.connecting', language as any)
        case 'building_context': return t('waitPhase.building_context', language as any)
        case 'compressing': return t('waitPhase.compressing', language as any)
        case 'waiting_model': return t('waitPhase.waiting_model', language as any)
        // waitPhase 为 idle/undefined 时请求已经在路上，只是首包还没到，
        // 属于「等待模型响应」而非模型正在推理 —— 不能用「思考中」描述。
        default: return t('waitPhase.waiting_model', language as any)
      }
    }
    switch (streamDetail) {
      case 'reasoning': return hasReasoningBlock ? null : t('statusBar.thinking', language as any)
      case 'tool_executing': return t('statusBar.processing', language as any)
      case 'tool_awaiting': return t('statusBar.processing', language as any)
      default: return null
    }
  }, [mode, waitPhase, streamDetail, language, retryAttempt, isRetrying, hasReasoningBlock, retryCountdown])

  // 缓存上一个有效 label，避免 streamDetail 在 tool_executing/undefined 之间短暂切换
  // 导致组件反复挂载/卸载（"处理中..."显示容器跳动）
  // 仅当 computedLabel 为 null（无明确状态）且非重试/等待模式时，保留上一个有效 label
  // 但当 AI 正在输出文本（streamDetail === 'responding'）时，必须清除缓存，
  // 否则"处理中..."会一直显示在 AI 回复期间，体验不佳
  const lastValidLabelRef = useRef<string | null>(null)
  if (computedLabel) {
    lastValidLabelRef.current = computedLabel
  } else if (mode !== 'waiting' && !isRetrying) {
    // inline 模式下，流式仍在进行但 streamDetail 暂时为 undefined（工具执行间隙）
    // 此时不清除缓存，保持上一个状态显示，避免组件卸载跳动
    // 但 responding 状态表示 AI 正在输出文本内容，工具执行阶段已结束，应清除缓存
    if (streamDetail === 'responding') {
      lastValidLabelRef.current = null
    }
  } else {
    lastValidLabelRef.current = null
  }
  const label = computedLabel ?? (mode !== 'waiting' && !isRetrying ? lastValidLabelRef.current : null)

  if (!label) return null

  const elapsedText = elapsed > 0
    ? ` ${t('waitPhase.elapsed', language as any, { sec: elapsed })}`
    : ''

  if (mode === 'waiting') {
    const isSlowResponse = !isRetrying && elapsed >= SLOW_RESPONSE_SECONDS
    return (
      <div
        className={`inline-flex items-start gap-2.5 py-2.5 pl-2.5 pr-3.5 rounded-xl border ${
          isRetrying ? 'border-amber-500/30 bg-amber-500/[0.06]' : 'border-border/50 bg-surface/50'
        }`}
      >
        <Loader2
          aria-hidden="true"
          className={`w-3.5 h-3.5 mt-[3px] shrink-0 animate-spin ${isRetrying ? 'text-amber-400/90' : 'text-accent/80'}`}
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={`text-[12.5px] font-medium leading-tight ${isRetrying ? 'text-amber-400/90' : 'text-text-secondary'}`}>
            {label}{elapsedText}
          </span>
          {isSlowResponse && (
            <span className="text-[11px] leading-tight text-text-muted/80">
              {t('waitPhase.slow', language as any)}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-surface/60 border border-border/50">
      <span className={`w-1.5 h-1.5 rounded-full ${isRetrying ? 'bg-amber-400' : 'bg-accent/70'} animate-breathe`} />
      <span className={`text-[11px] font-medium ${isRetrying ? 'text-amber-400/80' : 'text-text-muted/70'}`}>
        {label}
      </span>
    </div>
  )
}

export const StreamingPhaseIndicator = React.memo(StreamingPhaseIndicatorBase)
StreamingPhaseIndicator.displayName = 'StreamingPhaseIndicator'
