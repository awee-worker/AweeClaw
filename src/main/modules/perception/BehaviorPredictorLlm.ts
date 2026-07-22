/**
 * LLM 行为预测器 — 基于提示词工程的双模式预测增强
 *
 * 职责：
 * - 接收当前场景 + 检索到的相似历史行为 + 统计模式预测结果
 * - 调用主进程 LLMService.generateStructuredObject 进行结构化输出
 * - 输出 LLM 增强后的预测（含对统计预测的再评估 + 新增预测）
 * - 失败时返回空数组，自动降级到纯统计模式
 *
 * 双模式融合策略：
 * 1. 统计模式先输出 Top-K 候选预测（基于历史行为频次 + 时间衰减）
 * 2. LLM 模式接收场景上下文 + 历史行为摘要 + 统计候选
 *    - 对统计候选进行再评估：调整置信度、补充理由
 *    - 生成新的候选预测：基于 LLM 对场景的理解，发现统计模式遗漏的模式
 * 3. 合并去重（按 action.type + action.target 归并，保留较高置信度）
 *
 * 提示词工程要点：
 * - 系统提示：明确角色（行为预测专家）、输出格式（JSON Schema）、约束条件
 * - 用户提示：结构化输入（场景信息 / 历史行为 / 统计候选），明确任务
 * - 温度参数：0.4（平衡稳定性与多样性，避免幻觉）
 * - 超时保护：8 秒（预测不能阻塞用户操作太久）
 *
 * @module perception/BehaviorPredictorLlm
 */

import { logger } from '@shared/toolkit/LogEngine'
import type {
  UserAction,
  UserBehavior,
} from './PerceptionInterface'
import type { PredictRequest, PredictionResult } from './BehaviorPredictor'

// ============================================================
// 常量
// ============================================================

/** LLM 调用超时（ms）— 预测场景需快速响应 */
const LLM_TIMEOUT_MS = 8000

/** 最大输入历史行为条数（控制 token 用量） */
const MAX_HISTORY_BEHAVIORS = 15

/** 最大输入统计候选预测数 */
const MAX_STATISTICAL_CANDIDATES = 5

/** LLM 输出最大预测数 */
const MAX_LLM_PREDICTIONS = 5

/** 最大场景文本长度（超出截断） */
const MAX_SCENE_TEXT_LENGTH = 1000

/** LLM 模型版本标识 */
export const LLM_MODEL_VERSION = 'behavior-v1.1.0-llm'

// ============================================================
// 类型定义
// ============================================================

