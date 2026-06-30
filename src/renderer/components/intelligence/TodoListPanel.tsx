import { useState, memo, useEffect, useRef, useCallback } from 'react'
import { Check, Circle, ChevronDown, X, Pause, Loader2, ShieldCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TodoItem } from '@intelligence/providerTypes'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { playCompletionSound } from '@renderer/utils/sound'

interface TodoListPanelProps {
  todos: TodoItem[]
  isStreaming?: boolean
  /**
   * 嵌入式模式：嵌入到助手消息内容流中。
   * - 禁用"全部完成后自动隐藏"逻辑（历史任务列表需保持可见）
   * - 隐藏"清除"按钮（嵌入模式不操作线程级 todos）
   */
  embedded?: boolean
}

const MiniProgress = memo(({ percent, stopped, allCompleted }: { percent: number; stopped?: boolean; allCompleted?: boolean }) => {
  const r = 8
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c

  return (
    <div className="relative w-5 h-5 flex-shrink-0">
      <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-border/60" />
        <motion.circle
          cx="10" cy="10" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={stopped ? 'text-orange-400' : allCompleted ? 'text-green-400' : 'text-accent'}
          style={{ stroke: 'currentColor' }}
        />
      </svg>
      {percent === 100 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Check className="w-2.5 h-2.5 text-green-400" />
        </div>
      )}
    </div>
  )
})
MiniProgress.displayName = 'MiniProgress'

const StatusDot = memo(({ status, stopped }: { status: TodoItem['status']; stopped?: boolean }) => {
  if (stopped && (status === 'in_progress' || status === 'verifying')) {
    return <Pause className="w-3 h-3 text-orange-400 flex-shrink-0" />
  }
  switch (status) {
    case 'completed':
      return (
        <div className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
          <Check className="w-2.5 h-2.5 text-green-400" strokeWidth={3} />
        </div>
      )
    case 'verifying':
      // 验证门状态：盾牌+检查图标，脉冲动画表示正在验证
      return (
        <div className="w-4 h-4 rounded-full bg-status-warning/15 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-2.5 h-2.5 text-status-warning animate-pulse" />
        </div>
      )
    case 'in_progress':
      return (
        <div className="w-4 h-4 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Loader2 className="w-2.5 h-2.5 text-accent animate-spin" />
        </div>
      )
    case 'pending':
      return (
        <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0">
          <Circle className="w-3 h-3 text-text-muted/40" strokeWidth={1.5} />
        </div>
      )
  }
})
StatusDot.displayName = 'StatusDot'

