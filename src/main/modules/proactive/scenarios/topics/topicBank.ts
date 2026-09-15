/**
 * 话题库（随机话题场景）
 *
 * 包含预定义的话题，按分类、深度、情绪标签组织。
 * 支持随机抽取，作为 LLM 生成的降级方案（离线可用）。
 *
 * @module proactive/scenarios/topics/topicBank
 */

// ============================================================
// 类型定义
// ============================================================

/** 话题深度 */
export type TopicDepth = 1 | 2 | 3

/** 话题分类 */
export type TopicCategory =
  | 'daily'       // 日常
  | 'tech'        // 科技
  | 'work'        // 职场
  | 'hobby'       // 兴趣
  | 'philosophy'  // 哲学
  | 'creative'    // 创意
  | 'learning'    // 学习
  | 'social'      // 社交
  | 'health'      // 健康
  | 'entertainment' // 娱乐

/** 话题情绪倾向 */
export type TopicMood =
  | 'light'       // 轻松
  | 'deep'        // 深度
  | 'warm'        // 温暖
  | 'curious'     // 好奇
  | 'motivational' // 励志
  | 'humorous'    // 幽默

/** 话题条目 */
export interface TopicItem {
  /** 话题文本 */
  text: string
  /** 分类 */
  category: TopicCategory
  /** 深度（1=浅，2=中，3=深） */
  depth: TopicDepth
  /** 情绪标签 */
  mood: TopicMood
  /** 可选的开场引导（用于 AI 进一步展开） */
  starter?: string
}

// ============================================================
// 话题库
// ============================================================

