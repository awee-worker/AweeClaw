/**
 * 任务控制中转（steer 队列 + 接管处置）
 *
 * 移动端在任务运行中发来的两类消息都走这里，但它们的消费时机不同：
 *
 * - 补充说明（steer）：不能在收到的瞬间就丢给模型 —— 模型此刻可能正在一次
 *   工具调用中间，插进去会打断正在跑的批次。正确做法是先入队，等执行层
 *   走到工具批次边界时一次性取走（drainSteers），再作为一条用户消息注入。
 * - 接管处置（takeover-resolve）：必须立刻交给执行层，它正卡在等待上。
 *   同时留一份缓冲，供执行层在注册监听之前先把已有结论取走（takeResolve），
 *   避免「刚收到就渲染完成、监听还没挂上」这种时序把结论丢掉。
 *
 * 单任务队列上限与去重规则与协议常量一致：同一 steerId 只认一次，
 * 重复投递（网络重试、用户连点）不会变成两条插话。
 *
 * @module device-link/TaskControlHub
 */
import { logger } from '@shared/toolkit/LogEngine'
import {
  STEER_MAX_LENGTH,
  STEER_MAX_PER_TASK,
  type TakeoverOutcome,
} from '@shared/protocols/deviceTaskProtocol'

/** 队列中的一条补充说明 */
export interface QueuedSteer {
  steerId: string
  text: string
  receivedAt: number
}

/** 一条接管处置 */
export interface IncomingTakeoverResolve {
  outcome: Exclude<TakeoverOutcome, 'timeout'>
  note?: string
  receivedAt: number
}

/** 入队结果 */
export interface SteerEnqueueResult {
  accepted: boolean
  /** 拒绝原因：duplicate / too_long / empty / queue_full */
  reason?: 'duplicate' | 'too_long' | 'empty' | 'queue_full'
}

/** 取走补充说明后的回调（由客户端负责回执 adopted 并投递给 renderer） */
export interface TaskControlSink {
  onSteer(taskId: string, steer: QueuedSteer): void
  onTakeoverResolve(taskId: string, resolve: IncomingTakeoverResolve): void
}

class TaskControlHub {
  /** taskId → 待取走的补充说明（先进先出） */
  private readonly steers = new Map<string, QueuedSteer[]>()
  /** taskId → 已见过的 steerId，用于去重 */
  private readonly seenSteerIds = new Map<string, Set<string>>()
  /** taskId → 最近一条接管处置（只保留最新，连点不会堆积） */
  private readonly resolves = new Map<string, IncomingTakeoverResolve>()

  private sink: TaskControlSink | null = null

  setSink(sink: TaskControlSink | null): void {
    this.sink = sink
  }

  /**
   * 补充说明入队
   *
   * 不做任何业务判断，只保证队列本身是干净的：去重、限长、限量。
   */
  enqueueSteer(taskId: string, steerId: string, rawText: string): SteerEnqueueResult {
    if (!taskId || !steerId) return { accepted: false, reason: 'empty' }
    const text = (rawText ?? '').trim()
    if (!text) return { accepted: false, reason: 'empty' }
    if (text.length > STEER_MAX_LENGTH) return { accepted: false, reason: 'too_long' }

    const seen = this.seenSteerIds.get(taskId) ?? new Set<string>()
    if (seen.has(steerId)) return { accepted: false, reason: 'duplicate' }

    const queue = this.steers.get(taskId) ?? []
    if (queue.length >= STEER_MAX_PER_TASK) return { accepted: false, reason: 'queue_full' }

    seen.add(steerId)
    this.seenSteerIds.set(taskId, seen)
    const steer: QueuedSteer = { steerId, text, receivedAt: Date.now() }
    queue.push(steer)
    this.steers.set(taskId, queue)

    logger.deviceLink.info(`[TaskControl] Steer queued task=${taskId} pending=${queue.length}`)
    try {
      this.sink?.onSteer(taskId, steer)
    } catch (err) {
      logger.deviceLink.warn(`[TaskControl] Steer sink failed: ${(err as Error).message}`)
    }
    return { accepted: true }
  }

  /**
   * 取走全部待处理补充说明（工具批次边界调用）
   *
   * 取走即视为已注入：调用方拿到返回值后应立即回执 adopted。
   */
  drainSteers(taskId: string): QueuedSteer[] {
    const queue = this.steers.get(taskId)
    if (!queue || queue.length === 0) return []
    this.steers.delete(taskId)
    logger.deviceLink.info(`[TaskControl] Drained ${queue.length} steer(s) task=${taskId}`)
    return queue
  }

  /** 当前待处理的补充说明条数（不含内容，供状态展示） */
  pendingSteerCount(taskId: string): number {
    return this.steers.get(taskId)?.length ?? 0
  }

  /** 记录一条接管处置，并立即通知执行层 */
  pushTakeoverResolve(
    taskId: string,
    outcome: Exclude<TakeoverOutcome, 'timeout'>,
    note?: string,
  ): IncomingTakeoverResolve {
    const resolve: IncomingTakeoverResolve = { outcome, note, receivedAt: Date.now() }
    this.resolves.set(taskId, resolve)
    logger.deviceLink.info(`[TaskControl] Takeover resolve task=${taskId} outcome=${outcome}`)
    try {
      this.sink?.onTakeoverResolve(taskId, resolve)
    } catch (err) {
      logger.deviceLink.warn(`[TaskControl] Resolve sink failed: ${(err as Error).message}`)
    }
    return resolve
  }

  /** 取走并清空该任务最近的接管处置（无则 null） */
  takeTakeoverResolve(taskId: string): IncomingTakeoverResolve | null {
    const resolve = this.resolves.get(taskId)
    if (!resolve) return null
    this.resolves.delete(taskId)
    return resolve
  }

  /** 任务结束：清掉队列、去重表与残留处置 */
  clearTask(taskId: string): void {
    this.steers.delete(taskId)
    this.seenSteerIds.delete(taskId)
    this.resolves.delete(taskId)
  }

  /** 连接重建或退出时整体清理 */
  clearAll(): void {
    this.steers.clear()
    this.seenSteerIds.clear()
    this.resolves.clear()
  }
}

export const taskControlHub = new TaskControlHub()
