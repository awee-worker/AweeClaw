/**
 * 时间线投影 Hook
 * 管理消息列表的虚拟分组、历史展开和锚点滚动
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  isUserMessage,
  type ChatMessage as ChatMessageType,
} from '@intelligence/providerTypes'
import {
  buildChatTimelineProjection,
  type ChatTimelineItem,
  type TimelineArchiveItem,
} from '../chatTimelineProjection'

const HISTORY_REVEAL_BATCH_SIZE = 50
const HISTORY_VISIBLE_TAIL_COUNT = 100

interface RenderableMessageItem {
  message: ChatMessageType
  hasCheckpoint: boolean
  renderKey: string
}

/**
 * 构建可渲染消息条目，并沿用上一轮的对象引用。
 *
 * 流式期间消息数组每个分片都会重建，若此处每轮都产出全新对象，Virtuoso 的
 * data 与 itemContent 随之逐帧失效，整份可见列表陪着重渲染。只有「消息对象
 * 或 renderKey 真正变化」的条目才需要新对象，其余一律复用上一轮结果。
 */
function buildRenderableMessageItems(
  messages: ChatMessageType[],
  checkpointMessageIds: ReadonlySet<string>,
  previous: Map<string, RenderableMessageItem>,
): { items: RenderableMessageItem[]; cache: Map<string, RenderableMessageItem> } {
  const cache = new Map<string, RenderableMessageItem>()
  const items = messages.map(message => {
    const hasCheckpoint = isUserMessage(message) && checkpointMessageIds.has(message.id)
    const renderKey = `${message.id}:${hasCheckpoint ? 'checkpoint' : 'plain'}`
    const cached = previous.get(renderKey)
    const item = cached && cached.message === message
      ? cached
      : { message, hasCheckpoint, renderKey }
    cache.set(renderKey, item)
    return item
  })
  return { items, cache }
}

interface UseTimelineProjectionParams {
  filteredMessages: ChatMessageType[]
  checkpointMessageIds: Set<string>
  currentThreadId: string | null
  virtuosoRef: React.RefObject<any>
}

