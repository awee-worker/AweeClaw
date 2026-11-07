/**
 * 设备任务协作协议
 *
 * 移动端遥控桌面端执行任务时，两端需要就「执行到一半出现岔子」达成同一套说法：
 *
 * - 接管（Takeover）：登录、验证码、风控拦截、付款确认、需要人做选择这五类事，
 *   是正常结局而不是失败。桌面端发起，用户在 PC 上处理完，任务从原地续跑。
 * - 补充说明（Steer）：任务执行中用户补一句话改变做法，由桌面端在工具边界取走。
 * - 执行画面（TaskFrame）：任务运行时的画面帧，只给用户看，不进模型上下文。
 *
 * 与 taskContract 的分工：那份是「本次任务允许做什么」的边界声明；
 * 这份是「两端怎么对话」的消息契约。两者不共享类型，避免职责混淆。
 *
 * @module protocols/deviceTaskProtocol
 */

/* ------------------------------------------------------------------ */
/* 接管                                                                */
/* ------------------------------------------------------------------ */

/**
 * 接管原因
 *
 * 收敛成固定枚举而不是自由文案，是为了能统计：哪类接管最多、
 * 哪类接管其实暴露了产品缺陷（例如 login 占比过高说明会话保持有问题）。
 */
export type TakeoverReason =
  /** 需要登录 */
  | 'login'
  /** 验证码 / 人机校验 */
  | 'captcha'
  /** 风控拦截、页面读不出内容 */
  | 'access_blocked'
  /** 付款确认 */
  | 'payment'
  /** 需要人在多个方案里选 */
  | 'decision'
  /** 其他需要人处理的情况 */
  | 'other'

/** 接管的处置结局 */
export type TakeoverOutcome =
  /** 用户处理完，核实通过后继续 */
  | 'resolved'
  /** 用户选择跳过，能绕开就继续 */
  | 'skipped'
  /** 超时未响应。任务保持等待态，用户回来仍可继续 */
  | 'timeout'
  /** 用户主动放弃本次任务 */
  | 'aborted'

/** 接管请求：桌面端 → 移动端 */
export interface TakeoverRequest {
  reason: TakeoverReason
  /** 给用户看的一句话，说明现在卡在哪 */
  message: string
  /** 付款对象（reason=payment 时填） */
  item?: string
  /** 金额（reason=payment 时填） */
  amount?: string
  /** 收货或付款地址（reason=payment 时填） */
  address?: string
  /** 候选方案（reason=decision 时填） */
  options?: string[]
  /** 超时时间戳（ms）。缺省由服务端按 attendance 决定 */
  expiresAt?: number
}

/* ------------------------------------------------------------------ */
/* 运行来源与人在场与否                                                */
/* ------------------------------------------------------------------ */

/**
 * 谁发起了这次运行
 *
 * 接管要求「请人到 PC 上处理一下」，可任务不一定来自守在电脑前的人。
 * 定时触发的任务可能整夜无人，此时发起接管只会把任务挂死。
 */
export type RunOrigin =
  /** 用户在桌面客户端界面里直接发起 */
  | 'ui'
  /** 移动端或渠道（飞书/微信等）下发 */
  | 'channel'
  /** 定时任务触发 */
  | 'trigger'
  /** MCP 调用 */
  | 'mcp'
  /** 子 Agent 委派 */
  | 'child'

/** 用户能否及时处理提问或确认 */
export type Attendance =
  /** 就在客户端前 */
  | 'present'
  /** 能收到推送，但不一定马上看 */
  | 'reachable'
  /** 无人值守 */
  | 'unattended'

/** 按来源推断到场情况；调用方显式声明时以声明为准 */
export function resolveAttendance(origin: RunOrigin, declared?: Attendance): Attendance {
  if (declared) return declared
  switch (origin) {
    case 'ui':
      return 'present'
    case 'channel':
      return 'reachable'
    case 'trigger':
      return 'unattended'
    case 'mcp':
    case 'child':
      // 调用方没声明时按无人值守处理：宁可让调用方立刻拿到「需要人工」的结论，
      // 也不能让上游阻塞在一个永远不会有人回应的等待上。
      return 'unattended'
  }
}

