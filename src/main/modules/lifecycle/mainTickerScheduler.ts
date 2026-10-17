/**
 * 主进程周期任务调度器实例
 *
 * 与渲染进程共用 `@shared/toolkit/tickerScheduler` 的实现，区别在于可见性来源：
 * 渲染进程由 `document.visibilitychange` 驱动，主进程由窗口显隐事件驱动。
 *
 * 窗口显隐 → `companionModeController` → 本实例 `setVisible()`：
 * 进入伴生模式（主窗口隐藏且无其他业务窗口可见）时，所有 `visible-only`
 * 任务自动挂起；主窗口重新显示时补跑一次再恢复周期。
 *
 * 约定：主进程新增周期任务一律通过本实例注册，不再直接写 `setInterval`。
 * 这样「什么时候该停」由调度器统一判断，而不是每个模块各自记得处理。
 *
 * @module modules/lifecycle/mainTickerScheduler
 */

import { TickerScheduler } from '@shared/toolkit/tickerScheduler'

/** 主进程调度器（无 host，可见性由 setVisible 显式驱动） */
export const mainTickerScheduler = new TickerScheduler()