/** LLM 配置（最小接口，与 LLMConfig 兼容） */
interface LlmConfigLike {
  model: string
  apiKey?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

/** LLM 服务最小接口（与 LLMService.generateStructuredObject 兼容） */
interface LlmServiceLike {
  generateStructuredObject<T>(params: {
    config: LlmConfigLike
    schema: unknown
    system: string
    prompt: string
  }): Promise<{ data: T }>
}

/** LLM 输出单条预测 */
interface LlmPredictionRaw {
  actionType: string
  target: string
  durationMs?: number
  confidence: number
  reason: string
  source: 'statistical-refined' | 'llm-novel'
}

/** LLM 输出结构 */
interface LlmPredictionResult {
  predictions: LlmPredictionRaw[]
}

// ============================================================
// 提示词模板
// ============================================================

const SYSTEM_PROMPT = `你是一名资深的用户行为预测专家，专门分析开发者的工作场景与历史行为模式，预测用户下一步最可能执行的动作。

任务：
1. 综合分析当前场景（应用、活动、时间、文件、终端命令）
2. 参考相似历史行为，识别用户工作流模式
3. 对统计模式给出的候选预测进行再评估：调整置信度（提高或降低），补充更精准的理由
4. 发现统计模式可能遗漏的新预测（基于场景语义理解）

动作类型（actionType）必须为以下之一：
- "command"：执行终端命令（target 为命令文本）
- "file_edit"：编辑文件（target 为文件路径或文件名）
- "app_switch"：切换应用（target 为应用名）
- "search"：搜索内容（target 为搜索关键词）
- "chat"：发送聊天消息（target 为消息摘要）
- "idle"：空闲状态（target 为空字符串）

置信度（confidence）取值范围 [0, 1]：
- 0.8-1.0：极高可能性（场景与历史高度匹配，且有多种证据支撑）
- 0.6-0.8：较高可能性（明显模式，但存在不确定性）
- 0.4-0.6：中等可能性（合理推测，需更多证据）
- 0.2-0.4：低可能性（弱信号，仅供参考）
- 0.0-0.2：极低可能性（罕见或反常行为）

source 字段：
- "statistical-refined"：对统计候选的再评估（需与输入的统计候选对应）
- "llm-novel"：LLM 新生成的预测（统计模式未覆盖）

输出格式：严格的 JSON 对象，包含 predictions 数组，最多 ${MAX_LLM_PREDICTIONS} 条。`

const USER_PROMPT_TEMPLATE = `请基于以下信息预测用户下一步动作。

## 当前场景
- 应用: {app}
- 活动: {activity}
- 时间段: {timeOfDay}
- 星期: {dayOfWeek}
- 打开文件: {openFiles}
- 终端命令: {terminalCmds}
- 场景文本: {sceneText}

## 相似历史行为（最近优先，共 {historyCount} 条）
{historyBehaviors}

## 统计模式候选预测（共 {candidateCount} 条）
{statisticalCandidates}

## 任务要求
1. 对统计候选进行再评估：保留合理的，调整置信度，补充理由
2. 衂出统计模式遗漏的新预测（如有）
3. 合并输出，按置信度降序排列
4. 最多输出 ${MAX_LLM_PREDICTIONS} 条

请以 JSON 格式返回：`

// ============================================================
// JSON Schema（结构化输出约束）
// ============================================================

const PREDICTION_SCHEMA = {
  type: 'object',
  properties: {
    predictions: {
      type: 'array',
      maxItems: MAX_LLM_PREDICTIONS,
      items: {
        type: 'object',
        properties: {
          actionType: {
            type: 'string',
            enum: ['command', 'file_edit', 'app_switch', 'search', 'chat', 'idle'],
            description: '动作类型',
          },
          target: {
            type: 'string',
            maxLength: 500,
            description: '动作目标（命令/文件路径/应用名/搜索词/消息摘要）',
          },
          durationMs: {
            type: 'number',
            minimum: 0,
            description: '预计持续时长（毫秒）',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '置信度 [0, 1]',
          },
          reason: {
            type: 'string',
            maxLength: 300,
            description: '预测理由（简洁清晰）',
          },
          source: {
            type: 'string',
            enum: ['statistical-refined', 'llm-novel'],
            description: '预测来源：统计再评估 或 LLM 新增',
          },
        },
        required: ['actionType', 'target', 'confidence', 'reason', 'source'],
        additionalProperties: false,
      },
    },
  },
  required: ['predictions'],
  additionalProperties: false,
}

// ============================================================
// BehaviorPredictorLlm 实现
// ============================================================

/**
 * LLM 行为预测器单例
 *
 * 使用方式（由 PerceptionIpc 在渲染层触发初始化）：
 * ```ts
 * const { LLMService } = await import('../ai-provider/AIProviderService')
 * const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
 * if (win) {
 *   const llmService = new LLMService(win)
 *   behaviorPredictorLlm.initialize(llmService, { model, apiKey, baseUrl, temperature: 0.4 })
 * }
 * ```
 */
export class BehaviorPredictorLlm {
  /** LLM 服务实例 */
  private llmService: LlmServiceLike | null = null

  /** LLM 配置 */
  private llmConfig: LlmConfigLike | null = null

  /** 是否已初始化 */
  private initialized = false

  /** 初始化时间戳（用于诊断） */
  private initializedAt = 0

  /**
   * 初始化 LLM 预测器
   *
   * @param llmService LLM 服务实例（LLMService）
   * @param llmConfig LLM 配置（model + apiKey + baseUrl 等）
   */
  initialize(llmService: LlmServiceLike, llmConfig: LlmConfigLike): void {
    this.llmService = llmService
    // 强制温度 0.4（若调用方未指定或超出合理范围）
    const temp =
      typeof llmConfig.temperature === 'number' &&
      llmConfig.temperature >= 0 &&
      llmConfig.temperature <= 1
        ? llmConfig.temperature
        : 0.4
    this.llmConfig = { ...llmConfig, temperature: temp }
    this.initialized = true
    this.initializedAt = Date.now()
    logger.perception?.info(
      `[BehaviorPredictorLlm] 已初始化，模型: ${llmConfig.model}, 温度: ${temp}`,
    )
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized
  }

