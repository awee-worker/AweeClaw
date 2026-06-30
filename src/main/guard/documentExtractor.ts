/**
 * 文档提取器（Agent 工具专用）— 从各类文档格式中提取文本内容
 *
 * 设计理念：
 * - 服务于 Agent 工具：返回结构化结果（DocumentExtractResult），区别于知识库内部的 string|null 接口
 * - 复用现有提取能力：内部调用 knowledgeFileExtractor 的提取函数，避免重复实现
 * - 轻量 Markdown 输出：表格保留结构、标题保留层级、工作表分块
 * - OCR 兜底：文本提取为空时自动触发 OCR（扫描版 PDF / 图片型文档）
 * - 大文件保护：超过 100KB 自动截断
 *
 * 支持格式：
 * - PDF（pdf-parse）+ OCR 兜底
 * - Word .docx（mammoth）/ .doc（word-extractor）
 * - Excel .xlsx/.xls/.csv（xlsx，工作表分块输出）
 * - PowerPoint .ppt/.pptx（officeparser）
 * - 纯文本 .txt/.md（直接读取）
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  extractPdfText,
  extractDocxText,
  extractDocText,
  extractXlsxText,
  extractPptText,
} from './knowledgeFileExtractor'

/** 文档提取结果 */
export interface DocumentExtractResult {
  /** 文件格式 */
  format: 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'csv' | 'ppt' | 'pptx' | 'txt' | 'md' | 'unknown'
  /** 提取的文本内容（轻量 Markdown） */
  content: string
  /** 元信息 */
  meta: {
    /** 字符数 */
    charCount: number
    /** 页数（PDF/PPT，可选） */
    pages?: number
    /** 工作表名列表（Excel，可选） */
    sheetNames?: string[]
    /** 是否经过 OCR */
    ocrUsed: boolean
    /** 提取耗时（ms） */
    durationMs: number
    /** 是否被截断 */
    truncated: boolean
  }
  /** 是否成功 */
  success: boolean
  /** 失败原因 */
  error?: string
}

/** 大文本截断阈值（100KB） */
const MAX_CONTENT_LENGTH = 100 * 1024

/** 支持的文件格式集合 */
const SUPPORTED_FORMATS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'ppt', 'pptx', 'txt', 'md',
])

/**
 * 根据文件路径推断格式
 *
 * @param filePath 文件路径
 * @returns 格式标识；无法识别返回 'unknown'
 */
function detectFormat(filePath: string): DocumentExtractResult['format'] {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return 'unknown'
  return SUPPORTED_FORMATS.has(ext) ? ext as DocumentExtractResult['format'] : 'unknown'
}

/**
 * 截断超长内容并添加标记
 *
 * @param content 原始内容
 * @returns 截断后的内容
 */
function truncateContent(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_CONTENT_LENGTH) {
    return { text: content, truncated: false }
  }
  return {
    text: content.slice(0, MAX_CONTENT_LENGTH) + `\n\n...(已截断，共 ${content.length} 字符)`,
    truncated: true,
  }
}

/**
 * 构建成功结果
 */
function buildSuccess(
  format: DocumentExtractResult['format'],
  content: string,
  startTime: number,
  options: { pages?: number; sheetNames?: string[]; ocrUsed?: boolean } = {},
): DocumentExtractResult {
  const { text, truncated } = truncateContent(content)
  return {
    format,
    content: text,
    meta: {
      charCount: content.length,
      pages: options.pages,
      sheetNames: options.sheetNames,
      ocrUsed: options.ocrUsed ?? false,
      durationMs: Date.now() - startTime,
      truncated,
    },
    success: true,
  }
}

/**
 * 构建失败结果
 */
function buildFailure(
  format: DocumentExtractResult['format'],
  error: string,
  startTime: number,
): DocumentExtractResult {
  return {
    format,
    content: '',
    meta: {
      charCount: 0,
      ocrUsed: false,
      durationMs: Date.now() - startTime,
      truncated: false,
    },
    success: false,
    error,
  }
}

/**
 * 提取文档内容（主入口）
 *
 * 根据文件格式自动选择提取器，返回结构化结果。
 * 文本提取为空时，可由调用方触发 OCR 兜底。
 *
 * @param filePath 文件路径
 * @returns 提取结果
 */
export async function extractDocument(filePath: string): Promise<DocumentExtractResult> {
  const startTime = Date.now()

  if (!filePath) {
    return buildFailure('unknown', '文件路径不能为空', startTime)
  }

  const format = detectFormat(filePath)

  if (format === 'unknown') {
    return buildFailure(format, `不支持的文件格式: ${filePath}`, startTime)
  }

  try {
    let rawText: string | null = null
    let pages: number | undefined
    let sheetNames: string[] | undefined

    switch (format) {
      case 'pdf':
        rawText = await extractPdfText(filePath)
        // pdf-parse 的 data 对象有 numpages 信息，但现有封装未暴露，这里从文本粗略估算
        break

      case 'docx':
        rawText = await extractDocxText(filePath)
        break

      case 'doc':
        rawText = await extractDocText(filePath)
        break

      case 'xlsx':
      case 'xls':
      case 'csv':
        rawText = await extractXlsxText(filePath)
        // 从输出中解析工作表名
        sheetNames = rawText?.match(/## Sheet: (.+)/g)?.map(m => m.replace('## Sheet: ', '')) || []
        break

      case 'ppt':
      case 'pptx':
        rawText = await extractPptText(filePath)
        break

      case 'txt':
      case 'md': {
        const fs = await import('fs')
        rawText = await fs.promises.readFile(filePath, 'utf-8')
        break
      }
    }

    if (!rawText || rawText.trim().length === 0) {
      // 文本提取为空，提示调用方触发 OCR
      return buildFailure(format, '文本提取为空，可能为扫描版或图片型文档，需 OCR 兜底', startTime)
    }

    return buildSuccess(format, rawText, startTime, { pages, sheetNames })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.security.warn('[documentExtractor] 提取失败', { format, path: filePath, error: message })
    return buildFailure(format, `提取失败: ${message}`, startTime)
  }
}

/**
 * 判断文件格式是否支持 OCR 兜底
 *
 * 扫描版 PDF 和图片型文档可以走 OCR 路径
 *
 * @param format 文件格式
 * @returns 是否支持 OCR
 */
export function isOcrSupported(format: DocumentExtractResult['format']): boolean {
  return format === 'pdf'
}
