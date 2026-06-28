import { useState, memo, useEffect, useRef } from 'react'
import { Check, Circle, ChevronDown, X, Pause, Loader2 } from 'lucide-react'
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
  if (stopped && status === 'in_progress') {
    return <Pause className="w-3 h-3 text-orange-400 flex-shrink-0" />
  }
  switch (status) {
    case 'completed':
      return (
        <div className="w-4 h-4 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
          <Check className="w-2.5 h-2.5 text-green-400" strokeWidth={3} />
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-colors
        ${isActive && !stopped ? 'bg-accent/[0.06]' : ''}
        ${isActive && stopped ? 'bg-orange-500/[0.06]' : ''}`}
    >
      <StatusDot status={todo.status} stopped={stopped} />
      <span className={`text-[12px] leading-[1.6] flex-1
        ${isCompleted ? 'text-text-muted/70 line-through decoration-text-muted/30' : ''}
        ${isActive && !stopped ? 'text-text-primary font-medium' : ''}
        ${isActive && stopped ? 'text-orange-400 font-medium' : ''}
        ${todo.status === 'pending' ? 'text-text-muted/80' : ''}
      `}>
        {isActive ? todo.activeForm : todo.content}
      </span>
    </motion.div>
  )
})
TodoRow.displayName = 'TodoRow'

export const TodoListPanel = memo(({ todos, isStreaming = true }: TodoListPanelProps) => {
  const expandToolCallsByDefault = useStore(s => s.agentConfig.expandToolCallsByDefault ?? false)
  const language = useStore(s => s.language)
  // 当有任务时默认展开，无任务时收起
  const [isExpanded, setIsExpanded] = useState(todos.length > 0 ? true : expandToolCallsByDefault)

  const clearTodos = useAgentStore(s => s.setTodos)
  const soundPlayedRef = useRef(false)
  // 记录是否已自动收起，避免重复触发或与用户手动展开冲突
  const autoCollapsedRef = useRef(false)

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
      autoCollapsedRef.current = false
    }
  }, [todos])

  // 任务全部完成后延迟自动收起（让用户看到完成状态），用户可重新点击展开
  useEffect(() => {
    const allCompleted = todos.length > 0 && todos.every(t => t.status === 'completed')
    if (allCompleted && isExpanded && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      const timer = setTimeout(() => setIsExpanded(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [todos, isExpanded])

  if (todos.length === 0) return null

  const stopped = !isStreaming
  const completed = todos.filter(t => t.status === 'completed').length
  const hasInProgress = todos.some(t => t.status === 'in_progress')
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

        {(stopped || allCompleted) && (
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
            <div className="px-1.5 pb-2 pt-0.5 max-h-[140px] overflow-y-auto custom-scrollbar">
              {todos.map((todo, i) => (
                <TodoRow key={i} todo={todo} index={i} stopped={stopped && todo.status === 'in_progress'} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
TodoListPanel.displayName = 'TodoListPanel'
