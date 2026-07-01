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
import { join, isAbsolute } from 'path'
import { app } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 在扩展 PATH 中查找可执行文件的绝对路径。
 *
 * Electron 应用进程的 PATH 通常只有 /usr/bin:/bin，找不到 Homebrew 安装的 python3。
 * 此函数在常见路径中查找，避免依赖 shell 解析（shell:true 会破坏 Python -c 参数中的引号）。
 */
function resolveBinaryPath(bin: string, searchDirs: string[]): string {
  if (isAbsolute(bin) && existsSync(bin)) return bin
  for (const dir of searchDirs) {
    const fullPath = join(dir, bin)
    if (existsSync(fullPath)) return fullPath
  }
  return bin
}

/**
 * 从字符串中提取第一个完整的 JSON 对象。
 *
 * Vision Framework / pyobjc 可能在 stdout 开头或结尾输出调试信息，
 * 此函数通过括号匹配定位第一个完整的 `{...}` JSON 对象。
 */
function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
    } else {
      if (ch === '"') {
        inString = true
      } else if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          return text.slice(start, i + 1)
        }
      }
    }
  }
  return null
}

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
let lastUnavailableReason = ''
const RECHECK_INTERVAL_MS = 60_000

/**
 * macOS Vision OCR 路由器
 */
export class MacVisionOcrRouter {
  /**
   * Python 脚本路径（兼容开发模式和打包模式）
   *
   * 开发模式：app.getAppPath()/src/main/modules/desktop-control/bin/mac_vision_ocr.py
   * 打包模式：process.resourcesPath/ocr-scripts/mac_vision_ocr.py（通过 extraResources 配置）
   */
  private get scriptPath(): string {
    // 开发模式：源码目录
    const devPath = join(
      app.getAppPath(),
      'src',
      'main',
      'modules',
      'desktop-control',
      'bin',
      'mac_vision_ocr.py',
    )
    if (existsSync(devPath)) return devPath

    // 打包模式：extraResources 中的脚本
    const prodPath = join(
      process.resourcesPath || '',
      'ocr-scripts',
      'mac_vision_ocr.py',
    )
    return prodPath
  }

  /**
   * Python 可执行文件路径（动态解析：env > SettingsDb > 默认值）
   *
   * 如果配置的是相对名称（如 'python3'），会在扩展 PATH 中查找绝对路径，
   * 避免 spawn 时依赖 shell:true（shell 解析会破坏 Python -c 参数中的引号）。
   */
  private get pythonBin(): string {
    const configured = (
      process.env.MAC_VISION_PYTHON ||
      this.readSetting<string>('pythonBin', 'python3')
    )
    // 已经是绝对路径直接返回
    if (isAbsolute(configured)) return configured
    // 在扩展 PATH 中查找绝对路径
    return resolveBinaryPath(configured, this.pythonSearchDirs)
  }

  /** Python 查找路径（Homebrew/pyenv/系统） */
  private get pythonSearchDirs(): string[] {
    return [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      `${process.env.HOME}/.pyenv/shims`,
      `${process.env.HOME}/.local/bin`,
    ]
  }

  /**
   * 构建子进程环境变量，扩展 PATH 以包含常见的 Python 安装路径。
   *
   * Electron 应用（特别是 .app 包）启动时继承的 PATH 通常只有 `/usr/bin:/bin`，
   * 不包含 Homebrew (`/opt/homebrew/bin`) 或 pyenv 等路径，导致 `python3` 无法找到。
   * 这里显式扩展 PATH，确保能定位到用户安装的 pyobjc 环境。
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const extraPaths = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      `${process.env.HOME}/.pyenv/shims`,
      `${process.env.HOME}/.local/bin`,
    ]
    const currentPath = process.env.PATH || ''
    const merged = [...new Set([...extraPaths, ...currentPath.split(':')])].filter(Boolean).join(':')
    return { ...process.env, PATH: merged }
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
    if (process.platform !== 'darwin') {
      lastUnavailableReason = 'Not macOS platform'
      return false
    }

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

  /** 获取上次不可用的具体原因，用于错误诊断 */
  getUnavailableReason(): string {
    return lastUnavailableReason
  }

  private async checkAvailable(): Promise<boolean> {
    // 1. 脚本文件存在
    const scriptPath = this.scriptPath
    const appPath = app.getAppPath()
    if (!existsSync(scriptPath)) {
      lastUnavailableReason = `OCR script not found: ${scriptPath} (appPath=${appPath})`
      logger.desktop.warn(`[MacVisionOcr] ${lastUnavailableReason}`)
      return false
    }

    // 2. pyobjc 依赖已安装
    const pythonBin = this.pythonBin
    const env = this.buildEnv()
    return new Promise<boolean>((resolve) => {
      // 不使用 shell:true（shell 会破坏 Python -c 参数中的引号），直接用绝对路径调用
      const child = spawn(
        pythonBin,
        ['-c', 'import Vision; import Quartz; import Foundation; print("PYOBJC_OK")'],
        { stdio: ['ignore', 'pipe', 'pipe'], env },
      )
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        lastUnavailableReason = `Dependency check timed out (pythonBin=${pythonBin})`
        logger.desktop.warn(`[MacVisionOcr] ${lastUnavailableReason}`)
        resolve(false)
      }, 10_000)

      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0 && stdout.includes('PYOBJC_OK')) {
          lastUnavailableReason = ''
          logger.desktop.info(`[MacVisionOcr] Available (pyobjc installed, pythonBin=${pythonBin})`)
          resolve(true)
        } else {
          lastUnavailableReason = `pyobjc not available (exit=${code}, pythonBin=${pythonBin})`
          if (stderr.trim()) {
            lastUnavailableReason += `. stderr: ${stderr.trim().slice(0, 300)}`
          }
          logger.desktop.warn(
            `[MacVisionOcr] ${lastUnavailableReason}. ` +
              'Run: pip3 install pyobjc-framework-Vision pyobjc-framework-Quartz',
          )
          resolve(false)
        }
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        lastUnavailableReason = `Failed to spawn python (pythonBin=${pythonBin}): ${err.message}`
        logger.desktop.warn(
          `[MacVisionOcr] ${lastUnavailableReason}. ` +
            'If python3 is not in PATH, configure visualOcrConfig.pythonBin to absolute path in settings.',
        )
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
        env: this.buildEnv(),
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
          // Vision Framework / pyobjc 可能往 stdout 输出调试信息，
          // 从 stdout 中提取第一个完整 JSON 对象（脚本通过 print 输出单行 JSON）
          const jsonStr = extractFirstJson(stdout)
          if (!jsonStr) {
            throw new Error('No JSON found in stdout')
          }
          const result: VisionOcrResponse = JSON.parse(jsonStr)
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
    lastUnavailableReason = ''
  }
}

/** 单例实例 */
export const macVisionOcrRouter = new MacVisionOcrRouter()
