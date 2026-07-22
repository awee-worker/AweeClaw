/**
 * 主动决策引擎 — 消费感知/预测/监控信号，生成主动提案
 *
 * 职责：
 * - 10s 节拍循环，并行采集 4 路信号：
 *   1. PerceptionFusionService.getEnvironmentContext() → insights + attentionScore
 *   2. BehaviorPredictor.predict() → predictions（依赖 scene 通道构造请求）
 *   3. MonitoringService.getRecentAnomalies() → anomalies
 *   4. 已注册的场景探测器 detect() → ScenarioSignal[]
 * - 规则引擎：信号 → ProactiveProposal 候选（按严重度 + 置信度）
 * - 去重/节流：同 dedupKey 在 30 分钟内不重复触发
 * - LLM 增强占位：通过 setRefiner() 注入（s10-03 实现）
 * - 通过 EventEmitter 发射 'proposal' 事件，由 ProactiveActionTrigger 消费（s10-04）
 *
 * 容错策略：
 * - 每路信号独立超时（3s），超时返回空数组，不影响其他信号
 * - 单路失败使用 Promise.allSettled 隔离
 * - 整体 evaluate 不抛错（节拍稳定性优先）
 *
 * @module proactive/ProactiveDecisionEngine
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import { PerceptionFusionService } from '../perception/PerceptionFusionService'
import { BehaviorPredictor } from '../perception/BehaviorPredictor'
import type { PredictRequest } from '../perception/BehaviorPredictor'
import type { ScreenActivity } from '../perception/PerceptionInterface'
import { MonitoringService } from '../monitoring/MonitoringService'
import type { AnomalyEvent } from '../monitoring/MonitoringInterface'
import type { CrossChannelInsight } from '../perception/PerceptionFusionService'
import {
  generateProactiveId,
  type ProactiveProposal,
  type ProactiveSeverity,
  type ScenarioDetector,
  type ScenarioSignal,
} from './ProactiveInterface'

// ============================================================
// 常量
// ============================================================

/** 决策引擎节拍间隔（ms） */
const TICK_INTERVAL_MS = 10_000

/** 单路信号采集超时（ms） */
const SIGNAL_TIMEOUT_MS = 3_000

/** 去重窗口（ms，同 dedupKey 30 分钟内不重复） */
const DEDUP_WINDOW_MS = 30 * 60 * 1000

/** 单次评估最多产出提案数（防止信号爆发导致 UI 洪水） */
const MAX_PROPOSALS_PER_TICK = 5

/** 去重缓存清理间隔（ms） */
const DEDUP_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

// ============================================================
// 类型定义
// ============================================================

/** LLM 增强器接口（s10-03 注入，失败降级到纯规则） */
export type ProposalRefiner = (
  candidates: ProactiveProposal[],
) => Promise<ProactiveProposal[]>

/** 决策引擎事件 */
export interface DecisionEngineEvents {
  /** 新提案产生（ProactiveActionTrigger 监听） */
  proposal: (proposal: ProactiveProposal) => void
  /** 节拍开始（调试用） */
  tick: (timestamp: number) => void
  /** 节拍结束（调试用） */
  tickComplete: (timestamp: number, proposalCount: number, durationMs: number) => void
  /** 引擎启动 */
  started: () => void
  /** 引擎停止 */
  stopped: () => void
}

/** 单次评估采集的原始信号集合 */
interface RawSignals {
  /** 融合洞察 */
  insights: CrossChannelInsight[]
  /** 注意力分数 */
  attentionScore: number
  /** 行为预测（已转 ScenarioSignal） */
  predictions: ScenarioSignal[]
  /** 监控异常（已转 ScenarioSignal） */
  anomalies: ScenarioSignal[]
  /** 场景探测器信号 */
  scenarioSignals: ScenarioSignal[]
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 给 Promise 加超时保护（超时返回 fallback 值，不 reject）
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label: string,
): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        setTimeout(() => {
          logger.proactive?.warn(`[ProactiveDecisionEngine] 信号采集超时: ${label} (${timeoutMs}ms)`)
          resolve(fallback)
        }, timeoutMs)
      }),
    ])
  } catch (err) {
    logger.proactive?.warn(
      `[ProactiveDecisionEngine] 信号采集失败: ${label} - ${err instanceof Error ? err.message : String(err)}`,
    )
    return fallback
  }
}

/** ScreenActivity 合法值集合（用于运行时校验） */
const VALID_SCREEN_ACTIVITIES: ReadonlySet<string> = new Set([
  'coding', 'browsing', 'chatting', 'reading', 'writing', 'debugging', 'idle', 'unknown',
])

