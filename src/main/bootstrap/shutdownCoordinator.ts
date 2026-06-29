/**
 * 渲染进程关闭协调器
 *
 * 在窗口关闭或应用退出前，主进程通过 IPC 通知渲染进程执行状态保存，
 * 渲染进程保存完成后通过 app:shutdown-response 回调通知主进程。
 *
 * 该模块集中管理请求-响应配对与超时，避免主进程因渲染进程未响应而无限阻塞。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { logger } from '@shared/toolkit/LogEngine'

export type ShutdownReason = 'window-close' | 'app-quit'

type ShutdownResolver = (success: boolean) => void

/** 进行中的关闭请求：requestId → resolver */
const pendingShutdownRequests = new Map<string, ShutdownResolver>()

// 监听渲染进程的响应（仅注册一次，模块加载时执行）
ipcMain.handle('app:shutdown-response', (_event, requestId: string, success: boolean) => {
  const resolver = pendingShutdownRequests.get(requestId)
  if (!resolver) {
    return false
  }

  pendingShutdownRequests.delete(requestId)
  resolver(success)
  return true
})

/**
 * 请求渲染进程在关闭前执行保存操作。
 *
 * @param win 目标窗口
 * @param reason 关闭原因：window-close（仅本窗口）/ app-quit（应用整体退出）
 * @param timeoutMs 等待渲染进程响应的最长时间，超时按失败处理
 * @returns 渲染进程是否成功完成保存
 */
export async function requestRendererShutdown(
  win: BrowserWindow,
  reason: ShutdownReason,
  timeoutMs = 8000,
): Promise<boolean> {
  // 窗口或 webContents 已销毁时无需再通知
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return true
  }

  const requestId = randomUUID()

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingShutdownRequests.delete(requestId)
      logger.system.warn('[Shutdown] Renderer save timed out', {
        windowId: win.id,
        reason,
        requestId,
        timeoutMs,
      })
      resolve(false)
    }, timeoutMs)

    pendingShutdownRequests.set(requestId, (success) => {
      clearTimeout(timeout)
      resolve(success)
    })

    try {
      win.webContents.send('app:shutdown-requested', { requestId, reason })
    } catch (error) {
      clearTimeout(timeout)
      pendingShutdownRequests.delete(requestId)
      logger.system.warn('[Shutdown] Failed to notify renderer', {
        windowId: win.id,
        reason,
        error,
      })
      resolve(false)
    }
  })
}
