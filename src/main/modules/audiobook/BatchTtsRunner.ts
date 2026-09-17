/**
 * BatchTtsRunner — 批量 TTS 合成器
 *
 * 职责：
 * 1. 并发控制：限制同时合成的段落数（默认 2）
 * 2. 失败重试：单段失败重试 N 次（指数退避）
 * 3. 进度回调：实时报告合成进度
 * 4. 中断支持：支持暂停/取消任务
 *
 * TTS 引擎支持：
 * - 云端：通过后端 API /api/v1/voice/tts
 * - 本地：通过 LocalVoiceManager.synthesize()
 *
 * @module audiobook/BatchTtsRunner
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { AudiobookConfig, TextSegment, SegmentStatus } from './AudiobookStore'

// ============================================
// 类型定义
// ============================================

/** 合成进度回调 */
export type ProgressCallback = (progress: {
  completed: number
  total: number
  currentSegment: number
  status: SegmentStatus
  error?: string
}) => void

/** TTS 合成函数 */
export type TtsSynthesizeFn = (
  text: string,
  options?: {
    voice?: string
    speed?: number
    format?: 'mp3' | 'wav'
  },
) => Promise<Buffer>

/** 批量合成选项 */
export interface BatchSynthesizeOptions {
  /** 任务 ID */
  taskId: string
  /** 段落列表 */
  segments: TextSegment[]
  /** 任务配置 */
  config: AudiobookConfig
  /** 输出目录 */
  outputDir: string
  /** TTS 合成函数 */
  synthesizeFn: TtsSynthesizeFn
  /** 进度回调 */
  onProgress?: ProgressCallback
  /** 是否中断 */
  aborted?: { value: boolean }
}

// ============================================
// BatchTtsRunner 类
// ============================================

export class BatchTtsRunner {
  private concurrency: number
  private running: number = 0
  private completed: number = 0
  private failed: number = 0
  private queue: TextSegment[] = []
  private aborted: { value: boolean } = { value: false }

  constructor(concurrency: number = 2) {
    this.concurrency = concurrency
  }

  /**
   * 批量合成
   *
   * @param options 合成选项
   * @returns 合成结果
   */
  async synthesize(options: BatchSynthesizeOptions): Promise<{
    completed: number
    failed: number
    errors: Array<{ segmentIndex: number; error: string }>
  }> {
    const { taskId, segments, config, outputDir, synthesizeFn, onProgress, aborted } = options

    // 重置状态
    this.running = 0
    this.completed = 0
    this.failed = 0
    this.queue = [...segments.filter(s => s.status === 'pending' || (s.status === 'failed' && s.retryCount < config.maxRetries))]
    this.aborted = aborted || { value: false }

    const errors: Array<{ segmentIndex: number; error: string }> = []
    const total = this.queue.length

    logger.system.info(`[BatchTts] 开始批量合成: ${total} 个段落, 并发数: ${this.concurrency}`)

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // 并发执行
    await new Promise<void>((resolve) => {
      const tryNext = () => {
        // 检查中断
        if (this.aborted.value) {
          logger.system.info('[BatchTts] 任务已中断')
          resolve()
          return
        }

        // 检查是否完成
        if (this.queue.length === 0 && this.running === 0) {
          logger.system.info(`[BatchTts] 批量合成完成: ${this.completed} 成功, ${this.failed} 失败`)
          resolve()
          return
        }

        // 启动新任务
        while (this.running < this.concurrency && this.queue.length > 0) {
          const segment = this.queue.shift()!
          this.running++

          this.synthesizeSegment(taskId, segment, config, outputDir, synthesizeFn)
            .then((result) => {
              if (result.success) {
                this.completed++
                onProgress?.({
                  completed: this.completed,
                  total,
                  currentSegment: segment.index,
                  status: 'completed',
                })
              } else {
                this.failed++
                errors.push({ segmentIndex: segment.index, error: result.error || '未知错误' })
                onProgress?.({
                  completed: this.completed,
                  total,
                  currentSegment: segment.index,
                  status: 'failed',
                  error: result.error,
                })
              }
            })
            .catch((error) => {
              this.failed++
              const errorMessage = error instanceof Error ? error.message : String(error)
              errors.push({ segmentIndex: segment.index, error: errorMessage })
              onProgress?.({
                completed: this.completed,
                total,
                currentSegment: segment.index,
                status: 'failed',
                error: errorMessage,
              })
            })
            .finally(() => {
              this.running--
              tryNext()
            })
        }
      }

      // 启动初始任务
      tryNext()
    })

    return {
      completed: this.completed,
      failed: this.failed,
      errors,
    }
  }

  /**
   * 合成单个段落
   *
   * @param taskId 任务 ID
   * @param segment 段落
   * @param config 配置
   * @param outputDir 输出目录
   * @param synthesizeFn TTS 合成函数
   * @returns 合成结果
   */
  private async synthesizeSegment(
    _taskId: string,
    segment: TextSegment,
    config: AudiobookConfig,
    outputDir: string,
    synthesizeFn: TtsSynthesizeFn,
  ): Promise<{ success: boolean; error?: string }> {
    const outputPath = path.join(outputDir, `segment_${segment.index.toString().padStart(6, '0')}.${config.format}`)

    // 检查是否已存在（断点续传）
    if (fs.existsSync(outputPath)) {
      logger.system.debug(`[BatchTts] 段落 ${segment.index} 已存在，跳过`)
      return { success: true }
    }

    let lastError: string | undefined

    // 重试逻辑
    for (let retry = 0; retry <= config.maxRetries; retry++) {
      try {
        // 指数退避
        if (retry > 0) {
          const delay = Math.min(1000 * Math.pow(2, retry), 10000)
          logger.system.debug(`[BatchTts] 段落 ${segment.index} 重试 ${retry}/${config.maxRetries}, 等待 ${delay}ms`)
          await this.sleep(delay)
        }

        // 调用 TTS 合成
        const audioBuffer = await synthesizeFn(segment.text, {
          voice: config.voice,
          speed: config.speed,
          format: config.format,
        })

        // 保存音频文件
        fs.writeFileSync(outputPath, audioBuffer)

        logger.system.debug(`[BatchTts] 段落 ${segment.index} 合成成功`)
        return { success: true }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        logger.system.warn(`[BatchTts] 段落 ${segment.index} 合成失败 (重试 ${retry}/${config.maxRetries}): ${lastError}`)
      }
    }

    return { success: false, error: lastError }
  }

  /**
   * 中断合成
   */
  abort(): void {
    this.aborted.value = true
    logger.system.info('[BatchTts] 已发送中断信号')
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 创建批量合成任务
 *
 * @param options 合成选项
 * @returns BatchTtsRunner 实例
 */
export function createBatchSynthesizeTask(options: BatchSynthesizeOptions): BatchTtsRunner {
  const runner = new BatchTtsRunner(options.config.concurrency)

  // 异步执行，不阻塞
  runner.synthesize(options).catch((error) => {
    logger.system.error('[BatchTts] 批量合成失败:', error)
  })

  return runner
}