const TodoRow = memo(({ todo, index, stopped }: { todo: TodoItem; index: number; stopped?: boolean }) => {
  const isCompleted = todo.status === 'completed'
  const isActive = todo.status === 'in_progress'
  const isVerifying = todo.status === 'verifying'

  return (
    <motion.div
      data-todo-status={todo.status}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors
        ${isActive && !stopped ? 'bg-accent/[0.06]' : ''}
        ${isActive && stopped ? 'bg-orange-500/[0.06]' : ''}
        ${isVerifying && !stopped ? 'bg-status-warning/[0.06]' : ''}
        ${isVerifying && stopped ? 'bg-orange-500/[0.06]' : ''}`}
    >
      <StatusDot status={todo.status} stopped={stopped} />
      <span className={`text-[12px] leading-[1.6] flex-1
        ${isCompleted ? 'text-text-muted/70 line-through decoration-text-muted/30' : ''}
        ${isActive && !stopped ? 'text-text-primary font-medium' : ''}
        ${isActive && stopped ? 'text-orange-400 font-medium' : ''}
        ${isVerifying && !stopped ? 'text-status-warning font-medium' : ''}
        ${isVerifying && stopped ? 'text-orange-400 font-medium' : ''}
        ${todo.status === 'pending' ? 'text-text-muted/80' : ''}
      `}>
        {isActive || isVerifying ? todo.activeForm : todo.content}
      </span>
    </motion.div>
  )
})
TodoRow.displayName = 'TodoRow'

export const TodoListPanel = memo(({ todos, isStreaming = true, embedded = false }: TodoListPanelProps) => {
  const expandToolCallsByDefault = useStore(s => s.agentConfig.expandToolCallsByDefault ?? false)
  const language = useStore(s => s.language)
  // 当有任务时默认展开，无任务时收起
  const [isExpanded, setIsExpanded] = useState(todos.length > 0 ? true : expandToolCallsByDefault)

  /** 任务列表滚动容器引用，用于自动滚动到 in_progress 任务 */
  const listScrollRef = useRef<HTMLDivElement>(null)

  /**
   * 自动滚动到当前活动任务（in_progress / verifying）：当任务数超过可视区域时，
   * 确保活动任务始终可见，而不是停留在列表顶部。
   */
  const scrollIntoView = useCallback(() => {
    const container = listScrollRef.current
    if (!container) return
    // 优先滚动到 in_progress，其次 verifying
    const activeEl = container.querySelector('[data-todo-status="in_progress"]') as HTMLElement | null
      || container.querySelector('[data-todo-status="verifying"]') as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [])

  useEffect(() => {
    if (!isExpanded) return
    // todos 变化时（如任务推进）滚动到当前活动任务
    const timer = setTimeout(scrollIntoView, 50)
    return () => clearTimeout(timer)
  }, [todos, isExpanded, scrollIntoView])

  /**
   * 任务列表隐藏状态（local state）。
   * - 初始值：挂载时若任务已全部完成且非流式，直接隐藏（覆盖应用重启 / 编辑器开关导致的重新挂载场景）
   * - 运行时：任务从未完成 → 全部完成 + 流式结束时，延迟 2s 隐藏（让用户先看到完成动画）
   * - 重置：出现未完成任务或流式重新开始时恢复可见
   * - 嵌入式模式：不自动隐藏，历史任务列表需保持可见
   */
  const [hidden, setHidden] = useState(() => {
    if (embedded) return false
    const allCompleted = todos.length > 0 && todos.every(t => t.status === 'completed')
    return allCompleted && !isStreaming
  })

  const clearTodos = useAgentStore(s => s.setTodos)
  const soundPlayedRef = useRef(false)
  // 标记是否已完成"首次挂载"，用于区分初始挂载与后续 todos 变化
  const isFirstMountRef = useRef(true)

  useEffect(() => {
    const unsub = EventBus.on('todos:all_completed', () => {
      if (!soundPlayedRef.current) {
        soundPlayedRef.current = true
        playCompletionSound()
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const allCompleted = todos.length > 0 && todos.every(t => t.status === 'completed')
    if (!allCompleted) {
      soundPlayedRef.current = false
    }
  }, [todos])

  // 任务全部完成 + AI 流式结束后，延迟 2s 完全隐藏面板
  // 首次挂载时若已处于完成状态，hidden 初始值已为 true，无需再次触发延迟
  // 嵌入式模式不自动隐藏
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (embedded) return
    const allCompleted = todos.length > 0 && todos.every(t => t.status === 'completed')
    const shouldHide = allCompleted && !isStreaming

    // 首次挂载：hidden 初始值已正确，跳过延迟逻辑
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      // 但如果初始状态需要显示且有未完成任务，确保 hidden 为 false
      if (!shouldHide && hidden) setHidden(false)
      return
    }

    // 流式重新开始或有未完成任务时，取消隐藏计划并确保面板可见
    if (!shouldHide) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      if (hidden) setHidden(false)
      return
    }

    // 已隐藏则无需重复调度
    if (hidden) return

    // 延迟 2s 完全隐藏（让用户先看到完成状态）
    hideTimerRef.current = setTimeout(() => {
      setHidden(true)
    }, 2000)

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [todos, isStreaming, hidden])

  // 完全隐藏后不再渲染（任务列表数据保留在 store，可通过助手消息底部"任务完成"chip 查看）
  if (hidden || todos.length === 0) return null

  // stopped 表示"任务未完成但会话已结束"（用户中止 / 历史消息 / 重启应用）。
  // 仅当前正在流式的消息（isStreaming=true）才显示"进行中"，否则有 in_progress/verifying 任务即为"已停止"。
  const stopped = !isStreaming
  const completed = todos.filter(t => t.status === 'completed').length
  // in_progress 和 verifying 都属于"未完成的进行中"状态
  const hasInProgress = todos.some(t => t.status === 'in_progress' || t.status === 'verifying')
  const total = todos.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const allCompleted = completed === total && total > 0

  const handleClearTodos = () => {
    clearTodos([])
  }

  return (
    <div className={`rounded-lg overflow-hidden transition-all
      ${allCompleted
        ? 'border border-green-500/20 bg-green-500/[0.03]'
        : stopped && hasInProgress
          ? 'border border-orange-500/20 bg-orange-500/[0.03]'
          : 'border border-border/40 bg-surface/80'
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <MiniProgress percent={progress} stopped={stopped && hasInProgress} allCompleted={allCompleted} />

        <span className={`text-[12px] font-medium flex-1
          ${allCompleted ? 'text-green-400' : stopped && hasInProgress ? 'text-orange-400' : 'text-text-primary'}`}
        >
          {allCompleted
            ? t('task.allCompleted', language as any)
            : `${completed}/${total} ${t('task.tasks', language as any)}`
          }
        </span>

        {(stopped || allCompleted) && !embedded && (
          <button
            onClick={(e) => { e.stopPropagation(); handleClearTodos() }}
            className="p-1 rounded-md text-text-muted/50 hover:text-text-primary hover:bg-white/5 transition-colors"
            title={t('task.clear', language as any)}
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <ChevronDown className={`w-3.5 h-3.5 text-text-muted/60 transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`} />
      </div>

      {/* Task list */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div ref={listScrollRef} className="px-1.5 pb-2 pt-0.5 max-h-[140px] overflow-y-auto custom-scrollbar">
              {todos.map((todo, i) => (
                <TodoRow key={i} todo={todo} index={i} stopped={stopped && (todo.status === 'in_progress' || todo.status === 'verifying')} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
TodoListPanel.displayName = 'TodoListPanel'
