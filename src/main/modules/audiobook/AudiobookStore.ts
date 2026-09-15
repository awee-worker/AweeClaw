/**
 * AudiobookStore — 有声书任务配置与状态管理
 *
 * 职责：
 * 1. 任务配置：TTS 引擎、音色、语速、并发数等
 * 2. 任务状态：任务列表、进度、断点续传 manifest
 * 3. 持久化：任务状态落盘，支持中断后恢复
 *
 * 设计要点：
 * 1. 断点续传：每段完成即落盘 + 更新 manifest，中断后可续跑
 * 2. 任务隔离：每个任务独立目录，互不干扰
 * 3. 状态原子：任务状态变更原子化，避免脏读
 *
 * @module audiobook/AudiobookStore
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型定义
// ============================================

/** TTS 引擎类型 */
export type TtsEngineType = 'cloud' | 'local-sherpa' | 'local-gpt-sovits'

/** 任务状态 */
export type TaskStatus =
  | 'pending'      // 待处理
  | 'parsing'      // 解析文档中
  | 'segmenting'   // 切分文本中
  | 'synthesizing' // 合成语音中
  | 'assembling'   // 拼接音频中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'paused'       // 已暂停
  | 'cancelled'    // 已取消

/** 段落状态 */
export type SegmentStatus =
  | 'pending'      // 待合成
  | 'synthesizing' // 合成中
  | 'completed'    // 已完成
  | 'failed'       // 失败

/** 任务配置 */
export interface AudiobookConfig {
  /** TTS 引擎 */
  engine: TtsEngineType
  /** 音色（云端模式） */
  voice?: string
  /** 语速（0.5 - 2.0） */
  speed: number
  /** 并发数（默认 2） */
  concurrency: number
  /** 输出格式 */
  format: 'mp3' | 'wav'
  /** 单段最大字数（默认 500） */
  maxSegmentLength: number
  /** 失败重试次数（默认 3） */
  maxRetries: number
  /** 章节间静音时长（毫秒，默认 800） */
  chapterSilenceMs: number
}

/** 任务元数据 */
export interface TaskMetadata {
  /** 任务 ID */
  id: string
  /** 源文件路径 */
  sourcePath: string
  /** 源文件名 */
  sourceName: string
  /** 源文件类型 */
  sourceType: 'epub' | 'pdf' | 'txt' | 'md'
  /** 任务状态 */
  status: TaskStatus
  /** 任务配置 */
  config: AudiobookConfig
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 完成时间 */
  completedAt?: number
  /** 错误信息 */
  error?: string
}

/** 文档结构 */
export interface DocumentStructure {
  /** 标题 */
  title: string
  /** 作者 */
  author?: string
  /** 章节列表 */
  chapters: Chapter[]
  /** 总字数 */
  totalChars: number
  /** 预估段落数 */
  estimatedSegments: number
}

/** 章节 */
export interface Chapter {
  /** 章节索引 */
  index: number
  /** 章节标题 */
  title: string
  /** 章节内容 */
  content: string
  /** 字数 */
  charCount: number
}

/** 文本段落 */
export interface TextSegment {
  /** 段落索引（全局） */
  index: number
  /** 所属章节索引 */
  chapterIndex: number
  /** 段落文本 */
  text: string
  /** 字数 */
  charCount: number
  /** 状态 */
  status: SegmentStatus
  /** 重试次数 */
  retryCount: number
  /** 音频文件路径 */
  audioPath?: string
  /** 错误信息 */
  error?: string
}

/** 任务 manifest（断点续传） */
export interface TaskManifest {
  /** 任务元数据 */
  task: TaskMetadata
  /** 文档结构 */
  document: DocumentStructure
  /** 段落列表 */
  segments: TextSegment[]
  /** 已完成段落数 */
  completedSegments: number
  /** 总段落数 */
  totalSegments: number
  /** 进度（0 - 1） */
  progress: number
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: AudiobookConfig = {
  engine: 'cloud',
  speed: 1.0,
  concurrency: 2,
  format: 'mp3',
  maxSegmentLength: 500,
  maxRetries: 3,
  chapterSilenceMs: 800,
}

// ============================================
// 存储路径
// ============================================

function getAudiobookDir(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'audiobooks')
}

function getTaskDir(taskId: string): string {
  return path.join(getAudiobookDir(), taskId)
}

function getManifestPath(taskId: string): string {
  return path.join(getTaskDir(taskId), 'manifest.json')
}

function getSegmentsDir(taskId: string): string {
  return path.join(getTaskDir(taskId), 'segments')
}

function getOutputPath(taskId: string, filename: string): string {
  return path.join(getTaskDir(taskId), 'output', filename)
}

// ============================================
// AudiobookStore 类
// ============================================

export class AudiobookStore {
  private static instance: AudiobookStore | null = null

  private constructor() {
    // 确保目录存在
    const audiobookDir = getAudiobookDir()
    if (!fs.existsSync(audiobookDir)) {
      fs.mkdirSync(audiobookDir, { recursive: true })
    }
  }

  /** 获取单例实例 */
  static getInstance(): AudiobookStore {
    if (!AudiobookStore.instance) {
      AudiobookStore.instance = new AudiobookStore()
    }
    return AudiobookStore.instance
  }

  // ============================================
  // 任务管理
  // ============================================

