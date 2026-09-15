/**
 * 防休眠旁路 — 把 Agent 任务的起止映射到主进程的防休眠持有
 *
 * 为什么由渲染层来报，而不是主进程自己推断「Agent 是否在跑」：
 *   Agent 主循环（`IntelligenceCore.send`）位于渲染进程，主进程无法准确窥见它的
 *   起止时刻。任何在主进程侧重建的推断（例如按工具调用事件拼凑）都会与真实状态漂移，
 *   表现为「任务早就结束了但系统还是不休眠」或者反过来「长任务跑到一半被系统睡死」。
 *   唯一知道真相的一侧显式上报，是这里唯一可靠的做法。
 *
 * 设计约束（与 vtsAudioTap 同一套哲学）：
 *   1. **绝不阻塞 Agent 主链路** —— 全程 fire-and-forget，异常只记 debug 日志。
 *      防休眠失败最多是「任务可能被系统中断」，而阻塞 Agent 会让任务直接失败，
 *      两者代价不对等。
 *   2. **不做重试** —— 引用计数是状态同步而非消息投递，重试反而会造成计数漂移
 *      （一次 acquire 变两次，永远释放不掉）。
 *   3. **本地计数兜底** —— 主进程已经会忽略多余的 release，本地再挡一层，
 *      避免渲染层自身的异常路径（重复清理）把日志刷满。
 *
 * @module services/powerGuard
 */

import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { AGENT_TASK_REASON } from '@shared/protocols/powerGuardProtocol'

/**
 * 本渲染进程已发起但尚未释放的持有数。
 *
 * 只用来抑制「重复 release」这种明显的调用方错误，**不作为主进程计数的镜像** ——
 * 主进程的 Map 才是权威，这里的偏差（例如渲染层重载后归零而主进程尚有残留）
 * 由主进程的重载监听负责收敛。
 */
let outstanding = 0

/** 当前渲染层认为在跑的 Agent 任务数（排障用） */
export function getOutstandingAgentTasks(): number {
  return outstanding
}

/**
 * Agent 任务开始 —— 取得一份防休眠持有。
 *
 * 由 `IntelligenceCore.send` 在任务登记成功后调用。
 * 是否真的生效（模块开关 / 强度档位 / 自动触发规则 / 去抖窗口）全部由主进程裁决，
 * 渲染层不做任何配置判断 —— 配置只有一份真相，在主进程。
 */
export function beginAgentTaskPowerGuard(): void {
  outstanding += 1
  void api.powerGuard
    .acquire(AGENT_TASK_REASON)
    .then(res => {
      if (!res?.success) {
        logger.system.debug('[PowerGuard] 取得防休眠持有失败：', res?.error)
      }
    })
    .catch(err => {
      // IPC 通道异常（主进程尚未注册 handler / 正在退出）不应影响 Agent 执行
      logger.system.debug('[PowerGuard] 取得防休眠持有异常：', err)
    })
}

/**
 * Agent 任务结束 —— 释放一份防休眠持有。
 *
 * 由 `IntelligenceCore.send` 的 `finally` 调用，与 `beginAgentTaskPowerGuard`
 * 一一配对。必须放在 `finally` 而不是仅成功路径：异常、用户中止、工具报错
 * 都会走 `finally`，漏掉任何一条都会让计数永久滞留。
 */
export function endAgentTaskPowerGuard(): void {
  if (outstanding <= 0) {
    // 主进程会忽略多余释放，这里挡住只为不刷日志；说明调用方出现了不成对的 release
    logger.system.debug('[PowerGuard] 收到多余的持有释放请求，已忽略')
    return
  }
  outstanding -= 1

  void api.powerGuard
    .release(AGENT_TASK_REASON)
    .then(res => {
      if (!res?.success) {
        logger.system.debug('[PowerGuard] 释放防休眠持有失败：', res?.error)
      }
    })
    .catch(err => {
      logger.system.debug('[PowerGuard] 释放防休眠持有异常：', err)
    })
}
