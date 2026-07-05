/**
 * OCR 桥接层
 *
 * 为插件提供统一的 OCR 文字识别能力，自动路由到最佳可用引擎：
 * - macOS 平台：优先使用本地 Vision OCR（高精度、离线、中文 98%+）
 * - 降级方案：使用 Tesseract.js（跨平台、支持 100+ 语种）
 *
 * 插件通过 globalThis.__AWEECLAW_HOST__.ocr.recognize(buffer, options) 调用。
 *
 * @module plugin-sdk/OcrBridge
 */

import { logger } from '@shared/toolkit/LogEngine'
import { macVisionOcrRouter } from '../desktop-control/MacVisionOcrRouter'

/** OCR 识别选项 */
export interface OcrOptions {
  /** 识别语言（Tesseract 语言代码，如 'chi_sim'、'eng'、'chi_sim+eng'） */
  lang?: string
  /** 是否输出位置信息（默认 false，仅返回文本） */
  withPosition?: boolean
  /** 页面分割模式（Tesseract PSM，默认 3 = 自动布局） */
  psm?: number
}

/** OCR 识别结果 */
export interface OcrResult {
  /** 识别出的纯文本 */
  text: string
  /** 带位置信息的识别项（withPosition=true 时返回） */
  items?: Array<{
    text: string
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }>
  /** 使用的引擎 */
  engine: 'vision' | 'tesseract'
  /** 耗时（毫秒） */
  elapsed: number
}

/**
 * OCR 桥接服务
 *
 * 单例模式，懒加载 Tesseract worker（避免主进程启动时的开销）。
 */
class OcrBridgeService {
  private initialized = false
  private tesseractAvailable: boolean | null = null

  /**
   * 初始化（懒加载）
   */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    logger.system?.info('[OcrBridge] OCR bridge initialized')
  }

  /**
   * 识别图片中的文字
   *
   * 路由策略：
   * 1. macOS 平台 + Vision 可用 → 使用 Vision OCR
   * 2. 否则 → 使用 Tesseract.js
   *
   * @param input 图片 Buffer（PNG/JPEG/TIFF/BMP/WebP）
   * @param options 识别选项
   */
  async recognize(input: Buffer, options: OcrOptions = {}): Promise<OcrResult> {
    await this.ensureInit()
    const start = Date.now()

    // 策略 1：macOS Vision OCR（仅 macOS 平台）
    if (process.platform === 'darwin') {
      try {
        const visionAvailable = await macVisionOcrRouter.isAvailable()
        if (visionAvailable) {
          const base64 = input.toString('base64')
          const items = await macVisionOcrRouter.recognize(base64)
          const text = items.map((i) => i.text).join('\n')
          return {
            text,
            items: options.withPosition ? items : undefined,
            engine: 'vision',
            elapsed: Date.now() - start,
          }
        }
      } catch (err) {
        logger.system?.warn(`[OcrBridge] Vision OCR failed, falling back to Tesseract: ${(err as Error).message}`)
      }
    }

    // 策略 2：Tesseract.js 降级
    return this.recognizeWithTesseract(input, options, start)
  }

  /**
   * 使用 Tesseract.js 识别
   */
  private async recognizeWithTesseract(
    input: Buffer,
    options: OcrOptions,
    start: number,
  ): Promise<OcrResult> {
    if (this.tesseractAvailable === false) {
      throw new Error('Tesseract.js is not available. Please install tesseract.js dependency.')
    }

    try {
      // 动态导入 tesseract.js（避免主进程启动时加载 WASM）
      const { createWorker } = await import('tesseract.js')
      const lang = options.lang || 'eng'
      const worker = await createWorker(lang, options.psm ?? 3, {
        // logger: (m) => logger.system?.debug(`[OcrBridge][Tesseract] ${JSON.stringify(m)}`),
      })

      try {
        // 使用 block 模式获取位置信息，仅当 withPosition=true 时
        if (options.withPosition) {
          const { data } = await worker.recognize(
            input,
            {},
            { blocks: true },
          )
          type Block = {
            text: string
            confidence: number
            bbox: { x0: number; y0: number; x1: number; y1: number }
          }
          const items: Array<{
            text: string
            x: number
            y: number
            width: number
            height: number
            confidence: number
          }> = []
          const blocks = (data as unknown as { blocks?: Block[] }).blocks || []
          for (const b of blocks) {
            items.push({
              text: b.text,
              x: b.bbox.x0,
              y: b.bbox.y0,
              width: b.bbox.x1 - b.bbox.x0,
              height: b.bbox.y1 - b.bbox.y0,
              confidence: b.confidence / 100,
            })
          }
          return {
            text: (data as { text?: string }).text || '',
            items,
            engine: 'tesseract',
            elapsed: Date.now() - start,
          }
        }
        // 纯文本模式
        const { data } = await worker.recognize(input)
        return {
          text: (data as { text?: string }).text || '',
          engine: 'tesseract',
          elapsed: Date.now() - start,
        }
      } finally {
        await worker.terminate()
      }
    } catch (err) {
      this.tesseractAvailable = false
      throw new Error(`Tesseract OCR failed: ${(err as Error).message}`)
    }
  }

  /**
   * 检查 OCR 服务是否可用
   */
  async isAvailable(): Promise<{ available: boolean; engine?: string; reason?: string }> {
    if (process.platform === 'darwin') {
      const visionAvailable = await macVisionOcrRouter.isAvailable()
      if (visionAvailable) {
        return { available: true, engine: 'vision' }
      }
    }

    try {
      await import('tesseract.js')
      return { available: true, engine: 'tesseract' }
    } catch {
      return {
        available: false,
        reason: 'No OCR engine available. On macOS, install pyobjc; on other platforms, install tesseract.js.',
      }
    }
  }
}

/** 单例 */
export const ocrBridge = new OcrBridgeService()
