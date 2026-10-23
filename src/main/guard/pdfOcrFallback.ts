/**
 * PDF 本地 OCR 兜底
 *
 * 扫描版 / 图片型 PDF 没有文本层，文本提取必然为空。此模块在本地把页面
 * 渲染成图片后交给 OCR 引擎识别，让这类文档不必依赖后端也能拿到内容。
 *
 * 调用位置：本地文本提取为空 → 本模块 → 仍为空才交给后端流式兜底。
 *
 * 引擎路由由 OcrBridge 决定：macOS 优先 Vision（离线、中文准确率高），
 * 其他平台降级 Tesseract.js。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { docParserProxy } from './docParserProxy'
import { ocrBridge } from '../modules/plugin-sdk/OcrBridge'

/** 默认最多参与 OCR 的页数，避免长文档无限耗时 */
const DEFAULT_MAX_PAGES = 20

/** 单次兜底的总时长上限，超时保留已识别的部分 */
const TOTAL_TIMEOUT_MS = 180_000

/** 本地 OCR 兜底选项 */
export interface LocalOcrOptions {
  /** 最多识别多少页（从第 1 页起） */
  maxPages?: number
  /** 页面渲染缩放倍数 */
  scale?: number
  /** OCR 语言（Tesseract 代码），默认中英混合；Vision 引擎自动识别，忽略此项 */
  lang?: string
}

/**
 * 通过本地 OCR 提取 PDF 文本
 *
 * @param filePath PDF 文件路径
 * @param options 兜底选项
 * @returns 识别出的文本；无可用引擎或全部页面无文字时返回 null
 */
export async function extractPdfTextViaLocalOcr(
  filePath: string,
  options: LocalOcrOptions = {},
): Promise<string | null> {
  const availability = await ocrBridge.isAvailable()
  if (!availability.available) {
    logger.system.info(
      `[PdfOcrFallback] 无可用本地 OCR 引擎，跳过：${availability.reason ?? '未知原因'}`,
    )
    return null
  }

  const start = Date.now()

  let pages
  try {
    pages = await docParserProxy.renderPdfPages(filePath, {
      maxPages: options.maxPages ?? DEFAULT_MAX_PAGES,
      scale: options.scale ?? 2,
    })
  } catch (err) {
    logger.system.warn(`[PdfOcrFallback] 页面渲染失败: ${(err as Error).message}`)
    return null
  }

  if (pages.length === 0) {
    logger.system.warn('[PdfOcrFallback] 未渲染出任何页面')
    return null
  }

  const texts: string[] = []
  for (const page of pages) {
    if (Date.now() - start > TOTAL_TIMEOUT_MS) {
      logger.system.warn(
        `[PdfOcrFallback] 超过总时长上限，已识别 ${texts.length}/${pages.length} 页`,
      )
      break
    }
    try {
      const buffer = Buffer.from(page.base64, 'base64')
      const result = await ocrBridge.recognize(buffer, {
        lang: options.lang ?? 'chi_sim+eng',
      })
      const text = result.text?.trim()
      if (text) texts.push(text)
    } catch (err) {
      logger.system.warn(
        `[PdfOcrFallback] 第 ${page.pageNumber} 页 OCR 失败: ${(err as Error).message}`,
      )
    }
  }

  if (texts.length === 0) {
    logger.system.info('[PdfOcrFallback] 本地 OCR 未识别出文字')
    return null
  }

  logger.system.info(
    `[PdfOcrFallback] 本地 OCR 完成：${texts.length}/${pages.length} 页，耗时 ${Date.now() - start}ms`,
  )
  return texts.join('\n\n')
}
