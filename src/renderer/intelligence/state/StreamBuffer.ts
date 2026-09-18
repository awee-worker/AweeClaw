/**
 * 流式响应节流缓冲区
 *
 * 用于优化高频更新：流式事件按 token 到达，若每次到达都写一次 store，
 * 每写一次都会重建消息数组并触发订阅方重渲染，代价按 token 数量线性放大。
 * 这里把到达的增量先按目标（消息 / 推理段）合并，再按固定节拍统一刷写。
 *
 * 文本与推理共用同一个定时器：两者在真实响应里往往同时推进，
 * 分成两个定时器会让刷写相位错开，反而把 store 写入次数翻倍。
 *
 * 刷写时机交给统一的帧调度器（streamFrameScheduler）：与平滑插值推进、吸底轮询
 * 落在同一个动画帧里，使一次用户可见的内容更新只对应一次 React 提交。
 */

import { scheduleFrameTask, cancelFrameTask, type FrameTask } from './streamFrameScheduler'

type FlushCallback = (messageId: string, content: string, threadId?: string) => void

type ReasoningFlushCallback = (
    messageId: string,
    partId: string,
    content: string,
    threadId?: string
) => void

interface PendingText {
    content: string
    threadId?: string
}

interface PendingReasoning {
    messageId: string
    partId: string
    content: string
    threadId?: string
}

class StreamThrottleBuffer {
    private pendingChunks: Map<string, PendingText> = new Map()
    private pendingReasoning: Map<string, PendingReasoning> = new Map()
    private flushCallback: FlushCallback | null = null
    private reasoningFlushCallback: ReasoningFlushCallback | null = null
    private readonly flushIntervalMs = 80

    /**
     * 帧任务引用
     *
     * 调度器以函数身份做去重键，因此这里必须只创建一次：每次重新生成箭头函数
     * 都会被当成一个全新的任务，合并与取消都会失效。
     */
    private readonly scheduledFlush: FrameTask = () => {
        this.flush()
    }

    setFlushCallback(callback: FlushCallback) {
        this.flushCallback = callback
    }

    setReasoningFlushCallback(callback: ReasoningFlushCallback) {
        this.reasoningFlushCallback = callback
    }

    append(messageId: string, content: string, threadId?: string): void {
        if (!content) return

        const existing = this.pendingChunks.get(messageId)

        if (existing) {
            this.pendingChunks.set(messageId, {
                content: existing.content + content,
                threadId: threadId || existing.threadId
            })
        } else {
            this.pendingChunks.set(messageId, { content, threadId })
        }

        // 优化：第一次数据立即刷新，后续数据节流
        this.scheduleFlush()
    }

    appendReasoning(
        messageId: string,
        partId: string,
        content: string,
        threadId?: string
    ): void {
        if (!content) return

        const key = `${messageId}::${partId}`
        const existing = this.pendingReasoning.get(key)

        if (existing) {
            existing.content += content
            if (threadId) existing.threadId = threadId
        } else {
            this.pendingReasoning.set(key, {
                messageId,
                partId,
                content,
                threadId
            })
        }

        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        // 节拍仍由本缓冲决定（合并语义不变：登记期间不会重复刷写），但执行时机
        // 交给共享帧循环，与平滑插值推进、吸底轮询落在同一帧。
        scheduleFrameTask(this.scheduledFlush, this.flushIntervalMs)
    }

    private flush(): void {
        const textUpdates = new Map(this.pendingChunks)
        const reasoningUpdates = new Map(this.pendingReasoning)
        this.pendingChunks.clear()
        this.pendingReasoning.clear()

        if (textUpdates.size === 0 && reasoningUpdates.size === 0) return

        if (this.flushCallback) {
            textUpdates.forEach(({ content, threadId }, messageId) => {
                if (content) {
                    this.flushCallback!(messageId, content, threadId)
                }
            })
        }

        if (this.reasoningFlushCallback) {
            reasoningUpdates.forEach(({ messageId, partId, content, threadId }) => {
                if (content) {
                    this.reasoningFlushCallback!(messageId, partId, content, threadId)
                }
            })
        }
    }

    flushNow(): void {
        cancelFrameTask(this.scheduledFlush)
        this.flush()
    }

    clear(): void {
        cancelFrameTask(this.scheduledFlush)
        this.pendingChunks.clear()
        this.pendingReasoning.clear()
    }
}

// 单例实例
export const streamingBuffer = new StreamThrottleBuffer()

// 导出刷新函数，供外部在关键时刻调用
export function flushStreamingBuffer(): void {
    streamingBuffer.flushNow()
}