export const topicBank: TopicItem[] = [
  // ===== 日常（轻松/温暖）=====
  {
    text: '如果明天多出半天假期，你最想做什么？',
    category: 'daily',
    depth: 1,
    mood: 'light',
    starter: '聊聊那些"如果时间允许"的小愿望。',
  },
  {
    text: '最近有没有发现什么让你会心一笑的小事？',
    category: 'daily',
    depth: 1,
    mood: 'warm',
    starter: '分享生活中的小确幸。',
  },
  {
    text: '你小时候最喜欢的季节是什么？现在还一样吗？',
    category: 'daily',
    depth: 1,
    mood: 'warm',
    starter: '聊聊季节变化带来的感受。',
  },
  {
    text: '如果可以瞬间学会一道菜，你会选什么？',
    category: 'daily',
    depth: 1,
    mood: 'light',
    starter: '美食总是能带来幸福感。',
  },

  // ===== 科技（好奇/深度）=====
  {
    text: '你觉得 AI 最终会改变人类的哪些根本习惯？',
    category: 'tech',
    depth: 3,
    mood: 'curious',
    starter: '探讨技术对人类行为的深层影响。',
  },
  {
    text: '如果让你设计一个解决日常痛点的 App，它会是什么？',
    category: 'tech',
    depth: 2,
    mood: 'curious',
    starter: '从用户需求出发，构想产品。',
  },
  {
    text: '你认为未来 10 年，哪项技术会彻底普及？',
    category: 'tech',
    depth: 2,
    mood: 'curious',
    starter: '预测技术趋势，分享见解。',
  },
  {
    text: '有没有哪个科技产品让你觉得"相见恨晚"？',
    category: 'tech',
    depth: 1,
    mood: 'light',
    starter: '分享那些提升生活品质的好物。',
  },

  // ===== 职场（励志/深度）=====
  {
    text: '工作中最让你有成就感的时刻是什么？',
    category: 'work',
    depth: 2,
    mood: 'motivational',
    starter: '回顾那些值得骄傲的瞬间。',
  },
  {
    text: '如果可以给刚入职的自己一个建议，你会说什么？',
    category: 'work',
    depth: 2,
    mood: 'motivational',
    starter: '从经验中提炼智慧。',
  },
  {
    text: '你觉得理想的工作环境应该是什么样的？',
    category: 'work',
    depth: 2,
    mood: 'curious',
    starter: '探讨职场文化与个人价值观。',
  },
  {
    text: '最近有没有学到什么新技能让你很兴奋？',
    category: 'work',
    depth: 1,
    mood: 'motivational',
    starter: '分享学习的乐趣和收获。',
  },

  // ===== 兴趣（轻松/好奇）=====
  {
    text: '如果你有一个月完全自由的时间，你会用来做什么？',
    category: 'hobby',
    depth: 2,
    mood: 'curious',
    starter: '探索内心真正想做的事。',
  },
  {
    text: '有没有哪个爱好是你一直想尝试但还没开始的？',
    category: 'hobby',
    depth: 1,
    mood: 'curious',
    starter: '聊聊那些"总有一天"的计划。',
  },
  {
    text: '你最近在追什么剧/书/游戏？推荐吗？',
    category: 'hobby',
    depth: 1,
    mood: 'light',
    starter: '分享娱乐心得，交流推荐。',
  },
  {
    text: '如果只能保留一个爱好，你会选哪个？为什么？',
    category: 'hobby',
    depth: 2,
    mood: 'deep',
    starter: '思考什么对你真正重要。',
  },

  // ===== 哲学（深度/好奇）=====
  {
    text: '你觉得"成功"的定义是什么？它随时间变化过吗？',
    category: 'philosophy',
    depth: 3,
    mood: 'deep',
    starter: '探讨人生价值观的演变。',
  },
  {
    text: '如果可以和任何历史人物对话一小时，你会选谁？',
    category: 'philosophy',
    depth: 2,
    mood: 'curious',
    starter: '跨越时空的思想碰撞。',
  },
  {
    text: '你认为人类最值得保留的品质是什么？',
    category: 'philosophy',
    depth: 3,
    mood: 'deep',
    starter: '思考人性的光辉之处。',
  },
  {
    text: '有没有某个瞬间让你突然觉得"活着真好"？',
    category: 'philosophy',
    depth: 2,
    mood: 'warm',
    starter: '分享那些触动心灵的时刻。',
  },

  // ===== 创意（轻松/好奇）=====
  {
    text: '如果给你的生活拍一部电影，它会是什么类型？',
    category: 'creative',
    depth: 1,
    mood: 'humorous',
    starter: '用创意视角看待日常。',
  },
  {
    text: '你能用三个词形容今天的自己吗？',
    category: 'creative',
    depth: 1,
    mood: 'light',
    starter: '简单的自我觉察练习。',
  },
  {
    text: '如果发明一个新节日，你会设计什么主题？',
    category: 'creative',
    depth: 1,
    mood: 'humorous',
    starter: '天马行空的创意畅想。',
  },
  {
    text: '你觉得颜色有性格吗？比如红色是什么性格？',
    category: 'creative',
    depth: 2,
    mood: 'curious',
    starter: '探索感知与想象的边界。',
  },

  // ===== 学习（好奇/励志）=====
  {
    text: '最近有没有哪个知识点让你恍然大悟？',
    category: 'learning',
    depth: 1,
    mood: 'curious',
    starter: '分享那些"原来如此"的时刻。',
  },
  {
    text: '你觉得自学和跟老师学，最大的区别是什么？',
    category: 'learning',
    depth: 2,
    mood: 'curious',
    starter: '探讨不同学习方式的优劣。',
  },
  {
    text: '如果可以瞬间掌握一门语言，你会选什么？',
    category: 'learning',
    depth: 1,
    mood: 'curious',
    starter: '语言打开新世界的大门。',
  },
  {
    text: '你最近在研究什么有趣的话题？',
    category: 'learning',
    depth: 1,
    mood: 'curious',
    starter: '交流最近的学习心得。',
  },

  // ===== 社交（温暖/轻松）=====
  {
    text: '你觉得维系友谊最重要的因素是什么？',
    category: 'social',
    depth: 2,
    mood: 'warm',
    starter: '思考人际关系的本质。',
  },
  {
    text: '有没有哪个朋友让你特别感激？为什么？',
    category: 'social',
    depth: 2,
    mood: 'warm',
    starter: '表达对重要之人的感谢。',
  },
  {
    text: '你觉得线上社交和线下见面，哪个更能加深关系？',
    category: 'social',
    depth: 2,
    mood: 'curious',
    starter: '探讨现代社交方式。',
  },
  {
    text: '如果组织一次小型聚会，你会策划什么活动？',
    category: 'social',
    depth: 1,
    mood: 'light',
    starter: '分享社交创意和乐趣。',
  },

  // ===== 健康（温暖/励志）=====
  {
    text: '你最近有尝试什么新的运动或健身方式吗？',
    category: 'health',
    depth: 1,
    mood: 'motivational',
    starter: '交流健康生活方式。',
  },
  {
    text: '你觉得心理健康和身体健康，哪个更需要关注？',
    category: 'health',
    depth: 2,
    mood: 'deep',
    starter: '探讨身心平衡的重要性。',
  },
  {
    text: '有没有什么小习惯让你感觉精力更充沛？',
    category: 'health',
    depth: 1,
    mood: 'motivational',
    starter: '分享提升能量的小技巧。',
  },
  {
    text: '如果压力大了，你通常怎么调节？',
    category: 'health',
    depth: 2,
    mood: 'warm',
    starter: '交流减压方法和心得。',
  },

  // ===== 娱乐（轻松/幽默）=====
  {
    text: '如果你是超级英雄，你的超能力和弱点会是什么？',
    category: 'entertainment',
    depth: 1,
    mood: 'humorous',
    starter: '发挥想象力，轻松一刻。',
  },
  {
    text: '你听过最好笑的笑话是什么？',
    category: 'entertainment',
    depth: 1,
    mood: 'humorous',
    starter: '分享快乐，传播笑声。',
  },
  {
    text: '如果去荒岛只能带三样东西，你会带什么？',
    category: 'entertainment',
    depth: 1,
    mood: 'light',
    starter: '经典的选择题，看看你的优先级。',
  },
  {
    text: '你觉得最被低估的电影/歌曲是哪部/首？',
    category: 'entertainment',
    depth: 1,
    mood: 'light',
    starter: '分享那些被埋没的好作品。',
  },
]

