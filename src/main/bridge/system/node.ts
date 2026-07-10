/**
 * Node.js 环境管理 — Node 运行时的 IPC 处理器
 *
 * 职责：
 * - 暴露 Node.js 环境状态查询、包安装、脚本执行等 IPC 接口
 * - 桥接渲染进程与 nodeManager 模块
 * - 支持全局 npm 包安装
 *
 * 与 python.ts IPC 处理器架构对齐
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { nodeManager } from '../../modules/node-runtime'

export function registerNodeHandlers(): void {
  ipcMain.handle('node:getStatus', async () => {
    try {
      return nodeManager.status
    } catch (err) {
      logger.system.error('[Node IPC] getStatus failed:', err)
      return {
        ready: false,
        nodePath: null,
        npmPath: null,
        npxPath: null,
        source: 'none',
        version: null,
        nodeDir: null,
        binDir: null,
        installedPackages: [],
        error: toAppError(err).message,
      }
    }
  })

  ipcMain.handle('node:getPath', async () => {
    try {
      return nodeManager.getNodePath()
    } catch (err) {
      logger.system.error('[Node IPC] getPath failed:', err)
      return null
    }
  })

  ipcMain.handle('node:getNpmPath', async () => {
    try {
      return nodeManager.getNpmPath()
    } catch (err) {
      logger.system.error('[Node IPC] getNpmPath failed:', err)
      return null
    }
  })

  ipcMain.handle('node:getNpxPath', async () => {
    try {
      return nodeManager.getNpxPath()
    } catch (err) {
      logger.system.error('[Node IPC] getNpxPath failed:', err)
      return null
    }
  })

  ipcMain.handle('node:ensureReady', async () => {
    try {
      return await nodeManager.ensureReady()
    } catch (err) {
      logger.system.error('[Node IPC] ensureReady failed:', err)
      return {
        ready: false,
        nodePath: null,
        npmPath: null,
        npxPath: null,
        source: 'none',
        version: null,
        nodeDir: null,
        binDir: null,
        installedPackages: [],
        error: toAppError(err).message,
      }
    }
  })

  ipcMain.handle('node:reinstall', async () => {
    try {
      return await nodeManager.reinstall()
    } catch (err) {
      logger.system.error('[Node IPC] reinstall failed:', err)
      return {
        ready: false,
        nodePath: null,
        npmPath: null,
        npxPath: null,
        source: 'none',
        version: null,
        nodeDir: null,
        binDir: null,
        installedPackages: [],
        error: toAppError(err).message,
      }
    }
  })

  ipcMain.handle('node:installPkg', async (_, pkg: string) => {
    try {
      return await nodeManager.installPackage(pkg)
    } catch (err) {
      logger.system.error('[Node IPC] installPkg failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('node:setCustomPath', async (_, customPath: string | null) => {
    try {
      nodeManager.setCustomNodePath(customPath)
      return { success: true }
    } catch (err) {
      logger.system.error('[Node IPC] setCustomPath failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('node:executeScript', async (_, params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }) => {
    try {
      return await nodeManager.executeScript(params)
    } catch (err) {
      logger.system.error('[Node IPC] executeScript failed:', err)
      return { success: false, stdout: '', stderr: '', exitCode: null, error: toAppError(err).message }
    }
  })

  logger.system.info('[Node IPC] Handlers registered')
}
