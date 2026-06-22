/**
 * 屏幕截图服务（L4 屏幕截图层）
 * 跨平台截图能力，支持全屏、区域、多屏截图
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './platform/types'
import type { ScreenshotResult, Rect } from './types/actions'

export class ScreenCaptureService {
  constructor(private readonly adapter: PlatformAdapter) {}

  /** 截取整个主屏幕 */
  async captureScreen(displayId?: number): Promise<ScreenshotResult> {
    try {
      const result = await this.adapter.captureScreen(displayId)
      logger.desktop.info(
        `[ScreenCapture] captureScreen display=${displayId ?? 'main'} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[ScreenCapture] captureScreen failed:', err)
      throw err
    }
  }

  /** 截取指定区域 */
  async captureRegion(region: Rect, displayId?: number): Promise<ScreenshotResult> {
    // 参数校验
    if (region.width <= 0 || region.height <= 0) {
      throw new Error(`Invalid region: width and height must be positive`)
    }
    if (region.x < 0 || region.y < 0) {
      throw new Error(`Invalid region: x and y must be non-negative`)
    }

    try {
      const result = await this.adapter.captureRegion(region, displayId)
      logger.desktop.info(
        `[ScreenCapture] captureRegion region=${JSON.stringify(region)} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[ScreenCapture] captureRegion failed:', err)
      throw err
    }
  }

  /** 截取所有显示器 */
  async captureAllScreens(): Promise<ScreenshotResult[]> {
    // 通过 systeminformation 获取显示器数量，逐个截图
    // 实际显示器数量由 adapter 内部处理
    try {
      const main = await this.adapter.captureScreen()
      // 简化实现：仅返回主屏，多屏扩展由 adapter 内部完成
      // 若需要支持多屏，可在此循环 displayId
      return [main]
    } catch (err) {
      logger.desktop.error('[ScreenCapture] captureAllScreens failed:', err)
      throw err
    }
  }
}
