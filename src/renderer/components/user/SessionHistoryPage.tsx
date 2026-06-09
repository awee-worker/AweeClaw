/**
 * SessionHistoryPage - 历史会话记录页面
 * 展示所有会话记录，支持分页、搜索、批量删除和全部清空
 *
 * 数据加载策略：优先从数据库查询，数据库连接失败时降级读内存缓存
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
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
import { getThreadDisplayTitle } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { t, type Language } from '@renderer/i18n'

/** 统一的线程摘要结构（用于页面展示） */
interface ThreadSummaryItem {
  id: string
  title: string
  lastModified: number
  messageCount: number
  /** 来源标记：db=数据库查询，cache=内存缓存降级 */
  source: 'db' | 'cache'
}

interface SessionHistoryPageProps {
  onClose?: () => void
}

const PAGE_SIZE = 20

function formatDate(timestamp: number, language: Language): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()

  if (isToday) {
    return t('user.today', language as Language, { hours: date.getHours().toString().padStart(2, '0'), minutes: date.getMinutes().toString().padStart(2, '0') })
  }
  if (isYesterday) {
    return t('user.yesterday', language as Language, { hours: date.getHours().toString().padStart(2, '0'), minutes: date.getMinutes().toString().padStart(2, '0') })
  }

  const y = date.getFullYear()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return t('user.text0', language as Language, { m: m, d: d, y: y, h: h, min: min })
}

/** 从数据库查询线程摘要列表 */
async function fetchThreadSummariesFromDb(userId?: string | null): Promise<ThreadSummaryItem[]> {
  const summaries = await api.sessionDb.getAllThreadSummaries(userId)
  return summaries.map(s => ({
    id: s.id,
    title: s.title || '',
    lastModified: s.lastModified,
    messageCount: s.messageCount,
    source: 'db' as const,
  }))
}

/** 从内存缓存降级获取线程摘要 */
function getThreadSummariesFromCache(allThreads: ChatThread[]): ThreadSummaryItem[] {
  return allThreads.map(t => ({
    id: t.id,
    title: getThreadDisplayTitle(t),
    lastModified: t.lastModified,
    messageCount: t.messageCount ?? t.messages.length ?? 0,
    source: 'cache' as const,
  }))
}

