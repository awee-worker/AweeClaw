/**
 * Plugin SDK - 插件注册表核心实现
 *
 * 负责插件的发现、加载、初始化、生命周期管理和 Hook 注册。
 * 借鉴 OpenClaw 的 Plugin Registry 架构，实现 Manifest-first 的插件管理。
 *
 * @module plugin-sdk/registry
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  PluginManifest,
  PluginRuntime,
  PluginContext,
  PluginRegistration,
  PluginType,
  PluginSystemEvent,
  PluginSystemEventListener,
  HookEventName,
  HookHandler,
  HookResult,
  IPluginRegistry,
  PluginLogger,
} from '@shared/plugin-sdk/types'
import { hookEngine } from '@shared/plugin-sdk/hooks'
import {
  validatePermissions,
  registerPermissions,
  unregisterPermissions,
  createGuardedHostServices,
} from './PluginPermissionGuard'
import { getHostServices } from './hostServices'

/** 内部注册信息（扩展 PluginRegistration，添加运行时工厂） */
interface InternalPluginRegistration extends PluginRegistration {
  _runtimeFactory?: (ctx: PluginContext) => PluginRuntime
}

// ============================================
// 插件日志适配器
// ============================================

class PluginLoggerAdapter implements PluginLogger {
  constructor(private pluginId: string) {}

