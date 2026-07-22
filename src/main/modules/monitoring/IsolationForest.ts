/**
 * Isolation Forest 异常检测引擎 — 本地 JS 实现
 *
 * 算法原理：
 * - Isolation Forest 通过随机划分特征空间来"孤立"样本
 * - 异常点由于特征取值远离大多数样本，所需划分次数更少（路径更短）
 * - 多棵 iTree 组成 iForest，取平均路径长度作为异常得分依据
 * - 路径长度归一化为 [0, 1]，> 0.6 通常视为异常
 *
 * 优势：
 * - 时间复杂度 O(n log n)，适合流式系统指标
 * - 无需标注数据，纯无监督
 * - 对多维联合分布异常敏感（CPU+内存双飙升等复合异常）
 *
 * @module monitoring/IsolationForest
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { SystemMetrics } from './MonitoringInterface'

// ============================================================
// 常量
// ============================================================

/** 默认树数量 */
const DEFAULT_N_TREES = 50

/** 默认子采样大小（每棵树训练时使用的样本数） */
const DEFAULT_SAMPLE_SIZE = 64

/** 子采样上限（避免大样本时退化） */
const MAX_SAMPLE_SIZE = 256

/** 异常得分阈值（>= 此值视为异常） */
const DEFAULT_ANOMALY_THRESHOLD = 0.6

/** 特征维度名称 */
export type MetricFeatureKey =
  | 'cpuUsage'
  | 'cpuLoadAvg1'
  | 'memoryUsage'
  | 'memoryAvailableMB'
  | 'diskUsage'
  | 'diskIoReadKBps'
  | 'diskIoWriteKBps'
  | 'networkRxKBps'
  | 'networkTxKBps'
  | 'processCount'
  | 'cpuTemperature'
  | 'batteryPercent'

/** 默认使用的特征列表 */
export const DEFAULT_FEATURES: MetricFeatureKey[] = [
  'cpuUsage',
  'cpuLoadAvg1',
  'memoryUsage',
  'diskUsage',
  'diskIoReadKBps',
  'diskIoWriteKBps',
  'networkRxKBps',
  'networkTxKBps',
  'processCount',
]

// ============================================================
// 类型
// ============================================================

/** 训练样本（特征向量） */
export type FeatureVector = number[]

/** Isolation Tree 节点 */
interface ITreeNode {
  /** 节点深度 */
  depth: number
  /** 如果是叶子节点，记录路径长度 */
  size: number
  /** 如果是内部节点：分裂特征索引 */
  splitFeature?: number
  /** 分裂阈值 */
  splitValue?: number
  /** 左子树（<= splitValue） */
  left?: ITreeNode
  /** 右子树（> splitValue） */
  right?: ITreeNode
}

/** Isolation Tree */
interface IsolationTree {
  root: ITreeNode
  /** 训练时使用的样本数 */
  sampleSize: number
}

/** 异常检测结果 */
export interface AnomalyScoreResult {
  /** 异常得分 [0, 1]，> 0.5 倾向异常 */
  score: number
  /** 是否判定为异常 */
  isAnomaly: boolean
  /** 触发分裂最多的特征（贡献最大的异常维度） */
  topFeature?: MetricFeatureKey
  /** 实际路径长度 */
  pathLength: number
  /** 训练时平均路径长度（用于参考） */
  expectedPathLength: number
}

