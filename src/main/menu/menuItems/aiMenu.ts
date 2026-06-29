/**
 * AI 菜单定义
 *
 * 包含：新对话、解释/重构/修复当前文件、清除历史、清除检查点
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t } from '../menuI18n'
import { createCommandSender } from '../menuActions'

export interface AiMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
}

/**
 * 构建 AI 菜单
 */
export function buildAiMenu(ctx: AiMenuContext): MenuItemConstructorOptions {
  const { getWin, lang } = ctx
  return {
    label: t(lang, 'ai'),
    submenu: [
      {
        label: t(lang, 'newChat'),
        accelerator: 'CmdOrCtrl+Shift+L',
        click: createCommandSender(getWin, 'ai-chat'),
      },
      { type: 'separator' },
      {
        label: t(lang, 'explainCurrentFile'),
        accelerator: 'CmdOrCtrl+Shift+E',
        click: createCommandSender(getWin, 'ai-explain'),
      },
      {
        label: t(lang, 'refactorFile'),
        accelerator: 'CmdOrCtrl+Shift+R',
        click: createCommandSender(getWin, 'ai-refactor'),
      },
      {
        label: t(lang, 'fixBugs'),
        accelerator: 'CmdOrCtrl+Shift+F',
        click: createCommandSender(getWin, 'ai-fix'),
      },
      { type: 'separator' },
      {
        label: t(lang, 'clearChatHistory'),
        click: createCommandSender(getWin, 'ai-clear-history'),
      },
      {
        label: t(lang, 'clearCheckpoints'),
        click: createCommandSender(getWin, 'ai-clear-checkpoints'),
      },
    ],
  }
}
