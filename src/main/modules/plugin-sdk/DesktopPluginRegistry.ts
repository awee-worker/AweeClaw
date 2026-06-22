/**
 * Desktop Plugin Registry - 桌面控制插件注册表实现（Phase 5）
 *
 * 基于 PluginRegistry 扩展，提供桌面控制插件的统一查询和执行入口。
 * 职责：
 * 1. 聚合所有 desktop 类型插件的桌面操作定义
 * 2. 提供统一的操作执行接口（含权限检查、错误处理）
 * 3. 聚合自定义工作流步骤、录制事件、视觉分析器
 * 4. 与 EmergencyStop 集成，支持紧急停止
 *
 * @module plugin-sdk/desktop-registry
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getPluginRegistry } from './PluginRegistry'
import { getEmergencyStopController } from '@main/modules/desktop-control/EmergencyStop'
import type {
  DesktopPluginRuntime,
  DesktopActionDefinition,
  DesktopActionContext,
  DesktopActionResult,
  CustomWorkflowStepDef,
  WorkflowStepContext,
  WorkflowStepResult,
  CustomRecordingEventDef,
  VisualAnalyzerConfig,
  VisualAnalysisRequest,
  VisualAnalysisResponse,
  IDesktopPluginRegistry,
} from '@shared/plugin-sdk/desktop'
import type { PluginRegistration } from '@shared/plugin-sdk/types'

// ============================================
// Desktop Plugin Registry 实现
// ============================================

class DesktopPluginRegistry implements IDesktopPluginRegistry {
  /** 缓存：actionId → { pluginId, runtime } */
  private actionCache = new Map<string, { pluginId: string; runtime: DesktopPluginRuntime }>()
  /** 缓存：stepTypeId → { pluginId, runtime } */
  private stepCache = new Map<string, { pluginId: string; runtime: DesktopPluginRuntime }>()
  /** 缓存：recordingEventTypeId → { pluginId, runtime } */
  private recordingEventCache = new Map<string, { pluginId: string; runtime: DesktopPluginRuntime }>()
  /** 缓存：analyzerId → { pluginId, runtime } */
  private analyzerCache = new Map<string, { pluginId: string; runtime: DesktopPluginRuntime }>()
  /** 缓存是否已构建 */
  private cacheBuilt = false

  // ============================================
  // 缓存管理
  // ============================================

  /** 重建缓存（在插件加载/卸载时调用） */
  rebuildCache(): void {
    this.actionCache.clear()
    this.stepCache.clear()
    this.recordingEventCache.clear()
    this.analyzerCache.clear()

    const desktopPlugins = this.getDesktopPlugins()

    for (const { pluginId, runtime } of desktopPlugins) {
      // 缓存桌面操作
      const actions = runtime.getActionDefinitions?.() ?? []
      for (const action of actions) {
        const key = `${pluginId}:${action.id}`
        this.actionCache.set(key, { pluginId, runtime })
        // 同时注册短 ID（无前缀），便于直接调用
        if (!this.actionCache.has(action.id)) {
          this.actionCache.set(action.id, { pluginId, runtime })
        }
      }

      // 缓存工作流步骤
      const steps = runtime.getWorkflowStepDefinitions?.() ?? []
      for (const step of steps) {
        const key = `${pluginId}:${step.typeId}`
        this.stepCache.set(key, { pluginId, runtime })
        if (!this.stepCache.has(step.typeId)) {
          this.stepCache.set(step.typeId, { pluginId, runtime })
        }
      }

      // 缓存录制事件
      const events = runtime.getRecordingEventDefinitions?.() ?? []
      for (const evt of events) {
        const key = `${pluginId}:${evt.typeId}`
        this.recordingEventCache.set(key, { pluginId, runtime })
        if (!this.recordingEventCache.has(evt.typeId)) {
          this.recordingEventCache.set(evt.typeId, { pluginId, runtime })
        }
      }

      // 缓存视觉分析器
      const analyzers = runtime.getVisualAnalyzers?.() ?? []
      for (const analyzer of analyzers) {
        const key = `${pluginId}:${analyzer.id}`
        this.analyzerCache.set(key, { pluginId, runtime })
        if (!this.analyzerCache.has(analyzer.id)) {
          this.analyzerCache.set(analyzer.id, { pluginId, runtime })
        }
      }
    }

    this.cacheBuilt = true
    const total =
      this.actionCache.size / 2 +
      this.stepCache.size / 2 +
      this.recordingEventCache.size / 2 +
      this.analyzerCache.size / 2
    logger.system.info(`[DesktopPluginRegistry] Cache rebuilt: ${desktopPlugins.length} plugins, ${Math.floor(total)} items`)
  }

  /** 确保缓存已构建 */
  private ensureCache(): void {
    if (!this.cacheBuilt) {
      this.rebuildCache()
    }
  }

  /** 获取所有已激活的 desktop 插件运行时 */
  private getDesktopPlugins(): Array<{ pluginId: string; runtime: DesktopPluginRuntime }> {
    const registry = getPluginRegistry()
    const registrations: PluginRegistration[] = registry.getByType('desktop')
    const result: Array<{ pluginId: string; runtime: DesktopPluginRuntime }> = []

    for (const reg of registrations) {
      if (reg.status === 'active' && reg.runtime) {
        // 类型守卫：检查是否为 DesktopPluginRuntime
        const manifest = reg.runtime as unknown as { manifest?: { type?: string } }
        if (manifest.manifest?.type === 'desktop' || reg.manifest.type === 'desktop') {
          result.push({
            pluginId: reg.manifest.id,
            runtime: reg.runtime as unknown as DesktopPluginRuntime,
          })
        }
      }
    }

    return result
  }

  // ============================================
  // 桌面操作
  // ============================================

  /** 获取所有桌面操作定义 */
  getAllActions(): DesktopActionDefinition[] {
    this.ensureCache()
    const actions: DesktopActionDefinition[] = []
    const seen = new Set<string>()

    for (const { pluginId, runtime } of this.getDesktopPlugins()) {
      const pluginActions = runtime.getActionDefinitions?.() ?? []
      for (const action of pluginActions) {
        const key = `${pluginId}:${action.id}`
        if (!seen.has(key)) {
          seen.add(key)
          actions.push(action)
        }
      }
    }

    return actions
  }

  /** 按 ID 获取桌面操作定义 */
  getAction(actionId: string): DesktopActionDefinition | undefined {
    this.ensureCache()
    const entry = this.actionCache.get(actionId)
    if (!entry) return undefined

    const actions = entry.runtime.getActionDefinitions?.() ?? []
    return actions.find(a => a.id === actionId)
  }

  /** 执行桌面操作 */
  async executeAction(
    actionId: string,
    args: Record<string, unknown>,
    context: DesktopActionContext,
  ): Promise<DesktopActionResult> {
    this.ensureCache()

    // 紧急停止检查
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      return {
        success: false,
        error: 'Emergency stop is active, action blocked',
        duration: 0,
        approvalDenied: true,
      }
    }

    const entry = this.actionCache.get(actionId)
    if (!entry) {
      return {
        success: false,
        error: `Desktop action not found: ${actionId}`,
        duration: 0,
      }
    }

    // 参数验证
    if (entry.runtime.validateActionArgs) {
      const validation = entry.runtime.validateActionArgs(actionId, args)
      if (!validation.valid) {
        return {
          success: false,
          error: `Parameter validation failed: ${validation.errors?.map(e => `${e.param}: ${e.message}`).join(', ')}`,
          duration: 0,
        }
      }
    }

    // 平台兼容性检查
    const actionDef = entry.runtime.getActionDefinitions?.().find(a => a.id === actionId)
    if (actionDef && !actionDef.platforms.includes(context.platform)) {
      return {
        success: false,
        error: `Action ${actionId} does not support platform ${context.platform}`,
        duration: 0,
      }
    }

    // 执行操作
    const startTime = Date.now()
    try {
      if (!entry.runtime.executeAction) {
        return {
          success: false,
          error: `Plugin ${entry.pluginId} does not implement executeAction`,
          duration: Date.now() - startTime,
        }
      }

      const result = await entry.runtime.executeAction(actionId, args, context)
      logger.system.info(
        `[DesktopPluginRegistry] Action ${actionId} executed by ${entry.pluginId}: ${result.success ? 'success' : 'failed'} (${result.duration}ms)`,
      )
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.system.error(`[DesktopPluginRegistry] Action ${actionId} failed: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      }
    }
  }

  // ============================================
  // 工作流步骤
  // ============================================

  /** 获取所有自定义工作流步骤定义 */
  getAllWorkflowSteps(): CustomWorkflowStepDef[] {
    this.ensureCache()
    const steps: CustomWorkflowStepDef[] = []
    const seen = new Set<string>()

    for (const { pluginId, runtime } of this.getDesktopPlugins()) {
      const pluginSteps = runtime.getWorkflowStepDefinitions?.() ?? []
      for (const step of pluginSteps) {
        const key = `${pluginId}:${step.typeId}`
        if (!seen.has(key)) {
          seen.add(key)
          steps.push(step)
        }
      }
    }

    return steps
  }

  /** 按 typeId 获取工作流步骤定义 */
  getWorkflowStep(typeId: string): CustomWorkflowStepDef | undefined {
    this.ensureCache()
    const entry = this.stepCache.get(typeId)
    if (!entry) return undefined

    const steps = entry.runtime.getWorkflowStepDefinitions?.() ?? []
    return steps.find(s => s.typeId === typeId)
  }

  /** 执行自定义工作流步骤 */
  async executeWorkflowStep(
    typeId: string,
    args: Record<string, unknown>,
    context: WorkflowStepContext,
  ): Promise<WorkflowStepResult> {
    this.ensureCache()

    // 紧急停止检查
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      return {
        success: false,
        error: 'Emergency stop is active, workflow step blocked',
      }
    }

    // 中止信号检查
    if (context.abortSignal.aborted) {
      return {
        success: false,
        error: 'Workflow step aborted',
      }
    }

    const entry = this.stepCache.get(typeId)
    if (!entry) {
      return {
        success: false,
        error: `Workflow step type not found: ${typeId}`,
      }
    }

    try {
      if (!entry.runtime.executeWorkflowStep) {
        return {
          success: false,
          error: `Plugin ${entry.pluginId} does not implement executeWorkflowStep`,
        }
      }

      const result = await entry.runtime.executeWorkflowStep(typeId, args, context)
      context.log(
        result.success ? 'info' : 'warn',
        `Step ${typeId} by ${entry.pluginId}: ${result.success ? 'success' : 'failed'}`,
      )
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      context.log('error', `Step ${typeId} failed: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  // ============================================
  // 录制事件
  // ============================================

  /** 获取所有自定义录制事件定义 */
  getAllRecordingEvents(): CustomRecordingEventDef[] {
    this.ensureCache()
    const events: CustomRecordingEventDef[] = []
    const seen = new Set<string>()

    for (const { pluginId, runtime } of this.getDesktopPlugins()) {
      const pluginEvents = runtime.getRecordingEventDefinitions?.() ?? []
      for (const evt of pluginEvents) {
        const key = `${pluginId}:${evt.typeId}`
        if (!seen.has(key)) {
          seen.add(key)
          events.push(evt)
        }
      }
    }

    return events
  }

  /** 回放自定义录制事件 */
  async replayRecordingEvent(
    typeId: string,
    data: Record<string, unknown>,
    context: DesktopActionContext,
  ): Promise<DesktopActionResult> {
    this.ensureCache()

    // 紧急停止检查
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      return {
        success: false,
        error: 'Emergency stop is active, recording event replay blocked',
        duration: 0,
      }
    }

    const entry = this.recordingEventCache.get(typeId)
    if (!entry) {
      return {
        success: false,
        error: `Recording event type not found: ${typeId}`,
        duration: 0,
      }
    }

    // 检查是否可回放
    const eventDef = entry.runtime.getRecordingEventDefinitions?.().find(e => e.typeId === typeId)
    if (eventDef && !eventDef.replayable) {
      return {
        success: false,
        error: `Recording event ${typeId} is not replayable`,
        duration: 0,
      }
    }

    const startTime = Date.now()
    try {
      if (!entry.runtime.replayRecordingEvent) {
        return {
          success: false,
          error: `Plugin ${entry.pluginId} does not implement replayRecordingEvent`,
          duration: Date.now() - startTime,
        }
      }

      const result = await entry.runtime.replayRecordingEvent(typeId, data, context)
      logger.system.info(
        `[DesktopPluginRegistry] Recording event ${typeId} replayed by ${entry.pluginId}: ${result.success ? 'success' : 'failed'}`,
      )
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.system.error(`[DesktopPluginRegistry] Recording event ${typeId} replay failed: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      }
    }
  }

  // ============================================
  // 视觉分析器
  // ============================================

  /** 获取所有视觉分析器 */
  getAllVisualAnalyzers(): VisualAnalyzerConfig[] {
    this.ensureCache()
    const analyzers: VisualAnalyzerConfig[] = []
    const seen = new Set<string>()

    for (const { pluginId, runtime } of this.getDesktopPlugins()) {
      const pluginAnalyzers = runtime.getVisualAnalyzers?.() ?? []
      for (const analyzer of pluginAnalyzers) {
        const key = `${pluginId}:${analyzer.id}`
        if (!seen.has(key)) {
          seen.add(key)
          analyzers.push(analyzer)
        }
      }
    }

    return analyzers
  }

  /** 执行视觉分析 */
  async analyzeVisual(
    analyzerId: string,
    request: VisualAnalysisRequest,
    apiKey?: string,
  ): Promise<VisualAnalysisResponse> {
    this.ensureCache()

    const entry = this.analyzerCache.get(analyzerId)
    if (!entry) {
      return {
        analysis: '',
        completed: false,
        completionReason: `Visual analyzer not found: ${analyzerId}`,
      }
    }

    // 检查是否需要 API Key
    const analyzer = entry.runtime.getVisualAnalyzers?.().find(a => a.id === analyzerId)
    if (analyzer?.requiresApiKey && !apiKey) {
      return {
        analysis: '',
        completed: false,
        completionReason: 'API key required but not provided',
      }
    }

    try {
      if (!entry.runtime.analyzeVisual) {
        return {
          analysis: '',
          completed: false,
          completionReason: `Plugin ${entry.pluginId} does not implement analyzeVisual`,
        }
      }

      const response = await entry.runtime.analyzeVisual(analyzerId, request, apiKey)
      logger.system.info(
        `[DesktopPluginRegistry] Visual analysis by ${analyzerId} (${entry.pluginId}): ${response.completed ? 'completed' : 'in progress'}`,
      )
      return response
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.system.error(`[DesktopPluginRegistry] Visual analysis ${analyzerId} failed: ${errorMsg}`)
      return {
        analysis: '',
        completed: false,
        completionReason: errorMsg,
      }
    }
  }
}

// ============================================
// 全局实例
// ============================================

let _instance: DesktopPluginRegistry | null = null

/** 获取 Desktop Plugin Registry 实例 */
export function getDesktopPluginRegistry(): DesktopPluginRegistry {
  if (!_instance) {
    _instance = new DesktopPluginRegistry()
  }
  return _instance
}

/** 重置 Desktop Plugin Registry（仅用于测试） */
export function resetDesktopPluginRegistry(): void {
  _instance = null
}

export { DesktopPluginRegistry }