/** 训练结果 */
export interface TrainingResult {
  /** 是否训练成功 */
  success: boolean
  /** 树数量 */
  treeCount: number
  /** 训练样本数 */
  sampleCount: number
  /** 训练耗时（ms） */
  duration: number
  /** 错误信息 */
  error?: string
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算 iTree 的期望路径长度 c(n)
 *
 * 公式：c(n) = 2 * H(n-1) - 2*(n-1)/n
 * 其中 H(i) = ln(i) + 0.5772156649（欧拉-马歇罗尼常数）
 *
 * 当 n <= 1 时返回 0
 *
 * @param n 样本数
 */
function expectedPathLength(n: number): number {
  if (n <= 1) return 0
  const euler = 0.5772156649
  // 计算 H(n-1) = ln(n-1) + Euler
  const harmonic = Math.log(n - 1) + euler
  return 2 * harmonic - (2 * (n - 1)) / n
}

/**
 * 从样本集中无放回随机采样 n 个样本
 *
 * @param samples 原始样本集
 * @param n 采样数量
 */
function randomSample(samples: FeatureVector[], n: number): FeatureVector[] {
  if (samples.length <= n) return [...samples]
  const indices = Array.from({ length: samples.length }, (_, i) => i)
  // Fisher-Yates 洗牌
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }
  return indices.slice(0, n).map((i) => samples[i])
}

/**
 * 递归构建单棵 iTree
 *
 * 终止条件：
 * 1. depth >= maxDepth（即 log2(sampleSize)）
 * 2. 样本数 <= 1
 *
 * @param samples 当前节点的样本
 * @param depth 当前深度
 * @param maxDepth 最大深度
 */
function buildITree(samples: FeatureVector[], depth: number, maxDepth: number): ITreeNode {
  // 终止条件：到达深度上限或样本数 <= 1
  if (depth >= maxDepth || samples.length <= 1) {
    return { depth, size: samples.length }
  }

  const featureCount = samples[0].length
  // 随机选择一个特征
  const splitFeature = Math.floor(Math.random() * featureCount)
  const values = samples.map((s) => s[splitFeature])
  const min = Math.min(...values)
  const max = Math.max(...values)

  // 若该特征所有值相同，无法继续分裂
  if (min === max) {
    return { depth, size: samples.length }
  }

  // 在 [min, max] 之间随机生成分裂点
  const splitValue = min + Math.random() * (max - min)

  const leftSamples: FeatureVector[] = []
  const rightSamples: FeatureVector[] = []
  for (const s of samples) {
    if (s[splitFeature] <= splitValue) {
      leftSamples.push(s)
    } else {
      rightSamples.push(s)
    }
  }

  return {
    depth,
    size: samples.length,
    splitFeature,
    splitValue,
    left: buildITree(leftSamples, depth + 1, maxDepth),
    right: buildITree(rightSamples, depth + 1, maxDepth),
  }
}

/**
 * 计算样本在单棵 iTree 中的路径长度
 *
 * 叶子节点的路径长度 = depth + c(size)
 * 内部节点根据分裂条件递归左/右子树
 *
 * @param tree iTree 根节点
 * @param sample 待预测样本
 */
function pathLengthInTree(tree: ITreeNode, sample: FeatureVector): number {
  let node = tree
  while (node.splitFeature !== undefined && node.left && node.right) {
    if (sample[node.splitFeature] <= node.splitValue!) {
      node = node.left
    } else {
      node = node.right
    }
  }
  // 到达叶子节点：路径长度 = 已遍历深度 + 期望路径长度调整
  return node.depth + expectedPathLength(node.size)
}

/**
 * 计算每个特征对样本异常的贡献度
 *
 * 通过统计路径上各特征被用作分裂特征的次数（加权深度越浅权重越高）
 *
 * @param tree iTree 根节点
 * @param sample 待预测样本
 */
function featureContributionInTree(
  tree: ITreeNode,
  sample: FeatureVector,
): Map<number, number> {
  const contributions = new Map<number, number>()
  let node: ITreeNode | undefined = tree
  while (node && node.splitFeature !== undefined && node.left && node.right) {
    const feature = node.splitFeature
    // 深度越浅的分裂贡献越大
    const weight = 1 / (node.depth + 1)
    contributions.set(feature, (contributions.get(feature) ?? 0) + weight)
    if (sample[feature] <= node.splitValue!) {
      node = node.left
    } else {
      node = node.right
    }
  }
  return contributions
}

// ============================================================
// Isolation Forest 主体
// ============================================================

