/**
 * Plugin Installer — 插件安装器
 *
 * 负责从后端市场下载、校验、解压、注册插件，并联动 PluginRegistry 与 MCP Manager。
 *
 * 核心流程：
 *   1. 通过后端 API 获取下载信息（URL + SHA256 + 大小）
 *   2. 下载 .tar.gz 到临时目录（支持断点续传）
 *   3. 校验 SHA256（可选签名校验）
 *   4. 解压到 userData/plugins/<pluginKey>/<version>/
 *   5. 读取 manifest.json，注册到 PluginRegistry
 *   6. 若为 MCP 型插件，向 McpManager 注册并自动连接
 *
 * 目录结构：
 *   userData/
 *   └── plugins/
 *       └── <pluginKey>/
 *           └── <version>/
 *               ├── manifest.json
 *               ├── package.json
 *               └── dist/...
 *
 * 安装记录持久化：
 *   userData/plugins/installed.json — 记录已安装的插件元信息
 *
 * @module plugin-sdk/installer
 */

import { app, BrowserWindow, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import * as tar from 'tar'
import { logger } from '@shared/toolkit/LogEngine'
import { getPluginRegistry } from './PluginRegistry'
import { McpClient } from '../tool-protocol/ToolProtocolClient'
import type { PluginManifest, PluginType } from '@shared/plugin-sdk/types'
import type { McpPluginServerConfig } from '@shared/protocols/toolProtocolBridge'

// ============================================
// 类型定义
// ============================================

/** 后端插件市场 API 返回的插件详情 */
export interface MarketplacePluginDetail {
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

/** 后端返回的下载信息 */
export interface PluginDownloadInfo {
  downloadUrl: string
  checksum: string
  packageSize: number
  /** 配置型插件返回 manifest，客户端无需下载包文件 */
  manifest?: PluginManifest
  /** 是否为配置型插件（无包文件） */
  configOnly?: boolean
}

/** 已安装插件记录 */
export interface InstalledPluginRecord {
  pluginId: string
  pluginKey: string
  version: string
  name: string
  nameZh: string
  type: string
  icon?: string
  installedAt: number
  manifest: PluginManifest
  /** MCP 服务器 ID（若为 MCP 型插件） */
  mcpServerId?: string
  /** 是否启用 */
  enabled: boolean
}

/** 安装参数 */
export interface InstallParams {
  /** 后端插件 ID */
  pluginId: string
  /** 要安装的版本号 */
  version: string
  /** 后端服务基础 URL（如 https://api.aweeclaw.com） */
  backendUrl: string
  /** 用户访问令牌（JWT） */
  authToken?: string
  /** 预取的下载信息（渲染进程已获取时传入，主进程跳过网络请求） */
  preloadedDownloadInfo?: PluginDownloadInfo
  /** 预取的插件详情（渲染进程已获取时传入，主进程跳过网络请求） */
  preloadedPluginDetail?: MarketplacePluginDetail
  /**
   * 用户填写的插件配置值（覆盖 defaultValue）。
   * 用于 {{config.KEY}} 模板替换，如 API Key 等用户专属配置。
   * 安装完成后会持久化到 plugin-configs.json。
   */
  userConfig?: Record<string, string>
}

/** 安装结果 */
export interface InstallResult {
  success: boolean
  pluginId: string
  pluginKey?: string
  version?: string
  pluginDir?: string
  manifest?: PluginManifest
  mcpServerId?: string
  error?: string
  /** MCP 服务连接错误（安装成功但 MCP 连接失败时填充） */
  mcpConnectError?: string
}

/** 卸载结果 */
export interface UninstallResult {
  success: boolean
  pluginKey: string
  error?: string
}

/** 安装进度事件 */
export interface InstallProgress {
  pluginId: string
  phase: 'downloading' | 'verifying' | 'extracting' | 'registering' | 'done' | 'error'
  bytesDownloaded: number
  bytesTotal: number
  percent: number
  message?: string
}

/** 进度回调类型 */
export type ProgressCallback = (progress: InstallProgress) => void

// ============================================
// 常量
// ============================================

const INSTALLED_RECORD_FILE = 'installed.json'
const PLUGIN_CONFIG_FILE = 'plugin-configs.json'
const BACKUP_DIR = '.backups'

// ============================================
// PluginInstaller 实现
// ============================================

export class PluginInstaller {
  private pluginsRoot: string
  private recordPath: string
  private pluginConfigPath: string
  private installedRecords = new Map<string, InstalledPluginRecord>()
  /** 插件用户配置：pluginKey -> { KEY: value }（用于 {{config.KEY}} 模板替换） */
  private pluginConfigs = new Map<string, Record<string, string>>()
  /**
   * 内置插件记录表（pluginKey -> record）。
   * 由随应用打包的内置插件（如 computer-use）调用 registerBuiltin 注册，
   * getInstalledList 会合并内置与外部安装的记录一并返回。
   */
  private builtinRecords = new Map<string, InstalledPluginRecord>()
  private progressCallbacks = new Set<ProgressCallback>()
  private getMainWindow: () => BrowserWindow | null

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow
    this.pluginsRoot = path.join(app.getPath('userData'), 'plugins')
    this.recordPath = path.join(this.pluginsRoot, INSTALLED_RECORD_FILE)
    this.pluginConfigPath = path.join(this.pluginsRoot, PLUGIN_CONFIG_FILE)
    this.ensureDirs()
    this.loadInstalledRecords()
    this.loadPluginConfigs()
  }

  /**
   * 注册内置插件（供随应用打包的插件调用，如 computer-use）。
   * 注册后会出现在已安装列表中，标记为内置且不可卸载。
   */
  registerBuiltin(record: InstalledPluginRecord): void {
    this.builtinRecords.set(record.pluginKey, record)
    logger.system.info(`[PluginInstaller] Registered builtin plugin: ${record.pluginKey}`)
  }

  /** 注销内置插件 */
  unregisterBuiltin(pluginKey: string): void {
    this.builtinRecords.delete(pluginKey)
  }

  // ============================================
  // 公开 API
  // ============================================

  /**
   * 安装插件
   *
   * 支持两种模式：
   * - 标准模式：下载 .tar.gz -> 校验 SHA256 -> 解压 -> 注册 -> 联动 MCP
   * - 配置型模式：直接使用后端返回的 manifest，跳过下载/校验/解压
   *             适用于通过 npx/uvx 调用外部包的 MCP 插件
   */
  async install(params: InstallParams): Promise<InstallResult> {
    const { pluginId, version, backendUrl, authToken, preloadedDownloadInfo, preloadedPluginDetail, userConfig } = params

    logger.system.info(`[PluginInstaller] Installing plugin ${pluginId} v${version}`)

    try {
      // 1. 获取下载信息 + 插件详情（优先使用渲染进程预取的数据，避免主进程网络请求失败）
      this.emitProgress(pluginId, 'downloading', 0, 0, 'Fetching download info...')
      const downloadInfo = preloadedDownloadInfo ?? await this.fetchDownloadInfo(backendUrl, pluginId, version, authToken)
      const pluginDetail = preloadedPluginDetail ?? await this.fetchPluginDetail(backendUrl, pluginId, authToken)

      // 分支：配置型插件（无包文件）
      if (downloadInfo.configOnly && downloadInfo.manifest) {
        return await this.installConfigOnly(
          pluginId,
          version,
          pluginDetail,
          downloadInfo,
          backendUrl,
          authToken,
          userConfig,
        )
      }

      // 标准模式：下载 -> 校验 -> 解压 -> 注册 -> 联动 MCP
      // 2. 下载文件
      const tmpDir = path.join(this.pluginsRoot, 'tmp')
      const archivePath = path.join(tmpDir, `${pluginDetail.pluginKey}-${version}.tar.gz`)
      await this.downloadFile(
        downloadInfo.downloadUrl,
        archivePath,
        pluginId,
        downloadInfo.packageSize,
      )

      // 3. 校验 SHA256
      this.emitProgress(pluginId, 'verifying', downloadInfo.packageSize, downloadInfo.packageSize, 'Verifying checksum...')
      if (!this.verifyChecksum(archivePath, downloadInfo.checksum)) {
        fs.unlinkSync(archivePath)
        return this.fail(pluginId, 'Checksum verification failed. The package may be corrupted or tampered with.')
      }

      // 4. 解压
      this.emitProgress(pluginId, 'extracting', downloadInfo.packageSize, downloadInfo.packageSize, 'Extracting...')
      const pluginDir = path.join(this.pluginsRoot, pluginDetail.pluginKey, version)
      await this.extractTarGz(archivePath, pluginDir)

      // 清理临时文件
      try { fs.unlinkSync(archivePath) } catch { /* ignore */ }

      // 5. 读取并校验 manifest
      const manifest = this.readManifest(pluginDir)
      if (!manifest) {
        fs.rmSync(pluginDir, { recursive: true, force: true })
        return this.fail(pluginId, 'Invalid plugin package: manifest.json missing or invalid')
      }

      if (manifest.id !== pluginDetail.pluginKey) {
        fs.rmSync(pluginDir, { recursive: true, force: true })
        return this.fail(pluginId, `manifest.id (${manifest.id}) does not match pluginKey (${pluginDetail.pluginKey})`)
      }

      // 6-9. 注册 + 联动 MCP + 持久化 + 上报
      return await this.finalizeInstall(
        pluginId,
        version,
        pluginDetail,
        manifest,
        pluginDir,
        backendUrl,
        authToken,
        downloadInfo.packageSize,
        userConfig,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.system.error(`[PluginInstaller] Install failed for ${pluginId}: ${msg}`)
      this.emitProgress(pluginId, 'error', 0, 0, msg)
      return this.fail(pluginId, msg)
    }
  }

  /**
   * 配置型插件安装（无包文件）
   *
   * 适用于通过 npx/uvx 调用外部包的 MCP 插件：
   * - 跳过下载/校验/解压
   * - 直接使用后端返回的 manifest
   * - 在本地创建轻量级插件目录（仅含 manifest.json）
   * - 注册到 PluginRegistry + McpClient
   */
  private async installConfigOnly(
    pluginId: string,
    version: string,
    pluginDetail: MarketplacePluginDetail,
    downloadInfo: PluginDownloadInfo,
    backendUrl: string,
    authToken?: string,
    userConfig?: Record<string, string>,
  ): Promise<InstallResult> {
    const manifest = downloadInfo.manifest!

    // 校验 manifest.id 与 pluginKey 一致
    if (manifest.id !== pluginDetail.pluginKey) {
      return this.fail(
        pluginId,
        `manifest.id (${manifest.id}) does not match pluginKey (${pluginDetail.pluginKey})`,
      )
    }

    logger.system.info(
      `[PluginInstaller] Installing config-only plugin ${pluginDetail.pluginKey} v${version}`,
    )

    // 1. 创建轻量级插件目录（manifest.json + 可选的内联代码文件）
    const pluginDir = path.join(this.pluginsRoot, pluginDetail.pluginKey, version)
    fs.mkdirSync(pluginDir, { recursive: true })

    // 写入 manifest（排除 inlineCode 字段，避免本地 manifest 过大）
    const { inlineCode, ...manifestWithoutCode } = manifest as typeof manifest & { inlineCode?: string }
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(manifestWithoutCode, null, 2),
      'utf-8',
    )

    // 如果 manifest 内联了代码（inlineCode），写入入口文件
    // 这使 configOnly 模式也能支持自包含代码插件（无需 MinIO 存储服务）
    if (inlineCode && manifest.main) {
      const entryPath = path.join(pluginDir, manifest.main)
      // 确保入口文件所在目录存在（manifest.main 可能含子路径，如 "dist/index.js"）
      const entryDir = path.dirname(entryPath)
      if (!fs.existsSync(entryDir)) {
        fs.mkdirSync(entryDir, { recursive: true })
      }
      fs.writeFileSync(entryPath, inlineCode, 'utf-8')
      // 写入 package.json 声明 ESM 模块类型，否则 Node.js 将 .js 按 CommonJS 解析
      // 导致 import 语法报错
      fs.writeFileSync(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2),
        'utf-8',
      )
      logger.system.info(
        `[PluginInstaller] Inline code extracted to ${manifest.main} (${inlineCode.length} chars)`,
      )
    }

    // 2. 注册 + 联动 MCP + 持久化 + 上报（复用公共逻辑）
    return await this.finalizeInstall(
      pluginId,
      version,
      pluginDetail,
      manifest,
      pluginDir,
      backendUrl,
      authToken,
      0,
      userConfig,
    )
  }

  /**
   * 安装收尾公共逻辑：注册到 Registry + 联动 MCP + 持久化 + 上报
   *
   * 标准模式与配置型模式共用此方法。
   */
  private async finalizeInstall(
    pluginId: string,
    version: string,
    pluginDetail: MarketplacePluginDetail,
    manifest: PluginManifest,
    pluginDir: string,
    backendUrl: string,
    authToken: string | undefined,
    packageSize: number,
    userConfig?: Record<string, string>,
  ): Promise<InstallResult> {
    // 注册到 PluginRegistry
    this.emitProgress(pluginId, 'registering', packageSize, packageSize, 'Registering...')
    const registry = getPluginRegistry(this.pluginsRoot)
    registry.addSearchDir(path.join(this.pluginsRoot, pluginDetail.pluginKey))

    // 注册目录映射到 McpClient（供插件型 MCP 连接使用）
    McpClient.registerPluginDir(pluginDetail.pluginKey, pluginDir)

    // 若与已安装旧版本不同，先卸载旧的运行时
    const existing = this.installedRecords.get(pluginDetail.pluginKey)
    if (existing && existing.version !== version) {
      try {
        await registry.unload(pluginDetail.pluginKey)
        // 移除旧版本目录
        const oldDir = path.join(this.pluginsRoot, pluginDetail.pluginKey, existing.version)
        if (fs.existsSync(oldDir) && oldDir !== pluginDir) {
          fs.rmSync(oldDir, { recursive: true, force: true })
        }
      } catch (err) {
        logger.system.warn(`[PluginInstaller] Failed to unload old version: ${err}`)
      }
    }

    // 配置型插件无入口模块（main 为空），仅当存在 main 时才 load/initialize
    // 但 MCP 型插件例外：其入口是 MCP 工厂函数（createMcpServer），
    // 真正的激活由下面的 registerMcpServer + connectPluginInProcess 完成，
    // 不需要 PluginRegistry 加载 PluginRuntime（否则会因导出形状不匹配而报错）
    //
    // 注意：in-process MCP 插件可能 type='tool' 但具备 capabilities.mcp，
    // 仅凭 type 不足以识别，必须同时检查 capabilities.mcp 是否存在。
    const types = Array.isArray(manifest.type) ? manifest.type : [manifest.type]
    const hasMcpCapability = !!manifest.capabilities?.mcp
    const isMcpPlugin = types.includes('mcp' as PluginType) || hasMcpCapability
    const hasEntry = !!manifest.main
    if (hasEntry && !isMcpPlugin) {
      await registry.discover()
      await registry.load(pluginDetail.pluginKey)
      await registry.initialize(pluginDetail.pluginKey)
    } else {
      // 配置型插件 或 MCP 型插件（含 in-process MCP）：仅 discover 以便出现在列表中，不 load/initialize
      await registry.discover()
    }

    // 若为 MCP 型插件，注册并连接 MCP 服务
    let mcpServerId: string | undefined
    let mcpConnectError: string | undefined
    if (isMcpPlugin && hasMcpCapability) {
      const mcpResult = await this.registerMcpServer(pluginDetail, version, manifest, userConfig, pluginId, packageSize)
      mcpServerId = mcpResult.serverId
      mcpConnectError = mcpResult.connectError
    }

    // 持久化安装记录
    const record: InstalledPluginRecord = {
      pluginId,
      pluginKey: pluginDetail.pluginKey,
      version,
      name: pluginDetail.name,
      nameZh: pluginDetail.nameZh,
      type: pluginDetail.type,
      icon: pluginDetail.icon,
      installedAt: Date.now(),
      manifest,
      mcpServerId,
      enabled: true,
    }
    this.installedRecords.set(pluginDetail.pluginKey, record)
    this.saveInstalledRecords()

    // 持久化用户配置（若有），便于后续重连或升级时复用
    if (userConfig && Object.keys(userConfig).length > 0) {
      this.pluginConfigs.set(pluginDetail.pluginKey, { ...userConfig })
      this.savePluginConfigs()
    }

    // 上报安装到后端
    this.reportInstall(backendUrl, pluginId, version, authToken).catch((err) => {
      logger.system.warn(`[PluginInstaller] Failed to report install: ${err}`)
    })

    this.emitProgress(pluginId, 'done', packageSize, packageSize, 'Installed')
    logger.system.info(
      `[PluginInstaller] Plugin ${pluginDetail.pluginKey} v${version} installed to ${pluginDir}`,
    )

    return {
      success: true,
      pluginId,
      pluginKey: pluginDetail.pluginKey,
      version,
      pluginDir,
      manifest,
      mcpServerId,
      mcpConnectError,
    }
  }

  /**
   * 卸载插件
   *
   * 流程：卸载运行时 -> 断开 MCP -> 删除目录 -> 移除记录
   */
  async uninstall(pluginKey: string): Promise<UninstallResult> {
    logger.system.info(`[PluginInstaller] Uninstalling plugin ${pluginKey}`)

    // 内置插件不允许卸载（仅可禁用）
    if (this.builtinRecords.has(pluginKey)) {
      return { success: false, pluginKey, error: 'Built-in plugin cannot be uninstalled, please disable it instead' }
    }

    const record = this.installedRecords.get(pluginKey)
    if (!record) {
      return { success: false, pluginKey, error: 'Plugin not installed' }
    }

    try {
      // 1. 卸载运行时
      const registry = getPluginRegistry(this.pluginsRoot)
      try {
        await registry.unload(pluginKey)
      } catch (err) {
        logger.system.warn(`[PluginInstaller] Failed to unload runtime: ${err}`)
      }

      // 2. 断开并移除 MCP 服务
      if (record.mcpServerId) {
        try {
          const { mcpManager } = await import('../tool-protocol/ToolProtocolManager')
          await mcpManager.disconnectServer(record.mcpServerId)
          await mcpManager.removeServer(record.mcpServerId, 'user')
        } catch (err) {
          logger.system.warn(`[PluginInstaller] Failed to disconnect MCP: ${err}`)
        }
      }

      // 3. 移除目录映射
      McpClient.unregisterPluginDir(pluginKey)

      // 4. 删除插件目录
      const pluginDir = path.join(this.pluginsRoot, pluginKey)
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true })
      }

      // 5. 移除安装记录 + 用户配置
      this.installedRecords.delete(pluginKey)
      this.saveInstalledRecords()
      this.deletePluginConfig(pluginKey)

      logger.system.info(`[PluginInstaller] Plugin ${pluginKey} uninstalled`)
      return { success: true, pluginKey }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.system.error(`[PluginInstaller] Uninstall failed for ${pluginKey}: ${msg}`)
      return { success: false, pluginKey, error: msg }
    }
  }

  /**
   * 启用插件
   *
   * 流程：
   * 1. 调用 registry.enable 激活运行时（MCP 型插件跳过 load/initialize）
   * 2. MCP 型插件：重连 MCP 服务
   *    - 优先 toggle + connect（同会话内禁用后再启用的场景，服务仍在 mcpManager 中）
   *    - 若失败（应用重启后禁用插件未参与 restoreInstalled 的 MCP 重连，服务可能不存在），
   *      回退到 registerMcpServer 重新注册并连接
   * 3. 持久化 enabled = true
   */
  async enable(pluginKey: string): Promise<{ success: boolean; error?: string }> {
    const record = this.installedRecords.get(pluginKey)
    if (!record) {
      return { success: false, error: 'Plugin not installed' }
    }

    try {
      const registry = getPluginRegistry(this.pluginsRoot)
      await registry.enable(pluginKey)

      // MCP 型插件：重连 MCP 服务
      if (record.mcpServerId && record.manifest?.capabilities?.mcp) {
        const { mcpManager } = await import('../tool-protocol/ToolProtocolManager')
        try {
          // 同会话内禁用 → 启用：服务仍在 mcpManager 中，直接解除禁用并重连
          await mcpManager.toggleServer(record.mcpServerId, false, 'user')
          await mcpManager.connectServer(record.mcpServerId)
        } catch (mcpErr) {
          // 重连失败：可能因应用重启后禁用插件未注册 MCP 服务
          // 回退到重新注册 + 连接（registerMcpServer 内部会 addServer + connectServer）
          logger.system.warn(
            `[PluginInstaller] MCP reconnect failed for ${pluginKey}, re-registering: ${mcpErr instanceof Error ? mcpErr.message : String(mcpErr)}`,
          )
          await this.registerMcpServer(
            {
              pluginId: record.pluginId,
              pluginKey: record.pluginKey,
              name: record.name,
              nameZh: record.nameZh,
              type: record.type,
            },
            record.version,
            record.manifest,
          )
        }
      }

      record.enabled = true
      this.saveInstalledRecords()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 禁用插件
   */
  async disable(pluginKey: string): Promise<{ success: boolean; error?: string }> {
    const record = this.installedRecords.get(pluginKey)
    if (!record) {
      return { success: false, error: 'Plugin not installed' }
    }

    try {
      const registry = getPluginRegistry(this.pluginsRoot)
      await registry.disable(pluginKey)

      if (record.mcpServerId) {
        const { mcpManager } = await import('../tool-protocol/ToolProtocolManager')
        await mcpManager.toggleServer(record.mcpServerId, true, 'user')
      }

      record.enabled = false
      this.saveInstalledRecords()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 获取已安装插件列表（合并内置插件与外部安装的插件） */
  getInstalledList(): InstalledPluginRecord[] {
    return Array.from(this.installedRecords.values()).concat(
      Array.from(this.builtinRecords.values()),
    )
  }

  /** 获取已安装插件记录（含内置插件） */
  getInstalled(pluginKey: string): InstalledPluginRecord | undefined {
    return this.installedRecords.get(pluginKey) ?? this.builtinRecords.get(pluginKey)
  }

  /** 检查是否已安装（含内置插件） */
  isInstalled(pluginKey: string): boolean {
    return this.installedRecords.has(pluginKey) || this.builtinRecords.has(pluginKey)
  }

  /** 检查更新（返回后端最新版本号，若需要更新） */
  async checkUpdate(
    pluginKey: string,
    backendUrl: string,
    authToken?: string,
  ): Promise<{ needsUpdate: boolean; currentVersion?: string; latestVersion?: string }> {
    const record = this.installedRecords.get(pluginKey)
    if (!record) {
      return { needsUpdate: false }
    }

    try {
      const detail = await this.fetchPluginDetail(backendUrl, record.pluginId, authToken)
      const latest = detail.latestVersion
      if (!latest) return { needsUpdate: false, currentVersion: record.version }

      return {
        needsUpdate: latest !== record.version,
        currentVersion: record.version,
        latestVersion: latest,
      }
    } catch (err) {
      logger.system.warn(`[PluginInstaller] Check update failed: ${err}`)
      return { needsUpdate: false, currentVersion: record.version }
    }
  }

  /** 注册进度回调 */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => { this.progressCallbacks.delete(callback) }
  }

  /**
   * 应用启动时恢复已安装插件
   *
   * - 重新注册目录映射
   * - 重新发现并加载 PluginRegistry
   * - MCP 型插件自动注册并连接（若 autoConnect=true）
   */
  async restoreInstalled(): Promise<void> {
    logger.system.info(`[PluginInstaller] Restoring ${this.installedRecords.size} installed plugin(s)`)

    const registry = getPluginRegistry(this.pluginsRoot)

    for (const [pluginKey, record] of this.installedRecords) {
      try {
        const pluginDir = path.join(this.pluginsRoot, pluginKey, record.version)
        if (!fs.existsSync(pluginDir)) {
          logger.system.warn(`[PluginInstaller] Plugin directory missing: ${pluginDir}, removing record`)
          this.installedRecords.delete(pluginKey)
          continue
        }

        McpClient.registerPluginDir(pluginKey, pluginDir)

        // 始终将插件目录加入搜索路径并 discover，使插件出现在 registrations Map 中。
        // 这样禁用的插件也能被 enable() 找到，避免 "Plugin not found" 错误。
        // （discover 内部对同一 id 仅保留最新版本，重复调用安全）
        registry.addSearchDir(path.join(this.pluginsRoot, pluginKey))
        await registry.discover()

        if (record.enabled) {
          // 仅对启用的插件执行 load/initialize 和 MCP 自动连接

          // MCP 型插件跳过 load/initialize（入口是 MCP 工厂函数，不是 PluginRuntime）
          // 真正的激活由下面的 MCP 重连逻辑完成
          // 注意：in-process MCP 插件可能 type='tool' 但具备 capabilities.mcp，
          // 仅凭 type 不足以识别，必须同时检查 capabilities.mcp 是否存在。
          const recordTypes = Array.isArray(record.type) ? record.type : [record.type]
          const hasRecordMcpCapability = !!record.manifest?.capabilities?.mcp
          const isRecordMcp =
            recordTypes.includes('mcp' as PluginType) || hasRecordMcpCapability
          const hasRecordEntry = !!record.manifest?.main
          if (hasRecordEntry && !isRecordMcp) {
            try {
              await registry.load(pluginKey)
              await registry.initialize(pluginKey)
            } catch (err) {
              logger.system.warn(`[PluginInstaller] Failed to restore plugin ${pluginKey}: ${err}`)
              // 加载失败时，清理本地无效版本目录和安装记录
              // 避免残留的旧版本（如代码已失效）阻止用户重新安装新版本
              try {
                const failedDir = path.join(this.pluginsRoot, pluginKey, record.version)
                if (fs.existsSync(failedDir)) {
                  fs.rmSync(failedDir, { recursive: true, force: true })
                }
                this.installedRecords.delete(pluginKey)
                this.saveInstalledRecords()
                logger.system.info(
                  `[PluginInstaller] Cleaned up failed plugin ${pluginKey} v${record.version} (record + directory removed)`,
                )
              } catch (cleanupErr) {
                logger.system.warn(
                  `[PluginInstaller] Failed to clean up plugin ${pluginKey}: ${cleanupErr}`,
                )
              }
              continue
            }
          }

          // MCP 型插件自动连接
          if (record.mcpServerId && record.manifest.capabilities?.mcp?.autoConnect !== false) {
            try {
              const mcpResult = await this.registerMcpServer(
                {
                  pluginId: record.pluginId,
                  pluginKey: record.pluginKey,
                  name: record.name,
                  nameZh: record.nameZh,
                  type: record.type,
                },
                record.version,
                record.manifest,
              )
              if (mcpResult.connectError) {
                logger.system.warn(
                  `[PluginInstaller] MCP reconnect failed for ${pluginKey}: ${mcpResult.connectError}`,
                )
              }
            } catch (err) {
              logger.system.warn(`[PluginInstaller] Failed to reconnect MCP for ${pluginKey}: ${err}`)
            }
          }
        }
      } catch (err) {
        logger.system.error(`[PluginInstaller] Restore failed for ${pluginKey}: ${err}`)
      }
    }

    this.saveInstalledRecords()
  }

  // ============================================
  // 私有方法
  // ============================================

  /** 确保必要目录存在 */
  private ensureDirs(): void {
    if (!fs.existsSync(this.pluginsRoot)) {
      fs.mkdirSync(this.pluginsRoot, { recursive: true })
    }
    const tmpDir = path.join(this.pluginsRoot, 'tmp')
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true })
    }
    const backupDir = path.join(this.pluginsRoot, BACKUP_DIR)
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }
  }

  /** 加载已安装记录 */
  private loadInstalledRecords(): void {
    if (!fs.existsSync(this.recordPath)) return
    try {
      const raw = fs.readFileSync(this.recordPath, 'utf-8')
      const records = JSON.parse(raw) as InstalledPluginRecord[]
      for (const r of records) {
        this.installedRecords.set(r.pluginKey, r)
      }
      logger.system.info(`[PluginInstaller] Loaded ${this.installedRecords.size} installed record(s)`)
    } catch (err) {
      logger.system.warn(`[PluginInstaller] Failed to load installed records: ${err}`)
    }
  }

  /** 保存已安装记录 */
  private saveInstalledRecords(): void {
    try {
      const records = Array.from(this.installedRecords.values())
      fs.writeFileSync(this.recordPath, JSON.stringify(records, null, 2), 'utf-8')
    } catch (err) {
      logger.system.error(`[PluginInstaller] Failed to save installed records: ${err}`)
    }
  }

  // ============================================
  // 插件用户配置（{{config.KEY}} 模板变量持久化）
  // ============================================

  /** 加载插件用户配置 */
  private loadPluginConfigs(): void {
    if (!fs.existsSync(this.pluginConfigPath)) return
    try {
      const raw = fs.readFileSync(this.pluginConfigPath, 'utf-8')
      const data = JSON.parse(raw) as Record<string, Record<string, string>>
      for (const [key, value] of Object.entries(data)) {
        this.pluginConfigs.set(key, value)
      }
      logger.system.info(`[PluginInstaller] Loaded ${this.pluginConfigs.size} plugin config(s)`)
    } catch (err) {
      logger.system.warn(`[PluginInstaller] Failed to load plugin configs: ${err}`)
    }
  }

  /** 保存所有插件用户配置 */
  private savePluginConfigs(): void {
    try {
      const data: Record<string, Record<string, string>> = {}
      for (const [key, value] of this.pluginConfigs.entries()) {
        data[key] = value
      }
      fs.writeFileSync(this.pluginConfigPath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      logger.system.error(`[PluginInstaller] Failed to save plugin configs: ${err}`)
    }
  }

  /**
   * 读取插件用户配置。
   * @returns 该插件的所有用户配置键值对（可能为空对象）
   */
  getPluginConfig(pluginKey: string): Record<string, string> {
    return { ...(this.pluginConfigs.get(pluginKey) || {}) }
  }

  /**
   * 保存插件用户配置并触发 MCP 服务器重连（若该插件是 MCP 型且已注册）。
   * @param pluginKey 插件 key
   * @param values 配置键值对（会整体覆盖该插件的原有配置）
   * @returns 是否触发了 MCP 重连
   */
  async savePluginConfig(pluginKey: string, values: Record<string, string>): Promise<boolean> {
    this.pluginConfigs.set(pluginKey, { ...values })
    this.savePluginConfigs()
    logger.system.info(`[PluginInstaller] Saved plugin config for ${pluginKey}: ${Object.keys(values).join(', ')}`)

    // 若该插件已安装且为 MCP 型，重新注册并重连
    const record = this.installedRecords.get(pluginKey)
    if (!record || !record.mcpServerId) return false

    const types = Array.isArray(record.manifest.type) ? record.manifest.type : [record.manifest.type]
    if (!types.includes('mcp' as PluginType)) return false
    if (!record.manifest.capabilities?.mcp) return false

    try {
      // 重新注册（用新配置生成 McpPluginServerConfig 并覆盖到配置文件）
      await this.registerMcpServer(
        {
          pluginId: record.pluginId,
          pluginKey: record.pluginKey,
          name: record.name,
          nameZh: record.nameZh,
          type: record.type,
        },
        record.version,
        record.manifest,
      )
      // 重连 MCP 服务器
      const { mcpManager } = await import('../tool-protocol/ToolProtocolManager')
      await mcpManager.reconnectServer(record.mcpServerId)
      logger.system.info(`[PluginInstaller] Reconnected MCP server after config update: ${record.mcpServerId}`)
      return true
    } catch (err) {
      logger.system.error(`[PluginInstaller] Failed to reconnect MCP after config update: ${err}`)
      return false
    }
  }

  /** 删除插件用户配置（卸载时调用） */
  private deletePluginConfig(pluginKey: string): void {
    if (this.pluginConfigs.delete(pluginKey)) {
      this.savePluginConfigs()
    }
  }

  /** 从后端获取下载信息 */
  private async fetchDownloadInfo(
    backendUrl: string,
    pluginId: string,
    version: string,
    authToken?: string,
  ): Promise<PluginDownloadInfo> {
    const url = `${backendUrl}/api/v1/plugins/download/${pluginId}/${version}`
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    const response = await this.makeHttpRequest(url, 'GET', undefined, headers)
    // 后端统一响应格式为 { success, data, timestamp }，需要解包 data 字段
    const parsed = JSON.parse(response) as { success?: boolean; data?: PluginDownloadInfo } & PluginDownloadInfo
    return parsed.data ?? parsed
  }

  /** 从后端获取插件详情 */
  private async fetchPluginDetail(
    backendUrl: string,
    pluginId: string,
    authToken?: string,
  ): Promise<MarketplacePluginDetail> {
    const url = `${backendUrl}/api/v1/plugins/detail/${pluginId}`
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    const response = await this.makeHttpRequest(url, 'GET', undefined, headers)
    // 后端统一响应格式为 { success, data, timestamp }，需要解包 data 字段
    // 不解包会导致 detail.latestVersion 取到 undefined，checkUpdate 永远返回无更新
    const parsed = JSON.parse(response) as { success?: boolean; data?: MarketplacePluginDetail } & MarketplacePluginDetail
    return parsed.data ?? parsed
  }

  /** 上报安装到后端 */
  private async reportInstall(
    backendUrl: string,
    pluginId: string,
    version: string,
    authToken?: string,
  ): Promise<void> {
    const url = `${backendUrl}/api/v1/plugins/install/${pluginId}`
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`

    await this.makeHttpRequest(url, 'POST', { version }, headers)
  }

  /** HTTP 请求封装 */
  private makeHttpRequest(
    url: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = net.request({ url, method })
      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      }
      for (const [key, value] of Object.entries(requestHeaders)) {
        request.setHeader(key, value)
      }

      let data = ''
      request.on('response', (response) => {
        const location = response.headers.location
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && redirectUrl) {
          this.makeHttpRequest(redirectUrl, method, body, headers).then(resolve).catch(reject)
          return
        }
        response.on('data', (chunk) => { data += chunk.toString() })
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data)
          } else {
            reject(new Error(`HTTP ${response.statusCode}: ${data.slice(0, 200)}`))
          }
        })
        response.on('error', reject)
      })
      request.on('error', reject)
      if (body && method === 'POST') {
        request.write(JSON.stringify(body))
      }
      request.end()
    })
  }

  /** 下载文件（支持进度回调和断点续传） */
  private downloadFile(
    url: string,
    destPath: string,
    pluginId: string,
    expectedSize: number,
  ): Promise<void> {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const downloadOnce = (requestUrl: string, existingSize: number): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const request = net.request(requestUrl)
        const fileStream = fs.createWriteStream(destPath, {
          flags: existingSize > 0 ? 'a' : 'w',
        })

        if (existingSize > 0) {
          request.setHeader('Range', `bytes=${existingSize}-`)
        }

        let bytesDownloaded = existingSize
        let bytesTotal = expectedSize

        request.on('response', (response) => {
          const location = response.headers.location
          const redirectUrl = Array.isArray(location) ? location[0] : location
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && redirectUrl) {
            fileStream.close()
            downloadOnce(redirectUrl, existingSize).then(resolve).catch(reject)
            return
          }

          if (response.statusCode === 416) {
            fileStream.close()
            resolve()
            return
          }

          if (response.statusCode !== 200 && response.statusCode !== 206) {
            fileStream.close()
            try { fs.unlinkSync(destPath) } catch { /* ignore */ }
            reject(new Error(`Download failed with status ${response.statusCode}`))
            return
          }

          const contentLength = response.headers['content-length']
          if (contentLength) {
            const cl = Array.isArray(contentLength) ? contentLength[0] : contentLength
            const parsed = parseInt(cl, 10)
            if (!isNaN(parsed)) {
              bytesTotal = response.statusCode === 206 ? existingSize + parsed : parsed
            }
          }

          response.on('data', (chunk: Buffer) => {
            fileStream.write(chunk)
            bytesDownloaded += chunk.length
            this.emitProgress(pluginId, 'downloading', bytesDownloaded, bytesTotal)
          })

          response.on('end', () => {
            fileStream.end()
            resolve()
          })

          response.on('error', (err) => {
            fileStream.close()
            reject(err)
          })
        })

        request.on('error', (err) => {
          fileStream.close()
          reject(err)
        })

        request.end()
      })
    }

    // 支持断点续传：检查已有文件大小
    let existingSize = 0
    if (fs.existsSync(destPath)) {
      existingSize = fs.statSync(destPath).size
    }
    return downloadOnce(url, existingSize)
  }

  /** 校验 SHA256 */
  private verifyChecksum(filePath: string, expectedChecksum: string): boolean {
    const fileBuffer = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    return hash === expectedChecksum
  }

  /** 解压 .tar.gz */
  private async extractTarGz(archivePath: string, targetDir: string): Promise<void> {
    const fileBuffer = fs.readFileSync(archivePath)

    // 校验 gzip 头
    if (fileBuffer.length < 2 || fileBuffer[0] !== 0x1f || fileBuffer[1] !== 0x8b) {
      throw new Error('TAR_BAD_ARCHIVE: Not a valid gzip file')
    }

    // 校验 tar 头
    let decompressed: Buffer
    try {
      decompressed = zlib.gunzipSync(fileBuffer)
    } catch {
      throw new Error('TAR_BAD_ARCHIVE: Gzip decompression failed, file may be corrupted')
    }

    if (decompressed.length < 512 || !this.validateTarHeader(decompressed)) {
      throw new Error('TAR_BAD_ARCHIVE: Unrecognized archive format')
    }

    // 备份旧版本目录（用于回滚）
    if (fs.existsSync(targetDir)) {
      const backupDir = path.join(this.pluginsRoot, BACKUP_DIR, path.basename(path.dirname(targetDir)))
      if (!fs.existsSync(path.dirname(backupDir))) {
        fs.mkdirSync(path.dirname(backupDir), { recursive: true })
      }
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true })
      }
      fs.renameSync(targetDir, backupDir)
    }

    fs.mkdirSync(targetDir, { recursive: true })

    await tar.x({
      file: archivePath,
      cwd: targetDir,
      strip: 1,
    })
  }

  /** 校验 tar 文件头 */
  private validateTarHeader(buffer: Buffer): boolean {
    if (buffer.length < 512) return false
    const header = buffer.subarray(0, 512)
    const checksumOffset = 148
    const checksumLength = 8

    let storedChecksum: number | null = null
    const checksumStr = header.subarray(checksumOffset, checksumOffset + checksumLength).toString('ascii').trim()
    if (checksumStr) {
      storedChecksum = parseInt(checksumStr, 8)
    }

    if (storedChecksum === null || isNaN(storedChecksum)) return false

    const headerForCalc = Buffer.from(header)
    headerForCalc.fill(0x20, checksumOffset, checksumOffset + checksumLength)
    let calculatedChecksum = 0
    for (let i = 0; i < 512; i++) {
      calculatedChecksum += headerForCalc[i]
    }

    return storedChecksum === calculatedChecksum
  }

  /** 读取 manifest.json */
  private readManifest(pluginDir: string): PluginManifest | null {
    const manifestPath = path.join(pluginDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return null

    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw) as unknown

      if (!manifest || typeof manifest !== 'object') return null
      const m = manifest as Record<string, unknown>
      if (typeof m.id !== 'string' || !m.id) return null
      if (typeof m.name !== 'string' || !m.name) return null
      if (typeof m.version !== 'string' || !m.version) return null
      if (typeof m.main !== 'string' || !m.main) return null
      if (m.type === undefined) return null

      // 补充 main 为绝对路径
      const result = manifest as PluginManifest
      if (!path.isAbsolute(result.main)) {
        result.main = path.join(pluginDir, result.main)
      }
      return result
    } catch {
      return null
    }
  }

  /**
   * 注册 MCP 型插件到 McpManager
   *
   * 根据 manifest.capabilities.mcp 配置生成 McpPluginServerConfig，
   * 添加到 MCP 配置并连接。
   */
  private async registerMcpServer(
    plugin: Pick<MarketplacePluginDetail, 'pluginId' | 'pluginKey' | 'name' | 'nameZh' | 'type'>,
    version: string,
    manifest: PluginManifest,
    userConfig?: Record<string, string>,
    progressPluginId?: string,
    progressPackageSize?: number,
  ): Promise<{ serverId: string; connectError?: string }> {
    const mcpConfig = manifest.capabilities?.mcp
    if (!mcpConfig) {
      throw new Error(`Plugin ${plugin.pluginKey} has no mcp capabilities`)
    }

    // 解析 configSchema 中的 {{config.KEY}} 模板变量
    // 优先级：传入的 userConfig > 已保存的用户配置 > defaultValue
    const configValues = this.resolveConfigDefaults(manifest, userConfig)
    const command = mcpConfig.command ? this.resolveTemplateString(mcpConfig.command, configValues) : undefined
    const args = mcpConfig.args?.map(a => this.resolveTemplateString(a, configValues) ?? a)
    const env = mcpConfig.env
      ? Object.fromEntries(
          Object.entries(mcpConfig.env).map(([k, v]) => [k, this.resolveTemplateString(v, configValues) ?? v])
        )
      : Object.keys(configValues).length > 0
        ? { ...configValues }
        : undefined
    const url = mcpConfig.url ? this.resolveTemplateString(mcpConfig.url, configValues) : undefined

    const serverId = `plugin:${plugin.pluginKey}`
    const config: McpPluginServerConfig = {
      type: 'plugin',
      id: serverId,
      name: plugin.nameZh || plugin.name,
      pluginKey: plugin.pluginKey,
      pluginVersion: version,
      transport: mcpConfig.transport,
      inProcessEntry: mcpConfig.transport === 'in-process' ? manifest.main : undefined,
      command,
      args,
      env,
      url,
      autoApprove: [],
      source: 'plugin',
    }

    const { mcpManager } = await import('../tool-protocol/ToolProtocolManager')
    await mcpManager.addServer(config, 'user')

    let connectError: string | undefined
    if (mcpConfig.autoConnect !== false) {
      // 为 uvx 命令设置 PythonRuntimeManager 状态回调，将安装进度转发到 UI
      if (progressPluginId && command === 'uvx') {
        const { pythonManager } = await import('../python-runtime/PythonRuntimeManager')
        pythonManager.setStatusCallback((message: string) => {
          this.emitProgress(progressPluginId, 'registering', progressPackageSize || 0, progressPackageSize || 0, message)
        })
        try {
          this.emitProgress(progressPluginId, 'registering', progressPackageSize || 0, progressPackageSize || 0, '正在连接 MCP 服务...')
          await mcpManager.connectServer(serverId)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.system.warn(`[PluginInstaller] MCP auto-connect failed for ${plugin.pluginKey}: ${errorMsg}`)
          connectError = errorMsg
        } finally {
          // 连接完成后清除回调，避免影响后续其他操作
          pythonManager.setStatusCallback(null)
        }
      } else {
        try {
          this.emitProgress(progressPluginId || '', 'registering', progressPackageSize || 0, progressPackageSize || 0, '正在连接 MCP 服务...')
          await mcpManager.connectServer(serverId)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          logger.system.warn(`[PluginInstaller] MCP auto-connect failed for ${plugin.pluginKey}: ${errorMsg}`)
          connectError = errorMsg
        }
      }
    }

    return { serverId, connectError }
  }

  /**
   * 根据 manifest.configSchema 构建配置值映射。
   * 优先级：用户配置 > defaultValue。
   * 用户配置由前端安装时填写并通过 install.userConfig 传入，或通过 savePluginConfig 更新。
   */
  private resolveConfigDefaults(manifest: PluginManifest, userConfig?: Record<string, string>): Record<string, string> {
    const values: Record<string, string> = {}
    const fields = manifest.configSchema?.fields ?? []
    const userValues = userConfig ?? this.pluginConfigs.get(manifest.id) ?? {}
    for (const field of fields) {
      // 1. 优先使用用户配置
      const userVal = userValues[field.key]
      if (userVal !== undefined && userVal !== null && userVal !== '') {
        values[field.key] = String(userVal)
        continue
      }
      // 2. 其次使用 defaultValue
      if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
        values[field.key] = String(field.defaultValue)
      }
      // 3. 无值字段不放入映射（保留占位符，运行时会替换为空字符串）
    }
    return values
  }

  /**
   * 将字符串中的 {{config.KEY}} 模板变量替换为实际值。
   * 若引用的 KEY 不存在（用户尚未配置），替换为空字符串避免字面量被当作真实值传给外部程序，
   * 同时记录警告提示用户去配置。
   */
  private resolveTemplateString(template: string | undefined, values: Record<string, string>): string | undefined {
    if (!template) return template
    return template.replace(/\{\{config\.([A-Za-z0-9_]+)\}\}/g, (_match, key: string) => {
      if (key in values) return values[key]
      logger.system.warn(`[PluginInstaller] Unresolved config template: {{config.${key}}}, replaced with empty string`)
      return ''
    })
  }

  /** 发送进度事件 */
  private emitProgress(
    pluginId: string,
    phase: InstallProgress['phase'],
    bytesDownloaded: number,
    bytesTotal: number,
    message?: string,
  ): void {
    const percent = bytesTotal > 0 ? Math.round((bytesDownloaded / bytesTotal) * 100) : 0
    const progress: InstallProgress = {
      pluginId,
      phase,
      bytesDownloaded,
      bytesTotal,
      percent,
      message,
    }

    for (const cb of this.progressCallbacks) {
      try { cb(progress) } catch (err) {
        logger.system.warn(`[PluginInstaller] Progress callback error: ${err}`)
      }
    }

    // 同时推送到渲染进程
    const win = this.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('plugin:installProgress', progress)
    }
  }

  /** 构造失败结果 */
  private fail(pluginId: string, error: string): InstallResult {
    return { success: false, pluginId, error }
  }
}

// ============================================
// 全局实例
// ============================================

let _instance: PluginInstaller | null = null

/** 获取 PluginInstaller 实例 */
export function getPluginInstaller(getMainWindow?: () => BrowserWindow | null): PluginInstaller {
  if (!_instance) {
    if (!getMainWindow) {
      throw new Error('PluginInstaller not initialized: getMainWindow is required on first call')
    }
    _instance = new PluginInstaller(getMainWindow)
  }
  return _instance
}

/** 重置 PluginInstaller（仅用于测试） */
export function resetPluginInstaller(): void {
  _instance = null
}
