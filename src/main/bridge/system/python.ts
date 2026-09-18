/**
 * Python 环境管理 — Python 运行时的 IPC 处理器
 *
 * 职责：
 * - 暴露 Python 环境状态查询、包安装、脚本执行等 IPC 接口
 * - 桥接渲染进程与 pythonManager 模块
 * - 支持虚拟环境管理与包依赖安装
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { pythonManager } from '../../modules/python-runtime'
import type { PythonReadyOptions } from '../../modules/python-runtime/PythonRuntimeManager'

export function registerPythonHandlers(): void {
  ipcMain.handle('python:getStatus', async () => {
    try {
      return pythonManager.status
    } catch (err) {
      logger.system.error('[Python IPC] getStatus failed:', err)
      return { ready: false, pythonPath: null, uvPath: null, source: 'none', version: null, venvDir: null, installedPackages: [], error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:getPath', async () => {
    try {
      return pythonManager.getPythonPath()
    } catch (err) {
      logger.system.error('[Python IPC] getPath failed:', err)
      return null
    }
  })

  ipcMain.handle('python:getUvPath', async () => {
    try {
      return pythonManager.getUvPath()
    } catch (err) {
      logger.system.error('[Python IPC] getUvPath failed:', err)
      return null
    }
  })

  /**
   * 确保 Python 环境就绪
   *
   * 支持传入 minVersion / forceRefresh：设置页的「重新检测并修复」用 forceRefresh 走
   * 同一条链路——系统 Python 低于要求时会被跳过，改选受管运行时或按需安装。
   */
  ipcMain.handle('python:ensureReady', async (_, options?: PythonReadyOptions) => {
    try {
      return await pythonManager.ensureReady(options ?? {})
    } catch (err) {
      logger.system.error('[Python IPC] ensureReady failed:', err)
      return { ready: false, pythonPath: null, uvPath: null, source: 'none', version: null, venvDir: null, venvBaseVersion: null, installedPackages: [], error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:reinstall', async () => {
    try {
      return await pythonManager.reinstall()
    } catch (err) {
      logger.system.error('[Python IPC] reinstall failed:', err)
      return { ready: false, pythonPath: null, uvPath: null, source: 'none', version: null, venvDir: null, installedPackages: [], error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:installPkg', async (_, pkg: string) => {
    try {
      return await pythonManager.installPackage(pkg)
    } catch (err) {
      logger.system.error('[Python IPC] installPkg failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:setCustomPath', async (_, customPath: string | null) => {
    try {
      pythonManager.setCustomPythonPath(customPath)
      return { success: true }
    } catch (err) {
      logger.system.error('[Python IPC] setCustomPath failed:', err)
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:executeScript', async (_, params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }) => {
    try {
      return await pythonManager.executeScript(params)
    } catch (err) {
      logger.system.error('[Python IPC] executeScript failed:', err)
      return { success: false, stdout: '', stderr: '', exitCode: null, error: toAppError(err).message }
    }
  })

  ipcMain.handle('python:executeInlineScript', async (_, params: {
    script: string
    dependencies?: string[]
    args?: string[]
    cwd?: string
    timeout?: number
  }) => {
    try {
      return await pythonManager.executeInlineScript(params)
    } catch (err) {
      logger.system.error('[Python IPC] executeInlineScript failed:', err)
      return { success: false, stdout: '', stderr: '', exitCode: null, error: toAppError(err).message }
    }
  })

  logger.system.info('[Python IPC] Handlers registered')
}
