/**
 * 图库搜索（Image Stock Search）
 *
 * 职责：
 * - 通过 Unsplash API 搜索高质量免版权图片
 * - 通过 Pexels API 搜索高质量图片（补充）
 * - 并行查询两个源，合并去重
 *
 * API 说明：
 * - Unsplash API：免费 50 次/小时，需 Access Key
 *   端点：https://api.unsplash.com/search/photos
 *   注册：https://unsplash.com/developers
 * - Pexels API：免费 200 次/小时，需 API Key
 *   端点：https://api.pexels.com/v1/search
 *   注册：https://www.pexels.com/api/
 *
 * 设计原则：
 * - 无 Key 时降级到空结果（由调用方回退到 SearXNG images）
 * - 有 Key 时并行查询两源，合并去重
 * - 返回直链 + 缩略图 + 摄影师署名（免版权要求）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { jsonGet } from './httpUtil'

/** 图库搜索结果项 */
export interface ImageStockResult {
  /** 图片描述 */
  description: string
  /** 原图直链 */
  imageUrl: string
  /** 缩略图直链 */
  thumbUrl: string
  /** 摄影师署名 */
  photographer?: string
  /** 摄影师主页 */
  photographerUrl?: string
  /** 图片宽度 */
  width?: number
  /** 图片高度 */
  height?: number
  /** 来源平台 */
  source: 'unsplash' | 'pexels'
  /** 原页面链接 */
  pageUrl: string
}

/** 图库搜索返回 */
export interface ImageStockSearchResult {
  success: boolean
  results?: ImageStockResult[]
  error?: string
}

/** API 超时 */
const API_TIMEOUT = 8000

/**
 * Unsplash 图片搜索
 */
async function searchUnsplash(
  query: string,
  maxResults: number,
  accessKey?: string,
): Promise<ImageStockResult[]> {
  if (!accessKey) return []

  try {
    const encoded = encodeURIComponent(query)
    const apiUrl = `https://api.unsplash.com/search/photos?query=${encoded}&per_page=${maxResults}&orientation=landscape`

    const res = await jsonGet(
      apiUrl,
      { 'Accept': 'application/json', 'Authorization': `Client-ID ${accessKey}` },
      API_TIMEOUT,
    )
    if (!res.success || res.status !== 200 || !res.data) return []

    const json = JSON.parse(res.data)
    const photos = json?.results
    if (!Array.isArray(photos)) return []

    const results: ImageStockResult[] = []
    for (const photo of photos.slice(0, maxResults)) {
      const description = photo.alt_description || photo.description || query
      const imageUrl = photo.urls?.regular || photo.urls?.full || ''
      const thumbUrl = photo.urls?.thumb || photo.urls?.small || ''
      if (!imageUrl) continue

      results.push({
        description,
        imageUrl,
        thumbUrl,
        photographer: photo.user?.name || undefined,
        photographerUrl: photo.user?.links?.html || undefined,
        width: photo.width,
        height: photo.height,
        source: 'unsplash',
        pageUrl: photo.links?.html || '',
      })
    }

    return results
  } catch (err) {
    logger.ipc.warn(`[ImageStockSearch] Unsplash failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/**
 * Pexels 图片搜索
 */
async function searchPexels(
  query: string,
  maxResults: number,
  apiKey?: string,
): Promise<ImageStockResult[]> {
  if (!apiKey) return []

  try {
    const encoded = encodeURIComponent(query)
    const apiUrl = `https://api.pexels.com/v1/search?query=${encoded}&per_page=${maxResults}&orientation=landscape`

    const res = await jsonGet(
      apiUrl,
      { 'Accept': 'application/json', 'Authorization': apiKey },
      API_TIMEOUT,
    )
    if (!res.success || res.status !== 200 || !res.data) return []

    const json = JSON.parse(res.data)
    const photos = json?.photos
    if (!Array.isArray(photos)) return []

    const results: ImageStockResult[] = []
    for (const photo of photos.slice(0, maxResults)) {
      const description = photo.alt || query
      const imageUrl = photo.src?.large || photo.src?.original || ''
      const thumbUrl = photo.src?.medium || photo.src?.small || ''
      if (!imageUrl) continue

      results.push({
        description,
        imageUrl,
        thumbUrl,
        photographer: photo.photographer || undefined,
        photographerUrl: photo.photographer_url || undefined,
        width: photo.width,
        height: photo.height,
        source: 'pexels',
        pageUrl: photo.url || '',
      })
    }

    return results
  } catch (err) {
    logger.ipc.warn(`[ImageStockSearch] Pexels failed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/**
 * 图库搜索（并行查询 Unsplash + Pexels）
 *
 * @param query 搜索关键词
 * @param maxResults 最大结果数
 * @param keys API Keys（Unsplash Access Key + Pexels API Key）
 */
export async function searchImageStock(
  query: string,
  maxResults = 5,
  keys?: { unsplashAccessKey?: string; pexelsApiKey?: string },
): Promise<ImageStockSearchResult> {
  try {
    // 无任何 Key 时直接返回失败，由调用方降级到 SearXNG images
    if (!keys?.unsplashAccessKey && !keys?.pexelsApiKey) {
      return { success: false, error: '未配置图库 API Key（Unsplash/Pexels）' }
    }

    // 并行查询两个源
    const perSource = Math.ceil(maxResults / 2) + 1
    const [unsplashResults, pexelsResults] = await Promise.all([
      searchUnsplash(query, perSource, keys?.unsplashAccessKey),
      searchPexels(query, perSource, keys?.pexelsApiKey),
    ])

    // 合并，Unsplash 优先
    const all = [...unsplashResults, ...pexelsResults].slice(0, maxResults)

    if (all.length === 0) {
      return { success: false, error: '图库搜索无结果' }
    }

    return { success: true, results: all }
  } catch (err) {
    return { success: false, error: `图库搜索失败: ${err instanceof Error ? err.message : String(err)}` }
  }
}
