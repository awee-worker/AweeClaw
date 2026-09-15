/**
 * AudiobookManager — 有声书管理器
 *
 * 职责：
 * 1. 任务生命周期管理：创建、执行、暂停、取消、删除
 * 2. 文档解析：调用 DocumentParser 解析文档
 * 3. 文本切分：调用 TextSegmenter 切分文本
 * 4. 批量合成：调用 BatchTtsRunner 合成语音
 * 5. 音频拼接：调用 AudioAssembler 拼接音频
 * 6. 进度管理：实时报告任务进度
 *
 * 设计要点：
 * 1. 异步执行：任务异步执行，不阻塞主进程
 * 2. 中断支持：支持暂停/取消任务
 * 3. 断点续传：支持中断后继续执行
 * 4. 错误处理：单段失败不影响整体任务
 *
 * @module audiobook/AudiobookManager
 */

import { EventEmitter } from 'events'
import { app } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { AudiobookStore, type TaskMetadata, type AudiobookConfig, type TextSegment } from './AudiobookStore'
import { parseDocument, estimateTask } from './DocumentParser'
import { segmentDocument } from './TextSegmenter'
import { BatchTtsRunner } from './BatchTtsRunner'
import { AudioAssembler } from './AudioAssembler'
import type { TtsSynthesizeFn } from './BatchTtsRunner'

// ============================================
// 类型定义
// ============================================

/** 任务进度事件 */
export interface TaskProgressEvent {
  /** 任务 ID */
  taskId: string
  /** 阶段 */
  phase: 'parsing' | 'segmenting' | 'synthesizing' | 'assembling' | 'completed' | 'failed'
  /** 进度（0 - 1） */
  progress: number
  /** 消息 */
  message?: string
  /** 错误 */
  error?: string
}

/** 任务进度回调 */
export type TaskProgressCallback = (event: TaskProgressEvent) => void

// ============================================
// AudiobookManager 类
// ============================================

export class AudiobookManager extends EventEmitter {
  private static instance: AudiobookManager | null = null

  private store: AudiobookStore
  private runners: Map<string, BatchTtsRunner> = new Map()
  private abortedTasks: Map<string, { value: boolean }> = new Map()
  private synthesizeFn: TtsSynthesizeFn | null = null

  private constructor() {
    super()
    this.store = AudiobookStore.getInstance()
  }

  /** 获取单例实例 */
  static getInstance(): AudiobookManager {
    if (!AudiobookManager.instance) {
      AudiobookManager.instance = new AudiobookManager()
    }
    return AudiobookManager.instance
  }

  /**
   * 设置 TTS 合成函数
   *
   * @param fn TTS 合成函数
   */
  setSynthesizeFn(fn: TtsSynthesizeFn): void {
    this.synthesizeFn = fn
  }

  // ============================================
  // 任务管理
  // ============================================

  /**
   * 创建任务
   *
   * @param filePath 文件路径
   * @param config 任务配置
   * @returns 任务元数据
   */
  createTask(filePath: string, config: Partial<AudiobookConfig> = {}): TaskMetadata {
    return this.store.createTask(filePath, config)
  }

  /**
   * 获取任务
   *
   * @param taskId 任务 ID
   * @returns 任务元数据
   */
  getTask(taskId: string): TaskMetadata | null {
    return this.store.getTask(taskId)
  }

  /**
   * 获取所有任务
   *
   * @returns 任务列表
   */
  getAllTasks(): TaskMetadata[] {
    return this.store.getAllTasks()
  }

  /**
   * 删除任务
   *
   * @param taskId 任务 ID
   */
  deleteTask(taskId: string): void {
    // 先取消正在运行的任务
    this.cancelTask(taskId)
    this.store.deleteTask(taskId)
  }

  /**
   * 预估任务信息
   *
   * @param filePath 文件路径
   * @returns 预估信息
   */
  async estimateTask(filePath: string): Promise<{
    title: string
    estimatedChars: number
    estimatedSegments: number
    estimatedDurationMs: number
  }> {
    return estimateTask(filePath)
  }

  // ============================================
  // 任务执行
  // ============================================

