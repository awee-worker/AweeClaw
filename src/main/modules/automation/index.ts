/**
 * Automation 模块入口
 *
 * 提供自动化引擎能力：Cron 调度器。
 * Hook 系统已在 Plugin SDK 中实现。
 */

export { cronScheduler } from './CronScheduler'
export type {
  CronFields,
  CronTask,
  CronTaskConfig,
  CronTaskStatus,
  PersistedCronTask,
  CronTaskExecutionEvent,
} from './CronScheduler'
export { parseCronExpression, matchesCron } from './CronScheduler'
