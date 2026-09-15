/**
 * 随机话题场景探测器（P2-3 新增）
 *
 * 主动发起有质量的话题，喂给现有主动行为体系。
 * 支持按 mood/depth/category/exclude 参数生成话题。
 *
 * 数据流：
 *   topicBank（本地话题库）或 LLM 生成 → RandomTopicDetector.detect()
 *     → ScenarioSignal[] → ProactiveDecisionEngine → ProactiveProposal
 *
 * @module proactive/scenarios/RandomTopicScenario
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  type ScenarioDetector,
  type ScenarioSignal,
  type ProactiveSource,
} from '../ProactiveInterface'
import { activityTracker } from './ActivityTracker'
import {
  getRandomTopics,
  type TopicMood,
  type TopicDepth,
  type TopicCategory,
  type TopicItem,
} from './topics/topicBank'

// ============================================================
// 常量
// ============================================================

/** 默认单日话题上限 */
const DEFAULT_DAILY_LIMIT = 3

/** 默认话题深度 */
const DEFAULT_DEPTH: TopicDepth = 2

/** 话题冷却时间（ms，同一话题不重复的最小间隔） */
const TOPIC_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 小时

/** 探测器检查间隔（ms） */
const DETECT_INTERVAL_MS = 30 * 60 * 1000 // 30 分钟

/** 空闲阈值（ms，用户空闲超过此时间才触发话题） */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 分钟

/** 去重缓存最大容量 */
const MAX_DEDUP_CACHE_SIZE = 50

// ============================================================
// 类型定义
// ============================================================

/** 随机话题配置 */
export interface RandomTopicConfig {
  /** 是否启用 */
  enabled: boolean
  /** 情绪倾向 */
  mood?: TopicMood
  /** 话题深度（1-3） */
  depth?: TopicDepth
  /** 分类 */
  category?: TopicCategory
  /** 排除项（避免重复/不感兴趣的话题） */
  exclude?: string[]
  /** 单次生成条数 */
  count?: number
  /** 单日话题上限 */
  dailyLimit?: number
}

/** 去重缓存条目 */
interface DedupEntry {
  /** 话题文本指纹（关键词或哈希） */
  fingerprint: string
  /** 使用时间戳 */
  usedAt: number
}

