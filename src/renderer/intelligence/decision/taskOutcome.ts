/**
 * 结构化终局与任务中途自查
 *
 * 失败不该只是一句 `error: "interaction_failed"`。用户需要知道三件事：
 * 做到哪一步、卡在哪、下一步能点什么。这三件事对应 TaskSummary 的三个字段。
 *
 * 另一半是「让模型有机会中途认输」：现有收敛手段（循环检测、轮次上限）都是事后
 * 干预，用户等 30 步换来一个失败，体验远差于第 8 步就说「这个页面要登录，我做不了」。
 * 因此在步数用掉一半、四分之三时各注入一次自查，最后一轮把工具收窄到只剩说明。
 *
 * @module intelligence/decision/taskOutcome
 */

/** 失败子类型：定义在 shared 协议里，前后端与移动端共用一份 */
export type { FailureSubtype } from '@shared/protocols/toolOutcomeProtocol'
import type { FailureSubtype } from '@shared/protocols/toolOutcomeProtocol'

/** 卡住的原因 */
export interface TaskBlocker {
  subtype: FailureSubtype
  detail: string
}

/** 下一步可执行动作 */
export interface TaskNextAction {
  label: string
  action: 'retry' | 'retry-from-step' | 'takeover' | 'new-task'
  payload?: unknown
}

/** 终局摘要 */
export interface TaskSummary {
  /** 做到哪一步（引用步骤名，而不是百分比） */
  reached: string
  blocker?: TaskBlocker
  nextActions: TaskNextAction[]
}

/** 失败子类型的双语文案 */
export const FAILURE_SUBTYPE_LABEL: Record<FailureSubtype, { zh: string; en: string }> = {
  blocked: { zh: '目标被遮挡或权限不足', en: 'Target blocked or permission denied' },
  login_incomplete: { zh: '登录未完成', en: 'Login not completed' },
  captcha_incomplete: { zh: '验证码未完成', en: 'Verification not completed' },
  route_failed: { zh: '找不到目标位置', en: 'Target location not found' },
  device_unavailable: { zh: '设备不在线', en: 'Device unavailable' },
  interaction_failed: { zh: '操作未能完成', en: 'Interaction failed' },
}

/** 关键词 → 子类型。顺序即优先级：越具体的先判 */
const SUBTYPE_PATTERNS: Array<{ subtype: FailureSubtype; re: RegExp }> = [
  { subtype: 'login_incomplete', re: /login|登录|未登录|sign[\s-]?in/i },
  { subtype: 'captcha_incomplete', re: /captcha|验证码|人机|verification code/i },
  { subtype: 'blocked', re: /permission|denied|forbidden|权限|拒绝|被遮挡|obscured|blocked/i },
  { subtype: 'device_unavailable', re: /offline|disconnect|unavailable|设备|离线|断连/i },
  { subtype: 'route_failed', re: /not found|no such|missing|不存在|找不到|enoent/i },
]

/**
 * 从错误文案推断失败子类型
 *
 * 只做关键词映射，不做语义判断：结果用于展示与统计，不参与任何自动决策。
 */
export function classifyFailureSubtype(text?: string): FailureSubtype {
  const raw = (text || '').trim()
  if (!raw) return 'interaction_failed'
  for (const { subtype, re } of SUBTYPE_PATTERNS) {
    if (re.test(raw)) return subtype
  }
  return 'interaction_failed'
}

/** 子类型的本地化文案 */
export function failureSubtypeLabel(subtype: FailureSubtype, language: string): string {
  const entry = FAILURE_SUBTYPE_LABEL[subtype]
  return language === 'zh' ? entry.zh : entry.en
}

/**
 * 失败的下一步动作
 *
 * 固定给四个选项而不是按子类型各写一套：用户在不同失败下想要的动作高度重合，
 * 差异体现在「我来处理」是否可点，而不是按钮种类。
 */
export function buildFailureNextActions(options?: { canTakeover?: boolean }): TaskNextAction[] {
  const actions: TaskNextAction[] = [
    { label: '重试', action: 'retry' },
    { label: '换个说法重试', action: 'retry-from-step' },
  ]
  if (options?.canTakeover) actions.push({ label: '我来处理', action: 'takeover' })
  actions.push({ label: '新建任务', action: 'new-task' })
  return actions
}

