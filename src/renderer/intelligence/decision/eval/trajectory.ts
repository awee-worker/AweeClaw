/**
 * 轨迹级指标抽取
 *
 * 职责：从真实执行记录中抽取过程指标，弥补现有离线代理指标只看「决策结果」、
 * 不看「执行过程」的缺口。
 *
 * 与 metrics.ts 的分工：
 * - metrics.ts 回答「决策对不对」（工具是否漏选、命令是否误判）
 * - 本模块回答「过程顺不顺」（绕了多少弯路、压缩触发了几次、第几步才出结果）
 *
 * 数据来源：
 * - 工具调用序列（同工具同参数重复即视为无效重试）
 * - 循环检测拦截记录（CycleDetector / LoopDetector 的判定结果）
 * - 上下文压缩事件（ContextCompressor 的压缩等级与触发时机）
 *
 * 本模块为纯函数，只做抽取与算术，不触达执行链路。
 */

/** 轨迹中的一次工具调用 */
export interface TrajectoryStep {
  /** 步序，从 1 开始 */
  index: number
  /** 工具名 */
  toolName: string
  /**
   * 参数签名
   *
   * 只用于判定「是否与上一步完全重复」，不需要可读性，
   * 调用方可用 JSON 序列化或哈希生成。
   */
  argsSignature: string
  /** 该步是否被循环检测拦截（工具未实际执行） */
  loopDetected?: boolean
  /** 该步是否产出了推进任务的结果 */
  useful?: boolean
}

/** 一次上下文压缩事件 */
export interface CompressionEvent {
  /** 压缩等级（0-4，见 compressionUtils 的 CompressionLevel） */
  level: number
  /** 触发时刻（毫秒时间戳） */
  at: number
}

/** 轨迹抽取的输入 */
export interface TrajectoryInput {
  /** 工具调用序列（按执行顺序） */
  steps: TrajectoryStep[]
  /** 压缩事件（缺省视为无压缩） */
  compressionEvents?: CompressionEvent[]
}

/** 轨迹级指标 */
export interface TrajectoryMetrics {
  /** 工具调用总步数 */
  totalSteps: number
  /** 无效重试次数（同工具同参数重复的额外次数） */
  futileRetries: number
  /** 循环检出次数 */
  loopDetections: number
  /** 压缩触发次数与级别分布 */
  compressionEvents: CompressionEvent[]
  /** 首次产出可用结果的步序，无则 null */
  firstUsefulStep: number | null
  /** 无效重试占总步数的比例（0~1） */
  futileRetryRatio: number
}

/**
 * 抽取轨迹指标
 *
 * 判定口径：
 * - 无效重试：相邻两步工具名与参数签名完全一致，且前一步未产出可用结果。
 *   只在「前一步没用」的前提下重复才算无效，避免把「先读后写同一路径」这类
 *   参数相同但语义不同的序列误判为绕路。
 * - 循环检出：步上标记了 loopDetected 的数量。
 * - 首次可用步序：第一个 useful 为真的步。
 */
export function extractTrajectoryMetrics(input: TrajectoryInput): TrajectoryMetrics {
  const steps = input.steps
  const compressionEvents = input.compressionEvents ?? []

  let futileRetries = 0
  let loopDetections = 0
  let firstUsefulStep: number | null = null

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    if (step.loopDetected) loopDetections++

    if (firstUsefulStep === null && step.useful) {
      firstUsefulStep = step.index
    }

    const previous = i > 0 ? steps[i - 1] : null
    if (
      previous &&
      !previous.useful &&
      previous.toolName === step.toolName &&
      previous.argsSignature === step.argsSignature
    ) {
      futileRetries++
    }
  }

  const totalSteps = steps.length

  return {
    totalSteps,
    futileRetries,
    loopDetections,
    compressionEvents,
    firstUsefulStep,
    futileRetryRatio: totalSteps > 0 ? round4(futileRetries / totalSteps) : 0,
  }
}

/**
 * 从工具结果消息序列抽取轨迹步骤
 *
 * 只依赖最小结构（工具名 + 参数），不绑定具体消息类型，
 * 便于在会话历史、子代理记录、回放数据上复用同一套抽取逻辑。
 */
export function collectTrajectorySteps(
  messages: Array<{ name: string; arguments?: Record<string, unknown>; isError?: boolean }>,
): TrajectoryStep[] {
  const steps: TrajectoryStep[] = []

  for (const message of messages) {
    steps.push({
      index: steps.length + 1,
      toolName: message.name,
      argsSignature: signatureOf(message.arguments),
      useful: message.isError !== true,
    })
  }

  return steps
}

/** 参数签名：键排序后序列化，保证同参不同键序得到同一签名 */
export function signatureOf(args?: Record<string, unknown>): string {
  if (!args) return ''
  const keys = Object.keys(args).sort()
  return JSON.stringify(keys.map((key) => [key, args[key]]))
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