/** 每日统计 */
interface DailyStats {
  /** 日期（YYYY-MM-DD） */
  date: string
  /** 已发送话题数 */
  count: number
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 生成话题指纹（简单哈希）
 * @param text 话题文本
 * @returns 指纹字符串
 */
function generateFingerprint(text: string): string {
  // 简单哈希：取前 50 个字符 + 长度
  const normalized = text.replace(/\s+/g, '').slice(0, 50)
  return `${normalized}_${text.length}`
}

/**
 * 获取今日日期字符串（YYYY-MM-DD）
 */
function getTodayString(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 检查是否在勿扰时段（简化实现）
 * 默认不检查，由 ProactivePermission 统一管控
 */
function isInQuietHours(): boolean {
  // 由 ProactivePermission 统一管控，此处不重复检查
  return false
}

// ============================================================
// RandomTopicDetector 类
// ============================================================

/**
 * 随机话题探测器
 *
 * 触发条件：
 * 1. 用户空闲超过 5 分钟
 * 2. 今日话题数未达上限
 * 3. 不在勿扰时段
 * 4. 30 分钟内未触发过
 *
 * 行动：chat（发起话题对话）
 */
export class RandomTopicDetector implements ScenarioDetector {
  readonly name = 'RandomTopicDetector'
  readonly source: ProactiveSource = 'time'

  /** 配置 */
  private config: RandomTopicConfig = {
    enabled: false,
    depth: DEFAULT_DEPTH,
    count: 1,
    dailyLimit: DEFAULT_DAILY_LIMIT,
  }

  /** 去重缓存 */
  private dedupCache: DedupEntry[] = []

  /** 每日统计 */
  private dailyStats: DailyStats = {
    date: getTodayString(),
    count: 0,
  }

  /** 上次探测时间 */
  private lastDetectAt: number = 0

  /** 上次触发时间 */
  private lastTriggerAt: number = 0

  // ============================================================
  // 配置管理
  // ============================================================

  /**
   * 更新配置
   * @param config 新配置（部分更新）
   */
  updateConfig(config: Partial<RandomTopicConfig>): void {
    this.config = { ...this.config, ...config }
    logger.proactive?.info('[RandomTopicDetector] 配置已更新:', this.config)
  }

  /**
   * 获取当前配置
   */
  getConfig(): RandomTopicConfig {
    return { ...this.config }
  }

  /**
   * 添加排除话题
   * @param topic 要排除的话题文本
   */
  addExclude(topic: string): void {
    if (!this.config.exclude) {
      this.config.exclude = []
    }
    if (!this.config.exclude.includes(topic)) {
      this.config.exclude.push(topic)
    }
  }

  /**
   * 移除排除话题
   * @param topic 要移除的话题文本
   */
  removeExclude(topic: string): void {
    if (!this.config.exclude) return
    this.config.exclude = this.config.exclude.filter((t) => t !== topic)
  }

  // ============================================================
  // 去重管理
  // ============================================================

  /**
   * 检查话题是否在冷却期
   * @param topic 话题文本
   * @returns 是否在冷却期
   */
  private isInCooldown(topic: string): boolean {
    const fingerprint = generateFingerprint(topic)
    const now = Date.now()

    return this.dedupCache.some(
      (entry) =>
        entry.fingerprint === fingerprint && now - entry.usedAt < TOPIC_COOLDOWN_MS,
    )
  }

  /**
   * 记录话题使用
   * @param topic 话题文本
   */
  private recordUsage(topic: string): void {
    const fingerprint = generateFingerprint(topic)
    const now = Date.now()

    // 添加到缓存
    this.dedupCache.push({
      fingerprint,
      usedAt: now,
    })

    // 清理过期缓存
    this.dedupCache = this.dedupCache.filter(
      (entry) => now - entry.usedAt < TOPIC_COOLDOWN_MS,
    )

    // 限制缓存大小
    if (this.dedupCache.length > MAX_DEDUP_CACHE_SIZE) {
      this.dedupCache = this.dedupCache.slice(-MAX_DEDUP_CACHE_SIZE)
    }

    // 更新每日统计
    this.updateDailyStats()
    this.dailyStats.count++
  }

  /**
   * 更新每日统计（跨日重置）
   */
  private updateDailyStats(): void {
    const today = getTodayString()
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        date: today,
        count: 0,
      }
    }
  }

  /**
   * 检查是否达到每日上限
   * @returns 是否达到上限
   */
  private isDailyLimitReached(): boolean {
    this.updateDailyStats()
    const limit = this.config.dailyLimit ?? DEFAULT_DAILY_LIMIT
    return this.dailyStats.count >= limit
  }

  // ============================================================
  // 探测逻辑
  // ============================================================

