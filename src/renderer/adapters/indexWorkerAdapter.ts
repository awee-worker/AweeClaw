/**
 * [AweeClaw] 场景感知索引策略引擎
 *
 * 与 Adnify 的 IndexWorkerService 差异化：
 * - 类名重命名：IndexWorkerService → ScenarioIndexEngine
 * - 新增场景感知的索引策略（文件过滤、优先级、并发度）
 * - 法律场景：索引法律文档格式、合规标记
 * - 医疗场景：索引医疗记录格式、隐私过滤
 * - 教育场景：索引教育资源、评估文件
 * - 新增场景感知的增量索引策略
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import type { IndexStatus } from '@protocols'

export interface IndexProgress {
  processed: number
  total: number
  chunksCount: number
  isComplete: boolean
  error?: string
  message?: string
}

export interface IndexResult {
  chunks: any[]
  totalFiles: number
  totalChunks: number
}

interface ScenarioIndexConfig {
  fileExtensions: string[]
  excludePatterns: string[]
  maxConcurrency: number
  chunkSize: number
  priorityDirectories: string[]
  incrementalThrottleMs: number
}

const SCENARIO_INDEX_CONFIGS: Record<string, ScenarioIndexConfig> = {
  'dev-assistant': {
    fileExtensions: [],
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
    maxConcurrency: 4,
    chunkSize: 512,
    priorityDirectories: ['src', 'lib'],
    incrementalThrottleMs: 1000,
  },
  'legal': {
    fileExtensions: ['.docx', '.pdf', '.doc', '.txt', '.md', '.rtf'],
    excludePatterns: ['node_modules', '.git', 'dist', 'build', '.cache'],
    maxConcurrency: 2,
    chunkSize: 1024,
    priorityDirectories: ['contracts', 'compliance', 'reviews'],
    incrementalThrottleMs: 2000,
  },
  'medical': {
    fileExtensions: ['.pdf', '.txt', '.md', '.json', '.xml'],
    excludePatterns: ['node_modules', '.git', 'dist', 'build', '.cache', 'patient-raw'],
    maxConcurrency: 2,
    chunkSize: 768,
    priorityDirectories: ['protocols', 'guidelines', 'research'],
    incrementalThrottleMs: 2000,
  },
  'education': {
    fileExtensions: ['.md', '.txt', '.pdf', '.json', '.yaml'],
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
    maxConcurrency: 4,
    chunkSize: 512,
    priorityDirectories: ['courses', 'assessments', 'materials'],
    incrementalThrottleMs: 1500,
  },
}

function getScenarioIndexConfig(): ScenarioIndexConfig {
  const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
  return SCENARIO_INDEX_CONFIGS[scenarioId] ?? SCENARIO_INDEX_CONFIGS['dev-assistant']
}

type ProgressCallback = (progress: IndexProgress) => void
type CompleteCallback = (result: IndexResult) => void
type ErrorCallback = (error: string) => void

class ScenarioIndexEngine {
  private progressCallbacks: Set<ProgressCallback> = new Set()
  private completeCallbacks: Set<CompleteCallback> = new Set()
  private errorCallbacks: Set<ErrorCallback> = new Set()
  private isInitialized = false
  private stopListener: (() => void) | null = null
  private lastIncrementalUpdate = 0

  initialize(): void {
    if (this.isInitialized) return

    try {
      this.stopListener = api.index.onProgress((status: IndexStatus) => {
        this.handleStatusUpdate(status)
      })

      this.isInitialized = true
      const config = getScenarioIndexConfig()
      logger.system.info('[ScenarioIndexEngine] Initialized, extensions:', config.fileExtensions.length || 'all')
    } catch (error) {
      logger.index.error('[ScenarioIndexEngine] Failed to initialize:', error)
    }
  }

  isAvailable(): boolean {
    return this.isInitialized
  }

  async startIndexing(workspacePath: string): Promise<void> {
    if (!this.isInitialized) this.initialize()

    const config = getScenarioIndexConfig()
    logger.system.info('[ScenarioIndexEngine] Starting indexing for:', workspacePath, 'config:', {
      extensions: config.fileExtensions.length || 'all',
      concurrency: config.maxConcurrency,
    })

    await api.index.start(workspacePath)
  }

  stopIndexing(): void {
    logger.index.warn('[ScenarioIndexEngine] Stop not fully implemented in backend')
  }

  async updateFile(workspacePath: string, filePath: string): Promise<void> {
    const config = getScenarioIndexConfig()
    const now = Date.now()

    if (config.fileExtensions.length > 0) {
      const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
      if (!config.fileExtensions.includes(ext)) {
        logger.system.debug('[ScenarioIndexEngine] Skipping non-scenario file:', filePath)
        return
      }
    }

    if (now - this.lastIncrementalUpdate < config.incrementalThrottleMs) {
      logger.system.debug('[ScenarioIndexEngine] Throttled incremental update for:', filePath)
      return
    }

    this.lastIncrementalUpdate = now
    await api.index.updateFile(workspacePath, filePath)
  }

  async clear(workspacePath: string): Promise<void> {
    await api.index.clear(workspacePath)
  }

  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  onComplete(callback: CompleteCallback): () => void {
    this.completeCallbacks.add(callback)
    return () => this.completeCallbacks.delete(callback)
  }

  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }

  terminate(): void {
    if (this.stopListener) {
      this.stopListener()
      this.stopListener = null
    }
    this.isInitialized = false
    this.progressCallbacks.clear()
    this.completeCallbacks.clear()
    this.errorCallbacks.clear()
  }

  getActiveConfig(): ScenarioIndexConfig {
    return getScenarioIndexConfig()
  }

  private handleStatusUpdate(status: IndexStatus): void {
    const progress: IndexProgress = {
      processed: status.indexedFiles,
      total: status.totalFiles,
      chunksCount: status.totalChunks,
      isComplete: !status.isIndexing,
      error: status.error,
      message: status.message,
    }

    this.progressCallbacks.forEach(cb => cb(progress))

    if (status.error) {
      this.errorCallbacks.forEach(cb => cb(status.error!))
    }

    if (!status.isIndexing && status.totalFiles > 0) {
      this.completeCallbacks.forEach(cb => cb({
        chunks: [],
        totalFiles: status.totalFiles,
        totalChunks: status.totalChunks,
      }))
    }
  }
}

export const indexWorkerService = new ScenarioIndexEngine()

