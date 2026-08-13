/**
 * 智能搜索分发器（Smart Search Dispatcher）
 *
 * 职责：
 * - 根据用户查询自动识别领域（auto/realestate/tech/academic/encyclopedia/image/video/news）
 * - 根据领域分发到对应的专业搜索源
 * - 并行查询通用搜索 + 垂直搜索，合并去重
 * - 返回统一的聚合结果
 *
 * 分发策略：
 * ┌──────────────┬─────────────────────────────────────────────────┐
 * │ 领域          │ 搜索源                                          │
 * ├──────────────┼─────────────────────────────────────────────────┤
 * │ general      │ SearXNG 通用搜索（现有）                         │
 * │ auto         │ SearXNG + site:汽车之家/懂车帝                  │
 * │ realestate   │ SearXNG + site:贝壳/链家                        │
 * │ tech         │ SearXNG + site:36氪/IT之家                      │
 * │ news         │ SearXNG + site:新浪/腾讯/澎湃                   │
 * │ encyclopedia │ 维基百科 API + 百度百科                          │
 * │ academic     │ Semantic Scholar API + SearXNG                  │
 * │ image        │ Unsplash/Pexels API + SearXNG images            │
 * │ video        │ SearXNG videos（bilibili/bing videos）          │
 * └──────────────┴─────────────────────────────────────────────────┘
 *
 * 设计原则：
 * - 垂直源失败不影响通用搜索，保证可用性
 * - 结果按来源标注，AI 可区分通用/垂直结果
 * - 并行查询，总耗时取决于最慢的源
 */

import { logger } from '@shared/toolkit/LogEngine'
import { classifyDomain, type SearchDomain, type DomainClassification } from './domainClassifier'
import { buildSiteQuery, getSiteNames } from './verticalSites'
import { searchEncyclopedia, type EncyclopediaResult } from './encyclopediaSearch'
import { searchAcademic, type AcademicResult } from './academicSearch'
import { searchImageStock, type ImageStockResult } from './imageStockSearch'
import { optimizeQuery } from './queryOptimizer'
import { rankAndDedup } from './resultRanker'

/** 通用搜索结果（由外部注入，避免与 httpTransport 循环依赖） */
export interface GeneralSearchResult {
  success: boolean
  results?: Array<{
    title: string
    url: string
    snippet: string
    content?: string
    publishedDate?: string
    engine?: string
    score?: number
  }>
  error?: string
}

/** 图片搜索结果（由外部注入） */
export interface ImageSearchResult {
  success: boolean
  results?: Array<{
    title: string
    url: string
    imgSrc: string
    thumbnailSrc?: string
    source?: string
  }>
  error?: string
}

/** 视频搜索结果（由外部注入） */
export interface VideoSearchResult {
  success: boolean
  results?: Array<{
    title: string
    url: string
    thumbnail?: string
    length?: string
    author?: string
    source?: string
    publishedDate?: string
  }>
  error?: string
}

/** 外部搜索函数注入（避免循环依赖） */
export interface SearchFunctions {
  /** 通用网页搜索（SearXNG） */
  generalSearch: (query: string, maxResults: number, timeout?: number) => Promise<GeneralSearchResult>
  /** 图片搜索（SearXNG images） */
  imageSearch: (query: string, maxResults: number, timeout?: number) => Promise<ImageSearchResult>
  /** 视频搜索（SearXNG videos） */
  videoSearch: (query: string, maxResults: number, timeout?: number) => Promise<VideoSearchResult>
  /** 图库 API Keys（可选） */
  imageStockKeys?: { unsplashAccessKey?: string; pexelsApiKey?: string }
  /** 学术 API Key（可选） */
  academicApiKey?: string
}

/** 统一搜索结果项 */
export interface UnifiedSearchResultItem {
  /** 标题 */
  title: string
  /** URL */
  url: string
  /** 摘要 */
  snippet: string
  /** 预取内容（可选） */
  content?: string
  /** 来源类型 */
  sourceType: 'general' | 'vertical-site' | 'encyclopedia' | 'academic' | 'image-stock' | 'image-search' | 'video-search'
  /** 来源名称（如"汽车之家"、"维基百科"） */
  sourceName?: string
  /** 发布时间 */
  publishedDate?: string
  /** 相关性分数 */
  score?: number
  /** 图片专用：图片直链 */
  imageUrl?: string
  /** 图片专用：缩略图 */
  thumbnailUrl?: string
  /** 视频专用：时长 */
  videoLength?: string
  /** 视频专用：作者 */
  videoAuthor?: string
}

/** 智能搜索返回 */
export interface SmartSearchResult {
  success: boolean
  /** 识别到的领域 */
  domain: SearchDomain
  /** 领域识别详情 */
  domainClassification: DomainClassification
  /** 聚合结果 */
  results: UnifiedSearchResultItem[]
  /** 搜索源统计 */
  sources: string[]
  error?: string
}

/** 超时设置 */
const SEARCH_TIMEOUT = 10000

/**
 * 智能搜索分发器
 */
