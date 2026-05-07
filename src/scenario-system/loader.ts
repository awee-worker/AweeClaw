/**
 * ScenarioLoader - 场景加载器（兼容层）
 *
 * @deprecated 请使用 core/ScenarioLoader 中的增强版 scenarioLoader
 *
 * 此文件保留旧版加载器实现，用于向后兼容。
 * 新代码应从 './core' 导入 scenarioLoader。
 *
 * 增强版新增能力：
 * - 场景清单 (Manifest) 管理
 * - 依赖检查
 * - 版本兼容性检查
 * - 数据总线集成
 * - 监控日志集成
 * - 健康检查
 * - 状态机驱动的生命周期管理
 */

import type { ScenarioPlugin } from '@shared/types/scenario'
import type { ScenarioModule, ScenarioToolDefinition, ScenarioModuleContext } from './types'
import { toolRegistry } from '@/renderer/agent/tools/registry'
import { logger } from '@utils/Logger'

interface LoadedScenario {
  module: ScenarioModule
  plugin: ScenarioPlugin
  registeredToolNames: string[]
  active: boolean
}

class ScenarioLoaderClass {
  private scenarios = new Map<string, LoadedScenario>()
  private listeners = new Set<(event: ScenarioLoaderEvent) => void>()

  register(module: ScenarioModule): void {
    if (this.scenarios.has(module.id)) {
      logger.agent.warn(`[ScenarioLoader] Scenario "${module.id}" already registered, replacing`)
      this.unregister(module.id)
    }

    const plugin = module.getPlugin()
    const loaded: LoadedScenario = {
      module,
      plugin,
      registeredToolNames: [],
      active: false,
    }

    this.scenarios.set(module.id, loaded)

    if (module.getTools) {
      const tools = module.getTools()
      this.registerScenarioTools(module.id, tools)
    }

    this.notify({ type: 'registered', scenarioId: module.id })
    logger.agent.info(`[ScenarioLoader] Registered scenario: ${module.id} v${module.version}`)
  }

  unregister(scenarioId: string): boolean {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded) return false

    if (loaded.active) {
      this.deactivate(scenarioId)
    }

    for (const toolName of loaded.registeredToolNames) {
      toolRegistry.unregisterScenarioTool(toolName)
    }
    loaded.registeredToolNames = []

    this.scenarios.delete(scenarioId)
    this.notify({ type: 'unregistered', scenarioId })
    logger.agent.info(`[ScenarioLoader] Unregistered scenario: ${scenarioId}`)
    return true
  }

  async activate(scenarioId: string, workspacePath: string | null): Promise<boolean> {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded) {
      logger.agent.warn(`[ScenarioLoader] Cannot activate unknown scenario: ${scenarioId}`)
      return false
    }

    if (loaded.active) {
      logger.agent.warn(`[ScenarioLoader] Scenario "${scenarioId}" is already active`)
      return true
    }

    const ctx: ScenarioModuleContext = {
      scenarioId,
      workspacePath,
      registerTools: (tools: ScenarioToolDefinition[]) => {
        this.registerScenarioTools(scenarioId, tools)
      },
      unregisterTools: (toolNames: string[]) => {
        for (const name of toolNames) {
          toolRegistry.unregisterScenarioTool(name)
        }
      },
    }

    if (loaded.module.onActivate) {
      try {
        await loaded.module.onActivate(ctx)
      } catch (err) {
        logger.agent.error(`[ScenarioLoader] onActivate failed for "${scenarioId}":`, err)
      }
    }

    loaded.active = true
    this.notify({ type: 'activated', scenarioId })
    logger.agent.info(`[ScenarioLoader] Activated scenario: ${scenarioId}`)
    return true
  }

  async deactivate(scenarioId: string): Promise<void> {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded || !loaded.active) return

    if (loaded.module.onDeactivate) {
      try {
        await loaded.module.onDeactivate()
      } catch (err) {
        logger.agent.error(`[ScenarioLoader] onDeactivate failed for "${scenarioId}":`, err)
      }
    }

    loaded.active = false
    this.notify({ type: 'deactivated', scenarioId })
    logger.agent.info(`[ScenarioLoader] Deactivated scenario: ${scenarioId}`)
  }

  getPlugin(scenarioId: string): ScenarioPlugin | undefined {
    return this.scenarios.get(scenarioId)?.plugin
  }

  getAllPlugins(): ScenarioPlugin[] {
    return Array.from(this.scenarios.values()).map(s => s.plugin)
  }

  isActive(scenarioId: string): boolean {
    return this.scenarios.get(scenarioId)?.active ?? false
  }

  has(scenarioId: string): boolean {
    return this.scenarios.has(scenarioId)
  }

  onEvent(listener: (event: ScenarioLoaderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private registerScenarioTools(scenarioId: string, tools: ScenarioToolDefinition[]): void {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded) return

    for (const tool of tools) {
      try {
        toolRegistry.registerScenarioTool(tool.name, tool.definition, tool.executor, { override: true })
        loaded.registeredToolNames.push(tool.name)
        logger.agent.info(`[ScenarioLoader] Registered tool "${tool.name}" for scenario "${scenarioId}"`)
      } catch (err) {
        logger.agent.error(`[ScenarioLoader] Failed to register tool "${tool.name}":`, err)
      }
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

export type ScenarioLoaderEvent =
  | { type: 'registered'; scenarioId: string }
  | { type: 'unregistered'; scenarioId: string }
  | { type: 'activated'; scenarioId: string }
  | { type: 'deactivated'; scenarioId: string }

export const scenarioLoader = new ScenarioLoaderClass()