/**
 * Isolation Forest 异常检测器
 *
 * 使用方式：
 * ```ts
 * const forest = new IsolationForest({ nTrees: 50, sampleSize: 64 })
 * const samples = extractFeaturesFromMetrics(metricsArray)
 * forest.train(samples)
 * const result = forest.predict(newSample)
 * if (result.isAnomaly) {
 *   // 触发告警
 * }
 * ```
 */
export class IsolationForest {
  private trees: IsolationTree[] = []
  private trained = false
  private readonly nTrees: number
  private readonly sampleSize: number
  private readonly threshold: number
  private expectedPathLen = 0

  constructor(options?: {
    nTrees?: number
    sampleSize?: number
    threshold?: number
  }) {
    this.nTrees = options?.nTrees ?? DEFAULT_N_TREES
    this.sampleSize = Math.min(options?.sampleSize ?? DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE)
    this.threshold = options?.threshold ?? DEFAULT_ANOMALY_THRESHOLD
  }

  /** 是否已训练 */
  isTrained(): boolean {
    return this.trained
  }

  /** 获取树数量 */
  getTreeCount(): number {
    return this.trees.length
  }

  /**
   * 训练 Isolation Forest
 *
   * @param samples 训练样本集
   * @returns 训练结果
   */
  train(samples: FeatureVector[]): TrainingResult {
    const startTime = Date.now()
    try {
      if (samples.length < 2) {
        return {
          success: false,
          treeCount: 0,
          sampleCount: samples.length,
          duration: 0,
          error: '训练样本不足（至少需要 2 条）',
        }
      }

      // 重置状态
      this.trees = []
      this.trained = false

      const actualSampleSize = Math.min(this.sampleSize, samples.length)
      const maxDepth = Math.ceil(Math.log2(actualSampleSize)) || 1
      this.expectedPathLen = expectedPathLength(actualSampleSize)

      // 构建 nTrees 棵独立的 iTree
      for (let i = 0; i < this.nTrees; i++) {
        const subSample = randomSample(samples, actualSampleSize)
        const root = buildITree(subSample, 0, maxDepth)
        this.trees.push({ root, sampleSize: actualSampleSize })
      }

      this.trained = true
      const duration = Date.now() - startTime
      logger.monitoring?.info(
        `[IsolationForest] 训练完成: trees=${this.nTrees} samples=${samples.length} duration=${duration}ms`,
      )

      return {
        success: true,
        treeCount: this.trees.length,
        sampleCount: samples.length,
        duration,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.monitoring?.error('[IsolationForest] 训练失败:', e)
      return {
        success: false,
        treeCount: 0,
        sampleCount: samples.length,
        duration: Date.now() - startTime,
        error: msg,
      }
    }
  }

  /**
   * 预测单条样本的异常得分
   *
   * 异常得分公式：s(x, n) = 2^(-E(h(x)) / c(n))
   * - h(x): 样本 x 在森林中的平均路径长度
   * - c(n): 训练样本的期望路径长度
   * - 得分越接近 1 越异常，越接近 0.5 越正常
   *
   * @param sample 待预测样本
   */
  predict(sample: FeatureVector): AnomalyScoreResult {
    if (!this.trained || this.trees.length === 0) {
      return {
        score: 0,
        isAnomaly: false,
        pathLength: 0,
        expectedPathLength: 0,
      }
    }

    // 计算平均路径长度 + 统计特征贡献
    let totalPath = 0
    const featureContributions = new Map<number, number>()

    for (const tree of this.trees) {
      totalPath += pathLengthInTree(tree.root, sample)
      const contributions = featureContributionInTree(tree.root, sample)
      for (const [feature, weight] of contributions) {
        featureContributions.set(
          feature,
          (featureContributions.get(feature) ?? 0) + weight,
        )
      }
    }

    const avgPath = totalPath / this.trees.length

    // 异常得分：s = 2^(-avgPath / expectedPathLen)
    const score = Math.pow(2, -avgPath / Math.max(this.expectedPathLen, 1))

    // 找出贡献最大的特征
    let topFeatureIdx = -1
    let topContribution = 0
    for (const [feature, weight] of featureContributions) {
      if (weight > topContribution) {
        topContribution = weight
        topFeatureIdx = feature
      }
    }

    const result: AnomalyScoreResult = {
      score: Math.round(score * 1000) / 1000,
      isAnomaly: score >= this.threshold,
      pathLength: Math.round(avgPath * 1000) / 1000,
      expectedPathLength: this.expectedPathLen,
    }

    if (topFeatureIdx >= 0 && topFeatureIdx < DEFAULT_FEATURES.length) {
      result.topFeature = DEFAULT_FEATURES[topFeatureIdx]
    }

    return result
  }

  /**
   * 批量预测
   *
   * @param samples 待预测样本集
   */
  predictBatch(samples: FeatureVector[]): AnomalyScoreResult[] {
    return samples.map((s) => this.predict(s))
  }

  /**
   * 重置模型
   */
  reset(): void {
    this.trees = []
    this.trained = false
    this.expectedPathLen = 0
  }
}

// ============================================================
// 特征提取工具
// ============================================================

/**
 * 从 SystemMetrics 提取特征向量
 *
 * 按固定特征顺序提取数值，便于训练/预测保持一致
 *
 * @param metrics 系统指标采样
 * @param features 使用的特征列表（默认 DEFAULT_FEATURES）
 */
export function extractFeaturesFromMetrics(
  metrics: SystemMetrics,
  features: MetricFeatureKey[] = DEFAULT_FEATURES,
): FeatureVector {
  return features.map((f) => {
    const value = metrics[f]
    // 处理无效值（-1 表示获取失败）
    if (value < 0) return 0
    return value
  })
}

/**
 * 批量提取特征向量
 *
 * @param metricsList 系统指标采样列表
 * @param features 使用的特征列表
 */
export function extractFeaturesFromMetricsBatch(
  metricsList: SystemMetrics[],
  features: MetricFeatureKey[] = DEFAULT_FEATURES,
): FeatureVector[] {
  return metricsList.map((m) => extractFeaturesFromMetrics(m, features))
}

/**
 * 特征归一化（Z-Score 标准化）
 *
 * 用于训练前预处理，使各特征具有相同尺度
 *
 * @param samples 原始样本集
 * @returns 归一化后的样本集 + 归一化参数（用于新数据）
 */
export function normalizeFeatures(samples: FeatureVector[]): {
  normalized: FeatureVector[]
  means: number[]
  stdDevs: number[]
} {
  if (samples.length === 0) {
    return { normalized: [], means: [], stdDevs: [] }
  }

  const dim = samples[0].length
  const means = new Array(dim).fill(0)
  const stdDevs = new Array(dim).fill(0)

  // 计算均值
  for (const s of samples) {
    for (let i = 0; i < dim; i++) {
      means[i] += s[i]
    }
  }
  for (let i = 0; i < dim; i++) {
    means[i] /= samples.length
  }

  // 计算标准差
  for (const s of samples) {
    for (let i = 0; i < dim; i++) {
      stdDevs[i] += Math.pow(s[i] - means[i], 2)
    }
  }
  for (let i = 0; i < dim; i++) {
    stdDevs[i] = Math.sqrt(stdDevs[i] / samples.length)
    // 避免除以 0
    if (stdDevs[i] === 0) stdDevs[i] = 1
  }

  // 归一化
  const normalized = samples.map((s) =>
    s.map((v, i) => (v - means[i]) / stdDevs[i]),
  )

  return { normalized, means, stdDevs }
}

// ============================================================
// 单例访问
// ============================================================

let isolationForestInstance: IsolationForest | null = null

/**
 * 获取 Isolation Forest 单例
 *
 * 默认配置：50 棵树，子采样 64，异常阈值 0.6
 */
export function getIsolationForest(): IsolationForest {
  if (!isolationForestInstance) {
    isolationForestInstance = new IsolationForest()
  }
  return isolationForestInstance
}