  /** 获取初始化时间戳 */
  getInitializedAt(): number {
    return this.initializedAt
  }

  /** 重置（清除 LLM 配置） */
  reset(): void {
    this.llmService = null
    this.llmConfig = null
    this.initialized = false
    this.initializedAt = 0
    logger.perception?.info('[BehaviorPredictorLlm] 已重置')
  }

  /**
   * 使用 LLM 进行行为预测
   *
   * @param req 预测请求
   * @param similarBehaviors 检索到的相似历史行为
   * @param statisticalPredictions 统计模式已生成的预测（用于 LLM 再评估）
   * @returns LLM 增强后的预测列表（失败时返回空数组，由调用方降级到统计模式）
   */
  async predictWithLLM(
    req: PredictRequest,
    similarBehaviors: UserBehavior[],
    statisticalPredictions: PredictionResult[],
  ): Promise<PredictionResult[]> {
    if (!this.initialized || !this.llmService || !this.llmConfig) {
      logger.perception?.debug(
        '[BehaviorPredictorLlm] 未初始化，跳过 LLM 预测',
      )
      return []
    }

    if (similarBehaviors.length === 0 && statisticalPredictions.length === 0) {
      logger.perception?.debug(
        '[BehaviorPredictorLlm] 无历史行为与统计候选，跳过 LLM 预测',
      )
      return []
    }

    try {
      const prompt = this.buildPrompt(req, similarBehaviors, statisticalPredictions)
      logger.perception?.info(
        `[BehaviorPredictorLlm] 开始 LLM 预测，prompt 长度: ${prompt.length}`,
      )

      const result = await this.callWithTimeout(
        this.llmService.generateStructuredObject<LlmPredictionResult>({
          config: this.llmConfig,
          schema: PREDICTION_SCHEMA,
          system: SYSTEM_PROMPT,
          prompt,
        }),
        LLM_TIMEOUT_MS,
      )

      const rawPredictions = result?.data?.predictions || []
      if (!Array.isArray(rawPredictions)) {
        logger.perception?.warn('[BehaviorPredictorLlm] LLM 返回非数组')
        return []
      }

      // 规范化并转换
      const predictions: PredictionResult[] = []
      for (const raw of rawPredictions) {
        const prediction = this.normalizePrediction(raw)
        if (!prediction) continue
        predictions.push(prediction)
      }

      logger.perception?.info(
        `[BehaviorPredictorLlm] 预测完成，有效预测 ${predictions.length}/${rawPredictions.length} 条`,
      )

      return predictions
    } catch (err) {
      logger.perception?.warn(
        '[BehaviorPredictorLlm] LLM 预测失败:',
        err instanceof Error ? err.message : String(err),
      )
      return []
    }
  }

  // ============================================================
  // 内部方法：提示词构建
  // ============================================================

