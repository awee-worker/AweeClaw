/**
 * 客户端记忆分类器（规则引擎）
 *
 * 在记忆写入 SQLite 时同步执行关键词匹配，自动归类到 8 大分类。
 * 不依赖 LLM，零延迟，置信度通过命中关键词数量推算。
 *
 * 分类策略：
 *  1. 内容转小写后做关键词包含匹配
 *  2. 统计每个子分类的命中数，取最高者
 *  3. 1 个关键词 = 0.6，2 个 = 0.75，3+ 个 = 0.9
 *
 * 与后端 MemoryCategoryService.ruleBasedClassify 保持一致，
 * 客户端先做规则预分类，云端同步后可再由 LLM 精化。
 */

/** 记忆分类编码（与后端 Prisma 枚举对齐） */
export type MemoryCategory =
  | 'LIFE'
  | 'WORK'
  | 'PEOPLE'
  | 'KNOWLEDGE'
  | 'PREFERENCE'
  | 'EVENT'
  | 'EMOTION'
  | 'FINANCE'
  | 'UNCATEGORIZED'

/** 分类结果 */
export interface ClassificationResult {
  category: MemoryCategory
  subcategory: string | null
  confidence: number
  classifiedBy: 'rule' | 'system'
}

/** 子分类关键词索引条目 */
interface KeywordTarget {
  category: MemoryCategory
  subcategory: string
}

/**
 * 分类关键词表（子分类 → 关键词列表）
 * 关键词选择原则：
 *  - 高频、低歧义
 *  - 中文为主，兼顾英文缩写
 *  - 按子分类组织，便于精细化归类
 */
const CATEGORY_KEYWORDS: Record<MemoryCategory, Record<string, string[]>> = {
  LIFE: {
    daily: ['起床', '睡觉', '早餐', '午餐', '晚餐', '吃饭', '休息', '睡觉'],
    home: ['家', '家里', '回家', '搬家', '装修', '家具', '家电'],
    health: ['医院', '看病', '体检', '感冒', '发烧', '药', '运动', '健身', '跑步', '锻炼'],
    food: ['美食', '餐厅', '菜', '做饭', '外卖', '咖啡', '茶', '奶茶'],
    travel: ['旅游', '旅行', '出差', '酒店', '机票', '景点', '度假'],
  },
  WORK: {
    project: ['项目', '需求', '开发', '上线', '迭代', '版本', '发布'],
    meeting: ['会议', '开会', '讨论', '评审', '站会', '周会', '同步会'],
    task: ['任务', '待办', 'deadline', '截止', '完成', '进度', '延期'],
    colleague: ['同事', '领导', '老板', '团队', '部门', 'hr', 'HR'],
    work_tool: ['git', 'jira', 'confluence', 'slack', '钉钉', '飞书', '企微'],
  },
  PEOPLE: {
    family: ['爸爸', '妈妈', '父亲', '母亲', '父母', '儿子', '女儿', '孩子', '老婆', '老公', '妻子', '丈夫'],
    friend: ['朋友', '好友', '闺蜜', '哥们', '同学'],
    partner: ['男朋友', '女朋友', '对象', '伴侣', '恋人'],
    contact: ['联系人', '电话', '微信', '手机号', '邮箱'],
  },
  KNOWLEDGE: {
    tech: ['代码', '编程', '算法', '数据库', '前端', '后端', 'api', 'API', '框架', 'react', 'vue', 'python', 'java'],
    science: ['物理', '化学', '生物', '数学', '科学', '研究', '论文'],
    history: ['历史', '朝代', '战争', '古代', '皇帝'],
    concept: ['概念', '定义', '原理', '理论', '方法', '思路'],
  },
  PREFERENCE: {
    like: ['喜欢', '爱好', '最爱', '偏好', '口味'],
    dislike: ['不喜欢', '讨厌', '反感', '拒绝'],
    habit: ['习惯', '每天', '经常', '总是', '通常'],
    style: ['风格', '审美', '颜色', '设计', '简约', '复古'],
  },
  EVENT: {
    schedule: ['日程', '安排', '计划', '预约', '提醒'],
    anniversary: ['生日', '纪念日', '周年', '节日', '圣诞', '新年', '中秋'],
    news: ['新闻', '事件', '发生', '今天', '昨天', '刚刚'],
    milestone: ['毕业', '入职', '离职', '结婚', '搬家', '升职'],
  },
  EMOTION: {
    positive: ['开心', '快乐', '兴奋', '满足', '幸福', '感动'],
    negative: ['难过', '伤心', '沮丧', '焦虑', '压力', '烦躁', '生气', '愤怒'],
    neutral: ['感觉', '觉得', '心情', '情绪'],
  },
  FINANCE: {
    income: ['工资', '收入', '奖金', '分红', '理财收益'],
    expense: ['消费', '支出', '花费', '买单', '支付', '账单'],
    investment: ['股票', '基金', '理财', '投资', '比特币', '加密货币'],
    budget: ['预算', '存款', '储蓄', '贷款', '信用卡'],
  },
  UNCATEGORIZED: {},
}

/** 构建关键词倒排索引：keyword → target */
const keywordIndex = new Map<string, KeywordTarget>()
for (const [category, subcategories] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const [subcategory, keywords] of Object.entries(subcategories)) {
    for (const kw of keywords) {
      keywordIndex.set(kw.toLowerCase(), { category: category as MemoryCategory, subcategory })
    }
  }
}

/**
 * 规则分类：基于关键词匹配
 * @param content 记忆内容
 * @returns 分类结果，无命中时返回 UNCATEGORIZED
 */
export function ruleBasedClassify(content: string): ClassificationResult {
  if (!content || content.trim().length === 0) {
    return { category: 'UNCATEGORIZED', subcategory: null, confidence: 0, classifiedBy: 'system' }
  }

  const text = content.toLowerCase()

  // 统计每个子分类的命中数
  const subcategoryHits = new Map<string, { category: MemoryCategory; subcategory: string; count: number }>()

  for (const [keyword, target] of keywordIndex.entries()) {
    if (text.includes(keyword)) {
      const key = `${target.category}:${target.subcategory}`
      const existing = subcategoryHits.get(key)
      if (existing) {
        existing.count += 1
      } else {
        subcategoryHits.set(key, {
          category: target.category,
          subcategory: target.subcategory,
          count: 1,
        })
      }
    }
  }

  if (subcategoryHits.size === 0) {
    return { category: 'UNCATEGORIZED', subcategory: null, confidence: 0, classifiedBy: 'system' }
  }

  // 取命中数最多的子分类
  let bestMatch: { category: MemoryCategory; subcategory: string; count: number } | null = null
  for (const hit of subcategoryHits.values()) {
    if (!bestMatch || hit.count > bestMatch.count) {
      bestMatch = hit
    }
  }

  if (!bestMatch) {
    return { category: 'UNCATEGORIZED', subcategory: null, confidence: 0, classifiedBy: 'system' }
  }

  // 置信度：1 个 = 0.6，2 个 = 0.75，3+ 个 = 0.9
  const confidence = bestMatch.count >= 3 ? 0.9 : bestMatch.count === 2 ? 0.75 : 0.6

  return {
    category: bestMatch.category,
    subcategory: bestMatch.subcategory,
    confidence,
    classifiedBy: 'rule',
  }
}