export default function SessionHistoryPage({ onClose }: SessionHistoryPageProps) {
  const { language, setShowSessionHistoryPage } = useStore(useShallow(s => ({
    language: s.language,
    setShowSessionHistoryPage: (s.setShowSessionHistoryPage as (show: boolean) => void),
  })))

  const currentUserId = useStore(s => s.cloudUser?.id)
  const allThreads = useAllThreads()
  const { deleteThread, switchThread } = useAgentActions()
  const currentThreadId = useAgentStore(state => state.currentThreadId)

  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // 从数据库查询线程摘要，失败时降级到内存缓存
  const [threadSummaries, setThreadSummaries] = useState<ThreadSummaryItem[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadSummaries() {
      setIsLoading(true)
      try {
        // 优先从数据库查询
        const summaries = await fetchThreadSummariesFromDb(currentUserId ?? null)
        if (!cancelled) {
          setThreadSummaries(summaries)
        }
      } catch (err) {
        logger.system.warn('[SessionHistory] DB query failed, falling back to cache:', err)
        // 数据库查询失败，降级到内存缓存
        if (!cancelled) {
          setThreadSummaries(getThreadSummariesFromCache(allThreads))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadSummaries()

    return () => { cancelled = true }
  }, [currentUserId, allThreads])

  const filteredThreads = useMemo(() => {
    let result = [...threadSummaries]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(t => t.title.toLowerCase().includes(q))
    }
    result.sort((a, b) => b.lastModified - a.lastModified)
    return result
  }, [threadSummaries, searchQuery])

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
      title: t('user.confirmdelete', language as Language),
      message: t('user.areyousureyouwant', language as Language, { size: selectedIds.size }),
      confirmText: t('user.delete', language as Language),
      cancelText: t('user.cancel', language as Language),
      variant: 'danger',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      selectedIds.forEach(id => deleteThread(id))
      // 从本地列表中也移除
      setThreadSummaries(prev => prev.filter(t => !selectedIds.has(t.id)))
      setSelectedIds(new Set())
    } finally {
      setIsDeleting(false)
    }
  }, [selectedIds, deleteThread, language])

  const handleClearAll = useCallback(async () => {
    if (filteredThreads.length === 0) return
    const confirmed = await globalConfirm({
      title: t('user.confirmclearall', language as Language),
      message: t('user.areyousureyouwant2', language as Language, { length: filteredThreads.length }),
      confirmText: t('user.clearall', language as Language),
      cancelText: t('user.cancel2', language as Language),
      variant: 'danger',
    })
    if (!confirmed) return

    setIsDeleting(true)
    try {
      filteredThreads.forEach(t => deleteThread(t.id))
      setThreadSummaries([])
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
            {t('user.sessionhistory', language as Language)}
          </h2>
        </div>
        <nav className="flex-1 p-4">
          <div className="px-3 py-2 rounded-lg bg-accent/10 text-text-primary text-sm font-medium border border-accent/20 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" />
            {t('user.allsessions', language as Language)}
          </div>
          <div className="mt-3 px-3 text-[11px] text-text-muted">
            {t('user.sessionstotal', language as Language, { length: filteredThreads.length })}
          </div>
        </nav>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 头部 */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
              {t('user.sessionhistory2', language as Language)}
            </h3>
            <p className="text-sm text-text-muted mt-1.5 opacity-80">
              {t('user.viewandmanageallyour', language as Language)}
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
              placeholder={t('user.searchsessiontitleorcontent', language as Language)}
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
                {t('user.delete2', language as Language, { size: selectedIds.size })}
              </motion.button>
            )}
            {filteredThreads.length > 0 && (
              <button
                onClick={handleClearAll}
                disabled={isDeleting}
                className="h-9 px-3 rounded-lg border border-border/50 text-text-secondary hover:bg-surface-hover hover:text-text-primary text-sm font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('user.clearall2', language as Language)}
              </button>
            )}
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <Loader2 className="w-8 h-8 animate-spin mb-3 opacity-40" />
              <p className="text-sm">{t('common.loading', language as Language)}</p>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <History className="w-12 h-12 opacity-20 mb-3" />
              <p className="text-sm">
                {searchQuery.trim()
                  ? (t('user.nomatchingsessionsfound', language as Language))
                  : (t('user.nosessionrecordsyet', language as Language))
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
                <span className="flex-1">{t('user.session', language as Language)}</span>
                <span className="w-24 text-center">{t('user.messages', language as Language)}</span>
                <span className="w-32 text-right">{t('user.time', language as Language)}</span>
                <span className="w-16 text-right">{t('user.action', language as Language)}</span>
              </div>

              <AnimatePresence mode="popLayout">
                {paginatedThreads.map(thread => {
                  const isSelected = selectedIds.has(thread.id)
                  const isCurrent = currentThreadId === thread.id

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
                            {thread.title || t('user.untitled', language as Language)}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                              {t('user.current', language as Language)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="w-24 flex items-center justify-center gap-1 text-[11px] text-text-muted">
                        <MessageSquare className="w-3 h-3" />
                        {thread.messageCount}
                      </div>

                      <div className="w-32 text-right text-[11px] text-text-muted flex items-center justify-end gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(thread.lastModified, language)}
                      </div>

                      <div className="w-16 flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenThread(thread.id) }}
                          className="p-1.5 rounded-lg hover:bg-accent/10 text-text-muted hover:text-accent transition-colors"
                          title={t('user.opensession', language as Language)}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelect(thread.id); handleDeleteSelected() }}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          title={t('user.delete3', language as Language)}
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
              {t('user.totalpage', language as Language, { length: filteredThreads.length, currentPageSafe: currentPageSafe, totalPages: totalPages })
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
