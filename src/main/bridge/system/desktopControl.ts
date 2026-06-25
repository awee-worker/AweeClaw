/**
 * 桌面控制桥接 — 桌面自动化控制的 IPC 接口
 *
 * 职责：
 * - 暴露桌面操作（鼠标、键盘、屏幕）的 IPC 接口
 * - 所有操作通过 DesktopControlManager 统一调度，自动完成权限校验
 * - 支持紧急停止、无障碍权限检查、操作录制
 */

import { BrowserWindow } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../../modules/desktop-control/DesktopControlManager'
import { getAccessibilityPermissionService } from '../../modules/desktop-control/AccessibilityPermission'
import { getEmergencyStopController, EMERGENCY_STOP_EVENT, EMERGENCY_RESET_EVENT } from '../../modules/desktop-control/EmergencyStop'
import type { ConfirmationResponse } from '../../modules/desktop-control/DesktopGuard'
import type { AccessibilityPermissionType } from '../../modules/desktop-control/AccessibilityPermission'
import { getActionRecorder } from '../../modules/desktop-control/ActionRecorder'
import { getActionReplayer } from '../../modules/desktop-control/ActionReplayer'
import { getWorkflowEngine } from '../../modules/desktop-control/WorkflowEngine'
import { getVisualAgentLoop } from '../../modules/desktop-control/VisualAgentLoop'
import type { MouseButton, ClickType } from '../../modules/desktop-control/types/actions'
import type { RecordingScript, ReplayConfig } from '../../modules/desktop-control/types/recording'
import type { WorkflowDefinition } from '../../modules/desktop-control/types/workflow'
import { SettingsDb } from '../../modules/settings-db'
import type { LLMConfig } from '@shared/protocols/modelProtocol'

/**
 * 云端模式配置（由渲染进程在调用 visualAgentRun 时传入）
 * 主进程无法直接访问渲染进程内存中的 token，因此通过参数传递
 */
export interface CloudModeConfig {
  cloudMode: boolean
  serverUrl?: string
  accessToken?: string
  refreshToken?: string
}

/**
 * 解析视觉智能体使用的 LLM 配置
 *
 * 优先级：
 * 1. 若传入 cloudModeConfig 且为云端模式 → 使用云端配置（转发到后端 /api/v1/llm/vision/chat）
 * 2. 否则读取本地 vision_model_config 表（自定义模式下的独立视觉模型配置）
 * 3. 若视觉模型未配置，回退到当前活跃的聊天模型配置
 * 4. 全部失败则返回占位配置，调用方需处理鉴权失败
 */
function resolveActiveLLMConfig(cloudConfig?: CloudModeConfig): LLMConfig {
  // 1. 云端模式：使用后端配置的视觉模型，客户端只需转发 token
  if (cloudConfig?.cloudMode && cloudConfig.serverUrl && (cloudConfig.accessToken || cloudConfig.refreshToken)) {
    return {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
      cloudMode: true,
      cloudVisionMode: true,
      serverUrl: cloudConfig.serverUrl,
      accessToken: cloudConfig.accessToken || '',
      refreshToken: cloudConfig.refreshToken,
    }
  }

  // 2. 自定义模式：优先读取独立的视觉模型配置
  try {
    const db = SettingsDb.getInstance()
    const visionConfig = db.getVisionModelConfig()
    if (visionConfig?.enabled && visionConfig.provider && visionConfig.model && visionConfig.apiKey) {
      return {
        provider: visionConfig.provider,
        model: visionConfig.model,
        apiKey: visionConfig.apiKey,
        baseUrl: visionConfig.baseUrl || undefined,
        timeout: visionConfig.timeout,
        protocol: visionConfig.protocol,
        openAICompatibilityProfile: visionConfig.openAICompatibilityProfile,
        headers: Object.keys(visionConfig.headers || {}).length > 0 ? visionConfig.headers : undefined,
      }
    }
  } catch (err) {
    // 视觉模型配置读取失败，继续回退
  }

  // 3. 回退到当前活跃的聊天模型配置
  try {
    const db = SettingsDb.getInstance()
    const providerId = db.getCurrentProviderId()
    if (!providerId) {
      throw new Error('No active provider configured')
    }
    const config = db.getProviderConfig(providerId)
    if (!config || !config.apiKey) {
      throw new Error(`Provider ${providerId} has no apiKey`)
    }
    return {
      provider: providerId,
      model: config.model ?? 'gpt-4o',
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: config.timeout,
    }
  } catch (err) {
    // 4. 返回最小可用配置，视觉闭环运行时会因鉴权失败而中止
    return {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '',
    }
  }
}

