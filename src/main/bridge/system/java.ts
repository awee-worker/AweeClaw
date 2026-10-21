/**
 * Java 环境管理 — Java 运行时的 IPC 处理器
 *
 * 职责：
 * - 暴露 Java 环境状态查询、检测安装、重新安装、自定义路径等 IPC 接口
 * - 桥接渲染进程与 javaManager 模块
 *
 * 与 python.ts / node.ts IPC 处理器架构对齐
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { javaManager } from '../../modules/java-runtime'

/** 失败时的状态兜底，字段与 JavaStatus 对齐 */
function emptyStatus(error: string) {
  return {
    ready: false,
    javaPath: null,
    javacPath: null,
    javaHome: null,
    source: 'none' as const,
    version: null,
    isJdk: false,
    javaHomeEnv: process.env.JAVA_HOME || null,
    error,
  }
}

export function registerJavaHandlers(): void {
  ipcMain.handle('java:getStatus', async () => {
    try {
      // 未检测过时先做一次轻量检测（不下载），否则会一直返回初始的不可用快照
      return await javaManager.detect()
    } catch (err) {
      logger.system.error('[Java IPC] getStatus failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('java:redetect', async () => {
    try {
      return await javaManager.redetect()
    } catch (err) {
      logger.system.error('[Java IPC] redetect failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('java:getPath', async () => {
    try {
      return javaManager.getJavaPath()
    } catch (err) {
      logger.system.error('[Java IPC] getPath failed:', err)
      return null
    }
  })

  ipcMain.handle('java:getJavacPath', async () => {
    try {
      return javaManager.getJavacPath()
    } catch (err) {
      logger.system.error('[Java IPC] getJavacPath failed:', err)
      return null
    }
  })

  ipcMain.handle('java:getHome', async () => {
    try {
      return javaManager.getJavaHome()
    } catch (err) {
      logger.system.error('[Java IPC] getHome failed:', err)
      return null
    }
  })

  ipcMain.handle('java:ensureReady', async () => {
    try {
      return await javaManager.ensureReady()
    } catch (err) {
      logger.system.error('[Java IPC] ensureReady failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('java:reinstall', async () => {
    try {
      return await javaManager.reinstall()
    } catch (err) {
      logger.system.error('[Java IPC] reinstall failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('java:setCustomPath', async (_, customPath: string | null) => {
    try {
      const status = await javaManager.setCustomJavaPath(customPath)
      return { success: status.ready, status }
    } catch (err) {
      logger.system.error('[Java IPC] setCustomPath failed:', err)
      return { success: false, status: emptyStatus(toAppError(err).message) }
    }
  })

  logger.system.info('[Java IPC] Handlers registered')
}
