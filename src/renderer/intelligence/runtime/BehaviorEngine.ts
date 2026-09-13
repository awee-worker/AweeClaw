/**
 * 行为引擎 — 主动触发 AI 服务
 *
 * 支持三种触发类型：
 * - time: 基于时间的触发（如每天 9:00）
 * - noInput: 无操作超时触发（如空闲 30 分钟）
 * - cycle: 周期性触发（如每 2 小时）
 *
 * 适用于客户端自定义模式，无需后端依赖
 */

import { logger } from '@toolkit/LogEngine'

// ===== 类型定义 =====

export type TriggerType = 'time' | 'noInput' | 'cycle'

export type ActionType = 'prompt' | 'notify' | 'toolCall'

export interface BehaviorRule {
  id: string
  enabled: boolean
  name: string
  createdAt: number
  updatedAt: number
  trigger: {
    type: TriggerType
    config: {
      // time 类型配置
      time?: {
        value: string      // "HH:mm"
        days?: number[]    // 星期几 (0-6, 0=周日)
      }
      // noInput 类型配置
      noInput?: {
        latencyMs: number  // 毫秒
      }
      // cycle 类型配置
      cycle?: {
        intervalMs: number
        repeatCount?: number   // 重复次数，undefined 表示无限
        infinite?: boolean     // 是否无限循环
      }
    }
  }
  action: {
    type: ActionType
    prompt?: string           // AI 生成的主动消息内容（支持 {now} 模板变量）
    toolName?: string         // 直接调用的工具名
    toolArgs?: Record<string, unknown>
  }
}

export interface BehaviorRuleStore {
  rules: BehaviorRule[]
  lastActivityTime: number
}

// ===== 行为引擎核心 =====

export class BehaviorEngine {
  private rules: Map<string, BehaviorRule> = new Map()
  private timers: Map<string, number> = new Map()  // 用于防抖和时间跟踪
  private lastActivityTime: number = Date.now()
  private isRunning: boolean = false
  private tickInterval: number = 1000  // 1秒检查一次
  private ruleStoreKey: string = 'aweeclaw:behavior_rules'
  private activityKey: string = 'aweeclaw:last_activity_time'

  constructor(
    private onPromptGenerated?: (prompt: string, ruleId: string) => void,
    private onNotification?: (title: string, body: string) => void,
    private onToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>,
  ) {}

  /**
   * 启动行为引擎
   */
  start(): void {
    if (this.isRunning) return
    
    this.loadState()
    this.isRunning = true
    
    setInterval(() => this.tick(), this.tickInterval)
    logger.agent.info('[BehaviorEngine] Started')
  }

  /**
   * 停止行为引擎
   */
  stop(): void {
    this.isRunning = false
    this.saveState()
    logger.agent.info('[BehaviorEngine] Stopped')
  }

  /**
   * 添加规则
   */
  addRule(rule: Omit<BehaviorRule, 'id' | 'createdAt' | 'updatedAt'>): BehaviorRule {
    const now = Date.now()
    const newRule: BehaviorRule = {
      ...rule,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    this.rules.set(newRule.id, newRule)
    this.saveState()
    logger.agent.info(`[BehaviorEngine] Rule added: ${newRule.name}`)
    return newRule
  }

  /**
   * 更新规则
   */
  updateRule(id: string, updates: Partial<BehaviorRule>): BehaviorRule | null {
    const rule = this.rules.get(id)
    if (!rule) return null
    
    const updated: BehaviorRule = {
      ...rule,
      ...updates,
      updatedAt: Date.now(),
    }
    this.rules.set(id, updated)
    this.saveState()
    return updated
  }

  /**
   * 删除规则
   */
  deleteRule(id: string): boolean {
    const deleted = this.rules.delete(id)
    if (deleted) {
      this.saveState()
      logger.agent.info(`[BehaviorEngine] Rule deleted: ${id}`)
    }
    return deleted
  }

  /**
   * 启用/禁用规则
   */
  toggleRule(id: string, enabled: boolean): BehaviorRule | null {
    const rule = this.rules.get(id)
    if (!rule) return null
    
    const updated = this.updateRule(id, { enabled })
    if (updated) {
      logger.agent.info(`[BehaviorEngine] Rule ${enabled ? 'enabled' : 'disabled'}: ${rule.name}`)
    }
    return updated
  }

  /**
   * 获取所有规则
   */
  getAllRules(): BehaviorRule[] {
    return [...this.rules.values()]
  }

  /**
   * 获取单个规则
   */
  getRule(id: string): BehaviorRule | null {
    return this.rules.get(id) || null
  }

  /**
   * 记录用户活动（重置 noInput 计时器）
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now()
    this.saveState()
  }

  /**
   * 主循环
   */
  private tick(): void {
    if (!this.isRunning) return
    
    const now = Date.now()
    
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue
      
      try {
        this.checkTrigger(rule, now)
      } catch (err) {
        logger.agent.error(`[BehaviorEngine] Failed to check rule ${rule.id}:`, err)
      }
    }
  }

  /**
   * 检查触发条件
   */
  private checkTrigger(rule: BehaviorRule, now: number): void {
    switch (rule.trigger.type) {
      case 'noInput':
        this.checkNoInput(rule, now)
        break
      case 'time':
        this.checkTime(rule, now)
        break
      case 'cycle':
        this.checkCycle(rule, now)
        break
    }
  }

