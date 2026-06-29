/**
 * 帮助菜单定义
 *
 * 包含：键盘快捷键、官方文档、报告问题、检查更新、关于
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'
import { createCommandSender } from '../menuActions'
import { BRAND } from '@shared/brand'

export interface HelpMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
}

/**
 * 构建帮助菜单
 */
export function buildHelpMenu(ctx: HelpMenuContext): MenuItemConstructorOptions {
  const { getWin, lang } = ctx
  return {
    label: t(lang, 'help'),
    role: 'help',
    submenu: [
      {
        label: t(lang, 'keyboardShortcuts'),
        accelerator: 'CmdOrCtrl+/',
        click: createCommandSender(getWin, 'keyboard-shortcuts'),
      },
      {
        label: t(lang, 'documentation'),
        click: () => openExternal(BRAND.links.docs),
      },
      {
        label: t(lang, 'reportIssue'),
        click: () => openExternal(BRAND.links.github),
      },
      { type: 'separator' },
      {
        label: t(lang, 'checkForUpdates'),
        click: () => {
          // 自动更新由 electron-updater 处理，这里触发检查
          const win = getWin()
          if (win && !win.isDestroyed()) {
            win.webContents.send('app:check-for-updates')
          }
        },
      },
      { type: 'separator' },
      {
        label: t(lang, 'about'),
        click: createCommandSender(getWin, 'about'),
      },
    ],
  }
}

/** 安全打开外部链接 */
function openExternal(url: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeOpenExternal } = require('../../guard/safeExternalUrl')
  safeOpenExternal(url)
}
