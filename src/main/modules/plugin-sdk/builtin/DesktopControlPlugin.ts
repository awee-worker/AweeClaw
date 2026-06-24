/**
 * 内置桌面控制插件（Phase 5）
 *
 * 作为 Desktop Plugin SDK 的参考实现，将 Phase 3/4 的桌面控制能力
 * 封装为标准插件，展示如何通过插件 SDK 扩展桌面控制功能。
 *
 * 提供的能力：
 * 1. 自定义桌面操作：截图分析、窗口布局、多屏操作
 * 2. 自定义工作流步骤：条件截图、智能等待
 * 3. 自定义录制事件：系统事件录制
 *
 * @module plugin-sdk/builtin/desktop-control
 */

import { getDesktopControlManager } from '@main/modules/desktop-control/DesktopControlManager'
import type { WindowInfo, ScreenshotResult } from '@main/modules/desktop-control/types/actions'
import { screen } from 'electron'
import type {
  DesktopPluginFactory,
  DesktopPluginRuntime,
  DesktopPluginManifest,
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
} from '@shared/plugin-sdk/desktop'
import type { PluginContext } from '@shared/plugin-sdk/types'

// ============================================
// 桌面操作定义
// ============================================

const ACTIONS: DesktopActionDefinition[] = [
  {
    id: 'screenshot_region',
    name: 'Screenshot Region',
    nameZh: '区域截图',
    description: 'Capture a screenshot of a specific screen region',
    descriptionZh: '截取屏幕指定区域',
    operationType: 'screen_capture',
    parameters: [
      { name: 'x', type: 'number', description: 'X coordinate', required: true },
      { name: 'y', type: 'number', description: 'Y coordinate', required: true },
      { name: 'width', type: 'number', description: 'Region width', required: true },
      { name: 'height', type: 'number', description: 'Region height', required: true },
      { name: 'displayId', type: 'number', description: 'Display ID (0=primary)', required: false, defaultValue: 0 },
    ],
    riskLevel: 'safe',
    requiresConfirmation: false,
    estimatedDurationMs: 200,
    readonly: true,
    platforms: ['darwin', 'win32', 'linux'],
    icon: 'camera',
  },
  {
    id: 'screenshot_all_displays',
    name: 'Screenshot All Displays',
    nameZh: '多屏截图',
    description: 'Capture screenshots from all connected displays',
    descriptionZh: '截取所有连接的显示器',
    operationType: 'screen_capture',
    parameters: [],
    riskLevel: 'safe',
    requiresConfirmation: false,
    estimatedDurationMs: 500,
    readonly: true,
    platforms: ['darwin', 'win32', 'linux'],
    icon: 'monitor',
  },
  {
    id: 'arrange_windows_grid',
    name: 'Arrange Windows Grid',
    nameZh: '窗口网格排列',
    description: 'Arrange open windows in a grid layout',
    descriptionZh: '将打开的窗口排列为网格布局',
    operationType: 'window_maximize',
    parameters: [
      { name: 'rows', type: 'number', description: 'Grid rows', required: false, defaultValue: 2 },
      { name: 'cols', type: 'number', description: 'Grid columns', required: false, defaultValue: 2 },
    ],
    riskLevel: 'moderate',
    requiresConfirmation: true,
    estimatedDurationMs: 1000,
    readonly: false,
    platforms: ['darwin', 'win32', 'linux'],
    icon: 'grid',
  },
  {
    id: 'focus_app_by_name',
    name: 'Focus App by Name',
    nameZh: '按名称聚焦应用',
    description: 'Focus an application window by app name',
    descriptionZh: '通过应用名称聚焦窗口',
    operationType: 'window_focus',
    parameters: [
      { name: 'appName', type: 'string', description: 'Application name', required: true },
    ],
    riskLevel: 'safe',
    requiresConfirmation: false,
    estimatedDurationMs: 300,
    readonly: false,
    platforms: ['darwin', 'win32', 'linux'],
    icon: 'app-window',
  },
]

// ============================================
// 自定义工作流步骤定义
// ============================================