export function useTimelineProjection({
  filteredMessages,
  checkpointMessageIds,
  currentThreadId,
  virtuosoRef,
}: UseTimelineProjectionParams) {
  const [threadHistoryRevealCount, setThreadHistoryRevealCount] = useState<Record<string, number>>({})
  const [isSwitchingThread, setIsSwitchingThread] = useState(false)
  const prevThreadIdRef = useRef(currentThreadId)
  const pendingRevealAnchorKeyRef = useRef<string | null>(null)
  const visibleRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null)

  const currentThreadHistoryRevealCount = currentThreadId
    ? threadHistoryRevealCount[currentThreadId] ?? 0
    : 0

  const timelineProjection = useMemo(
    () =>
      buildChatTimelineProjection(filteredMessages, {
        expandedHistoryCount: currentThreadHistoryRevealCount,
        visibleTailCount: HISTORY_VISIBLE_TAIL_COUNT,
        revealBatchSize: HISTORY_REVEAL_BATCH_SIZE,
      }),
    [currentThreadHistoryRevealCount, filteredMessages],
  )

  /** 上一轮条目缓存：让未变化的消息条目保持同一对象引用 */
  const previousRenderableRef = useRef<Map<string, RenderableMessageItem>>(new Map())
  /** 上一轮时间线条目缓存：同上，作用于 Virtuoso 的 data 元素 */
  const previousTimelineItemsRef = useRef<Map<string, ChatTimelineItem<RenderableMessageItem>>>(new Map())

  const visibleRenderableMessages = useMemo<RenderableMessageItem[]>(() => {
    const { items, cache } = buildRenderableMessageItems(
      timelineProjection.visibleMessages,
      checkpointMessageIds,
      previousRenderableRef.current,
    )
    previousRenderableRef.current = cache
    return items
  }, [checkpointMessageIds, timelineProjection.visibleMessages])

  const timelineItems = useMemo<ChatTimelineItem<RenderableMessageItem>[]>(() => {
    const previous = previousTimelineItemsRef.current
    const cache = new Map<string, ChatTimelineItem<RenderableMessageItem>>()
    const items: ChatTimelineItem<RenderableMessageItem>[] = []

    if (timelineProjection.hiddenCount > 0) {
      const hiddenCount = timelineProjection.hiddenCount
      const revealCount = timelineProjection.revealCount
      const key = `archive:${hiddenCount}`
      const cached = previous.get(key)
      const archiveItem: ChatTimelineItem<RenderableMessageItem> =
        cached && cached.kind === 'archive' && cached.hiddenCount === hiddenCount && cached.revealCount === revealCount
          ? cached
          : {
              kind: 'archive',
              key,
              hiddenCount,
              revealCount,
              remainingCount: Math.max(0, hiddenCount - revealCount),
            }
      cache.set(key, archiveItem)
      items.push(archiveItem)
    }

    for (const item of visibleRenderableMessages) {
      const key = item.renderKey
      const cached = previous.get(key)
      // 条目对象与其底层 renderable item 都未变 → 复用同一对象，
      // 使 Virtuoso 的 data 在流式期间只替换真正变化的那一条。
      const timelineItem: ChatTimelineItem<RenderableMessageItem> =
        cached && cached.kind === 'message' && cached.item === item
          ? cached
          : { kind: 'message', key, item }
      cache.set(key, timelineItem)
      items.push(timelineItem)
    }

    previousTimelineItemsRef.current = cache
    return items
  }, [timelineProjection.hiddenCount, timelineProjection.revealCount, visibleRenderableMessages])

  const timelineLengthRef = useRef(timelineItems.length)
  timelineLengthRef.current = timelineItems.length

  const initialIndexRef = useRef(Math.max(0, timelineItems.length - 1))

  // 线程切换时控制骨架屏显示
  useEffect(() => {
    const threadChanged = currentThreadId !== prevThreadIdRef.current
    prevThreadIdRef.current = currentThreadId

    if (!threadChanged) return

    initialIndexRef.current = Math.max(0, timelineLengthRef.current - 1)
    setIsSwitchingThread(true)
    const timer = window.setTimeout(() => {
      requestAnimationFrame(() => {
        setIsSwitchingThread(false)
      })
    }, 16)
    return () => window.clearTimeout(timer)
  }, [currentThreadId])

  // 展开历史消息
  const revealArchivedMessages = useCallback(() => {
    if (!currentThreadId || timelineProjection.revealCount <= 0) return

    const anchorIndex = visibleRangeRef.current?.startIndex ?? 0
    const anchorItem = timelineItems[anchorIndex]
    if (anchorItem?.kind === 'message') {
      pendingRevealAnchorKeyRef.current = anchorItem.key
    } else {
      const firstVisibleMessage = timelineItems.find(item => item.kind === 'message')
      pendingRevealAnchorKeyRef.current = firstVisibleMessage?.key ?? null
    }

    setThreadHistoryRevealCount(state => ({
      ...state,
      [currentThreadId]: (state[currentThreadId] ?? 0) + timelineProjection.revealCount,
    }))
  }, [currentThreadId, timelineItems, timelineProjection.revealCount])

  // 锚点滚动恢复
  useEffect(() => {
    const anchorKey = pendingRevealAnchorKeyRef.current
    if (!anchorKey) return

    const anchorIndex = timelineItems.findIndex(item => item.key === anchorKey)
    if (anchorIndex < 0) return

    pendingRevealAnchorKeyRef.current = null
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: anchorIndex,
        align: 'start',
        behavior: 'auto',
      })
    })
  }, [timelineItems, virtuosoRef])

  const handleTimelineRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    visibleRangeRef.current = range
  }, [])

  return {
    timelineItems,
    isSwitchingThread,
    initialIndexRef,
    visibleRangeRef,
    revealArchivedMessages,
    handleTimelineRangeChanged,
  }
}

export type { RenderableMessageItem, TimelineArchiveItem }
