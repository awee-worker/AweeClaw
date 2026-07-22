/**
 * 影响分析器 — 基于依赖图的变更影响评估
 *
 * 职责：
 * - 接收变更文件列表（来自 Git diff 或编辑器保存事件）
 * - 利用 CodeDependencyGraph 进行 BFS 上游影响分析
 * - 评估影响等级（高/中/低）
 * - 识别测试文件并单独标记
 * - 输出结构化影响报告供 UI 可视化和 AI 上下文注入
 *
 * 影响等级判定：
 * - HIGH：受影响文件 ≥ 10 个，或核心入口文件被改
 * - MEDIUM：受影响文件 3-9 个
 * - LOW：受影响文件 < 3 个
 *
 * @module perception/ImpactAnalyzer
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import { CodeDependencyGraph, type DependencyGraph, type CodeLanguage } from './CodeDependencyGraph'
import { GitCoModificationAnalyzer, type CoModifiedFile } from './GitCoModificationAnalyzer'

// ============================================================
// 类型定义
// ============================================================

/** 变更类型 */
export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed'

/** 变更文件 */
export interface ChangedFile {
  /** 文件绝对路径 */
  filePath: string
  /** 相对项目根的路径 */
  relativePath: string
  /** 变更类型 */
  changeType: ChangeType
  /** 新增行数 */
  additions?: number
  /** 删除行数 */
  deletions?: number
}

/** 影响等级 */
export type ImpactLevel = 'high' | 'medium' | 'low' | 'none'

/** 单个文件的影响结果 */
export interface FileImpactResult {
  /** 变更文件路径 */
  changedFile: string
  /** 相对路径 */
  relativePath: string
  /** 变更类型 */
  changeType: ChangeType
  /** 受影响的文件列表（按距离排序） */
  impactedFiles: Array<{
    filePath: string
    relativePath: string
    depth: number
    isTest: boolean
  }>
  /** 受影响文件总数 */
  impactedCount: number
  /** 非测试文件数 */
  nonTestCount: number
  /** 测试文件数 */
  testCount: number
  /** 影响等级 */
  impactLevel: ImpactLevel
  /** 最大传播深度 */
  maxDepth: number
  /** Git 历史伴随修改文件列表（阶段9 s9-09，可能为空） */
  coModifiedFiles?: CoModifiedFile[]
  /** 该文件在 git 历史中出现的 commit 数（阶段9 s9-09） */
  coModifiedTotalCommits?: number
}

/** 影响分析请求 */
export interface ImpactAnalysisRequest {
  /** 项目根路径 */
  projectPath: string
  /** 项目主语言 */
  language?: CodeLanguage
  /** 变更文件列表 */
  changedFiles: ChangedFile[]
  /** 是否强制重建依赖图 */
  forceRebuild?: boolean
  /** 最大分析深度 */
  maxDepth?: number
  /** 是否启用 Git 伴随修改分析（阶段9 s9-09，默认 true） */
  enableCoModification?: boolean
  /** 伴随修改分析返回的 Top-K（默认 5） */
  coModificationTopK?: number
  /** 是否强制刷新伴随修改缓存（阶段9 s9-09） */
  forceRefreshCoModification?: boolean
}

/** 影响分析响应 */
export interface ImpactAnalysisResponse {
  /** 是否成功 */
  success: boolean
  /** 项目路径 */
  projectPath: string
  /** 总体影响等级（取最高） */
  overallImpact: ImpactLevel
  /** 总受影响文件数（去重） */
  totalImpactedFiles: number
  /** 各变更文件的影响详情 */
  results: FileImpactResult[]
  /** 依赖图统计 */
  graphStats: {
    fileCount: number
    edgeCount: number
    builtAt: number
  }
  /** 高风险文件列表（被多个变更影响的文件） */
  highRiskFiles: Array<{
    filePath: string
    relativePath: string
    impactedByCount: number
  }>
  /** Git 伴随修改分析统计（阶段9 s9-09，未启用时为 null） */
  coModificationStats?: {
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analyzedAt: number
    fromCache: boolean
  } | null
  /** 错误信息 */
  error?: string
}

// ============================================================
// 常量
// ============================================================

/** 高影响阈值 */
const HIGH_IMPACT_THRESHOLD = 10

/** 中影响阈值 */
const MEDIUM_IMPACT_THRESHOLD = 3

