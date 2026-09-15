/**
 * DocumentParser — 文档解析器
 *
 * 职责：
 * 1. 解析 EPUB/PDF/TXT/MD 文档
 * 2. 提取章节结构和内容
 * 3. 统计字数和预估段落数
 *
 * 支持格式：
 * - EPUB：使用 epubjs 解析（需安装依赖）
 * - PDF：复用 pdf-parse
 * - TXT：直接读取
 * - MD：解析 Markdown 标题结构
 *
 * @module audiobook/DocumentParser
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { DocumentStructure, Chapter } from './AudiobookStore'

// ============================================
// EPUB 解析（动态导入，避免启动时加载）
// ============================================

/**
 * 解析 EPUB 文件
 *
 * 注意：需要安装 epubjs 依赖
 * npm install epubjs
 */
async function parseEpub(filePath: string): Promise<DocumentStructure> {
  try {
    // 动态导入 epubjs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ePub = require('epubjs')
    const book = ePub(filePath)

    // 等待书籍加载完成
    await book.ready

    const title = book.packaging?.metadata?.title || path.basename(filePath, '.epub')
    const author = book.packaging?.metadata?.creator || ''

    // 获取目录
    const navigation = await book.loaded.navigation
    const chapters: Chapter[] = []

    // 遍历章节
    let chapterIndex = 0
    for (const item of navigation.toc) {
      try {
        // 获取章节内容
        const section = book.spine.get(item.href)
        const content = await section.load()

        // 提取纯文本（移除 HTML 标签）
        const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

        if (text.length > 0) {
          chapters.push({
            index: chapterIndex++,
            title: item.label || `章节 ${chapterIndex}`,
            content: text,
            charCount: text.length,
          })
        }
      } catch (error) {
        logger.system.warn(`[DocumentParser] 解析 EPUB 章节失败: ${item.href}`, error)
      }
    }

    // 计算总字数
    const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0)

    // 预估段落数（每段 500 字）
    const estimatedSegments = Math.ceil(totalChars / 500)

    // 关闭书籍
    book.destroy()

    return {
      title,
      author,
      chapters,
      totalChars,
      estimatedSegments,
    }
  } catch (error) {
    logger.system.error('[DocumentParser] 解析 EPUB 失败:', error)
    throw new Error(`解析 EPUB 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================
// PDF 解析
// ============================================

/**
 * 解析 PDF 文件
 *
 * 使用 pdf-parse 库
 */
async function parsePdf(filePath: string): Promise<DocumentStructure> {
  try {
    // 动态导入 pdf-parse
    const pdfParse = await import('pdf-parse')
    const dataBuffer = fs.readFileSync(filePath)
    const data = await (pdfParse as any).default(dataBuffer)

    // PDF 没有明确的章节结构，按页或按段落切分
    const text = data.text || ''
    const chapters: Chapter[] = []

    // 尝试按常见的章节标记切分
    const chapterRegex = /^(第[一二三四五六七八九十百千\d]+[章节回]|Chapter\s+\d+|CHAPTER\s+\d+)/gm
    const matches = [...text.matchAll(chapterRegex)]

    if (matches.length > 0) {
      // 按章节标记切分
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index!
        const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
        const content = text.slice(start, end).trim()

        if (content.length > 0) {
          chapters.push({
            index: i,
            title: matches[i][1],
            content,
            charCount: content.length,
          })
        }
      }
    } else {
      // 无章节标记，按段落切分
      const paragraphs = text.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0)
      let currentContent = ''
      let chapterIndex = 0

      for (const para of paragraphs) {
        currentContent += para + '\n\n'

        // 每 5000 字切分为一章
        if (currentContent.length >= 5000) {
          chapters.push({
            index: chapterIndex++,
            title: `章节 ${chapterIndex}`,
            content: currentContent.trim(),
            charCount: currentContent.length,
          })
          currentContent = ''
        }
      }

      // 处理剩余内容
      if (currentContent.trim().length > 0) {
        chapters.push({
          index: chapterIndex++,
          title: `章节 ${chapterIndex}`,
          content: currentContent.trim(),
          charCount: currentContent.length,
        })
      }
    }

    // 如果没有解析出章节，将整个文档作为一章
    if (chapters.length === 0) {
      chapters.push({
        index: 0,
        title: '全文',
        content: text,
        charCount: text.length,
      })
    }

    const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0)
    const estimatedSegments = Math.ceil(totalChars / 500)

    return {
      title: data.info?.Title || path.basename(filePath, '.pdf'),
      author: data.info?.Author || '',
      chapters,
      totalChars,
      estimatedSegments,
    }
  } catch (error) {
    logger.system.error('[DocumentParser] 解析 PDF 失败:', error)
    throw new Error(`解析 PDF 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================
// TXT 解析
// ============================================

/**
 * 解析 TXT 文件
 *
 * 按空行或章节标记切分
 */
async function parseTxt(filePath: string): Promise<DocumentStructure> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const title = path.basename(filePath, '.txt')

    // 尝试按章节标记切分
    const chapterRegex = /^(第[一二三四五六七八九十百千\d]+[章节回]|Chapter\s+\d+|CHAPTER\s+\d+|=+$)/gm
    const matches = [...content.matchAll(chapterRegex)]

    const chapters: Chapter[] = []

    if (matches.length > 0) {
      // 按章节标记切分
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index!
        const end = i + 1 < matches.length ? matches[i + 1].index! : content.length
        const chapterContent = content.slice(start, end).trim()

        if (chapterContent.length > 0) {
          chapters.push({
            index: i,
            title: matches[i][1],
            content: chapterContent,
            charCount: chapterContent.length,
          })
        }
      }
    }

    // 如果没有章节标记，按段落切分
    if (chapters.length === 0) {
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      let currentContent = ''
      let chapterIndex = 0

      for (const para of paragraphs) {
        currentContent += para + '\n\n'

        // 每 5000 字切分为一章
        if (currentContent.length >= 5000) {
          chapters.push({
            index: chapterIndex++,
            title: `章节 ${chapterIndex}`,
            content: currentContent.trim(),
            charCount: currentContent.length,
          })
          currentContent = ''
        }
      }

      // 处理剩余内容
      if (currentContent.trim().length > 0) {
        chapters.push({
          index: chapterIndex++,
          title: `章节 ${chapterIndex}`,
          content: currentContent.trim(),
          charCount: currentContent.length,
        })
      }
    }

    // 如果仍然没有章节，将整个文件作为一章
    if (chapters.length === 0) {
      chapters.push({
        index: 0,
        title: '全文',
        content,
        charCount: content.length,
      })
    }

    const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0)
    const estimatedSegments = Math.ceil(totalChars / 500)

    return {
      title,
      chapters,
      totalChars,
      estimatedSegments,
    }
  } catch (error) {
    logger.system.error('[DocumentParser] 解析 TXT 失败:', error)
    throw new Error(`解析 TXT 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================
// Markdown 解析
// ============================================

/**
 * 解析 Markdown 文件
 *
 * 按标题结构切分章节
 */
async function parseMarkdown(filePath: string): Promise<DocumentStructure> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const title = path.basename(filePath, '.md')

    // 按 Markdown 标题切分
    const headingRegex = /^(#{1,6})\s+(.+)$/gm
    const matches = [...content.matchAll(headingRegex)]

    const chapters: Chapter[] = []

    if (matches.length > 0) {
      // 提取标题前的内容（前言）
      const firstHeadingIndex = matches[0].index!
      if (firstHeadingIndex > 0) {
        const preface = content.slice(0, firstHeadingIndex).trim()
        if (preface.length > 0) {
          chapters.push({
            index: 0,
            title: '前言',
            content: preface,
            charCount: preface.length,
          })
        }
      }

      // 按标题切分章节
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index!
        const end = i + 1 < matches.length ? matches[i + 1].index! : content.length
        const chapterContent = content.slice(start, end).trim()

        if (chapterContent.length > 0) {
          chapters.push({
            index: chapters.length,
            title: matches[i][2],
            content: chapterContent,
            charCount: chapterContent.length,
          })
        }
      }
    }

    // 如果没有标题，按段落切分
    if (chapters.length === 0) {
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0)
      let currentContent = ''
      let chapterIndex = 0

      for (const para of paragraphs) {
        currentContent += para + '\n\n'

        // 每 5000 字切分为一章
        if (currentContent.length >= 5000) {
          chapters.push({
            index: chapterIndex++,
            title: `章节 ${chapterIndex}`,
            content: currentContent.trim(),
            charCount: currentContent.length,
          })
          currentContent = ''
        }
      }

      // 处理剩余内容
      if (currentContent.trim().length > 0) {
        chapters.push({
          index: chapterIndex++,
          title: `章节 ${chapterIndex}`,
          content: currentContent.trim(),
          charCount: currentContent.length,
        })
      }
    }

    // 如果仍然没有章节，将整个文件作为一章
    if (chapters.length === 0) {
      chapters.push({
        index: 0,
        title: '全文',
        content,
        charCount: content.length,
      })
    }

    const totalChars = chapters.reduce((sum, ch) => sum + ch.charCount, 0)
    const estimatedSegments = Math.ceil(totalChars / 500)

    return {
      title,
      chapters,
      totalChars,
      estimatedSegments,
    }
  } catch (error) {
    logger.system.error('[DocumentParser] 解析 Markdown 失败:', error)
    throw new Error(`解析 Markdown 失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================
// 导出
// ============================================

/**
 * 解析文档
 *
 * @param filePath 文件路径
 * @returns 文档结构
 */
export async function parseDocument(filePath: string): Promise<DocumentStructure> {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.epub':
      return parseEpub(filePath)
    case '.pdf':
      return parsePdf(filePath)
    case '.txt':
      return parseTxt(filePath)
    case '.md':
      return parseMarkdown(filePath)
    default:
      throw new Error(`不支持的文件类型: ${ext}`)
  }
}

/**
 * 预估任务信息（不实际解析文档）
 *
 * @param filePath 文件路径
 * @returns 预估信息
 */
export async function estimateTask(filePath: string): Promise<{
  title: string
  estimatedChars: number
  estimatedSegments: number
  estimatedDurationMs: number
}> {
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const title = path.basename(filePath, ext)

  // 根据文件大小粗略估算字数
  // 中文字符约 3 字节，英文约 1 字节，取平均 2 字节
  const estimatedChars = Math.floor(stat.size / 2)

  // 预估段落数（每段 500 字）
  const estimatedSegments = Math.ceil(estimatedChars / 500)

  // 预估合成时长（每段约 10 秒）
  const estimatedDurationMs = estimatedSegments * 10 * 1000

  return {
    title,
    estimatedChars,
    estimatedSegments,
    estimatedDurationMs,
  }
}