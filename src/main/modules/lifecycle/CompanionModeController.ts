/**
 * 伴生模式控制器 — 主窗口不可见时的全局低功耗档
 *
 * 背景：关闭主窗口后悬浮头像可见时，应用整体存活（hide-on-close 保住了
 * warm renderer），但 PerceptionScheduler、MonitoringService 等后台采集
 * 仍在按原周期运行。这些数据此刻没有任何界面在消费，纯属空转 —— 既费电
 * 又推高后台 CPU 基线。
 *
 * 职责：监听窗口显隐，在「主窗口隐藏且无其他业务窗口可见」时进入低功耗档：
 *   - 暂停感知采集调度器、系统监控采样
 *   - 退出低功耗档（主窗口重新显示）时恢复，并立即补跑一次监控采样
 *
 * 刻意不碰的部分（它们本身就是事件驱动或用户显式开启的）：
 *   - 悬浮头像与唤醒词（伴生模式的全部意义所在）
 *   - CronScheduler / SessionLifecycle（任务语义，不能因窗口隐藏而漂移）
 *   - IMAP IDLE / DeviceLink（用户显式开启的实时链路，暂停等于断服务）
 *
 * 挂接方式：由 windowManager 在主窗口 show/hide 时调用 enter()/exit()，
 * 控制器内部幂等，重复调用无副作用。
 *
 * @module modules/lifecycle/CompanionModeController
 */

import { logger } from '@shared/toolkit/LogEngine'
import { mainTickerScheduler } from './mainTickerScheduler'

class CompanionModeControllerImpl {
  private active = false

  /** 是否处于伴生低功耗档 */
  isActive(): boolean {
    return this.active
  }

  /**
   * 进入低功耗档（主窗口已隐藏）。
   * 各暂停项独立 try/catch：单项失败不影响其余项，且不影响进出档位。
   */
  enter(): void {
    if (this.active) return
    this.active = true
    logger.system.info('[CompanionMode] Entering low-power mode (main window hidden)')

    // 周期任务统一挂起：所有在主进程调度器上以 visible-only 注册的轮询
    // 就此停止唤醒 CPU，恢复可见时由调度器补跑一次
    mainTickerScheduler.setVisible(false)

    try {
      // 惰性 require：避免模块加载早期（初始化顺序敏感）形成静态依赖
      const { PerceptionScheduler } = require('../perception/PerceptionScheduler')
      PerceptionScheduler.getInstance().stop()
    } catch (err) {
      logger.system.warn('[CompanionMode] pause perception failed:', err)
    }

    try {
      const { MonitoringService } = require('../monitoring/MonitoringService')
      const service = MonitoringService.getInstance()
      if (service.isRunning?.()) service.stop()
    } catch (err) {
      logger.system.warn('[CompanionMode] pause monitoring failed:', err)
    }
  }

  /**
   * 退出低功耗档（主窗口重新可见）。
   * 恢复失败的服务保持停止态，等下一次窗口事件或配置变更再尝试。
   */
  exit(): void {
    if (!this.active) return
    this.active = false
    logger.system.info('[CompanionMode] Exiting low-power mode (main window visible)')

    mainTickerScheduler.setVisible(true)

    try {
      const { PerceptionScheduler } = require('../perception/PerceptionScheduler')
      PerceptionScheduler.getInstance().start()
    } catch (err) {
      logger.system.warn('[CompanionMode] resume perception failed:', err)
    }

    try {
      const { MonitoringService } = require('../monitoring/MonitoringService')
      const service = MonitoringService.getInstance()
      // start 内部按配置决定是否真正采样；配置关着就只是回到待命
      service.start()
    } catch (err) {
      logger.system.warn('[CompanionMode] resume monitoring failed:', err)
    }
  }
}

export const companionModeController = new CompanionModeControllerImpl()
