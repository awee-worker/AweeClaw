/**
 * 行为预测器 — 基于本地嵌入 + 历史场景检索
 *
 * 职责：
 * - 接收当前场景描述（文本 + 元数据）
 * - 使用 LocalEmbedder 生成场景向量
 * - 从 PerceptionStore 检索相似历史行为
 * - 使用频次统计 + 时间衰减 + 场景匹配 + 结果加权算法生成 Top-K 预测
 * - 持久化预测记录到 PerceptionStore，用于后续命中率校准
 * - 支持反馈回写（accepted/rejected/ignored + 实际动作）
 *
 * 算法说明：
 * - 时间衰减：半衰期 7 天，越近的行为权重越高
 * - 场景匹配：app(0.4) + activity(0.3) + timeOfDay(0.2) + dayOfWeek(0.1)
 * - 结果加权：success=1.0 / abandoned=0.5 / failure=0.3
 * - 最小样本数：3 条以上才输出预测，避免冷启动噪声
 *
 * @module perception/BehaviorPredictor
 */

import { logger } from '@shared/toolkit/LogEngine'
import { LocalEmbedder } from './LocalEmbedder'
import { PerceptionStore } from './PerceptionStore'
import { generatePerceptionId, getTimeOfDay } from './PerceptionInterface'
import type {
  ScreenActivity,
  TimeOfDay,
  UserAction,
  UserBehavior,
  Prediction,
} from './PerceptionInterface'
import { behaviorPredictorLlm } from './BehaviorPredictorLlm'

// ============================================================
// 常量
// ============================================================

/** 时间衰减半衰期（7 天，单位毫秒） */
const DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000

/** 最小样本数（少于此数不输出预测） */
const MIN_SAMPLES = 3

/** 默认 Top-K */
const DEFAULT_TOP_K = 3

/** 默认置信度阈值 */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.15

/** 模型版本 */
const MODEL_VERSION = 'behavior-v1.0.0'

/** 是否启用 LLM 双模式融合（默认启用，由 initLlmExtractor 显式激活） */
const ENABLE_LLM_DUAL_MODE = true

// ============================================================
// 类型定义
// ============================================================

/** 预测请求输入 */
export interface PredictRequest {
  /** 当前场景文本摘要（OCR 或用户输入） */
  sceneText: string
  /** 当前活跃应用 */
  app: string
  /** 当前活动类型 */
  activity: ScreenActivity
  /** 当前打开的文件列表（可选） */
  openFiles?: string[]
  /** 当前终端命令列表（可选） */
  terminalCmds?: string[]
  /** 返回的预测数量 */
  topK?: number
  /** 置信度阈值 */
  confidenceThreshold?: number
}

/** 预测结果项 */
export interface PredictionResult {
  /** 预测唯一 ID */
  id: string
  /** 预测动作 */
  predictedAction: UserAction
  /** 置信度（0-1） */
  confidence: number
  /** 基于的历史行为 ID */
  basedOnBehaviors: string[]
  /** 预测理由 */
  reason: string
  /** 模型版本 */
  modelVersion: string
}

/** 预测响应 */
export interface PredictResponse {
  /** 是否成功 */
  success: boolean
  /** 预测结果列表（按置信度降序） */
  predictions: PredictionResult[]
  /** 当前场景向量 */
  embedding: number[]
  /** 检索到的相似行为数 */
  sampleCount: number
  /** 错误信息 */
  error?: string
}

/** 反馈类型 */
export type PredictionFeedback = 'accepted' | 'rejected' | 'ignored'

// ============================================================
// 行为预测器
// ============================================================

/**
 * 行为预测器单例
 *
 * 使用方式：
 * ```ts
 * const predictor = BehaviorPredictor.getInstance()
 * const result = await predictor.predict({
 *   sceneText: '用户正在编辑 src/main.ts',
 *   app: 'Code',
 *   activity: 'coding',
 * })
 * ```
 */
export class BehaviorPredictor {
  private static instance: BehaviorPredictor | null = null

  private readonly embedder: LocalEmbedder
  private readonly store: PerceptionStore

  private constructor() {
    this.embedder = LocalEmbedder.getInstance()
    this.store = PerceptionStore.getInstance()
  }

