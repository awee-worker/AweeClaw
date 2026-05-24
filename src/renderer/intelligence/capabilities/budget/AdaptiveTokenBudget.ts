/**
 * 自适应 Token 预算管理器
 *
 * 创新设计：
 * 1. 历史学习 - 根据历史对话的 token 使用模式自动调整预算
 * 2. 预测性压缩 - 预测未来 token 增长趋势，提前触发压缩
 * 3. 动态预留 - 根据任务复杂度动态调整输出预留
 * 4. 多模型适配 - 不同模型有不同的上下文限制和 token 效率
 * 5. 反馈闭环 - 根据实际使用情况持续优化预算策略
 */

import { logger } from '@toolkit/LogEngine'
import type { WorkMode } from '@protocols/workModeProtocol'
import type { ModeDescriptor } from '../mode/WorkModeDescriptor'
import type { CompressionLevel } from '../context/compressionUtils'
import { calculateLevel } from '../context/compressionUtils'

// ===== 历史使用记录 =====

interface UsageRecord {
  timestamp: number
  inputTokens: number
  outputTokens: number
  contextLimit: number
  mode: WorkMode
  compressionLevel: CompressionLevel
  taskComplexity: number // 1-10
}

// ===== 模型特性配置 =====

interface ModelCharacteristics {
  contextLimit: number
  tokenEfficiency: number // 0-1，越高表示越高效
  outputVariability: number // 输出 token 的标准差系数
  recommendedSafetyMargin: number // 推荐安全边距比例
}

const MODEL_CHARACTERISTICS: Record<string, ModelCharacteristics> = {
  'gpt-4o': {
    contextLimit: 128000,
    tokenEfficiency: 0.85,
    outputVariability: 0.3,
    recommendedSafetyMargin: 0.1,
  },
  'gpt-4o-mini': {
    contextLimit: 128000,
    tokenEfficiency: 0.75,
    outputVariability: 0.35,
    recommendedSafetyMargin: 0.12,
  },
  'claude-3-5-sonnet': {
    contextLimit: 200000,
    tokenEfficiency: 0.9,
    outputVariability: 0.25,
    recommendedSafetyMargin: 0.08,
  },
  'claude-3-haiku': {
    contextLimit: 200000,
    tokenEfficiency: 0.8,
    outputVariability: 0.3,
    recommendedSafetyMargin: 0.1,
  },
  'deepseek-chat': {
    contextLimit: 64000,
    tokenEfficiency: 0.8,
    outputVariability: 0.35,
    recommendedSafetyMargin: 0.12,
  },
  'default': {
    contextLimit: 128000,
    tokenEfficiency: 0.8,
    outputVariability: 0.3,
    recommendedSafetyMargin: 0.1,
  },
}

// ===== 自适应预算配置 =====

export interface AdaptiveBudgetConfig {
  contextLimit: number
  modelName: string
  mode: WorkMode
  /** 历史记录窗口大小 */
  historyWindowSize: number
  /** 预测 horizon（轮数） */
  predictionHorizon: number
  /** 学习率（0-1） */
  learningRate: number
  /** 最小输出预留 */
  minOutputReserve: number
  /** 最大输出预留 */
  maxOutputReserve: number
  /** 启用预测性压缩 */
  enablePredictiveCompression: boolean
  /** 启用动态预留 */
  enableDynamicReserve: boolean
}

const DEFAULT_ADAPTIVE_CONFIG: Partial<AdaptiveBudgetConfig> = {
  historyWindowSize: 10,
  predictionHorizon: 3,
  learningRate: 0.3,
  minOutputReserve: 2048,
  maxOutputReserve: 16384,
  enablePredictiveCompression: true,
  enableDynamicReserve: true,
}

// ===== 预算预测结果 =====

export interface BudgetPrediction {
  /** 当前输入 token */
  currentInputTokens: number
  /** 预测的下轮输入 token */
  predictedNextInput: number
  /** 预测的下轮输出 token */
  predictedNextOutput: number
  /** 预测 N 轮后的总 token */
  predictedTotalInRounds: number
  /** 建议的压缩等级 */
  suggestedCompressionLevel: CompressionLevel
  /** 是否需要立即压缩 */
  needsImmediateCompression: boolean
  /** 预计还能进行多少轮对话 */
  estimatedRemainingTurns: number
  /** 置信度（0-1） */
  confidence: number
}

