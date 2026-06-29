/**
 * 编辑菜单定义
 *
 * 使用 Electron 内置 role，自动适配平台快捷键和本地化
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'

export interface EditMenuContext {
  lang: Language
}

/**
 * 构建编辑菜单
 */
export function buildEditMenu(ctx: EditMenuContext): MenuItemConstructorOptions {
  const { lang } = ctx
  return {
    label: t(lang, 'edit'),
    submenu: [
      { role: 'undo', label: t(lang, 'undo') },
      { role: 'redo', label: t(lang, 'redo') },
      { type: 'separator' },
      { role: 'cut', label: t(lang, 'cut') },
      { role: 'copy', label: t(lang, 'copy') },
      { role: 'paste', label: t(lang, 'paste') },
      { role: 'selectAll', label: t(lang, 'selectAll') },
    ],
  }
}