  /** 获取单例 */
  static getInstance(): BehaviorPredictor {
    if (!BehaviorPredictor.instance) {
      BehaviorPredictor.instance = new BehaviorPredictor()
    }
    return BehaviorPredictor.instance
  }

  /**
   * 执行行为预测
   *
   * 流程（双模式）：
   * 1. 将当前场景文本编码为向量
   * 2. 从 LanceDB 检索相似历史行为
   * 3. 统计模式：按动作类型分组，计算加权得分，输出 Top-K 候选
   * 4. LLM 模式（若已初始化）：传入场景 + 历史 + 统计候选，输出再评估 + 新增预测
   * 5. 融合去重：按 (action.type + action.target) 归并，保留较高置信度
   * 6. 过滤低置信度 + 持久化 + 返回
   */
  async predict(req: PredictRequest): Promise<PredictResponse> {
    try {
      // 1. 编码当前场景
      const embedding = await this.embedder.embed(req.sceneText)
      if (embedding.length === 0) {
        return {
          success: false,
          predictions: [],
          embedding: [],
          sampleCount: 0,
          error: '场景向量化失败（嵌入模型未加载）',
        }
      }

      // 2. 检索相似历史行为
      const similarBehaviors = await this.store.searchSimilarBehaviors(
        embedding,
        Math.max(req.topK ?? DEFAULT_TOP_K, 20) * 3, // 多检索一些用于统计
      )

      if (similarBehaviors.length < MIN_SAMPLES) {
        logger.perception?.info(
          `[BehaviorPredictor] 样本不足: ${similarBehaviors.length}/${MIN_SAMPLES}`,
        )
        return {
          success: true,
          predictions: [],
          embedding,
          sampleCount: similarBehaviors.length,
        }
      }

      // 3. 统计模式预测
      const topK = req.topK ?? DEFAULT_TOP_K
      const threshold = req.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
      const statisticalCandidates = this.scoreActionCandidates(
        similarBehaviors,
        req,
        topK,
      )

      // 4. LLM 双模式融合
      let llmPredictions: PredictionResult[] = []
      if (ENABLE_LLM_DUAL_MODE && behaviorPredictorLlm.isInitialized()) {
        try {
          llmPredictions = await behaviorPredictorLlm.predictWithLLM(
            req,
            similarBehaviors,
            statisticalCandidates.map((c) => ({
              id: '',
              predictedAction: c.action,
              confidence: c.confidence,
              basedOnBehaviors: c.basedOnBehaviors,
              reason: c.reason,
              modelVersion: MODEL_VERSION,
            })),
          )
          logger.perception?.info(
            `[BehaviorPredictor] LLM 模式输出 ${llmPredictions.length} 条预测`,
          )
        } catch (e) {
          logger.perception?.warn(
            '[BehaviorPredictor] LLM 模式异常，降级到纯统计模式:',
            e instanceof Error ? e.message : String(e),
          )
        }
      }

      // 5. 融合去重（统计 + LLM）
      const merged = this.mergePredictions(statisticalCandidates, llmPredictions)

      // 6. 过滤低置信度
      const filtered = merged.filter((c) => c.confidence >= threshold)

      // 7. 持久化预测记录
      const predictions: PredictionResult[] = []
      for (const candidate of filtered) {
        const predictionId = generatePerceptionId('pred')
        predictions.push({
          id: predictionId,
          predictedAction: candidate.action,
          confidence: candidate.confidence,
          basedOnBehaviors: candidate.basedOnBehaviors,
          reason: candidate.reason,
          modelVersion: candidate.modelVersion,
        })

        // 异步保存，不阻塞响应
        this.persistPrediction(predictionId, candidate).catch((e) => {
          logger.perception?.warn('[BehaviorPredictor] 持久化预测失败:', e)
        })
      }

      logger.perception?.info(
        `[BehaviorPredictor] 预测完成: 样本=${similarBehaviors.length} 统计=${statisticalCandidates.length} LLM=${llmPredictions.length} 融合输出=${predictions.length}`,
      )

      return {
        success: true,
        predictions,
        embedding,
        sampleCount: similarBehaviors.length,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[BehaviorPredictor] predict 失败:', e)
      return {
        success: false,
        predictions: [],
        embedding: [],
        sampleCount: 0,
        error: msg,
      }
    }
  }

  /**
   * 初始化 LLM 预测器
   *
   * 由 PerceptionIpc 在渲染层触发，主进程直接持有 LLMService 句柄。
   * 初始化后 `predict()` 自动启用双模式融合。
   *
   * @param llmService LLM 服务实例
   * @param llmConfig LLM 配置（model + apiKey + baseUrl 等）
   */
  initLlmExtractor(
    llmService: Parameters<typeof behaviorPredictorLlm.initialize>[0],
    llmConfig: Parameters<typeof behaviorPredictorLlm.initialize>[1],
  ): void {
    behaviorPredictorLlm.initialize(llmService, llmConfig)
  }

  /** LLM 预测器是否已初始化 */
  isLlmPredictorReady(): boolean {
    return behaviorPredictorLlm.isInitialized()
  }

  /** 重置 LLM 预测器（清空配置，恢复纯统计模式） */
  resetLlmPredictor(): void {
    behaviorPredictorLlm.reset()
  }

  /**
   * 融合统计模式 + LLM 模式的预测结果
   *
   * 策略：
   * 1. 按 (action.type + action.target 前 32 字符) 归并
   * 2. 若 LLM 提供了对统计候选的再评估（同 key），保留置信度更高的一方
   * 3. LLM 新增预测直接加入候选池
   * 4. 按置信度降序排序，取 Top-K
   */
  private mergePredictions(
    statistical: Array<{
      action: UserAction
      confidence: number
      basedOnBehaviors: string[]
      reason: string
      modelVersion: string
    }>,
    llm: PredictionResult[],
  ): Array<{
    action: UserAction
    confidence: number
    basedOnBehaviors: string[]
    reason: string
    modelVersion: string
  }> {
    const merged = new Map<string, {
      action: UserAction
      confidence: number
      basedOnBehaviors: string[]
      reason: string
      modelVersion: string
    }>()

    // 先放入统计候选
    for (const c of statistical) {
      const key = `${c.action.type}:${c.action.target.slice(0, 32)}`
      merged.set(key, {
        action: c.action,
        confidence: c.confidence,
        basedOnBehaviors: c.basedOnBehaviors,
        reason: c.reason,
        modelVersion: c.modelVersion,
      })
    }

    // LLM 预测：同 key 取较高置信度；新 key 直接加入
    for (const p of llm) {
      const key = `${p.predictedAction.type}:${p.predictedAction.target.slice(0, 32)}`
      const existing = merged.get(key)
      if (existing) {
        // 同 key：若 LLM 置信度更高，替换；否则保留统计候选
        if (p.confidence > existing.confidence) {
          merged.set(key, {
            action: p.predictedAction,
            confidence: p.confidence,
            basedOnBehaviors: p.basedOnBehaviors,
            reason: p.reason,
            modelVersion: p.modelVersion,
          })
        }
        // 否则保留原统计候选（含其 basedOnBehaviors）
      } else {
        // 新 key：LLM 新增预测
        merged.set(key, {
          action: p.predictedAction,
          confidence: p.confidence,
          basedOnBehaviors: p.basedOnBehaviors,
          reason: p.reason,
          modelVersion: p.modelVersion,
        })
      }
    }

    // 按置信度降序排序
    return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * 提交预测反馈
   *
   * @param predictionId 预测记录 ID
   * @param feedback 反馈类型
   * @param actualAction 实际发生的动作（可选，用于命中率统计）
   */
  async submitFeedback(
    predictionId: string,
    feedback: PredictionFeedback,
    actualAction?: UserAction,
  ): Promise<boolean> {
    try {
      const ok = await this.store.updatePredictionOutcome(
        predictionId,
        actualAction ?? { type: 'idle', target: '' },
        feedback,
      )
      logger.perception?.info(
        `[BehaviorPredictor] 反馈已提交: ${predictionId} = ${feedback}`,
      )
      return ok
    } catch (e) {
      logger.perception?.error('[BehaviorPredictor] submitFeedback 失败:', e)
      return false
    }
  }

  /**
   * 记录用户实际行为
   *
   * 在用户执行显著动作时调用，用于积累历史数据。
   * 会自动关联最近的场景。
   */
  async recordBehavior(params: {
    sceneId?: string
    sceneText: string
    app: string
    activity: ScreenActivity
    action: UserAction
    outcome?: 'success' | 'failure' | 'abandoned'
    openFiles?: string[]
    terminalCmds?: string[]
  }): Promise<boolean> {
    try {
      const embedding = await this.embedder.embed(params.sceneText)
      const now = new Date()
      const behavior: UserBehavior = {
        id: generatePerceptionId('beh'),
        timestamp: Date.now(),
        sceneId: params.sceneId ?? generatePerceptionId('scene'),
        sceneEmbedding: embedding,
        scene: {
          app: params.app,
          activity: params.activity,
          timeOfDay: getTimeOfDay(now.getHours()),
          dayOfWeek: now.getDay(),
          filesOpen: params.openFiles,
          terminalCmds: params.terminalCmds,
        },
        action: params.action,
        outcome: params.outcome ?? 'success',
      }

      const ok = await this.store.saveUserBehavior(behavior)
      if (ok) {
        logger.perception?.info(
          `[BehaviorPredictor] 行为已记录: ${params.action.type}=${params.action.target.slice(0, 40)}`,
        )
      }
      return ok
    } catch (e) {
      logger.perception?.error('[BehaviorPredictor] recordBehavior 失败:', e)
      return false
    }
  }

  /**
   * 获取预测命中率统计
   *
   * 返回最近 N 天内的预测统计：
   * - total: 总预测数
   * - hit: 命中数
   * - hitRate: 命中率
   * - accepted / rejected / ignored: 反馈分布
   * - acceptRate: 接受率
   *
   * @param days 统计天数（默认 30）
   */
  async getStats(days = 30): Promise<{
    total: number
    hit: number
    hitRate: number
    accepted: number
    rejected: number
    ignored: number
    acceptRate: number
    days: number
  }> {
    try {
      // 复用 PerceptionStore.getRecentScenes 的接口模式
      // 这里调用 store 提供的预测记录查询接口
      const since = Date.now() - days * 24 * 60 * 60 * 1000
      const records = await this.store.getPredictionsSince(since)

      const total = records.length
      const hit = records.filter((r) => r.hit === true).length
      const accepted = records.filter((r) => r.feedback === 'accepted').length
      const rejected = records.filter((r) => r.feedback === 'rejected').length
      const ignored = records.filter((r) => r.feedback === 'ignored').length

      return {
        total,
        hit,
        hitRate: total > 0 ? hit / total : 0,
        accepted,
        rejected,
        ignored,
        acceptRate: total > 0 ? accepted / total : 0,
        days,
      }
    } catch (e) {
      logger.perception?.error('[BehaviorPredictor] getStats 失败:', e)
      return {
        total: 0,
        hit: 0,
        hitRate: 0,
        accepted: 0,
        rejected: 0,
        ignored: 0,
        acceptRate: 0,
        days,
      }
    }
  }

  // ============================================================
  // 私有方法：评分算法
  // ============================================================

  /**
   * 计算候选动作得分
   *
   * 算法：
   * 1. 按动作类型分组
   * 2. 每组得分 = Σ(场景相似度 × 场景匹配度 × 时间衰减 × 结果权重)
   * 3. 置信度 = 组得分 / 总得分
   */
  private scoreActionCandidates(
    behaviors: UserBehavior[],
    req: PredictRequest,
    topK: number,
  ): Array<{
    action: UserAction
    confidence: number
    basedOnBehaviors: string[]
    reason: string
    modelVersion: string
  }> {
    const now = Date.now()
    const currentTimeOfDay = getTimeOfDay(new Date().getHours())
    const currentDayOfWeek = new Date().getDay()

    // 按动作类型+目标前缀分组（避免相同命令的微小变体分散得分）
    type Group = {
      action: UserAction
      score: number
      behaviors: UserBehavior[]
    }
    const groups = new Map<string, Group>()

    for (const beh of behaviors) {
      const similarity = this.cosineSimilarity(
        req.sceneText.length > 0 ? beh.sceneEmbedding : [],
        beh.sceneEmbedding,
      )
      const sceneMatch = this.computeSceneMatchScore(
        beh.scene,
        req,
        currentTimeOfDay,
        currentDayOfWeek,
      )
      const timeDecay = Math.exp(-(now - beh.timestamp) / DECAY_HALF_LIFE_MS)
      const outcomeWeight = this.getOutcomeWeight(beh.outcome)

      const weight = similarity * sceneMatch * timeDecay * outcomeWeight
      if (weight <= 0) continue

      // 分组键：动作类型 + 目标前缀（取前 32 字符避免太细）
      const groupKey = `${beh.action.type}:${beh.action.target.slice(0, 32)}`

      const group = groups.get(groupKey)
      if (group) {
        group.score += weight
        group.behaviors.push(beh)
        // 保留最新的动作作为代表
        if (beh.timestamp > (group.behaviors[0]?.timestamp ?? 0)) {
          group.action = beh.action
        }
      } else {
        groups.set(groupKey, {
          action: beh.action,
          score: weight,
          behaviors: [beh],
        })
      }
    }

    // 计算总得分用于归一化
    const totalScore = Array.from(groups.values()).reduce(
      (sum, g) => sum + g.score,
      0,
    )
    if (totalScore <= 0) return []

    // 排序并取 Top-K
    const sorted = Array.from(groups.values()).sort((a, b) => b.score - a.score)
    const top = sorted.slice(0, topK)

    return top.map((g) => {
      const confidence = g.score / totalScore
      return {
        action: g.action,
        confidence: Math.round(confidence * 1000) / 1000, // 保留 3 位小数
        basedOnBehaviors: g.behaviors.map((b) => b.id),
        reason: this.buildReason(g, confidence),
        modelVersion: MODEL_VERSION,
      }
    })
  }

  /** 计算场景匹配度（0-1） */
  private computeSceneMatchScore(
    scene: UserBehavior['scene'],
    req: PredictRequest,
    currentTimeOfDay: TimeOfDay,
    currentDayOfWeek: number,
  ): number {
    let score = 0

    // app 匹配（权重 0.4）
    if (scene.app.toLowerCase() === req.app.toLowerCase()) {
      score += 0.4
    }

    // activity 匹配（权重 0.3）
    if (scene.activity === req.activity) {
      score += 0.3
    }

    // timeOfDay 匹配（权重 0.2）
    if (scene.timeOfDay === currentTimeOfDay) {
      score += 0.2
    }

    // dayOfWeek 匹配（权重 0.1）
    if (scene.dayOfWeek === currentDayOfWeek) {
      score += 0.1
    }

    return score
  }

  /** 结果权重 */
  private getOutcomeWeight(outcome?: string): number {
    switch (outcome) {
      case 'success':
        return 1.0
      case 'abandoned':
        return 0.5
      case 'failure':
        return 0.3
      default:
        return 0.7
    }
  }

  /** 余弦相似度（用于场景向量相似度） */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || a.length !== b.length) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  /** 构建预测理由 */
  private buildReason(
    group: { action: UserAction; score: number; behaviors: UserBehavior[] },
    confidence: number,
  ): string {
    const pct = Math.round(confidence * 100)
    const sampleCount = group.behaviors.length
    const latestBeh = group.behaviors[group.behaviors.length - 1]
    const daysAgo = latestBeh
      ? Math.floor((Date.now() - latestBeh.timestamp) / (24 * 60 * 60 * 1000))
      : 0

    return `基于 ${sampleCount} 次相似历史行为（最近一次 ${daysAgo} 天前），置信度 ${pct}%`
  }

  /** 异步持久化预测记录 */
  private async persistPrediction(
    predictionId: string,
    candidate: {
      action: UserAction
      confidence: number
      basedOnBehaviors: string[]
      reason: string
    },
  ): Promise<void> {
    const prediction: Prediction = {
      id: predictionId,
      timestamp: Date.now(),
      type: 'behavior',
      predictedAction: candidate.action,
      confidence: candidate.confidence,
      basedOnBehaviors: candidate.basedOnBehaviors,
      reason: candidate.reason,
      feedback: 'ignored', // 默认忽略，等待用户反馈
    }

    await this.store.savePrediction(prediction)
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    BehaviorPredictor.instance = null
  }
}
