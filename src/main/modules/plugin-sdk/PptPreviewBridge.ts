/**
 * PPT 预览桥 — 供插件通过 Host 服务访问 PPT 预览能力
 *
 * 插件通过 `globalThis.__AWEECLAW_HOST__.pptPreview` 调用以下方法：
 * - open(sessionId, title): 打开预览窗口
 * - pushSlide(slideData): 推送/更新一张幻灯片
 * - markComplete(sessionId, filePath): 标记生成完成
 * - clearSession(sessionId): 清理会话数据
 *
 * 内部委托给 PptPreviewManager（单例），确保线程安全和窗口复用。
 */

import { PptPreviewManager } from '../ppt-preview/PptPreviewManager'
import type { PptSlideData } from '@shared/protocols/pptPreviewProtocol'

export class PptPreviewBridge {
  private static instance: PptPreviewBridge | null = null

  private constructor() {}

  static getInstance(): PptPreviewBridge {
    if (!PptPreviewBridge.instance) {
      PptPreviewBridge.instance = new PptPreviewBridge()
    }
    return PptPreviewBridge.instance
  }

  /**
   * 打开预览窗口并初始化会话。
   *
   * @param sessionId 会话唯一标识（建议用 `ppt-${Date.now()}-${random}`）
   * @param title 演示文稿标题，显示在预览窗口顶栏
   * @param slideSize 幻灯片尺寸（英寸），用于预览画布正确缩放坐标。
   *                  未提供时预览用默认 10×5.625（16:9）。
   */
  open(sessionId: string, title: string, slideSize?: { width: number; height: number }): void {
    try {
      PptPreviewManager.getInstance().openSession(sessionId, title, slideSize)
    } catch (err) {
      console.error('[PptPreviewBridge] open failed:', err)
    }
  }

  /**
   * 推送/更新一张幻灯片数据到预览窗口。
   * 若 slideIndex 已存在则替换（累积元素），否则新增。
   *
   * @param slideData 幻灯片数据（包含元素列表）
   */
  pushSlide(slideData: PptSlideData): void {
    try {
      PptPreviewManager.getInstance().pushSlide(slideData)
    } catch (err) {
      console.error('[PptPreviewBridge] pushSlide failed:', err)
    }
  }

  /**
   * 标记会话完成，附带最终保存的 .pptx 文件路径。
   * 预览窗口将显示「已保存」状态和导出按钮。
   *
   * @param sessionId 会话 ID
   * @param filePath .pptx 文件绝对路径
   */
  markComplete(sessionId: string, filePath: string): void {
    try {
      PptPreviewManager.getInstance().markComplete(sessionId, filePath)
    } catch (err) {
      console.error('[PptPreviewBridge] markComplete failed:', err)
    }
  }

  /**
   * 清理会话数据（插件卸载或会话结束时调用）。
   *
   * @param sessionId 会话 ID
   */
  clearSession(sessionId: string): void {
    try {
      PptPreviewManager.getInstance().clearSession(sessionId)
    } catch (err) {
      console.error('[PptPreviewBridge] clearSession failed:', err)
    }
  }
}
