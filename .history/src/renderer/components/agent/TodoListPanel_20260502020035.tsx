/**
 * 任务列表面板
 * 显示 Agent 拆解的子任务及其进度
 */

import { useState, memo, useMemo } from 'react'
import { Check, Circle, ChevronDown, X, Pause, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TodoItem } from '@/renderer/agent/types'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'

const TOOL_LABEL_KEYS: Record<string, string> = {
    read_file: 'tool.label.read_file',
    read_multiple_files: 'tool.label.read_multiple_files',
    list_directory: 'tool.label.list_directory',
    search_files: 'tool.label.search_files',
    codebase_search: 'tool.label.codebase_search',
    edit_file: 'tool.label.edit_file',
    write_file: 'tool.label.write_file',
    create_file: 'tool.label.create_file',
    create_file_or_folder: 'tool.label.create_file_or_folder',
    delete_file_or_folder: 'tool.label.delete_file_or_folder',
    run_command: 'tool.label.run_command',
    get_lint_errors: 'tool.label.get_lint_errors',
    find_references: 'tool.label.find_references',
    go_to_definition: 'tool.label.go_to_definition',
    get_hover_info: 'tool.label.get_hover_info',
    get_document_symbols: 'tool.label.get_document_symbols',
    web_search: 'tool.label.web_search',
    read_url: 'tool.label.read_url',
    ask_user: 'tool.label.ask_user',
    remember: 'tool.label.remember',
    uiux_search: 'tool.label.uiux_search',
    uiux_recommend: 'tool.label.uiux_recommend',
    apply_skill: 'tool.label.apply_skill',
    todo_write: 'tool.label.todo_write',
}

interface TodoListPanelProps {
  todos: TodoItem[]
  isStreaming?: boolean
  headerPrefix?: React.ReactNode
  currentToolName?: string
}

const StatusIcon = memo(({ status, stopped }: { status: TodoItem['status']; stopped?: boolean }) => {
  if (stopped && status === 'in_progress') {
    return <Pause className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
  }
  switch (status) {
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
    case 'in_progress':
      return <div className="w-2 h-2 rounded-full bg-accent animate-pulse flex-shrink-0 mx-[3px]" />
    case 'pending':
      return <Circle className="w-3.5 h-3.5 text-text-muted/85 flex-shrink-0" />
  }
})
StatusIcon.displayName = 'StatusIcon'

const TodoRow = memo(({ todo, stopped }: { todo: TodoItem; stopped?: boolean }) => {
  const isCompleted = todo.status === 'completed'
  const isActive = todo.status === 'in_progress'

  return (
    <div className={`flex items-start gap-2 py-1 px-1 rounded-md transition-colors
      ${isActive && !stopped ? 'bg-accent/5' : ''}
      ${isActive && stopped ? 'bg-orange-500/5' : ''}`}
    >
      <div className="mt-0.5">
        <StatusIcon status={todo.status} stopped={stopped} />
      </div>
      <span className={`text-[12px] leading-relaxed
        ${isCompleted ? 'text-text-muted/90 line-through' : ''}
        ${isActive && !stopped ? 'text-text-primary font-medium' : ''}
        ${isActive && stopped ? 'text-orange-400 font-medium' : ''}
        ${todo.status === 'pending' ? 'text-text-muted' : ''}
      `}>
        {isActive ? todo.activeForm : todo.content}
      </span>
    </div>
  )
})
TodoRow.displayName = 'TodoRow'

export const TodoListPanel = memo(({ todos, isStreaming = true, headerPrefix, currentToolName }: TodoListPanelProps) => {
  const expandAgentBlocksByDefault = useStore(s => s.agentConfig.expandAgentBlocksByDefault ?? false)
  const language = useStore(s => s.language)
  const [isExpanded, setIsExpanded] = useState(expandAgentBlocksByDefault)

  const clearTodos = useAgentStore(s => s.setTodos)

  const activeTask = todos.find(t => t.status === 'in_progress')
  const toolDisplayName = currentToolName
    ? (TOOL_LABEL_KEYS[currentToolName] ? t(TOOL_LABEL_KEYS[currentToolName] as any, language as any) : currentToolName)
    : null

  const activityLabel = useMemo(() => {
    if (!isStreaming) return null
    if (activeTask && toolDisplayName) {
      return `${toolDisplayName} · ${activeTask.activeForm}`
    }
    if (activeTask) return activeTask.activeForm
    if (toolDisplayName) return toolDisplayName
    return t('statusBar.thinking', language as any)
  }, [isStreaming, activeTask, toolDisplayName, language])

  if (todos.length === 0) return null

  const stopped = !isStreaming
  const completed = todos.filter(t => t.status === 'completed').length
  const hasInProgress = todos.some(t => t.status === 'in_progress')
  const total = todos.length
  const progress = total > 0 ? (completed / total) * 100 : 0
  const allCompleted = completed === total && total > 0

  const handleClearTodos = () => {
    clearTodos([])
  }

  return (
    <div className="rounded-xl border border-border/50 bg-surface/40 backdrop-blur-md overflow-hidden shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)] transition-all">
      {isStreaming && activityLabel && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
          <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
          <span className="text-[12px] font-medium tool-text-shimmer truncate">
            {activityLabel}
          </span>
        </div>
      )}

      {!isStreaming && hasInProgress && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50">
          <Pause className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
          <span className="text-[12px] font-medium text-orange-400 truncate">
            {t('task.stopped', language as any)}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 py-2">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer"
        >
          {headerPrefix}
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
          <span className="text-[12px] font-medium text-text-primary">
            {allCompleted ? (
              <span className="text-green-400">{t('task.allCompleted', language as any)}</span>
            ) : (
              <>{completed}/{total} {t('task.tasks', language as any)}</>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Progress bar */}
          <div className="w-20 h-1 rounded-full bg-border/50 overflow-hidden relative">
            <motion.div
              className={`h-full rounded-full ${stopped && hasInProgress ? 'bg-orange-400' : 'bg-accent'}`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
            {hasInProgress && !stopped && (
              <motion.div
                className="absolute inset-y-0 w-1/2 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgb(var(--accent) / 0.5), transparent)',
                }}
                animate={{ left: ['-50%', '150%'] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </div>

          {/* Clear button - show when stopped or all completed */}
          {(stopped || allCompleted) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleClearTodos()
              }}
              className="p-1 rounded-md text-text-muted/70 hover:text-text-primary hover:bg-white/5 transition-colors"
              title={t('task.clear', language as any)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
            <div className="px-3 pb-2.5 pt-0.5 max-h-[200px] overflow-y-auto space-y-0.5">
              {todos.map((todo, i) => (
                <TodoRow key={i} todo={todo} stopped={stopped && todo.status === 'in_progress'} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
TodoListPanel.displayName = 'TodoListPanel'
