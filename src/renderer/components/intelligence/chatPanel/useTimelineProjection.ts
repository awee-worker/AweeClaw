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

function buildRenderableMessageItems(
  messages: ChatMessageType[],
  checkpointMessageIds: ReadonlySet<string>,
): RenderableMessageItem[] {
  return messages.map(message => {
    const hasCheckpoint = isUserMessage(message) && checkpointMessageIds.has(message.id)
    return {
      message,
      hasCheckpoint,
      renderKey: `${message.id}:${hasCheckpoint ? 'checkpoint' : 'plain'}`,
    }
  })
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

  const visibleRenderableMessages = useMemo<RenderableMessageItem[]>(
    () => buildRenderableMessageItems(timelineProjection.visibleMessages, checkpointMessageIds),
    [checkpointMessageIds, timelineProjection.visibleMessages],
  )

  const timelineItems = useMemo<ChatTimelineItem<RenderableMessageItem>[]>(() => {
    const items: ChatTimelineItem<RenderableMessageItem>[] = []

    if (timelineProjection.hiddenCount > 0) {
      items.push({
        kind: 'archive',
        key: `archive:${timelineProjection.hiddenCount}`,
        hiddenCount: timelineProjection.hiddenCount,
        revealCount: timelineProjection.revealCount,
        remainingCount: Math.max(0, timelineProjection.hiddenCount - timelineProjection.revealCount),
      })
    }

    for (const item of visibleRenderableMessages) {
      items.push({
        kind: 'message',
        key: item.renderKey,
        item,
      })
    }

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
