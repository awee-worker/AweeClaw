/**
 * 工具预选
 *
 * 目的：系统提示词中的工具描述是上下文的主要占用方，而单轮任务实际用到的
 * 工具通常只占其中一部分。按用户意图裁掉无关工具的描述，可降低提示词体积。
 *
 * 裁剪策略（保守优先）：
 * 采用「反向裁剪」而非「正向挑选」——默认保留全量，仅当用户意图明确
 * 且与开发无关时，才裁掉开发类工具。
 *
 * 这样设计的原因：漏选工具会导致任务直接失败（AI 找不到可用工具），
 * 代价远高于多带几段工具描述；而开发类工具（终端、编辑、代码智能）
 * 一旦被误裁，用户看到的就是「AI 声称做不了」。
 *
 * 判定链路：
 * 1. 命中开发类意图 → 全量保留，直接返回
 * 2. 命中明确的非开发意图（查资料 / 媒体 / 数据分析 / 文档处理）→ 按该意图裁剪
 * 3. 未命中任何意图 → 全量保留
 */

import {
  TOOL_CONFIGS,
  type ToolCategory,
  type ToolConfig,
} from '@configuration/toolDefinitions'
import { logger } from '@toolkit/LogEngine'

/**
 * 开发类意图词表
 *
 * 命中任一即视为开发任务，工具集全量保留。
 * 词表刻意放宽（如「文件」「项目」「命令」都算），
 * 宁可多保留工具描述，也不让开发任务缺工具。
 */
const DEVELOPMENT_INTENT_WORDS: string[] = [
  // 编码动作
  '代码', '实现', '重构', '修复', '缺陷', '开发', '新增', '编写',
  '组件', '接口', '函数', '模块', '类', '方法', '变量', '类型',
  // 工程对象
  '文件', '目录', '文件夹', '项目', '工程', '仓库', '源码', '代码库',
  // 版本与协作
  'git', '提交', '分支', '合并', '冲突', 'commit', 'branch', 'merge', 'diff',
  // 构建与运行
  '构建', '编译', '打包', '运行', '执行', '测试', '部署', '启动', '安装',
  '命令', '终端', '脚本', '依赖', '服务', '报错', '日志', '调试',
  // 英文
  'code', 'implement', 'refactor', 'fix', 'build', 'compile', 'run',
  'test', 'deploy', 'install', 'debug', 'script', 'terminal', 'file',
  'directory', 'project', 'repo', 'error', 'log',
  // 命令行痕迹
  '--', './', 'npm ', 'yarn ', 'pnpm ', 'git ',
]

/**
 * 非开发意图规则
 *
 * 每条规则声明「该意图成立时仍需保留的工具类别白名单」，
 * 白名单之外的类别将被裁剪。
 *
 * 词表只收「领域名词」：问句助词（怎么样）、泛动词（总结、算一下）虽然常见，
 * 但它们不指向任何具体任务领域，一旦入表就会把「今天天气怎么样」这类
 * 非检索消息误判成检索任务。需要表达语气时，交给同句里的领域词承担。
 */
interface NonDevIntentRule {
  id: string
  words: string[]
  /**
   * 排除词：任一命中则整条规则作废
   *
   * 中文没有词边界，substring 匹配会把「排查一下」「检查一下」误判成检索意图
   * （命中「查一下」）。排除词用于剪掉这类前缀污染。
   */
  excludeWords?: string[]
  /** 该意图下需要保留的类别 */
  keepCategories: ToolCategory[]
}

const NON_DEV_INTENT_RULES: NonDevIntentRule[] = [
  {
    id: 'web-research',
    words: [
      '搜索一下', '搜一下', '帮我搜', '查一下', '查查', '网上', '资料',
      '新闻', '最新消息', '网址', '网页', '链接', '调研', '百科',
      '评测', '口碑', '评价', '排行', '攻略', '赛程', '余票', '价位',
      '财报', '题目', '研究', '附近', '开放时间', '是多少', '值不值',
      '有哪些', '对比',
      'search', 'lookup', 'research',
    ],
    // 「排查 / 检查」这类前缀会把「查一下」带出来，但它们是开发或运维动作
    excludeWords: ['排查', '检查', '调查', '审查'],
    keepCategories: ['read', 'search', 'network', 'interaction'],
  },
  {
    id: 'media',
    words: [
      '图片', '图像', '视频', '截图', '生成图', '画一张', '配图', '封面',
      '照片', '插画', '壁纸', '头像', '素材', '海报', '原图',
      '设计稿', '原型图', '效果图', '这张图', '图中', '图里',
      'image', 'video', 'picture', 'screenshot',
    ],
    // 图像/视频检索工具的 category 是 network，不是 media，两者都要保留
    keepCategories: ['read', 'search', 'network', 'media', 'interaction'],
  },
  {
    id: 'data-analysis',
    words: [
      '表格', 'excel', 'csv', '统计数据', '分析数据', '图表', '报表',
      '指标', '趋势', '统计', '筛选', '增长率',
      'dataset', 'chart', 'statistics',
    ],
    keepCategories: ['read', 'search', 'data', 'office', 'interaction'],
  },
  {
    id: 'office-doc',
    words: [
      '写文档', '做文档', 'word 文档', 'ppt', '做报告', '简历', '方案书',
      '文档', '报告', '邮件', '模板', '提纲', '文案',
      '协议', '申请', '起草', '讲义',
      'document', 'report', 'slides',
    ],
    keepCategories: ['read', 'search', 'office', 'write', 'interaction'],
  },
]

