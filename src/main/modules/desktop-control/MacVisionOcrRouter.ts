/**
 * macOS 本地 OCR 路由器
 *
 * 利用 macOS Vision Framework（通过 pyobjc Python 脚本调用）做本地 OCR，
 * 优势：
 * - 中文识别准确率高（98%+，与 PaddleOCR 相当，显著高于 Tesseract）
 * - 无需网络往返，延迟低（首次 5-10s 加载模型，后续 200-500ms）
 * - 不依赖后端 OCR 服务，可在离线环境使用
 *
 * 调用流程：
 * 1. 检测 macOS 平台 + pyobjc 依赖是否可用
 * 2. 通过子进程调用 mac_vision_ocr.py，传入 base64 图片
 * 3. 解析 JSON 输出，返回 OcrTextItem 列表
 *
 * 降级策略：
 * - 非 macOS 平台：不可用，调用方降级到后端 OCR
 * - pyobjc 未安装：不可用，调用方降级到后端 OCR
 * - 识别失败：抛错，调用方降级到后端 OCR
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { logger } from '@shared/toolkit/LogEngine'

/** OCR 识别结果项（与 VisualAgentLoop.OcrTextItem 兼容） */
export interface LocalOcrItem {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

/**
 * 视觉 OCR 配置（存储在 app_settings.visualOcrConfig）
 *
 * 用户可通过设置界面或 IPC `upsertAppSetting('visualOcrConfig', {...})` 修改
 * 所有字段都有合理默认值，不配置也能开箱即用
 */
export interface VisualOcrConfig {
  /** Python 可执行文件路径（默认 'python3'） */
  pythonBin?: string
  /** 单次识别超时毫秒（默认 60000，首次加载模型较慢） */
  timeoutMs?: number
  /** OCR 路由策略：'local'（默认，Vision 优先）| 'backend'（直接走后端 OCR） */
  prefer?: 'local' | 'backend'
  /** 是否禁用本地 Vision OCR（强制走后端） */
  enabled?: boolean
}

/** Python 脚本返回的 JSON 结构 */
interface VisionOcrResponse {
  items?: Array<{
    text: string
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }>
  elapsed?: number
  error?: string
}

/** 单例缓存 */
let cachedAvailable: boolean | null = null
let lastCheckTime = 0
const RECHECK_INTERVAL_MS = 60_000

/**
 * macOS Vision OCR 路由器
 */
export class MacVisionOcrRouter {
  /** Python 脚本路径（相对项目根目录） */
  private readonly scriptPath = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'src',
    'main',
    'modules',
    'desktop-control',
    'bin',
    'mac_vision_ocr.py',
  )

  /** Python 可执行文件路径（动态解析：env > SettingsDb > 默认值） */
  private get pythonBin(): string {
    return (
      process.env.MAC_VISION_PYTHON ||
      this.readSetting<string>('pythonBin', 'python3')
    )
  }

  /** 超时时间（毫秒），首次加载模型较慢 */
  private get timeoutMs(): number {
    const env = process.env.MAC_VISION_TIMEOUT_MS
    if (env && /^\d+$/.test(env)) return parseInt(env, 10)
    return this.readSetting<number>('timeoutMs', 60_000)
  }

  /**
   * 从 SettingsDb 读取 visualOcrConfig 子键
   *
   * 配置存储路径：app_settings.visualOcrConfig = { pythonBin, timeoutMs, prefer, enabled }
   * 用户可通过设置界面或 IPC 命令 upsertAppSetting('visualOcrConfig', {...}) 修改
   * 找不到配置时返回 defaultValue，开箱即用
   */
  private readSetting<T>(key: keyof VisualOcrConfig, defaultValue: T): T {
    try {
      // 动态 import 避免在非 Electron 环境（如测试）报错
      const { SettingsDb } = require('../../settings-db/SettingsDb')
      const db = SettingsDb.getInstance()
      const cfg = db.getAppSetting('visualOcrConfig') as Partial<VisualOcrConfig> | null
      if (cfg && cfg[key] !== undefined && cfg[key] !== null) {
        return cfg[key] as T
      }
    } catch {
      // SettingsDb 未初始化或读取失败 → 用默认值
    }
    return defaultValue
  }

