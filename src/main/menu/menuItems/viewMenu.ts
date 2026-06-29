/**
 * 视图菜单定义
 *
 * 包含：命令面板、转到文件、切换终端/AI面板/侧边栏、缩放、全屏、重载、DevTools
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'
import { createCommandSender } from '../menuActions'

export interface ViewMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
}

/**
 * 构建视图菜单
 */
export function buildViewMenu(ctx: ViewMenuContext): MenuItemConstructorOptions {
  const { getWin, lang } = ctx
  return {
    label: t(lang, 'view'),
    submenu: [
      {
        label: t(lang, 'commandPalette'),
        accelerator: 'CmdOrCtrl+Shift+P',
        click: createCommandSender(getWin, 'workbench.action.showCommands'),
      },
      {
        label: t(lang, 'gotoFile'),
        accelerator: 'CmdOrCtrl+P',
        click: createCommandSender(getWin, 'quick-open'),
      },
      { type: 'separator' },
      {
        label: t(lang, 'toggleTerminal'),
        accelerator: 'CmdOrCtrl+`',
        click: createCommandSender(getWin, 'toggle-terminal'),
      },
      {
        label: t(lang, 'toggleAiPanel'),
        accelerator: 'CmdOrCtrl+Shift+I',
        click: createCommandSender(getWin, 'toggle-ai-panel'),
      },
      {
        label: t(lang, 'toggleSidebar'),
        accelerator: 'CmdOrCtrl+B',
        click: createCommandSender(getWin, 'workbench.action.toggleSidebar'),
      },
      { type: 'separator' },
      { role: 'zoomIn', label: t(lang, 'zoomIn'), accelerator: 'CmdOrCtrl+=' },
      { role: 'zoomOut', label: t(lang, 'zoomOut'), accelerator: 'CmdOrCtrl+-' },
      { role: 'resetZoom', label: t(lang, 'resetZoom'), accelerator: 'CmdOrCtrl+0' },
      { type: 'separator' },
      { role: 'reload', label: t(lang, 'reloadWindow') },
      { role: 'toggleDevTools', label: t(lang, 'devTools'), accelerator: 'CmdOrCtrl+Alt+I' },
    ],
  }
}
