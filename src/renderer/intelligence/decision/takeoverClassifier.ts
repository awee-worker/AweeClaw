/**
 * 接管判定
 *
 * 登录、验证码、风控拦截、付款确认、需要人做选择 —— 这五类事在执行过程中出现时，
 * 正确的处理不是报错退出，而是把机器交给现场的人，处理完从原地续跑。
 *
 * 判定集中在这里，工具层只负责把「看到的信号」交上来：
 * - 页面可见文本、当前 URL
 * - 工具返回的业务错误码
 * - 已知的支付要素或候选方案
 *
 * 不允许各工具自行拼原因字符串。原因一旦散开，统计就无从谈起，
 * 也就无法回答「哪类接管最多、哪类接管其实暴露了产品缺陷」。
 *
 * 判定只回答两件事：
 * 1. 要不要接管，为什么；
 * 2. 该不该真的停下来等人（无人值守时绝不停）。
 *
 * @module intelligence/decision/takeoverClassifier
 */
import type {
  Attendance,
  RunOrigin,
  TakeoverReason,
  TakeoverRequest,
} from '@shared/protocols/deviceTaskProtocol'
import {
  resolveAttendance,
  shouldAwaitTakeover,
  takeoverTimeoutMs,
} from '@shared/protocols/deviceTaskProtocol'

/** 工具返回的业务错误码前缀，形如 `TAKEOVER:login` */
export const TAKEOVER_ERROR_PREFIX = 'TAKEOVER:'

/** 付款卡片需要展示的三要素，缺一项也能降级展示 */
export interface PaymentFacts {
  /** 付款对象 */
  item?: string
  /** 金额，保留原始写法（含币种符号） */
  amount?: string
  /** 收货或付款地址 */
  address?: string
}

/** 判定输入：调用方把能拿到的信号全给上，缺项不影响判定 */
export interface TakeoverSignal {
  /** 当前页面可见文本（标题、按钮、提示语等） */
  text?: string
  /** 当前 URL，用于识别登录域与支付域 */
  url?: string
  /** 工具返回的业务错误码；带 TAKEOVER: 前缀时优先按它定案 */
  errorCode?: string
  /** 需要人在多个方案里选时的候选 */
  options?: string[]
  /** 已知支付要素 */
  payment?: PaymentFacts
  /** 谁发起了这次运行 */
  origin?: RunOrigin
  /** 调用方显式声明的到场情况，优先于按来源推断 */
  attendance?: Attendance
}

/** 判定结论 */
export interface TakeoverDecision {
  /** 是否需要人在 PC 上处理 */
  needed: boolean
  /** 具体原因；needed=false 时为空 */
  reason?: TakeoverReason
  /** 可直接上报的接管请求；needed=false 时为空 */
  request?: TakeoverRequest
  /** 推断出的到场情况 */
  attendance: Attendance
  /** 是否应阻塞等待用户；false 表示直接按 skipped 收尾 */
  shouldAwait: boolean
  /** 不阻塞时的收尾说明，写入任务结果 */
  skipNote?: string
}

/** 原因的中文短标签，用于结果文案与统计分组 */
export const TAKEOVER_REASON_LABEL: Record<TakeoverReason, string> = {
  login: '需要登录',
  captcha: '需要验证码 / 人机校验',
  access_blocked: '页面被风控拦截或无法读取',
  payment: '需要确认付款',
  decision: '需要你选择方案',
  other: '需要人工处理',
}

interface ReasonRule {
  reason: TakeoverReason
  /** 命中一次计 2 分，需多处佐证才定案，避免导航栏里的「登录」误判 */
  cues: RegExp[]
  /** 命中一次计 5 分，出现即可定案 */
  strong: RegExp[]
}

/**
 * 判定规则
 *
 * 分数阈值 4：单条普通线索（2 分）不足以定案，两条互证的线索
 * （如「用户名」+「密码」）或一条强线索才认定 —— 宁可漏判交给模型，
 * 也不要因为页面角落里写着「登录」就把任务挂起。
 */