const WORKFLOW_STEPS: CustomWorkflowStepDef[] = [
  {
    typeId: 'smart_wait',
    name: 'Smart Wait',
    nameZh: '智能等待',
    description: 'Wait until a condition is met or timeout (supports visual conditions)',
    descriptionZh: '等待条件满足或超时（支持视觉条件）',
    parameters: [
      { name: 'condition', type: 'string', description: 'Condition type: window_appears, window_disappears, pixel_color', required: true },
      { name: 'target', type: 'string', description: 'Target window name or pixel coordinates', required: true },
      { name: 'timeoutMs', type: 'number', description: 'Timeout in milliseconds', required: false, defaultValue: 30000 },
      { name: 'checkIntervalMs', type: 'number', description: 'Check interval in milliseconds', required: false, defaultValue: 500 },
    ],
    icon: 'clock',
    blocking: false,
  },
  {
    typeId: 'conditional_screenshot',
    name: 'Conditional Screenshot',
    nameZh: '条件截图',
    description: 'Take a screenshot only if a condition is met',
    descriptionZh: '仅在条件满足时截图',
    parameters: [
      { name: 'condition', type: 'string', description: 'Condition expression', required: true },
      { name: 'savePath', type: 'string', description: 'Save path for screenshot', required: true },
    ],
    icon: 'camera',
    blocking: false,
  },
]

// ============================================
// 自定义录制事件定义
// ============================================

const RECORDING_EVENTS: CustomRecordingEventDef[] = [
  {
    typeId: 'system_notification',
    name: 'System Notification',
    nameZh: '系统通知',
    description: 'System notification received during recording',
    dataSchema: [
      { name: 'title', type: 'string', description: 'Notification title', required: true },
      { name: 'body', type: 'string', description: 'Notification body', required: false },
      { name: 'appName', type: 'string', description: 'Source app name', required: false },
    ],
    replayable: false,
  },
  {
    typeId: 'clipboard_change',
    name: 'Clipboard Change',
    nameZh: '剪贴板变化',
    description: 'Clipboard content changed during recording',
    dataSchema: [
      { name: 'contentType', type: 'string', description: 'Content type: text, image, file', required: true },
      { name: 'textPreview', type: 'string', description: 'Text preview (first 100 chars)', required: false },
    ],
    replayable: false,
  },
]

// ============================================
// 视觉分析器配置
// ============================================

const VISUAL_ANALYZERS: VisualAnalyzerConfig[] = [
  {
    id: 'builtin_ui_detector',
    name: 'Built-in UI Detector',
    nameZh: '内置 UI 检测器',
    supportedTasks: ['find_button', 'find_input', 'find_menu', 'detect_dialog'],
    requiresApiKey: false,
  },
]

// ============================================
// 插件运行时实现
// ============================================

class BuiltinDesktopPluginRuntime implements DesktopPluginRuntime {
  readonly manifest: DesktopPluginManifest
  private ctx: PluginContext | null = null

  constructor(manifest: DesktopPluginManifest) {
    this.manifest = manifest
  }

  async initialize(ctx: PluginContext): Promise<void> {
    this.ctx = ctx
    ctx.logger.info('Builtin desktop control plugin initialized')
  }