// ===== 自适应预算控制器 =====

export class AdaptiveTokenBudget {
  private config: AdaptiveBudgetConfig
  // private _modeDescriptor!: ModeDescriptor
  private usageHistory: UsageRecord[] = []
  private modelChars: ModelCharacteristics

  // 学习到的参数
  private learnedOutputRatio = 0.3 // 输出/输入比例
  private learnedGrowthRate = 1.05 // 每轮 token 增长率
  private learnedComplexityFactor = 1.0 // 复杂度因子

  constructor(config: AdaptiveBudgetConfig, _modeDescriptor: ModeDescriptor) {
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config } as AdaptiveBudgetConfig
    this.modelChars = MODEL_CHARACTERISTICS[config.modelName] || MODEL_CHARACTERISTICS.default

    // 根据模型特性调整上下文限制
    if (this.modelChars.contextLimit < this.config.contextLimit) {
      this.config.contextLimit = this.modelChars.contextLimit
    }
  }

  /**
   * 记录使用情况（用于学习）
   */
  recordUsage(
    inputTokens: number,
    outputTokens: number,
    compressionLevel: CompressionLevel,
    taskComplexity = 5
  ): void {
    const record: UsageRecord = {
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      contextLimit: this.config.contextLimit,
      mode: this.config.mode,
      compressionLevel,
      taskComplexity,
    }

    this.usageHistory.push(record)

    // 限制历史记录大小
    if (this.usageHistory.length > this.config.historyWindowSize) {
      this.usageHistory.shift()
    }

    // 更新学习参数
    this.updateLearnedParameters()

    logger.agent.debug(
      `[AdaptiveBudget] Recorded usage: ${inputTokens} in / ${outputTokens} out, ` +
      `learned ratio: ${this.learnedOutputRatio.toFixed(2)}, ` +
      `growth: ${this.learnedGrowthRate.toFixed(3)}`
    )
  }

  /**
   * 预测未来 token 使用
   */
  predict(currentInputTokens: number, currentOutputTokens: number): BudgetPrediction {
    const recentRecords = this.getRecentRecords(5)

    // 计算输入增长趋势
    let inputGrowthRate = this.learnedGrowthRate
    if (recentRecords.length >= 2) {
      const inputs = recentRecords.map(r => r.inputTokens)
      const growthRates: number[] = []
      for (let i = 1; i < inputs.length; i++) {
        if (inputs[i - 1] > 0) {
          growthRates.push(inputs[i] / inputs[i - 1])
        }
      }
      if (growthRates.length > 0) {
        const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length
        inputGrowthRate = this.config.learningRate * avgGrowth + (1 - this.config.learningRate) * this.learnedGrowthRate
      }
    }

    // 预测下轮输入
    const predictedNextInput = Math.round(currentInputTokens * inputGrowthRate)

    // 预测下轮输出（基于输入和输出比例）
    const outputRatio = this.calculateOutputRatio(recentRecords, currentInputTokens, currentOutputTokens)
    const predictedNextOutput = Math.round(predictedNextInput * outputRatio)

    // 预测 N 轮后的总 token
    let predictedTotalInRounds = currentInputTokens
    let simulatedInput = currentInputTokens
    for (let i = 0; i < this.config.predictionHorizon; i++) {
      simulatedInput = Math.round(simulatedInput * inputGrowthRate)
      predictedTotalInRounds += simulatedInput
    }

    // 计算建议的压缩等级
    const usageRatio = currentInputTokens / this.config.contextLimit
    const predictedRatio = predictedTotalInRounds / this.config.contextLimit

    let suggestedCompressionLevel = calculateLevel(usageRatio)
    if (predictedRatio > usageRatio * 1.2) {
      // 如果预测增长显著，提前升级压缩
      suggestedCompressionLevel = Math.min(suggestedCompressionLevel + 1, 4) as CompressionLevel
    }

    // 是否需要立即压缩
    const needsImmediateCompression = predictedRatio > 0.85 || usageRatio > 0.8

    // 预计剩余轮数
    const estimatedRemainingTurns = this.estimateRemainingTurns(currentInputTokens, inputGrowthRate)

    // 置信度（基于历史数据量）
    const confidence = Math.min(recentRecords.length / 5, 1)

    return {
      currentInputTokens,
      predictedNextInput,
      predictedNextOutput,
      predictedTotalInRounds,
      suggestedCompressionLevel,
      needsImmediateCompression,
      estimatedRemainingTurns,
      confidence,
    }
  }

  /**
   * 计算动态预留 token
   */
  calculateDynamicReserve(taskComplexity = 5): number {
    if (!this.config.enableDynamicReserve) {
      return this.config.minOutputReserve
    }

    const recentRecords = this.getRecentRecords(3)

    // 基础预留
    let reserve = this.config.minOutputReserve

    // 根据复杂度调整
    const complexityMultiplier = 1 + (taskComplexity - 5) * 0.1
    reserve *= complexityMultiplier

    // 根据历史输出调整
    if (recentRecords.length > 0) {
      const avgOutput = recentRecords.reduce((sum, r) => sum + r.outputTokens, 0) / recentRecords.length
      const outputBasedReserve = avgOutput * 1.5 // 预留 1.5 倍平均输出
      reserve = Math.max(reserve, outputBasedReserve)
    }

    // 根据模型特性调整
    reserve *= (1 + this.modelChars.outputVariability)

    // 限制在范围内
    return Math.min(Math.max(Math.round(reserve), this.config.minOutputReserve), this.config.maxOutputReserve)
  }

  /**
   * 获取预算建议
   */
  getBudgetAdvice(currentInputTokens: number, currentOutputTokens: number): {
    action: 'none' | 'compress' | 'summarize' | 'handoff'
    reason: string
    recommendedLevel: CompressionLevel
    predictedRemainingTurns: number
  } {
    const prediction = this.predict(currentInputTokens, currentOutputTokens)
    const reserve = this.calculateDynamicReserve()
    const effectiveLimit = this.config.contextLimit - reserve

    if (currentInputTokens >= effectiveLimit * 0.95) {
      return {
        action: 'handoff',
        reason: `Context nearly full: ${currentInputTokens}/${effectiveLimit} tokens (${(currentInputTokens / effectiveLimit * 100).toFixed(1)}%)`,
        recommendedLevel: 4,
        predictedRemainingTurns: 0,
      }
    }

    if (prediction.needsImmediateCompression || currentInputTokens >= effectiveLimit * 0.85) {
      return {
        action: 'summarize',
        reason: `Predicted overflow in ${prediction.estimatedRemainingTurns} turns`,
        recommendedLevel: prediction.suggestedCompressionLevel,
        predictedRemainingTurns: prediction.estimatedRemainingTurns,
      }
    }

    if (currentInputTokens >= effectiveLimit * 0.7) {
      return {
        action: 'compress',
        reason: `Usage above 70% threshold`,
        recommendedLevel: prediction.suggestedCompressionLevel,
        predictedRemainingTurns: prediction.estimatedRemainingTurns,
      }
    }

    return {
      action: 'none',
      reason: `Usage healthy: ${currentInputTokens}/${effectiveLimit} tokens`,
      recommendedLevel: 0,
      predictedRemainingTurns: prediction.estimatedRemainingTurns,
    }
  }

  /**
   * 更新模式描述符
   */
  updateModeDescriptor(_modeDescriptor: ModeDescriptor): void {
    // mode descriptor updated but not stored to avoid unused field warning
    void _modeDescriptor
  }

  /**
   * 更新模型
   */
  updateModel(modelName: string): void {
    this.config.modelName = modelName
    this.modelChars = MODEL_CHARACTERISTICS[modelName] || MODEL_CHARACTERISTICS.default

    // 如果新模型上下文更小，调整限制
    if (this.modelChars.contextLimit < this.config.contextLimit) {
      this.config.contextLimit = this.modelChars.contextLimit
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalRecords: number
    avgInputTokens: number
    avgOutputTokens: number
    avgOutputRatio: number
    learnedGrowthRate: number
    learnedComplexityFactor: number
  } {
    if (this.usageHistory.length === 0) {
      return {
        totalRecords: 0,
        avgInputTokens: 0,
        avgOutputTokens: 0,
        avgOutputRatio: this.learnedOutputRatio,
        learnedGrowthRate: this.learnedGrowthRate,
        learnedComplexityFactor: this.learnedComplexityFactor,
      }
    }

    const totalInput = this.usageHistory.reduce((sum, r) => sum + r.inputTokens, 0)
    const totalOutput = this.usageHistory.reduce((sum, r) => sum + r.outputTokens, 0)

    return {
      totalRecords: this.usageHistory.length,
      avgInputTokens: Math.round(totalInput / this.usageHistory.length),
      avgOutputTokens: Math.round(totalOutput / this.usageHistory.length),
      avgOutputRatio: totalInput > 0 ? totalOutput / totalInput : 0,
      learnedGrowthRate: this.learnedGrowthRate,
      learnedComplexityFactor: this.learnedComplexityFactor,
    }
  }

  // ===== 私有方法 =====

  private getRecentRecords(count: number): UsageRecord[] {
    return this.usageHistory.slice(-count)
  }

  private updateLearnedParameters(): void {
    const recent = this.getRecentRecords(this.config.historyWindowSize)
    if (recent.length < 2) return

    // 更新输出比例
    const totalInput = recent.reduce((sum, r) => sum + r.inputTokens, 0)
    const totalOutput = recent.reduce((sum, r) => sum + r.outputTokens, 0)
    if (totalInput > 0) {
      const newRatio = totalOutput / totalInput
      this.learnedOutputRatio = this.config.learningRate * newRatio + (1 - this.config.learningRate) * this.learnedOutputRatio
    }

    // 更新增长率
    const growthRates: number[] = []
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1].inputTokens > 0) {
        growthRates.push(recent[i].inputTokens / recent[i - 1].inputTokens)
      }
    }
    if (growthRates.length > 0) {
      const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length
      this.learnedGrowthRate = this.config.learningRate * avgGrowth + (1 - this.config.learningRate) * this.learnedGrowthRate
    }

    // 更新复杂度因子
    const avgComplexity = recent.reduce((sum, r) => sum + r.taskComplexity, 0) / recent.length
    this.learnedComplexityFactor = 1 + (avgComplexity - 5) * 0.05
  }

  private calculateOutputRatio(
    recentRecords: UsageRecord[],
    currentInput: number,
    currentOutput: number
  ): number {
    if (recentRecords.length === 0) {
      return currentInput > 0 ? currentOutput / currentInput : this.learnedOutputRatio
    }

    const totalInput = recentRecords.reduce((sum, r) => sum + r.inputTokens, 0)
    const totalOutput = recentRecords.reduce((sum, r) => sum + r.outputTokens, 0)

    if (totalInput === 0) return this.learnedOutputRatio

    const historicalRatio = totalOutput / totalInput
    const currentRatio = currentInput > 0 ? currentOutput / currentInput : historicalRatio

    // 加权平均
    return 0.7 * historicalRatio + 0.3 * currentRatio
  }

  private estimateRemainingTurns(currentInput: number, growthRate: number): number {
    const reserve = this.calculateDynamicReserve()
    const effectiveLimit = this.config.contextLimit - reserve
    let remaining = effectiveLimit - currentInput

    if (remaining <= 0) return 0
    if (growthRate <= 1) return Math.floor(remaining / (currentInput * 0.1)) // 假设每轮增长 10%

    // 等比数列求和: S = a * (r^n - 1) / (r - 1)
    // 解 n: n = log(S * (r - 1) / a + 1) / log(r)
    const a = currentInput * growthRate // 下轮预测输入
    const r = growthRate
    const S = remaining

    if (a <= 0) return 0

    const n = Math.log(S * (r - 1) / a + 1) / Math.log(r)
    return Math.max(0, Math.floor(n))
  }
}

// ===== 工厂函数 =====

export function createAdaptiveBudget(
  modelName: string,
  mode: WorkMode,
  modeDescriptor: ModeDescriptor,
  contextLimit?: number
): AdaptiveTokenBudget {
  const modelChars = MODEL_CHARACTERISTICS[modelName] || MODEL_CHARACTERISTICS.default

  const config: AdaptiveBudgetConfig = {
    contextLimit: contextLimit || modelChars.contextLimit,
    modelName,
    mode,
    historyWindowSize: 10,
    predictionHorizon: 3,
    learningRate: 0.3,
    minOutputReserve: modeDescriptor.budgetProfile.reservedOutputTokens,
    maxOutputReserve: Math.min(16384, (contextLimit || modelChars.contextLimit) * 0.1),
    enablePredictiveCompression: true,
    enableDynamicReserve: true,
  }

  return new AdaptiveTokenBudget(config, modeDescriptor)
}

export { MODEL_CHARACTERISTICS }