/** 预选结果 */
export interface ToolPreselection {
  /** 预选后的工具名列表（恒为入参 allowedTools 的子集） */
  tools: string[]
  /** 命中的意图规则 id */
  intents: string[]
  /**
   * 结果来源
   * - rule：按意图完成了裁剪
   * - fallback：未裁剪，保留全量
   */
  source: 'rule' | 'fallback'
  /** 未裁剪时的原因，便于排查 */
  reason?: string
}

/** 预选参数 */
export interface PreselectParams {
  /** 用户最新消息 */
  userMessage: string
  /** 上游已过滤的允许工具集 */
  allowedTools: string[]
  /**
   * 触发裁剪的最小工具数
   *
   * 工具本就很少时裁剪收益有限，反而增加判定成本，故设下限。
   */
  minToolsToPreselect?: number
}

/** 默认裁剪触发下限 */
export const DEFAULT_MIN_TOOLS_TO_PRESELECT = 18

/** 类别 → 工具名索引，首次访问时构建 */
let categoryIndex: Map<ToolCategory, string[]> | null = null

function getCategoryIndex(): Map<ToolCategory, string[]> {
  if (categoryIndex) return categoryIndex
  const index = new Map<ToolCategory, string[]>()
  for (const config of Object.values(TOOL_CONFIGS) as ToolConfig[]) {
    const list = index.get(config.category) ?? []
    list.push(config.name)
    index.set(config.category, list)
  }
  categoryIndex = index
  return index
}

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word))
}

/** 非开发意图规则匹配：命中任一意图词，且未命中任一排除词 */
function matchesRule(text: string, rule: NonDevIntentRule): boolean {
  if (!containsAny(text, rule.words)) return false
  if (rule.excludeWords && containsAny(text, rule.excludeWords)) return false
  return true
}

/**
 * 文本是否带有开发类意图
 *
 * 导出该判定供意图判定出口复用，避免同一套词表在多处各写一遍。
 * 注意：词表采用 substring 匹配（如 `log` 会命中 `blog`），
 * 这是刻意放宽的保守设计——宁可多保留工具，也不让开发任务缺工具。
 */
export function hasDevelopmentIntent(text: string): boolean {
  if (!text) return false
  return containsAny(text.toLowerCase(), DEVELOPMENT_INTENT_WORDS)
}

/**
 * 按用户意图预选工具
 *
 * 返回的 tools 恒为 allowedTools 的子集；未裁剪时原样返回，
 * 由 source 与 reason 字段说明原因。
 */
export function preselectTools(params: PreselectParams): ToolPreselection {
  const { userMessage, allowedTools } = params
  const minTools = params.minToolsToPreselect ?? DEFAULT_MIN_TOOLS_TO_PRESELECT

  const keepAll = (reason: string): ToolPreselection => ({
    tools: allowedTools,
    intents: [],
    source: 'fallback',
    reason,
  })

  // 工具数量本就不多，裁剪收益不足
  if (allowedTools.length < minTools) {
    return keepAll('工具数量未达裁剪下限')
  }

  const text = (userMessage || '').toLowerCase()
  if (!text.trim()) {
    return keepAll('缺少用户消息')
  }

  // 命中开发类意图：全量保留，此类任务对工具的完备性要求最高
  if (containsAny(text, DEVELOPMENT_INTENT_WORDS)) {
    return keepAll('命中开发类意图')
  }

  // 匹配非开发意图规则（含排除词剪枝）
  const matched = NON_DEV_INTENT_RULES.filter((rule) => matchesRule(text, rule))
  if (matched.length === 0) {
    return keepAll('未命中任何意图规则')
  }

  // 取所有命中规则的白名单并集
  const keepCategories = new Set<ToolCategory>()
  for (const rule of matched) {
    for (const category of rule.keepCategories) {
      keepCategories.add(category)
    }
  }

  const index = getCategoryIndex()
  const allowSet = new Set(allowedTools)
  const selected = new Set<string>()
  for (const category of keepCategories) {
    for (const toolName of index.get(category) ?? []) {
      // 只做减法：上游未放行的工具不因类别命中而被引入
      if (allowSet.has(toolName)) selected.add(toolName)
    }
  }

  // 裁剪结果异常偏少说明类别索引与允许集存在偏差，回退全量更稳
  if (selected.size < Math.ceil(allowedTools.length * 0.2)) {
    return keepAll(`裁剪结果偏少（${selected.size}/${allowedTools.length}）`)
  }

  const tools = allowedTools.filter((tool) => selected.has(tool))
  logger.agent.debug(
    `[ToolPreselector] 意图=${matched.map((rule) => rule.id).join(',')}，` +
      `工具 ${allowedTools.length} → ${tools.length}`,
  )

  return {
    tools,
    intents: matched.map((rule) => rule.id),
    source: 'rule',
  }
}
