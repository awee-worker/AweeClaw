/**
 * 知识库文件提取器 — 从各类文档格式中提取文本内容
 *
 * 设计理念：
 * - 单一职责：仅负责文档文本提取，不涉及文件读写权限
 * - 懒加载：第三方库按需 import，减少启动时内存占用
 * - 统一接口：所有提取器返回 string | null
 * - 错误隔离：单个文件提取失败不影响其他文件
 * - 可扩展：新增格式只需添加对应的提取函数
 *
 * 支持格式：
 * - PDF（pdf-parse）
 * - Word .docx（mammoth）
 * - Word .doc（word-extractor）
 * - Excel .xlsx（xlsx）
 * - PowerPoint .ppt/.pptx（officeparser）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { securityManager, OperationType } from './securityPolicyEngine'

/** 大文件阈值（5MB） */
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024

/**
 * 校验文件路径安全性
 *
 * @param filePath 文件路径
 * @returns 安全则返回 true；敏感路径返回 false
 */
function isPathSafe(filePath: string): boolean {
  if (securityManager.isSensitivePath(filePath)) {
    securityManager.logOperation(OperationType.FILE_READ, filePath, false, {
      reason: '安全底线：敏感路径',
    })
    return false
  }
  return true
}

/**
 * 记录提取成功日志
 *
 * @param filePath 文件路径
 */
function logExtractionSuccess(filePath: string): void {
  securityManager.logOperation(OperationType.FILE_READ, filePath, true, {
    knowledgeImport: true,
  })
}

/**
 * 记录提取失败日志
 *
 * @param filePath 文件路径
 * @param format 文件格式
 * @param error 错误信息
 */
function logExtractionFailure(
  filePath: string,
  format: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.security.warn('[knowledgeExtractor] 提取失败', {
    format,
    path: filePath,
    error: message,
  })
}

/* ------------------------------------------------------------------ */
/* PDF 文本提取                                                        */
/* ------------------------------------------------------------------ */

/**
 * 从 PDF 文件提取文本
 *
 * @param filePath PDF 文件路径
 * @returns 提取的文本；失败返回 null
 */
export async function extractPdfText(filePath: string): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const pdfParse = await import('pdf-parse')
    const fs = await import('fs')
    const dataBuffer = await fs.promises.readFile(filePath)
    const data = await (pdfParse as any).default(dataBuffer)
    logExtractionSuccess(filePath)
    return data.text
  } catch (err) {
    logExtractionFailure(filePath, 'pdf', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Word .docx 文本提取                                                 */
/* ------------------------------------------------------------------ */

/**
 *从 Word .docx 文件提取文本
 *
 * @param filePath .docx 文件路径
 * @returns 提取的文本；失败返回 null
 */
export async function extractDocxText(filePath: string): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    logExtractionSuccess(filePath)
    return result.value
  } catch (err) {
    logExtractionFailure(filePath, 'docx', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Word .doc 文本提取                                                  */
/* ------------------------------------------------------------------ */

/**
 * 从 Word .doc 文件提取文本
 *
 * @param filePath .doc 文件路径
 * @returns 提取的文本；失败返回 null
 */
export async function extractDocText(filePath: string): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const WordExtractor = (await import('word-extractor')).default
    const extractor = new WordExtractor()
    const extracted = await extractor.extract(filePath)
    const text = extracted.getBody()
    logExtractionSuccess(filePath)
    return text
  } catch (err) {
    logExtractionFailure(filePath, 'doc', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Excel .xlsx 文本提取                                                */
/* ------------------------------------------------------------------ */

/**
 * 从 Excel .xlsx 文件提取文本
 *
 * 将每个工作表转换为 CSV 格式，并添加工作表名称标题
 *
 * @param filePath .xlsx 文件路径
 * @returns 提取的文本；失败返回 null
 */
export async function extractXlsxText(filePath: string): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const XLSX = await import('xlsx')
    const workbook = XLSX.readFile(filePath)
    const lines: string[] = []

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      lines.push(`## Sheet: ${sheetName}\n${csv}`)
    }

    logExtractionSuccess(filePath)
    return lines.join('\n\n')
  } catch (err) {
    logExtractionFailure(filePath, 'xlsx', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* PowerPoint .ppt/.pptx 文本提取                                      */
/* ------------------------------------------------------------------ */

/**
 * 从 PowerPoint 文件提取文本
 *
 * @param filePath .ppt/.pptx 文件路径
 * @returns 提取的文本；失败返回 null
 */
export async function extractPptText(filePath: string): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const officeParser = (await import('officeparser')).default
    const text = await officeParser.parseOffice(filePath)
    const result = typeof text === 'string' ? text : (text as any)?.toText?.() || String(text)
    logExtractionSuccess(filePath)
    return result
  } catch (err) {
    logExtractionFailure(filePath, 'ppt', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 知识库文件读取（带大文件检测）                                      */
/* ------------------------------------------------------------------ */

/**
 * 读取知识库文件内容
 *
 * - 大文件（>5MB）使用流式读取前 10KB
 * - 小文件使用编码检测读取
 *
 * @param filePath 文件路径
 * @param readLargeFile 大文件读取函数
 * @param readFileWithEncoding 普通文件读取函数
 * @returns 文件内容；失败返回 null
 */
export async function readKnowledgeFile(
  filePath: string,
  readLargeFile: (path: string, start: number, length: number) => Promise<string | null>,
  readFileWithEncoding: (path: string) => Promise<string | null>,
): Promise<string | null> {
  if (!filePath || !isPathSafe(filePath)) return null

  try {
    const { promises: fsPromises } = await import('fs')
    const stats = await fsPromises.stat(filePath)

    const content =
      stats.size > LARGE_FILE_THRESHOLD
        ? await readLargeFile(filePath, 0, 10000)
        : await readFileWithEncoding(filePath)

    logExtractionSuccess(filePath)
    return content
  } catch (err) {
    logExtractionFailure(filePath, 'knowledge', err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 文件格式与提取器映射                                                */
/* ------------------------------------------------------------------ */

/** 文件扩展名到提取器的映射 */
const EXTRACTOR_MAP: ReadonlyArray<{
  extensions: string[]
  extractor: (filePath: string) => Promise<string | null>
}> = [
  { extensions: ['pdf'], extractor: extractPdfText },
  { extensions: ['docx'], extractor: extractDocxText },
  { extensions: ['doc'], extractor: extractDocText },
  { extensions: ['xlsx', 'xls', 'csv'], extractor: extractXlsxText },
  { extensions: ['ppt', 'pptx'], extractor: extractPptText },
]

/**
 * 根据文件扩展名自动选择提取器
 *
 * @param filePath 文件路径
 * @returns 提取的文本；无匹配提取器或失败返回 null
 */
export async function extractTextByExtension(filePath: string): Promise<string | null> {
  if (!filePath) return null

  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return null

  for (const { extensions, extractor } of EXTRACTOR_MAP) {
    if (extensions.includes(ext)) {
      return extractor(filePath)
    }
  }

  return null
}