const RULES: ReasonRule[] = [
  {
    reason: 'payment',
    strong: [
      /收银台/,
      /确认(支付|付款)/,
      /立即(支付|付款)/,
      /去支付/,
      /提交订单/,
      /checkout/i,
      /pay\s*now/i,
      /payment\s*method/i,
    ],
    cues: [/支付方式/, /应付/, /订单金额/, /收货地址/, /配送地址/, /实付/, /[¥￥]\s*\d/, /\btotal\b/i],
  },
  {
    reason: 'access_blocked',
    strong: [
      /访问受限/,
      /访问异常/,
      /检测到(异常|风险)/,
      /风控/,
      /暂时无法访问/,
      /access\s*denied/i,
      /unusual\s*traffic/i,
      /forbidden/i,
    ],
    cues: [/\b403\b/, /\b429\b/, /访问频繁/, /限制访问/, /拒绝访问/, /请稍后再试/, /rate\s*limit/i],
  },
  {
    reason: 'login',
    strong: [
      /请先登录/,
      /登录后(继续|查看|操作)/,
      /账号登录/,
      /密码登录/,
      /sign\s*in\s*to\s*continue/i,
      /log\s*in\s*to\s*continue/i,
      /please\s+(log|sign)\s*in/i,
    ],
    cues: [/用户名/, /账号/, /手机号/, /密码/, /登录/, /注册/, /忘记密码/, /username/i, /password/i],
  },
  {
    reason: 'captcha',
    strong: [
      /人机验证/,
      /安全验证/,
      /拖动滑块/,
      /完成验证/,
      /verify\s+you\s+are\s+human/i,
      /security\s*check/i,
      /captcha/i,
    ],
    cues: [/验证码/, /滑块/, /图形码/, /短信验证码/, /动态码/, /verification\s*code/i, /one[- ]time\s*code/i],
  },
  {
    reason: 'decision',
    strong: [/请选择(一个|其中)/, /choose\s+one/i, /select\s+an?\s+option/i],
    cues: [/请选择/, /候选/, /方案/],
  },
]

/** 业务错误码 → 接管原因。只收显式声明的码，避免把普通失败误升为接管 */
const ERROR_CODE_REASONS: Record<string, TakeoverReason> = {
  login_required: 'login',
  auth_required: 'login',
  captcha_required: 'captcha',
  captcha_blocked: 'captcha',
  human_verification_required: 'captcha',
  access_blocked: 'access_blocked',
  risk_control: 'access_blocked',
  payment_required: 'payment',
  decision_required: 'decision',
}

/** 定案阈值：见 RULES 的分数说明 */
const DECISION_THRESHOLD = 4

/** 解析 `TAKEOVER:<reason>` 形式的业务错误码 */
export function parseTakeoverError(code?: string): TakeoverReason | null {
  if (!code || !code.startsWith(TAKEOVER_ERROR_PREFIX)) return null
  const reason = code.slice(TAKEOVER_ERROR_PREFIX.length).trim() as TakeoverReason
  return reason in TAKEOVER_REASON_LABEL ? reason : null
}

/** 构造 `TAKEOVER:<reason>`，供工具层返回 */
export function formatTakeoverError(reason: TakeoverReason): string {
  return `${TAKEOVER_ERROR_PREFIX}${reason}`
}

/** 按线索与强线索打分，取最高分且过阈值的那个原因 */
function scoreReasons(text: string): TakeoverReason | null {
  let best: TakeoverReason | null = null
  let bestScore = 0
  for (const rule of RULES) {
    let score = 0
    for (const pattern of rule.strong) {
      if (pattern.test(text)) score += 5
    }
    for (const pattern of rule.cues) {
      if (pattern.test(text)) score += 2
    }
    // 同分时保留先出现的规则（RULES 顺序即优先级：付款 > 风控 > 登录 > 验证码 > 选择）
    if (score > bestScore) {
      bestScore = score
      best = rule.reason
    }
  }
  return bestScore >= DECISION_THRESHOLD ? best : null
}

