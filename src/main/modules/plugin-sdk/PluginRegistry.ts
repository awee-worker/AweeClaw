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
    for (const manifest of manifests) {
      if (!this.registrations.has(manifest.id)) {
        this.registrations.set(manifest.id, {
          manifest,
          runtime: null,
          status: 'discovered',
        })
        this.emitEvent({ type: 'plugin:discovered', pluginId: manifest.id })
      }
    }

    logger.system.info(`[PluginRegistry] Discovered ${manifests.length} plugins`)
    return manifests
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
   */
  async enable(pluginId: string): Promise<void> {
    const registration = this.registrations.get(pluginId)
    if (!registration) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }
    if (registration.status === 'disabled') {
      await this.load(pluginId)
      await this.initialize(pluginId)
    }
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
   */
  validateManifest(manifest: unknown): manifest is PluginManifest {
    if (!manifest || typeof manifest !== 'object') return false
    const m = manifest as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id) return false
    if (typeof m.name !== 'string' || !m.name) return false
    if (typeof m.version !== 'string' || !m.version) return false
    if (typeof m.main !== 'string' || !m.main) return false
    if (m.type === undefined) return false
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