  info(message: string, ...args: unknown[]): void {
    logger.system.info(`[Plugin:${this.pluginId}] ${message}`, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    logger.system.warn(`[Plugin:${this.pluginId}] ${message}`, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    logger.system.error(`[Plugin:${this.pluginId}] ${message}`, ...args)
  }

  debug(message: string, ...args: unknown[]): void {
    logger.system.debug(`[Plugin:${this.pluginId}] ${message}`, ...args)
  }
}

// ============================================
// 插件注册表实现
// ============================================

class PluginRegistry implements IPluginRegistry {
  /** 已注册的插件 */
  private registrations = new Map<string, InternalPluginRegistration>()
  /** 插件数据目录根路径 */
  private dataRoot: string
  /** 插件搜索目录 */
  private searchDirs: string[] = []
  /** 事件监听器 */
  private eventListeners = new Set<PluginSystemEventListener>()
  /** 插件配置存储 */
  private configStore = new Map<string, Record<string, unknown>>()
  /** 插件密钥存储（内存中，实际应使用安全存储） */
  private secretStore = new Map<string, Map<string, string>>()

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  /**
   * 添加插件搜索目录
   */
  addSearchDir(dir: string): void {
    if (!this.searchDirs.includes(dir)) {
      this.searchDirs.push(dir)
    }
  }

  /**
   * 发现所有可用插件（扫描目录 + 读取 manifest）
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = []

    for (const dir of this.searchDirs) {
      if (!fs.existsSync(dir)) continue

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          const manifestPath = path.join(dir, entry.name, 'manifest.json')
          if (!fs.existsSync(manifestPath)) continue

          try {
            const raw = fs.readFileSync(manifestPath, 'utf-8')
            const manifest = JSON.parse(raw) as unknown
            if (this.validateManifest(manifest)) {
              // 补充 main 路径为绝对路径
              if (!path.isAbsolute(manifest.main)) {
                manifest.main = path.join(dir, entry.name, manifest.main)
              }
              manifests.push(manifest)
            }
          } catch (err) {
            logger.system.warn(`[PluginRegistry] Invalid manifest in ${entry.name}: ${err}`)
          }
        }
      } catch (err) {
        logger.system.warn(`[PluginRegistry] Failed to scan directory ${dir}: ${err}`)
      }
    }

    // 注册发现的插件（仅 manifest，不加载运行时）
    // 同一插件 id 可能有多个版本目录（如 1.2.0、1.2.1），仅保留最新版本
    for (const manifest of manifests) {
      const existing = this.registrations.get(manifest.id)
      if (!existing) {
        this.registrations.set(manifest.id, {
          manifest,
          runtime: null,
          status: 'discovered',
        })
        this.emitEvent({ type: 'plugin:discovered', pluginId: manifest.id })
      } else if (this.compareVersions(manifest.version, existing.manifest.version) > 0) {
        // 新发现的版本更高，替换旧记录
        existing.manifest = manifest
        existing.runtime = null
        existing.status = 'discovered'
      }
    }

    logger.system.info(`[PluginRegistry] Discovered ${manifests.length} plugins`)
    return manifests
  }

  /**
   * 比较两个语义化版本号。
   * @returns 正数表示 a 更新，负数表示 b 更新，0 表示相同
   */
  private compareVersions(a: string, b: string): number {
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
    const pa = parse(a)
    const pb = parse(b)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      const na = pa[i] || 0
      const nb = pb[i] || 0
      if (na !== nb) return na - nb
    }
    return 0
  }

  /**
   * 注册内置插件（直接传入 manifest 和 runtime factory）
   */
  registerBuiltin(manifest: PluginManifest, runtimeFactory?: (ctx: PluginContext) => PluginRuntime): void {
    this.registrations.set(manifest.id, {
      manifest,
      runtime: null,
      status: 'discovered',
      _runtimeFactory: runtimeFactory,
    })
    this.emitEvent({ type: 'plugin:discovered', pluginId: manifest.id })
    logger.system.info(`[PluginRegistry] Registered builtin plugin: ${manifest.id}`)
  }

  /**
   * 加载插件运行时
   */
  async load(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
    if (registration.status === 'active' || registration.status === 'loaded') {
      return // 已加载
    }

    try {
      // 注册插件权限（在加载前注册，使 createContext 能创建受限代理）
      const permissions = validatePermissions(pluginId, registration.manifest.permissions)
      registerPermissions(pluginId, permissions)

      let runtime: PluginRuntime

      // 内置插件通过工厂函数创建
      if ((registration as any)._runtimeFactory) {
        const ctx = this.createContext(pluginId)
        runtime = (registration as any)._runtimeFactory(ctx)
      } else {
        // 外部插件通过动态 import 加载
        runtime = await this.loadExternalRuntime(registration.manifest)
      }

      registration.runtime = runtime
      registration.status = 'loaded'
      registration.loadedAt = Date.now()
      this.emitEvent({ type: 'plugin:loaded', pluginId })

      logger.system.info(`[PluginRegistry] Loaded plugin: ${pluginId}`)
    } catch (err) {
      registration.status = 'error'
      registration.error = err instanceof Error ? err.message : String(err)
      this.emitEvent({ type: 'plugin:error', pluginId, error: registration.error })
      logger.system.error(`[PluginRegistry] Failed to load plugin ${pluginId}: ${registration.error}`)
      throw err
    }
  }

  /**
   * 初始化插件
   */
  async initialize(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
    if (registration.status === 'active') return
    if (registration.status !== 'loaded' || !registration.runtime) {
      await this.load(pluginId)
    }

    try {
      const ctx = this.createContext(pluginId)
      await registration.runtime!.initialize(ctx)
      registration.status = 'active'
      this.emitEvent({ type: 'plugin:active', pluginId })
      logger.system.info(`[PluginRegistry] Initialized plugin: ${pluginId}`)
    } catch (err) {
      registration.status = 'error'
      registration.error = err instanceof Error ? err.message : String(err)
      this.emitEvent({ type: 'plugin:error', pluginId, error: registration.error })
      logger.system.error(`[PluginRegistry] Failed to initialize plugin ${pluginId}: ${registration.error}`)
      throw err
    }
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) return

    try {
      if (registration.runtime) {
        await registration.runtime.destroy()
      }
      // 移除该插件的所有 Hook
      hookEngine.removeByPlugin(pluginId)
      // 注销插件的运行时权限
      unregisterPermissions(pluginId)

      registration.runtime = null
      registration.status = 'discovered'
      this.emitEvent({ type: 'plugin:unloaded', pluginId })
      logger.system.info(`[PluginRegistry] Unloaded plugin: ${pluginId}`)
    } catch (err) {
      registration.status = 'error'
      registration.error = err instanceof Error ? err.message : String(err)
      logger.system.error(`[PluginRegistry] Error unloading plugin ${pluginId}: ${registration.error}`)
    }
  }

