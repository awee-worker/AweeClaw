/**
 * 记忆列表视图
 * 支持列表/网格/时间轴/图谱/3D 五种展示模式
 */
import { useEffect, useCallback } from 'react'
import { useMemoryStore } from '../store'
import { MemoryCard, MemoryListItem } from './MemoryCard'
import { MemoryToolbar } from './MemoryToolbar'
import { MemoryTimelineView } from './MemoryTimelineView'
import { MemoryGraphView } from './MemoryGraphView'
import { Memory3DScene } from './Memory3DScene'
import { EmptyState, LoadingState, ErrorState } from './shared'
import { Brain, Inbox } from 'lucide-react'

export function MemoryListView() {
  const {
    memories,
    loading,
    loadingMore,
    error,
    viewMode,
    total,
    fetchMemories,
    fetchMore,
  } = useMemoryStore()

  // 初始加载（仅列表/网格模式需要）
  useEffect(() => {
    if (viewMode === 'list' || viewMode === 'grid') {
      fetchMemories(true)
    }
  }, [fetchMemories, viewMode])

  // 滚动加载更多
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
      if (scrollHeight - scrollTop - clientHeight < 100 && !loadingMore && memories.length < total) {
        fetchMore()
      }
    },
    [loadingMore, memories.length, total, fetchMore],
  )

  // 时间轴视图
  if (viewMode === 'timeline') {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <MemoryTimelineView />
      </div>
    )
  }

  // 图谱视图
  if (viewMode === 'graph') {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <MemoryGraphView />
      </div>
    )
  }

  // 3D 视图
  if (viewMode === '3d') {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <div className="flex-1 min-h-0">
          <Memory3DScene />
        </div>
      </div>
    )
  }

  // 列表/网格视图
  if (loading && memories.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <LoadingState message="正在加载记忆..." />
      </div>
    )
  }

  if (error && memories.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <ErrorState message={error} onRetry={() => fetchMemories(true)} />
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <MemoryToolbar />
        <EmptyState
          icon={<Inbox className="w-12 h-12" strokeWidth={1.2} />}
          title="暂无记忆"
          description="AI 助手会在对话中自动记录重要信息。开始对话后，这里会显示所有记忆。"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <MemoryToolbar />
      <div
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar"
      >
        {viewMode === 'list' && (
          <div className="divide-y divide-border/20">
            {memories.map((memory) => (
              <MemoryListItem key={memory.id} memory={memory} />
            ))}
          </div>
        )}

        {viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
            {memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        )}

        {/* 加载更多 */}
        {loadingMore && (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span className="ml-2 text-xs text-text-muted">加载更多...</span>
          </div>
        )}

        {/* 没有更多 */}
        {!loadingMore && memories.length >= total && total > 0 && (
          <div className="flex items-center justify-center py-6 text-xs text-text-muted">
            <Brain className="w-3.5 h-3.5 mr-1.5 opacity-50" />
            已加载全部 {total} 条记忆
          </div>
        )}
      </div>
    </div>
  )
}