  /**
   * 检测 Vision OCR 是否可用
   *
   * 检测条件：
   * 1. 当前进程运行在 macOS 上
   * 2. Python 脚本文件存在
   * 3. pyobjc-framework-Vision 已安装
   *
   * 结果缓存 60 秒，避免每次调用都 spawn Python 进程检测
   */
  async isAvailable(): Promise<boolean> {
    // 非 macOS 直接不可用
    if (process.platform !== 'darwin') return false

    const now = Date.now()
    if (cachedAvailable !== null) {
      if (cachedAvailable || now - lastCheckTime < RECHECK_INTERVAL_MS) {
        return cachedAvailable
      }
    }

    lastCheckTime = now
    cachedAvailable = await this.checkAvailable()
    return cachedAvailable
  }

  private async checkAvailable(): Promise<boolean> {
    // 1. 脚本文件存在
    if (!existsSync(this.scriptPath)) {
      logger.desktop.warn(`[MacVisionOcr] Script not found: ${this.scriptPath}`)
      return false
    }

    // 2. pyobjc 依赖已安装
    return new Promise<boolean>((resolve) => {
      const child = spawn(
        this.pythonBin,
        ['-c', 'import Vision; import Quartz; import Foundation'],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      )
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(false)
      }, 10_000)

      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          logger.desktop.info('[MacVisionOcr] Available (pyobjc installed)')
          resolve(true)
        } else {
          logger.desktop.warn(
            `[MacVisionOcr] Dependencies not installed (exit=${code}). ` +
              'Run: pip3 install pyobjc-framework-Vision pyobjc-framework-Quartz',
          )
          resolve(false)
        }
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  /**
   * 调用 Vision OCR 识别图片
   *
   * @param imageBase64 base64 编码的图片数据（不含 data:image/... 前缀）
   * @returns 识别结果列表
   * @throws 不可用或识别失败时抛错
   */
  async recognize(imageBase64: string): Promise<LocalOcrItem[]> {
    const start = Date.now()

    return new Promise<LocalOcrItem[]>((resolve, reject) => {
      const child = spawn(this.pythonBin, [this.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
        reject(new Error(`Vision OCR timeout after ${this.timeoutMs}ms`))
      }, this.timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new Error(`Failed to spawn Vision OCR: ${err.message}`))
      })

      child.on('exit', (code) => {
        clearTimeout(timer)
        if (timedOut) return

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim()
        const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim()

        if (code !== 0) {
          reject(
            new Error(`Vision OCR exited with code ${code}: ${stderr || stdout}`),
          )
          return
        }

        try {
          const result: VisionOcrResponse = JSON.parse(stdout)
          if (result.error) {
            throw new Error(`Vision OCR error: ${result.error}`)
          }

          const items: LocalOcrItem[] = (result.items || []).map((item) => ({
            text: String(item.text),
            x: Number(item.x),
            y: Number(item.y),
            width: Number(item.width),
            height: Number(item.height),
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
          }))

          logger.desktop.info(
            `[MacVisionOcr] Recognized ${items.length} items in ${Date.now() - start}ms`,
          )
          resolve(items)
        } catch (err) {
          reject(
            new Error(
              `Failed to parse Vision OCR output: ${(err as Error).message}. stdout=${stdout.slice(0, 200)}`,
            ),
          )
        }
      })

      // 通过 stdin 传入 base64 图片
      child.stdin.write(imageBase64)
      child.stdin.end()
    })
  }

  /**
   * 重置可用性缓存
   *
   * 用于测试或外部依赖安装后强制重新检测
   */
  static resetCache(): void {
    cachedAvailable = null
    lastCheckTime = 0
  }
}

/** 单例实例 */
export const macVisionOcrRouter = new MacVisionOcrRouter()
