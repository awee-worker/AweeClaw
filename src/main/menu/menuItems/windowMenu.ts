/**
 * 窗口菜单定义
 *
 * macOS：系统菜单栏展示，新建窗口进入新任务
 * Windows/Linux：不显示原生窗口菜单，由自绘菜单提供同一组入口
 *
 * role: 'windowMenu' 必须保留：它让 AppKit 把这个菜单登记为 windowsMenu，
 * 系统才会自动把已打开的窗口标题追加到菜单里供切换。仅提供 submenu 时
 * 只是一个普通菜单，新建窗口后在菜单里找不到切换入口。
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'
import { createCommandSender } from '../menuActions'

export interface WindowMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
}

/**
 * 构建窗口菜单（仅 macOS）
 */
export function buildWindowMenu(ctx: WindowMenuContext): MenuItemConstructorOptions {
  const { getWin, lang } = ctx
  return {
    label: t(lang, 'window'),
    role: 'windowMenu',
    submenu: [
      {
        // 快捷键统一挂在文件菜单，两个菜单同时注册同一个加速键会导致行为不确定
        label: t(lang, 'newWindow'),
        click: createCommandSender(getWin, 'window.new'),
      },
      { type: 'separator' },
      { role: 'minimize', label: t(lang, 'minimize') },
      { role: 'zoom', label: t(lang, 'zoom') },
      { type: 'separator' },
      { role: 'front', label: t(lang, 'bringAllToFront') },
    ],
  }
}