/**
 * 注册桌面控制 IPC handlers
 * @param getMainWindow 获取主窗口函数（用于权限确认弹窗）
 */
export function registerDesktopControlHandlers(getMainWindow: (windowId?: number) => BrowserWindow | null): void {
  const manager = getDesktopControlManager()

  // 绑定主窗口（用于权限确认弹窗推送）
  const window = getMainWindow()
  if (window) {
    manager.bindWindow(window)
  }

  // ============ 应用启动 ============

  /** 启动应用 */
  safeIpcHandle('desktop:launchApp', async (_event, name: string, args?: string[]) => {
    const result = await manager.launchApp(name, args)
    return { success: true, data: result }
  })

  /** 退出应用 */
  safeIpcHandle('desktop:quitApp', async (_event, name: string) => {
    const result = await manager.quitApp(name)
    return { success: true, data: result }
  })

  /** 列出已安装应用 */
  safeIpcHandle('desktop:listInstalledApps', async () => {
    const apps = await manager.listInstalledApps()
    return { success: true, data: apps }
  })

  /** 查找已安装应用 */
  safeIpcHandle('desktop:findApp', async (_event, name: string) => {
    const app = await manager.findApp(name)
    return { success: true, data: app }
  })

  /** 用默认浏览器打开 URL */
  safeIpcHandle('desktop:openUrl', async (_event, url: string) => {
    const result = await manager.openUrl(url)
    return { success: true, data: result }
  })

  /** 用默认程序打开文件 */
  safeIpcHandle('desktop:openFile', async (_event, filePath: string) => {
    const result = await manager.openFile(filePath)
    return { success: true, data: result }
  })

  // ============ 系统信息 ============

  /** 获取系统信息 */
  safeIpcHandle('desktop:getSystemInfo', async () => {
    const info = await manager.getSystemInfo()
    return { success: true, data: info }
  })

  /** 设置系统音量 */
  safeIpcHandle('desktop:setVolume', async (_event, volume: number) => {
    const result = await manager.setVolume(volume)
    return { success: true, data: result }
  })

  /** 设置屏幕亮度 */
  safeIpcHandle('desktop:setBrightness', async (_event, level: number) => {
    const result = await manager.setBrightness(level)
    return { success: true, data: result }
  })

  // ============ 进程管理 ============

  /** 列出所有进程 */
  safeIpcHandle('desktop:listProcesses', async () => {
    const processes = await manager.listProcesses()
    return { success: true, data: processes }
  })

  /** 查找进程 */
  safeIpcHandle('desktop:findProcess', async (_event, query: string | number) => {
    const processes = await manager.findProcess(query)
    return { success: true, data: processes }
  })

  /** 终止进程 */
  safeIpcHandle('desktop:killProcess', async (_event, pid: number, force?: boolean) => {
    const result = await manager.killProcess(pid, force)
    return { success: true, data: result }
  })

  /** 检查进程是否在运行 */
  safeIpcHandle('desktop:isProcessRunning', async (_event, name: string) => {
    const running = await manager.isProcessRunning(name)
    return { success: true, data: running }
  })

  // ============ 权限确认回调 ============

  /** 前端用户确认后回调 */
  safeIpcHandle('desktop:resolveConfirmation', async (_event, id: string, response: ConfirmationResponse) => {
    manager.guard.resolveConfirmation(id, response)
    return { success: true }
  })

  // ============ 窗口控制（Phase 2） ============

  /** 列出所有窗口 */
  safeIpcHandle('desktop:listWindows', async () => {
    try {
      const windows = await manager.listWindows()
      return { success: true, data: windows }
    } catch (err) {
      const e = err as Error & { code?: string }
      logger.desktop?.error?.('[desktopControl] listWindows failed:', e.message)
      return {
        success: false,
        error: e.message || 'Failed to list windows',
        code: e.code,
      }
    }
  })

  /** 查找窗口 */
  safeIpcHandle('desktop:findWindow', async (_event, query: string) => {
    const windows = await manager.findWindow(query)
    return { success: true, data: windows }
  })

  /** 聚焦窗口 */
  safeIpcHandle('desktop:focusWindow', async (_event, windowId: string) => {
    const result = await manager.focusWindow(windowId)
    return { success: true, data: result }
  })

  /** 最小化窗口 */
  safeIpcHandle('desktop:minimizeWindow', async (_event, windowId: string) => {
    const result = await manager.minimizeWindow(windowId)
    return { success: true, data: result }
  })

  /** 最大化窗口 */
  safeIpcHandle('desktop:maximizeWindow', async (_event, windowId: string) => {
    const result = await manager.maximizeWindow(windowId)
    return { success: true, data: result }
  })

  /** 还原窗口 */
  safeIpcHandle('desktop:restoreWindow', async (_event, windowId: string) => {
    const result = await manager.restoreWindow(windowId)
    return { success: true, data: result }
  })

  /** 关闭窗口 */
  safeIpcHandle('desktop:closeWindow', async (_event, windowId: string) => {
    const result = await manager.closeWindow(windowId)
    return { success: true, data: result }
  })

  /** 置顶窗口 */
  safeIpcHandle('desktop:bringWindowToFront', async (_event, windowId: string) => {
    const result = await manager.bringWindowToFront(windowId)
    return { success: true, data: result }
  })

  /** 设置窗口位置和大小 */
  safeIpcHandle('desktop:setWindowBounds', async (_event, windowId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const result = await manager.setWindowBounds(windowId, bounds)
    return { success: true, data: result }
  })

  // ============ 屏幕截图（Phase 2） ============

  /** 截取整个屏幕 */
  safeIpcHandle('desktop:captureScreen', async (_event, displayId?: number) => {
    const result = await manager.captureScreen(displayId)
    return { success: true, data: result }
  })

  /** 截取指定区域 */
  safeIpcHandle('desktop:captureRegion', async (_event, region: { x: number; y: number; width: number; height: number }, displayId?: number) => {
    const result = await manager.captureRegion(region, displayId)
    return { success: true, data: result }
  })

  /** 截取所有屏幕 */
  safeIpcHandle('desktop:captureAllScreens', async () => {
    const result = await manager.captureAllScreens()
    return { success: true, data: result }
  })

  // ============ 输入模拟（Phase 2） ============

  /** 鼠标点击 */
  safeIpcHandle('desktop:mouseClick', async (_event, params: { x: number; y: number; button: 'left' | 'right' | 'middle'; clickType: 'single' | 'double' }) => {
    const result = await manager.mouseClick(params)
    return { success: true, data: result }
  })

  /** 鼠标移动 */
  safeIpcHandle('desktop:mouseMove', async (_event, params: { x: number; y: number; smooth?: boolean; duration?: number }) => {
    const result = await manager.mouseMove(params)
    return { success: true, data: result }
  })

  /** 鼠标滚动 */
  safeIpcHandle('desktop:mouseScroll', async (_event, params: { x: number; y: number; amount: number }) => {
    const result = await manager.mouseScroll(params)
    return { success: true, data: result }
  })

  /** 鼠标拖拽 */
  safeIpcHandle('desktop:mouseDrag', async (_event, params: { fromX: number; fromY: number; toX: number; toY: number; button: 'left' | 'right' | 'middle'; duration?: number }) => {
    const result = await manager.mouseDrag(params)
    return { success: true, data: result }
  })

  /** 输入文本 */
  safeIpcHandle('desktop:typeText', async (_event, text: string, delayMs?: number) => {
    const result = await manager.typeText(text, delayMs)
    return { success: true, data: result }
  })

  /** 按下单个按键 */
  safeIpcHandle('desktop:pressKey', async (_event, key: string) => {
    const result = await manager.pressKey(key)
    return { success: true, data: result }
  })

  /** 组合键 */
  safeIpcHandle('desktop:keyCombo', async (_event, keys: string[]) => {
    const result = await manager.keyCombo(keys)
    return { success: true, data: result }
  })

  // ============ 文件操作（Phase 2） ============

  /** 复制文件/目录 */
  safeIpcHandle('desktop:copyFile', async (_event, sourcePath: string, targetPath: string) => {
    const result = await manager.copyFile(sourcePath, targetPath)
    return { success: true, data: result }
  })

  /** 移动文件/目录 */
  safeIpcHandle('desktop:moveFile', async (_event, sourcePath: string, targetPath: string) => {
    const result = await manager.moveFile(sourcePath, targetPath)
    return { success: true, data: result }
  })

  /** 删除文件/目录 */
  safeIpcHandle('desktop:deleteFile', async (_event, targetPath: string) => {
    const result = await manager.deleteFile(targetPath)
    return { success: true, data: result }
  })

  /** 重命名文件/目录 */
  safeIpcHandle('desktop:renameFile', async (_event, sourcePath: string, newName: string) => {
    const result = await manager.renameFile(sourcePath, newName)
    return { success: true, data: result }
  })

  /** 获取文件信息 */
  safeIpcHandle('desktop:getFileInfo', async (_event, targetPath: string) => {
    const info = await manager.getFileInfo(targetPath)
    return { success: true, data: info }
  })

  /** 判断文件是否存在 */
  safeIpcHandle('desktop:fileExists', async (_event, targetPath: string) => {
    const exists = await manager.fileExists(targetPath)
    return { success: true, data: exists }
  })

  /** 创建目录 */
  safeIpcHandle('desktop:createDirectory', async (_event, targetPath: string) => {
    const result = await manager.createDirectory(targetPath)
    return { success: true, data: result }
  })

  /** 列出目录内容 */
  safeIpcHandle('desktop:listDirectory', async (_event, targetPath: string) => {
    const entries = await manager.listDirectory(targetPath)
    return { success: true, data: entries }
  })

  // ============ 紧急停止（Phase 3） ============

  /** 获取紧急停止状态 */
  safeIpcHandle('desktop:emergencyStopGetState', async () => {
    return { success: true, data: manager.getEmergencyStopState() }
  })

  /** 触发紧急停止 */
  safeIpcHandle('desktop:emergencyStopTrigger', async (_event, params: { source: string; reason?: string }) => {
    manager.triggerEmergencyStop({
      source: params.source as 'user' | 'system' | 'agent' | 'timeout' | 'external',
      reason: params.reason,
    })
    return { success: true }
  })

  /** 复位紧急停止 */
  safeIpcHandle('desktop:emergencyStopReset', async () => {
    manager.resetEmergencyStop()
    return { success: true }
  })

  // ============ 辅助功能权限（Phase 3） ============

  /** 检测权限状态 */
  safeIpcHandle('desktop:accessibilityCheck', async (_event, type?: string, forceRefresh?: boolean) => {
    const service = getAccessibilityPermissionService()
    const result = await service.check(
      (type as AccessibilityPermissionType) || 'accessibility',
      forceRefresh,
    )
    return { success: true, data: result }
  })

  /** 检测所有权限 */
  safeIpcHandle('desktop:accessibilityCheckAll', async (_event, forceRefresh?: boolean) => {
    const service = getAccessibilityPermissionService()
    const results = await service.checkAll(forceRefresh)
    return { success: true, data: results }
  })

  /** 打开系统偏好设置 */
  safeIpcHandle('desktop:accessibilityOpenPreferences', async (_event, type?: string) => {
    const service = getAccessibilityPermissionService()
    const opened = await service.openSystemPreferences(
      (type as AccessibilityPermissionType) || 'accessibility',
    )
    return { success: true, data: opened }
  })

  /** 请求权限 */
  safeIpcHandle('desktop:accessibilityRequestPermission', async (_event, type?: string) => {
    const service = getAccessibilityPermissionService()
    const result = await service.requestPermission(
      (type as AccessibilityPermissionType) || 'accessibility',
    )
    return { success: true, data: result }
  })

  // ============ 事件推送（Phase 3） ============

  // 紧急停止状态变化事件推送到渲染进程
  const stopController = getEmergencyStopController()
  stopController.on(EMERGENCY_STOP_EVENT, (state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:emergencyStopStateChanged', state)
    }
  })
  stopController.on(EMERGENCY_RESET_EVENT, (state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:emergencyStopStateChanged', state)
    }
  })

  // 辅助功能权限变化事件推送
  const accessibilityService = getAccessibilityPermissionService()
  accessibilityService.onPermissionChange((type, status) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:accessibilityPermissionChanged', { type, status })
    }
  })

  // ============ 操作录制（Phase 4） ============

  /** 开始录制 */
  safeIpcHandle('desktop:recordingStart', async (_event, params: { name: string; description?: string }) => {
    const recorder = getActionRecorder()
    recorder.start({ name: params.name, description: params.description })
    return { success: true }
  })

  /** 停止录制 */
  safeIpcHandle('desktop:recordingStop', async (_event, params: { discard?: boolean }) => {
    const recorder = getActionRecorder()
    const script = recorder.stop(params.discard === true)
    if (script) {
      const engine = getWorkflowEngine()
      engine.saveRecording(script)
    }
    return { success: true, data: script }
  })

  /** 记录单个操作 */
  safeIpcHandle('desktop:recordAction', async (_event, params: { actionType: string; params: Record<string, unknown> }) => {
    const recorder = getActionRecorder()
    const p = params.params
    switch (params.actionType) {
      case 'mouse_click':
        recorder.recordMouseClick(p as unknown as { x: number; y: number; button: MouseButton; clickType: ClickType })
        break
      case 'mouse_move':
        recorder.recordMouseMove(p as unknown as { x: number; y: number })
        break
      case 'mouse_scroll':
        recorder.recordMouseScroll({
          x: (p.x as number) ?? 0,
          y: (p.y as number) ?? 0,
          amount: (p.amount as number) ?? (p.deltaY as number) ?? 0,
        })
        break
      case 'type_text':
        recorder.recordTypeText((p as { text: string }).text)
        break
      case 'key_press':
        recorder.recordKeyPress((p as { key: string }).key)
        break
      case 'key_combo':
        recorder.recordKeyCombo((p as { keys: string[] }).keys)
        break
      case 'window_focus':
        recorder.recordWindowFocus(p as unknown as { windowId: string; windowTitle: string; appName: string })
        break
      case 'app_launch':
        recorder.recordAppLaunch(p as unknown as { appName: string; args?: string[] })
        break
      default:
        throw new Error(`Unknown action type: ${params.actionType}`)
    }
    return { success: true }
  })

  /** 回放录制 */
  safeIpcHandle('desktop:replayRecording', async (_event, params: { recordingId: string; config?: Record<string, unknown> }) => {
    const engine = getWorkflowEngine()
    const script = engine.getRecording(params.recordingId)
    if (!script) {
      throw new Error(`Recording not found: ${params.recordingId}`)
    }
    const replayer = getActionReplayer()
    const result = await replayer.replay(script, params.config as Partial<ReplayConfig>)
    return { success: true, data: result }
  })

  /** 列出所有录制 */
  safeIpcHandle('desktop:listRecordings', async () => {
    const engine = getWorkflowEngine()
    const recordings = engine.listRecordings()
    return { success: true, data: recordings }
  })

  /** 删除录制 */
  safeIpcHandle('desktop:deleteRecording', async (_event, recordingId: string) => {
    const engine = getWorkflowEngine()
    engine.deleteRecording(recordingId)
    return { success: true }
  })

  /** 获取录制状态 */
  safeIpcHandle('desktop:recordingGetState', async () => {
    const recorder = getActionRecorder()
    return { success: true, data: { state: recorder.state, session: recorder.currentSession } }
  })

  // 录制状态变化事件推送
  const recorder = getActionRecorder()
  recorder.on('stateChange', (state) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:recordingStateChanged', state)
    }
  })
  recorder.on('progress', (progress) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:recordingProgress', progress)
    }
  })

  // ============ 视觉闭环（Phase 4） ============

  /** 启动视觉闭环 */
  safeIpcHandle('desktop:visualAgentRun', async (_event, params: { task: string; maxSteps?: number; cloudConfig?: CloudModeConfig }) => {
    const loop = getVisualAgentLoop()
    const visionModel = resolveActiveLLMConfig(params.cloudConfig)
    const result = await loop.run({
      task: params.task,
      maxSteps: params.maxSteps ?? 10,
      visionModel,
      verifyBeforeAction: true,
      stepInterval: 500,
      stepTimeout: 30000,
      allowDangerousActions: false,
    })
    return { success: true, data: result }
  })

  /** 中止视觉闭环 */
  safeIpcHandle('desktop:visualAgentAbort', async () => {
    const loop = getVisualAgentLoop()
    loop.abort()
    return { success: true }
  })

  /** 查询视觉闭环是否运行中 */
  safeIpcHandle('desktop:visualAgentIsRunning', async () => {
    const loop = getVisualAgentLoop()
    return { success: true, data: loop.running }
  })

  // 视觉闭环事件推送
  const visualLoop = getVisualAgentLoop()
  visualLoop.on('stepStart', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:visualAgentStepStart', data)
    }
  })
  visualLoop.on('stepComplete', (step) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:visualAgentStepComplete', step)
    }
  })
  visualLoop.on('stepError', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:visualAgentStepError', data)
    }
  })
  visualLoop.on('completed', (result) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:visualAgentCompleted', result)
    }
  })
  visualLoop.on('aborted', (result) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:visualAgentAborted', result)
    }
  })

  // ============ 工作流引擎（Phase 4） ============

  /** 注册工作流 */
  safeIpcHandle('desktop:workflowRegister', async (_event, workflow: WorkflowDefinition) => {
    const engine = getWorkflowEngine()
    engine.register(workflow)
    return { success: true }
  })

  /** 更新工作流 */
  safeIpcHandle('desktop:workflowUpdate', async (_event, workflowId: string, updates: Partial<WorkflowDefinition>) => {
    const engine = getWorkflowEngine()
    const updated = engine.update(workflowId, updates)
    return { success: true, data: updated }
  })

  /** 注销工作流 */
  safeIpcHandle('desktop:workflowUnregister', async (_event, workflowId: string) => {
    const engine = getWorkflowEngine()
    engine.unregister(workflowId)
    return { success: true }
  })

  /** 获取工作流 */
  safeIpcHandle('desktop:workflowGet', async (_event, workflowId: string) => {
    const engine = getWorkflowEngine()
    const workflow = engine.get(workflowId)
    return { success: true, data: workflow }
  })

  /** 列出所有工作流 */
  safeIpcHandle('desktop:workflowList', async () => {
    const engine = getWorkflowEngine()
    const workflows = engine.list()
    return { success: true, data: workflows }
  })

  /** 运行工作流 */
  safeIpcHandle('desktop:workflowRun', async (_event, params: { workflowId: string; variables?: Record<string, unknown> }) => {
    const engine = getWorkflowEngine()
    const result = await engine.run(params.workflowId, { type: 'manual' }, params.variables)
    return { success: true, data: result }
  })

  /** 中止工作流 */
  safeIpcHandle('desktop:workflowAbort', async (_event, runId: string) => {
    const engine = getWorkflowEngine()
    engine.abort(runId)
    return { success: true }
  })

  /** 获取运行中的工作流 */
  safeIpcHandle('desktop:workflowGetRunning', async () => {
    const engine = getWorkflowEngine()
    const running = engine.getRunningWorkflows()
    return { success: true, data: running }
  })

  /** 保存录制脚本 */
  safeIpcHandle('desktop:workflowSaveRecording', async (_event, script: RecordingScript) => {
    const engine = getWorkflowEngine()
    engine.saveRecording(script)
    return { success: true }
  })

  /** 获取录制脚本 */
  safeIpcHandle('desktop:workflowGetRecording', async (_event, recordingId: string) => {
    const engine = getWorkflowEngine()
    const script = engine.getRecording(recordingId)
    return { success: true, data: script }
  })

  /** 列出所有录制脚本 */
  safeIpcHandle('desktop:workflowListRecordings', async () => {
    const engine = getWorkflowEngine()
    const recordings = engine.listRecordings()
    return { success: true, data: recordings }
  })

  /** 删除录制脚本 */
  safeIpcHandle('desktop:workflowDeleteRecording', async (_event, recordingId: string) => {
    const engine = getWorkflowEngine()
    engine.deleteRecording(recordingId)
    return { success: true }
  })

  // 工作流事件推送
  const workflowEngine = getWorkflowEngine()
  workflowEngine.on('stateChange', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowStateChanged', data)
    }
  })
  workflowEngine.on('stepStart', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowStepStart', data)
    }
  })
  workflowEngine.on('stepComplete', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowStepComplete', data)
    }
  })
  workflowEngine.on('stepError', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowStepError', data)
    }
  })
  workflowEngine.on('log', (data) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowLog', data)
    }
  })
  workflowEngine.on('completed', (result) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('desktop:workflowCompleted', result)
    }
  })

  // ============ Phase 5: 桌面控制插件 SDK ============

  safeIpcHandle('desktop:pluginListActions', async () => {
    const { getDesktopPluginRegistry } = await import('../../modules/plugin-sdk/DesktopPluginRegistry')
    const registry = getDesktopPluginRegistry()
    return { success: true, data: registry.getAllActions() }
  })

  safeIpcHandle('desktop:pluginExecuteAction', async (_event, params: {
    actionId: string
    args: Record<string, unknown>
    source?: 'user' | 'agent' | 'workflow' | 'replay' | 'visual-agent'
  }) => {
    const { getDesktopPluginRegistry } = await import('../../modules/plugin-sdk/DesktopPluginRegistry')
    const registry = getDesktopPluginRegistry()
    const result = await registry.executeAction(params.actionId, params.args, {
      source: params.source || 'user',
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    })
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:pluginListWorkflowSteps', async () => {
    const { getDesktopPluginRegistry } = await import('../../modules/plugin-sdk/DesktopPluginRegistry')
    const registry = getDesktopPluginRegistry()
    return { success: true, data: registry.getAllWorkflowSteps() }
  })

  safeIpcHandle('desktop:pluginListRecordingEvents', async () => {
    const { getDesktopPluginRegistry } = await import('../../modules/plugin-sdk/DesktopPluginRegistry')
    const registry = getDesktopPluginRegistry()
    return { success: true, data: registry.getAllRecordingEvents() }
  })

  safeIpcHandle('desktop:pluginListAnalyzers', async () => {
    const { getDesktopPluginRegistry } = await import('../../modules/plugin-sdk/DesktopPluginRegistry')
    const registry = getDesktopPluginRegistry()
    return { success: true, data: registry.getAllVisualAnalyzers() }
  })

  // ============ Phase 5: 工作流模板市场 ============

  safeIpcHandle('desktop:templateSearch', async (_event, params: { query: string; page?: number; pageSize?: number }) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.search(params.query, params.page, params.pageSize)
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateGetByCategory', async (_event, params: { category: string; page?: number; pageSize?: number }) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.getByCategory(params.category as any, params.page, params.pageSize)
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateGetFeatured', async () => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.getFeatured()
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateGetDetails', async (_event, templateId: string) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.getDetails(templateId)
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateGetCategories', async () => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.getCategories()
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateInstall', async (_event, params: { templateId: string; targetVersion?: string }) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.install(params.templateId, params.targetVersion)
    // 安装成功后注册到 WorkflowEngine
    if (result.installed && result.workflow) {
      const engine = getWorkflowEngine()
      engine.register(result.workflow)
    }
    return { success: result.installed, data: result, error: result.error }
  })

  safeIpcHandle('desktop:templateUninstall', async (_event, templateId: string) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.uninstall(templateId)
    return { success: result.success, error: result.error }
  })

  safeIpcHandle('desktop:templateGetInstalled', async () => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.getInstalled()
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templateCheckUpdates', async (_event, templates: Array<{ id: string; version: string }>) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.checkUpdates(templates)
    return { success: true, data: result }
  })

  safeIpcHandle('desktop:templatePublish', async (_event, request: any) => {
    const { workflowTemplateAPI } = await import('../../../scenario-system/workflow-marketplace')
    const result = await workflowTemplateAPI.publish(request)
    return { success: result.published, data: result, error: result.error }
  })

  safeIpcHandle('desktop:templateExport', async (_event, workflowId: string) => {
    const engine = getWorkflowEngine()
    const workflow = engine.get(workflowId)
    if (!workflow) {
      return { success: false, error: `Workflow not found: ${workflowId}` }
    }
    const { exportWorkflowAsTemplate } = await import('../../../scenario-system/workflow-marketplace')
    const json = exportWorkflowAsTemplate(workflow)
    return { success: true, data: json }
  })

  safeIpcHandle('desktop:templateImport', async (_event, json: string) => {
    try {
      const { importWorkflowFromTemplate } = await import('../../../scenario-system/workflow-marketplace')
      const workflow = importWorkflowFromTemplate(json)
      const engine = getWorkflowEngine()
      engine.register(workflow)
      return { success: true, data: workflow }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ============ Phase 5: 跨设备工作流同步 ============

  safeIpcHandle('desktop:syncGetDeviceInfo', async () => {
    const { getDeviceInfo } = await import('../../modules/desktop-control/WorkflowSync')
    return { success: true, data: getDeviceInfo() }
  })

  safeIpcHandle('desktop:syncExport', async (_event, params: {
    type?: 'workflows' | 'recordings' | 'all'
    workflowIds?: string[]
    recordingIds?: string[]
  }) => {
    const { exportSyncPackage } = await import('../../modules/desktop-control/WorkflowSync')
    const pkg = exportSyncPackage(params.type || 'all', params.workflowIds, params.recordingIds)
    return { success: true, data: pkg }
  })

  safeIpcHandle('desktop:syncExportToFile', async (_event, params: {
    filePath: string
    type?: 'workflows' | 'recordings' | 'all'
    workflowIds?: string[]
    recordingIds?: string[]
  }) => {
    const { exportSyncPackageToFile } = await import('../../modules/desktop-control/WorkflowSync')
    const result = exportSyncPackageToFile(params.filePath, params.type || 'all', params.workflowIds, params.recordingIds)
    return result
  })

  safeIpcHandle('desktop:syncImport', async (_event, params: {
    json: string
    conflictResolution?: 'skip' | 'overwrite' | 'rename' | 'merge'
    onlyEnabled?: boolean
    validatePlatform?: boolean
    targetPlatform?: 'darwin' | 'win32' | 'linux'
  }) => {
    const { parseSyncPackage, importSyncPackage } = await import('../../modules/desktop-control/WorkflowSync')
    try {
      const pkg = parseSyncPackage(params.json)
      const result = importSyncPackage(pkg, {
        conflictResolution: params.conflictResolution || 'skip',
        onlyEnabled: params.onlyEnabled || false,
        validatePlatform: params.validatePlatform || false,
        targetPlatform: params.targetPlatform,
      })
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('desktop:syncImportFromFile', async (_event, params: {
    filePath: string
    conflictResolution?: 'skip' | 'overwrite' | 'rename' | 'merge'
    onlyEnabled?: boolean
  }) => {
    const { importSyncPackageFromFile } = await import('../../modules/desktop-control/WorkflowSync')
    const result = importSyncPackageFromFile(params.filePath, {
      conflictResolution: params.conflictResolution || 'skip',
      onlyEnabled: params.onlyEnabled || false,
      validatePlatform: false,
    })
    return { success: result.success, data: result }
  })
}
