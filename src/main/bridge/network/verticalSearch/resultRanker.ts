/**
 * 结果排序去重器
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
    // 酒旅
    'ctrip.com': 9, 'mafengwo.cn': 8, 'dianping.com': 8, 'qunar.com': 8,
    'fliggy.com': 7, 'meituan.com': 7, 'tuniu.com': 7, 'qyer.com': 7,
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
    // 社交与内容平台（低权威，噪音较多）
    'zhihu.com': 5, 'weibo.com': 4, 'douyin.com': 4,
    'jianshu.com': 4, 'csdn.net': 3, 'toutiao.com': 2,

    // 内容农场与聚合分发页：标题党、二次搬运集中，降权避免挤占前排
    'baijiahao.baidu.com': 2, 'mbd.baidu.com': 1,
    'zhidao.baidu.com': 2, 'jingyan.baidu.com': 2, 'wenku.baidu.com': 1,
    '163.com': 2, 'sohu.com': 2, 'qq.com': 2, 'sina.com.cn': 2,
    'ifeng.com': 2, '360doc.com': 1, 'docin.com': 1,
    'book118.com': 1, 'jb51.net': 1, 'php.cn': 1,
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
        // 按完整域名边界匹配：includes 会让近似域名误命中（如 my163.com 命中 163.com）
        if (domain === knownDomain || domain.endsWith('.' + knownDomain)) {
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

/** 中文功能字：不承载检索语义，落在二字组合里会制造假命中，直接丢弃 */
const CN_STOP_CHARS = new Set(
    '的了是在有和与及或而且但因所以之为这那哪什么怎样吗呢吧啊呀哦嗯'.split(''),
)

/** 相关性判定所需的词项集合 */
export interface RelevanceTerms {
    /** 覆盖率计算的词项：中文二字组合 + 英文/数字词 */
    terms: string[]
    /** 完整短语：命中表示整段语义吻合，而非只命中一个碎片 */
    phrases: string[]
}

/** 相关性准入阈值（低于此分视为与查询无关） */
export const MIN_RELEVANCE_THRESHOLD = 2

/**
 * 媒体类来源：由搜索引擎按查询直接召回（SearXNG 的 images/videos 类别），
 * 其标题多为页面原名或文件描述、未必含查询词，用文本覆盖率判定会整体误杀，
 * 因此跳过文本准入。
 */
const MEDIA_SOURCE_TYPES = new Set(['image-search', 'image-stock', 'video-search'])
/**
 * 构建相关性词项集合
 *
 * 中文没有词间空格，按空白切分只会得到整句一项，使关键词匹配对中文查询
 * 形同虚设。这里改用二字组合切分：既可覆盖任意长度的中文查询，又能抑制
 * 短词误命中（查询「手机壳批发」与科技资讯即便都含「手机」，覆盖率也只有
 * 四分之一，不足以通过准入）。含功能字的组合直接丢弃，避免虚词贡献覆盖率。
 *
 * 英文与数字仍按非字母数字边界切分。完整短语单独保留，用于奖励「整段语义
 * 命中」而非「只命中碎片」。
 */
export function buildRelevanceTerms(query: string): RelevanceTerms {
    const text = (query || '').trim()
    if (!text) return { terms: [], phrases: [] }

    const terms = new Set<string>()
    const phrases: string[] = []

    // 中文：二字组合 + 完整连续串
    for (const run of text.match(/[\u4e00-\u9fa5]+/g) || []) {
        if (run.length >= 2) phrases.push(run)
        for (let i = 0; i < run.length - 1; i++) {
            const gram = run.slice(i, i + 2)
            if (CN_STOP_CHARS.has(gram[0]) || CN_STOP_CHARS.has(gram[1])) continue
            terms.add(gram)
        }
    }

    // 英文与数字：按非字母数字边界切分，保留长度 ≥ 2 的非纯数字词
    for (const word of text.match(/[A-Za-z0-9]+/g) || []) {
        if (word.length < 2 || /^\d+$/.test(word)) continue
        terms.add(word.toLowerCase())
        phrases.push(word)
    }

    return { terms: [...terms], phrases: [...new Set(phrases)] }
}

