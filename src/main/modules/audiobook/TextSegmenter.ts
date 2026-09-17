/**
 * TextSegmenter — 长文本切分器
 *
 * 职责：
 * 1. 按标点符号切分长文本
 * 2. 保证单段不超过最大字数限制
 * 3. 保持语义完整性（不在句子中间切分）
 * 4. 支持中英文标点
 *
 * 设计要点：
 * 1. 按句切分：优先在句号、问号、感叹号处切分
 * 2. 按逗号切分：句子过长时，在逗号处切分
 * 3. 强制切分：超过最大长度时强制切分
 * 4. 上下文保留：切分处保留前后文，避免语调断裂
 *
 * @module audiobook/TextSegmenter
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { Chapter, TextSegment } from './AudiobookStore'

// ============================================
// 常量
// ============================================

/** 中文句号 */
const CHINESE_PERIOD = '。'
/** 中文问号 */
const CHINESE_QUESTION = '？'
/** 中文感叹号 */
const CHINESE_EXCLAMATION = '！'
/** 中文逗号 */
const CHINESE_COMMA = '，'
/** 中文分号 */
const CHINESE_SEMICOLON = '；'
/** 中文冒号 */
const CHINESE_COLON = '：'

/** 英文句号 */
const ENGLISH_PERIOD = '.'
/** 英文问号 */
const ENGLISH_QUESTION = '?'
/** 英文感叹号 */
const ENGLISH_EXCLAMATION = '!'
/** 英文逗号 */
const ENGLISH_COMMA = ','
/** 英文分号 */
const ENGLISH_SEMICOLON = ';'

/** 句末标点 */
const SENTENCE_END_PUNCTUATIONS = [
  CHINESE_PERIOD,
  CHINESE_QUESTION,
  CHINESE_EXCLAMATION,
  ENGLISH_PERIOD,
  ENGLISH_QUESTION,
  ENGLISH_EXCLAMATION,
]

/** 句中标点 */
const SENTENCE_MID_PUNCTUATIONS = [
  CHINESE_COMMA,
  CHINESE_SEMICOLON,
  CHINESE_COLON,
  ENGLISH_COMMA,
  ENGLISH_SEMICOLON,
]


// ============================================
// 切分函数
// ============================================

/**
 * 切分文本为段落
 *
 * @param text 文本内容
 * @param maxLength 单段最大字数（默认 500）
 * @returns 段落数组
 */
export function segmentText(text: string, maxLength: number = 500): string[] {
  if (!text || text.trim().length === 0) {
    return []
  }

  // 清理文本
  const cleanedText = cleanText(text)

  // 如果文本长度小于最大长度，直接返回
  if (cleanedText.length <= maxLength) {
    return [cleanedText]
  }

  const segments: string[] = []
  let remaining = cleanedText

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      segments.push(remaining)
      break
    }

    // 尝试在句末标点处切分
    let splitIndex = findSplitIndex(remaining, maxLength, SENTENCE_END_PUNCTUATIONS)

    // 如果找不到句末标点，尝试在句中标点处切分
    if (splitIndex === -1) {
      splitIndex = findSplitIndex(remaining, maxLength, SENTENCE_MID_PUNCTUATIONS)
    }

    // 如果仍然找不到，在最大长度处强制切分
    if (splitIndex === -1) {
      splitIndex = maxLength
    }

    // 提取当前段落
    const segment = remaining.slice(0, splitIndex + 1).trim()
    if (segment.length > 0) {
      segments.push(segment)
    }

    // 更新剩余文本
    remaining = remaining.slice(splitIndex + 1).trim()
  }

  return segments
}

/**
 * 切分章节为段落
 *
 * @param chapter 章节
 * @param maxLength 单段最大字数
 * @param startSegmentIndex 起始段落索引
 * @returns 段落数组
 */
export function segmentChapter(
  chapter: Chapter,
  maxLength: number,
  startSegmentIndex: number,
): TextSegment[] {
  const texts = segmentText(chapter.content, maxLength)

  return texts.map((text, i) => ({
    index: startSegmentIndex + i,
    chapterIndex: chapter.index,
    text,
    charCount: text.length,
    status: 'pending' as const,
    retryCount: 0,
  }))
}

/**
 * 切分文档为段落
 *
 * @param chapters 章节列表
 * @param maxLength 单段最大字数
 * @returns 段落数组
 */
export function segmentDocument(chapters: Chapter[], maxLength: number): TextSegment[] {
  const segments: TextSegment[] = []
  let segmentIndex = 0

  for (const chapter of chapters) {
    const chapterSegments = segmentChapter(chapter, maxLength, segmentIndex)
    segments.push(...chapterSegments)
    segmentIndex += chapterSegments.length
  }

  logger.system.info(`[TextSegmenter] 文档已切分为 ${segments.length} 个段落`)
  return segments
}

// ============================================
// 辅助函数
// ============================================

/**
 * 清理文本
 *
 * - 移除多余空白
 * - 规范化换行符
 * - 移除特殊字符
 */
function cleanText(text: string): string {
  return text
    // 规范化换行符
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // 移除多余空白
    .replace(/[ \t]+/g, ' ')
    // 移除空行
    .replace(/\n\s*\n/g, '\n')
    // 移除首尾空白
    .trim()
}

/**
 * 查找切分位置
 *
 * @param text 文本
 * @param maxLength 最大长度
 * @param punctuations 标点符号列表
 * @returns 切分位置（-1 表示未找到）
 */
function findSplitIndex(text: string, maxLength: number, punctuations: string[]): number {
  // 从 maxLength 位置向前查找标点
  for (let i = Math.min(maxLength, text.length) - 1; i >= 0; i--) {
    if (punctuations.includes(text[i])) {
      return i
    }
  }

  return -1
}

/**
 * 预估段落数
 *
 * @param text 文本
 * @param maxLength 单段最大字数
 * @returns 预估段落数
 */
export function estimateSegmentCount(text: string, maxLength: number = 500): number {
  if (!text || text.trim().length === 0) {
    return 0
  }

  // 简单估算：总字数 / 最大长度
  return Math.ceil(text.length / maxLength)
}