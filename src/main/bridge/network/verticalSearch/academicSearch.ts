/**
 * 学术搜索（Academic Search）
 *
 * 职责：
 * - 通过 Semantic Scholar API 搜索学术论文
 * - 返回论文标题、作者、摘要、年份、引用数、PDF 链接
 * - 完全免费，无需 API Key（可选 Key 提高限额）
 *
 * API 说明：
 * - Semantic Scholar Graph API
 *   端点：https://api.semanticscholar.org/graph/v1/paper/search
 *   免费：无 Key 100 次/5分钟，有 Key 1次/秒
 *   返回：title, abstract, authors, year, citationCount, externalIds, openAccessPdf
 *
 * 设计原则：
 * - 面向学术研究类查询（论文/专利/算法/原理）
 * - 摘要限 500 字符，避免 token 浪费
 * - 失败静默降级，不影响其他搜索源
 */

import { logger } from '@shared/toolkit/LogEngine'
import { jsonGet } from './httpUtil'

/** 学术搜索结果项 */
export interface AcademicResult {
  /** 论文标题 */
  title: string
  /** 摘要（限 500 字符） */
  abstract: string
  /** 作者列表 */
  authors: string[]
  /** 发表年份 */
  year?: number
  /** 引用数 */
  citationCount?: number
  /** 论文链接（DOI 或 S2 页面） */
  url: string
  /** 开放获取 PDF 链接（可选） */
  pdfUrl?: string
  /** 来源 */
  source: 'semantic-scholar'
}

/** 学术搜索返回 */
export interface AcademicSearchResult {
  success: boolean
  results?: AcademicResult[]
  error?: string
}

/** 摘要最大长度 */
const MAX_ABSTRACT_LENGTH = 500

/** API 超时 */
const API_TIMEOUT = 8000

/**
 * Semantic Scholar 学术搜索
 *
 * @param query 搜索关键词
 * @param maxResults 最大结果数
 * @param apiKey 可选 API Key（提高限额）
 */
export async function searchAcademic(
  query: string,
  maxResults = 5,
  apiKey?: string,
): Promise<AcademicSearchResult> {
  try {
    const encoded = encodeURIComponent(query)
    const fields = 'title,abstract,authors,year,citationCount,externalIds,openAccessPdf'
    const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=${maxResults}&fields=${fields}`

    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (apiKey) headers['x-api-key'] = apiKey

    const res = await jsonGet(apiUrl, headers, API_TIMEOUT)
    if (!res.success || res.status !== 200 || !res.data) {
      return { success: false, error: `Semantic Scholar API 返回状态 ${res.status}` }
    }

    const json = JSON.parse(res.data)
    const papers = json?.data
    if (!Array.isArray(papers) || papers.length === 0) {
      return { success: false, error: '学术搜索无结果' }
    }

    const results: AcademicResult[] = []
    for (const paper of papers.slice(0, maxResults)) {
      const title = paper.title || ''
      if (!title) continue

      // 摘要处理
      const abstract = (paper.abstract || '无摘要')
      const truncatedAbstract = abstract.length > MAX_ABSTRACT_LENGTH
        ? abstract.slice(0, MAX_ABSTRACT_LENGTH) + '…'
        : abstract

      // 作者列表
      const authors = Array.isArray(paper.authors)
        ? paper.authors.map((a: { name?: string }) => a.name || '').filter(Boolean)
        : []

      // 论文链接：优先 DOI，其次 S2 页面
      const externalIds = paper.externalIds || {}
      let url = `https://www.semanticscholar.org/paper/${paper.paperId || ''}`
      if (externalIds.DOI) {
        url = `https://doi.org/${externalIds.DOI}`
      }

      // 开放获取 PDF
      const pdfUrl = paper.openAccessPdf?.url || undefined

      results.push({
        title,
        abstract: truncatedAbstract,
        authors,
        year: typeof paper.year === 'number' ? paper.year : undefined,
        citationCount: typeof paper.citationCount === 'number' ? paper.citationCount : undefined,
        url,
        pdfUrl,
        source: 'semantic-scholar',
      })
    }

    if (results.length === 0) {
      return { success: false, error: '学术搜索无有效结果' }
    }

    return { success: true, results }
  } catch (err) {
    logger.ipc.warn(`[AcademicSearch] failed: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, error: `学术搜索失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
