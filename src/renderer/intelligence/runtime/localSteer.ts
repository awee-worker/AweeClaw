/**
 * 本地插话队列（renderer 内存）
 *
 * 用户在 AI 正在跑的时候补一句话，希望它影响「接下来的做法」而不是另起一轮。
 * 直接在运行中再发一条消息是不行的：执行锁会把它挡回去（Thread already running）。
 *
 * 移动端那条链路走的是主进程 TaskControlHub（服务端 taskId 归属、跨网络去重、
 * 取走回执），本地会话没有 taskId，也不跨进程，把它的 key 放宽只会让设备联动的
 * 语义变形。因此本地会话单开一个内存队列，按 threadId 归属。
 *
 * 生命周期与一次运行绑死：
 * - 入队：用户在运行中提交
 * - 取走：loopDetector 在工具批次边界 / 收尾接缝取空
 * - 清空：用户点停止时丢弃尚未取走的内容
 *
 * 停止必须清空，否则「我喊停之后补的那句话」会在下一轮凭空生效 —— 那已经不是
 * 插话，而是被篡改的新指令。
 *
 * @module intelligence/runtime/localSteer
 */
import { STEER_MAX_LENGTH, STEER_MAX_PER_TASK } from '@shared/protocols/deviceTaskProtocol'

/**
 * 入队时不写会话气泡
 *
 * 气泡一旦落进消息列表就脱离了队列的生命周期，而插话真正该出现的位置是「被采纳
 * 的那一刻」。等待期由输入区上方的待生效条展示，生效时由执行层把内容就地嵌进
 * 助手消息（user_steer part）。因此这里只保存文本。
 */

/** 一条待取走的插话 */
interface LocalSteerEntry {
  text: string
}

/** threadId → 待取走的插话（先进先出） */
const pending = new Map<string, LocalSteerEntry[]>()

/**
 * 待生效条数的订阅者
 *
 * 队列在执行层（非 React）被增删，界面无从得知何时该收起待生效条，因此在这几处
 * 统一广播。快照取条数而非数组：useSyncExternalStore 要求同一状态下返回稳定值，
 * 数值天然满足。
 */
const listeners = new Set<() => void>()

function notifyChange(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 单个订阅者出错不该影响其余订阅者，更不该影响队列本身
    }
  }
}

/** 订阅待生效条数变化 */
export function subscribeLocalSteer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 入队结果：拒绝原因交给调用方决定怎么提示 */
export type LocalSteerResult =
  | { accepted: true; queued: number }
  | { accepted: false; reason: 'empty' | 'too_long' | 'duplicate' | 'full' }

/**
 * 插入一条插话
 *
 * 只与队尾比对去重：连点两下按钮是误触，但同一句话过一会儿再说一次是有意义的
 * 补充，不能按内容全局去重。
 */
export function enqueueLocalSteer(threadId: string, rawText: string): LocalSteerResult {
  const id = (threadId || '').trim()
  const text = (rawText || '').trim()
  if (!id || !text) return { accepted: false, reason: 'empty' }
  if (text.length > STEER_MAX_LENGTH) return { accepted: false, reason: 'too_long' }

  const queue = pending.get(id) ?? []
  if (queue[queue.length - 1]?.text === text) return { accepted: false, reason: 'duplicate' }
  if (queue.length >= STEER_MAX_PER_TASK) return { accepted: false, reason: 'full' }

  queue.push({ text })
  pending.set(id, queue)
  notifyChange()
  return { accepted: true, queued: queue.length }
}

/**
 * 取走并清空：取走即视为已注入，不允许重复注入。气泡留着（它已经生效）
 */
export function drainLocalSteers(threadId: string): string[] {
  const id = (threadId || '').trim()
  if (!id) return []
  const queue = pending.get(id)
  if (!queue || queue.length === 0) return []
  pending.delete(id)
  notifyChange()
  return queue.map((entry) => entry.text)
}

/**
 * 丢弃尚未取走的内容，返回丢弃条数
 *
 * 与 drain 的区别只在「有没有生效」：取走的插话已经进过模型上下文，会话里留下的
 * 卡片该留着；这里丢掉的是从未被读到的，调用方无需回收任何消息 —— 入队时本来
 * 就没有写过气泡。
 */
export function discardLocalSteers(threadId: string): number {
  const id = (threadId || '').trim()
  if (!id) return 0
  const queue = pending.get(id)
  if (!queue || queue.length === 0) return 0
  pending.delete(id)
  notifyChange()
  return queue.length
}

/** 当前待处理条数（供状态展示） */
export function pendingLocalSteerCount(threadId: string): number {
  const id = (threadId || '').trim()
  if (!id) return 0
  return pending.get(id)?.length ?? 0
}
