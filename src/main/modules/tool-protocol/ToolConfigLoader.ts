/**
 * MCP 配置加载器
 * 负责加载和监听 MCP 配置文件
 * 支持本地和远程 MCP 服务器配置
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { getConfigFilePath, getWorkspaceConfigFilePath, CONFIG_FILES } from '../configPath'
import type { McpConfig, McpServerConfig, McpBuiltinServerConfig, McpBuiltinId } from '@shared/protocols/toolProtocolBridge'

/**
 * 内置进程内 MCP 服务器的默认配置清单。
 * 这些配置默认 disabled=true，需用户显式启用（在设置界面或配置文件中 toggle）。
 *
 * 新增内置服务时在此处追加即可，无需改动 loadConfig 逻辑。
 */
const BUILTIN_SERVER_DEFAULTS: McpBuiltinServerConfig[] = [
  {
    type: 'builtin',
    id: 'computer-use',
    name: 'Computer Use',
    builtin: 'computer-use',
    disabled: true,
    autoApprove: [],
  },
]

/** 返回内置进程内 MCP 服务器的默认配置列表（副本，避免外部修改） */
export function getBuiltinServerConfigs(): McpBuiltinServerConfig[] {
  return BUILTIN_SERVER_DEFAULTS.map((c) => ({ ...c }))
}

/** 内置服务标识是否合法 */
export function isKnownBuiltinId(id: string): id is McpBuiltinId {
  return BUILTIN_SERVER_DEFAULTS.some((c) => c.builtin === id || c.id === id)
}

