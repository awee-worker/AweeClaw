/**
 * 踩反馈弹层
 *
 * 当用户对助手回复点击"踩"时弹出，收集可选的反馈说明：
 * - 用户可填写不满意的原因（如：回答不相关、信息有误、格式差等）
 * - 提交后将反馈持久化到会话数据库（供后续模型改进/数据分析使用）
 * - 提供"重新生成"快捷入口，提交反馈后立即触发重新生成
 *
 * 设计原则：
 * - 评论为可选项，降低反馈门槛
 * - 弹层定位在触发按钮上方，点击外部/滚动时自动关闭
 * - 复用 MessagePopover 的定位与关闭逻辑风格
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, RefreshCw, Send } from 'lucide-react'
import type { Language } from '@renderer/i18n'

interface DislikeFeedbackPopoverProps {
  /** 触发器（踩按钮） */
  trigger: React.ReactNode
  /** 当前已保存的反馈评论（用于回填） */
  initialComment?: string
  /** 语言 */
  language: Language
  /** 提交反馈（评论可为空） */
  onSubmit: (comment: string) => void
  /** 取消反馈（再次点击踩时调用，清除反馈状态） */
  onCancel: () => void
  /** 提交反馈并触发重新生成 */
  onRegenerate: (comment: string) => void
}

/** 预设的快速反馈原因，点击即填入 */
const QUICK_REASONS_ZH = ['回答不相关', '信息有误', '格式混乱', '太啰嗦', '没有解决问题']
const QUICK_REASONS_EN = ['Irrelevant', 'Incorrect info', 'Poor formatting', 'Too verbose', "Didn't solve"]

function DislikeFeedbackPopoverBase({
  trigger,
  initialComment = '',
  language,
  onSubmit,
  onCancel,
  onRegenerate,
}: DislikeFeedbackPopoverProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [comment, setComment] = useState(initialComment)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isZh = language === 'zh'
  const quickReasons = isZh ? QUICK_REASONS_ZH : QUICK_REASONS_EN

  const titleLabel = isZh ? '反馈说明' : 'Feedback'
  const placeholder = isZh ? '告诉 AI 哪里做得不好（可选）' : 'Tell AI what was wrong (optional)'
  const submitLabel = isZh ? '提交' : 'Submit'
  const regenerateLabel = isZh ? '重新生成' : 'Regenerate'
  const quickLabel = isZh ? '快速选择：' : 'Quick pick:'

  /** 计算弹层定位：触发器上方，右对齐 */
  const computePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({
      top: rect.top - 8,
      right: window.innerWidth - rect.right,
    })
  }, [])

  /** 切换弹层 */
  const handleToggle = useCallback(() => {
    setOpen(prev => {
      if (!prev) {
        // 打开前重置评论为初始值
        setComment(initialComment)
        computePos()
      }
      return !prev
    })
  }, [initialComment, computePos])

  /** 点击外部关闭 */
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  /** 滚动时关闭 */
  useEffect(() => {
    if (!open) return
    const handleScroll = () => setOpen(false)
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('scroll', handleScroll, opts)
    return () => window.removeEventListener('scroll', handleScroll, opts)
  }, [open])

  /** 提交反馈 */
  const handleSubmit = useCallback(() => {
    onSubmit(comment.trim())
    setOpen(false)
  }, [comment, onSubmit])

  /** 提交反馈并重新生成 */
  const handleRegenerate = useCallback(() => {
    onRegenerate(comment.trim())
    setOpen(false)
  }, [comment, onRegenerate])

  /** 快速选择原因 */
  const handleQuickPick = useCallback((reason: string) => {
    setComment(prev => (prev ? `${prev}；${reason}` : reason))
  }, [])

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center"
        onClick={(e) => {
          e.stopPropagation()
          handleToggle()
        }}
      >
        {trigger}
      </span>

      <AnimatePresence>
        {open && pos && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              width: 320,
              zIndex: 9999,
              transform: 'translateY(-100%)',
            }}
            className="bg-surface border border-border/60 rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
              <span className="text-xs font-medium text-text-primary">{titleLabel}</span>
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="p-3 space-y-2.5">
              {/* 快速选择 */}
              <div>
                <div className="text-[11px] text-text-muted mb-1.5">{quickLabel}</div>
                <div className="flex flex-wrap gap-1.5">
                  {quickReasons.map(reason => (
                    <button
                      key={reason}
                      onClick={() => handleQuickPick(reason)}
                      className="px-2 py-0.5 text-[11px] rounded-full bg-surface-hover text-text-secondary hover:bg-accent/15 hover:text-accent transition-colors"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </div>

              {/* 评论输入框 */}
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={placeholder}
                rows={3}
                autoFocus
                className="w-full px-2.5 py-1.5 text-xs text-text-primary bg-surface-hover/50 border border-border/40 rounded-md resize-none focus:outline-none focus:border-accent/50 focus:bg-surface placeholder:text-text-muted/60 custom-scrollbar"
              />

              {/* 操作按钮 */}
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <button
                  onClick={onCancel}
                  className="px-2 py-1 text-[11px] text-text-muted hover:text-red-400 transition-colors"
                >
                  {isZh ? '取消反馈' : 'Cancel feedback'}
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleSubmit}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-primary bg-surface-hover hover:bg-surface-active rounded-md transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {submitLabel}
                  </button>
                  <button
                    onClick={handleRegenerate}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-accent hover:bg-accent/90 rounded-md transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {regenerateLabel}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export const DislikeFeedbackPopover = React.memo(DislikeFeedbackPopoverBase)
DislikeFeedbackPopover.displayName = 'DislikeFeedbackPopover'
