/**
 * 后台命令登记表
 *
 * 耗时命令（安装 / 构建 / 测试 / 系统装包）不再让 AI 干等：命令转入终端后台执行，
 * run_command 立刻返回终端 ID，AI 可以继续做别的事，之后用 read_terminal_output 取结果。
 *
 * 这一层解决的问题是「不要忘记」：
 * - 命令还在跑、或者跑完了但 AI 还没看过结果，都算「有未结算的命令」；
 * - 主循环每轮请求前据此注入一条提醒，AI 就不会把后台命令遗忘到会话结束；
 * - read_terminal_output 从同一份登记表取状态（running / completed / failed + 退出码），
 *   取完置 reported，提醒随之停止，不会无限重复。
 *
 * 这里只存内存状态：命令进程本身归 TerminalManager 管，会话结束/终端关闭即失效。
 */

/** 后台命令的结算状态（与 TerminalCommandStatus 对齐，只保留对 AI 有意义的部分） */
export type BackgroundCommandStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted'
  | 'shell_exited'

export interface BackgroundCommandRecord {
  /** 登记键：一个终端同一时刻只跑一条被登记的命令，用终端 ID 即可 */
  key: string
  terminalId: string
  command: string
  cwd?: string
  /** 发起命令的会话线程，用于按会话过滤提醒 */
  threadId?: string
  startedAt: number
  finishedAt?: number
  status: BackgroundCommandStatus
  exitCode: number | null
  /** 末尾输出片段，供提醒里给出「跑到哪一步了」的线索 */
  outputTail: string
  /** 结果是否已经通过 read_terminal_output 交给模型 */
  reported: boolean
}

/**
 * 把终端层的命令状态映射成后台命令状态
 *
 * 两套状态不完全重合：终端层有 queued / detached，后台登记表只关心
 * 「还在跑 / 跑完 / 挂了」这三种对 AI 有决策意义的状态，因此这里做一次收敛。
 */
export function toBackgroundStatus(status: string): BackgroundCommandStatus {
  switch (status) {
    case 'running':
    case 'queued':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'timed_out':
      return 'timed_out'
    case 'cancelled':
      return 'cancelled'
    case 'interrupted':
      return 'interrupted'
    case 'shell_exited':
      return 'shell_exited'
    // detached 表示进程仍在后台运行，对 AI 而言就是「还没结束」
    case 'detached':
      return 'running'
    default:
      return 'failed'
  }
}

/** 登记表上限：只保留最近若干条，避免长会话里无限增长 */
const MAX_RECORDS = 24

const records = new Map<string, BackgroundCommandRecord>()

/** 登记一条刚转入后台的命令 */
export function registerBackgroundCommand(record: BackgroundCommandRecord): void {
  records.set(record.key, record)
  if (records.size <= MAX_RECORDS) return
  // 超限时优先淘汰「已结算且已上报」的最旧记录
  const removable = [...records.values()]
    .filter((item) => item.status !== 'running' && item.reported)
    .sort((a, b) => a.startedAt - b.startedAt)
  while (records.size > MAX_RECORDS && removable.length > 0) {
    const oldest = removable.shift()
    if (oldest) records.delete(oldest.key)
  }
}

/** 后台命令执行结束：按终端 ID 找到登记项并落状态 */
export function completeBackgroundCommand(
  terminalId: string,
  patch: Pick<BackgroundCommandRecord, 'status' | 'exitCode'> & { outputTail?: string },
): void {
  const record = records.get(terminalId)
  if (!record) return
  record.status = patch.status
  record.exitCode = patch.exitCode
  record.finishedAt = Date.now()
  if (patch.outputTail !== undefined) record.outputTail = patch.outputTail
}

/** 按终端 ID 取登记项 */
export function getBackgroundCommand(terminalId: string): BackgroundCommandRecord | undefined {
  return records.get(terminalId)
}

/** 标记结果已交给模型（不再提醒） */
export function markBackgroundCommandReported(terminalId: string): void {
  const record = records.get(terminalId)
  if (record) record.reported = true
}

/**
 * 仍在运行的后台命令，同一终端多久之内不重复提醒
 *
 * 运行中的命令每轮都提醒会白白占用上下文；但完全不提醒又会让 AI 把它忘掉。
 * 90 秒是个折中：比一次典型工具轮次长，又不至于让用户等太久才被催一次。
 */
const RUNNING_REMIND_INTERVAL_MS = 90_000

/** 每个终端最近一次被提醒的时刻，仅用于上面的节流 */
const lastRemindedAt = new Map<string, number>()

/**
 * 仍需 AI 关注的后台命令
 *
 * 两类都要提醒：还在跑的（别忘），以及已结束但还没看过结果的（去读一眼，别重复执行）。
 * 只看当前会话，避免把别的会话的命令算进这一轮。
 *
 * 已结束未读的命令每次都会返回（这是必须闭环的事）；仍在运行的命令按
 * RUNNING_REMIND_INTERVAL_MS 节流，避免每轮刷屏。
 */
export function listBackgroundCommandsNeedingAttention(threadId?: string): BackgroundCommandRecord[] {
  const now = Date.now()
  const result: BackgroundCommandRecord[] = []

  for (const record of records.values()) {
    if (record.reported) continue
    if (threadId && record.threadId && record.threadId !== threadId) continue

    if (record.status !== 'running') {
      result.push(record)
      continue
    }

    const last = lastRemindedAt.get(record.key) ?? 0
    if (now - last < RUNNING_REMIND_INTERVAL_MS) continue
    lastRemindedAt.set(record.key, now)
    result.push(record)
  }

  return result
}

/** 会话结束/终端关闭时清理，避免留下永远不会结算的记录 */
export function clearBackgroundCommandsForThread(threadId: string): void {
  for (const [key, record] of records) {
    if (record.threadId === threadId) records.delete(key)
  }
}

/** 测试与诊断用：清空全部登记 */
export function resetBackgroundCommands(): void {
  records.clear()
}