  /**
   * 执行任务
   *
   * @param taskId 任务 ID
   * @param onProgress 进度回调
   * @returns 执行结果
   */
  async executeTask(taskId: string, onProgress?: TaskProgressCallback): Promise<void> {
    const task = this.store.getTask(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    if (!this.synthesizeFn) {
      throw new Error('TTS 合成函数未设置，请先调用 setSynthesizeFn()')
    }

    // 初始化中断标志
    const aborted = { value: false }
    this.abortedTasks.set(taskId, aborted)

    try {
      // 更新状态为解析中
      this.store.updateTaskStatus(taskId, 'parsing')
      onProgress?.({ taskId, phase: 'parsing', progress: 0, message: '正在解析文档...' })

      // 解析文档
      const document = await parseDocument(task.sourcePath)
      this.store.updateDocument(taskId, document)

      onProgress?.({ taskId, phase: 'parsing', progress: 1, message: `文档解析完成: ${document.chapters.length} 章` })

      // 检查中断
      if (aborted.value) {
        this.store.updateTaskStatus(taskId, 'paused')
        return
      }

      // 更新状态为切分中
      this.store.updateTaskStatus(taskId, 'segmenting')
      onProgress?.({ taskId, phase: 'segmenting', progress: 0, message: '正在切分文本...' })

      // 切分文本
      const segments = segmentDocument(document.chapters, task.config.maxSegmentLength)
      this.store.updateSegments(taskId, segments)

      onProgress?.({ taskId, phase: 'segmenting', progress: 1, message: `文本切分完成: ${segments.length} 段` })

      // 检查中断
      if (aborted.value) {
        this.store.updateTaskStatus(taskId, 'paused')
        return
      }

      // 更新状态为合成中
      this.store.updateTaskStatus(taskId, 'synthesizing')
      onProgress?.({ taskId, phase: 'synthesizing', progress: 0, message: '正在合成语音...' })

      // 批量合成
      const segmentsDir = path.join(this.store.getOutputPath(taskId, ''), '..', 'segments')
      const runner = new BatchTtsRunner(task.config.concurrency, task.config.maxRetries)
      this.runners.set(taskId, runner)

      const result = await runner.synthesize({
        taskId,
        segments,
        config: task.config,
        outputDir: segmentsDir,
        synthesizeFn: this.synthesizeFn,
        onProgress: (progress) => {
          // 更新段落状态
          if (progress.status === 'completed') {
            const audioPath = path.join(segmentsDir, `segment_${progress.currentSegment.toString().padStart(6, '0')}.${task.config.format}`)
            this.store.updateSegmentStatus(taskId, progress.currentSegment, 'completed', audioPath)
          } else if (progress.status === 'failed') {
            this.store.updateSegmentStatus(taskId, progress.currentSegment, 'failed', undefined, progress.error)
          }

          // 回调进度
          onProgress?.({
            taskId,
            phase: 'synthesizing',
            progress: progress.completed / progress.total,
            message: `合成进度: ${progress.completed}/${progress.total}`,
          })
        },
        aborted,
      })

      this.runners.delete(taskId)

      // 检查是否有失败的段落
      if (result.failed > 0) {
        logger.system.warn(`[Audiobook] 任务 ${taskId} 有 ${result.failed} 个段落合成失败`)
      }

      // 检查中断
      if (aborted.value) {
        this.store.updateTaskStatus(taskId, 'paused')
        return
      }

      // 更新状态为拼接中
      this.store.updateTaskStatus(taskId, 'assembling')
      onProgress?.({ taskId, phase: 'assembling', progress: 0, message: '正在拼接音频...' })

      // 拼接音频
      const assembler = new AudioAssembler()
      const outputFilename = `${task.sourceName.replace(/\.[^/.]+$/, '')}.${task.config.format}`
      const outputPath = this.store.getOutputPath(taskId, outputFilename)

      await assembler.assemble({
        taskId,
        segments,
        chapters: document.chapters,
        config: task.config,
        outputPath,
        onProgress: (progress) => {
          onProgress?.({
            taskId,
            phase: 'assembling',
            progress: progress.percent / 100,
            message: `拼接进度: ${progress.phase}`,
          })
        },
      })

      // 更新状态为完成
      this.store.updateTaskStatus(taskId, 'completed')
      onProgress?.({ taskId, phase: 'completed', progress: 1, message: '任务完成' })

      logger.system.info(`[Audiobook] 任务完成: ${taskId}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error(`[Audiobook] 任务失败: ${taskId}`, error)
      this.store.updateTaskStatus(taskId, 'failed', errorMessage)
      onProgress?.({ taskId, phase: 'failed', progress: 0, error: errorMessage })
      throw error
    } finally {
      this.abortedTasks.delete(taskId)
      this.runners.delete(taskId)
    }
  }

  /**
   * 暂停任务
   *
   * @param taskId 任务 ID
   */
  pauseTask(taskId: string): void {
    const aborted = this.abortedTasks.get(taskId)
    if (aborted) {
      aborted.value = true
      logger.system.info(`[Audiobook] 任务已暂停: ${taskId}`)
    }
  }

  /**
   * 取消任务
   *
   * @param taskId 任务 ID
   */
  cancelTask(taskId: string): void {
    const aborted = this.abortedTasks.get(taskId)
    if (aborted) {
      aborted.value = true
    }

    const runner = this.runners.get(taskId)
    if (runner) {
      runner.abort()
    }

    this.store.updateTaskStatus(taskId, 'cancelled')
    logger.system.info(`[Audiobook] 任务已取消: ${taskId}`)
  }

  /**
   * 继续任务（断点续传）
   *
   * @param taskId 任务 ID
   * @param onProgress 进度回调
   */
  async resumeTask(taskId: string, onProgress?: TaskProgressCallback): Promise<void> {
    const task = this.store.getTask(taskId)
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    if (task.status !== 'paused' && task.status !== 'failed') {
      throw new Error(`任务状态不允许继续: ${task.status}`)
    }

    // 从 manifest 恢复状态
    const manifest = this.store.loadManifest(taskId)
    if (!manifest) {
      throw new Error(`任务 manifest 不存在: ${taskId}`)
    }

    // 继续执行
    await this.executeTask(taskId, onProgress)
  }

  /**
   * 获取任务进度
   *
   * @param taskId 任务 ID
   * @returns 进度信息
   */
  getTaskProgress(taskId: string): { completed: number; total: number; progress: number } {
    return this.store.getTaskProgress(taskId)
  }

  /**
   * 获取任务输出路径
   *
   * @param taskId 任务 ID
   * @param filename 文件名
   * @returns 输出路径
   */
  getOutputPath(taskId: string, filename: string): string {
    return this.store.getOutputPath(taskId, filename)
  }
}