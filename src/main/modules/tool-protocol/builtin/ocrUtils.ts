/**
 * OCR 工具函数
 *
 * 提取自 VisualAgentLoop 的 click_text 实现，供 ComputerUseMcpServer 复用。
 * 核心逻辑：
 * 1. 截图 → 裁剪到目标窗口 → 下采样（避免 OCR 误识别 + 加速识别）
 * 2. 两阶段文字匹配：精确匹配（trimmed equality）优先，子串匹配回退
 *
 * 约束（来自项目记忆）：
 * - OCR 图片必须裁剪到目标应用窗口，避免全屏 OCR 读到其他窗口文字
 * - 下采样最大尺寸 1500px，JPEG 质量 92%，best 插值，保证中文识别准确率
 * - click_text 两阶段匹配：精确匹配（level 1）优先于子串匹配（level 2/3/4）
 */

import { nativeImage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import type { DesktopControlManager } from '../../desktop-control/DesktopControlManager'
import type { Rect } from '../../desktop-control/types/actions'
import type { LocalOcrItem } from '../../desktop-control/MacVisionOcrRouter'

/** 下采样最大尺寸（像素），超过此值等比缩放 */
const MAX_OCR_DIMENSION = 1500
/** JPEG 压缩质量 */
const JPEG_QUALITY = 92

/** OCR 截图与预处理结果 */
export interface OcrScreenshotResult {
  /** Base64 编码的 JPEG 图片（供 OCR 识别） */
  base64: string
  /** 原始截图尺寸 */
  origWidth: number
  origHeight: number
  /** 裁剪偏移（相对于原始截图左上角） */
  cropX: number
  cropY: number
  /** 裁剪后尺寸（OCR 图片的实际尺寸） */
  cropWidth: number
  cropHeight: number
  /** X 方向缩放比（cropWidth / ocrImageWidth） */
  scaleX: number
  /** Y 方向缩放比（cropHeight / ocrImageHeight） */
  scaleY: number
}

/**
 * 截图并预处理（裁剪 + 下采样），为 OCR 识别准备最优图片。
 *
 * @param manager 桌面控制管理器
 * @param targetBounds 可选的目标窗口边界（裁剪到此区域，避免 OCR 误识别其他窗口）
 * @returns 预处理后的图片信息，失败时抛错
 */
export async function captureForOcr(
  manager: DesktopControlManager,
  targetBounds?: Rect | null,
): Promise<OcrScreenshotResult> {
  const screenResult = await manager.captureScreen()
  if (!screenResult.success || !screenResult.dataUrl) {
    throw new Error('Screenshot failed for OCR')
  }

  const img = nativeImage.createFromDataURL(screenResult.dataUrl)
  const origSize = img.getSize()
  if (origSize.width === 0 || origSize.height === 0) {
    throw new Error('Screenshot image is empty (0x0), cannot perform OCR')
  }

  // 裁剪到目标窗口边界（边界保护）
  let cropX = 0
  let cropY = 0
  let cropW = origSize.width
  let cropH = origSize.height
  if (targetBounds) {
    const b = targetBounds
    cropX = Math.max(0, Math.round(b.x))
    cropY = Math.max(0, Math.round(b.y))
    cropW = Math.min(origSize.width - cropX, Math.round(b.width))
    cropH = Math.min(origSize.height - cropY, Math.round(b.height))
  }

  let processImg = img
  if (cropW < origSize.width || cropH < origSize.height) {
    if (cropW > 0 && cropH > 0) {
      processImg = img.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
      logger.mcp?.info(
        `[OcrUtils] Cropped to window (${cropX},${cropY} ${cropW}x${cropH}) ` +
        `from full screen ${origSize.width}x${origSize.height}`,
      )
    } else {
      cropX = 0
      cropY = 0
      cropW = origSize.width
      cropH = origSize.height
    }
  }

  // 下采样加速 OCR（中文字符需至少 14px 高度才能被 Tesseract 识别）
  const maxOrig = Math.max(cropW, cropH)
  let scaleX = 1
  let scaleY = 1
  let ocrImageBase64: string

  if (maxOrig > MAX_OCR_DIMENSION) {
    const ratio = MAX_OCR_DIMENSION / maxOrig
    const newW = Math.round(cropW * ratio)
    const newH = Math.round(cropH * ratio)
    const resized = processImg.resize({ width: newW, height: newH, quality: 'best' })
    ocrImageBase64 = resized.toJPEG(JPEG_QUALITY).toString('base64')
    scaleX = cropW / newW
    scaleY = cropH / newH
    logger.mcp?.info(
      `[OcrUtils] Resized ${cropW}x${cropH} -> ${newW}x${newH} ` +
      `(scaleX=${scaleX.toFixed(2)}, scaleY=${scaleY.toFixed(2)})`,
    )
  } else {
    ocrImageBase64 = processImg.toJPEG(JPEG_QUALITY).toString('base64')
  }

  return {
    base64: ocrImageBase64,
    origWidth: origSize.width,
    origHeight: origSize.height,
    cropX,
    cropY,
    cropWidth: cropW,
    cropHeight: cropH,
    scaleX,
    scaleY,
  }
}

/** 匹配级别：数值越小优先级越高 */
export const MATCH_LEVEL = {
  EXACT: 1,        // 精确匹配（trimmed equality, case-insensitive）
  CONTAINS: 2,     // OCR 文本包含目标文本
  CONTAINED: 3,    // 目标文本包含 OCR 文本（len >= 2）
  NO_SPACE: 4,     // 去空格后相等（len >= 2）
} as const

/** 文字匹配候选 */
export interface TextMatchCandidate {
  /** OCR 识别到的原始文本 */
  text: string
  /** 置信度（0-1） */
  confidence: number
  /** 匹配级别（1=精确，2=包含，3=被包含，4=去空格） */
  matchLevel: number
  /** 在原始屏幕上的 X 坐标（已还原裁剪偏移和缩放） */
  screenX: number
  /** 在原始屏幕上的 Y 坐标 */
  screenY: number
  /** OCR 识别区域的宽度 */
  width: number
  /** OCR 识别区域的高度 */
  height: number
}

/**
 * 两阶段文字匹配：精确匹配优先，子串匹配回退。
 *
 * 匹配逻辑（与 VisualAgentLoop.click_text 完全一致）：
 * 1. 精确匹配：itemText === target（trimmed, case-insensitive）
 * 2. 包含匹配：itemText.includes(target)
 * 3. 被包含匹配：target.includes(itemText) && itemText.length >= 2
 * 4. 去空格匹配：itemTextNoSpace === targetNoSpace && length >= 2
 *
 * 排序：matchLevel 升序（精确优先），同级别按 confidence 降序。
 *
 * @param ocrItems OCR 识别结果
 * @param searchText 要查找的文字
 * @param ocrShot OCR 截图预处理结果（用于坐标还原）
 * @returns 按优先级排序的候选列表（空数组表示无匹配）
 */
export function matchOcrText(
  ocrItems: LocalOcrItem[],
  searchText: string,
  ocrShot: OcrScreenshotResult,
): TextMatchCandidate[] {
  const target = searchText.toLowerCase().trim()
  const targetNoSpace = target.replace(/\s+/g, '')
  // 按置信度降序，保证同级别匹配中高置信度优先
  const sortedByConf = [...ocrItems].sort((a, b) => b.confidence - a.confidence)

  const candidates: TextMatchCandidate[] = []
  for (const item of sortedByConf) {
    const itemText = item.text.toLowerCase().trim()
    const itemTextNoSpace = itemText.replace(/\s+/g, '')

    let matchLevel = 0
    if (itemText === target) matchLevel = MATCH_LEVEL.EXACT
    else if (itemText.includes(target)) matchLevel = MATCH_LEVEL.CONTAINS
    else if (target.includes(itemText) && itemText.length >= 2) matchLevel = MATCH_LEVEL.CONTAINED
    else if (itemTextNoSpace === targetNoSpace && targetNoSpace.length >= 2) matchLevel = MATCH_LEVEL.NO_SPACE

    if (matchLevel > 0) {
      // 还原到原始屏幕坐标：OCR 坐标 * 缩放比 + 裁剪偏移
      const screenX = Math.round(item.x * ocrShot.scaleX) + ocrShot.cropX
      const screenY = Math.round(item.y * ocrShot.scaleY) + ocrShot.cropY
      candidates.push({
        text: item.text,
        confidence: item.confidence,
        matchLevel,
        screenX,
        screenY,
        width: item.width,
        height: item.height,
      })
    }
  }

  // matchLevel 升序（精确优先），同级别按 confidence 降序
  candidates.sort((a, b) => {
    if (a.matchLevel !== b.matchLevel) return a.matchLevel - b.matchLevel
    return b.confidence - a.confidence
  })

  return candidates
}
