/**
 * 输入模拟器（L4 输入模拟层）
 * 跨平台鼠标键盘模拟，支持点击、移动、滚动、文本输入、组合键
 * 注意：macOS 需要用户授予"辅助功能"权限
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './platform/types'
import type {
  MouseClickParams,
  MouseMoveParams,
  MouseScrollParams,
  MouseDragParams,
  InputOperationResult,
} from './types/actions'

export class InputSimulator {
  constructor(private readonly adapter: PlatformAdapter) {}

  // ============ 鼠标操作 ============

  /** 鼠标点击 */
  async click(params: MouseClickParams): Promise<InputOperationResult> {
    // 参数校验
    if (params.x < 0 || params.y < 0) {
      throw new Error(`Invalid coordinates: x=${params.x}, y=${params.y}`)
    }
    if (!['left', 'right', 'middle'].includes(params.button)) {
      throw new Error(`Invalid button: ${params.button}`)
    }

    try {
      const result = await this.adapter.mouseClick(params)
      logger.desktop.info(
        `[InputSimulator] click at (${params.x}, ${params.y}) button=${params.button} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] click failed:', err)
      throw err
    }
  }

  /** 鼠标移动 */
  async move(params: MouseMoveParams): Promise<InputOperationResult> {
    if (params.x < 0 || params.y < 0) {
      throw new Error(`Invalid coordinates: x=${params.x}, y=${params.y}`)
    }

    try {
      const result = await this.adapter.mouseMove(params)
      logger.desktop.info(
        `[InputSimulator] move to (${params.x}, ${params.y}) success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] move failed:', err)
      throw err
    }
  }

  /** 鼠标滚动 */
  async scroll(params: MouseScrollParams): Promise<InputOperationResult> {
    if (params.x < 0 || params.y < 0) {
      throw new Error(`Invalid coordinates: x=${params.x}, y=${params.y}`)
    }

    try {
      const result = await this.adapter.mouseScroll(params)
      logger.desktop.info(
        `[InputSimulator] scroll at (${params.x}, ${params.y}) amount=${params.amount} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] scroll failed:', err)
      throw err
    }
  }

  /** 鼠标拖拽 */
  async drag(params: MouseDragParams): Promise<InputOperationResult> {
    if (params.fromX < 0 || params.fromY < 0 || params.toX < 0 || params.toY < 0) {
      throw new Error(`Invalid coordinates`)
    }
    if (!['left', 'right', 'middle'].includes(params.button)) {
      throw new Error(`Invalid button: ${params.button}`)
    }

    try {
      const result = await this.adapter.mouseDrag(params)
      logger.desktop.info(
        `[InputSimulator] drag from (${params.fromX}, ${params.fromY}) to (${params.toX}, ${params.toY}) success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] drag failed:', err)
      throw err
    }
  }

  // ============ 键盘操作 ============

  /** 输入文本 */
  async typeText(text: string, delayMs = 0): Promise<InputOperationResult> {
    if (!text) {
      throw new Error('Text cannot be empty')
    }

    try {
      const result = await this.adapter.typeText(text, delayMs)
      logger.desktop.info(
        `[InputSimulator] typeText length=${text.length} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] typeText failed:', err)
      throw err
    }
  }

  /** 按下单个按键 */
  async pressKey(key: string): Promise<InputOperationResult> {
    if (!key) {
      throw new Error('Key cannot be empty')
    }

    try {
      const result = await this.adapter.pressKey(key)
      logger.desktop.info(`[InputSimulator] pressKey ${key} success=${result.success}`)
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] pressKey failed:', err)
      throw err
    }
  }

  /** 组合键 */
  async keyCombo(keys: string[]): Promise<InputOperationResult> {
    if (!keys || keys.length < 2) {
      throw new Error('Key combo requires at least 2 keys')
    }

    try {
      const result = await this.adapter.keyCombo(keys)
      logger.desktop.info(
        `[InputSimulator] keyCombo ${keys.join('+')} success=${result.success}`,
      )
      return result
    } catch (err) {
      logger.desktop.error('[InputSimulator] keyCombo failed:', err)
      throw err
    }
  }
}
