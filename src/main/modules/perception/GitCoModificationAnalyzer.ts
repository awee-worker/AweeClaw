/**
 * Git 伴随修改分析器 — 阶段9 s9-09
 *
 * 职责：
 * - 通过 `git log --name-only` 解析项目提交历史
 * - 统计文件对共现频率（同一 commit 中同时被修改的文件对）
 * - 提供单文件的伴随修改文件查询（Top-K 最常一起修改的文件）
 * - 内存缓存 + JSON 持久化（按项目路径隔离）
 *
 * 设计原则：
 * - 单例模式：全局唯一实例
 * - 增量分析：首次分析后缓存到磁盘，后续命中缓存直接返回
 * - 容错：git 命令失败、非 git 仓库、空历史等场景安全降级
 * - 低开销：仅使用文件对计数 Map，不存储完整 commit 历史
 *
 * 算法：
 * 1. git log --name-only --pretty=format: 获取所有 commit 的文件列表
 * 2. 对每个 commit，枚举文件对 (i, j)，coOccurrence[i][j]++
 * 3. 查询时按 coOccurrence 倒序取 Top-K
 *
 * 复杂度：
 * - 单 commit 文件数为 n，则该 commit 产生 C(n,2) = n*(n-1)/2 个文件对
 * - 总复杂度 O(sum(n_i^2))，通常单 commit 文件数 < 50，可控
 *
 * @module perception/GitCoModificationAnalyzer
 */

import { logger } from '@shared/toolkit/LogEngine'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ============================================================
// 类型定义
// ============================================================

/** 单个伴随修改文件项 */
export interface CoModifiedFile {
  /** 文件相对路径（相对于项目根） */
  relativePath: string
  /** 共现次数（与查询文件在同一 commit 中出现的次数） */
  coOccurrence: number
  /** 共现频率（coOccurrence / queryFileTotalCommits，0-1） */
  frequency: number
}

/** 伴随修改查询结果 */
export interface CoModificationQueryResult {
  /** 查询的文件相对路径 */
  filePath: string
  /** 该文件在 git 历史中出现的总 commit 数 */
  totalCommits: number
  /** 伴随修改文件列表（按共现次数倒序） */
  coModifiedFiles: CoModifiedFile[]
}

/** 伴随修改分析统计 */
export interface CoModificationStats {
  /** 项目根路径 */
  projectPath: string
  /** 分析的 commit 总数 */
  totalCommits: number
  /** 涉及的唯一文件数 */
  uniqueFiles: number
  /** 文件对总数（去重后） */
  uniqueFilePairs: number
  /** 分析耗时（毫秒） */
  analysisDurationMs: number
  /** 分析时间戳 */
  analyzedAt: number
  /** 缓存文件路径 */
  cachePath: string
  /** 是否命中缓存 */
  fromCache: boolean
}

/** 分析选项 */
export interface AnalyzeOptions {
  /** 最大分析的 commit 数（默认 1000） */
  maxCommits?: number
  /** 是否强制刷新缓存 */
  forceRefresh?: boolean
  /** 跳过的目录（默认包含 node_modules, dist, build） */
  excludedDirs?: string[]
}

// ============================================================
// 常量
// ============================================================

/** 默认最大 commit 数 */
const DEFAULT_MAX_COMMITS = 1000

/** 默认排除目录 */
const DEFAULT_EXCLUDED_DIRS = ['node_modules', 'dist', 'build', 'out', '.next', 'coverage']

/** 缓存目录名 */
const CACHE_DIR_NAME = 'co-modification-cache'

/** 缓存文件版本 */
const CACHE_VERSION = 1

/** 缓存文件 TTL（7 天，毫秒） */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ============================================================
// 缓存文件结构
// ============================================================

interface CacheFile {
  version: number
  projectPath: string
  analyzedAt: number
  totalCommits: number
  /** 文件 → 该文件出现的 commit 数 */
  fileCommitCounts: Record<string, number>
  /** 文件对 → 共现次数（key 格式: "fileA\x00fileB"，fileA < fileB） */
  pairCounts: Record<string, number>
}

// ============================================================
// GitCoModificationAnalyzer 单例
// ============================================================

/**
 * Git 伴随修改分析器单例
 *
 * 使用方式：
 * ```ts
 * const analyzer = GitCoModificationAnalyzer.getInstance()
 * const stats = await analyzer.analyze('/path/to/project')
 * const coFiles = analyzer.getCoModifiedFiles('/path/to/project', 'src/foo.ts', 10)
 * ```
 */
export class GitCoModificationAnalyzer {
  private static instance: GitCoModificationAnalyzer | null = null