/**
 * 该不该真的发起接管
 *
 * 只有能被人及时处理时才等。无人值守时直接按 skipped 收尾，
 * 把「需人工处理：<原因>」写进结果，而不是让任务停在等待态——
 * 用户看到「任务莫名停了」远比看到「需要你处理」糟糕。
 */
export function shouldAwaitTakeover(attendance: Attendance): boolean {
  return attendance !== 'unattended'
}

/** 接管超时上限（ms）。能收到推送但人不在眼前的场景，等太久没有意义 */
const TAKEOVER_TIMEOUT_PRESENT_MS = 10 * 60 * 1000
const TAKEOVER_TIMEOUT_REACHABLE_MS = 5 * 60 * 1000

/** 按到场情况给出接管超时；无人值守不发起接管，返回 0 */
export function takeoverTimeoutMs(attendance: Attendance): number {
  if (attendance === 'present') return TAKEOVER_TIMEOUT_PRESENT_MS
  if (attendance === 'reachable') return TAKEOVER_TIMEOUT_REACHABLE_MS
  return 0
}

/* ------------------------------------------------------------------ */
/* 执行画面                                                            */
/* ------------------------------------------------------------------ */

/**
 * 执行画面帧：桌面端 → 移动端
 *
 * 帧只对"此刻在看"的用户有意义，所以后端不做持久化；
 * 事后回放走任务产物，不靠这些帧。
 */
export interface TaskFrame {
  /** 对应移动端任务的 taskId */
  taskId: string
  /** 严格递增，用于判断是否丢帧 */
  seq: number
  ts: number
  width: number
  height: number
  format: 'jpeg'
  /** base64。超过单帧上限时由发送侧降质量，不在此处切分片 */
  data: string
  /** 相对上一帧画面是否变化 */
  changed: boolean
}

/** 单帧数据上限（字节）。超出时发送侧应降采样或降质量，而不是丢帧 */
export const TASK_FRAME_MAX_BYTES = 200 * 1024

/** 采集节流：最小间隔与静默补帧间隔（ms） */
export const TASK_FRAME_MIN_INTERVAL_MS = 800
export const TASK_FRAME_HEARTBEAT_MS = 5000

/* ------------------------------------------------------------------ */
/* 执行中补充说明                                                      */
/* ------------------------------------------------------------------ */

/** 补充说明的采纳状态 */
export type SteerStatus =
  /** 已发出，桌面端尚未取走 */
  | 'pending'
  /** 桌面端已取走并注入 */
  | 'adopted'
  /** 任务已结束，未生效 */
  | 'expired'

/** 补充说明：移动端 → 桌面端 */
export interface SteerRequest {
  taskId: string
  steerId: string
  text: string
}

/** 补充说明被取走的回执：桌面端 → 移动端 */
export interface SteerAdopted {
  taskId: string
  steerId: string
  at: number
}

/** 补充说明上限：单条字数与单任务条数 */
export const STEER_MAX_LENGTH = 500
export const STEER_MAX_PER_TASK = 20

/** 发出后可撤回的时间窗口（ms）。取走后不可撤回 */
export const STEER_REVOKE_WINDOW_MS = 10 * 1000

/* ------------------------------------------------------------------ */
/* 事件类型                                                            */
/* ------------------------------------------------------------------ */

/** 桌面端 → 移动端的事件类型 */
export const DEVICE_TO_MOBILE_EVENTS = {
  taskFrame: 'task-frame',
  taskTakeover: 'task-takeover',
  taskSteerAdopted: 'task-steer-adopted',
} as const

/** 移动端 → 桌面端的请求类型 */
export const MOBILE_TO_DEVICE_REQUESTS = {
  steer: 'steer',
  takeoverResolve: 'takeover-resolve',
} as const

/** 接管处置请求：移动端 → 桌面端 */
export interface TakeoverResolve {
  taskId: string
  outcome: Exclude<TakeoverOutcome, 'timeout'>
  /** 用户补充说明（可选），例如「已登录」「换第二个方案」 */
  note?: string
}
