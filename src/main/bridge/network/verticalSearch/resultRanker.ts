/**
 * 结果排序去重器（参考 DeepSeek 结果排序策略）
 *
 * 职责：
 * - 域名权威度评分：权威网站得分更高
 * - 时效性评分：新闻类查询，新内容得分更高
 * - 相关性评分：标题/摘要匹配查询实体的程度
 * - 去重：基于标题相似度 + URL 域名去重
 * - 综合排序：加权融合三维度分数
 *
 * 设计原则：
 * - 零网络请求，纯本地计算
 * - 延迟 <5ms（100 条结果）
 */

import type { OptimizedQuery } from './queryOptimizer'

/** 排序后的结果 */
export interface RankedResult {
    title: string
    url: string
    snippet: string
    content?: string
    publishedDate?: string
    engine?: string
    imageUrl?: string
    thumbnailUrl?: string
    videoLength?: string
    videoAuthor?: string
    sourceName?: string
    sourceType?: string
    /** 综合评分（0-100） */
    score: number
    /** 评分明细 */
    scoreBreakdown: {
        authority: number
        freshness: number
        relevance: number
    }
    /** 去重标记 */
    isDuplicate?: boolean
}

// ===== 权威域名白名单（国内）=====
// 分数 0-10，越高越权威
const DOMAIN_AUTHORITY: Record<string, number> = {
    // 官方/政府
    'gov.cn': 10, 'stats.gov.cn': 10, 'miit.gov.cn': 10,
    // 百科
    'baike.baidu.com': 9, 'zh.wikipedia.org': 9, 'wiki.mbalib.com': 7,
    // 新闻门户
    'news.sina.com.cn': 8, 'news.qq.com': 8, 'news.sohu.com': 7,
    'news.163.com': 7, 'thepaper.cn': 8, 'xinhuanet.com': 9,
    'people.com.cn': 9, 'chinanews.com': 8,
    // 汽车
    'autohome.com.cn': 9, 'dongchedi.com': 8, 'yiche.com': 7,
    'pcauto.com.cn': 7, 'xcar.com.cn': 7,
    // 房产
    'ke.com': 8, 'lianjia.com': 8, 'anjuke.com': 7, 'fang.com': 7,
    // 科技
    '36kr.com': 8, 'ithome.com': 7, 'leiphone.com': 7, 'cnbeta.com': 6,
    'sspai.com': 6, 'ifanr.com': 7,
    // 学术
    'semanticscholar.org': 9, 'arxiv.org': 9, 'cnki.net': 8,
    'wanfangdata.com.cn': 7, 'scholar.google.com': 8,
    // 视频
    'bilibili.com': 7, 'b23.tv': 7,
    // 图片
    'unsplash.com': 8, 'pexels.com': 8,
    // 通用搜索
    'bing.com': 5, 'baidu.com': 5,
    // 社交（低权威，容易有噪音）
    'zhihu.com': 5, 'weibo.com': 4, 'douyin.com': 4,
    'toutiao.com': 5, 'jianshu.com': 4, 'csdn.net': 5,
}

/**
 * 从 URL 提取域名
 */
function extractDomain(url: string): string {
    try {
        const u = new URL(url)
        return u.hostname.replace(/^www\./, '')
    } catch {
        return ''
    }
}

/**
 * 获取域名权威度分数
 */
function getDomainAuthority(url: string): number {
    const domain = extractDomain(url)
    if (!domain) return 3 // 默认分

    // 精确匹配
    if (DOMAIN_AUTHORITY[domain] !== undefined) {
        return DOMAIN_AUTHORITY[domain]
    }

    // 子域名匹配（如 auto.autohome.com.cn → autohome.com.cn）
    for (const [knownDomain, score] of Object.entries(DOMAIN_AUTHORITY)) {
        if (domain.endsWith(knownDomain) || domain.includes(knownDomain)) {
            return score
        }
    }

    // .gov/.edu/.org 域名加分
    if (domain.endsWith('.gov.cn') || domain.endsWith('.edu.cn')) return 8
    if (domain.endsWith('.org')) return 6

    return 3 // 默认分
}

/**
 * 计算时效性分数
 */
function getFreshnessScore(
    publishedDate: string | undefined,
    intent: string,
    needsFresh: boolean,
): number {
    if (!publishedDate && !needsFresh) return 5 // 非时效查询，中性分

    // 时效型查询：越新越好
    if (intent === 'temporal' || needsFresh) {
        if (!publishedDate) return 2 // 时效查询但无日期 → 低分

        const date = new Date(publishedDate)
        if (isNaN(date.getTime())) return 3

        const now = new Date()
        const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)

        if (diffDays < 7) return 10      // 一周内
        if (diffDays < 30) return 8      // 一月内
        if (diffDays < 90) return 6      // 三月内
        if (diffDays < 365) return 4     // 一年内
        return 1                          // 超过一年
    }

    // 非时效查询：有日期略加分（证明内容被维护）
    return publishedDate ? 6 : 5
}