  /** 创建新任务 */
  createTask(sourcePath: string, config: Partial<AudiobookConfig> = {}): TaskMetadata {
    const taskId = `audiobook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const sourceName = path.basename(sourcePath)
    const sourceType = this.detectSourceType(sourcePath)

    if (!sourceType) {
      throw new Error(`不支持的文件类型: ${sourcePath}`)
    }

    const task: TaskMetadata = {
      id: taskId,
      sourcePath,
      sourceName,
      sourceType,
      status: 'pending',
      config: { ...DEFAULT_CONFIG, ...config },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // 创建任务目录
    const taskDir = getTaskDir(taskId)
    fs.mkdirSync(taskDir, { recursive: true })
    fs.mkdirSync(getSegmentsDir(taskId), { recursive: true })
    fs.mkdirSync(path.join(taskDir, 'output'), { recursive: true })

    // 保存 manifest
    this.saveManifest(taskId, {
      task,
      document: { title: '', chapters: [], totalChars: 0, estimatedSegments: 0 },
      segments: [],
      completedSegments: 0,
      totalSegments: 0,
      progress: 0,
    })

    logger.system.info(`[Audiobook] 任务已创建: ${taskId}`)
    return task
  }

  /** 获取任务 */
  getTask(taskId: string): TaskMetadata | null {
    const manifest = this.loadManifest(taskId)
    return manifest?.task || null
  }

  /** 获取所有任务 */
  getAllTasks(): TaskMetadata[] {
    const audiobookDir = getAudiobookDir()
    if (!fs.existsSync(audiobookDir)) {
      return []
    }

    const tasks: TaskMetadata[] = []
    const entries = fs.readdirSync(audiobookDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('audiobook_')) {
        const manifest = this.loadManifest(entry.name)
        if (manifest) {
          tasks.push(manifest.task)
        }
      }
    }

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 更新任务状态 */
  updateTaskStatus(taskId: string, status: TaskStatus, error?: string): void {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    manifest.task.status = status
    manifest.task.updatedAt = Date.now()
    if (error) {
      manifest.task.error = error
    }
    if (status === 'completed') {
      manifest.task.completedAt = Date.now()
    }

    this.saveManifest(taskId, manifest)
  }

  /** 删除任务 */
  deleteTask(taskId: string): void {
    const taskDir = getTaskDir(taskId)
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true })
      logger.system.info(`[Audiobook] 任务已删除: ${taskId}`)
    }
  }

  // ============================================
  // Manifest 管理
  // ============================================

  /** 加载 manifest */
  loadManifest(taskId: string): TaskManifest | null {
    const manifestPath = getManifestPath(taskId)
    if (!fs.existsSync(manifestPath)) {
      return null
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      logger.system.error(`[Audiobook] 加载 manifest 失败: ${taskId}`, error)
      return null
    }
  }

  /** 保存 manifest */
  saveManifest(taskId: string, manifest: TaskManifest): void {
    const manifestPath = getManifestPath(taskId)
    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    } catch (error) {
      logger.system.error(`[Audiobook] 保存 manifest 失败: ${taskId}`, error)
      throw error
    }
  }

  /** 更新文档结构 */
  updateDocument(taskId: string, document: DocumentStructure): void {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    manifest.document = document
    manifest.totalSegments = document.estimatedSegments
    this.saveManifest(taskId, manifest)
  }

  /** 更新段落列表 */
  updateSegments(taskId: string, segments: TextSegment[]): void {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    manifest.segments = segments
    manifest.totalSegments = segments.length
    this.saveManifest(taskId, manifest)
  }

  /** 更新段落状态 */
  updateSegmentStatus(
    taskId: string,
    segmentIndex: number,
    status: SegmentStatus,
    audioPath?: string,
    error?: string,
  ): void {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      throw new Error(`任务不存在: ${taskId}`)
    }

    const segment = manifest.segments[segmentIndex]
    if (!segment) {
      throw new Error(`段落不存在: ${segmentIndex}`)
    }

    segment.status = status
    if (audioPath) {
      segment.audioPath = audioPath
    }
    if (error) {
      segment.error = error
    }
    if (status === 'failed') {
      segment.retryCount++
    }

    // 更新进度
    manifest.completedSegments = manifest.segments.filter(s => s.status === 'completed').length
    manifest.progress = manifest.totalSegments > 0
      ? manifest.completedSegments / manifest.totalSegments
      : 0

    this.saveManifest(taskId, manifest)
  }

  /** 获取未完成的段落 */
  getPendingSegments(taskId: string): TextSegment[] {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      return []
    }

    return manifest.segments.filter(
      s => s.status === 'pending' || (s.status === 'failed' && s.retryCount < manifest.task.config.maxRetries)
    )
  }

  /** 获取任务进度 */
  getTaskProgress(taskId: string): { completed: number; total: number; progress: number } {
    const manifest = this.loadManifest(taskId)
    if (!manifest) {
      return { completed: 0, total: 0, progress: 0 }
    }

    return {
      completed: manifest.completedSegments,
      total: manifest.totalSegments,
      progress: manifest.progress,
    }
  }

  // ============================================
  // 工具方法
  // ============================================

  /** 检测文件类型 */
  private detectSourceType(filePath: string): 'epub' | 'pdf' | 'txt' | 'md' | null {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.epub':
        return 'epub'
      case '.pdf':
        return 'pdf'
      case '.txt':
        return 'txt'
      case '.md':
        return 'md'
      default:
        return null
    }
  }

  /** 获取段落音频路径 */
  getSegmentAudioPath(taskId: string, segmentIndex: number): string {
    return path.join(getSegmentsDir(taskId), `segment_${segmentIndex.toString().padStart(6, '0')}.wav`)
  }

  /** 获取输出路径 */
  getOutputPath(taskId: string, filename: string): string {
    return getOutputPath(taskId, filename)
  }

  /** 检查任务是否存在 */
  taskExists(taskId: string): boolean {
    return fs.existsSync(getManifestPath(taskId))
  }
}