class SmartSearchDispatcher {
  private searchFns: SearchFunctions | null = null

  /** 注入搜索函数（由 httpTransport 初始化时调用） */
  injectSearchFunctions(fns: SearchFunctions): void {
    this.searchFns = fns
    logger.ipc.info('[SmartSearch] Search functions injected')
  }

  /**
   * 执行智能搜索
   *
   * 5 阶段流水线（参考 DeepSeek 架构）：
   * 1. 查询优化：实体提取 + 去冗余 + 时间补全 + 变体生成
   * 2. 多源检索：主查询 + 变体并行搜索
   * 3. 智能提取：预取摘要已含段落级相关性截取（在 httpTransport 层）
   * 4. 结果排序：域名权威度 + 时效性 + 相关性综合评分
   * 5. 去重返回：标题相似度 + URL 域名双重去重
   *
   * @param query 用户查询
   * @param maxResults 最大结果数（默认 8）
   */
  async search(query: string, maxResults = 8): Promise<SmartSearchResult> {
    if (!this.searchFns) {
      return {
        success: false,
        domain: 'general',
        domainClassification: { primary: 'general', secondary: null, hits: [], isVertical: false },
        results: [],
        sources: [],
        error: '搜索函数未注入',
      }
    }

    // ===== 阶段 1：查询优化 =====
    const optimized = optimizeQuery(query)
    logger.ipc.info(`[SmartSearch] query="${query.slice(0, 50)}" → intent=${optimized.intent}, entities=[${optimized.entities.join(',')}], variants=${optimized.variants.length}`)

    // 领域识别（基于优化后的主查询）
    const classification = classifyDomain(optimized.primary)
    const domain = classification.primary
    logger.ipc.info(`[SmartSearch] domain=${domain}, needsFresh=${optimized.needsFreshContent}`)

    // ===== 阶段 2：多源并行检索 =====
    const sources: string[] = []
    const tasks: Promise<UnifiedSearchResultItem[]>[] = []

    // 主查询通用搜索
    tasks.push(
      this.searchGeneral(optimized.primary, maxResults).then(items => {
        if (items.length > 0) sources.push('通用搜索(SearXNG)')
        return items
      }),
    )

    // 变体查询并行搜索（提升召回率）
    for (const variant of optimized.variants) {
      tasks.push(
        this.searchGeneral(variant, Math.ceil(maxResults / 2)).then(items => {
          if (items.length > 0) sources.push(`变体搜索(${variant.slice(0, 20)})`)
          return items
        }),
      )
    }

    // 垂直搜索：根据领域分发
    switch (domain) {
      case 'auto':
      case 'realestate':
      case 'tech':
      case 'news':
        tasks.push(
          this.searchVerticalSite(optimized.primary, domain, Math.ceil(maxResults / 2)).then(items => {
            if (items.length > 0) sources.push(`垂直门户(${getSiteNames(domain, 2).join('/')})`)
            return items
          }),
        )
        break

      case 'encyclopedia':
        tasks.push(
          this.searchEncyclopediaSource(optimized.primary, Math.ceil(maxResults / 2)).then(items => {
            if (items.length > 0) sources.push('百科(维基+百度)')
            return items
          }),
        )
        break

      case 'academic':
        tasks.push(
          this.searchAcademicSource(optimized.primary, Math.ceil(maxResults / 2)).then(items => {
            if (items.length > 0) sources.push('学术(Semantic Scholar)')
            return items
          }),
        )
        break

      case 'image':
        tasks.push(
          this.searchImageStockSource(optimized.primary, Math.ceil(maxResults / 2)).then(items => {
            if (items.length > 0) sources.push('图库(Unsplash+Pexels)')
            return items
          }),
        )
        // 图库无结果时补充 SearXNG images
        tasks.push(
          this.searchImageSearchSource(optimized.primary, Math.ceil(maxResults / 2)).then(items => {
            if (items.length > 0) sources.push('图片搜索(SearXNG)')
            return items
          }),
        )
        break

      case 'video':
        tasks.push(
          this.searchVideoSource(optimized.primary, maxResults).then(items => {
            if (items.length > 0) sources.push('视频搜索(SearXNG)')
            return items
          }),
        )
        break
    }

    // 并行执行所有搜索
    const results = await Promise.allSettled(tasks)

    // 合并结果
    const allItems: UnifiedSearchResultItem[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allItems.push(...result.value)
      }
    }

    // ===== 阶段 4：结果排序去重 =====
    // 使用综合评分：域名权威度(30%) + 时效性(20%) + 相关性(50%)
    const ranked = rankAndDedup(allItems, optimized)

    // 保留来源类型优先级（百科/学术 > 垂直 > 通用），但分数相同时垂直源优先
    const sourcePriority: Record<string, number> = {
      'encyclopedia': 0,
      'academic': 1,
      'vertical-site': 2,
      'image-stock': 3,
      'video-search': 4,
      'image-search': 5,
      'general': 6,
    }

