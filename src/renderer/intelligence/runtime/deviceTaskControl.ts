/**
 * 任务协作通道（renderer 侧）
 *
 * 把主进程的设备联动通道包装成执行层能直接用的三个动作：
 *
 * 1. 接管：上报 → 等处置 → 重新核实 → 续跑 / 再发起（最多 3 次）
 * 2. 补充说明：在工具批次边界取走并格式化成一段用户插话
 * 3. 执行画面：按任务开关采集
 *
 * 这一层只做协议转换与流程拼接，判定与重试策略分别在
 * takeoverClassifier / takeoverCoordinator 里，避免同一套规则写两遍。
 *
 * 通道不可用（纯 Web 预览、主进程未初始化）时全部降级为「什么也不做」：
 * 这些能力只在桌面客户端 + 已登录设备联动时才有意义。
 *
 * @module intelligence/runtime/deviceTaskControl
 */
import type {
  TakeoverOutcome,
  TakeoverRequest,
} from '@shared/protocols/deviceTaskProtocol'
import {
  runTakeoverLoop,
  takeoverTracker,
  type TakeoverLoopDeps,
  type TakeoverLoopResult,
} from '@intelligence/decision/takeoverCoordinator'
import { classifyTakeover, type TakeoverSignal } from '@intelligence/decision/takeoverClassifier'

type DeviceLinkApi = Window['electronAPI']['deviceLink']

/**
 * 任务 id 对照表（本地 requestId → 服务端 taskId）
 *
 * 移动端发起的补充说明与接管处置都按服务端 taskId 归属，而桌面端在执行层手里
 * 先拿到的是自己这次下发用的 requestId。后端已在 command.req 里带上 taskId，
 * 但连接旧版本后端时没有该字段，所以两套 id 都要认：
 * 拿到服务端 id 就登记一条对照，后续调用方传哪一个都能落到同一个队列。
 *
 * 只在 renderer 内存里存，任务结束即删；它只是 id 换算，不是状态。
 */
const taskIdBindings = new Map<string, string>()

/** 登记 requestId → taskId；任一为空则忽略（不猜） */
export function bindTaskId(localId: string, serverTaskId: string | undefined): void {
  const local = (localId || '').trim()
  const server = (serverTaskId || '').trim()
  if (!local || !server || local === server) return
  taskIdBindings.set(local, server)
}

/** 取消登记（任务收尾时调用） */
export function unbindTaskId(localId: string): void {
  taskIdBindings.delete(localId)
}

/**
 * 解析成服务端 taskId
 *
 * 传进来的已经是服务端 id（移动端链路）时原样返回；传本地 requestId 时按对照表换算；
 * 对照表里没有就原样返回——宁可让队列空着，也不要凭空拼一个 id。
 */
export function resolveTaskId(id: string): string {
  const key = (id || '').trim()
  if (!key) return ''
  return taskIdBindings.get(key) ?? key
}

/** 通道是否可用 */
export function isDeviceTaskControlAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.deviceLink
}

function api(): DeviceLinkApi | null {
  if (!isDeviceTaskControlAvailable()) return null
  return window.electronAPI.deviceLink
}

/** 上报接管请求（桌面端 → 移动端） */
export async function reportTakeover(
  taskId: string,
  request: TakeoverRequest,
): Promise<boolean> {
  const link = api()
  if (!link) return false
  const id = resolveTaskId(taskId)
  if (!id) return false
  try {
    return await link.reportTakeover(id, request)
  } catch {
    return false
  }
}

/**
 * 在工具批次边界取走补充说明
 *
 * 取走即视为已注入：主进程会逐条回执 adopted。
 * 传服务端 taskId 或本地 requestId 都可以，内部按对照表换算。
 */
