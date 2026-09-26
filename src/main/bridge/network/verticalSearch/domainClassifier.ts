/**
 * 领域识别器（Domain Classifier）
 *
 * 职责：
 * - 基于关键词字典，识别用户查询所属的垂直领域
 * - 支持多领域命中（如"汽车之家销量"同时命中 auto + encyclopedia）
 * - 返回领域标签与置信度，供智能搜索分发器决定查询策略
 *
 * 识别领域：
 * - auto：汽车（销量/车型/评测/4S店）
 * - realestate：房产（房价/楼盘/二手房/租房）
 * - travel：酒旅（酒店/旅游/美食/景点/机票）
 * - tech：科技（数码/互联网/AI/产品）
 * - academic：学术（论文/专利/研究/算法原理）
 * - encyclopedia：百科（是什么/简介/定义/历史）
 * - image：图片（找图/壁纸/截图/照片）
 * - video：视频（教程/视频/看视频）
 * - news：新闻（最新/今日/热点/事件）
 * - general：通用（兜底）
 *
 * 设计原则：
 * - 轻量纯函数，无外部依赖，无网络请求
 * - 关键词字典集中管理，便于扩展
 * - 多领域命中时按命中词数排序，取 top 2
 */

/** 垂直领域标签 */
export type SearchDomain =
  | 'auto'
  | 'realestate'
  | 'travel'
  | 'tech'
  | 'academic'
  | 'encyclopedia'
  | 'image'
  | 'video'
  | 'news'
  | 'general'

/** 领域识别结果 */
export interface DomainClassification {
  /** 主领域（置信度最高） */
  primary: SearchDomain
  /** 次要领域（可选，置信度次高） */
  secondary: SearchDomain | null
  /** 所有命中领域及命中词数 */
  hits: Array<{ domain: SearchDomain; count: number; matchedKeywords: string[] }>
  /** 是否为明确垂直领域（primary !== 'general'） */
  isVertical: boolean
}

/** 领域关键词字典 */
const DOMAIN_KEYWORDS: Record<Exclude<SearchDomain, 'general'>, string[]> = {
  auto: [
    '汽车', '车型', '轿车', 'SUV', 'MPV', '销量', '排行', '评测', '试驾',
    '4S店', '报价', '参数', '油耗', '新能源', '电动车', '混动', '充电',
    '比亚迪', '特斯拉', '丰田', '本田', '大众', '宝马', '奔驰', '奥迪',
    '蔚来', '小鹏', '理想', '问界', '极氪', '车机', '续航', '电池',
  ],
  realestate: [
    '房价', '楼盘', '二手房', '新房', '租房', '房贷', '首付', '月供',
    '物业', '学区房', '别墅', '公寓', '商铺', '写字楼', '土地',
    '贝壳', '链家', '安居客', '房产', '楼市', '成交', '均价',
  ],
  travel: [
    '酒店', '宾馆', '民宿', '旅馆', '住宿', '预订', '预定',
    '旅游', '旅行', '攻略', '景点', '景区', '门票', '游记',
    '美食', '餐厅', '饭店', '小吃', '推荐', '打卡',
    '五星级', '四星级', '度假', '度蜜月', '自由行', '跟团',
    '携程', '去哪儿', '飞猪', '美团', '大众点评', '马蜂窝',
    '航班', '机票', '高铁', '火车票', '汽车票',
  ],
  tech: [
    '手机', '电脑', '笔记本', '处理器', 'CPU', 'GPU', '显卡', '主板',
    '内存', '硬盘', '显示器', '耳机', '数码', '科技', '互联网',
    '人工智能', 'AI', '大模型', '芯片', '半导体', '5G', '6G',
    '操作系统', 'iOS', 'Android', '鸿蒙', '产品发布', '发布会',
  ],
  academic: [
    '论文', '专利', '研究', '算法', '原理', '学术', '期刊', '会议',
    '学者', '引用', '文献', '综述', '实验', '模型', '数据集',
    'arXiv', 'SCI', 'EI', '核心期刊', '知网', '万方',
  ],
  encyclopedia: [
    '是什么', '是什么意思', '简介', '定义', '百科', '详细介绍',
    '历史', '由来', '起源', '发展历程', '详细介绍', '背景',
    '人物简介', '公司简介', '组织架构',
  ],
  image: [
    '图片', '照片', '壁纸', '截图', '海报', '图标', 'logo',
    '配图', '素材', '高清图', '无版权', '免版权', '图库',
    '找图', '看图', '图片搜索',
  ],
  video: [
    '视频', '教程视频', '看视频', '在线观看', '播放', '片段',
    '录像', '直播', '回放', 'B站', '抖音', '快手', 'YouTube',
  ],
  news: [
    '新闻', '最新', '今日', '热点', '事件', '快讯', '报道',
    '发生', '刚刚', '实时', '动态', '资讯', '消息',
  ],
}