/** 测试文件特征 */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
  /\/tests?\//,
  /\/__tests__\//,
  /\.test\.py$/,
  /test_[\w]+\.py$/,
  /[\w]+_test\.py$/,
]

/** 核心入口文件名 */
const ENTRY_FILE_PATTERNS = [
  /index\.[jt]sx?$/,
  /main\.[jt]sx?$/,
  /app\.[jt]sx?$/,
  /server\.[jt]sx?$/,
  /__init__\.py$/,
  /main\.py$/,
  /app\.py$/,
]

// ============================================================
// 影响分析器
// ============================================================

/**
 * 影响分析器单例
 *
 * 使用方式：
 * ```ts
 * const analyzer = ImpactAnalyzer.getInstance()
 * const result = await analyzer.analyzeImpact({
 *   projectPath: '/path/to/project',
 *   changedFiles: [{ filePath: '/src/foo.ts', relativePath: 'src/foo.ts', changeType: 'modified' }],
 * })
 * ```
 */
export class ImpactAnalyzer {
  private static instance: ImpactAnalyzer | null = null

  private readonly graphBuilder: CodeDependencyGraph

  private constructor() {
    this.graphBuilder = CodeDependencyGraph.getInstance()
  }

  static getInstance(): ImpactAnalyzer {
    if (!ImpactAnalyzer.instance) {
      ImpactAnalyzer.instance = new ImpactAnalyzer()
    }
    return ImpactAnalyzer.instance
  }

