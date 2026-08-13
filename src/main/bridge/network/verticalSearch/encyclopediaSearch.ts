/**
 * 百科搜索（Encyclopedia Search）
 *
 * 职责：
 * - 通过维基百科官方 API 搜索中文百科条目
 * - 通过百度百科摘要抓取获取国内百科内容
 * - 并行查询两个源，合并结果
 *
 * API 说明：
 * - 维基百科 MediaWiki API：完全免费，无需 Key，支持 JSON
 *   端点：https://zh.wikipedia.org/w/api.php
 *   注意：国内可能不稳定，超时后静默跳过
 * - 百度百科：无官方 API，通过页面抓取提取摘要
 *   端点：https://baike.baidu.com/item/{keyword}
 *
 * 设计原则：
 * - 并行查询，任一源失败不影响整体
 * - 维基百科优先（内容更权威），百度百科补充（国内覆盖更全）
 * - 摘要限 500 字符，避免 token 浪费
 */

import { logger } from '@shared/toolkit/LogEngine'
import { jsonGet, htmlToPlainText } from './httpUtil'

/** 百科搜索结果项 */
export interface EncyclopediaResult {
  /** 条目标题 */
  title: string
  /** 摘要内容（限 500 字符） */
  summary: string
  /** 来源（wikipedia / baidu） */
  source: 'wikipedia' | 'baidu'
  /** 原文链接 */
  url: string
}

/** 百科搜索返回 */
export interface EncyclopediaSearchResult {
  success: boolean
  results?: EncyclopediaResult[]
  error?: string
}

/** 摘要最大长度 */
const MAX_SUMMARY_LENGTH = 500

/** 维基百科 API 超时（国内可能慢） */
const WIKIPEDIA_TIMEOUT = 6000

/** 百度百科抓取超时 */
const BAIDU_BAIKE_TIMEOUT = 5000

/**
 * 维基百科搜索
 *
 * 使用 MediaWiki API 的 opensearch + summary 组合：
 * 1. opensearch 获取条目列表
 * 2. 对首个条目调用 summary 获取摘要
 */
async function searchWikipedia(query: string, maxResults: number): Promise<EncyclopediaResult[]> {
  try {
    const encoded = encodeURIComponent(query)
    // 使用 query + extracts 获取摘要（单次请求）
    const apiUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=${maxResults}&format=json&utf8=1`

    const res = await jsonGet(apiUrl, { 'Accept': 'application/json' }, WIKIPEDIA_TIMEOUT)
    if (!res.success || res.status !== 200 || !res.data) return []

    const json = JSON.parse(res.data)
    const searchResults = json?.query?.search
    if (!Array.isArray(searchResults) || searchResults.length === 0) return []

    const results: EncyclopediaResult[] = []
    for (const item of searchResults.slice(0, maxResults)) {
      const title = item.title || ''
      if (!title) continue

      // 从 snippet 中提取纯文本（维基 API 返回 HTML 片段）
      const snippet = htmlToPlainText(item.snippet || '')
      const summary = snippet.length > MAX_SUMMARY_LENGTH
        ? snippet.slice(0, MAX_SUMMARY_LENGTH) + '…'
        : snippet

      results.push({
        title,
        summary,
        source: 'wikipedia',
        url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      })
    }

    return results
  } catch (err) {
    logger.ipc.warn(`[EncyclopediaSearch] Wikipedia failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/**
 * 百度百科搜索
 *
 * 通过百度搜索 API 间接获取百度百科链接，再抓取摘要。
 * 简化方案：直接访问 baike.baidu.com/item/{keyword} 抓取摘要。
 */
async function searchBaiduBaike(query: string): Promise<EncyclopediaResult[]> {
  try {
    const encoded = encodeURIComponent(query)
    const url = `https://baike.baidu.com/item/${encoded}`
    const res = await jsonGet(url, { 'Accept': 'text/html' }, BAIDU_BAIKE_TIMEOUT)
    if (!res.success || res.status !== 200 || !res.data) return []

    const html = res.data
    const plain = htmlToPlainText(html)

    // 提取标题
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
    let title = titleMatch ? titleMatch[1].replace(/_百度百科.*$/, '').trim() : query

    // 提取摘要：百度百科摘要通常在 lemma-summary class 中
    const summaryMatch = html.match(/<div class="lemma-summary"[^>]*>([\s\S]*?)<\/div>/i)
    let summary: string
    if (summaryMatch) {
      summary = htmlToPlainText(summaryMatch[1])
    } else {
      // 回退：取正文前 500 字符
      summary = plain.slice(0, MAX_SUMMARY_LENGTH)
    }

    if (!summary || summary.length < 20) return []

    summary = summary.length > MAX_SUMMARY_LENGTH
      ? summary.slice(0, MAX_SUMMARY_LENGTH) + '…'
      : summary

    return [{
      title,
      summary,
      source: 'baidu',
      url,
    }]
  } catch (err) {
    logger.ipc.warn(`[EncyclopediaSearch] Baidu Baike failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/**
 * 百科搜索（并行查询维基 + 百度百科）
 *
 * @param query 搜索关键词
 * @param maxResults 最大结果数（默认 3）
 */
export async function searchEncyclopedia(query: string, maxResults = 3): Promise<EncyclopediaSearchResult> {
  try {
    // 并行查询两个源
    const [wikiResults, baiduResults] = await Promise.all([
      searchWikipedia(query, maxResults),
      searchBaiduBaike(query),
    ])

    // 合并：维基优先，百度补充
    const all = [...wikiResults, ...baiduResults].slice(0, maxResults)

    if (all.length === 0) {
      return { success: false, error: '百科搜索无结果' }
    }

    return { success: true, results: all }
  } catch (err) {
    return { success: false, error: `百科搜索失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
