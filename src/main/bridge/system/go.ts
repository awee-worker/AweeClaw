/**
 * Go 环境管理 — Go 运行时的 IPC 处理器
 *
 * 职责：
 * - 暴露 Go 环境状态查询、检测安装、重新安装、自定义路径等 IPC 接口
 * - 桥接渲染进程与 goManager 模块
 *
 * 与 java.ts / node.ts / python.ts IPC 处理器架构对齐
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { goManager } from '../../modules/go-runtime'

/** 失败时的状态兜底，字段与 GoStatus 对齐 */
function emptyStatus(error: string) {
  return {
    ready: false,
    goPath: null,
    gofmtPath: null,
    goRoot: null,
    source: 'none' as const,
    version: null,
    goRootEnv: process.env.GOROOT || null,
    error,
  }
}

export function registerGoHandlers(): void {
  ipcMain.handle('go:getStatus', async () => {
    try {
      // 未检测过时先做一次轻量检测（不下载），否则会一直返回初始的不可用快照
      return await goManager.detect()
    } catch (err) {
      logger.system.error('[Go IPC] getStatus failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('go:redetect', async () => {
    try {
      return await goManager.redetect()
    } catch (err) {
      logger.system.error('[Go IPC] redetect failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('go:getPath', async () => {
    try {
      return goManager.getGoPath()
    } catch (err) {
      logger.system.error('[Go IPC] getPath failed:', err)
      return null
    }
  })

  ipcMain.handle('go:getGofmtPath', async () => {
    try {
      return goManager.getGofmtPath()
    } catch (err) {
      logger.system.error('[Go IPC] getGofmtPath failed:', err)
      return null
    }
  })

  ipcMain.handle('go:getRoot', async () => {
    try {
      return goManager.getGoRoot()
    } catch (err) {
      logger.system.error('[Go IPC] getRoot failed:', err)
      return null
    }
  })

  ipcMain.handle('go:ensureReady', async () => {
    try {
      return await goManager.ensureReady()
    } catch (err) {
      logger.system.error('[Go IPC] ensureReady failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('go:reinstall', async () => {
    try {
      return await goManager.reinstall()
    } catch (err) {
      logger.system.error('[Go IPC] reinstall failed:', err)
      return emptyStatus(toAppError(err).message)
    }
  })

  ipcMain.handle('go:setCustomPath', async (_, customPath: string | null) => {
    try {
      const status = await goManager.setCustomGoPath(customPath)
      return { success: status.ready, status }
    } catch (err) {
      logger.system.error('[Go IPC] setCustomPath failed:', err)
      return { success: false, status: emptyStatus(toAppError(err).message) }
    }
  })

  logger.system.info('[Go IPC] Handlers registered')
}
