/**
 * ScenarioDataBus - 场景间数据交互总线
 *
 * 提供场景间的发布/订阅消息通信和共享数据空间。
 * 场景通过 context.publishData / context.subscribeData 进行消息通信，
 * 通过 context.setSharedData / context.getSharedData 进行数据共享。
 *
 * 特性：
 * - 发布/订阅消息模式：场景可发布和订阅特定类型的消息
 * - 共享数据空间：场景可读写共享键值对，支持只读标记和版本追踪
 * - 定向发送：消息可指定目标场景，也可广播
 * - 自动清理：场景卸载时自动清除其订阅和共享数据
 * - 消息历史：保留最近的消息历史，便于新订阅者回溯
 */

import type {
  ScenarioDataMessage,
  ScenarioDataSubscription,
  ScenarioSharedDataEntry,
} from '@shared/protocols/scenario-arch'
import { logger } from '@shared/toolkit/LogEngine'

const MAX_MESSAGE_HISTORY = 100
const MAX_SHARED_DATA_ENTRIES = 500

class ScenarioDataBusClass {
  private subscriptions = new Map<string, ScenarioDataSubscription>()
  private sharedData = new Map<string, ScenarioSharedDataEntry>()
  private messageHistory: ScenarioDataMessage[] = []
  private scenarioSubscriptions = new Map<string, Set<string>>()
  private scenarioSharedDataKeys = new Map<string, Set<string>>()

  publish(
    sourceScenarioId: string,
    type: string,
    payload: unknown,
    targetScenarioId?: string
  ): void {
    const message: ScenarioDataMessage = {
      type,
      sourceScenarioId,
      targetScenarioId,
      payload,
      timestamp: Date.now(),
    }

    this.messageHistory.push(message)
    if (this.messageHistory.length > MAX_MESSAGE_HISTORY) {
      this.messageHistory.shift()
    }

    this.dispatchMessage(message)
  }

  subscribe(
    scenarioId: string,
    messageType: string,
    handler: (message: ScenarioDataMessage) => void
  ): () => void {
    const id = `${scenarioId}::${messageType}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`
    const subscription: ScenarioDataSubscription = {
      id,
      scenarioId,
      messageType,
      handler,
    }

    this.subscriptions.set(id, subscription)

    if (!this.scenarioSubscriptions.has(scenarioId)) {
      this.scenarioSubscriptions.set(scenarioId, new Set())
    }
    this.scenarioSubscriptions.get(scenarioId)!.add(id)

    return () => {
      this.subscriptions.delete(id)
      const subs = this.scenarioSubscriptions.get(scenarioId)
      if (subs) {
        subs.delete(id)
        if (subs.size === 0) {
          this.scenarioSubscriptions.delete(scenarioId)
        }
      }
    }
  }

  setSharedData(
    ownerScenarioId: string,
    key: string,
    value: unknown,
    readOnly: boolean = false
  ): void {
    const existing = this.sharedData.get(key)
    if (existing && existing.readOnly && existing.ownerScenarioId !== ownerScenarioId) {
      logger.agent.warn(
        `[ScenarioDataBus] Cannot write read-only key "${key}" owned by "${existing.ownerScenarioId}"`
      )
      return
    }

    const entry: ScenarioSharedDataEntry = {
      key,
      value,
      ownerScenarioId,
      updatedAt: Date.now(),
      version: existing ? existing.version + 1 : 1,
      readOnly,
    }

    this.sharedData.set(key, entry)

    if (!this.scenarioSharedDataKeys.has(ownerScenarioId)) {
      this.scenarioSharedDataKeys.set(ownerScenarioId, new Set())
    }
    this.scenarioSharedDataKeys.get(ownerScenarioId)!.add(key)

    if (this.sharedData.size > MAX_SHARED_DATA_ENTRIES) {
      this.evictOldestSharedData()
    }
  }

  getSharedData(key: string): unknown {
    return this.sharedData.get(key)?.value
  }

  getSharedDataEntry(key: string): ScenarioSharedDataEntry | undefined {
    return this.sharedData.get(key)
  }

  removeSharedData(key: string, requesterScenarioId: string): boolean {
    const entry = this.sharedData.get(key)
    if (!entry) return false
    if (entry.readOnly && entry.ownerScenarioId !== requesterScenarioId) return false

    this.sharedData.delete(key)
    const keys = this.scenarioSharedDataKeys.get(entry.ownerScenarioId)
    if (keys) {
      keys.delete(key)
      if (keys.size === 0) {
        this.scenarioSharedDataKeys.delete(entry.ownerScenarioId)
      }
    }
    return true
  }

  getAllSharedData(): ScenarioSharedDataEntry[] {
    return Array.from(this.sharedData.values())
  }

  getSharedDataByOwner(scenarioId: string): ScenarioSharedDataEntry[] {
    const keys = this.scenarioSharedDataKeys.get(scenarioId)
    if (!keys) return []
    return Array.from(keys)
      .map(k => this.sharedData.get(k))
      .filter((e): e is ScenarioSharedDataEntry => e !== undefined)
  }

  getMessageHistory(messageType?: string, limit: number = 20): ScenarioDataMessage[] {
    let messages = this.messageHistory
    if (messageType) {
      messages = messages.filter(m => m.type === messageType)
    }
    return messages.slice(-limit)
  }

  cleanupScenario(scenarioId: string): void {
    const subIds = this.scenarioSubscriptions.get(scenarioId)
    if (subIds) {
      for (const id of subIds) {
        this.subscriptions.delete(id)
      }
      this.scenarioSubscriptions.delete(scenarioId)
    }

    const dataKeys = this.scenarioSharedDataKeys.get(scenarioId)
    if (dataKeys) {
      for (const key of dataKeys) {
        this.sharedData.delete(key)
      }
      this.scenarioSharedDataKeys.delete(scenarioId)
    }

    logger.agent.info(`[ScenarioDataBus] Cleaned up data for scenario: ${scenarioId}`)
  }

  getStats(): {
    subscriptionCount: number
    sharedDataCount: number
    messageHistoryCount: number
    scenarioCount: number
  } {
    return {
      subscriptionCount: this.subscriptions.size,
      sharedDataCount: this.sharedData.size,
      messageHistoryCount: this.messageHistory.length,
      scenarioCount: this.scenarioSubscriptions.size,
    }
  }

  private dispatchMessage(message: ScenarioDataMessage): void {
    for (const sub of this.subscriptions.values()) {
      if (sub.messageType !== '*' && sub.messageType !== message.type) continue
      if (message.targetScenarioId && message.targetScenarioId !== sub.scenarioId) continue
      if (message.sourceScenarioId === sub.scenarioId) continue

      try {
        sub.handler(message)
      } catch (err) {
        logger.agent.error(
          `[ScenarioDataBus] Error in subscription handler for "${sub.messageType}" in scenario "${sub.scenarioId}":`,
          err
        )
      }
    }
  }

  private evictOldestSharedData(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.sharedData) {
      if (!entry.readOnly && entry.updatedAt < oldestTime) {
        oldestTime = entry.updatedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this.sharedData.get(oldestKey)!
      this.sharedData.delete(oldestKey)
      const keys = this.scenarioSharedDataKeys.get(entry.ownerScenarioId)
      if (keys) {
        keys.delete(oldestKey)
      }
    }
  }
}

export const scenarioDataBus = new ScenarioDataBusClass()