/**
 * 将 string 安全转换为 ScreenActivity
 * 非法值回退为 'unknown'，保证 PredictRequest 类型安全
 */
function toScreenActivity(value: string): ScreenActivity {
  return VALID_SCREEN_ACTIVITIES.has(value) ? (value as ScreenActivity) : 'unknown'
}

// ============================================================
// 决策引擎实现
// ============================================================

class ProactiveDecisionEngine extends EventEmitter {
  private static instance: ProactiveDecisionEngine | null = null

  /** 节拍定时器 */
  private tickTimer: ReturnType<typeof setInterval> | null = null

  /** 去重缓存清理定时器 */
  private dedupCleanupTimer: ReturnType<typeof setInterval> | null = null

  /** 是否正在运行 */
  private running = false

  /** 是否正在评估（防止节拍重叠） */
  private evaluating = false

  /** 已注册的场景探测器 */
  private readonly detectors: ScenarioDetector[] = []

  /** LLM 增强器（可选，s10-03 注入） */
  private refiner: ProposalRefiner | null = null

  /** 去重缓存（dedupKey → createdAt） */
  private readonly recentProposals = new Map<string, number>()

  private constructor() {
    super()
  }

  static getInstance(): ProactiveDecisionEngine {
    if (!ProactiveDecisionEngine.instance) {
      ProactiveDecisionEngine.instance = new ProactiveDecisionEngine()
    }
    return ProactiveDecisionEngine.instance
  }

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 启动决策引擎节拍
   * 幂等：重复调用安全
   */
  start(): void {
    if (this.running) {
      logger.proactive?.debug('[ProactiveDecisionEngine] 已在运行，忽略重复 start')
      return
    }
    this.running = true

    // 立即触发首次评估（不等 10s）
    this.evaluate().catch((err) => {
      logger.proactive?.error(
        `[ProactiveDecisionEngine] 首次评估异常: ${err instanceof Error ? err.message : String(err)}`,
      )
    })

    // 节拍循环
    this.tickTimer = setInterval(() => {
      this.evaluate().catch((err) => {
        logger.proactive?.error(
          `[ProactiveDecisionEngine] 节拍评估异常: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }, TICK_INTERVAL_MS)

    // 去重缓存定期清理
    this.dedupCleanupTimer = setInterval(
      () => this.cleanupDedupCache(),
      DEDUP_CLEANUP_INTERVAL_MS,
    )

    this.emit('started')
    logger.proactive?.info(`[ProactiveDecisionEngine] 已启动，节拍 ${TICK_INTERVAL_MS}ms`)
  }

  /**
   * 停止决策引擎
   * 幂等：重复调用安全
   */
  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.dedupCleanupTimer) {
      clearInterval(this.dedupCleanupTimer)
      this.dedupCleanupTimer = null
    }

    this.emit('stopped')
    logger.proactive?.info('[ProactiveDecisionEngine] 已停止')
  }

  /** 是否正在运行 */
  isRunning(): boolean {
    return this.running
  }

  // ============================================
  // 场景探测器注册（s10-08/s10-09 使用）
  // ============================================

  /**
   * 注册场景探测器
   * @param detector 探测器实例
   */
  registerScenarioDetector(detector: ScenarioDetector): void {
    if (this.detectors.some((d) => d.name === detector.name)) {
      logger.proactive?.warn(`[ProactiveDecisionEngine] 探测器已存在，忽略重复注册: ${detector.name}`)
      return
    }
    this.detectors.push(detector)
    logger.proactive?.info(`[ProactiveDecisionEngine] 已注册场景探测器: ${detector.name} (${detector.source})`)
  }

  /** 注销场景探测器 */
  unregisterScenarioDetector(name: string): boolean {
    const idx = this.detectors.findIndex((d) => d.name === name)
    if (idx < 0) return false
    this.detectors.splice(idx, 1)
    logger.proactive?.info(`[ProactiveDecisionEngine] 已注销场景探测器: ${name}`)
    return true
  }

  // ============================================
  // LLM 增强器注入（s10-03 使用）
  // ============================================

  /**
   * 设置 LLM 增强器
   * 设置后，每次评估的候选提案会先经过 refiner 再输出
   * @param refiner 增强函数（null 表示移除，降级纯规则）
   */
  setRefiner(refiner: ProposalRefiner | null): void {
    this.refiner = refiner
    logger.proactive?.info(
      refiner ? '[ProactiveDecisionEngine] LLM 增强器已注入' : '[ProactiveDecisionEngine] LLM 增强器已移除（降级纯规则）',
    )
  }

  // ============================================
  // 核心评估流程
  // ============================================

  /**
   * 单次评估（节拍触发或外部手动触发）
   *
   * 流程：采集信号 → 规则引擎 → 去重 → LLM 增强 → 发射提案
   *
   * 幂等保护：若上一次评估未完成，本次跳过
   */
  async evaluate(): Promise<ProactiveProposal[]> {
    // 防止节拍重叠
    if (this.evaluating) {
      logger.proactive?.debug('[ProactiveDecisionEngine] 上一次评估未完成，跳过本次节拍')
      return []
    }

    this.evaluating = true
    const startTs = Date.now()
    this.emit('tick', startTs)

    try {
      // 1. 并行采集 4 路信号
      const signals = await this.collectSignals()

      // 2. 规则引擎：信号 → 候选提案
      const candidates = this.ruleEngine(signals)

      // 3. 去重
      const deduped = candidates.filter((p) => this.shouldDispatch(p))

      // 4. 限制单次产出数量
      const limited = deduped.slice(0, MAX_PROPOSALS_PER_TICK)

      // 5. LLM 增强（可选）
      const refined = this.refiner
        ? await withTimeout(
            this.refiner(limited),
            SIGNAL_TIMEOUT_MS,
            limited,
            'llm-refiner',
          )
        : limited

      // 6. 发射提案
      for (const proposal of refined) {
        this.recentProposals.set(proposal.dedupKey, proposal.createdAt)
        this.emit('proposal', proposal)
      }

      const durationMs = Date.now() - startTs
      this.emit('tickComplete', startTs, refined.length, durationMs)

      if (refined.length > 0) {
        logger.proactive?.info(
          `[ProactiveDecisionEngine] 评估完成: 产出 ${refined.length} 个提案（候选 ${candidates.length}，去重后 ${deduped.length}），耗时 ${durationMs}ms`,
        )
      } else {
        logger.proactive?.debug(
          `[ProactiveDecisionEngine] 评估完成: 无提案（候选 ${candidates.length}，去重后 ${deduped.length}），耗时 ${durationMs}ms`,
        )
      }

      return refined
    } catch (err) {
      // 兜底：任何未捕获异常都不应崩溃节拍
      logger.proactive?.error(
        `[ProactiveDecisionEngine] 评估异常: ${err instanceof Error ? err.message : String(err)}`,
      )
      return []
    } finally {
      this.evaluating = false
    }
  }

  // ============================================
  // 信号采集（私有）
  // ============================================

  /**
   * 并行采集 4 路信号（每路独立超时 + 容错）
   */
  private async collectSignals(): Promise<RawSignals> {
    // 并行采集融合上下文 + 监控异常 + 场景探测器
    // 行为预测依赖融合上下文的 scene 通道，需串行
    const fusionContext = await withTimeout(
      PerceptionFusionService.getInstance().getEnvironmentContext(),
      SIGNAL_TIMEOUT_MS,
      null,
      'fusion-context',
    )

    const anomalies = await withTimeout(
      Promise.resolve(MonitoringService.getInstance().getRecentAnomalies(10)),
      SIGNAL_TIMEOUT_MS,
      [] as AnomalyEvent[],
      'monitoring-anomalies',
    )

    const scenarioSignals = await this.collectScenarioSignals()

    // 行为预测（依赖 scene 通道，若 fusionContext 为 null 则跳过）
    const predictions = fusionContext
      ? await this.collectPredictions(fusionContext)
      : []

    return {
      insights: fusionContext?.insights ?? [],
      attentionScore: fusionContext?.attentionScore ?? 0,
      predictions,
      anomalies: anomalies.map((a) => this.anomalyToSignal(a)),
      scenarioSignals,
    }
  }

  /** 采集行为预测信号（依赖 scene 通道构造请求） */
  private async collectPredictions(ctx: { scene: { latestScene: { app: string; activity: string; textSummary: string } | null } | null }): Promise<ScenarioSignal[]> {
    const scene = ctx.scene?.latestScene
    if (!scene) return []

    const req: PredictRequest = {
      sceneText: scene.textSummary || scene.app,
      app: scene.app,
      // latestScene.activity 存储时为 ScreenActivity，但通道摘要中类型放宽为 string，需安全转换
      activity: toScreenActivity(scene.activity),
      topK: 3,
      confidenceThreshold: 0.4,
    }

    const resp = await withTimeout(
      BehaviorPredictor.getInstance().predict(req),
      SIGNAL_TIMEOUT_MS,
      null,
      'behavior-predict',
    )

    if (!resp?.success || resp.predictions.length === 0) return []

    return resp.predictions
      .filter((p) => p.confidence >= 0.5)
      .map((p) => ({
        source: 'coding' as const,
        trigger: `prediction:${p.predictedAction.type}:${p.predictedAction.target}`,
        severity: 'medium' as ProactiveSeverity,
        title: '预测下一步操作',
        description: `可能执行: ${p.predictedAction.target}（置信度 ${(p.confidence * 100).toFixed(0)}%）`,
        action: {
          type: 'suggest' as const,
          payload: `根据历史模式，你接下来可能要 ${p.predictedAction.target}。需要我帮你准备吗？`,
        },
        confidence: p.confidence,
        reason: p.reason,
        dedupKey: `prediction:${p.predictedAction.type}:${p.predictedAction.target}`,
      }))
  }

  /** 采集所有已注册场景探测器的信号 */
  private async collectScenarioSignals(): Promise<ScenarioSignal[]> {
    if (this.detectors.length === 0) return []

    const results = await Promise.allSettled(
      this.detectors.map((d) =>
        withTimeout(d.detect(), SIGNAL_TIMEOUT_MS, [] as ScenarioSignal[], `detector:${d.name}`),
      ),
    )

    const signals: ScenarioSignal[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.length > 0) {
        signals.push(...r.value)
      } else if (r.status === 'rejected') {
        logger.proactive?.warn(
          `[ProactiveDecisionEngine] 探测器异常: ${this.detectors[i]?.name} - ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        )
      }
    }
    return signals
  }

  // ============================================
  // 规则引擎（私有）
  // ============================================

  /**
   * 规则引擎：原始信号 → 候选提案
   *
   * 转换规则：
   * - ScenarioSignal → ProactiveProposal（补充 id + createdAt）
   * - CrossChannelInsight → ProactiveProposal（按 severity 映射）
   * - 高注意力分数 → fusion 提案
   */
  private ruleEngine(signals: RawSignals): ProactiveProposal[] {
    const proposals: ProactiveProposal[] = []
    const now = Date.now()

    // 1. 场景探测器信号 + 预测信号 + 异常信号 → 直接转换
    const directSignals = [
      ...signals.predictions,
      ...signals.anomalies,
      ...signals.scenarioSignals,
    ]
    for (const sig of directSignals) {
      proposals.push(this.signalToProposal(sig, now))
    }

    // 2. 融合洞察 → 提案
    for (const insight of signals.insights) {
      const proposal = this.insightToProposal(insight, now)
      if (proposal) proposals.push(proposal)
    }

    // 3. 高注意力分数（无具体洞察时，作为综合提醒）
    if (signals.attentionScore >= 0.85 && signals.insights.length === 0) {
      proposals.push({
        id: generateProactiveId(),
        source: 'fusion',
        trigger: `attention:${signals.attentionScore.toFixed(2)}`,
        severity: 'medium',
        title: '环境注意力升高',
        description: `当前多通道综合注意力分数 ${(signals.attentionScore * 100).toFixed(0)}%，建议关注环境状态`,
        action: {
          type: 'suggest',
          payload: '当前环境注意力分数较高，是否查看多通道融合详情？',
        },
        confidence: signals.attentionScore,
        reason: `注意力分数 ${signals.attentionScore.toFixed(2)} ≥ 0.85 阈值`,
        signals: [`attention:${signals.attentionScore.toFixed(2)}`],
        dedupKey: `fusion:attention:high`,
        createdAt: now,
      })
    }

    // 4. 按严重度 + 置信度降序排序
    proposals.sort((a, b) => {
      const sevDiff = b.severity.localeCompare(a.severity)
      if (sevDiff !== 0) return sevDiff
      return b.confidence - a.confidence
    })

    return proposals
  }

  /** ScenarioSignal → ProactiveProposal */
  private signalToProposal(sig: ScenarioSignal, now: number): ProactiveProposal {
    return {
      id: generateProactiveId(),
      source: sig.source,
      trigger: sig.trigger,
      severity: sig.severity,
      title: sig.title,
      description: sig.description,
      action: sig.action,
      confidence: sig.confidence,
      reason: sig.reason,
      signals: [sig.trigger],
      dedupKey: sig.dedupKey,
      createdAt: now,
    }
  }

  /** CrossChannelInsight → ProactiveProposal（按 severity 映射） */
  private insightToProposal(insight: CrossChannelInsight, now: number): ProactiveProposal | null {
    // all_quiet 洞察不产生提案
    if (insight.type === 'all_quiet') return null

    const severityMap: Record<CrossChannelInsight['severity'], ProactiveSeverity> = {
      info: 'info',
      warning: 'medium',
      critical: 'high',
    }

    return {
      id: generateProactiveId(),
      source: 'fusion',
      trigger: `insight:${insight.type}`,
      severity: severityMap[insight.severity],
      title: this.insightTitle(insight.type),
      description: insight.description,
      action: {
        type: insight.severity === 'critical' ? 'chat' : 'suggest',
        payload: `检测到跨通道异常：${insight.description}。建议排查相关通道：${insight.channels.join(', ')}`,
      },
      confidence: insight.severity === 'critical' ? 0.8 : insight.severity === 'warning' ? 0.6 : 0.4,
      reason: `跨通道洞察 [${insight.type}]，关联通道: ${insight.channels.join(', ')}`,
      signals: [`insight:${insight.type}`, `channels:${insight.channels.join('+')}`],
      dedupKey: `fusion:insight:${insight.type}`,
      createdAt: now,
    }
  }

  /** 洞察类型 → 标题 */
  private insightTitle(type: CrossChannelInsight['type']): string {
    const titleMap: Record<CrossChannelInsight['type'], string> = {
      high_load_during_coding: '编码时高负载',
      sensor_anomaly_correlation: '传感器异常关联',
      causal_inquiry_spike: '因果查询激增',
      monitoring_anomaly_burst: '监控异常爆发',
      iot_disconnected: 'IoT 设备断连',
      all_quiet: '环境正常',
    }
    return titleMap[type] ?? '跨通道洞察'
  }

  /** AnomalyEvent → ScenarioSignal */
  private anomalyToSignal(a: AnomalyEvent): ScenarioSignal {
    const severityMap: Record<AnomalyEvent['severity'], ProactiveSeverity> = {
      info: 'info',
      warning: 'medium',
      critical: 'high',
    }
    return {
      source: 'system',
      trigger: `anomaly:${a.type}:${a.metricType}`,
      severity: severityMap[a.severity],
      title: '系统异常告警',
      description: a.description,
      action: {
        type: a.severity === 'critical' ? 'chat' : 'suggest',
        payload: `系统检测到异常：${a.description}。建议操作：${a.recommendation}`,
      },
      confidence: a.severity === 'critical' ? 0.85 : a.severity === 'warning' ? 0.65 : 0.4,
      reason: `监控异常 [${a.type}]，指标 ${a.metricType}=${a.currentValue}，建议: ${a.recommendation}`,
      dedupKey: `system:anomaly:${a.type}:${a.metricType}`,
    }
  }

  // ============================================
  // 去重（私有）
  // ============================================

  /**
   * 判断提案是否应派发（去重检查）
   * @returns true 表示未在去重窗口内出现过，可派发
   */
  private shouldDispatch(proposal: ProactiveProposal): boolean {
    const lastCreatedAt = this.recentProposals.get(proposal.dedupKey)
    if (lastCreatedAt === undefined) return true

    const age = proposal.createdAt - lastCreatedAt
    if (age < DEDUP_WINDOW_MS) {
      logger.proactive?.debug(
        `[ProactiveDecisionEngine] 去重拦截: ${proposal.dedupKey}（${Math.round(age / 1000)}s 前刚触发）`,
      )
      return false
    }
    return true
  }

  /** 清理过期去重缓存 */
  private cleanupDedupCache(): void {
    const now = Date.now()
    let removed = 0
    for (const [key, createdAt] of this.recentProposals) {
      if (now - createdAt > DEDUP_WINDOW_MS) {
        this.recentProposals.delete(key)
        removed++
      }
    }
    if (removed > 0) {
      logger.proactive?.debug(`[ProactiveDecisionEngine] 去重缓存清理: 移除 ${removed} 条过期记录`)
    }
  }

  // ============================================
  // 资源释放
  // ============================================

  /** 释放所有资源（应用退出时调用） */
  dispose(): void {
    this.stop()
    this.detectors.length = 0
    this.refiner = null
    this.recentProposals.clear()
    this.removeAllListeners()
    ProactiveDecisionEngine.instance = null
    logger.proactive?.info('[ProactiveDecisionEngine] 资源已释放')
  }
}

// ============================================================
// 导出单例
// ============================================================

export const proactiveDecisionEngine = ProactiveDecisionEngine.getInstance()
export { ProactiveDecisionEngine }