    // 二次排序：先按来源类型优先级，同类型内按综合分数
    const finalSorted = [...ranked].sort((a, b) => {
      const pa = sourcePriority[a.sourceType ?? 'general'] ?? 9
      const pb = sourcePriority[b.sourceType ?? 'general'] ?? 9
      // 百科/学术/垂直源永远排在通用结果前面（优先展示专业源）
      if (pa !== pb) return pa - pb
      return b.score - a.score
    })

    const finalResults = finalSorted.slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content,
      publishedDate: r.publishedDate,
      engine: r.engine,
      sourceType: r.sourceType as UnifiedSearchResultItem['sourceType'],
      sourceName: r.sourceName,
      score: r.score,
      imageUrl: r.imageUrl,
      thumbnailUrl: r.thumbnailUrl,
      videoLength: r.videoLength,
      videoAuthor: r.videoAuthor,
    }))

    return {
      success: finalResults.length > 0,
      domain,
      domainClassification: classification,
      results: finalResults,
      sources: [...new Set(sources)],
      error: finalResults.length === 0 ? '所有搜索源均无结果' : undefined,
    }
  }

  // ===== 各搜索源适配器 =====

  /** 通用搜索（SearXNG） */
  private async searchGeneral(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const result = await this.searchFns.generalSearch(query, maxResults, SEARCH_TIMEOUT)
    if (!result.success || !result.results) return []
    return result.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content,
      publishedDate: r.publishedDate,
      score: r.score,
      sourceType: 'general' as const,
      sourceName: r.engine || 'SearXNG',
    }))
  }

  /** 垂直门户搜索（site: 限定） */
  private async searchVerticalSite(query: string, domain: SearchDomain, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const siteQuery = buildSiteQuery(query, domain, 3)
    if (!siteQuery) return []

    // 用 site: 限定查询走通用搜索
    const result = await this.searchFns.generalSearch(siteQuery.query, maxResults, SEARCH_TIMEOUT)
    if (!result.success || !result.results) return []

    const siteNames = siteQuery.sites.map(s => s.name).join('/')
    return result.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content,
      publishedDate: r.publishedDate,
      sourceType: 'vertical-site' as const,
      sourceName: siteNames,
    }))
  }

  /** 百科搜索 */
  private async searchEncyclopediaSource(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    const result = await searchEncyclopedia(query, maxResults)
    if (!result.success || !result.results) return []
    return result.results.map((r: EncyclopediaResult) => ({
      title: r.title,
      url: r.url,
      snippet: r.summary,
      sourceType: 'encyclopedia' as const,
      sourceName: r.source === 'wikipedia' ? '维基百科' : '百度百科',
    }))
  }

  /** 学术搜索 */
  private async searchAcademicSource(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const result = await searchAcademic(query, maxResults, this.searchFns.academicApiKey)
    if (!result.success || !result.results) return []
    return result.results.map((r: AcademicResult) => ({
      title: r.title,
      url: r.url,
      snippet: r.abstract,
      publishedDate: r.year ? String(r.year) : undefined,
      score: r.citationCount,
      sourceType: 'academic' as const,
      sourceName: 'Semantic Scholar',
      content: r.pdfUrl ? `[PDF]: ${r.pdfUrl}` : undefined,
    }))
  }

  /** 图库搜索（Unsplash + Pexels） */
  private async searchImageStockSource(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const result = await searchImageStock(query, maxResults, this.searchFns.imageStockKeys)
    if (!result.success || !result.results) return []
    return result.results.map((r: ImageStockResult) => ({
      title: r.description,
      url: r.pageUrl,
      snippet: `摄影师: ${r.photographer || '未知'}`,
      imageUrl: r.imageUrl,
      thumbnailUrl: r.thumbUrl,
      sourceType: 'image-stock' as const,
      sourceName: r.source === 'unsplash' ? 'Unsplash' : 'Pexels',
    }))
  }

  /** SearXNG 图片搜索 */
  private async searchImageSearchSource(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const result = await this.searchFns.imageSearch(query, maxResults, SEARCH_TIMEOUT)
    if (!result.success || !result.results) return []
    return result.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: '',
      imageUrl: r.imgSrc,
      thumbnailUrl: r.thumbnailSrc,
      sourceType: 'image-search' as const,
      sourceName: r.source || 'SearXNG Images',
    }))
  }

  /** SearXNG 视频搜索 */
  private async searchVideoSource(query: string, maxResults: number): Promise<UnifiedSearchResultItem[]> {
    if (!this.searchFns) return []
    const result = await this.searchFns.videoSearch(query, maxResults, SEARCH_TIMEOUT)
    if (!result.success || !result.results) return []
    return result.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: '',
      thumbnailUrl: r.thumbnail,
      videoLength: r.length,
      videoAuthor: r.author,
      publishedDate: r.publishedDate,
      sourceType: 'video-search' as const,
      sourceName: r.source || 'SearXNG Videos',
    }))
  }
}

/** 智能搜索分发器单例 */
export const smartSearchDispatcher = new SmartSearchDispatcher()
