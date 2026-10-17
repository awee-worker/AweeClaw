/**
 * 渲染层周期任务调度器
 *
 * 实现位于 `@shared/toolkit/tickerScheduler`，本文件只提供渲染进程的
 * 可见性来源：`document.visibilitychange`。
 *
 * Electron 的 backgroundThrottling 只把隐藏页面的定时器降频到 ≥1s，
 * 不是停止——对轮询类任务（设置面板、监控图表、状态刷新）而言，
 * 页面不可见时的每一次触发都是纯浪费。
 *
 * 用法：
 *   const stop = tickerScheduler.register({
 *     id: 'system-monitor-poll',
 *     intervalMs: 5000,
 *     visibility: 'visible-only',
 *     handler: () => refreshMetrics(),
 *   })
 *   stop() // 卸载时停止
 *
 * @module services/tickerScheduler
 */

import { TickerScheduler, type TickerSchedulerHost } from '@shared/toolkit/tickerScheduler'

export type { TickerOptions, TickerVisibility, TickerSchedulerHost } from '@shared/toolkit/tickerScheduler'
export { TickerScheduler }

/**
 * 渲染进程的可见性来源。
 *
 * document 在部分入口（测试环境、预渲染）不存在，此时退化为「始终可见」，
 * 调度行为与改造前的裸 setInterval 一致，不会因缺 DOM 而丢任务。
 */
const documentHost: TickerSchedulerHost | undefined =
  typeof document === 'undefined'
    ? undefined
    : {
        isVisible: () => !document.hidden,
        onVisibilityChange: (handler) => {
          const listener = () => handler(!document.hidden)
          document.addEventListener('visibilitychange', listener)
          return () => document.removeEventListener('visibilitychange', listener)
        },
      }

export const tickerScheduler = new TickerScheduler(documentHost)