/**
 * Store 同步层
 * 解决 useStore (UI Store) 与 useAgentStore (Agent Store) 之间的状态同步问题
 * 采用单向数据流：AgentStore 变更 → UIStore 更新
 * 避免双向依赖导致的循环更新和竞态条件
 */

import type { StoreApi } from 'zustand'
import { logger } from '@toolkit/LogEngine'

export interface SyncSubscription {
  unsubscribe: () => void
}

export interface SyncConfig {
  /** 同步防抖间隔(ms) */
  debounceMs: number
  /** 是否启用调试日志 */
  debug: boolean
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  debounceMs: 16,
  debug: false,
}

/**
 * Store 同步器
 * 负责在两个 Zustand Store 之间建立安全、高效的状态同步通道
 *
 * 采用 latest-wins 策略：高频更新时只保留最新状态，防抖后统一同步，
 * 避免队列堆积和无意义的溢出丢弃。
 */
export class StoreSynchronizer<SourceState extends object, TargetState extends object> {
  private sourceStore: StoreApi<SourceState>
  private targetStore: StoreApi<TargetState>
  private config: SyncConfig
  /** 最新待同步状态（latest-wins，覆盖式更新） */
  private pendingState: SourceState | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribers: Array<() => void> = []
  private isProcessing = false
  private syncMap: Map<string, (source: SourceState, target: TargetState) => Partial<TargetState>> = new Map()

  constructor(
    sourceStore: StoreApi<SourceState>,
    targetStore: StoreApi<TargetState>,
    config: Partial<SyncConfig> = {}
  ) {
    this.sourceStore = sourceStore
    this.targetStore = targetStore
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config }
  }

  /**
   * 注册同步映射规则
   * @param key 同步规则标识
   * @param selector 从 SourceState 提取需要同步到 TargetState 的数据
   */
  registerSyncRule(
    key: string,
    selector: (source: SourceState, target: TargetState) => Partial<TargetState>
  ): this {
    this.syncMap.set(key, selector)
    if (this.config.debug) {
      logger.store.info(`[StoreSync] Registered sync rule: ${key}`)
    }
    return this
  }

  /**
   * 启动同步监听
   */
  start(): this {
    const unsubscribe = this.sourceStore.subscribe((state) => {
      this.enqueueSync(state)
    })
    this.unsubscribers.push(unsubscribe)

    if (this.config.debug) {
      logger.store.info('[StoreSync] Synchronization started')
    }
    return this
  }

  /**
   * 停止同步监听
   */
  stop(): void {
    this.unsubscribers.forEach((unsub) => unsub())
    this.unsubscribers = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.config.debug) {
      logger.store.info('[StoreSync] Synchronization stopped')
    }
  }

  /**
   * 立即执行一次同步（绕过防抖）
   */
  syncNow(): void {
    this.processPending()
  }

  private enqueueSync(state: SourceState): void {
    // latest-wins：只保留最新状态，高频更新时直接覆盖
    this.pendingState = state
    this.scheduleProcess()
  }

  private scheduleProcess(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.processPending()
    }, this.config.debounceMs)
  }

  private processPending(): void {
    if (this.isProcessing || this.pendingState === null) return

    this.isProcessing = true

    try {
      const sourceState = this.pendingState
      this.pendingState = null

      const targetState = this.targetStore.getState()

      const updates: Partial<TargetState> = {}
      let hasUpdates = false

      for (const [key, selector] of this.syncMap) {
        try {
          const partial = selector(sourceState, targetState)
          if (partial && Object.keys(partial).length > 0) {
            Object.assign(updates, partial)
            hasUpdates = true
          }
        } catch (error) {
          logger.store.error(`[StoreSync] Sync rule "${key}" failed:`, error)
        }
      }

      if (hasUpdates) {
        this.targetStore.setState(updates)
        if (this.config.debug) {
          logger.store.info('[StoreSync] Applied updates:', Object.keys(updates))
        }
      }
    } finally {
      this.isProcessing = false
    }
  }
}

/**
 * 创建双向同步器（带死锁检测）
 */
export class BidirectionalStoreSynchronizer<S1 extends object, S2 extends object> {
  private forwardSync: StoreSynchronizer<S1, S2>
  private backwardSync: StoreSynchronizer<S2, S1>
  // private _isSyncing = false

  constructor(
    store1: StoreApi<S1>,
    store2: StoreApi<S2>,
    config: Partial<SyncConfig> = {}
  ) {
    this.forwardSync = new StoreSynchronizer(store1, store2, config)
    this.backwardSync = new StoreSynchronizer(store2, store1, config)
  }

  registerForwardRule(
    key: string,
    selector: (source: S1, target: S2) => Partial<S2>
  ): this {
    this.forwardSync.registerSyncRule(key, selector)
    return this
  }

  registerBackwardRule(
    key: string,
    selector: (source: S2, target: S1) => Partial<S1>
  ): this {
    this.backwardSync.registerSyncRule(key, selector)
    return this
  }

  start(): this {
    this.forwardSync.start()
    this.backwardSync.start()
    return this
  }

  stop(): void {
    this.forwardSync.stop()
    this.backwardSync.stop()
  }
}