/**
 * 计算相关性分数（覆盖率驱动）
 *
 * 旧实现是「命中即累加」，只命中一个碎片也能堆到可观的分数；并且
 * 「排行榜/数据/报告」这类与检索意图无关的标题特征会被无条件加分，是低质
 * 聚合页排到前列的推手。改为：
 * - 以「命中词项数 / 查询词项总数」的覆盖率衡量，命中越全面分越高
 * - 完整短语命中单独奖励，区分「命中整段语义」与「只命中一个碎片」
 * - 不再为与查询无关的标题特征加分
 */
function getRelevanceScore(title: string, snippet: string, terms: RelevanceTerms): number {
    if (terms.terms.length === 0) return 0

    const titleLower = (title || '').toLowerCase()
    const snippetLower = (snippet || '').toLowerCase()

    let titleHits = 0
    let snippetHits = 0
    for (const term of terms.terms) {
        if (titleLower.includes(term)) titleHits++
        else if (snippetLower.includes(term)) snippetHits++
    }

    // 标题覆盖率主导（0-6），摘要覆盖率次之（0-2.5）
    let score = (titleHits / terms.terms.length) * 6 + (snippetHits / terms.terms.length) * 2.5

    // 完整短语命中：最多 +1.5
    if (terms.phrases.length > 0) {
        const phraseHits = terms.phrases.filter(p => titleLower.includes(p.toLowerCase())).length
        score += Math.min(1.5, phraseHits * 0.75)
    }

    // 标题长度惩罚（太短信息不足，太长多为标题党）
    if (title.length < 8) score *= 0.8
    if (title.length > 60) score *= 0.9

    return Math.min(10, score)
}

/**
 * 单条相关性判定：判断一条结果是否与查询相关
 *
 * 供没有 OptimizedQuery 的调用方使用（通用搜索路径只有原始查询文本）。
 * 查询提不出有效词项时一律判为相关，避免误杀。
 */
export function isRelevantItem(title: string, snippet: string, query: string): boolean {
    const terms = buildRelevanceTerms(query)
    if (terms.terms.length === 0) return true
    return getRelevanceScore(title, snippet, terms) >= MIN_RELEVANCE_THRESHOLD
}

/**
 * 相关性准入过滤：仅保留与查询相关的条目
 *
 * 供智能搜索分发器使用 —— 变体查询只负责「多召回」，其返回结果必须通过
 * 主查询的相关性校验才能进入结果池，否则变体会把无关内容一并带进来。
 */
export function filterByRelevance<T extends { title: string; snippet?: string }>(
    results: T[],
    optimizedQuery: OptimizedQuery,
): T[] {
    if (results.length === 0) return []
    return results.filter(r => isRelevantItem(r.title, r.snippet || '', optimizedQuery.primary))
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

    const { intent, needsFreshContent, primary } = optimizedQuery
    const relevanceTerms = buildRelevanceTerms(primary)

    // 1. 评分
    const ranked: RankedResult[] = results.map(r => {
        const authority = getDomainAuthority(r.url)
        const freshness = getFreshnessScore(r.publishedDate, intent, needsFreshContent)
        // 摘要位合并预取正文：正文命中说明页面确实在讲查询主题；
        // 只取 snippet 会低估部分来源（百科条目摘要极短，命中信息多在正文）
        const bodyText = [r.snippet, r.content].filter(Boolean).join(' ')
        const relevance = getRelevanceScore(r.title, bodyText, relevanceTerms)

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

    // 2. 相关性准入：与查询无关的结果直接丢弃
    //
    // 此处刻意不做「凑够 N 条」的兜底。此前的实现会在相关结果不足时补入不相关结果，
    // 全不相关时更会取「总分最高的前 N 条」，而总分里权威度的权重（×3）足以让一条
    // relevance 为 0 的高权威页面排到真正相关的普通站点之前 —— 这正是搜索出现
    // 「完全不相关的内容且排在前列」的直接原因。宁可返回空数组，由调用方明确告知
    // 用户「未找到相关结果」，也不要塞入无关内容。
    //
    // 查询本身提不出有效词项时（如纯语气词）不做判定，保留原始结果，避免误杀。
    const relevant = relevanceTerms.terms.length > 0
        ? ranked.filter(r =>
            MEDIA_SOURCE_TYPES.has(r.sourceType ?? '')
            || r.scoreBreakdown.relevance >= MIN_RELEVANCE_THRESHOLD,
        )
        : ranked
    if (relevant.length === 0) return []

    // 3. 按分数降序排序
    relevant.sort((a, b) => b.score - a.score)

    // 4. 去重
    return markDuplicates(relevant)
}

