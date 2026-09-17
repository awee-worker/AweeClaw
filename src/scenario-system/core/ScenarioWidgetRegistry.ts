/**
 * ScenarioWidgetRegistry - 场景卡片注册表
 *
 * 管理场景仪表盘卡片的注册、注销和查询。
 * 场景激活时注册卡片，停用时自动清理。
 *
 * @module scenario-system/core/ScenarioWidgetRegistry
 */

import type { ComponentType } from 'react'
import type { ScenarioWidgetCardPreviewProps } from '@shared/protocols/scenario'
import type { ScenarioModule } from '@shared/protocols/scenario-arch'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 场景卡片注册条目
 */
export interface ScenarioWidgetCardEntry {
  /** 卡片唯一 ID */
  id: string
  /** 所属场景 ID */
  scenarioId: string
  /** 图标名 */
  icon: string
  /** 英文标题 */
  label: string
  /** 中文标题 */
  labelZh: string
  /** 英文描述 */
  description?: string
  /** 中文描述 */
  descriptionZh?: string
  /** 刷新优先级 */
  tier: 'core' | 'enhanced'
  /** 预览组件 */
  component: ComponentType<ScenarioWidgetCardPreviewProps>
  /** 场景模块引用（用于获取数据） */
  module: ScenarioModule
}

/**
 * 场景卡片注册表
 *
 * 单例模式，整个渲染进程共用一个实例。
 */
class ScenarioWidgetRegistryClass {
  private cards = new Map<string, ScenarioWidgetCardEntry>()
  private listeners = new Set<() => void>()

  /**
   * 注册场景卡片
   */
  registerCard(entry: ScenarioWidgetCardEntry): void {
    if (this.cards.has(entry.id)) {
      logger.agent.warn(`[ScenarioWidgetRegistry] Card "${entry.id}" already registered, replacing`)
    }
    this.cards.set(entry.id, entry)
    this.notifyListeners()
    logger.agent.info(`[ScenarioWidgetRegistry] Registered card: ${entry.id}`)
  }

  /**
   * 注销场景卡片
   */
  unregisterCard(cardId: string): void {
    if (this.cards.delete(cardId)) {
      this.notifyListeners()
      logger.agent.info(`[ScenarioWidgetRegistry] Unregistered card: ${cardId}`)
    }
  }

  /**
   * 注销场景的所有卡片
   */
  unregisterScenarioCards(scenarioId: string): void {
    let removed = false
    for (const [id, entry] of this.cards) {
      if (entry.scenarioId === scenarioId) {
        this.cards.delete(id)
        removed = true
      }
    }
    if (removed) {
      this.notifyListeners()
      logger.agent.info(`[ScenarioWidgetRegistry] Unregistered all cards for scenario: ${scenarioId}`)
    }
  }

  /**
   * 获取单个卡片
   */
  getCard(cardId: string): ScenarioWidgetCardEntry | undefined {
    return this.cards.get(cardId)
  }

  /**
   * 获取场景的所有卡片
   */
  getCardsByScenario(scenarioId: string): ScenarioWidgetCardEntry[] {
    return Array.from(this.cards.values()).filter(
      (card) => card.scenarioId === scenarioId
    )
  }

  /**
   * 获取所有卡片
   */
  getAllCards(): ScenarioWidgetCardEntry[] {
    return Array.from(this.cards.values())
  }

  /**
   * 订阅变化
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        logger.agent.error('[ScenarioWidgetRegistry] Listener error:', err)
      }
    }
  }
}

/** 全局单例 */
export const scenarioWidgetRegistry = new ScenarioWidgetRegistryClass()
