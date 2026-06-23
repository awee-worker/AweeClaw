/**
 * 自动更新管理器 — 应用更新流程的 IPC 处理器
 *
 * 职责：
 * - 暴露更新检查、下载、安装等 IPC 接口
 * - 桥接渲染进程与 updateService 模块
 * - 外部链接通过 safeOpenExternal 安全打开（协议白名单校验）
 */

import { ipcMain } from 'electron'
import { safeOpenExternal } from '../../guard/safeExternalUrl'
import { updateService } from '../../modules/auto-update'
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
