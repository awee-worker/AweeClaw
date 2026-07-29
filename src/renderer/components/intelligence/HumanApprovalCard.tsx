/**
 * HumanApprovalCard —— 人工审批卡片（Graph Runtime 阶段四 HITL）
 *
 * 场景：图执行命中 human 节点时，session 进入 awaiting_approval 状态，
 *       本卡片展示节点信息并提供通过/拒绝操作，调用 resumeHumanNode 恢复执行。
 *
 * 设计规范（对齐项目 UI 约束）：
 * - 视觉风格对齐 MemoryApprovalCard（圆角卡片 + 渐变头部 + 底部状态条）
 * - 头部使用 AlertTriangle 警告图标（非空心圆圈，符合确认框规范）
 * - 呼吸动画周期 2 秒，循环播放，突出等待审批状态
 * - 字体不小于 12px
 * - 通过按钮（绿色）/ 拒绝按钮（红色），拒绝可展开反馈输入
 * - 恢复中禁用按钮，显示 loading 状态防重复点击
 *
 * @module intelligence/HumanApprovalCard
 */
import React, { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Check, X, Loader2, MessageSquare, ChevronDown } from 'lucide-react'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { t } from '@renderer/i18n'
import type { Language } from '@renderer/i18n'
import type { HumanApprovalInfo } from './chatPanel/useHumanApprovalWatcher'

interface HumanApprovalCardProps {
  /** 待审批节点信息（planId + nodeId） */
  info: HumanApprovalInfo
  /**
   * 恢复执行回调
   * @returns 是否成功提交（失败时卡片回滚到可操作状态允许重试）
   */
  onResume: (approved: boolean, feedback?: string) => Promise<boolean>
  /** 恢复中状态（禁用按钮） */
  isResuming: boolean
}

/**
 * 人工审批卡片
 *
 * 用法：
 * ```tsx
 * {awaitingApproval && (
 *   <HumanApprovalCard
 *     info={awaitingApproval}
 *     onResume={resume}
 *     isResuming={isResuming}
 *   />
 * )}
 * ```
 */
export const HumanApprovalCard: React.FC<HumanApprovalCardProps> = ({
  info,
  onResume,
  isResuming,
}) => {
  const language = useStore(s => s.language) as Language
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [lastAction, setLastAction] = useState<'approved' | 'rejected' | null>(null)

  // 从 plan store 查询节点详情（标题、描述）
  const nodeInfo = useMemo(() => {
    const plan = useAgentStore.getState().getPlan(info.planId)
    if (!plan) return { title: info.nodeId, description: '' }
    const task = plan.tasks.find(t => t.id === info.nodeId)
    return {
      title: task?.title || info.nodeId,
      description: task?.description || '',
    }
  }, [info.planId, info.nodeId])

  /** 通过审批：乐观设为已通过，失败时回滚允许重试 */
  const handleApprove = useCallback(() => {
    if (isResuming) return
    setLastAction('approved')
    void onResume(true).then(ok => {
      if (!ok) setLastAction(null)
    })
  }, [isResuming, onResume])

  /** 拒绝审批：首次点击展开反馈输入，再次点击提交拒绝（附 feedback），失败时回滚 */
  const handleReject = useCallback(() => {
    if (isResuming) return
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    setLastAction('rejected')
    void onResume(false, feedback.trim() || undefined).then(ok => {
      if (!ok) setLastAction(null)
    })
  }, [isResuming, showFeedback, feedback, onResume])

  // 已决议后展示终态（短暂保留后由事件清理）
  const isResolved = lastAction !== null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="relative my-2 overflow-hidden rounded-2xl border border-amber-500/30 bg-background-tertiary shadow-2xl shadow-amber-500/10"
    >
      {/* 头部：警告图标 + 标题 + 描述（呼吸动画 2 秒周期） */}
      <div className="flex items-start gap-3 px-4 py-3 bg-gradient-to-r from-amber-500/15 to-transparent border-b border-amber-500/20">
        <motion.div
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="relative shrink-0 mt-0.5"
        >
          <div className="absolute inset-0 bg-amber-500/40 rounded-full blur-md" />
          <div className="relative w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/50">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
        </motion.div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-bold text-text-primary flex items-center gap-1.5 tracking-tight">
            {t('hitl.title', language)}
          </h4>
          <p className="text-[12px] text-text-muted font-medium opacity-80 mt-0.5">
            {isResolved
              ? lastAction === 'approved'
                ? t('hitl.approved', language)
                : t('hitl.rejected', language)
              : t('hitl.desc', language)}
          </p>
        </div>
        {isResuming && (
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />
        )}
      </div>

      {/* 节点信息 */}
      <div className="p-4 relative">
        <div className="flex items-start gap-3">
          <div className="mt-1 p-1 rounded-md bg-amber-500/10 border border-amber-500/20 shrink-0">
            <MessageSquare className="w-3 h-3 text-amber-500/70" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-text-muted font-medium mb-1">
              {t('hitl.nodeLabel', language)}
            </div>
            <p className="text-sm text-text-primary font-medium leading-relaxed break-words">
              {nodeInfo.title}
            </p>
            {nodeInfo.description && (
              <p className="text-[12px] text-text-secondary leading-relaxed mt-1 break-words">
                {nodeInfo.description}
              </p>
            )}
          </div>
        </div>

        {/* 反馈输入区（拒绝时展开） */}
        <AnimatePresence>
          {showFeedback && !isResolved && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pl-7">
                <label className="text-[12px] text-text-muted font-medium block mb-1.5">
                  {t('hitl.feedback', language)}
                </label>
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  className="w-full h-20 p-2.5 bg-black/30 rounded-lg border border-amber-500/30 text-[12px] text-text-primary focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 outline-none transition-all resize-none font-sans leading-relaxed"
                  autoFocus
                  placeholder={t('hitl.feedbackPlaceholder', language)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 操作按钮 */}
        {!isResolved && (
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={handleReject}
              disabled={isResuming}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold text-red-500 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResuming && lastAction === 'rejected' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : showFeedback ? (
                <Check className="w-3 h-3" />
              ) : (
                <X className="w-3 h-3" />
              )}
              {showFeedback
                ? t('hitl.submitFeedback', language)
                : t('hitl.reject', language)}
            </button>
            <button
              onClick={handleApprove}
              disabled={isResuming}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold bg-green-500 text-white rounded-lg shadow-lg shadow-green-500/20 hover:bg-green-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResuming && lastAction === 'approved' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              {t('hitl.approve', language)}
            </button>
          </div>
        )}

        {/* 拒绝时展开反馈的提示行（未展开时显示） */}
        {!showFeedback && !isResolved && (
          <button
            onClick={() => setShowFeedback(true)}
            className="mt-2 flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
            {t('hitl.feedback', language)}
          </button>
        )}
      </div>

      {/* 底部状态条 */}
      <div
        className={`h-1 w-full bg-gradient-to-r ${
          isResolved
            ? lastAction === 'approved'
              ? 'from-green-500/50 to-green-500/10'
              : 'from-red-500/50 to-red-500/10'
            : 'from-amber-500/50 to-amber-500/10'
        } opacity-50`}
      />
    </motion.div>
  )
}
