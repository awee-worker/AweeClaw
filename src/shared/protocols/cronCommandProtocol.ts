/**
 * 定时任务指令契约（主进程 ↔ preload ↔ 渲染层共用）
 *
 * 背景：定时任务的 `command` 有两种语义
 * 1. **面向用户的指令**：作为一条消息发给 Agent 执行（如「每天早上汇总代码」
 *    → 渲染层包装成 `[自动化任务] xxx\n\n<command>` 交给 `Agent.send`）
 * 2. **模块内部标记**：仅供主进程内部模块自行消费，**不得**转发给 Agent。
 *    当前唯一实例：`ProactiveLearner` 注册的每日 04:00 校准任务
 *    （name=`proactive-learner-daily-calibration`，command=`__proactive_learner_calibrate__`），
 *    该任务由 `cronScheduler.on('task-execute')` 在主进程内直接订阅处理。
 *
 * 为什么单独抽出常量与判定函数：
 * 渲染层存在**两个独立**的 `task-execute` 订阅者 —— `ChatPanel`（人工消息通道）与
 * `useAutomationCronExecutor`（自动化执行通道）。历史实现只在 `ChatPanel` 里内联了
 * `command.startsWith('__')` 判断，`useAutomationCronExecutor` 漏判，导致内部校准标记
 * 被当作普通自动化任务发给 Agent，用户会看到一条无意义的「[自动化任务] … __proactive_learner_calibrate__」。
 * 约定必须集中一处描述，否则新增订阅者时必然再次漏判。
 *
 * 本文件被主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/cronCommandProtocol
 */

/**
 * 内部标记指令前缀
 *
 * 约定：以该前缀开头的 command 属于模块内部指令，只在主进程内消费，
 * 不得广播到渲染进程，更不得作为消息发送给 Agent。
 */
export const INTERNAL_COMMAND_PREFIX = '__'

/**
 * 判断是否为模块内部标记指令
 *
 * 空值一律视为「非内部指令」，交由调用方做主流程的空值校验与告警，
 * 避免此处静默吞掉真正的无效载荷。
 *
 * @param command 定时任务的 command 原文
 */
export function isInternalCronCommand(command?: string | null): boolean {
  if (!command) return false
  return command.startsWith(INTERNAL_COMMAND_PREFIX)
}