  /**
   * 探测场景信号
   * @returns 候选信号列表（空数组表示当前无信号）
   */
  async detect(): Promise<ScenarioSignal[]> {
    try {
      // 1. 检查是否启用
      if (!this.config.enabled) {
        return []
      }

      // 2. 频率控制：30 分钟内不重复探测
      const now = Date.now()
      if (now - this.lastDetectAt < DETECT_INTERVAL_MS) {
        return []
      }
      this.lastDetectAt = now

      // 3. 检查每日上限
      if (this.isDailyLimitReached()) {
        logger.proactive?.debug('[RandomTopicDetector] 已达每日话题上限')
        return []
      }

      // 4. 检查用户是否空闲（避免打断专注）
      const idleMs = activityTracker.getIdleMs()
      if (idleMs < IDLE_THRESHOLD_MS) {
        logger.proactive?.debug('[RandomTopicDetector] 用户活跃，跳过')
        return []
      }

      // 5. 检查勿扰时段
      if (isInQuietHours()) {
        return []
      }

      // 6. 获取话题
      const topics = this.selectTopics()
      if (topics.length === 0) {
        logger.proactive?.warn('[RandomTopicDetector] 无可用话题')
        return []
      }

      // 7. 生成信号
      const signals: ScenarioSignal[] = []
      for (const topic of topics) {
        // 检查去重
        if (this.isInCooldown(topic.text)) {
          logger.proactive?.debug('[RandomTopicDetector] 话题在冷却期:', topic.text)
          continue
        }

        // 记录使用
        this.recordUsage(topic.text)

        // 生成信号
        const signal: ScenarioSignal = {
          source: 'time',
          trigger: `random_topic:${topic.category}:${topic.depth}`,
          severity: 'info',
          title: '随机话题',
          description: topic.text,
          action: {
            type: 'chat',
            payload: this.buildTopicPayload(topic),
          },
          confidence: 0.7,
          reason: `用户空闲 ${Math.round(idleMs / 60000)} 分钟，触发随机话题（分类：${topic.category}，深度：${topic.depth}）`,
          dedupKey: `random_topic:${generateFingerprint(topic.text)}`,
        }

        signals.push(signal)
        this.lastTriggerAt = now
      }

      if (signals.length > 0) {
        logger.proactive?.info(`[RandomTopicDetector] 生成 ${signals.length} 个话题信号`)
      }

      return signals
    } catch (e) {
      logger.proactive?.warn('[RandomTopicDetector] 探测失败:', e)
      return []
    }
  }

  /**
   * 选择话题
   * @returns 话题列表
   */
  private selectTopics(): TopicItem[] {
    const {
      mood,
      depth,
      category,
      exclude,
      count = 1,
    } = this.config

    // 合并排除项（配置 + 去重缓存）
    const allExclude = [
      ...(exclude || []),
      ...this.dedupCache.map((entry) => entry.fingerprint),
    ]

    // 从话题库随机抽取
    const topics = getRandomTopics(
      {
        mood,
        depth,
        category,
        exclude: allExclude,
      },
      count,
    )

    return topics
  }

  /**
   * 构建话题载荷
   * @param topic 话题
   * @returns 载荷字符串
   */
  private buildTopicPayload(topic: TopicItem): string {
    let payload = `话题：${topic.text}`

    if (topic.starter) {
      payload += `\n\n引导：${topic.starter}`
    }

    payload += `\n\n分类：${topic.category}`
    payload += `\n深度：${'⭐'.repeat(topic.depth)}`
    payload += `\n情绪：${topic.mood}`

    payload += `\n\n请自然地发起这个话题，可以先分享自己的看法，然后引导用户参与讨论。`

    return payload
  }

  // ============================================================
  // 统计与调试
  // ============================================================

  /**
   * 获取今日已用话题数
   */
  getTodayUsedCount(): number {
    this.updateDailyStats()
    return this.dailyStats.count
  }

  /**
   * 获取去重缓存大小
   */
  getDedupCacheSize(): number {
    return this.dedupCache.length
  }

  /**
   * 清空去重缓存（调试用）
   */
  clearDedupCache(): void {
    this.dedupCache = []
    logger.proactive?.info('[RandomTopicDetector] 去重缓存已清空')
  }

  /**
   * 重置每日统计（调试用）
   */
  resetDailyStats(): void {
    this.dailyStats = {
      date: getTodayString(),
      count: 0,
    }
    logger.proactive?.info('[RandomTopicDetector] 每日统计已重置')
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(): {
    config: RandomTopicConfig
    dailyStats: DailyStats
    dedupCacheSize: number
    lastDetectAt: number
    lastTriggerAt: number
    } {
    return {
      config: this.config,
      dailyStats: { ...this.dailyStats },
      dedupCacheSize: this.dedupCache.length,
      lastDetectAt: this.lastDetectAt,
      lastTriggerAt: this.lastTriggerAt,
    }
  }
}

// ============================================================
// 导出单例
// ============================================================

export const randomTopicDetector = new RandomTopicDetector()