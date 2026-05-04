/**
 * ScenarioLoader (增强版) - 场景注册管理中心与动态加载器
 *
 * 统一管理场景的注册、发现、激活、停用、卸载全生命周期。
 * 集成数据总线、版本管理、监控日志等核心能力。
 *
 * 核心职责：
 * - 场景注册与发现：register/unregister/getAll/getById
 * - 生命周期管理：activate/deactivate，状态机驱动
 * - 工具动态注册：场景激活时注册工具到 ToolRegistry
 * - IPC 动态注册：场景激活时注册 IPC handler
 * - 依赖检查：激活前检查场景依赖是否满足
 * - 版本管理：集成 ScenarioVersionManager
 * - 数据总线：集成 ScenarioDataBus
 * - 监控日志：集成 ScenarioMonitor
 * - 事件通知：场景状态变更事件
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioRegistryEntry,
  ScenarioLoaderEvent,
  ScenarioLifecycleState,
  ScenarioToolDefinition,
  ScenarioIpcHandler,
  ScenarioManifest,
  ScenarioHealthReport,
  ScenarioDependency,
} from '@shared/types/scenario-arch'
import type { ScenarioPlugin } from '@shared/types/scenario'
import { toolRegistry } from '@/renderer/agent/tools/registry'
import { scenarioDataBus } from './ScenarioDataBus'
import { scenarioVersionManager, compareVersions } from './ScenarioVersionManager'
import { scenarioMonitor } from './ScenarioMonitor'
import { scenarioDatabaseManager } from './ScenarioDatabaseManager'
import { logger } from '@shared/utils/Logger'

const APP_VERSION = '1.7.41'

class ScenarioLoaderClass {
  private entries = new Map<string, ScenarioRegistryEntry>()
  private listeners = new Set<(event: ScenarioLoaderEvent) => void>()

  register(module: ScenarioModule): void {
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

    scenarioVersionManager.registerVersion(manifest.id, {
      version: manifest.version,
      isStable: true,
      releasedAt: Date.now(),
      minAppVersion: manifest.minAppVersion,
    })
    scenarioVersionManager.setActiveVersion(manifest.id, manifest.version)

    if (module.getTools) {
      const tools = module.getTools()
      this.registerScenarioTools(manifest.id, tools)
    }

    this.notify({ type: 'registered', scenarioId: manifest.id, version: manifest.version })
    scenarioMonitor.recordStateChange(manifest.id, 'registered')
    logger.agent.info(
      `[ScenarioLoader] Registered scenario: ${manifest.id} v${manifest.version}`
    )
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

    entry.state = 'activating'
    this.notify({ type: 'activating', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'activating')

    const ctx = this.createContext(scenarioId, workspacePath, entry.manifest.version)

    if (entry.module.onActivate) {
      try {
        await entry.module.onActivate(ctx)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[ScenarioLoader] onActivate failed for "${scenarioId}":`, err)
        entry.state = 'error'
        entry.lastError = errorMsg
        scenarioMonitor.recordStateChange(scenarioId, 'error')
        scenarioMonitor.recordError(scenarioId, errorMsg)
        this.notify({ type: 'error', scenarioId, error: errorMsg })
        return false
      }
    }

    entry.state = 'activated'
    entry.activatedAt = Date.now()
    this.notify({ type: 'activated', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'activated')
    logger.agent.info(`[ScenarioLoader] Activated scenario: ${scenarioId}`)
    return true
  }

  async deactivate(scenarioId: string): Promise<void> {
    const entry = this.entries.get(scenarioId)
    if (!entry || (entry.state !== 'activated' && entry.state !== 'error')) return

    entry.state = 'deactivating'
    this.notify({ type: 'deactivating', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'deactivating')

    if (entry.module.onDeactivate) {
      try {
        await entry.module.onDeactivate(
          this.createContext(scenarioId, null, entry.manifest.version)
        )
      } catch (err) {
        logger.agent.error(`[ScenarioLoader] onDeactivate failed for "${scenarioId}":`, err)
      }
    }

    entry.state = 'deactivated'
    this.notify({ type: 'deactivated', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'deactivated')
    logger.agent.info(`[ScenarioLoader] Deactivated scenario: ${scenarioId}`)
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

  async healthCheck(scenarioId: string): Promise<ScenarioHealthReport | null> {
    const entry = this.entries.get(scenarioId)
    if (!entry) return null

    let customChecks: ScenarioHealthReport['checks'] = []
    if (entry.module.onHealthCheck) {
      try {
        customChecks = await entry.module.onHealthCheck()
      } catch (err) {
        customChecks = [{
          name: 'health-check',
          status: 'unhealthy',
          message: err instanceof Error ? err.message : String(err),
        }]
      }
    }

    return scenarioMonitor.getHealthReport(
      scenarioId,
      entry.state,
      entry.registeredToolNames.length,
      entry.registeredIpcChannels.length,
      entry.module.getComponents ? Object.keys(entry.module.getComponents()).length : 0,
      customChecks
    )
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

  private registerScenarioTools(scenarioId: string, tools: ScenarioToolDefinition[]): void {
    const entry = this.entries.get(scenarioId)
    if (!entry) return

    for (const tool of tools) {
      try {
        toolRegistry.registerScenarioTool(tool.name, tool.definition, tool.executor, { override: true })
        entry.registeredToolNames.push(tool.name)
        logger.agent.info(
          `[ScenarioLoader] Registered tool "${tool.name}" for scenario "${scenarioId}"`
        )
      } catch (err) {
        logger.agent.error(`[ScenarioLoader] Failed to register tool "${tool.name}":`, err)
      }
    }
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

  private createContext(
    scenarioId: string,
    workspacePath: string | null,
    version: string
  ): ScenarioModuleContext {
    return {
      scenarioId,
      workspacePath,
      version,
      registerTools: (tools: ScenarioToolDefinition[]) => {
        this.registerScenarioTools(scenarioId, tools)
      },
      unregisterTools: (toolNames: string[]) => {
        const entry = this.entries.get(scenarioId)
        if (!entry) return
        for (const name of toolNames) {
          toolRegistry.unregisterScenarioTool(name)
          const idx = entry.registeredToolNames.indexOf(name)
          if (idx >= 0) entry.registeredToolNames.splice(idx, 1)
        }
      },
      registerIpcHandlers: (_handlers: ScenarioIpcHandler[]) => {
        // IPC handlers are registered in main process; this is a placeholder
        // for renderer-side scenario context compatibility
      },
      unregisterIpcHandlers: (_channels: string[]) => {
        // Same as above
      },
      publishData: (type: string, payload: unknown, targetScenarioId?: string) => {
        scenarioDataBus.publish(scenarioId, type, payload, targetScenarioId)
      },
      subscribeData: (messageType: string, handler) => {
        return scenarioDataBus.subscribe(scenarioId, messageType, handler)
      },
      setSharedData: (key: string, value: unknown, readOnly?: boolean) => {
        scenarioDataBus.setSharedData(scenarioId, key, value, readOnly)
      },
      getSharedData: (key: string) => {
        return scenarioDataBus.getSharedData(key)
      },
      getLogger: () => scenarioMonitor.createLogger(scenarioId),
      getHealthReporter: () => scenarioMonitor.createHealthReporter(scenarioId),
      executeSql: (sql: string) => scenarioDatabaseManager.executeSql(scenarioId, sql),
      getDatabasePath: () => scenarioDatabaseManager.getPath(scenarioId),
    }
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
