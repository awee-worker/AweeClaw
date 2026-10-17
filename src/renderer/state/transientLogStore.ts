/**
 * Transient Store — 高频工具调用日志的瞬态通道
 *
 * 设计：
 * - 工具调用日志（request/response）每次 Agent 执行都会产生多条写入，
 *   走 zustand set 会触发所有订阅 toolCallLogs 的组件重渲染。
 *   这里改为独立事件缓冲：写入不触发任何 React 渲染；
 * - 消费端通过 subscribe 感知，UI 展开面板时才拉明细，摘要（条数）
 *   以 500ms 节流合帧写入主 store 的低频字段；
 * - 环形缓冲容量与 logSlice 保持一致（200），避免双份长驻内存。
 *
 * @module state/transientLogStore
 */

import { useStore } from './index'
import type { ToolCallLogEntry } from './slices'

/** 日志环形缓冲容量（与 logSlice.LOG_CAPACITY 一致） */
const LOG_CAPACITY = 200

/** 摘要刷新间隔（合帧，避免高频 set） */
const FLUSH_INTERVAL_MS = 500

/** 环形缓冲（新日志在前） */
let buffer: ToolCallLogEntry[] = []

/** flush 定时器（惰性启动） */
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 一次性订阅者 */
const subscribers = new Set<(logs: ToolCallLogEntry[]) => void>()

/** 生成日志唯一标识 */
function generateLogId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 将摘要（条数）写入主 store 的低频字段（节流合帧） */
function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    // toolLogCount 为低频摘要字段；明细留在本模块缓冲，展开面板时拉取。
    // 延迟 require 风格访问：测试环境可能 mock 掉 useStore，缺失 setState 时静默跳过
    try {
      const store = (useStore as unknown as { setState?: (s: unknown) => void })
      store.setState?.({ toolLogCount: buffer.length })
    } catch {
      // 主 store 不可用（测试/销毁中）时摘要刷新失败不影响日志写入
    }
  }, FLUSH_INTERVAL_MS)
  // flushTimer 不阻止进程退出
  flushTimer.unref?.()
}

export const transientLogStore = {
  /** 追加一条工具调用日志（不触发 React 渲染） */
  add(entry: Omit<ToolCallLogEntry, 'id' | 'timestamp'>): void {
    const full: ToolCallLogEntry = {
      ...entry,
      id: generateLogId(),
      timestamp: new Date(),
    }
    buffer = [full, ...buffer].slice(0, LOG_CAPACITY)
    for (const cb of subscribers) {
      try {
        cb(buffer)
      } catch {
        // 单个订阅者异常不影响其他订阅者
      }
    }
    scheduleFlush()
  },

  /** 当前缓冲快照（UI 展开时拉取明细） */
  getLogs(): ToolCallLogEntry[] {
    return buffer
  },

  /** 订阅日志变更（返回取消函数） */
  subscribe(cb: (logs: ToolCallLogEntry[]) => void): () => void {
    subscribers.add(cb)
    return () => {
      subscribers.delete(cb)
    }
  },

  /** 清空（threadId 语义与 logSlice.clearToolCallLogs 一致） */
  clear(threadId?: string): void {
    buffer = threadId ? buffer.filter((l) => l.threadId !== threadId) : []
    scheduleFlush()
  },
}