export class McpConfigLoader {
  private workspaceRoots: string[] = []
  private watchers: fs.FSWatcher[] = []
  private onConfigChange?: () => void
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 获取用户配置路径 */
  private get userConfigPath(): string {
    return getConfigFilePath(CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 设置工作区根目录 */
  setWorkspaceRoots(roots: string[]): void {
    this.workspaceRoots = roots
    this.setupWatchers()
  }

  /** 设置配置变更回调 */
  setOnConfigChange(callback: () => void): void {
    this.onConfigChange = callback
  }

  /** 加载合并后的配置 */
  async loadConfig(): Promise<McpServerConfig[]> {
    const configs: McpServerConfig[] = []
    const seenIds = new Set<string>()

    // 0. 注入内置进程内 MCP 服务器（最低优先级，默认禁用）
    //    用户可在配置文件中覆盖 disabled / autoApprove 等字段来启用
    for (const builtin of getBuiltinServerConfigs()) {
      configs.push(builtin)
      seenIds.add(builtin.id)
    }

    // 1. 加载用户级配置（覆盖内置配置）
    const userConfig = await this.loadConfigFile(this.userConfigPath)
    if (userConfig) {
      for (const [id, serverConfig] of Object.entries(userConfig.mcpServers)) {
        const existingIndex = configs.findIndex(c => c.id === id)
        if (existingIndex !== -1) {
          // 合并用户配置到内置配置（保留 builtin 字段，应用 disabled/autoApprove 等）
          const merged = this.mergeBuiltinConfig(configs[existingIndex], serverConfig as Record<string, any>)
          configs[existingIndex] = merged
        } else {
          configs.push(this.normalizeConfig(id, serverConfig as Record<string, any>, 'user'))
          seenIds.add(id)
        }
      }
    }

    // 2. 加载工作区配置（后面的覆盖前面的）
    for (const root of this.workspaceRoots) {
      const workspaceConfigPath = this.getWorkspaceConfigPath(root)
      const workspaceConfig = await this.loadConfigFile(workspaceConfigPath)

      if (workspaceConfig) {
        for (const [id, serverConfig] of Object.entries(workspaceConfig.mcpServers)) {
          const existingIndex = configs.findIndex(c => c.id === id)
          if (existingIndex !== -1) {
            // 若已存在内置配置，则合并（保留 builtin 字段）；否则替换
            if (configs[existingIndex].type === 'builtin') {
              const merged = this.mergeBuiltinConfig(configs[existingIndex], serverConfig as Record<string, any>)
              merged.source = 'workspace'
              configs[existingIndex] = merged
            } else {
              configs.splice(existingIndex, 1)
              configs.push(this.normalizeConfig(id, serverConfig as Record<string, any>, 'workspace'))
            }
          } else {
            configs.push(this.normalizeConfig(id, serverConfig as Record<string, any>, 'workspace'))
            seenIds.add(id)
          }
        }
      }
    }

    logger.mcp?.info(`[McpConfigLoader] Loaded ${configs.length} MCP server configs`)
    return configs
  }

  /** 自动推断配置的 type 字段，标记来源层级 */
  private normalizeConfig(id: string, serverConfig: Record<string, any>, source: 'user' | 'workspace' = 'user'): McpServerConfig {
    let type = serverConfig.type
    if (!type) {
      if ('url' in serverConfig) {
        type = 'remote'
      } else if ('command' in serverConfig) {
        type = 'local'
      }
    }
    return { ...serverConfig, id, type, source } as McpServerConfig
  }

  /**
   * 将用户/工作区配置合并到内置配置上。
   *
   * 内置配置的 type/builtin/id/name 字段固定不可覆盖（防止用户写错导致连接失败），
   * 仅允许覆盖 disabled / autoApprove / presetId 等运行时字段。
   */
  private mergeBuiltinConfig(
    builtin: McpServerConfig,
    override: Record<string, any>,
  ): McpBuiltinServerConfig {
    if (builtin.type !== 'builtin') {
      // 非 builtin 类型不该走到这里，防御性处理
      return { ...override, type: 'builtin', builtin: 'computer-use' } as McpBuiltinServerConfig
    }
    return {
      type: 'builtin',
      id: builtin.id,
      name: builtin.name,
      builtin: builtin.builtin,
      // 用户可覆盖的字段
      disabled: override.disabled ?? builtin.disabled,
      autoApprove: override.autoApprove ?? builtin.autoApprove,
      presetId: override.presetId ?? builtin.presetId,
      // 来源标记（默认 user，由调用方按需覆盖）
      source: 'user',
    }
  }

  /** 保存用户级配置 */
  async saveUserConfig(config: McpConfig): Promise<void> {
    await this.saveConfigFile(this.userConfigPath, config)
  }

  /** 保存工作区配置 */
  async saveWorkspaceConfig(workspaceRoot: string, config: McpConfig): Promise<void> {
    const configPath = this.getWorkspaceConfigPath(workspaceRoot)
    await this.saveConfigFile(configPath, config)
  }

  /** 获取用户配置路径 */
  getUserConfigPath(): string {
    return this.userConfigPath
  }

  /** 获取工作区根目录列表 */
  getWorkspaceRoots(): string[] {
    return this.workspaceRoots
  }

  /** 获取工作区配置路径 */
  getWorkspaceConfigPath(workspaceRoot: string): string {
    return getWorkspaceConfigFilePath(workspaceRoot, CONFIG_FILES.MCP, CONFIG_FILES.SETTINGS_DIR)
  }

  /** 添加服务器到配置 */
  async addServer(serverConfig: McpServerConfig, level: 'user' | 'workspace' = 'user'): Promise<void> {
    const configPath = this.resolveConfigPath(level)
    const config = (await this.loadConfigFile(configPath)) || { mcpServers: {} }
    const { id, source: _source, ...rest } = serverConfig as McpServerConfig & { source?: string }
    config.mcpServers[id] = rest
    await this.saveConfigFile(configPath, config)
  }

  /**
   * 从配置删除服务器。
   *
   * 对于内置进程内服务器（computer-use 等），由于 loadConfig 总会注入默认配置，
   * "删除"语义等价于"禁用"——即写入 disabled=true 覆盖记录，
   * 否则用户删除后下一次 reload 又会出现。
   */
  async removeServer(serverId: string, level: 'user' | 'workspace' = 'user'): Promise<void> {
    const configPath = this.resolveConfigPath(level)
    const config = (await this.loadConfigFile(configPath)) || { mcpServers: {} }

    const isBuiltin = getBuiltinServerConfigs().some((c) => c.id === serverId)
    if (isBuiltin) {
      // 写入/更新一条 disabled=true 记录
      if (config.mcpServers[serverId]) {
        config.mcpServers[serverId].disabled = true
      } else {
        const builtin = getBuiltinServerConfigs().find((c) => c.id === serverId)!
        const { id: _id, source: _src, ...rest } = builtin
        config.mcpServers[serverId] = { ...rest, disabled: true }
      }
    } else {
      if (config.mcpServers[serverId]) {
        delete config.mcpServers[serverId]
      }
    }
    await this.saveConfigFile(configPath, config)
  }

  /** 切换服务器启用/禁用状态 */
  async toggleServer(serverId: string, disabled: boolean, level: 'user' | 'workspace' = 'user'): Promise<void> {
    const configPath = this.resolveConfigPath(level)
    const config = (await this.loadConfigFile(configPath)) || { mcpServers: {} }
    if (config.mcpServers[serverId]) {
      config.mcpServers[serverId].disabled = disabled
    } else {
      // 内置服务器首次未在用户配置中显式记录：若 id 命中内置清单，则写入一条覆盖记录
      const builtin = getBuiltinServerConfigs().find((c) => c.id === serverId)
      if (!builtin) {
        logger.mcp?.warn(`[McpConfigLoader] toggleServer: unknown server ${serverId}, skipped`)
        return
      }
      const { id: _id, source: _src, ...rest } = builtin
      config.mcpServers[serverId] = { ...rest, disabled }
    }
    await this.saveConfigFile(configPath, config)
  }

  /** 解析配置文件路径 */
  private resolveConfigPath(level: 'user' | 'workspace'): string {
    if (level === 'workspace' && this.workspaceRoots.length > 0) {
      return this.getWorkspaceConfigPath(this.workspaceRoots[0])
    }
    return this.userConfigPath
  }

  /** 清理资源 */
  cleanup(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
  }

  // =================== 私有方法 ===================

  private async loadConfigFile(filePath: string): Promise<McpConfig | null> {
    try {
      try {
        await fs.promises.access(filePath, fs.constants.F_OK)
      } catch {
        return null
      }

      const content = await fs.promises.readFile(filePath, 'utf-8')
      const config = JSON.parse(content) as McpConfig

      if (!config.mcpServers || typeof config.mcpServers !== 'object') {
        logger.mcp?.warn(`[McpConfigLoader] Invalid config format: ${filePath}`)
        return null
      }

      return config
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to load config: ${filePath} - ${error.code}`, error)
      return null
    }
  }

  private async saveConfigFile(filePath: string, config: McpConfig): Promise<void> {
    try {
      const dir = path.dirname(filePath)
      await fs.promises.mkdir(dir, { recursive: true })

      const content = JSON.stringify(config, null, 2)
      await fs.promises.writeFile(filePath, content, 'utf-8')
      logger.mcp?.info(`[McpConfigLoader] Saved config: ${filePath}`)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[McpConfigLoader] Failed to save config: ${filePath} - ${error.code}`, error)
      throw error
    }
  }

  private setupWatchers(): void {
    // 清理旧的 watchers
    this.cleanup()

    // 监听用户配置
    this.watchConfigFile(this.userConfigPath)

    // 监听工作区配置
    for (const root of this.workspaceRoots) {
      const configPath = this.getWorkspaceConfigPath(root)
      this.watchConfigFile(configPath)
    }
  }

  private watchConfigFile(filePath: string): void {
    const dir = path.dirname(filePath)
    const filename = path.basename(filePath)
    
    // 确保目录存在
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch {
        return
      }
    }

    try {
      const watcher = fs.watch(dir, (_eventType, changedFilename) => {
        if (changedFilename === filename) {
          logger.mcp?.info(`[McpConfigLoader] Config changed: ${filePath}`)
          // 延迟触发，避免频繁更新（防抖：清除前一个 timer）
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            this.onConfigChange?.()
          }, 500)
        }
      })

      this.watchers.push(watcher)
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.warn(`[McpConfigLoader] Failed to watch: ${dir} - ${error.code}`, error)
    }
  }
}
