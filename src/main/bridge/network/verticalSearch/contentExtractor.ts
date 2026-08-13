/**
 * 智能内容提取器（参考 DeepSeek 智能抓取策略）
 *
 * 职责：
 * - 从原始 HTML/文本中提取正文（去除导航、广告、脚本）
 * - 段落级相关性评分：找出与查询最相关的段落
 * - 结构化数据抽取：表格、列表、数字数据
 * - 摘要生成：提取最相关的 2-3 段，而非前 800 字符截断
 *
 * 对比旧方案（prefetchContentSummaries）：
 * - 旧：fetchUrlDirect → 截取前 800 字符
 * - 新：fetchUrlDirect → HTML 正文提取 → 段落切分 → 相关性评分 → 取 top 3 段落
 */

import { logger } from '@toolkit/LogEngine'

/** 提取的内容摘要 */
export interface ExtractedContent {
    /** 正文段落（已按相关性排序） */
    paragraphs: string[]
    /** 提取的数字数据（如销量、价格、百分比） */
    numericData: string[]
    /** 完整摘要文本（拼接后的 top 段落） */
    summary: string
    /** 内容质量分（0-1，基于段落相关性和信息密度） */
    qualityScore: number
}

/** 单个段落的相关性评分 */
interface ScoredParagraph {
    text: string
    score: number
    hasNumbers: boolean
    hasEntities: boolean
}

// ===== HTML 清理正则 =====
const HTML_TAG_RE = /<script[\s\S]*?<\/script>/gi
const STYLE_TAG_RE = /<style[\s\S]*?<\/style>/gi
const NAV_TAG_RE = /<nav[\s\S]*?<\/nav>/gi
const HEADER_TAG_RE = /<header[\s\S]*?<\/header>/gi
const FOOTER_TAG_RE = /<footer[\s\S]*?<\/footer>/gi
const ASIDE_TAG_RE = /<aside[\s\S]*?<\/aside>/gi
const ALL_TAGS_RE = /<[^>]+>/g
const HTML_ENTITY_RE = /&[a-z]+;|&#\d+;/gi
const WHITESPACE_RE = /\s+/g

/** 常见广告/噪音类名 */
const NOISE_PATTERNS = /advertisement|ad-|ad_|sidebar|comment|share|related|recommend|popup|cookie|banner|subscribe|newsletter/i

/**
 * 清理 HTML，提取纯文本正文
 */
function extractTextFromHtml(html: string): string {
    let text = html

    // 1. 移除脚本、样式、导航等非正文标签
    text = text.replace(HTML_TAG_RE, ' ')
    text = text.replace(STYLE_TAG_RE, ' ')
    text = text.replace(NAV_TAG_RE, ' ')
    text = text.replace(HEADER_TAG_RE, ' ')
    text = text.replace(FOOTER_TAG_RE, ' ')
    text = text.replace(ASIDE_TAG_RE, ' ')

    // 2. 段落标签转换为换行符（保留段落结构）
    text = text.replace(/<\/?(p|div|br|li|h[1-6]|tr|td|th)[^>]*>/gi, '\n')

    // 3. 移除所有剩余 HTML 标签
    text = text.replace(ALL_TAGS_RE, ' ')

    // 4. 解码 HTML 实体
    const entities: Record<string, string> = {
        '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
        '&quot;': '"', '&#39;': "'", '&hellip;': '…',
        '&mdash;': '—', '&ndash;': '–',
    }
    text = text.replace(HTML_ENTITY_RE, (match) => entities[match.toLowerCase()] || match)

    // 5. 清理多余空白
    text = text.replace(WHITESPACE_RE, ' ')
    text = text.replace(/\n\s*\n/g, '\n')
    text = text.replace(/\n{3,}/g, '\n\n')

    return text.trim()
}

/**
 * 将文本切分为段落
 */
function splitParagraphs(text: string): string[] {
    // 按双换行切分（段落边界）
    let paragraphs = text.split(/\n+/)

    // 进一步处理：过长段落按句号切分
    const result: string[] = []
    for (const p of paragraphs) {
        const trimmed = p.trim()
        if (trimmed.length < 20) continue // 跳过太短的段落
        if (trimmed.length > 500) {
            // 过长段落按句号切分
            const sentences = trimmed.split(/(?<=[。！？.!?])\s*/)
            let current = ''
            for (const s of sentences) {
                if ((current + s).length > 300) {
                    if (current) result.push(current.trim())
                    current = s
                } else {
                    current += s
                }
            }
            if (current) result.push(current.trim())
        } else {
            result.push(trimmed)
        }
    }

    return result.filter(p => p.length >= 20 && !NOISE_PATTERNS.test(p))
}

/**
 * 提取数字数据（销量、价格、百分比等）
 */
