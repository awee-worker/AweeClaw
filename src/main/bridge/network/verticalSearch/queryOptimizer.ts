/**
 * 查询优化器（参考 DeepSeek 查询改写策略）
 *
 * 职责：
 * - 意图识别：判断查询类型（事实型/时效型/导航型/研究型）
 * - 实体提取：识别关键词实体，去除冗余修饰词
 * - 时间补全：时效型查询自动追加时间范围
 * - 多变体生成：生成 2-3 个查询变体并行搜索，提升召回率
 *
 * 设计原则：
 * - 纯规则引擎，零 LLM 调用，延迟 <1ms
 * - 兼容中英文混合查询
 * - 保守策略：不确定时保留原始查询
 */

/** 查询意图类型 */
export type QueryIntent = 'factual' | 'temporal' | 'navigational' | 'research' | 'general'

/** 优化后的查询 */
export interface OptimizedQuery {
    /** 原始查询 */
    raw: string
    /** 主查询（优化后，用于主要搜索） */
    primary: string
    /** 查询变体（用于并行搜索，提升召回） */
    variants: string[]
    /** 意图类型 */
    intent: QueryIntent
    /** 提取的实体关键词 */
    entities: string[]
    /** 时间范围（时效型查询） */
    timeRange?: { start?: string; end?: string }
    /** 是否需要最新内容 */
    needsFreshContent: boolean
}

// ===== 冗余修饰词（去除以提升搜索引擎匹配精度）=====
const FILLER_WORDS: RegExp[] = [
    /请告诉我/g, /帮我查一下/g, /帮我查询/g, /帮我搜一下/g, /帮我搜索/g,
    /请问/g, /麻烦/g, /能不能/g, /可以吗/g, /我想知道/g, /我想了解/g,
    /帮我/g, /给我/g, /看一下/g, /查一下/g, /搜一下/g,
    /请问一下/g, /了解下/g, /了解一下/g,
]

// ===== 时效性关键词 =====
const TEMPORAL_KEYWORDS: RegExp[] = [
    /最新|今日|今天|本月|本月度|本季度|本年度|近期|最近|现在|当前|实时/g,
    /2024|2025|2026|2027/g,
    /上半年|下半年|Q1|Q2|Q3|Q4/g,
    /1月|2月|3月|4月|5月|6月|7月|8月|9月|10月|11月|12月/g,
]

// ===== 研究型关键词 =====
const RESEARCH_KEYWORDS: RegExp[] = [
    /对比|比较|区别|差异|优缺点|分析|评测|评价|测评/g,
    /排行榜|排名|排行|榜单|TOP\d+/g,
    /如何|怎么|怎样|为什么|什么是|什么是/g,
    /原理|机制|架构|流程|步骤/g,
]

// ===== 导航型关键词 =====
const NAVIGATIONAL_KEYWORDS: RegExp[] = [
    /官网|官方网站|登录|注册|入口/g,
]

// ===== 实体提取：中文实体（2-6字连续中文+数字+英文）=====
const ENTITY_PATTERN = /[\u4e00-\u9fa5]{2,8}[0-9A-Za-z]*|[A-Z][a-z]+(?:[A-Z][a-z]+)*|[0-9]{4}/g

/**
 * 检测查询意图
 */
function detectIntent(query: string): QueryIntent {
    if (NAVIGATIONAL_KEYWORDS.some(p => p.test(query))) return 'navigational'
    if (TEMPORAL_KEYWORDS.some(p => p.test(query))) return 'temporal'
    if (RESEARCH_KEYWORDS.some(p => p.test(query))) return 'research'
    // 事实型：包含"是什么""定义""简介"
    if (/是什么|是什么意思|定义|简介|介绍|百科/.test(query)) return 'factual'
    return 'general'
}

/**
 * 去除冗余修饰词
 */
function removeFillerWords(query: string): string {
    let result = query
    for (const pattern of FILLER_WORDS) {
        result = result.replace(pattern, '')
    }
    // 清理多余空格
    return result.replace(/\s+/g, ' ').trim()
}

/**
 * 提取实体关键词
 */
function extractEntities(query: string): string[] {
    const matches = query.match(ENTITY_PATTERN) || []
    // 过滤太短或纯数字
    const filtered = matches.filter(e => e.length >= 2 && !/^\d+$/.test(e))
    // 去重
    return [...new Set(filtered)]
}