/** 从文本里抽取金额，用于付款卡片直接展示 */
function extractAmount(text: string): string | undefined {
  const match = text.match(/(?:[¥￥]\s*\d[\d,]*(?:\.\d+)?)|(?:\b(?:CNY|USD)\s*\d[\d,]*(?:\.\d+)?)/i)
  return match ? match[0].replace(/\s+/g, '') : undefined
}

/** 从文本里抽取收货地址的简短片段 */
function extractAddress(text: string): string | undefined {
  const match = text.match(/(收货地址|配送地址|寄送至)[：:\s]*([^\n]{2,40})/)
  return match ? match[2].trim() : undefined
}

/** 组装上报用的接管请求 */
function buildRequest(
  reason: TakeoverReason,
  signal: TakeoverSignal,
  attendance: Attendance,
): TakeoverRequest {
  const timeout = takeoverTimeoutMs(attendance)
  const request: TakeoverRequest = {
    reason,
    message: buildMessage(reason, signal),
    expiresAt: timeout > 0 ? Date.now() + timeout : undefined,
  }

  if (reason === 'payment') {
    const text = signal.text ?? ''
    request.item = signal.payment?.item ?? extractItem(text)
    request.amount = signal.payment?.amount ?? extractAmount(text)
    request.address = signal.payment?.address ?? extractAddress(text)
  }

  if (reason === 'decision' && signal.options?.length) {
    request.options = signal.options.slice(0, 8)
  }

  return request
}

/** 付款对象：优先取「商品/订单」后紧跟的短语 */
function extractItem(text: string): string | undefined {
  const match = text.match(/(?:商品|订单|付款对象)[：:\s]*([^\n]{2,30})/)
  return match ? match[1].trim() : undefined
}

/** 给用户看的一句话：说清卡在哪，不解释技术细节 */
function buildMessage(reason: TakeoverReason, signal: TakeoverSignal): string {
  switch (reason) {
    case 'login':
      return '页面要求登录后才能继续，请在电脑上完成登录'
    case 'captcha':
      return '出现验证码 / 人机校验，请在电脑上完成校验'
    case 'access_blocked':
      return '页面被风控拦截或读不出内容，请在电脑上确认页面状态'
    case 'payment':
      return '需要确认付款后继续，请在电脑上核对并完成支付'
    case 'decision': {
      const options = signal.options ?? []
      return options.length
        ? `需要你在 ${options.length} 个方案里选一个：${options.slice(0, 3).join(' / ')}`
        : '需要你先做一个选择才能继续，请在电脑上操作'
    }
    default:
      return '这一步需要你在电脑上处理一下'
  }
}

/**
 * 判定当前是否该发起接管
 *
 * @param signal 调用方观测到的信号
 */
export function classifyTakeover(signal: TakeoverSignal): TakeoverDecision {
  const attendance = resolveAttendance(signal.origin ?? 'ui', signal.attendance)

  // 1. 显式业务码优先：工具已经明确说了原因，不再靠文本猜
  let reason = parseTakeoverError(signal.errorCode)

  // 2. 错误码 → 原因映射
  if (!reason && signal.errorCode) {
    reason = ERROR_CODE_REASONS[signal.errorCode.toLowerCase()] ?? null
  }

  // 3. 候选方案足够多本身就是决策信号
  if (!reason && signal.options && signal.options.length >= 2) {
    reason = 'decision'
  }

  // 4. 文本判定
  if (!reason && signal.text) {
    reason = scoreReasons(signal.text.toLowerCase())
  }

  if (!reason) {
    return { needed: false, attendance, shouldAwait: false }
  }

  const shouldAwait = shouldAwaitTakeover(attendance)
  return {
    needed: true,
    reason,
    request: buildRequest(reason, signal, attendance),
    attendance,
    shouldAwait,
    // 无人值守时直接按 skipped 收尾：让上游立刻拿到「需要人工」的结论，
    // 而不是停在一个永远没人回应的等待上
    skipNote: shouldAwait ? undefined : `需人工处理：${TAKEOVER_REASON_LABEL[reason]}`,
  }
}