  /** 按项目路径索引的分析结果（内存缓存） */
  private readonly projectCache = new Map<
    string,
    {
      stats: CoModificationStats
      fileCommitCounts: Map<string, number>
      pairCounts: Map<string, number>
    }
  >()

  /** 缓存目录路径 */
  private readonly cacheDir: string

  private constructor() {
    this.cacheDir = path.join(app.getPath('userData'), CACHE_DIR_NAME)
    this.ensureCacheDir()
  }

  static getInstance(): GitCoModificationAnalyzer {
    if (!GitCoModificationAnalyzer.instance) {
      GitCoModificationAnalyzer.instance = new GitCoModificationAnalyzer()
    }
    return GitCoModificationAnalyzer.instance
  }

  // ============================================================
  // 公开 API
  // ============================================================

  /**
   * 分析项目的 git 历史伴随修改模式
   *
   * 流程：
   * 1. 检查内存缓存 → 命中则直接返回
   * 2. 检查磁盘缓存 → 命中且未过期则加载到内存
   * 3. 执行 git log --name-only 解析 commit 历史
   * 4. 构建文件对共现计数
   * 5. 持久化到磁盘缓存
   *
   * @param projectPath 项目根路径（必须是 git 仓库）
   * @param options 分析选项
   */
  async analyze(
    projectPath: string,
    options: AnalyzeOptions = {},
  ): Promise<CoModificationStats> {
    const startTime = Date.now()
    const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS
    const forceRefresh = options.forceRefresh ?? false
    const excludedDirs = options.excludedDirs ?? DEFAULT_EXCLUDED_DIRS

    // 1. 检查内存缓存
    if (!forceRefresh) {
      const cached = this.projectCache.get(projectPath)
      if (cached) {
        logger.perception?.debug(
          `[GitCoModificationAnalyzer] 内存缓存命中: ${projectPath}`,
        )
        return cached.stats
      }
    }

    // 2. 检查磁盘缓存
    if (!forceRefresh) {
      const diskCache = await this.loadDiskCache(projectPath)
      if (diskCache) {
        logger.perception?.info(
          `[GitCoModificationAnalyzer] 磁盘缓存命中: ${projectPath} (${diskCache.totalCommits} commits)`,
        )
        return diskCache
      }
    }

    // 3. 执行 git log 解析
    try {
      const commitFiles = await this.fetchGitLogFiles(
        projectPath,
        maxCommits,
        excludedDirs,
      )

      // 4. 构建文件对共现计数
      const fileCommitCounts = new Map<string, number>()
      const pairCounts = new Map<string, number>()

      for (const files of commitFiles) {
        // 去重（单 commit 内同一文件可能因 rename 出现多次）
        const uniqueFiles = Array.from(new Set(files))
        if (uniqueFiles.length < 2) {
          // 单文件 commit 仍计入 fileCommitCounts
          for (const f of uniqueFiles) {
            fileCommitCounts.set(f, (fileCommitCounts.get(f) ?? 0) + 1)
          }
          continue
        }

        // 累加单文件计数
        for (const f of uniqueFiles) {
          fileCommitCounts.set(f, (fileCommitCounts.get(f) ?? 0) + 1)
        }

        // 枚举文件对（排序保证 key 一致性）
        const sorted = uniqueFiles.slice().sort()
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const pairKey = `${sorted[i]}\x00${sorted[j]}`
            pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1)
          }
        }
      }

      const stats: CoModificationStats = {
        projectPath,
        totalCommits: commitFiles.length,
        uniqueFiles: fileCommitCounts.size,
        uniqueFilePairs: pairCounts.size,
        analysisDurationMs: Date.now() - startTime,
        analyzedAt: Date.now(),
        cachePath: this.getCachePath(projectPath),
        fromCache: false,
      }

      // 5. 持久化到磁盘
      await this.saveDiskCache(projectPath, stats, fileCommitCounts, pairCounts)

      // 6. 写入内存缓存
      this.projectCache.set(projectPath, {
        stats,
        fileCommitCounts,
        pairCounts,
      })

      logger.perception?.info(
        `[GitCoModificationAnalyzer] 分析完成: ${projectPath} (${stats.totalCommits} commits, ${stats.uniqueFiles} files, ${stats.uniqueFilePairs} pairs, ${stats.analysisDurationMs}ms)`,
      )

      return stats
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error(
        `[GitCoModificationAnalyzer] 分析失败: ${projectPath} - ${msg}`,
      )
      throw e
    }
  }

  /**
   * 查询单个文件的伴随修改文件列表
   *
   * @param projectPath 项目根路径
   * @param relativeFilePath 查询文件的相对路径
   * @param topK 返回前 K 个最常共现的文件（默认 10）
   */
  async getCoModifiedFiles(
    projectPath: string,
    relativeFilePath: string,
    topK: number = 10,
  ): Promise<CoModificationQueryResult> {
    // 确保缓存存在
    let cached = this.projectCache.get(projectPath)
    if (!cached) {
      const stats = await this.analyze(projectPath)
      cached = this.projectCache.get(projectPath)
      if (!cached) {
        return {
          filePath: relativeFilePath,
          totalCommits: 0,
          coModifiedFiles: [],
        }
      }
      // 使用新分析的 stats（避免未使用变量警告）
      void stats
    }

    const { fileCommitCounts, pairCounts } = cached
    const totalCommits = fileCommitCounts.get(relativeFilePath) ?? 0

    if (totalCommits === 0) {
      return {
        filePath: relativeFilePath,
        totalCommits: 0,
        coModifiedFiles: [],
      }
    }

    // 收集所有与该文件共现的文件对
    const candidates: CoModifiedFile[] = []
    for (const [pairKey, count] of pairCounts) {
      const [fileA, fileB] = pairKey.split('\x00')
      if (fileA === relativeFilePath) {
        candidates.push({
          relativePath: fileB,
          coOccurrence: count,
          frequency: count / totalCommits,
        })
      } else if (fileB === relativeFilePath) {
        candidates.push({
          relativePath: fileA,
          coOccurrence: count,
          frequency: count / totalCommits,
        })
      }
    }

    // 按共现次数倒序，取 Top-K
    candidates.sort((a, b) => b.coOccurrence - a.coOccurrence)
    const top = candidates.slice(0, topK)

    return {
      filePath: relativeFilePath,
      totalCommits,
      coModifiedFiles: top,
    }
  }

  /**
   * 批量查询多个文件的伴随修改
   *
   * 用于 ImpactAnalyzer 一次分析多个变更文件。
   *
   * @param projectPath 项目根路径
   * @param relativeFilePaths 文件相对路径列表
   * @param topK 每个文件返回的 Top-K
   */
  async batchGetCoModifiedFiles(
    projectPath: string,
    relativeFilePaths: string[],
    topK: number = 5,
  ): Promise<Map<string, CoModificationQueryResult>> {
    const results = new Map<string, CoModificationQueryResult>()
    // 确保缓存已加载
    await this.analyze(projectPath).catch(() => {
      // 分析失败时返回空结果
    })

    for (const filePath of relativeFilePaths) {
      try {
        const result = await this.getCoModifiedFiles(projectPath, filePath, topK)
        results.set(filePath, result)
      } catch (e) {
        logger.perception?.warn(
          `[GitCoModificationAnalyzer] 查询伴随修改失败: ${filePath}`,
          e instanceof Error ? e.message : String(e),
        )
        results.set(filePath, {
          filePath,
          totalCommits: 0,
          coModifiedFiles: [],
        })
      }
    }
    return results
  }

  /** 获取已分析项目的统计信息（未分析则返回 null） */
  getStats(projectPath: string): CoModificationStats | null {
    return this.projectCache.get(projectPath)?.stats ?? null
  }

  /** 清空指定项目的缓存（内存 + 磁盘） */
  async clearCache(projectPath: string): Promise<void> {
    this.projectCache.delete(projectPath)
    const cachePath = this.getCachePath(projectPath)
    try {
      await fs.promises.unlink(cachePath)
      logger.perception?.info(
        `[GitCoModificationAnalyzer] 已清空缓存: ${projectPath}`,
      )
    } catch (e) {
      // 文件不存在视为成功
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.perception?.warn(
          `[GitCoModificationAnalyzer] 清空缓存失败: ${projectPath}`,
          e instanceof Error ? e.message : String(e),
        )
      }
    }
  }

  /** 释放所有资源 */
  async dispose(): Promise<void> {
    this.projectCache.clear()
    GitCoModificationAnalyzer.instance = null
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 确保缓存目录存在 */
  private ensureCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true })
      }
    } catch (e) {
      logger.perception?.warn(
        `[GitCoModificationAnalyzer] 创建缓存目录失败: ${this.cacheDir}`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  /** 获取项目对应的缓存文件路径 */
  private getCachePath(projectPath: string): string {
    // 用项目路径的 hash 作为文件名，避免特殊字符
    const hash = Buffer.from(projectPath).toString('base64url').slice(0, 40)
    return path.join(this.cacheDir, `${hash}.json`)
  }

  /**
   * 执行 git log 获取每个 commit 的文件列表
   *
   * 使用 --name-only --pretty=format: 分隔 commit，
   * 输出格式为：
   * ```
   * (空行，commit 1 的 pretty 输出为空)
   * file1.ts
   * file2.ts
   * (空行，commit 2)
   * file3.ts
   * ...
   * ```
   */
  private async fetchGitLogFiles(
    projectPath: string,
    maxCommits: number,
    excludedDirs: string[],
  ): Promise<string[][]> {
    // 使用 \x00 作为 commit 分隔符（NUL 字符不会出现在文件名中）
    // --pretty=format:%H 输出 commit hash 作为分隔标记
    const { stdout } = await execFileAsync(
      'git',
      [
        'log',
        `--max-count=${maxCommits}`,
        '--name-only',
        '--pretty=format:%H',
        '--no-merges',
      ],
      {
        cwd: projectPath,
        maxBuffer: 50 * 1024 * 1024, // 50MB，大仓库可能输出很多
        timeout: 30_000, // 30s 超时
      },
    )

    return this.parseGitLogOutput(stdout, excludedDirs)
  }

  /** 解析 git log 输出为 commit 文件列表 */
  private parseGitLogOutput(
    output: string,
    excludedDirs: string[],
  ): string[][] {
    const commits: string[][] = []
    const lines = output.split('\n')
    let currentFiles: string[] = []
    let inCommit = false

    for (const line of lines) {
      const trimmed = line.trim()
      // commit hash 行（40 字符十六进制）
      if (/^[0-9a-f]{40}$/.test(trimmed)) {
        // 保存上一个 commit
        if (inCommit && currentFiles.length > 0) {
          commits.push(currentFiles)
        }
        currentFiles = []
        inCommit = true
        continue
      }
      // 空行跳过
      if (trimmed === '') continue
      // 文件路径行
      if (inCommit) {
        // 过滤排除目录
        if (!excludedDirs.some((dir) => trimmed.startsWith(dir + '/') || trimmed === dir)) {
          currentFiles.push(trimmed)
        }
      }
    }
    // 保存最后一个 commit
    if (inCommit && currentFiles.length > 0) {
      commits.push(currentFiles)
    }

    return commits
  }

  /** 从磁盘加载缓存 */
  private async loadDiskCache(
    projectPath: string,
  ): Promise<CoModificationStats | null> {
    const cachePath = this.getCachePath(projectPath)
    try {
      const content = await fs.promises.readFile(cachePath, 'utf-8')
      const data: CacheFile = JSON.parse(content)

      // 版本检查
      if (data.version !== CACHE_VERSION) {
        return null
      }

      // TTL 检查
      if (Date.now() - data.analyzedAt > CACHE_TTL_MS) {
        return null
      }

      // 路径校验
      if (data.projectPath !== projectPath) {
        return null
      }

      // 加载到内存
      const fileCommitCounts = new Map(Object.entries(data.fileCommitCounts))
      const pairCounts = new Map(Object.entries(data.pairCounts))

      const stats: CoModificationStats = {
        projectPath,
        totalCommits: data.totalCommits,
        uniqueFiles: fileCommitCounts.size,
        uniqueFilePairs: pairCounts.size,
        analysisDurationMs: 0,
        analyzedAt: data.analyzedAt,
        cachePath,
        fromCache: true,
      }

      this.projectCache.set(projectPath, {
        stats,
        fileCommitCounts,
        pairCounts,
      })

      return stats
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        logger.perception?.warn(
          `[GitCoModificationAnalyzer] 加载磁盘缓存失败: ${projectPath}`,
          e instanceof Error ? e.message : String(e),
        )
      }
      return null
    }
  }

  /** 保存缓存到磁盘 */
  private async saveDiskCache(
    projectPath: string,
    stats: CoModificationStats,
    fileCommitCounts: Map<string, number>,
    pairCounts: Map<string, number>,
  ): Promise<void> {
    const cachePath = this.getCachePath(projectPath)
    try {
      const data: CacheFile = {
        version: CACHE_VERSION,
        projectPath,
        analyzedAt: stats.analyzedAt,
        totalCommits: stats.totalCommits,
        fileCommitCounts: Object.fromEntries(fileCommitCounts),
        pairCounts: Object.fromEntries(pairCounts),
      }
      await fs.promises.writeFile(cachePath, JSON.stringify(data), 'utf-8')
    } catch (e) {
      logger.perception?.warn(
        `[GitCoModificationAnalyzer] 保存磁盘缓存失败: ${projectPath}`,
        e instanceof Error ? e.message : String(e),
      )
    }
  }
}
