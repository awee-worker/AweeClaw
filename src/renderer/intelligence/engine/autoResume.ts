import { logger } from '@toolkit/LogEngine'

/**
 * 异常中断自动续接（跨执行路径共享）
 *
 * 背景：AI 因「非用户意愿」的异常中断（工具编排抛错、上下文压缩失败、模型错误、
 * 输出被截断等）时，此前的表现是「AI 无提示停下」——既不收尾也没有续接入口，
 * 用户以为 AI 挂了，只能手动重发。
 *
 * 本模块统一提供三件事，供单 Agent 主循环（loopDetector）与多 Agent 协作
 * （MultiAgentExecution）共用，避免两条路径行为不一致：
 * 1. 受执行锁保护的续接消息派发（避免 "Thread already running" 静默失败）
 * 2. 异常中断自动续接次数上限（防止「中断 → 续接 → 再中断」无限循环烧额度）
 * 3. 自由模式连续自动轮次上限（防止主循环异常未收尾时无限自动续接）
 */

/* ------------------------------------------------------------------ */
/* 异常中断自动续接                                                   */
/* ------------------------------------------------------------------ */

/**
 * 异常中断后的自动续接计数（按线程）。
 * AI 因非用户意愿的异常中断时自动派发续接消息，避免用户看到"AI 无提示停下"；
 * 限制次数以防止"中断 → 续接 → 再中断"的无限循环。
 */
const autoResumeCounters = new Map<string, number>()
export const MAX_AUTO_RESUME = 2

/** 清除某线程的自动续接计数（任务正常完成或被用户主动中止时调用） */
export function resetAutoResumeCounter(threadId: string): void {
  autoResumeCounters.delete(threadId)
}

/** 续接消息内容（用户可见的短衔接语，重新驱动 AI 继续未完成任务） */
export const AUTO_RESUME_MESSAGE = '继续执行未完成的任务'

/**
 * 受执行锁保护的续接派发：轮询直到线程执行锁释放后再派发。
 *
 * 直接 setTimeout 固定延时（如 800ms）存在竞态——若 cleanupTask 尚未释放执行锁，
 * Agent.send 会抛 "Thread already running" 且事件派发是 fire-and-forget，无人捕获，
 * 表现为「续接静默失败、AI 仍然没有继续」。改为轮询 isRunning 直到锁释放。
 */
export async function dispatchContinuation(threadId: string, attempt = 0): Promise<void> {
  if (typeof window === 'undefined') return
  const MAX_WAIT_ATTEMPTS = 20 // 300ms × 20 ≈ 6s 上限
  try {
    const { Agent } = await import('./IntelligenceCore')
    if (Agent.isRunning(threadId) && attempt < MAX_WAIT_ATTEMPTS) {
      window.setTimeout(() => { void dispatchContinuation(threadId, attempt + 1) }, 300)
      return
    }
  } catch {
    // 动态导入失败（如模块循环/加载异常）时退化为立即派发，保证续接至少被尝试一次
    logger.agent.warn('[Loop] dispatchContinuation: failed to check execution lock, dispatching directly')
  }
  // 携带 threadId 定向派发：续接必须回到「被中断的那个线程」，
  // 否则用户切到其它线程后，续接消息会发到当前线程（错误目标）；
  // silent: 自动续接属于系统行为，不应显示成用户气泡。
  window.dispatchEvent(new CustomEvent('chat-send-message', {
    detail: { content: AUTO_RESUME_MESSAGE, messageId: '', threadId, silent: true },
  }))
}

/** 记录一次自动续接并派发续接消息（复用前端 chat-send-message 通道） */
export function scheduleAutoResume(threadId: string, reason: string): void {
  if (typeof window === 'undefined') return
  const next = (autoResumeCounters.get(threadId) ?? 0) + 1
  // ⚠️ 强制上限：此前仅在日志里显示 (n/MAX)，从未真正拦截，
  //    一旦出现「中断 → 续接 → 再中断」会无限循环、持续消耗额度。
  if (next > MAX_AUTO_RESUME) {
    logger.agent.warn(`[Loop] Auto-resume limit reached (${MAX_AUTO_RESUME}), skip. thread=${threadId}`)
    return
  }
  autoResumeCounters.set(threadId, next)
  logger.agent.info(`[Loop] Auto-resume after ${reason} (${next}/${MAX_AUTO_RESUME}) thread=${threadId}`)
  void dispatchContinuation(threadId)
}

/* ------------------------------------------------------------------ */
/* 自由模式连续自动轮次上限                                           */
/* ------------------------------------------------------------------ */

/**
 * 自由模式下的「连续自动轮次」计数（按线程）。
 *
 * 自由模式（freeModeEnabled）在主循环未正常收尾（loopState 仍为 running）时
 * 直接派发续接消息，与异常中断不同——这是正常路径，因此不消耗
 * autoResumeCounters 预算。但若 AI 连续多轮都不收尾（任务本身发散/死循环），
 * 就会无限自动续接、持续消耗额度与时间。这里给它一个远高于正常任务的硬上限兜底。
 */
const freeModeRoundCounters = new Map<string, number>()
export const MAX_FREE_MODE_ROUNDS = 20

/** 清除某线程的自由模式连续轮次计数（任务收尾/用户中止时调用） */
export function resetFreeModeRounds(threadId: string): void {
  freeModeRoundCounters.delete(threadId)
}

/**
 * 记录一轮自由模式自动续接并派发。
 *
 * @returns true 表示已派发续接；false 表示已达连续轮次上限、已停止自动续接
 *          （调用方应给出用户可见提示，交还控制权）
 */
export function scheduleFreeModeContinuation(threadId: string): boolean {
  if (typeof window === 'undefined') return false
  const next = (freeModeRoundCounters.get(threadId) ?? 0) + 1
  if (next > MAX_FREE_MODE_ROUNDS) {
    logger.agent.warn(`[Loop] Free-mode auto-continue cap reached (${MAX_FREE_MODE_ROUNDS}), pause. thread=${threadId}`)
    return false
  }
  freeModeRoundCounters.set(threadId, next)
  logger.agent.info(`[Loop] Free-mode auto-continue (${next}/${MAX_FREE_MODE_ROUNDS}) thread=${threadId}`)
  void dispatchContinuation(threadId)
  return true
}