  /**
   * 检查 noInput 触发
   */
  private checkNoInput(rule: BehaviorRule, now: number): void {
    const idleMs = now - this.lastActivityTime
    const threshold = rule.trigger.config.noInput?.latencyMs ?? 0
    
    if (idleMs >= threshold) {
      this.fire(rule)
      // 重置计时器避免重复触发
      this.lastActivityTime = now
      this.saveState()
    }
  }

  /**
   * 检查 time 触发
   */
  private checkTime(rule: BehaviorRule, now: number): void {
    const timeConfig = rule.trigger.config.time
    if (!timeConfig) return
    
    const nowDate = new Date(now)
    const currentHour = nowDate.getHours().toString().padStart(2, '0')
    const currentMinute = nowDate.getMinutes().toString().padStart(2, '0')
    const currentTime = `${currentHour}:${currentMinute}`
    
    if (currentTime !== timeConfig.value) return
    
    // 检查星期几
    if (timeConfig.days && timeConfig.days.length > 0) {
      const currentDay = nowDate.getDay()
      if (!timeConfig.days.includes(currentDay)) return
    }
    
    // 防抖：同一分钟内只触发一次
    const key = `${rule.id}:${currentTime}`
    const lastFire = this.timers.get(key) ?? 0
    if (now - lastFire < 60000) return
    
    this.fire(rule)
    this.timers.set(key, now)
  }

  /**
   * 检查 cycle 触发
   */
  private checkCycle(rule: BehaviorRule, now: number): void {
    const cycleConfig = rule.trigger.config.cycle
    if (!cycleConfig) return
    
    const interval = cycleConfig.intervalMs
    const key = rule.id
    
    const lastFire = this.timers.get(key) ?? 0
    if (now - lastFire < interval) return
    
    // 检查重复次数限制
    if (!cycleConfig.infinite && cycleConfig.repeatCount) {
      const countKey = `${key}:count`
      const count = parseInt(localStorage.getItem(countKey) || '0')
      if (count >= cycleConfig.repeatCount) return
      localStorage.setItem(countKey, String(count + 1))
    }
    
    this.fire(rule)
    this.timers.set(key, now)
  }

  /**
   * 执行规则动作
   */
  private fire(rule: BehaviorRule): void {
    logger.agent.info(`[BehaviorEngine] Rule triggered: ${rule.name}`)
    
    switch (rule.action.type) {
      case 'prompt':
        this.generateAndPush(rule.action.prompt!, rule.id)
        break
      case 'notify':
        this.showNotification(rule.action.prompt!)
        break
      case 'toolCall':
        if (rule.action.toolName && this.onToolCall) {
          this.onToolCall(rule.action.toolName, rule.action.toolArgs ?? {})
        }
        break
    }
  }

  /**
   * 生成并推送 AI 主动消息
   */
  private generateAndPush(promptTemplate: string, ruleId: string): void {
    const userPrompt = promptTemplate
      .replace('{now}', new Date().toLocaleString('zh-CN'))
      .replace('{date}', new Date().toLocaleDateString('zh-CN'))
      .replace('{time}', new Date().toLocaleTimeString('zh-CN'))
    
    logger.agent.info(`[BehaviorEngine] Generating proactive message for rule: ${ruleId}`)
    
    if (this.onPromptGenerated) {
      this.onPromptGenerated(userPrompt, ruleId)
    }
  }

  /**
   * 显示系统通知
   */
  private showNotification(body: string): void {
    const title = 'AweeClaw'
    
    if (this.onNotification) {
      this.onNotification(title, body)
    }
    
    // 尝试使用原生通知 API
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }

  /**
   * 保存状态到 localStorage
   */
  private saveState(): void {
    try {
      const store: BehaviorRuleStore = {
        rules: [...this.rules.values()],
        lastActivityTime: this.lastActivityTime,
      }
      localStorage.setItem(this.ruleStoreKey, JSON.stringify(store))
      localStorage.setItem(this.activityKey, String(this.lastActivityTime))
    } catch (err) {
      logger.agent.warn('[BehaviorEngine] Failed to save state:', err)
    }
  }

  /**
   * 从 localStorage 加载状态
   */
  private loadState(): void {
    try {
      const stored = localStorage.getItem(this.ruleStoreKey)
      if (stored) {
        const store: BehaviorRuleStore = JSON.parse(stored)
        this.rules = new Map(store.rules.map(r => [r.id, r]))
        this.lastActivityTime = store.lastActivityTime || Date.now()
      }
      
      // 恢复最后活动时间
      const lastActivity = localStorage.getItem(this.activityKey)
      if (lastActivity) {
        this.lastActivityTime = parseInt(lastActivity)
      }
    } catch (err) {
      logger.agent.warn('[BehaviorEngine] Failed to load state:', err)
    }
  }
}

// ===== 单例导出 =====

let _instance: BehaviorEngine | null = null

export function getBehaviorEngine(): BehaviorEngine {
  if (!_instance) {
    _instance = new BehaviorEngine()
  }
  return _instance
}

export function setBehaviorEngine(engine: BehaviorEngine): void {
  _instance = engine
}
