/**
 * 垂直门户站点配置（Vertical Sites）
 *
 * 职责：
 * - 定义各垂直领域的专业门户站点列表
 * - 供 site: 限定搜索使用（通过 SearXNG/Bing 的 site: 语法限定搜索范围）
 * - 每个站点包含域名、名称、权重
 *
 * 设计原则：
 * - 仅收录国内可直连、内容质量高的门户
 * - 权重影响结果排序（越高越优先）
 * - 站点列表可扩展，后续可接入配置文件动态加载
 */

import type { SearchDomain } from './domainClassifier'

/** 垂直门户站点定义 */
export interface VerticalSite {
  /** 站点显示名称 */
  name: string
  /** 站点域名（用于 site: 语法，不含协议） */
  domain: string
  /** 权重（0-2，越高越优先） */
  weight: number
}

/** 各领域的专业门户站点 */
export const VERTICAL_SITES: Record<Exclude<SearchDomain, 'general' | 'image' | 'video' | 'encyclopedia' | 'academic'>, VerticalSite[]> = {
  // 汽车领域
  auto: [
    { name: '汽车之家', domain: 'autohome.com.cn', weight: 1.5 },
    { name: '懂车帝', domain: 'dongchedi.com', weight: 1.4 },
    { name: '易车网', domain: 'yiche.com', weight: 1.2 },
    { name: '太平洋汽车', domain: 'pcauto.com.cn', weight: 1.0 },
    { name: '爱卡汽车', domain: 'xcar.com.cn', weight: 1.0 },
  ],

  // 房产领域
  realestate: [
    { name: '贝壳找房', domain: 'ke.com', weight: 1.5 },
    { name: '链家', domain: 'lianjia.com', weight: 1.4 },
    { name: '安居客', domain: 'anjuke.com', weight: 1.3 },
    { name: '房天下', domain: 'fang.com', weight: 1.1 },
    { name: '58同城房产', domain: '58.com', weight: 0.9 },
  ],

  // 酒旅领域
  travel: [
    { name: '携程', domain: 'ctrip.com', weight: 1.5 },
    { name: '马蜂窝', domain: 'mafengwo.cn', weight: 1.4 },
    { name: '大众点评', domain: 'dianping.com', weight: 1.3 },
    { name: '去哪儿', domain: 'qunar.com', weight: 1.3 },
    { name: '飞猪', domain: 'fliggy.com', weight: 1.2 },
    { name: '美团酒店', domain: 'meituan.com', weight: 1.1 },
  ],

  // 科技领域
  tech: [
    { name: '36氪', domain: '36kr.com', weight: 1.4 },
    { name: '爱范儿', domain: 'ifanr.com', weight: 1.3 },
    { name: '雷锋网', domain: 'leiphone.com', weight: 1.2 },
    { name: '极客公园', domain: 'geekpark.net', weight: 1.1 },
    { name: '少数派', domain: 'sspai.com', weight: 1.0 },
    { name: 'IT之家', domain: 'ithome.com', weight: 1.2 },
    { name: '中关村在线', domain: 'zol.com.cn', weight: 1.1 },
  ],

  // 新闻领域
  news: [
    { name: '新浪新闻', domain: 'news.sina.com.cn', weight: 1.3 },
    { name: '网易新闻', domain: 'news.163.com', weight: 1.2 },
    { name: '腾讯新闻', domain: 'news.qq.com', weight: 1.3 },
    { name: '澎湃新闻', domain: 'thepaper.cn', weight: 1.2 },
    { name: '凤凰新闻', domain: 'news.ifeng.com', weight: 1.0 },
  ],
}

/**
 * 构建站点限定查询（site: 语法）
 *
 * 将原始查询扩展为带 site: 限定符的查询，
 * 用于 SearXNG/Bing 的站点限定搜索。
 *
 * 示例：
 * - "比亚迪销量" + autohome.com.cn → "比亚迪销量 site:autohome.com.cn"
 * - 多站点 → "比亚迪销量 (site:autohome.com.cn | site:dongchedi.com)"
 *
 * @param query 原始查询
 * @param domain 领域
 * @param maxSites 最多限定的站点数（默认 3）
 * @returns site: 限定查询字符串，若该领域无站点配置则返回 null
 */
export function buildSiteQuery(
  query: string,
  domain: SearchDomain,
  maxSites = 3,
): { query: string; sites: VerticalSite[] } | null {
  const sites = VERTICAL_SITES[domain as keyof typeof VERTICAL_SITES]
  if (!sites || sites.length === 0) return null

  const selected = sites.slice(0, maxSites)
  const siteFilters = selected.map(s => `site:${s.domain}`).join(' | ')
  const siteQuery = `${query} (${siteFilters})`

  return { query: siteQuery, sites: selected }
}

/**
 * 获取领域推荐站点名称（用于结果标注来源）
 */
export function getSiteNames(domain: SearchDomain, max = 3): string[] {
  const sites = VERTICAL_SITES[domain as keyof typeof VERTICAL_SITES]
  if (!sites) return []
  return sites.slice(0, max).map(s => s.name)
}
