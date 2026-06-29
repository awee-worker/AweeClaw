/**
 * 窗口菜单定义
 *
 * macOS：由 Electron 自动生成 role: 'windowMenu'，这里仅本地化 label
 * Windows/Linux：不单独显示窗口菜单
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'

export interface WindowMenuContext {
  lang: Language
}

/**
 * 构建窗口菜单（仅 macOS）
 */
export function buildWindowMenu(ctx: WindowMenuContext): MenuItemConstructorOptions {
  const { lang } = ctx
  return {
    label: t(lang, 'window'),
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: t(lang, 'minimize') },
      { role: 'zoom', label: t(lang, 'zoom') },
      { type: 'separator' },
      { role: 'front', label: t(lang, 'bringAllToFront') },
    ],
  }
}