/**
 * 计算相关性分数
 */
function getRelevanceScore(
    title: string,
    snippet: string,
    entities: string[],
    queryKeywords: string[],
): number {
    let score = 0
    const titleLower = title.toLowerCase()
    const snippetLower = (snippet || '').toLowerCase()

    // 1. 标题实体匹配（权重最高）
    let titleEntityMatches = 0
    for (const entity of entities) {
        if (title.includes(entity)) {
            titleEntityMatches++
            score += 3
        }
    }

    // 2. 摘要实体匹配
    for (const entity of entities) {
        if (snippet.includes(entity)) {
            score += 1.5
        }
    }

    // 3. 关键词匹配
    for (const kw of queryKeywords) {
        const kwLower = kw.toLowerCase()
        if (titleLower.includes(kwLower)) score += 2
        if (snippetLower.includes(kwLower)) score += 1
    }

    // 4. 标题长度惩罚（太短可能信息不足，太长可能标题党）
    if (title.length < 8) score *= 0.8
    if (title.length > 60) score *= 0.9

    // 5. 特殊格式加分（排行榜、数据表格等）
    if (/排行榜|排名|TOP|榜单|对比|数据|统计|报告/.test(title)) {
        score += 2
    }

    return Math.min(10, score)
}

/**
 * 标题相似度（用于去重）
 * 简化版 Jaccard：基于字符 n-gram
 */
function titleSimilarity(t1: string, t2: string): number {
    if (!t1 || !t2) return 0
    const set1 = new Set(t1.split(''))
    const set2 = new Set(t2.split(''))
    let intersection = 0
    for (const c of set1) {
        if (set2.has(c)) intersection++
    }
    const union = set1.size + set2.size - intersection
    return union > 0 ? intersection / union : 0
}

/**
 * URL 域名+路径相似度（用于去重）
 */
function urlSimilarity(u1: string, u2: string): boolean {
    const d1 = extractDomain(u1)
    const d2 = extractDomain(u2)
    if (d1 !== d2) return false

    // 同域名下路径相似度
    try {
        const p1 = new URL(u1).pathname
        const p2 = new URL(u2).pathname
        // 路径完全相同或一个是另一个的前缀
        return p1 === p2 || p1.startsWith(p2) || p2.startsWith(p1)
    } catch {
        return false
    }
}

/**
 * 去重：标记重复结果
 */
function markDuplicates(results: RankedResult[]): RankedResult[] {
    const SIMILARITY_THRESHOLD = 0.75

    for (let i = 0; i < results.length; i++) {
        if (results[i].isDuplicate) continue

        for (let j = i + 1; j < results.length; j++) {
            if (results[j].isDuplicate) continue

            // URL 相似 → 重复
            if (urlSimilarity(results[i].url, results[j].url)) {
                results[j].isDuplicate = true
                continue
            }

            // 标题相似度 > 0.75 → 重复
            const sim = titleSimilarity(results[i].title, results[j].title)
            if (sim >= SIMILARITY_THRESHOLD) {
                results[j].isDuplicate = true
            }
        }
    }

    return results.filter(r => !r.isDuplicate)
}

/**
 * 对搜索结果排序去重
 *
 * @param results - 原始搜索结果
 * @param optimizedQuery - 优化后的查询
 * @returns 排序去重后的结果
 */
export function rankAndDedup<T extends {
    title: string
    url: string
    snippet: string
    content?: string
    publishedDate?: string
    engine?: string
    imageUrl?: string
    thumbnailUrl?: string
    videoLength?: string
    videoAuthor?: string
    sourceName?: string
    sourceType?: string
}>(results: T[], optimizedQuery: OptimizedQuery): RankedResult[] {
    if (results.length === 0) return []

    const { entities, intent, needsFreshContent, primary } = optimizedQuery
    const queryKeywords = primary.split(/\s+/).filter(k => k.length >= 2)

    // 1. 评分
    const ranked: RankedResult[] = results.map(r => {
        const authority = getDomainAuthority(r.url)
        const freshness = getFreshnessScore(r.publishedDate, intent, needsFreshContent)
        const relevance = getRelevanceScore(r.title, r.snippet, entities, queryKeywords)

        // 综合分（加权）
        // 相关性 50%，权威度 30%，时效性 20%
        const score = Math.round(
            relevance * 5 +   // 0-50
            authority * 3 +   // 0-30
            freshness * 2,    // 0-20
        )

        return {
            ...r,
            score,
            scoreBreakdown: { authority, freshness, relevance },
        }
    })

    // 2. 按分数降序排序
    ranked.sort((a, b) => b.score - a.score)

    // 3. 去重
    const deduped = markDuplicates(ranked)

    return deduped
}