function extractNumericData(text: string): string[] {
    const data: string[] = []

    // 匹配：数字 + 单位（万辆、万元、%、亿元等）
    const patterns = [
        /[\d,.]+\s*万辆?/g,           // 销量
        /[\d,.]+\s*亿元?/g,            // 金额
        /[\d,.]+\s*万元?/g,            // 价格
        /[\d,.]+%/g,                   // 百分比
        /[\d,.]+\s*(?:元|块|美元|美元)/g, // 价格
        /(?:销量|排名|第)\s*[\d,]+/g,   // 排名数据
    ]

    for (const pattern of patterns) {
        const matches = text.match(pattern)
        if (matches) {
            for (const m of matches.slice(0, 5)) {
                // 找到数字所在的句子上下文
                const idx = text.indexOf(m)
                const start = Math.max(0, idx - 30)
                const end = Math.min(text.length, idx + m.length + 30)
                const context = text.slice(start, end).trim()
                data.push(context)
            }
        }
    }

    return [...new Set(data)].slice(0, 10)
}

/**
 * 计算段落与查询的相关性分数
 */
function scoreParagraph(
    paragraph: string,
    entities: string[],
    queryKeywords: string[],
): ScoredParagraph {
    let score = 0
    const lowerPara = paragraph.toLowerCase()

    // 1. 实体匹配（权重最高）
    let entityMatches = 0
    for (const entity of entities) {
        if (paragraph.includes(entity)) {
            entityMatches++
            score += 3 // 每个实体匹配 +3
        }
    }
    const hasEntities = entityMatches > 0

    // 2. 关键词匹配
    for (const kw of queryKeywords) {
        if (lowerPara.includes(kw.toLowerCase())) {
            score += 1
        }
    }

    // 3. 数字密度（数据型段落更有价值）
    const numbers = paragraph.match(/[\d,.]+/g) || []
    const numberDensity = numbers.length / Math.max(paragraph.length / 100, 1)
    if (numberDensity > 0.5) {
        score += 2 // 高数字密度 +2
    }
    const hasNumbers = numbers.length > 0

    // 4. 段落长度惩罚（太短信息不足，太长可能含噪音）
    if (paragraph.length < 30) score *= 0.5
    if (paragraph.length > 400) score *= 0.8

    // 5. 标题特征加分（包含排名、对比、数据等关键词）
    if (/排行榜|排名|TOP|对比|第一|最高|最低|增长率|同比|环比/.test(paragraph)) {
        score += 2
    }

    return { text: paragraph, score, hasNumbers, hasEntities }
}

/**
 * 智能提取内容摘要
 *
 * @param html - 原始 HTML 或纯文本
 * @param query - 用户查询
 * @param entities - 查询实体
 * @param maxChars - 最大返回字符数
 */
export function extractRelevantContent(
    html: string,
    query: string,
    entities: string[],
    maxChars = 1200,
): ExtractedContent {
    try {
        // 1. HTML → 纯文本
        const text = extractTextFromHtml(html)
        if (!text || text.length < 50) {
            return { paragraphs: [], numericData: [], summary: '', qualityScore: 0 }
        }

        // 2. 切分段落
        const paragraphs = splitParagraphs(text)
        if (paragraphs.length === 0) {
            // 兜底：直接截取
            return {
                paragraphs: [text.slice(0, maxChars)],
                numericData: [],
                summary: text.slice(0, maxChars),
                qualityScore: 0.3,
            }
        }

        // 3. 提取查询关键词（用于补充实体匹配）
        const queryKeywords = query.split(/\s+/).filter(k => k.length >= 2)

        // 4. 段落评分
        const scored = paragraphs.map(p => scoreParagraph(p, entities, queryKeywords))

        // 5. 排序：按分数降序
        scored.sort((a, b) => b.score - a.score)

        // 6. 选取 top 段落（控制总字符数）
        const selected: string[] = []
        let totalChars = 0
        for (const p of scored) {
            if (p.score === 0 && selected.length > 0) continue // 零分段落跳过（已有更好的）
            if (totalChars + p.text.length > maxChars) break
            selected.push(p.text)
            totalChars += p.text.length
            if (selected.length >= 4) break // 最多 4 段
        }

        // 如果没有高分段落，取前 2 段兜底
        if (selected.length === 0) {
            selected.push(...paragraphs.slice(0, 2))
        }

        // 7. 提取数字数据
        const numericData = extractNumericData(text)

        // 8. 计算质量分
        const avgScore = scored.slice(0, 3).reduce((sum, p) => sum + p.score, 0) / Math.min(3, scored.length)
        const qualityScore = Math.min(1, avgScore / 10)

        // 9. 拼接摘要
        const summary = selected.join('\n\n')

        return {
            paragraphs: selected,
            numericData,
            summary,
            qualityScore,
        }
    } catch (err) {
        logger.agent.warn('[ContentExtractor] extractRelevantContent failed:', err)
        return { paragraphs: [], numericData: [], summary: '', qualityScore: 0 }
    }
}