export async function drainSteers(taskId: string): Promise<string[]> {
  const link = api()
  if (!link) return []
  const id = resolveTaskId(taskId)
  if (!id) return []
  try {
    const steers = await link.consumeSteers(id)
    return steers.map((s) => s.text).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 把补充说明拼成交给模型的一段插话
 *
 * 保持「这是用户在执行中补的话」这一语义：模型需要知道它来自用户，
 * 且优先级高于此前的计划，否则会把它当成普通背景信息忽略掉。
 *
 * 只说「请据此调整」是不够的：这条消息会紧跟在工具结果后面到达，
 * 模型此时的注意力仍在「把这一批工具跑完」，很容易把它当成旁注。
 * 因此这里显式给出优先级、要求先复述再执行，并点名两个常见失效动作
 * （拖到回复末尾提一句、因为任务进行中就跳过）。
 */
export function buildSteerInstruction(texts: string[], language: 'zh' | 'en' = 'zh'): string {
  const list = texts.map((t) => t.trim()).filter(Boolean)
  if (list.length === 0) return ''
  const body = list.map((t, i) => `${i + 1}. ${t}`).join('\n')

  if (language === 'en') {
    return [
      '### Steering message from the user (sent while you were running)',
      body,
      '',
      '### How to apply it',
      'This message has higher priority than the plan you stated earlier. Before your next step:',
      '1. Start your reply with one short line stating what you understood and how the plan changes.',
      '2. Follow it from now on; drop the part of the old plan it contradicts instead of finishing both.',
      '3. Do not save it for the end of your reply, and do not skip it because the task is already underway.',
    ].join('\n')
  }

  return [
    '### 用户在你执行期间补充的说明',
    body,
    '',
    '### 处理要求',
    '这条说明的优先级高于你之前声明的计划。在下一步之前：',
    '1. 回复开头先用一句话说明你收到了什么、接下来怎么调整；',
    '2. 从此按这条说明执行，与它冲突的旧计划直接放弃，不要两套都做完；',
    '3. 不要等到回复末尾才顺带一提，也不要因为任务已经在进行中就跳过它。',
  ].join('\n')
}

/** 等待一次接管处置；超时返回 outcome='timeout' */
export async function awaitTakeoverResolve(
  taskId: string,
  timeoutMs: number,
): Promise<{ outcome: TakeoverOutcome; note?: string }> {
  const link = api()
  if (!link) return { outcome: 'timeout' }
  const id = resolveTaskId(taskId)
  if (!id) return { outcome: 'timeout' }

  // 先取一次缓冲：处置可能在监听注册之前就到了
  try {
    const buffered = await link.takeTakeoverResolve(id)
    if (buffered) return { outcome: buffered.outcome, note: buffered.note }
  } catch {
    // 忽略，继续走订阅
  }

  // 等待窗口已经过期（例如 expiresAt 已过）：直接按超时收尾，
  // 否则会挂在一个永远不会被触发的计时器上，把任务卡死
  if (timeoutMs <= 0) return { outcome: 'timeout' }

  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (outcome: TakeoverOutcome, note?: string) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      unsubscribe?.()
      resolve({ outcome, note })
    }

    unsubscribe = link.onTaskControl((payload) => {
      if (payload.kind !== 'takeover-resolve' || payload.taskId !== id) return
      const incoming = payload.resolve
      if (!incoming) return
      finish(incoming.outcome, incoming.note)
    })

    if (timeoutMs > 0) {
      timer = setTimeout(() => finish('timeout'), timeoutMs)
    }
  })
}


/** 任务结束：清掉队列与残留处置，并停掉画面采集 */
export async function clearTaskControl(taskId: string): Promise<void> {
  const link = api()
  if (!link) return
  const id = resolveTaskId(taskId)
  if (!id) return
  try {
    await link.clearTaskControl(id)
    await link.setFrameStream(id, 'stop')
  } catch {
    // 清理失败不影响任务收尾
  }
  // 对照表最后清：上面两个调用还要靠它把本地 requestId 换成服务端 id
  unbindTaskId(taskId)
}

/** 开关执行画面采集 */
export async function setFrameStream(
  taskId: string,
  action: 'start' | 'stop',
): Promise<boolean> {
  const link = api()
  if (!link) return false
  const id = resolveTaskId(taskId)
  if (!id) return false
  try {
    const result = await link.setFrameStream(id, action)
    return result.ok
  } catch {
    return false
  }
}


/**
 * 为某个任务创建一次接管闭环
 *
 * @param taskOrRequestId 任务 id：服务端 taskId，或本地下发时的 requestId
 *                        （内部按对照表换算，换算不到就原样使用）
 * @param verify 重新核实界面状态：读一次页面 / 截图比对，确认拦截已消失
 * @param resolveSignal 可选的信号刷新：核实失败重发接管前重新采一次信号，
 *                      避免第二次上报的还是第一次看到的旧页面
 */
export function createTakeoverSession(
  taskOrRequestId: string,
  verify: () => Promise<boolean>,
  resolveSignal?: () => Promise<TakeoverSignal>,
): {
  run: (signal: TakeoverSignal) => Promise<TakeoverLoopResult>
  record: () => ReturnType<typeof takeoverTracker.get>
} {
  // 一次换算，之后全程用同一个 id：上报、等待、统计落到的必须是同一条任务
  const taskId = resolveTaskId(taskOrRequestId) || taskOrRequestId
  const deps: TakeoverLoopDeps = {
    classify: (signal) => classifyTakeover(signal),
    request: async (request) => {
      await reportTakeover(taskId, request)
    },
    awaitResolve: (timeoutMs) => awaitTakeoverResolve(taskId, timeoutMs),
    verify: async () => {
      if (resolveSignal) {
        const fresh = await resolveSignal()
        const decision = classifyTakeover(fresh)
        // 重新判一次：拦截若已消失，这里就不会再判出接管
        if (decision.needed) return false
      }
      return verify()
    },
    onAttempt: (attempt, reason) => {
      takeoverTracker.record(taskId, { status: 'continued', attempts: attempt, reason })
    },
  }

  return {
    run: async (signal: TakeoverSignal) => {
      const result = await runTakeoverLoop(signal, deps)
      takeoverTracker.record(taskId, result)
      return result
    },
    record: () => takeoverTracker.get(taskId),
  }
}
