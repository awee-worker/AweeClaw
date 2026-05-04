import { ipcMain } from 'electron'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { pythonManager } from '../services/python'

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

  ipcMain.handle('python:ensureReady', async () => {
    try {
      return await pythonManager.ensureReady()
    } catch (err) {
      logger.system.error('[Python IPC] ensureReady failed:', err)
      return { ready: false, pythonPath: null, uvPath: null, source: 'none', version: null, venvDir: null, installedPackages: [], error: toAppError(err).message }
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

  logger.system.info('[Python IPC] Handlers registered')
}