  async destroy(): Promise<void> {
    this.ctx?.logger.info('Builtin desktop control plugin destroyed')
    this.ctx = null
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true, message: 'Builtin desktop control plugin is healthy' }
  }

  // ---- 桌面操作 ----

  getActionDefinitions(): DesktopActionDefinition[] {
    return ACTIONS
  }

  validateActionArgs(actionId: string, args: Record<string, unknown>): {
    valid: boolean
    errors?: Array<{ param: string; message: string }>
  } {
    const action = ACTIONS.find(a => a.id === actionId)
    if (!action) {
      return { valid: false, errors: [{ param: 'actionId', message: `Unknown action: ${actionId}` }] }
    }

    const errors: Array<{ param: string; message: string }> = []
    for (const param of action.parameters) {
      if (param.required && !(param.name in args)) {
        errors.push({ param: param.name, message: `Required parameter missing: ${param.name}` })
      }
      if (param.name in args) {
        const value = args[param.name]
        if (param.type === 'number' && typeof value !== 'number') {
          errors.push({ param: param.name, message: `${param.name} must be a number` })
        }
        if (param.type === 'string' && typeof value !== 'string') {
          errors.push({ param: param.name, message: `${param.name} must be a string` })
        }
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined }
  }

  async executeAction(
    actionId: string,
    args: Record<string, unknown>,
    context: DesktopActionContext,
  ): Promise<DesktopActionResult> {
    const startTime = Date.now()
    this.ctx?.logger.info(`Executing action: ${actionId} (source: ${context.source})`)

    try {
      switch (actionId) {
        case 'screenshot_region': {
          const x = args.x as number
          const y = args.y as number
          const width = args.width as number
          const height = args.height as number
          const displayId = (args.displayId as number) || 0

          const manager = getDesktopControlManager()
          const result = await manager.screenCapture.captureRegion({ x, y, width, height }, displayId)

          return {
            success: result.success,
            output: { dataUrl: result.dataUrl, width, height },
            duration: Date.now() - startTime,
            sideEffects: [`Captured region (${x},${y},${width}x${height}) from display ${displayId}`],
          }
        }

        case 'screenshot_all_displays': {
          const manager = getDesktopControlManager()
          const displays = await manager.screenCapture.captureAllScreens()

          return {
            success: true,
            output: { count: displays.length, dataUrls: displays.map((d: ScreenshotResult) => d.dataUrl) },
            duration: Date.now() - startTime,
            sideEffects: [`Captured ${displays.length} display(s)`],
          }
        }

        case 'arrange_windows_grid': {
          const rows = (args.rows as number) || 2
          const cols = (args.cols as number) || 2

          const manager = getDesktopControlManager()
          const windows = await manager.windowManager.list()
          const activeWindows = windows.filter((w: WindowInfo) => !w.isMinimized)

          if (activeWindows.length === 0) {
            return {
              success: false,
              error: 'No visible windows to arrange',
              duration: Date.now() - startTime,
            }
          }

          // 使用 Electron screen API 获取主显示器边界
          const primaryDisplay = screen.getPrimaryDisplay()
          const screenBounds = primaryDisplay.bounds
          const cellWidth = Math.floor(screenBounds.width / cols)
          const cellHeight = Math.floor(screenBounds.height / rows)

          let arranged = 0
          for (let i = 0; i < activeWindows.length && i < rows * cols; i++) {
            const row = Math.floor(i / cols)
            const col = i % cols
            const x = screenBounds.x + col * cellWidth
            const y = screenBounds.y + row * cellHeight

            try {
              await manager.windowManager.setBounds(activeWindows[i].id, {
                x,
                y,
                width: cellWidth,
                height: cellHeight,
              })
              arranged++
            } catch (err) {
              this.ctx?.logger.warn(`Failed to arrange window ${activeWindows[i].id}: ${err}`)
            }
          }

          return {
            success: true,
            output: { arranged, total: activeWindows.length },
            duration: Date.now() - startTime,
            sideEffects: [`Arranged ${arranged}/${activeWindows.length} windows in ${rows}x${cols} grid`],
          }
        }

        case 'focus_app_by_name': {
          const appName = args.appName as string
          const manager = getDesktopControlManager()

          const windows = await manager.windowManager.list()
          const target = windows.find((w: WindowInfo) =>
            w.title.toLowerCase().includes(appName.toLowerCase()) ||
            w.appName.toLowerCase().includes(appName.toLowerCase()),
          )

          if (!target) {
            return {
              success: false,
              error: `No window found for app: ${appName}`,
              duration: Date.now() - startTime,
            }
          }

          await manager.windowManager.focus(target.id)
          return {
            success: true,
            output: { windowId: target.id, title: target.title },
            duration: Date.now() - startTime,
            sideEffects: [`Focused window: ${target.title}`],
          }
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${actionId}`,
            duration: Date.now() - startTime,
          }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.ctx?.logger.error(`Action ${actionId} failed: ${errorMsg}`)
      return {
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      }
    }
  }

  // ---- 工作流步骤 ----

  getWorkflowStepDefinitions(): CustomWorkflowStepDef[] {
    return WORKFLOW_STEPS
  }

  async executeWorkflowStep(
    typeId: string,
    args: Record<string, unknown>,
    context: WorkflowStepContext,
  ): Promise<WorkflowStepResult> {
    context.log('info', `Executing custom step: ${typeId}`)

    try {
      switch (typeId) {
        case 'smart_wait': {
          const condition = args.condition as string
          const target = args.target as string
          const timeoutMs = (args.timeoutMs as number) || 30000
          const checkIntervalMs = (args.checkIntervalMs as number) || 500

          const manager = getDesktopControlManager()
          const startTime = Date.now()

          while (Date.now() - startTime < timeoutMs) {
            if (context.abortSignal.aborted) {
              return { success: false, error: 'Aborted' }
            }

            const windows = await manager.windowManager.list()

            if (condition === 'window_appears') {
              const found = windows.find((w: WindowInfo) =>
                w.title.toLowerCase().includes(target.toLowerCase()) ||
                w.appName.toLowerCase().includes(target.toLowerCase()),
              )
              if (found) {
                return {
                  success: true,
                  output: { windowId: found.id, title: found.title },
                }
              }
            } else if (condition === 'window_disappears') {
              const found = windows.find((w: WindowInfo) =>
                w.title.toLowerCase().includes(target.toLowerCase()) ||
                w.appName.toLowerCase().includes(target.toLowerCase()),
              )
              if (!found) {
                return { success: true, output: { disappeared: true } }
              }
            }

            await new Promise(resolve => setTimeout(resolve, checkIntervalMs))
          }

          return {
            success: false,
            error: `Smart wait timed out after ${timeoutMs}ms`,
          }
        }

        case 'conditional_screenshot': {
          const condition = args.condition as string
          const savePath = args.savePath as string

          // 简化实现：条件为 "always" 时总是截图
          // 实际实现可解析条件表达式
          if (condition === 'always' || condition === 'true') {
            const manager = getDesktopControlManager()
            const result = await manager.screenCapture.captureScreen()

            return {
              success: result.success,
              output: { dataUrl: result.dataUrl, savePath, conditionMet: true },
            }
          }

          return {
            success: true,
            output: { conditionMet: false, skipped: true },
          }
        }

        default:
          return {
            success: false,
            error: `Unknown workflow step type: ${typeId}`,
          }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      context.log('error', `Step ${typeId} failed: ${errorMsg}`)
      return { success: false, error: errorMsg }
    }
  }

  // ---- 录制事件 ----

  getRecordingEventDefinitions(): CustomRecordingEventDef[] {
    return RECORDING_EVENTS
  }

  async replayRecordingEvent(
    typeId: string,
    _data: Record<string, unknown>,
    _context: DesktopActionContext,
  ): Promise<DesktopActionResult> {
    const startTime = Date.now()

    // 系统通知和剪贴板变化事件不可回放（仅记录）
    return {
      success: false,
      error: `Recording event ${typeId} is not replayable (record-only)`,
      duration: Date.now() - startTime,
    }
  }

  // ---- 视觉分析器 ----

  getVisualAnalyzers(): VisualAnalyzerConfig[] {
    return VISUAL_ANALYZERS
  }

  async analyzeVisual(
    analyzerId: string,
    request: VisualAnalysisRequest,
    _apiKey?: string,
  ): Promise<VisualAnalysisResponse> {
    if (analyzerId !== 'builtin_ui_detector') {
      return {
        analysis: '',
        completed: false,
        completionReason: `Unknown analyzer: ${analyzerId}`,
      }
    }

    // 简化实现：返回基础分析
    // 实际实现可使用图像处理库检测 UI 元素
    return {
      analysis: `Screenshot analyzed (${request.screenshot.length} bytes). Task: ${request.task}`,
      action: undefined,
      completed: false,
      completionReason: 'Built-in UI detector requires external image processing library',
    }
  }
}

// ============================================
// 插件 Manifest
// ============================================

const MANIFEST: DesktopPluginManifest = {
  id: 'desktop-builtin',
  name: 'Built-in Desktop Control',
  nameZh: '内置桌面控制',
  description: 'Built-in desktop control plugin providing screenshot, window management, and workflow extensions',
  descriptionZh: '内置桌面控制插件，提供截图、窗口管理和工作流扩展',
  type: 'desktop',
  version: '1.0.0',
  main: __filename,
  icon: 'monitor',
  lifecycle: 'singleton',
  builtin: true,
  author: 'AweeClaw',
  capabilities: {
    desktop: {
      operations: ['screen_capture', 'window_focus', 'window_maximize', 'window_minimize'],
      requiresAccessibility: false,
      requiresScreenCapture: true,
      workflowSteps: true,
      recordingEvents: true,
    },
  },
  permissions: ['desktop.screen', 'desktop.windows', 'desktop.workflow'],
  platforms: ['darwin', 'win32', 'linux'],
  actions: ACTIONS,
  workflowSteps: WORKFLOW_STEPS,
  recordingEvents: RECORDING_EVENTS,
  visualAnalyzers: VISUAL_ANALYZERS,
}

// ============================================
// 插件工厂
// ============================================

export const builtinDesktopPluginFactory: DesktopPluginFactory = {
  create(_context: PluginContext): DesktopPluginRuntime {
    return new BuiltinDesktopPluginRuntime(MANIFEST)
  },
  getManifest(): DesktopPluginManifest {
    return MANIFEST
  },
}

/** 获取内置桌面控制插件的 Manifest */
export function getBuiltinDesktopManifest(): DesktopPluginManifest {
  return MANIFEST
}
