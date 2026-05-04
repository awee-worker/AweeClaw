/**
 * ScenarioLoader - 场景加载器
 *
 * 负责动态加载、注册、卸载场景模块。
 * 支持内置场景和外部导入场景。
 *
 * 核心能力：
 * - 从 src/scenarios/ 目录自动发现内置场景
 * - 运行时动态注册/卸载场景
 * - 场景激活时注册工具、IPC handlers、组件
 * - 场景停用时清理所有注册
 * - 支持远程安装场景（预留接口）
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
      logger.warn(`[ScenarioLoader] Scenario "${module.id}" already registered, replacing`)
      this.unregister(module.id)
    }

    const plugin = module.getPlugin()
    this.scenarios.set(module.id, {
      module,
      plugin,
      registeredToolNames: [],
      active: false,
    })

    this.notify({ type: 'registered', scenarioId: module.id })
    logger.info(`[ScenarioLoader] Registered scenario: ${module.id} v${module.version}`)
  }

  unregister(scenarioId: string): boolean {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded) return false

    if (loaded.active) {
      this.deactivate(scenarioId)
    }

    this.scenarios.delete(scenarioId)
    this.notify({ type: 'unregistered', scenarioId })
    logger.info(`[ScenarioLoader] Unregistered scenario: ${scenarioId}`)
    return true
  }

  async activate(scenarioId: string, workspacePath: string | null): Promise<boolean> {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded) {
      logger.warn(`[ScenarioLoader] Cannot activate unknown scenario: ${scenarioId}`)
      return false
    }

    if (loaded.active) {
      logger.warn(`[ScenarioLoader] Scenario "${scenarioId}" is already active`)
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
          toolRegistry.setEnabled(name, false)
        }
      },
    }

    if (loaded.module.getTools) {
      const tools = loaded.module.getTools()
      ctx.registerTools(tools)
    }

    if (loaded.module.onActivate) {
      try {
        await loaded.module.onActivate(ctx)
      } catch (err) {
        logger.error(`[ScenarioLoader] onActivate failed for "${scenarioId}":`, err)
      }
    }

    loaded.active = true
    this.notify({ type: 'activated', scenarioId })
    logger.info(`[ScenarioLoader] Activated scenario: ${scenarioId}`)
    return true
  }

  async deactivate(scenarioId: string): Promise<void> {
    const loaded = this.scenarios.get(scenarioId)
    if (!loaded || !loaded.active) return

    for (const toolName of loaded.registeredToolNames) {
      toolRegistry.setEnabled(toolName, false)
    }
    loaded.registeredToolNames = []

    if (loaded.module.onDeactivate) {
      try {
        await loaded.module.onDeactivate()
      } catch (err) {
        logger.error(`[ScenarioLoader] onDeactivate failed for "${scenarioId}":`, err)
      }
    }

    loaded.active = false
    this.notify({ type: 'deactivated', scenarioId })
    logger.info(`[ScenarioLoader] Deactivated scenario: ${scenarioId}`)
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
        toolRegistry.register(tool.name, tool.executor, { override: true })
        toolRegistry.setEnabled(tool.name, true)
        loaded.registeredToolNames.push(tool.name)
        logger.info(`[ScenarioLoader] Registered tool "${tool.name}" for scenario "${scenarioId}"`)
      } catch (err) {
        logger.error(`[ScenarioLoader] Failed to register tool "${tool.name}":`, err)
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