  /**
   * 获取插件注册信息
   */
  getRegistration(pluginId: string): PluginRegistration | undefined {
    return this.registrations.get(pluginId)
  }

  /**
   * 获取所有已注册插件
   */
  getAllRegistrations(): PluginRegistration[] {
    return Array.from(this.registrations.values())
  }

  /**
   * 按类型获取插件
   */
  getByType(type: PluginType): PluginRegistration[] {
    return Array.from(this.registrations.values()).filter(r => {
      const types = Array.isArray(r.manifest.type) ? r.manifest.type : [r.manifest.type]
      return types.includes(type)
    })
  }

  /**
   * 启用插件
   *
   * 行为分支：
   * - 已激活（active）：直接返回
   * - 普通插件（有 main 入口且非 MCP）：执行 load → initialize
   * - MCP 型插件 / 配置型插件（无 main 或具备 capabilities.mcp）：
   *   跳过 load/initialize，仅重置状态。MCP 服务的真正激活由上层
   *   PluginInstaller.enable 通过 mcpManager.connectServer 完成。
   *
   * 注意：禁用插件在应用重启后通过 restoreInstalled → discover 重新加入
   * registrations Map 时，status 为 'discovered'（非 'disabled'），
   * 因此此处不再依赖 status === 'disabled' 判断，而是检查 status !== 'active'。
   */
  async enable(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
    // 已激活则无需操作
    if (registration.status === 'active') return

    const types = Array.isArray(registration.manifest.type)
      ? registration.manifest.type
      : [registration.manifest.type]
    const hasMcpCapability = !!registration.manifest.capabilities?.mcp
    const isMcpPlugin = types.includes('mcp' as PluginType) || hasMcpCapability
    const hasEntry = !!registration.manifest.main

    if (hasEntry && !isMcpPlugin) {
      // 普通插件：加载并初始化运行时（load 内部已处理 'loaded' 状态的幂等性）
      await this.load(pluginId)
      await this.initialize(pluginId)
    }
    // MCP 型插件 / 配置型插件：不执行 load/initialize
    // MCP 服务的激活由上层 PluginInstaller.enable 通过 mcpManager.connectServer 完成
  }

  /**
   * 禁用插件
   */
  async disable(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) return

