/**
 * Plugin Bridge — 插件系统主进程 IPC 桥接
 *
 * 职责：
 * - 提供插件安装 / 卸载 / 启用 / 禁用 / 查询等 IPC 接口
 * - 转发安装进度事件到渲染进程
 * - 不负责市场浏览（由渲染进程通过 backendApi 直连后端）
 *
 * IPC 频道：
 * - plugin:install        安装插件（下载+校验+解压+注册+MCP连接）
 * - plugin:uninstall      卸载插件
 * - plugin:enable         启用插件
 * - plugin:disable        禁用插件
 * - plugin:getInstalled   获取已安装列表
 * - plugin:isInstalled    检查是否已安装
 * - plugin:checkUpdate    检查更新
 * - plugin:onInstallProgress  安装进度事件订阅
 */

import { BrowserWindow, app } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { getPluginInstaller } from '../../modules/plugin-sdk/PluginInstaller'
import type {
  InstallParams,
  InstallResult,
  InstallProgress,
  InstalledPluginRecord,
} from '../../modules/plugin-sdk/PluginInstaller'
import type { PluginContributes } from '@shared/plugin-sdk/types'

/** 插件 UI 贡献记录（供渲染进程扩展点加载器使用） */
export interface PluginUiContribution {
  pluginKey: string
  version: string
  /** ui.js 绝对路径（pluginsRoot/pluginKey/version/uiEntry） */
  uiEntryAbsPath: string
  /** UI 贡献声明（sidebarPanels + topActions） */
  contributes: PluginContributes
  /** MCP 服务器 ID（用于 callTool） */
  mcpServerId?: string
}

/** IPC 上下文（与 registerHandlers 一致） */
interface PluginIpcContext {
  getMainWindow: () => BrowserWindow | null
}

/**
 * 注册插件系统 IPC 处理器
 *
 * 必须在 PluginInstaller 初始化后调用。
 */
export function registerPluginHandlers(context: PluginIpcContext): void {
  const { getMainWindow } = context
  const installer = getPluginInstaller(getMainWindow)

  // ── 安装 ──
  safeIpcHandle<InstallResult>(
    'plugin:install',
    async (_event, params: InstallParams) => {
      logger.ipc.info(`[PluginBridge] Install request: ${params.pluginId} v${params.version}`)
      return installer.install(params)
    },
    'plugin',
  )

  // ── 卸载 ──
  safeIpcHandle(
    'plugin:uninstall',
    async (_event, pluginKey: string) => {
      logger.ipc.info(`[PluginBridge] Uninstall request: ${pluginKey}`)
      return installer.uninstall(pluginKey)
    },
    'plugin',
  )

  // ── 启用 ──
  safeIpcHandle(
    'plugin:enable',
    async (_event, pluginKey: string) => {
      return installer.enable(pluginKey)
    },
    'plugin',
  )

  // ── 禁用 ──
  safeIpcHandle(
    'plugin:disable',
    async (_event, pluginKey: string) => {
      return installer.disable(pluginKey)
    },
    'plugin',
  )

  // ── 已安装列表 ──
  safeIpcHandle<InstalledPluginRecord[]>(
    'plugin:getInstalled',
    async () => {
      return installer.getInstalledList()
    },
    'plugin',
  )

  // ── 插件 UI 贡献列表（用于扩展点加载器） ──
  // 返回有 contributes.ui 的已安装插件，含 ui.js 绝对路径和 contributes 声明
  safeIpcHandle<PluginUiContribution[]>(
    'plugin:getUiContributions',
    async () => {
      const installed = installer.getInstalledList()
      const result: PluginUiContribution[] = []
      for (const rec of installed) {
        const contributes = rec.manifest?.contributes
        if (!contributes?.ui?.entry || !rec.enabled) continue
        const pluginDir = path.join(
          app.getPath('userData'),
          'plugins',
          rec.pluginKey,
          rec.version,
        )
        const uiEntryAbsPath = path.join(pluginDir, contributes.ui.entry)
        result.push({
          pluginKey: rec.pluginKey,
          version: rec.version,
          uiEntryAbsPath,
          contributes,
          mcpServerId: rec.mcpServerId,
        })
      }
      return result
    },
    'plugin',
  )

  // ── 检查是否已安装 ──
  safeIpcHandle<boolean>(
    'plugin:isInstalled',
    async (_event, pluginKey: string) => {
      return installer.isInstalled(pluginKey)
    },
    'plugin',
  )

  // ── 检查更新 ──
  safeIpcHandle(
    'plugin:checkUpdate',
    async (
      _event,
      pluginKey: string,
      backendUrl: string,
      authToken?: string,
    ) => {
      // 后端返回 { needsUpdate, currentVersion, latestVersion }
      // 前端期望 { hasUpdate, currentVersion, latestVersion }
      // 这里做字段转换，避免前端拿到 hasUpdate=undefined
      const result = await installer.checkUpdate(pluginKey, backendUrl, authToken)
      return {
        hasUpdate: result.needsUpdate,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      }
    },
    'plugin',
  )

  // ── 读取插件用户配置 ──
  safeIpcHandle<Record<string, string>>(
    'plugin:getConfig',
    async (_event, pluginKey: string) => {
      return installer.getPluginConfig(pluginKey)
    },
    'plugin',
  )

  // ── 保存插件用户配置（并触发 MCP 重连） ──
  safeIpcHandle<{ success: boolean; reconnected: boolean; error?: string }>(
    'plugin:saveConfig',
    async (_event, pluginKey: string, values: Record<string, string>) => {
      logger.ipc.info(`[PluginBridge] Save config request: ${pluginKey}`)
      try {
        const reconnected = await installer.savePluginConfig(pluginKey, values)
        return { success: true, reconnected }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, reconnected: false, error: msg }
      }
    },
    'plugin',
  )

  logger.ipc.info('[PluginBridge] IPC handlers registered')
}

/**
 * 推送安装进度事件到渲染进程
 *
 * 由 PluginInstaller 内部调用，渲染进程通过 `plugin:onInstallProgress` 订阅。
 */
export function emitPluginInstallProgress(
  getMainWindow: () => BrowserWindow | null,
  progress: InstallProgress,
): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('plugin:installProgress', progress)
  }
}
