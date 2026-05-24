/**
 * SessionHistoryPage - 历史会话记录页面
 * 展示所有会话记录，支持分页、搜索、批量删除和全部清空
 */

import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  History,
  X,
  Search,
  Trash2,
  AlertTriangle,
  MessageSquare,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Loader2,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentActions, useAllThreads } from '@hooks/useAgent'
import { getThreadDisplayTitle, getMessageText } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'

interface SessionHistoryPageProps {
  onClose?: () => void
}

const PAGE_SIZE = 20

function formatDate(timestamp: number, language: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()

  if (isToday) {
    return language === 'zh'
      ? `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
      : `Today ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }
  if (isYesterday) {
    return language === 'zh'
      ? `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
      : `Yesterday ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return language === 'zh' ? `${y}-${m}-${d} ${h}:${min}` : `${m}/${d}/${y} ${h}:${min}`
}

function getMessageCount(thread: ChatThread): number {
  return thread.messageCount ?? thread.messages.length ?? 0
}

function getSessionPreview(thread: ChatThread): string {
  const firstUserMsg = thread.messages.find(m => m.role === 'user')
  if (firstUserMsg) {
    const text = getMessageText(firstUserMsg.content).slice(0, 80)
    return text || '-'
  }
  return '-'
}

export default function SessionHistoryPage({ onClose }: SessionHistoryPageProps) {
  const { language, setShowSessionHistoryPage } = useStore(useShallow(s => ({
    language: s.language,
    setShowSessionHistoryPage: (s.setShowSessionHistoryPage as (show: boolean) => void),
  })))

  const allThreads = useAllThreads()
  const { deleteThread, switchThread } = useAgentActions()
  const currentThreadId = useAgentStore(state => state.currentThreadId)

  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  const filteredThreads = useMemo(() => {
    let result = [...allThreads]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(t => {
        const title = getThreadDisplayTitle(t).toLowerCase()
        const preview = getSessionPreview(t).toLowerCase()
        return title.includes(q) || preview.includes(q)
      })
    }
    result.sort((a, b) => b.lastModified - a.lastModified)
    return result
  }, [allThreads, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredThreads.length / PAGE_SIZE))
  const currentPageSafe = Math.min(currentPage, totalPages)
  const paginatedThreads = useMemo(() => {
    const start = (currentPageSafe - 1) * PAGE_SIZE
    return filteredThreads.slice(start, start + PAGE_SIZE)
  }, [filteredThreads, currentPageSafe])

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      setShowSessionHistoryPage(false)
    }
  }, [onClose, setShowSessionHistoryPage])

  const handleSelect = useCallback((threadId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(threadId)) {
        next.delete(threadId)
      } else {
        next.add(threadId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const pageIds = new Set(paginatedThreads.map(t => t.id))
    const allSelected = pageIds.size > 0 && [...pageIds].every(id => selectedIds.has(id))
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pageIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pageIds.forEach(id => next.add(id))
        return next
      })
    }
  }, [paginatedThreads, selectedIds])

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '确认删除' : 'Confirm Delete',
      message: language === 'zh'
        ? `确定要删除选中的 ${selectedIds.size} 个会话吗？此操作不可恢复。`
        : `Are you sure you want to delete ${selectedIds.size} selected session(s)? This action cannot be undone.`,
      confirmText: language === 'zh' ? '删除' : 'Delete',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      variant: 'danger',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      selectedIds.forEach(id => deleteThread(id))
      setSelectedIds(new Set())
    } finally {
      setIsDeleting(false)
    }
  }, [selectedIds, deleteThread, language])

  const handleClearAll = useCallback(async () => {
    if (filteredThreads.length === 0) return
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '确认清空全部' : 'Confirm Clear All',
      message: language === 'zh'
        ? `确定要清空所有 ${filteredThreads.length} 个会话吗？此操作不可恢复。`
        : `Are you sure you want to clear all ${filteredThreads.length} session(s)? This action cannot be undone.`,
      confirmText: language === 'zh' ? '全部清空' : 'Clear All',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
      variant: 'danger',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      filteredThreads.forEach(t => deleteThread(t.id))
      setSelectedIds(new Set())
      setCurrentPage(1)
    } finally {
      setIsDeleting(false)
    }
  }, [filteredThreads, deleteThread, language])

  const handleOpenThread = useCallback((threadId: string) => {
    switchThread(threadId)
    handleClose()
  }, [switchThread, handleClose])

  const pageIds = new Set(paginatedThreads.map(t => t.id))
  const allPageSelected = pageIds.size > 0 && [...pageIds].every(id => selectedIds.has(id))
  const somePageSelected = [...pageIds].some(id => selectedIds.has(id))

  return (
    <div className="flex h-full bg-background">
      {/* 侧边栏 */}
      <div className="w-56 bg-surface/30 backdrop-blur-xl flex flex-col pt-8 pb-6 border-r border-border/30">
        <div className="px-6 mb-6">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
              <History className="w-5 h-5 text-accent" />
            </div>
            {language === 'zh' ? '历史会话' : 'Session History'}
          </h2>
        </div>
        <nav className="flex-1 p-4">
          <div className="px-3 py-2 rounded-lg bg-accent/10 text-text-primary text-sm font-medium border border-accent/20 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" />
            {language === 'zh' ? '全部会话' : 'All Sessions'}
          </div>
          <div className="mt-3 px-3 text-[11px] text-text-muted">
            {language === 'zh' ? `共 ${filteredThreads.length} 个会话` : `${filteredThreads.length} sessions total`}
          </div>
        </nav>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 头部 */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
              {language === 'zh' ? '历史会话记录' : 'Session History'}
            </h3>
            <p className="text-sm text-text-muted mt-1.5 opacity-80">
              {language === 'zh' ? '查看和管理您的所有会话记录' : 'View and manage all your session records'}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group"
          >
            <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* 工具栏 */}
        <div className="shrink-0 px-6 py-3 border-b border-border/30 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
              placeholder={language === 'zh' ? '搜索会话标题或内容...' : 'Search session title or content...'}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface/50 border border-border/50 text-sm text-text-primary placeholder:text-text-muted/60 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {selectedIds.size > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="h-9 px-3 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {language === 'zh' ? `删除 (${selectedIds.size})` : `Delete (${selectedIds.size})`}
              </motion.button>
            )}
            {filteredThreads.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={isDeleting}
                className="h-9 px-3 rounded-lg border border-border/50 text-text-secondary hover:bg-surface-hover hover:text-text-primary text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {language === 'zh' ? '全部清空' : 'Clear All'}
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
          {filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <History className="w-12 h-12 opacity-20 mb-3" />
              <p className="text-sm">
                {searchQuery.trim()
                  ? (language === 'zh' ? '未找到匹配的会话' : 'No matching sessions found')
                  : (language === 'zh' ? '暂无会话记录' : 'No session records yet')
                }
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* 表头 */}
              <div className="flex items-center gap-3 px-3 py-2 text-[11px] font-medium text-text-muted uppercase tracking-wider">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-2 hover:text-text-primary transition-colors"
                >
                  {allPageSelected ? (
                    <CheckSquare className="w-4 h-4 text-accent" />
                  ) : somePageSelected ? (
                    <div className="w-4 h-4 rounded border-2 border-accent bg-accent/30" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
                <span className="flex-1">{language === 'zh' ? '会话' : 'Session'}</span>
                <span className="w-24 text-center">{language === 'zh' ? '消息数' : 'Messages'}</span>
                <span className="w-32 text-right">{language === 'zh' ? '时间' : 'Time'}</span>
                <span className="w-16 text-right">{language === 'zh' ? '操作' : 'Action'}</span>
              </div>

              <AnimatePresence mode="popLayout">
                {paginatedThreads.map(thread => {
                  const isSelected = selectedIds.has(thread.id)
                  const isCurrent = currentThreadId === thread.id
                  const title = getThreadDisplayTitle(thread)
                  const preview = getSessionPreview(thread)
                  const msgCount = getMessageCount(thread)
                  const dateStr = formatDate(thread.lastModified, language)

                  return (
                    <motion.div
                      key={thread.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className={`
                        group flex items-center gap-3 px-3 py-3 rounded-xl border transition-all cursor-pointer
                        ${isSelected
                          ? 'bg-accent/5 border-accent/30'
                          : 'bg-surface/30 border-border/30 hover:border-border/60 hover:bg-surface/50'
                        }
                      `}
                      onClick={() => handleSelect(thread.id)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSelect(thread.id) }}
                        className="shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-accent" />
                        ) : (
                          <Square className="w-4 h-4 text-text-muted group-hover:text-text-secondary transition-colors" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary truncate">
                            {title}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                              {language === 'zh' ? '当前' : 'Current'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-text-muted truncate mt-0.5">{preview}</p>
                      </div>

                      <div className="w-24 flex items-center justify-center gap-1 text-[11px] text-text-muted">
                        <MessageSquare className="w-3 h-3" />
                        {msgCount}
                      </div>

                      <div className="w-32 text-right text-[11px] text-text-muted flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3" />
                        {dateStr}
                      </div>

                      <div className="w-16 flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenThread(thread.id) }}
                          className="p-1.5 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                          title={language === 'zh' ? '打开会话' : 'Open session'}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelect(thread.id); handleDeleteSelected() }}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title={language === 'zh' ? '删除' : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="shrink-0 px-6 py-3 border-t border-border/30 flex items-center justify-between">
            <span className="text-[11px] text-text-muted">
              {language === 'zh'
                ? `共 ${filteredThreads.length} 条，第 ${currentPageSafe}/${totalPages} 页`
                : `${filteredThreads.length} total, page ${currentPageSafe}/${totalPages}`
              }
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPageSafe <= 1}
                className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`
                    min-w-[28px] h-7 px-1.5 rounded-lg text-xs font-medium transition-colors
                    ${page === currentPageSafe
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                    }
                  `}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPageSafe >= totalPages}
                className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