  /**
   * 执行影响分析
   *
   * 流程：
   * 1. 构建或获取依赖图
   * 2. 对每个变更文件执行 BFS 上游分析
   * 3. 标记测试文件
   * 4. 计算影响等级
   * 5. 识别高风险文件（被多个变更影响）
   * 6. （可选）Git 伴随修改分析增强（阶段9 s9-09）
   */
  async analyzeImpact(req: ImpactAnalysisRequest): Promise<ImpactAnalysisResponse> {
    try {
      const language = req.language ?? 'typescript'
      const maxDepth = req.maxDepth ?? 10
      const enableCoModification = req.enableCoModification ?? true
      const coModificationTopK = req.coModificationTopK ?? 5

      // 1. 构建依赖图
      const graph = await this.graphBuilder.buildGraph(
        req.projectPath,
        language,
        req.forceRebuild ?? false,
      )

      // 2. 逐个分析变更文件
      const results: FileImpactResult[] = []
      const impactedCountMap = new Map<string, number>() // 文件 → 被多少变更影响

      for (const changedFile of req.changedFiles) {
        const result = this.analyzeFile(graph, changedFile, maxDepth)
        results.push(result)

        // 累加受影响文件计数
        for (const imp of result.impactedFiles) {
          impactedCountMap.set(
            imp.filePath,
            (impactedCountMap.get(imp.filePath) ?? 0) + 1,
          )
        }
      }

      // 3. 总体影响等级（取最高）
      const overallImpact = this.computeOverallImpact(results)

      // 4. 总受影响文件数（去重）
      const totalImpactedFiles = impactedCountMap.size

      // 5. 高风险文件（被 ≥ 2 个变更影响）
      const highRiskFiles = Array.from(impactedCountMap.entries())
        .filter(([, count]) => count >= 2)
        .map(([filePath, count]) => ({
          filePath,
          relativePath: path.relative(req.projectPath, filePath),
          impactedByCount: count,
        }))
        .sort((a, b) => b.impactedByCount - a.impactedByCount)
        .slice(0, 20)

      // 6. Git 伴随修改分析增强（阶段9 s9-09）
      let coModificationStats: ImpactAnalysisResponse['coModificationStats'] = null
      if (enableCoModification && results.length > 0) {
        try {
          const coModAnalyzer = GitCoModificationAnalyzer.getInstance()
          // 分析项目（命中缓存则快速返回）
          const stats = await coModAnalyzer.analyze(req.projectPath, {
            forceRefresh: req.forceRefreshCoModification ?? false,
          })
          coModificationStats = {
            totalCommits: stats.totalCommits,
            uniqueFiles: stats.uniqueFiles,
            uniqueFilePairs: stats.uniqueFilePairs,
            analyzedAt: stats.analyzedAt,
            fromCache: stats.fromCache,
          }

          // 批量查询每个变更文件的伴随修改
          const relativePaths = results.map((r) => r.relativePath)
          const batchResults = await coModAnalyzer.batchGetCoModifiedFiles(
            req.projectPath,
            relativePaths,
            coModificationTopK,
          )

          // 将伴随修改结果合并到 FileImpactResult
          for (const result of results) {
            const coMod = batchResults.get(result.relativePath)
            if (coMod) {
              result.coModifiedFiles = coMod.coModifiedFiles
              result.coModifiedTotalCommits = coMod.totalCommits
            }
          }

          logger.perception?.info(
            `[ImpactAnalyzer] 伴随修改分析完成: ${stats.totalCommits} commits, ${stats.uniqueFilePairs} pairs (cache=${stats.fromCache})`,
          )
        } catch (e) {
          // 伴随修改失败不影响主流程，仅记录警告
          logger.perception?.warn(
            '[ImpactAnalyzer] 伴随修改分析失败（不影响主流程）:',
            e instanceof Error ? e.message : String(e),
          )
        }
      }

      logger.perception?.info(
        `[ImpactAnalyzer] 分析完成: ${results.length} 变更, ${totalImpactedFiles} 受影响, 总体=${overallImpact}`,
      )

      return {
        success: true,
        projectPath: req.projectPath,
        overallImpact,
        totalImpactedFiles,
        results,
        graphStats: {
          fileCount: graph.fileCount,
          edgeCount: graph.edges.length,
          builtAt: graph.builtAt,
        },
        highRiskFiles,
        coModificationStats,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[ImpactAnalyzer] analyzeImpact 失败:', e)
      return {
        success: false,
        projectPath: req.projectPath,
        overallImpact: 'none',
        totalImpactedFiles: 0,
        results: [],
        graphStats: { fileCount: 0, edgeCount: 0, builtAt: 0 },
        highRiskFiles: [],
        coModificationStats: null,
        error: msg,
      }
    }
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    ImpactAnalyzer.instance = null
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 分析单个变更文件 */
  private analyzeFile(
    graph: DependencyGraph,
    changedFile: ChangedFile,
    maxDepth: number,
  ): FileImpactResult {
    const impactedRaw = this.graphBuilder.findUpstreamImpacted(
      graph,
      changedFile.filePath,
      maxDepth,
    )

    const impactedFiles = impactedRaw.map((item) => ({
      filePath: item.filePath,
      relativePath: path.relative(graph.projectPath, item.filePath),
      depth: item.depth,
      isTest: this.isTestFile(item.filePath),
    }))

    const nonTestCount = impactedFiles.filter((f) => !f.isTest).length
    const testCount = impactedFiles.filter((f) => f.isTest).length
    const maxDepth_found =
      impactedFiles.length > 0 ? Math.max(...impactedFiles.map((f) => f.depth)) : 0

    // 删除操作影响更大
    const score = impactedFiles.length + (changedFile.changeType === 'deleted' ? 2 : 0)
    const isEntry = this.isEntryFile(changedFile.filePath)

    let impactLevel: ImpactLevel
    if (score >= HIGH_IMPACT_THRESHOLD || isEntry) {
      impactLevel = 'high'
    } else if (score >= MEDIUM_IMPACT_THRESHOLD) {
      impactLevel = 'medium'
    } else if (score > 0) {
      impactLevel = 'low'
    } else {
      impactLevel = 'none'
    }

    return {
      changedFile: changedFile.filePath,
      relativePath: changedFile.relativePath,
      changeType: changedFile.changeType,
      impactedFiles,
      impactedCount: impactedFiles.length,
      nonTestCount,
      testCount,
      impactLevel,
      maxDepth: maxDepth_found,
    }
  }

  /** 判断是否为测试文件 */
  private isTestFile(filePath: string): boolean {
    return TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
  }

  /** 判断是否为入口文件 */
  private isEntryFile(filePath: string): boolean {
    return ENTRY_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
  }

  /** 计算总体影响等级（取最高） */
  private computeOverallImpact(results: FileImpactResult[]): ImpactLevel {
    const levels: ImpactLevel[] = ['none', 'low', 'medium', 'high']
    let maxIdx = 0
    for (const r of results) {
      const idx = levels.indexOf(r.impactLevel)
      if (idx > maxIdx) maxIdx = idx
    }
    return levels[maxIdx]
  }
}
