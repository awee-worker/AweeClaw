/**
 * 插件系统 API（Preload 暴露）
 *
 * 覆盖 IPC 频道：
 * - plugin:install             安装插件
 * - plugin:uninstall           卸载插件
 * - plugin:enable              启用插件
 * - plugin:disable             禁用插件
 * - plugin:getInstalled        获取已安装列表
 * - plugin:isInstalled         检查是否已安装
 * - plugin:checkUpdate         检查更新
 * - plugin:installProgress     安装进度事件
 *
 * 注意：
 * - 市场浏览（搜索、详情、分类）由渲染进程通过 backendApi 直连后端完成，
 *   不走主进程 IPC，避免主进程承担网络转发职责
 * - 安装/卸载等涉及本地文件操作的能力才暴露 IPC
 */
import { invoke, on } from '../ipcHelpers'

// ─── 类型（与主进程 PluginInstaller 保持一致，此处仅为 preload 内部使用） ──

/** 预取的下载信息（渲染进程已通过 backendApi 获取时传入，主进程跳过网络请求） */
export interface PluginPreloadedDownloadInfo {
  downloadUrl: string
  checksum: string
  packageSize: number
  manifest?: unknown
  /** 是否为配置型插件（无包文件） */
  configOnly?: boolean
}

/** 预取的插件详情（渲染进程已通过市场列表项构建时传入，主进程跳过网络请求） */
export interface PluginPreloadedDetail {
  pluginId: string
  pluginKey: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  type: string
  icon?: string
  category: string
  tags: string[]
  developerId?: string
  source: string
  isFree: boolean
  price: number
  latestVersion?: string
  totalDownloads: number
  rating: number
  ratingCount: number
  featured: boolean
  minAppVersion?: string
  platforms: string[]
  screenshotUrls: string[]
  homepage?: string
  repository?: string
  license: string
  enabled: boolean
}

export interface PluginInstallParams {
  pluginId: string
  version: string
  backendUrl: string
  authToken?: string
  /** 预取的下载信息（渲染进程已获取时传入，主进程跳过 fetchDownloadInfo） */
  preloadedDownloadInfo?: PluginPreloadedDownloadInfo
  /** 预取的插件详情（渲染进程已获取时传入，主进程跳过 fetchPluginDetail） */
  preloadedPluginDetail?: PluginPreloadedDetail
}

export interface PluginInstallResult {
  success: boolean
  pluginId: string
  pluginKey: string
  version: string
  pluginDir: string
  manifest?: unknown
  mcpServerId?: string
  error?: string
}

export interface PluginInstalledRecord {
  pluginId: string
  pluginKey: string
  version: string
  installedAt: string
  enabled: boolean
  /** 插件类型数组（部分主进程实现可能仅返回 type 单字段，消费方需做兜底） */
  types?: string[]
  /** 单类型字段（主进程 InstalledPluginRecord 实际返回） */
  type?: string
  manifest: unknown
  mcpServerId?: string
}

export interface PluginInstallProgress {
  pluginId: string
  phase: 'pending' | 'downloading' | 'verifying' | 'extracting' | 'registering' | 'mcp_connecting' | 'done' | 'error'
  bytesDownloaded: number
  bytesTotal: number
  percent: number
  message?: string
}

export interface PluginUpdateInfo {
  hasUpdate: boolean
  currentVersion?: string
  latestVersion?: string
}

// ─── API 工厂 ──

export function createPluginApi() {
  return {
    // ── 安装 / 卸载 ──
    pluginInstall: (params: PluginInstallParams) =>
      invoke<PluginInstallResult>('plugin:install')(params),
    pluginUninstall: (pluginKey: string) =>
      invoke<{ success: boolean; error?: string }>('plugin:uninstall')(pluginKey),

    // ── 启用 / 禁用 ──
    pluginEnable: (pluginKey: string) =>
      invoke<{ success: boolean; error?: string }>('plugin:enable')(pluginKey),
    pluginDisable: (pluginKey: string) =>
      invoke<{ success: boolean; error?: string }>('plugin:disable')(pluginKey),

    // ── 查询 ──
    pluginGetInstalled: () =>
      invoke<PluginInstalledRecord[]>('plugin:getInstalled')(),
    pluginIsInstalled: (pluginKey: string) =>
      invoke<boolean>('plugin:isInstalled')(pluginKey),

    // ── 更新 ──
    pluginCheckUpdate: (
      pluginKey: string,
      backendUrl: string,
      authToken?: string,
    ) => invoke<PluginUpdateInfo>('plugin:checkUpdate')(pluginKey, backendUrl, authToken),

    // ── 事件订阅 ──
    onPluginInstallProgress: on<PluginInstallProgress>('plugin:installProgress'),
  }
}
