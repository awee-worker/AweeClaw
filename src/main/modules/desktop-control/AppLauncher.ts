/**
 * 应用启动器（L1）
 * 封装平台适配器，提供应用启动、退出、查询等业务级 API
 * 与 DesktopControlManager 协作完成权限校验与审计
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './platform/types'
import type { AppInfo, LaunchResult, ActionResult } from './types/actions'

export class AppLauncher {
  constructor(private adapter: PlatformAdapter) {}

  /** 启动应用 */
  async launch(name: string, args?: string[]): Promise<LaunchResult> {
    logger.desktop.info(`[AppLauncher] launch: ${name}`, args ? { args } : undefined)
    return this.adapter.launchApp(name, args)
  }

  /** 退出应用 */
  async quit(name: string): Promise<ActionResult> {
    logger.desktop.info(`[AppLauncher] quit: ${name}`)
    return this.adapter.quitApp(name)
  }

  /** 列出已安装应用 */
  async listInstalled(): Promise<AppInfo[]> {
    return this.adapter.listInstalledApps()
  }

  /** 查找已安装应用 */
  async find(name: string): Promise<AppInfo | null> {
    return this.adapter.findApp(name)
  }

  /** 用默认浏览器打开 URL */
  async openUrl(url: string): Promise<ActionResult> {
    logger.desktop.info(`[AppLauncher] openUrl: ${url}`)
    return this.adapter.openUrl(url)
  }

  /** 用默认程序打开文件 */
  async openFile(filePath: string): Promise<ActionResult> {
    logger.desktop.info(`[AppLauncher] openFile: ${filePath}`)
    return this.adapter.openFile(filePath)
  }
}
