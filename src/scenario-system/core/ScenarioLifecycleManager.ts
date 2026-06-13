/**
 * 场景生命周期管理器
 *
 * 从 ScenarioLoader 中提取出生命周期相关逻辑，实现单一职责：
 * - activate: 激活场景，状态机驱动
 * - deactivate: 停用场景
 * - install: 运行安装流程（数据库初始化 + onInstall）
 * - uninstall: 运行卸载流程（onUninstall + 数据库清理）
 * - createContext: 创建场景模块上下文
 */

import type {
  ScenarioRegistryEntry,
  ScenarioModuleContext,
  ScenarioToolDefinition,
  ScenarioIpcHandler,
  ScenarioHealthReport,
} from '@shared/protocols/scenario-arch'
import { toolRegistry } from '@intelligence/toolkit/toolRegistry'
import { scenarioDataBus } from './ScenarioDataBus'
import { scenarioDatabaseManager } from './ScenarioDatabaseManager'
import { scenarioMonitor } from './ScenarioMonitor'
import { logger } from '@shared/toolkit/LogEngine'

export interface LifecycleEventCallback {
  (event: { type: string; scenarioId: string; error?: string }): void
}

export class ScenarioLifecycleManager {
  private onEvent: LifecycleEventCallback

  constructor(onEvent: LifecycleEventCallback) {
    this.onEvent = onEvent
  }

  /** 运行场景安装流程 */
  async runInstall(entry: ScenarioRegistryEntry): Promise<void> {
    const { module } = entry
    const scenarioId = module.id

    // 数据库初始化
    if (module.getInstallScripts) {
      const scripts = module.getInstallScripts()
      if (scripts.length > 0) {
        const result = await scenarioDatabaseManager.initialize(scenarioId, scripts)
        if (result.success) {
          logger.agent.info(`[Lifecycle] Database initialized for "${scenarioId}"`)
        } else {
          logger.agent.error(`[Lifecycle] DB init failed for "${scenarioId}": ${result.error}`)
        }
      }
    }

    // 运行 onInstall 钩子
    if (module.onInstall) {
      try {
        const ctx = this.createContext(scenarioId, null, module.version, entry)
        await module.onInstall(ctx)
        logger.agent.info(`[Lifecycle] onInstall completed for "${scenarioId}"`)
      } catch (err) {
        logger.agent.error(`[Lifecycle] onInstall failed for "${scenarioId}":`, err)
      }
    }
  }

  /** 激活场景 */
  async activate(
    entry: ScenarioRegistryEntry,
    workspacePath: string | null,
  ): Promise<boolean> {
    const scenarioId = entry.manifest.id

    if (entry.state === 'activating' || entry.state === 'deactivating') {
      logger.agent.warn(`[Lifecycle] "${scenarioId}" is in transition: ${entry.state}`)
      return false
    }

    entry.state = 'activating'
    this.onEvent({ type: 'activating', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'activating')

    const ctx = this.createContext(scenarioId, workspacePath, entry.manifest.version, entry)

    if (entry.module.onActivate) {
      try {
        await entry.module.onActivate(ctx)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.agent.error(`[Lifecycle] onActivate failed for "${scenarioId}":`, err)
        entry.state = 'error'
        entry.lastError = errorMsg
        scenarioMonitor.recordStateChange(scenarioId, 'error')
        scenarioMonitor.recordError(scenarioId, errorMsg)
        this.onEvent({ type: 'error', scenarioId, error: errorMsg })
        return false
      }
    }

    entry.state = 'activated'
    entry.activatedAt = Date.now()
    this.onEvent({ type: 'activated', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'activated')
    logger.agent.info(`[Lifecycle] Activated "${scenarioId}"`)
    return true
  }

  /** 停用场景 */
  async deactivate(entry: ScenarioRegistryEntry): Promise<void> {
    const scenarioId = entry.manifest.id

    entry.state = 'deactivating'
    this.onEvent({ type: 'deactivating', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'deactivating')

    if (entry.module.onDeactivate) {
      try {
        await entry.module.onDeactivate(
          this.createContext(scenarioId, null, entry.manifest.version, entry),
        )
      } catch (err) {
        logger.agent.error(`[Lifecycle] onDeactivate failed for "${scenarioId}":`, err)
      }
    }

    entry.state = 'deactivated'
    this.onEvent({ type: 'deactivated', scenarioId })
    scenarioMonitor.recordStateChange(scenarioId, 'deactivated')
    logger.agent.info(`[Lifecycle] Deactivated "${scenarioId}"`)
  }

  /** 运行卸载流程 */
  async runUninstall(entry: ScenarioRegistryEntry): Promise<void> {
    const scenarioId = entry.manifest.id
    const module = entry.module

    if (module.onUninstall) {
      try {
        const ctx = this.createContext(scenarioId, null, module.version, entry)
        await module.onUninstall(ctx)
        logger.agent.info(`[Lifecycle] onUninstall completed for "${scenarioId}"`)
      } catch (err) {
        logger.agent.error(`[Lifecycle] onUninstall failed for "${scenarioId}":`, err)
      }
    }

    if (module.getUninstallScripts) {
      const scripts = module.getUninstallScripts()
      if (scripts.length > 0) {
        const result = await scenarioDatabaseManager.drop(scenarioId, scripts)
        if (result.success) {
          logger.agent.info(`[Lifecycle] Database dropped for "${scenarioId}"`)
        } else {
          logger.agent.error(`[Lifecycle] DB drop failed for "${scenarioId}": ${result.error}`)
        }
      }
    }
  }

  /** 健康检查 */
  async healthCheck(entry: ScenarioRegistryEntry): Promise<ScenarioHealthReport> {
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
      entry.manifest.id,
      entry.state,
      entry.registeredToolNames.length,
      entry.registeredIpcChannels.length,
      entry.module.getComponents ? Object.keys(entry.module.getComponents()).length : 0,
      customChecks,
    )
  }

  /** 注册场景工具到 ToolRegistry */
  registerTools(scenarioId: string, entry: ScenarioRegistryEntry, tools: ScenarioToolDefinition[]): void {
    for (const tool of tools) {
      try {
        toolRegistry.registerScenarioTool(tool.name, tool.definition, tool.executor, { override: true })
        entry.registeredToolNames.push(tool.name)
        logger.agent.info(`[Lifecycle] Registered tool "${tool.name}" for "${scenarioId}"`)
      } catch (err) {
        logger.agent.error(`[Lifecycle] Failed to register tool "${tool.name}":`, err)
      }
    }
  }

  /** 创建场景模块上下文 */
  createContext(
    scenarioId: string,
    workspacePath: string | null,
    version: string,
    entry: ScenarioRegistryEntry,
  ): ScenarioModuleContext {
    return {
      scenarioId,
      workspacePath,
      version,
      registerTools: (tools: ScenarioToolDefinition[]) => {
        this.registerTools(scenarioId, entry, tools)
      },
      unregisterTools: (toolNames: string[]) => {
        for (const name of toolNames) {
          toolRegistry.unregisterScenarioTool(name)
          const idx = entry.registeredToolNames.indexOf(name)
          if (idx >= 0) entry.registeredToolNames.splice(idx, 1)
        }
      },
      registerIpcHandlers: (_handlers: ScenarioIpcHandler[]) => {
        // IPC handlers 在主进程注册，此处为渲染进程兼容占位
      },
      unregisterIpcHandlers: (_channels: string[]) => {
        // 同上
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
}