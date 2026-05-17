/**
 * Updater IPC handlers.
 */

import { ipcMain, shell } from 'electron'
import { exec } from 'child_process'
import { updateService } from '../modules/auto-update'
import { BRAND } from '@shared/brand'

export function registerUpdaterHandlers(): void {
  ipcMain.handle('updater:check', async () => {
    return updateService.checkForUpdates()
  })

  ipcMain.handle('updater:getStatus', () => {
    return updateService.getStatus()
  })

  ipcMain.handle('updater:download', async () => {
    await updateService.downloadUpdate()
    return updateService.getStatus()
  })

  ipcMain.handle('updater:install', () => {
    updateService.quitAndInstall()
  })

  ipcMain.handle('updater:openDownloadPage', (_, url?: string) => {
    const status = updateService.getStatus()
    const targetUrl = url || status.downloadUrl || BRAND.links.releases
    shell.openExternal(targetUrl).catch(() => {
      const cmd = process.platform === 'darwin'
        ? `open "${targetUrl.replace(/"/g, '\\"')}"`
        : process.platform === 'win32'
          ? `start "" "${targetUrl.replace(/"/g, '\\"')}"`
          : `xdg-open "${targetUrl.replace(/"/g, '\\"')}"`
      exec(cmd, (err) => {
        if (err) console.warn('[Updater] Fallback open failed:', err.message)
      })
    })
  })
}
