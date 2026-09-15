/**
 * AudiobookIpc — 有声书 IPC 通道
 *
 * 职责：
 * 1. 注册 IPC 处理器
 * 2. 桥接渲染进程和主进程
 * 3. 提供任务管理 API
 *
 * IPC 通道：
 * - audiobook:create-task          创建任务
 * - audiobook:get-task             获取任务
 * - audiobook:get-all-tasks        获取所有任务
 * - audiobook:delete-task          删除任务
 * - audiobook:execute-task         执行任务
 * - audiobook:pause-task           暂停任务
 * - audiobook:cancel-task          取消任务
 * - audiobook:resume-task          继续任务
 * - audiobook:get-task-progress    获取任务进度
 * - audiobook:estimate-task        预估任务信息
 *
 * @module audiobook/AudiobookIpc
 */

import { ipcMain, BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { AudiobookManager } from './AudiobookManager'
import type { AudiobookConfig, TaskMetadata } from './AudiobookStore'

// ============================================
// IPC 处理器注册
// ============================================

/**
 * 注册 IPC 处理器
 */
export function registerAudiobookIpcHandlers(): void {
  const manager = AudiobookManager.getInstance()

  logger.system.info('[Audiobook] 注册 IPC 处理器')

  // 创建任务
  ipcMain.handle('audiobook:create-task', async (_event, filePath: string, config?: Partial<AudiobookConfig>) => {
    try {
      const task = manager.createTask(filePath, config)
      return { success: true, data: task }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[Audiobook] 创建任务失败:', error)
      return { success: false, error: errorMessage }
    }
  })

  // 获取任务
  ipcMain.handle('audiobook:get-task', async (_event, taskId: string) => {
    try {
      const task = manager.getTask(taskId)
      return { success: true, data: task }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 获取所有任务
  ipcMain.handle('audiobook:get-all-tasks', async () => {
    try {
      const tasks = manager.getAllTasks()
      return { success: true, data: tasks }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 删除任务
  ipcMain.handle('audiobook:delete-task', async (_event, taskId: string) => {
    try {
      manager.deleteTask(taskId)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[Audiobook] 删除任务失败:', error)
      return { success: false, error: errorMessage }
    }
  })

  // 执行任务
  ipcMain.handle('audiobook:execute-task', async (_event, taskId: string) => {
    try {
      // 异步执行，不等待完成
      manager.executeTask(taskId, (progress) => {
        // 通知渲染进程进度
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          win.webContents.send('audiobook:task-progress', progress)
        }
      }).catch((error) => {
        logger.system.error('[Audiobook] 任务执行失败:', error)
      })

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[Audiobook] 执行任务失败:', error)
      return { success: false, error: errorMessage }
    }
  })

  // 暂停任务
  ipcMain.handle('audiobook:pause-task', async (_event, taskId: string) => {
    try {
      manager.pauseTask(taskId)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 取消任务
  ipcMain.handle('audiobook:cancel-task', async (_event, taskId: string) => {
    try {
      manager.cancelTask(taskId)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 继续任务
  ipcMain.handle('audiobook:resume-task', async (_event, taskId: string) => {
    try {
      // 异步执行，不等待完成
      manager.resumeTask(taskId, (progress) => {
        // 通知渲染进程进度
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          win.webContents.send('audiobook:task-progress', progress)
        }
      }).catch((error) => {
        logger.system.error('[Audiobook] 任务继续失败:', error)
      })

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[Audiobook] 继续任务失败:', error)
      return { success: false, error: errorMessage }
    }
  })

  // 获取任务进度
  ipcMain.handle('audiobook:get-task-progress', async (_event, taskId: string) => {
    try {
      const progress = manager.getTaskProgress(taskId)
      return { success: true, data: progress }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 预估任务信息
  ipcMain.handle('audiobook:estimate-task', async (_event, filePath: string) => {
    try {
      const estimate = await manager.estimateTask(filePath)
      return { success: true, data: estimate }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.system.error('[Audiobook] 预估任务失败:', error)
      return { success: false, error: errorMessage }
    }
  })

  logger.system.info('[Audiobook] IPC 处理器注册完成')
}

/**
 * 清理 IPC 处理器
 */
export function cleanupAudiobookIpcHandlers(): void {
  logger.system.info('[Audiobook] 清理 IPC 处理器')

  ipcMain.removeHandler('audiobook:create-task')
  ipcMain.removeHandler('audiobook:get-task')
  ipcMain.removeHandler('audiobook:get-all-tasks')
  ipcMain.removeHandler('audiobook:delete-task')
  ipcMain.removeHandler('audiobook:execute-task')
  ipcMain.removeHandler('audiobook:pause-task')
  ipcMain.removeHandler('audiobook:cancel-task')
  ipcMain.removeHandler('audiobook:resume-task')
  ipcMain.removeHandler('audiobook:get-task-progress')
  ipcMain.removeHandler('audiobook:estimate-task')
}