    await this.unload(pluginId)
    registration.status = 'disabled'
    this.emitEvent({ type: 'plugin:disabled', pluginId })
  }

  /**
   * 注册 Hook
   */
  registerHook(event: HookEventName, handler: HookHandler, pluginId: string, priority = 100): () => void {
    return hookEngine.register(event, handler, pluginId, priority)
  }

  /**
   * 触发 Hook
   */
  async triggerHook(event: HookEventName, payload: unknown): Promise<HookResult[]> {
    return hookEngine.trigger(event, payload)
  }

  /**
   * 注册事件监听器
   */
  onEvent(listener: PluginSystemEventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /**
   * 验证 Manifest 合法性
   *
   * main 字段规则：
   * - 普通插件（有 JS 运行时入口）：必须有非空 main
   * - MCP 型插件（具备 capabilities.mcp）：允许 main 为空字符串或省略
   *   原因：stdio/sse 传输的 MCP 插件通过外部进程（npx/uvx）或远程端点运行，
   *         不需要本地 JS 入口文件；其激活由 McpManager 管理，不走 PluginRuntime
   */
  validateManifest(manifest: unknown): manifest is PluginManifest {
    if (!manifest || typeof manifest !== 'object') return false
    const m = manifest as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id) return false
    if (typeof m.name !== 'string' || !m.name) return false
    if (typeof m.version !== 'string' || !m.version) return false
    if (m.type === undefined) return false

    // 判断是否为 MCP 型插件（capabilities.mcp 存在即视为 MCP 型）
    const caps = m.capabilities as Record<string, unknown> | undefined
    const hasMcpCapability = !!caps && typeof caps === 'object' && !!caps.mcp

    if (hasMcpCapability) {
      // MCP 型插件：main 可以省略或为空字符串，但类型必须是 string（若提供）
      if (m.main !== undefined && typeof m.main !== 'string') return false
    } else {
      // 非 MCP 型插件：必须有非空 main 入口
      if (typeof m.main !== 'string' || !m.main) return false
    }
    return true
  }

  /**
   * 批量初始化所有已发现的内置插件
   */
  async initializeAllBuiltin(): Promise<void> {
    const builtins = Array.from(this.registrations.values())
      .filter(r => r.manifest.builtin && r.status === 'discovered')

    for (const registration of builtins) {
      try {
        await this.load(registration.manifest.id)
        await this.initialize(registration.manifest.id)
      } catch (err) {
        logger.system.error(`[PluginRegistry] Failed to initialize builtin plugin ${registration.manifest.id}: ${err}`)
      }
    }
  }

  /**
   * 销毁所有插件
   */
  async destroyAll(): Promise<void> {
    for (const [pluginId, registration] of this.registrations) {
      if (registration.runtime) {
        try {
          await registration.runtime.destroy()
        } catch (err) {
          logger.system.error(`[PluginRegistry] Error destroying plugin ${pluginId}: ${err}`)
        }
      }
    }
    hookEngine.clear()
    this.registrations.clear()
  }

  // ============================================
  // 私有方法
  // ============================================

  private createContext(pluginId: string): PluginContext {
    const pluginDataDir = path.join(this.dataRoot, pluginId)

    // 创建受限的 HostServices 代理（基于 manifest.permissions 校验）
    // 若 HostServices 未初始化（如测试环境），host 为 undefined
    let guardedHost: unknown = undefined
    try {
      const fullHost = getHostServices()
      guardedHost = createGuardedHostServices(pluginId, fullHost)
    } catch {
      // HostServices 未初始化，跳过（测试环境或初始化前调用）
    }

    return {
      pluginId,
      dataDir: pluginDataDir,
      logger: new PluginLoggerAdapter(pluginId),
      getConfig: () => this.configStore.get(pluginId) || {},
      setConfig: async (config: Record<string, unknown>) => {
        this.configStore.set(pluginId, config)
      },
      getSecret: async (key: string) => {
        return this.secretStore.get(pluginId)?.get(key)
      },
      setSecret: async (key: string, value: string) => {
        if (!this.secretStore.has(pluginId)) {
          this.secretStore.set(pluginId, new Map())
        }
        this.secretStore.get(pluginId)!.set(key, value)
      },
      registerHook: (event: HookEventName, handler: HookHandler) => {
        return hookEngine.register(event, handler, pluginId)
      },
      sendToRenderer: (channel: string, ..._args: unknown[]) => {
        // 由上层注入实现
        logger.system.debug(`[Plugin:${pluginId}] sendToRenderer: ${channel}`)
      },
      host: guardedHost,
    }
  }

  private async loadExternalRuntime(manifest: PluginManifest): Promise<PluginRuntime> {
    try {
      const module = await import(manifest.main)
      const runtime: PluginRuntime = module.default || module
      return runtime
    } catch (err) {
      throw new Error(`Failed to load plugin runtime from ${manifest.main}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private emitEvent(event: PluginSystemEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch { /* ignore */ }
    }
  }
}

// ============================================
// 全局实例
// ============================================

let _instance: PluginRegistry | null = null

/**
 * 获取 Plugin Registry 实例
 * @param dataRoot 插件数据根目录（首次调用时必须提供）
 */
export function getPluginRegistry(dataRoot?: string): PluginRegistry {
  if (!_instance) {
    if (!dataRoot) {
      throw new Error('PluginRegistry not initialized: dataRoot is required on first call')
    }
    _instance = new PluginRegistry(dataRoot)
  }
  return _instance
}

/**
 * 重置 Plugin Registry（仅用于测试）
 */
export function resetPluginRegistry(): void {
  if (_instance) {
    _instance.destroyAll()
    _instance = null
  }
}

export { PluginRegistry }