// ============================================================
// 工具函数
// ============================================================

/**
 * 按条件筛选话题
 * @param options 筛选条件
 * @returns 符合条件的话题列表
 */
export function filterTopics(options: {
  mood?: TopicMood
  depth?: TopicDepth
  category?: TopicCategory
  exclude?: string[]
}): TopicItem[] {
  let filtered = [...topicBank]

  if (options.mood) {
    filtered = filtered.filter((t) => t.mood === options.mood)
  }

  if (options.depth) {
    filtered = filtered.filter((t) => t.depth === options.depth)
  }

  if (options.category) {
    filtered = filtered.filter((t) => t.category === options.category)
  }

  if (options.exclude && options.exclude.length > 0) {
    const excludeSet = new Set(options.exclude)
    filtered = filtered.filter((t) => !excludeSet.has(t.text))
  }

  return filtered
}

/**
 * 随机抽取指定数量的话题
 * @param topics 候选话题列表
 * @param count 抽取数量（默认 1）
 * @returns 抽取的话题列表
 */
export function pickRandomTopics(topics: TopicItem[], count: number = 1): TopicItem[] {
  if (topics.length === 0) return []
  if (count >= topics.length) return [...topics]

  const shuffled = [...topics].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

/**
 * 从话题库中随机抽取（一步完成筛选 + 抽取）
 * @param options 筛选条件
 * @param count 抽取数量
 * @returns 抽取的话题列表
 */
export function getRandomTopics(
  options: {
    mood?: TopicMood
    depth?: TopicDepth
    category?: TopicCategory
    exclude?: string[]
  } = {},
  count: number = 1,
): TopicItem[] {
  const filtered = filterTopics(options)
  return pickRandomTopics(filtered, count)
}

/**
 * 获取所有可用的分类
 */
export function getAvailableCategories(): TopicCategory[] {
  const categories = new Set(topicBank.map((t) => t.category))
  return Array.from(categories)
}

/**
 * 获取所有可用的情绪标签
 */
export function getAvailableMoods(): TopicMood[] {
  const moods = new Set(topicBank.map((t) => t.mood))
  return Array.from(moods)
}