/** 组装终局摘要 */
export function buildTaskSummary(input: {
  reached: string
  error?: string
  canTakeover?: boolean
}): TaskSummary {
  const detail = (input.error || '').trim()
  const summary: TaskSummary = {
    reached: input.reached || '未开始',
    nextActions: buildFailureNextActions({ canTakeover: input.canTakeover }),
  }
  if (detail) {
    summary.blocker = { subtype: classifyFailureSubtype(detail), detail }
  }
  return summary
}

/**
 * 组装成功任务的终局摘要
 *
 * 成功时没有「卡在哪」，也不再给重试类动作：任务的下一步只取决于用户还想做什么，
 * 不在失败动作的枚举里。留空比塞一个用不上的按钮更诚实。
 */
export function buildCompletedSummary(reached: string): TaskSummary {
  const text = (reached || '').trim()
  return {
    reached: text ? text.slice(0, 200) : '任务已完成',
    nextActions: [],
  }
}

/** 从一段回复里取第一句，用作「做到了什么」 */
export function firstSentenceOf(text: string, max = 200): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const match = clean.match(/^.{1,200}?[。.!?！？\n]/)
  return (match ? match[0] : clean.slice(0, max)).trim().slice(0, max)
}

/** 自查提醒的类型 */
export type SelfCheckStage = 'half' | 'threeQuarter' | 'final'

/**
 * 生成中途自查提醒
 *
 * 只要求模型回答三件事：确认了什么、还差什么、剩下的路能不能走通。
 * 明确给出「走不通就如实放弃」的出口 —— 不给出口，模型只会继续硬试。
 */
export function buildSelfCheckPrompt(language: string, stage: SelfCheckStage): string {
  const zh = language === 'zh'
  if (stage === 'final') {
    return zh
      ? '【本轮为最后一轮】工具调用预算已用尽。不要再调用任何工具，直接用文字回答：\n1. 已经完成了什么（写清具体产物或结论）；\n2. 还有什么没做成、卡在哪里；\n3. 建议用户下一步怎么做。\n如实说明即可，做不完不是错，含糊其辞才是。'
      : '[Final round] The tool-call budget is exhausted. Do not call any tools. Answer in plain text: (1) what you completed, with concrete artifacts; (2) what is still unfinished and where you got stuck; (3) what the user should do next. Be honest — not finishing is acceptable, vagueness is not.'
  }
  const ratio = stage === 'half' ? (zh ? '一半' : 'half') : (zh ? '四分之三' : 'three quarters')
  return zh
    ? `【进度自查】本轮工具调用预算已用掉${ratio}。请在回答里简要说明三件事：\n1. 已经确认了什么（有依据的结论）；\n2. 还差什么没完成；\n3. 按现在的路子能不能走通。\n如果能走通就继续；如果判断走不通，请**如实放弃并说明原因**，不要继续反复尝试。`
    : `[Progress self-check] ${ratio} of the tool-call budget is spent. Briefly state: (1) what you have confirmed with evidence; (2) what remains; (3) whether the current approach can work. Continue if it can; if not, stop and explain honestly instead of retrying blindly.`
}

/** 任务步数预算默认值：与 MAX_LOOP_ITERATIONS（200，宽松兜底）区分开 */
export const DEFAULT_TASK_STEP_BUDGET = 60

/** 小于该步数的任务不做中途自查：三步就能干完的事，提醒只会添乱 */
export const SELF_CHECK_MIN_BUDGET = 10

/** 计算某个自查节点对应的轮次；预算过小时返回 null */
export function selfCheckRound(budget: number, stage: SelfCheckStage): number | null {
  if (budget < SELF_CHECK_MIN_BUDGET) return null
  if (stage === 'half') return Math.max(1, Math.ceil(budget * 0.5))
  if (stage === 'threeQuarter') return Math.max(1, Math.ceil(budget * 0.75))
  return budget
}
