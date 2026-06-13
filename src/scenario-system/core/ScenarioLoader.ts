/**
 * ScenarioLoader (增强版) - 场景注册管理中心
 *
 * 统一管理场景的注册、发现、激活、停用、卸载全生命周期。
 * 集成数据总线、版本管理、监控日志等核心能力。
 *
 * 核心职责：
 * - 场景注册与发现：register/unregister/getAll/getById
 * - 生命周期管理：委托给 ScenarioLifecycleManager
 * - 工具动态注册：场景激活时注册工具到 ToolRegistry
 * - 依赖检查：激活前检查场景依赖是否满足
 * - 版本管理：集成 ScenarioVersionManager
 * - 事件通知：场景状态变更事件
 */

import type {
  ScenarioModule,
  ScenarioRegistryEntry,
  ScenarioLoaderEvent,
  ScenarioLifecycleState,
  ScenarioManifest,
  ScenarioHealthReport,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import { scenarioDataBus } from './ScenarioDataBus'
import { scenarioVersionManager, compareVersions } from './ScenarioVersionManager'
import { scenarioMonitor } from './ScenarioMonitor'
import { logger } from '@shared/toolkit/LogEngine'
import { ScenarioLifecycleManager } from './ScenarioLifecycleManager'

const APP_VERSION = '1.7.41'

class ScenarioLoaderClass {
  private entries = new Map<string, ScenarioRegistryEntry>()
  private listeners = new Set<(event: ScenarioLoaderEvent) => void>()
  private lifecycle: ScenarioLifecycleManager
  private lazyScenarios = new Set<string>()

  constructor() {
    this.lifecycle = new ScenarioLifecycleManager((event) => {
      this.notify(event as ScenarioLoaderEvent)
    })
  }

  register(module: ScenarioModule, lazy = false): void {
    const manifest = module.getManifest()

    if (!this.checkCompatibility(manifest)) {
      logger.agent.error(
        `[ScenarioLoader] Scenario "${manifest.id}" v${manifest.version} requires app >= ${manifest.minAppVersion}, current: ${APP_VERSION}`
      )
      this.notify({ type: 'error', scenarioId: manifest.id, error: 'Incompatible app version' })
      return
    }

    const existing = this.entries.get(manifest.id)
    if (existing) {
      if (existing.state === 'activated' || existing.state === 'activating') {
        logger.agent.warn(`[ScenarioLoader] Cannot replace active scenario "${manifest.id}"`)
        return
      }
      this.doUnregister(manifest.id)
    }

    const plugin = module.getPlugin()
    const entry: ScenarioRegistryEntry = {
      module,
      manifest,
      plugin,
      state: 'registered',
      registeredToolNames: [],
      registeredIpcChannels: [],
      versionHistory: [{ version: manifest.version, isStable: true, releasedAt: Date.now() }],
    }

    this.entries.set(manifest.id, entry)
    if (lazy) {
      this.lazyScenarios.add(manifest.id)
    }

    scenarioVersionManager.registerVersion(manifest.id, {
      version: manifest.version,
      isStable: true,
      releasedAt: Date.now(),
      minAppVersion: manifest.minAppVersion,
    })
    scenarioVersionManager.setActiveVersion(manifest.id, manifest.version)

    if (module.getTools) {
      const tools = module.getTools()
      this.lifecycle.registerTools(manifest.id, entry, tools)
    }

    this.notify({ type: 'registered', scenarioId: manifest.id, version: manifest.version })
    scenarioMonitor.recordStateChange(manifest.id, 'registered')
    logger.agent.info(`[ScenarioLoader] Registered scenario: ${manifest.id} v${manifest.version}`)

    this.lifecycle.runInstall(entry).catch(err => {
      logger.agent.error(`[ScenarioLoader] Install failed for "${manifest.id}":`, err)
    })
  }

  async activate(scenarioId: string, workspacePath: string | null): Promise<boolean> {
    const entry = this.entries.get(scenarioId)
    if (!entry) {
      logger.agent.warn(`[ScenarioLoader] Cannot activate unknown scenario: ${scenarioId}`)
      return false
    }

    if (entry.state === 'activated') {
      logger.agent.warn(`[ScenarioLoader] Scenario "${scenarioId}" is already active`)
      return true
    }

    if (entry.state === 'activating' || entry.state === 'deactivating') {
      logger.agent.warn(`[ScenarioLoader] Scenario "${scenarioId}" is in transition: ${entry.state}`)
      return false
    }

    if (!this.checkDependencies(entry.module)) {
      logger.agent.error(`[ScenarioLoader] Dependency check failed for "${scenarioId}"`)
      entry.state = 'error'
      entry.lastError = 'Dependency check failed'
      this.notify({ type: 'error', scenarioId, error: 'Dependency check failed' })
      return false
    }

    return this.lifecycle.activate(entry, workspacePath)
  }

  async deactivate(scenarioId: string): Promise<void> {
    const entry = this.entries.get(scenarioId)
    if (!entry || (entry.state !== 'activated' && entry.state !== 'error')) return
    await this.lifecycle.deactivate(entry)
  }

  unregister(scenarioId: string): boolean {
    const entry = this.entries.get(scenarioId)
    if (!entry) return false

    if (entry.state === 'activated' || entry.state === 'activating' || entry.state === 'deactivating') {
      logger.agent.warn(`[ScenarioLoader] Cannot unregister scenario in state: ${entry.state}`)
      return false
    }

    return this.doUnregister(scenarioId)
  }

  async uninstall(scenarioId: string): Promise<boolean> {
    const entry = this.entries.get(scenarioId)
    if (!entry) return false

    if (entry.state === 'activated' || entry.state === 'activating' || entry.state === 'deactivating') {
      logger.agent.warn(`[ScenarioLoader] Cannot uninstall scenario in state: ${entry.state}`)
      return false
    }

    await this.lifecycle.runUninstall(entry)
    return this.doUnregister(scenarioId)
  }

  async healthCheck(scenarioId: string): Promise<ScenarioHealthReport | null> {
    const entry = this.entries.get(scenarioId)
    if (!entry) return null
    return this.lifecycle.healthCheck(entry)
  }

  getPlugin(scenarioId: string): ScenarioPlugin | undefined {
    return this.entries.get(scenarioId)?.plugin
  }

  getManifest(scenarioId: string): ScenarioManifest | undefined {
    return this.entries.get(scenarioId)?.manifest
  }

  getAllPlugins(): ScenarioPlugin[] {
    return Array.from(this.entries.values()).map(e => e.plugin)
  }

  getAllManifests(): ScenarioManifest[] {
    return Array.from(this.entries.values()).map(e => e.manifest)
  }

  getEntry(scenarioId: string): ScenarioRegistryEntry | undefined {
    return this.entries.get(scenarioId)
  }

  getAllEntries(): ScenarioRegistryEntry[] {
    return Array.from(this.entries.values())
  }

  isActive(scenarioId: string): boolean {
    return this.entries.get(scenarioId)?.state === 'activated'
  }

  getState(scenarioId: string): ScenarioLifecycleState | undefined {
    return this.entries.get(scenarioId)?.state
  }

  has(scenarioId: string): boolean {
    return this.entries.has(scenarioId)
  }

  /** 是否为懒加载场景（注册但未激活） */
  isLazy(scenarioId: string): boolean {
    return this.lazyScenarios.has(scenarioId)
  }

  /**
   * 确保场景已激活（懒加载自动触发）
   * 如果场景是懒加载的且未激活，自动激活
   */
  async ensureActive(scenarioId: string, workspacePath: string | null = null): Promise<boolean> {
    const entry = this.entries.get(scenarioId)
    if (!entry) return false
    if (entry.state === 'activated') return true

    if (this.lazyScenarios.has(scenarioId)) {
      this.lazyScenarios.delete(scenarioId)
      return this.activate(scenarioId, workspacePath)
    }

    return false
  }

  onEvent(listener: (event: ScenarioLoaderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private doUnregister(scenarioId: string): boolean {
    const entry = this.entries.get(scenarioId)
    if (!entry) return false

    for (const toolName of entry.registeredToolNames) {
      toolRegistry.unregisterScenarioTool(toolName)
    }

    scenarioDataBus.cleanupScenario(scenarioId)
    scenarioVersionManager.cleanupScenario(scenarioId)
    scenarioMonitor.cleanupScenario(scenarioId)

    this.entries.delete(scenarioId)
    this.notify({ type: 'unregistered', scenarioId })
    logger.agent.info(`[ScenarioLoader] Unregistered scenario: ${scenarioId}`)
    return true
  }

  private checkCompatibility(manifest: ScenarioManifest): boolean {
    if (!manifest.minAppVersion) return true
    return compareVersions(APP_VERSION, manifest.minAppVersion) >= 0
  }

  private checkDependencies(module: ScenarioModule): boolean {
    const deps = module.getDependencies?.()
    if (!deps || deps.length === 0) return true

    for (const dep of deps) {
      if (dep.required === false) continue
      const depEntry = this.entries.get(dep.id)
      if (!depEntry) {
        logger.agent.warn(`[ScenarioLoader] Missing required dependency: ${dep.id}`)
        return false
      }
      if (dep.versionRange) {
        const activeVersion = scenarioVersionManager.getActiveVersion(dep.id)
        if (!activeVersion || !this.versionInRange(activeVersion, dep)) {
          logger.agent.warn(
            `[ScenarioLoader] Dependency "${dep.id}" version ${activeVersion} not in range ${dep.versionRange}`
          )
          return false
        }
      }
    }
    return true
  }

  private versionInRange(version: string, dep: ScenarioDependency): boolean {
    if (!dep.versionRange) return true
    const range = dep.versionRange
    if (range.startsWith('>=')) {
      return compareVersions(version, range.slice(2)) >= 0
    }
    if (range.startsWith('>')) {
      return compareVersions(version, range.slice(1)) > 0
    }
    if (range.startsWith('<=')) {
      return compareVersions(version, range.slice(2)) <= 0
    }
    if (range.startsWith('<')) {
      return compareVersions(version, range.slice(1)) < 0
    }
    return compareVersions(version, range) === 0
  }

  private notify(event: ScenarioLoaderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {}
    }
  }
}

export const scenarioLoader = new ScenarioLoaderClass()
