/**
 * 搜索相关性准入回归验证（临时）
 *
 * 覆盖本轮改动：领域置信度门槛、覆盖率驱动的相关性评分、逐条准入、
 * 媒体类豁免、正文合并、去重前无兜底。
 */
import { describe, it, expect } from 'vitest'
import {
    buildRelevanceTerms,
    isRelevantItem,
    filterByRelevance,
    rankAndDedup,
} from '../src/main/bridge/network/verticalSearch/resultRanker'
import { classifyDomain } from '../src/main/bridge/network/verticalSearch/domainClassifier'
import type { OptimizedQuery } from '../src/main/bridge/network/verticalSearch/queryOptimizer'

function q(primary: string): OptimizedQuery {
    return {
        raw: primary,
        primary,
        variants: [],
        intent: 'general',
        entities: [],
        needsFreshContent: false,
    }
}

describe('domainClassifier 置信度门槛', () => {
    it('命中词占比不足时退回通用，不误判垂直领域', () => {
        expect(classifyDomain('手机壳批发').primary).toBe('general')
        expect(classifyDomain('北京房价走势').primary).toBe('general')
    })

    it('命中多个领域词时判定为垂直领域', () => {
        expect(classifyDomain('汽车销量排行').primary).toBe('auto')
        expect(classifyDomain('手机处理器').primary).toBe('tech')
    })
})

describe('buildRelevanceTerms 词项切分', () => {
    it('中文按二字组合切分，丢弃含功能字的组合', () => {
        const { terms } = buildRelevanceTerms('手机壳批发')
        expect(new Set(terms)).toEqual(new Set(['手机', '机壳', '壳批', '批发']))
    })

    it('英文保留非纯数字词，丢弃纯数字', () => {
        const { terms } = buildRelevanceTerms('iPhone 17 Pro')
        expect(terms).toContain('iphone')
        expect(terms).toContain('pro')
        expect(terms).not.toContain('17')
    })

    it('纯语气词提不出词项', () => {
        expect(buildRelevanceTerms('怎么样').terms).toHaveLength(0)
    })
})

describe('isRelevantItem 逐条准入', () => {
    it('无关内容被挡住（搜索质量核心诉求）', () => {
        expect(
            isRelevantItem('36氪 | 某公司发布新款手机，售价3999元', '', '手机壳批发'),
        ).toBe(false)
    })

    it('相关内容保留', () => {
        expect(isRelevantItem('手机壳批发厂家直销', '', '手机壳批发')).toBe(true)
    })

    it('只命中一个碎片不足以通过', () => {
        // 覆盖率 1/4 → 1.5 < 2
        expect(isRelevantItem('手机', '', '手机壳批发')).toBe(false)
    })

    it('查询提不出词项时不误杀', () => {
        expect(isRelevantItem('任意内容', '', '怎么样')).toBe(true)
    })
})

describe('filterByRelevance 变体结果准入', () => {
    it('变体带进的无关结果被主查询判据剔除', () => {
        const items = [
            { title: '手机壳批发厂家直销', snippet: '' },
            { title: '某公司发布新款手机', snippet: '' },
        ]
        const admitted = filterByRelevance(items, q('手机壳批发'))
        expect(admitted).toHaveLength(1)
        expect(admitted[0].title).toContain('批发')
    })
})

describe('rankAndDedup 排序与准入', () => {
    it('普通无关结果被丢弃，全不相关时返回空而非兜底', () => {
        const results = [
            { title: '完全不相关的页面', url: 'https://example.com/x', snippet: '' },
        ]
        expect(rankAndDedup(results, q('手机壳批发'))).toHaveLength(0)
    })

    it('媒体类结果跳过文本准入', () => {
        const results = [
            { title: '_DSC1234.jpg', url: 'https://img.example.com/a.jpg', snippet: '', sourceType: 'image-search' },
            { title: '完全不相关的网页', url: 'https://news.example.com/b', snippet: '' },
        ]
        const ranked = rankAndDedup(results, q('手机壳批发'))
        expect(ranked).toHaveLength(1)
        expect(ranked[0].sourceType).toBe('image-search')
    })

    it('正文参与相关性判定：摘要空但正文命中仍保留', () => {
        const results = [
            {
                title: '产品页',
                url: 'https://shop.example.com/p1',
                snippet: '',
                content: '本站提供手机壳批发业务，支持批量采购。',
            },
            {
                title: '产品页',
                url: 'https://shop.example.com/p2',
                snippet: '',
                content: '本站提供办公用品零售。',
            },
        ]
        const ranked = rankAndDedup(results, q('手机壳批发'))
        expect(ranked).toHaveLength(1)
        expect(ranked[0].url).toContain('/p1')
    })

    it('相关结果按综合分降序，权威站点在前', () => {
        const results = [
            { title: '手机壳批发-小站', url: 'https://random-blog.example.com/a', snippet: '' },
            { title: '手机壳批发-门户', url: 'https://news.sina.com.cn/a', snippet: '' },
        ]
        const ranked = rankAndDedup(results, q('手机壳批发'))
        expect(ranked.length).toBeGreaterThan(0)
        expect(ranked[0].url).toContain('sina.com.cn')
    })
})
