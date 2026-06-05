/**
 * Updater IPC handlers.
 */

import { ipcMain } from 'electron'
import { safeOpenExternal } from '../guard/safeExternalUrl'
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
    safeOpenExternal(targetUrl)
  })
}
