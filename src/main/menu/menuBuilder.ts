/**
 * 菜单构建器
 *
 * 职责：
 * 1. 组装完整菜单模板（平台分支 + 动态场景）
 * 2. 调用 Menu.setApplicationMenu 应用菜单
 * 3. 提供 rebuild(lang) 接口供语言切换时重建
 * 4. 提供动态数据更新接口（最近工作区、场景列表）
 *
 * 架构：
 * - macOS: App / File / Edit / View / Scenario / AI / Window / Help
 * - Windows/Linux: File(含设置+退出) / Edit / View / Scenario / AI / Help
 */

import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../appBootstrap'
import { t } from './menuI18n'
import { createCommandSender } from './menuActions'
import { initScenarioSync } from './menuScenarioSync'
import { buildFileMenu, type RecentWorkspace } from './menuItems/fileMenu'
import { buildEditMenu } from './menuItems/editMenu'
import { buildViewMenu } from './menuItems/viewMenu'
import { buildScenarioMenu } from './menuItems/scenarioMenu'
import { buildAiMenu } from './menuItems/aiMenu'
import { buildWindowMenu } from './menuItems/windowMenu'
import { buildHelpMenu } from './menuItems/helpMenu'

/** 菜单构建上下文 */
export interface MenuBuilderContext {
  /** 获取主窗口 */
  getWin: () => BrowserWindow | null
  /** 获取最近工作区列表 */
  getRecentWorkspaces: () => Promise<RecentWorkspace[]>
  /** 清除最近工作区 */
  onClearRecentWorkspaces: () => Promise<void>
}

/**
 * 菜单构建器实例
 *
 * 单例模式，通过 createMenuBuilder 创建
 */
export class MenuBuilder {
  private ctx: MenuBuilderContext
  private currentLang: Language = 'zh'
  private currentRecentWorkspaces: RecentWorkspace[] = []

  constructor(ctx: MenuBuilderContext) {
    this.ctx = ctx
  }

  /**
   * 初始化菜单系统
   * - 构建初始菜单
   * - 注册场景同步 IPC
   */
  async init(lang: Language): Promise<void> {
    this.currentLang = lang
    // 加载最近工作区
    try {
      this.currentRecentWorkspaces = await this.ctx.getRecentWorkspaces()
    } catch {
      this.currentRecentWorkspaces = []
    }
    this.rebuild()
    // 初始化场景同步（场景列表到达后自动重建菜单）
    initScenarioSync(this.ctx.getWin, () => this.rebuild())
  }

  /**
   * 重建菜单（使用当前语言和缓存数据）
   */
  rebuild(lang?: Language): void {
    if (lang) this.currentLang = lang
    const template = this.buildTemplate()
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  /**
   * 更新最近工作区并重建菜单
   */
  async updateRecentWorkspaces(): Promise<void> {
    try {
      this.currentRecentWorkspaces = await this.ctx.getRecentWorkspaces()
    } catch {
      this.currentRecentWorkspaces = []
    }
    this.rebuild()
  }

  /**
   * 构建完整菜单模板
   */
  private buildTemplate(): MenuItemConstructorOptions[] {
    const isMac = process.platform === 'darwin'
    const commonCtx = { getWin: this.ctx.getWin, lang: this.currentLang }

    const menus: MenuItemConstructorOptions[] = []

    // macOS: 应用菜单（自动生成）
    if (isMac) {
      menus.push(this.buildAppMenu())
    }

    // 文件菜单
    menus.push(
      buildFileMenu({
        ...commonCtx,
        recentWorkspaces: this.currentRecentWorkspaces,
        onClearRecentWorkspaces: async () => {
          await this.ctx.onClearRecentWorkspaces()
          await this.updateRecentWorkspaces()
        },
      }),
    )

    // 编辑菜单
    menus.push(buildEditMenu({ lang: this.currentLang }))

    // 视图菜单
    menus.push(buildViewMenu(commonCtx))

    // 场景菜单（动态）
    menus.push(buildScenarioMenu(commonCtx))

    // AI 菜单
    menus.push(buildAiMenu(commonCtx))

    // macOS: 窗口菜单
    if (isMac) {
      menus.push(buildWindowMenu({ lang: this.currentLang }))
    }

    // Windows/Linux: 文件菜单末尾添加设置和退出
    if (!isMac) {
      // 设置和退出已在文件菜单中处理，这里不重复
      // 实际上 Windows 的设置应在 File 菜单末尾，这里通过修改 fileMenu 实现
    }

    // 帮助菜单
    menus.push(buildHelpMenu(commonCtx))

    return menus
  }

  /**
   * 构建 macOS 应用菜单
   */
  private buildAppMenu(): MenuItemConstructorOptions {
    const lang = this.currentLang
    return {
      label: t(lang, 'app'),
      submenu: [
        {
          label: t(lang, 'about'),
          click: createCommandSender(this.ctx.getWin, 'app.about'),
        },
        {
          label: t(lang, 'settings'),
          accelerator: 'CmdOrCtrl+,',
          click: createCommandSender(this.ctx.getWin, 'settings'),
        },
        { type: 'separator' },
        { role: 'services', label: t(lang, 'services') },
        { type: 'separator' },
        { role: 'hide', label: t(lang, 'hideApp') },
        { role: 'hideOthers', label: t(lang, 'hideOthers') },
        { type: 'separator' },
        { role: 'quit', label: t(lang, 'quit') },
      ],
    }
  }
}

/**
 * 创建菜单构建器单例
 */
let menuBuilderInstance: MenuBuilder | null = null

export function createMenuBuilder(ctx: MenuBuilderContext): MenuBuilder {
  menuBuilderInstance = new MenuBuilder(ctx)
  return menuBuilderInstance
}

/**
 * 获取菜单构建器实例
 */
export function getMenuBuilder(): MenuBuilder | null {
  return menuBuilderInstance
}
