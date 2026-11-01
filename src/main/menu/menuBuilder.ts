/**
 * 菜单构建器
 *
 * 职责：
 * 1. 组装完整菜单模板（平台分支 + 动态最近工作空间）
 * 2. 调用 Menu.setApplicationMenu 应用菜单
 * 3. 提供 rebuild(lang) 接口供语言切换时重建
 * 4. 提供动态数据更新接口（最近工作空间）
 *
 * 架构：
 * - macOS: App / File / Edit / View / AI / Window / Help
 * - Windows/Linux: File(含设置+退出) / Edit / View / AI / Help
 */

import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../appBootstrap'
import { t } from './menuI18n'
import { createCommandSender } from './menuActions'
import { buildFileMenu, type RecentWorkspace } from './menuItems/fileMenu'
import { buildEditMenu } from './menuItems/editMenu'
import { buildViewMenu } from './menuItems/viewMenu'
import { buildAiMenu } from './menuItems/aiMenu'
import { buildWindowMenu } from './menuItems/windowMenu'
import { buildHelpMenu } from './menuItems/helpMenu'

/**
 * 可被场景收窄的顶级菜单
 *
 * 与渲染进程自绘菜单（appMenuModel）的 id 保持一致，两套菜单才能按同一份
 * 场景声明显示成相同结构。macOS 的应用名菜单由系统托管，不在此列。
 */
export type MenuBarMenuId = 'file' | 'edit' | 'view' | 'ai' | 'window' | 'help'

/** 菜单构建上下文 */
export interface MenuBuilderContext {
  /** 获取主窗口 */
  getWin: () => BrowserWindow | null
  /** 获取最近工作空间列表 */
  getRecentWorkspaces: () => Promise<RecentWorkspace[]>
  /** 清除最近工作空间 */
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
  /**
   * 当前场景允许显示的顶级菜单
   *
   * null = 不限制（全部显示），空数组 = 全部收起。只影响顶级菜单本身，
   * 已挂载的快捷键 role 随菜单一起消失 —— 场景主动声明时即接受这一结果。
   */
  private visibleMenus: MenuBarMenuId[] | null = null

  constructor(ctx: MenuBuilderContext) {
    this.ctx = ctx
  }

  /**
   * 初始化菜单系统
   * - 构建初始菜单
   */
  async init(lang: Language): Promise<void> {
    this.currentLang = lang
    // 加载最近工作空间
    try {
      this.currentRecentWorkspaces = await this.ctx.getRecentWorkspaces()
    } catch {
      this.currentRecentWorkspaces = []
    }
    this.rebuild()
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
   * 按场景设置可见的顶级菜单并重建
   *
   * 场景切换时由渲染进程调用。传 null 表示恢复完整菜单，避免上一个场景
   * 的收窄结果残留到宿主默认场景。
   */
  setVisibleMenus(ids: MenuBarMenuId[] | null): void {
    const normalized = ids === null ? null : [...new Set(ids)]
    const same =
      normalized === this.visibleMenus ||
      (normalized !== null &&
        this.visibleMenus !== null &&
        normalized.length === this.visibleMenus.length &&
        normalized.every((id) => this.visibleMenus!.includes(id)))
    if (same) return
    this.visibleMenus = normalized
    this.rebuild()
  }

  /** 是否显示某个顶级菜单 */
  private isVisible(id: MenuBarMenuId): boolean {
    return this.visibleMenus === null || this.visibleMenus.includes(id)
  }

  /**
   * 更新最近工作空间并重建菜单
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
    if (this.isVisible('file')) {
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
    }

    // 编辑菜单
    if (this.isVisible('edit')) {
      menus.push(buildEditMenu({ lang: this.currentLang }))
    }

    // 视图菜单
    if (this.isVisible('view')) {
      menus.push(buildViewMenu(commonCtx))
    }

    // AI 菜单
    if (this.isVisible('ai')) {
      menus.push(buildAiMenu(commonCtx))
    }

    // macOS: 窗口菜单
    if (isMac && this.isVisible('window')) {
      menus.push(buildWindowMenu(commonCtx))
    }

    // Windows/Linux: 文件菜单末尾添加设置和退出
    if (!isMac) {
      // 设置和退出已在文件菜单中处理，这里不重复
      // 实际上 Windows 的设置应在 File 菜单末尾，这里通过修改 fileMenu 实现
    }

    // 帮助菜单
    if (this.isVisible('help')) {
      menus.push(buildHelpMenu(commonCtx))
    }

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