  /** 构建用户提示词 */
  private buildPrompt(
    req: PredictRequest,
    similarBehaviors: UserBehavior[],
    statisticalPredictions: PredictionResult[],
  ): string {
    const now = new Date()
    const timeOfDay = this.getTimeOfDay(now.getHours())
    const dayOfWeek = this.formatDayOfWeek(now.getDay())

    const sceneText = this.truncate(req.sceneText, MAX_SCENE_TEXT_LENGTH)
    const openFiles = req.openFiles?.length
      ? req.openFiles.slice(0, 5).join(', ')
      : '无'
    const terminalCmds = req.terminalCmds?.length
      ? req.terminalCmds.slice(0, 5).join(', ')
      : '无'

    // 历史行为摘要
    const historyBehaviors = similarBehaviors
      .slice(0, MAX_HISTORY_BEHAVIORS)
      .map((b, i) => {
        const daysAgo = Math.floor((Date.now() - b.timestamp) / (24 * 60 * 60 * 1000))
        const outcome = b.outcome ?? 'success'
        return `${i + 1}. [${b.scene.app}/${b.scene.activity}] ${b.action.type}: "${this.truncate(b.action.target, 80)}" (结果: ${outcome}, ${daysAgo}天前)`
      })
      .join('\n') || '无'

    // 统计候选摘要
    const statisticalCandidates = statisticalPredictions
      .slice(0, MAX_STATISTICAL_CANDIDATES)
      .map((p, i) => {
        return `${i + 1}. ${p.predictedAction.type}: "${this.truncate(p.predictedAction.target, 80)}" 置信度=${p.confidence.toFixed(2)} 理由=${this.truncate(p.reason, 100)}`
      })
      .join('\n') || '无'

    return USER_PROMPT_TEMPLATE
      .replace('{app}', req.app)
      .replace('{activity}', req.activity)
      .replace('{timeOfDay}', timeOfDay)
      .replace('{dayOfWeek}', dayOfWeek)
      .replace('{openFiles}', openFiles)
      .replace('{terminalCmds}', terminalCmds)
      .replace('{sceneText}', sceneText)
      .replace('{historyCount}', String(Math.min(similarBehaviors.length, MAX_HISTORY_BEHAVIORS)))
      .replace('{historyBehaviors}', historyBehaviors)
      .replace('{candidateCount}', String(Math.min(statisticalPredictions.length, MAX_STATISTICAL_CANDIDATES)))
      .replace('{statisticalCandidates}', statisticalCandidates)
  }

  /** 规范化 LLM 输出为 PredictionResult */
  private normalizePrediction(raw: LlmPredictionRaw): PredictionResult | null {
    const actionType = this.normalizeActionType(raw.actionType)
    if (!actionType) return null

    const target = (raw.target ?? '').trim()
    if (target.length === 0 && actionType !== 'idle') return null
    if (target.length > 500) return null

    const confidence = this.clamp(raw.confidence ?? 0, 0, 1)
    const reason = (raw.reason ?? '').trim() || 'LLM 预测（未提供理由）'
    const source = raw.source === 'llm-novel' ? 'llm-novel' : 'statistical-refined'

    const action: UserAction = {
      type: actionType,
      target,
    }
    if (typeof raw.durationMs === 'number' && raw.durationMs > 0) {
      action.durationMs = Math.floor(raw.durationMs)
    }

    return {
      id: '', // 由调用方生成
      predictedAction: action,
      confidence: Math.round(confidence * 1000) / 1000,
      basedOnBehaviors: [], // LLM 新预测无直接对应历史行为
      reason: source === 'llm-novel'
        ? `[LLM 新增] ${reason}`
        : `[LLM 再评估] ${reason}`,
      modelVersion: LLM_MODEL_VERSION,
    }
  }

  /** 规范化动作类型 */
  private normalizeActionType(
    type: string,
  ): UserAction['type'] | null {
    const valid: UserAction['type'][] = [
      'command',
      'file_edit',
      'app_switch',
      'search',
      'chat',
      'idle',
    ]
    if (type && valid.includes(type as UserAction['type'])) {
      return type as UserAction['type']
    }
    return null
  }

  /** 数值钳制 */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  /** 文本截断 */
  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + '...'
  }

  /** 根据小时数获取时间段 */
  private getTimeOfDay(hour: number): string {
    if (hour >= 5 && hour < 12) return 'morning（上午）'
    if (hour >= 12 && hour < 18) return 'afternoon（下午）'
    if (hour >= 18 && hour < 23) return 'evening（晚上）'
    return 'night（深夜）'
  }

  /** 格式化星期 */
  private formatDayOfWeek(day: number): string {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return names[day] ?? '未知'
  }

  /**
   * 带超时的 Promise 调用
   *
   * @param promise 原始 Promise
   * @param timeoutMs 超时毫秒
   */
  private async callWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM 调用超时（${timeoutMs}ms）`)),
        timeoutMs,
      )
    })
    return Promise.race([promise, timeout]) as Promise<T>
  }
}

// ============================================================
// 单例导出
// ============================================================

export const behaviorPredictorLlm = new BehaviorPredictorLlm()
