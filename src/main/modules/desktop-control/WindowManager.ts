/**
 * 窗口管理器（L4 窗口控制层）
 * 跨平台窗口列表查询与操作（聚焦/最小化/最大化/关闭/置顶）
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './platform/types'
import type {
  WindowInfo,
  WindowActionType,
  WindowOperationResult,
  Rect,
} from './types/actions'

export class WindowManager {
  constructor(private readonly adapter: PlatformAdapter) {}

  /** 列出所有可见窗口 */
  async list(): Promise<WindowInfo[]> {
    try {
      return await this.adapter.listWindows()
    } catch (err) {
      logger.desktop.error('[WindowManager] list failed:', err)
      throw err
    }
  }

  /** 按标题或应用名查找窗口 */
  async find(query: string): Promise<WindowInfo[]> {
    try {
      return await this.adapter.findWindow(query)
    } catch (err) {
      logger.desktop.error(`[WindowManager] find failed for "${query}":`, err)
      throw err
    }
  }

  /** 聚焦窗口 */
  async focus(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'focus')
  }

  /** 最小化窗口 */
  async minimize(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'minimize')
  }

  /** 最大化窗口 */
  async maximize(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'maximize')
  }

  /** 还原窗口 */
  async restore(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'restore')
  }

  /** 关闭窗口 */
  async close(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'close')
  }

  /** 置顶窗口 */
  async bringToFront(windowId: string): Promise<WindowOperationResult> {
    return this.performAction(windowId, 'bringToFront')
  }

  /** 获取指定应用前台窗口的真实边界（用于 OCR 裁剪） */
  async getActiveWindowBounds(appName: string): Promise<Rect | null> {
    try {
      return await this.adapter.getActiveWindowBounds(appName)
    } catch (err) {
      logger.desktop.warn(`[WindowManager] getActiveWindowBounds("${appName}") failed:`, err)
      return null
    }
  }

  /** 设置窗口位置和大小 */
  async setBounds(windowId: string, bounds: Rect): Promise<WindowOperationResult> {
    const start = Date.now()
    try {
      const result = await this.adapter.performWindowAction(windowId, 'setBounds', bounds)
      return {
        ...result,
        operation: 'setBounds',
        windowId,
        duration: result.duration || (Date.now() - start),
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[WindowManager] setBounds failed for ${windowId}:`, err)
      return {
        success: false,
        operation: 'setBounds',
        windowId,
        duration: Date.now() - start,
        error,
      }
    }
  }

  /** 通用窗口操作 */
  private async performAction(
    windowId: string,
    action: WindowActionType,
  ): Promise<WindowOperationResult> {
    const start = Date.now()
    try {
      const result = await this.adapter.performWindowAction(windowId, action)
      return {
        ...result,
        operation: action,
        windowId,
        duration: result.duration || (Date.now() - start),
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      logger.desktop.error(`[WindowManager] ${action} failed for ${windowId}:`, err)
      return {
        success: false,
        operation: action,
        windowId,
        duration: Date.now() - start,
        error,
      }
    }
  }
}