/** 预编译关键词匹配（含词边界处理） */
function matchDomain(query: string, domain: Exclude<SearchDomain, 'general'>): { count: number; matchedKeywords: string[] } {
  const keywords = DOMAIN_KEYWORDS[domain]
  const matched: string[] = []
  let count = 0

  for (const kw of keywords) {
    if (query.includes(kw)) {
      count++
      matched.push(kw)
    }
  }

  return { count, matchedKeywords: matched }
}

/**
 * 领域置信度门槛：命中词需在查询里占住足够份量
 *
 * 满足任一即通过：
 * - 命中 ≥ 2 个领域词：多个词同时出现，领域指向明确
 * - 命中词总字数 / 查询有效字符数 ≥ 比例阈值
 *
 * 例：「手机壳批发」只命中「手机」一词、占比 2/5，不达标 → 退回通用搜索，
 * 避免追加 site:36氪 之类的垂直检索，回来一整批无关的技术资讯。
 *
 * 阈值取 0.5 是准确率优先的取舍：像「北京房价走势」这类命中词被其它成分
 * 包围的查询（2/6）也会退回通用搜索，代价是少用一个垂直源；而通用搜索本身
 * 足以覆盖这类查询，误判领域却会直接带进一批无关内容。宁可少用，不可误用。
 */
const MIN_DOMAIN_COVERAGE = 0.5

function passesConfidence(query: string, matchedKeywords: string[]): boolean {
  if (matchedKeywords.length >= 2) return true

  const effectiveLength = query.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').length
  if (effectiveLength === 0) return false

  const matchedLength = matchedKeywords.reduce((sum, kw) => sum + kw.length, 0)
  return matchedLength / effectiveLength >= MIN_DOMAIN_COVERAGE
}

/**
 * 识别查询所属领域
 *
 * @param query 用户查询文本
 * @returns 领域识别结果
 */
export function classifyDomain(query: string): DomainClassification {
  const trimmed = query.trim()
  if (!trimmed) {
    return { primary: 'general', secondary: null, hits: [], isVertical: false }
  }

  const domains: Exclude<SearchDomain, 'general'>[] = [
    'auto', 'realestate', 'travel', 'tech', 'academic', 'encyclopedia', 'image', 'video', 'news',
  ]

  const hits: DomainClassification['hits'] = []

  for (const domain of domains) {
    const result = matchDomain(trimmed, domain)
    if (result.count > 0) {
      hits.push({ domain, count: result.count, matchedKeywords: result.matchedKeywords })
    }
  }

  if (hits.length === 0) {
    return { primary: 'general', secondary: null, hits: [], isVertical: false }
  }

  // 按命中词数降序排序
  hits.sort((a, b) => b.count - a.count)

  // 置信度门槛：只有主领域命中的词在查询中占住足够份量，才认定查询属于该领域。
  // 否则退回通用搜索 —— 领域误判会追加 site: 限定的垂直检索，带出一整批无关结果，
  // 而这类结果此前还会因来源优先级被排到通用结果之前。宁可少用垂直源，也不误判。
  if (!passesConfidence(trimmed, hits[0].matchedKeywords)) {
    return {
      primary: 'general',
      secondary: null,
      hits,
      isVertical: false,
    }
  }

  const primary = hits[0].domain
  const secondary = hits.length > 1 ? hits[1].domain : null

  return {
    primary,
    secondary,
    hits,
    isVertical: primary !== 'general',
  }
}
