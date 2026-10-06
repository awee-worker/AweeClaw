/**
 * 记忆场景域判定
 *
 * 域标签决定一条记忆在哪些场景被读回来。此前写入时一律取「当前场景」的域，
 * 于是在办公模式下聊到的生活内容会被打上工作域标签，形成跨域污染 ——
 * 既是污染源，也让用户看不出记忆与场景的关联。
 *
 * 这里改为按内容本身判定归属：
 *  - 能判定到具体场景 → 归该场景域
 *  - 与场景无关的通用偏好/约定 → 共享域，所有场景可见
 *  - 判不出来 → 回落到当前场景域
 */

export type MemoryDomain = 'work' | 'life' | 'study' | 'dev' | 'shared'

/** 各场景的领域词表。命中数最多者胜出 */
const DOMAIN_KEYWORDS: Array<{ domain: Exclude<MemoryDomain, 'shared'>; pattern: RegExp }> = [
  {
    domain: 'dev',
    pattern:
      /(代码|函数|类|接口|组件|模块|重构|编译|报错|异常|堆栈|依赖|部署|构建|单测|测试|git|commit|分支|合并|仓库|npm|pnpm|yarn|package|api|sdk|typescript|javascript|python|java|golang|rust|sql|react|vue|docker|kubernetes|数据库|框架|脚本)/i,
  },
  {
    domain: 'work',
    pattern:
      /(会议|纪要|邮件|日程|汇报|周报|日报|客户|合同|审批|报价|项目进度|立项|预算|kpi|okr|需求|排期|评审|同事|领导|部门|岗位|绩效|报销|出差|对接)/i,
  },
  {
    domain: 'study',
    pattern:
      /(学习|课程|知识点|笔记|复习|预习|考试|论文|文献|公式|定理|单词|背诵|题库|讲座|教程|章节|习题|老师|同学|专业)/i,
  },
  {
    domain: 'life',
    pattern:
      /(饮食|菜谱|做饭|口味|运动|健身|跑步|睡眠|作息|生日|纪念日|旅行|旅游|购物|情绪|心情|健康|体检|家人|父母|孩子|朋友|宠物|电影|音乐|游戏)/i,
  },
]

/** 跨场景通用偏好：与具体场景无关的交互约定，所有场景都该读到 */
const SHARED_PATTERNS: RegExp[] = [
  /(回答|回复|答复)(要|请|尽量|应该|别|不要)/,
  /(用|说|讲|输出)(中文|英文|英语)/,
  /(不要|别)(啰嗦|废话|客套|绕弯子)/,
  /(格式|排版|风格|语气)(要|请|尽量|偏向)/,
  /^(称呼我|叫我)/,
]

export interface DomainVerdict {
  domain: MemoryDomain
  tag: string
  /** 判定把握 0~1，低于 0.4 时调用方可考虑回落到当前场景域 */
  confidence: number
}

/**
 * 按内容判定记忆归属的场景域。
 *
 * @param content  记忆内容
 * @param fallback 判不出时的兜底域，通常取当前激活场景
 */
export function classifyMemoryDomain(
  content: string,
  fallback: MemoryDomain = 'work',
): DomainVerdict {
  const text = (content ?? '').trim()
  if (!text) return { domain: fallback, tag: `domain:${fallback}`, confidence: 0 }

  for (const pattern of SHARED_PATTERNS) {
    if (pattern.test(text)) {
      return { domain: 'shared', tag: 'domain:shared', confidence: 0.8 }
    }
  }

  const scores = new Map<MemoryDomain, number>()
  for (const rule of DOMAIN_KEYWORDS) {
    if (rule.pattern.test(text)) {
      scores.set(rule.domain, (scores.get(rule.domain) ?? 0) + 1)
    }
  }

  if (scores.size === 0) {
    return { domain: fallback, tag: `domain:${fallback}`, confidence: 0.3 }
  }

  let best: MemoryDomain = fallback
  let bestScore = 0
  let total = 0
  for (const [domain, score] of scores) {
    total += score
    if (score > bestScore) {
      best = domain
      bestScore = score
    }
  }

  // 命中越集中越有把握：单一领域命中给 0.9，多领域混杂时按占比衰减
  const confidence = Math.min(0.95, 0.5 + (bestScore / Math.max(1, total)) * 0.45)
  return { domain: best, tag: `domain:${best}`, confidence }
}

/** 把 `domain:work` 形式的标签还原为域标识 */
export function domainFromTag(tag: string | undefined): MemoryDomain | null {
  if (!tag || !tag.startsWith('domain:')) return null
  const value = tag.slice('domain:'.length) as MemoryDomain
  return value === 'work' || value === 'life' || value === 'study' || value === 'dev' || value === 'shared'
    ? value
    : null
}
