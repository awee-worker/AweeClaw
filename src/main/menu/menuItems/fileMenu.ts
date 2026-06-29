/**
 * 文件菜单定义
 *
 * 包含：新建窗口、打开文件夹、添加文件夹、保存工作区、保存文件、刷新、最近工作区
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'
import { createCommandSender, sendOpenRecentWorkspace } from '../menuActions'

/** 最近工作区项 */
export interface RecentWorkspace {
  path: string
  name: string
}

export interface FileMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
  recentWorkspaces: RecentWorkspace[]
  onClearRecentWorkspaces: () => void
}

/**
 * 构建文件菜单
 *
 * macOS: 不含设置/退出（在应用菜单中）
 * Windows/Linux: 末尾追加设置和退出
 */
export function buildFileMenu(ctx: FileMenuContext): MenuItemConstructorOptions {
  const { getWin, lang, recentWorkspaces, onClearRecentWorkspaces } = ctx
  const isMac = process.platform === 'darwin'

  // 最近工作区子菜单
  const recentSubmenu: MenuItemConstructorOptions[] =
    recentWorkspaces.length > 0
      ? [
          ...recentWorkspaces.map<MenuItemConstructorOptions>((ws) => ({
            label: ws.name,
            sublabel: ws.path,
            click: sendOpenRecentWorkspace(getWin, ws.path),
          })),
          { type: 'separator' },
          {
            label: t(lang, 'clearRecentWorkspaces'),
            click: () => onClearRecentWorkspaces(),
          },
        ]
      : [{ label: t(lang, 'noRecentWorkspaces'), enabled: false }]

  const submenu: MenuItemConstructorOptions[] = [
    {
      label: t(lang, 'newWindow'),
      accelerator: 'CmdOrCtrl+Shift+N',
      click: createCommandSender(getWin, 'new-window'),
    },
    { type: 'separator' },
    {
      label: t(lang, 'openFolder'),
      accelerator: 'CmdOrCtrl+O',
      click: createCommandSender(getWin, 'open-folder'),
    },
    {
      label: t(lang, 'addFolderToWorkspace'),
      accelerator: 'CmdOrCtrl+Shift+O',
      click: createCommandSender(getWin, 'add-folder'),
    },
    {
      label: t(lang, 'saveWorkspaceAs'),
      click: createCommandSender(getWin, 'save-workspace'),
    },
    { type: 'separator' },
    {
      label: t(lang, 'saveFile'),
      accelerator: 'CmdOrCtrl+S',
      click: createCommandSender(getWin, 'save-file'),
    },
    {
      label: t(lang, 'refreshFiles'),
      accelerator: 'CmdOrCtrl+R',
      click: createCommandSender(getWin, 'refresh-files'),
    },
    { type: 'separator' },
    {
      label: t(lang, 'recentWorkspaces'),
      submenu: recentSubmenu,
    },
  ]

  // Windows/Linux: 追加设置和退出
  if (!isMac) {
    submenu.push(
      { type: 'separator' },
      {
        label: t(lang, 'settings'),
        accelerator: 'CmdOrCtrl+,',
        click: createCommandSender(getWin, 'settings'),
      },
      { type: 'separator' },
      {
        label: t(lang, 'quit'),
        accelerator: 'CmdOrCtrl+Q',
        role: 'quit',
      },
    )
  }

  return {
    label: t(lang, 'file'),
    submenu,
  }
}