/**
 * 生成时间范围
 */
function detectTimeRange(query: string): { start?: string; end?: string; needsFresh: boolean } {
    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() + 1

    // 检测年份
    const yearMatch = query.match(/(20\d{2})/)
    if (yearMatch) {
        const year = parseInt(yearMatch[1])
        // 检测月份
        const monthMatch = query.match(/(\d{1,2})月/)
        if (monthMatch) {
            const month = parseInt(monthMatch[1])
            return {
                start: `${year}-${String(month).padStart(2, '0')}-01`,
                end: `${year}-${String(month).padStart(2, '0')}-31`,
                needsFresh: true,
            }
        }
        return { start: `${year}-01-01`, end: `${year}-12-31`, needsFresh: true }
    }

    // "最新""最近""本月"等关键词
    if (/最新|最近|本月|本月度|当前|现在|今日|今天/.test(query)) {
        return {
            start: `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`,
            end: `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`,
            needsFresh: true,
        }
    }

    // "近期" → 最近 3 个月
    if (/近期|近几个月| lately/.test(query)) {
        const recentMonth = currentMonth - 3 > 0 ? currentMonth - 3 : 1
        return {
            start: `${currentYear}-${String(recentMonth).padStart(2, '0')}-01`,
            needsFresh: true,
        }
    }

    return { needsFresh: false }
}

/**
 * 生成查询变体
 *
 * 策略：
 * 1. 主查询：优化后的原始查询
 * 2. 变体1：实体组合（去除修饰词，保留核心实体）
 * 3. 变体2：补充时间上下文（如果是时效型）
 */
function generateVariants(
    primary: string,
    entities: string[],
    intent: QueryIntent,
    timeRange: { start?: string; end?: string; needsFresh: boolean },
): string[] {
    const variants: string[] = []
    const currentYear = new Date().getFullYear()

    // 变体1：实体精简版（如果主查询较长且实体≥2个）
    if (entities.length >= 2 && primary.length > 10) {
        const entityQuery = entities.slice(0, 5).join(' ')
        if (entityQuery !== primary) {
            variants.push(entityQuery)
        }
    }

    // 变体2：时间补充版（时效型但原始查询没带年份）
    if (intent === 'temporal' && timeRange.needsFresh && !/\d{4}/.test(primary)) {
        variants.push(`${primary} ${currentYear}`)
    }

    // 变体3：英文变体（如果查询是纯中文且包含技术术语）
    const techTerms: Record<string, string> = {
        '新能源汽车': 'new energy vehicle',
        '电动车': 'electric car EV',
        '销量': 'sales',
        '排行榜': 'ranking',
        '房价': 'house price',
        '论文': 'paper',
        '算法': 'algorithm',
        '手机': 'smartphone',
        '芯片': 'chip semiconductor',
    }
    let hasTechTerm = false
    let englishVariant = primary
    for (const [cn, en] of Object.entries(techTerms)) {
        if (primary.includes(cn)) {
            englishVariant = englishVariant.replace(cn, en)
            hasTechTerm = true
        }
    }
    if (hasTechTerm && englishVariant !== primary) {
        variants.push(englishVariant)
    }

    return variants.slice(0, 2) // 最多 2 个变体，控制搜索量
}

/**
 * 查询优化主入口
 */
export function optimizeQuery(rawQuery: string): OptimizedQuery {
    const query = rawQuery.trim()
    if (!query) {
        return {
            raw: rawQuery,
            primary: rawQuery,
            variants: [],
            intent: 'general',
            entities: [],
            needsFreshContent: false,
        }
    }

    // 1. 去冗余
    const cleaned = removeFillerWords(query)

    // 2. 意图检测
    const intent = detectIntent(query)

    // 3. 实体提取
    const entities = extractEntities(query)

    // 4. 时间范围
    const timeInfo = detectTimeRange(query)

    // 5. 主查询：如果清理后为空则用原始
    const primary = cleaned || query

    // 6. 生成变体
    const variants = generateVariants(primary, entities, intent, {
        start: timeInfo.start,
        end: timeInfo.end,
        needsFresh: timeInfo.needsFresh,
    })

    return {
        raw: rawQuery,
        primary,
        variants,
        intent,
        entities,
        timeRange: timeInfo.start ? { start: timeInfo.start, end: timeInfo.end } : undefined,
        needsFreshContent: timeInfo.needsFresh,
    }
}
