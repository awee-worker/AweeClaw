/**
 * 悬浮头像 IPC 处理器（主进程）
 *
 * 注册头像窗口与主窗口之间、以及渲染进程与主进程之间的 IPC 通道。
 *
 * 通道清单：
 * - floating-avatar:show | hide | toggle | isVisible    —— 头像窗口显隐控制
 * - floating-avatar:get-config | update-config          —— 头像偏好读写（持久化）
 * - floating-avatar:get-position | set-position         —— 位置读写（持久化）
 * - floating-avatar:get-voice-context                    —— 头像读取语音上下文缓存
 * - floating-avatar:update-voice-context                 —— 主窗口 push 语音上下文
 * - floating-avatar:wake-word-detected                   —— 头像→main：唤醒命中通知
 * - floating-avatar:voice-state-changed                  —— 头像→main：语音状态变化（转发主窗口 + 托盘）
 * - floating-avatar:save-conversation                    —— 头像→main→主窗口：保存对话历史
 * - floating-avatar:open-main-window                     —— 头像→main：打开/创建主窗口
 * - floating-avatar:request-mic-permission               —— 头像→main：请求麦克风权限（macOS）
 * - floating-avatar:quit-app                             —— 头像/托盘→main：触发完整退出
 * - floating-avatar:main-conversation-active             —— 主窗口→main→头像：主窗口全功能语音状态
 * - floating-avatar:wake-word-toggled                    —— main→头像：唤醒开关变化
 * - floating-avatar:start-screenshot-ask                 —— 头像→main：启动截图提问（迷你助手按钮触发，与右键菜单共用 ScreenshotAskManager）
 *
 * 安全：所有 handler 通过 safeIpcHandle 注册，返回值统一包装。
 */

import { systemPreferences, ipcMain } from 'electron'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { FloatingAvatarManager } from './FloatingAvatarManager'
import { TrayManager } from './TrayManager'
import { VoiceContextCache, type VoiceContext } from './VoiceContextCache'

/** 语音状态变化载荷（头像→主进程→主窗口 + 托盘） */
export interface VoiceStateChangedPayload {
  state: 'idle' | 'listening' | 'recording' | 'processing' | 'speaking' | 'error'
  volume: number
}

/** 保存对话历史载荷（头像→主进程→主窗口） */
export interface SaveConversationPayload {
  userText: string
  aiText: string
  toolCallRecords?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
    success: boolean
    resultSummary: string
  }>
}

/** 可用模型选项（扁平化，供头像窗口渲染模型选择器） */
export interface AvatarModelOption {
  id: string
  name: string
  provider: string
  providerName: string
  isCloud: boolean
}

/** 模型切换载荷（头像→主进程→主窗口） */
export interface SelectModelPayload {
  provider: string
  model: string
  isCloud: boolean
}

/** 回调集合（由 appBootstrap/lifecycle 注入，避免直接依赖 windowManager 造成循环依赖） */
export interface FloatingAvatarIpcCallbacks {
  /** 打开/创建并聚焦主窗口 */
  openMainWindow: () => void
  /** 退出应用（触发完整退出流程） */
  quitApp: () => void
  /** 转发对话历史到主窗口（主窗口写入 IntelligenceStore） */
  forwardSaveConversation: (payload: SaveConversationPayload) => void
  /** 转发语音状态到主窗口（用于主窗口 UI 联动） */
  forwardVoiceStateChanged: (payload: VoiceStateChangedPayload) => void
  /** 读取语音唤醒开关当前状态 */
  isWakeWordEnabled: () => boolean
  /** 切换语音唤醒开关，返回切换后的状态 */
  toggleWakeWord: () => Promise<boolean>
  /** 转发模型列表请求到主窗口（主窗口从 store 构建，通过 models-response 返回） */
  forwardRequestModels: (requestId: string) => void
  /** 转发模型切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectModel: (payload: SelectModelPayload) => void
  /** 转发授权方式切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectAuthorizationMode: (mode: 'every-step' | 'dangerous-only' | 'never') => void
  /** 转发工作模式切换到主窗口（主窗口更新 useModeStore + 重新 push voiceContext） */
  forwardSelectWorkMode: (mode: 'chat' | 'agent' | 'plan') => void
  /** 转发自定义智能体切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectAgent: (agentId: string | null) => void
  /** 打开主窗口设置页（迷你聊天「创建智能体」入口，与右键菜单 openSettings 一致） */
  openSettings: () => void
  /** 启动截图提问（迷你助手按钮 / 右键菜单共用，由 index.ts 注入 ScreenshotAskManager.start） */
  startScreenshotAsk: () => void
}

let registered = false

/**
 * 注册悬浮头像相关 IPC handler
 *
 * 幂等：重复调用不会重复注册（safeIpcHandle 内部会去重）。
 *
 * @param callbacks 上层注入的回调（openMainWindow / quitApp / 转发到主窗口等）
 */
export function registerFloatingAvatarIpc(callbacks: FloatingAvatarIpcCallbacks): void {
  if (registered) {
    logger.system.warn('[FloatingAvatarIpc] Already registered, skipping')
    return
  }
  registered = true

  const manager = FloatingAvatarManager.getInstance()
  const cache = VoiceContextCache.getInstance()

  // --------------------------------------------
  // 窗口显隐控制
  // --------------------------------------------
  safeIpcHandle('floating-avatar:show', async () => {
    manager.show()
    return { success: true }
  })

  safeIpcHandle('floating-avatar:hide', async () => {
    manager.hide()
    return { success: true }
  })

  safeIpcHandle('floating-avatar:toggle', async () => {
    manager.toggle()
    return { success: true, visible: manager.isVisible() }
  })

  safeIpcHandle('floating-avatar:isVisible', async () => {
    return { success: true, visible: manager.isVisible() }
  })

  // --------------------------------------------
  // 偏好配置读写
  // --------------------------------------------
  safeIpcHandle('floating-avatar:get-config', async () => {
    return { success: true, data: manager.getConfig() }
  })

  safeIpcHandle('floating-avatar:update-config', async (_event, config: unknown) => {
    try {
      const updated = manager.updateConfig((config as Record<string, unknown>) || {})
      return { success: true, data: updated }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Update config failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 位置读写
  // --------------------------------------------
  safeIpcHandle('floating-avatar:get-position', async () => {
    const pos = manager.getPosition()
    return { success: true, data: pos }
  })

  safeIpcHandle('floating-avatar:set-position', async (_event, x: number, y: number) => {
    try {
      manager.setPosition(Number(x) || 0, Number(y) || 0)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 语音上下文缓存
  // --------------------------------------------
  safeIpcHandle('floating-avatar:get-voice-context', async () => {
    return { success: true, data: cache.get() }
  })

  safeIpcHandle('floating-avatar:update-voice-context', async (_event, partial: unknown) => {
    try {
      const updated = cache.update((partial as Partial<VoiceContext>) || {})
      // 实时转发到头像窗口，让头像窗口的 useAvatarBridge 收到更新事件
      manager.sendToAvatar('floating-avatar:voice-context-updated', updated)
      return { success: true, data: updated }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Update voice context failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 唤醒检测通知（头像→main）
  // --------------------------------------------
  safeIpcHandle('floating-avatar:wake-word-detected', async (_event, info: unknown) => {
    logger.system.info('[FloatingAvatarIpc] Wake word detected:', info)
    // 可在此触发托盘图标状态变化、通知主窗口等
    TrayManager.getInstance().setIconState('conversation')
    return { success: true }
  })

  // --------------------------------------------
  // 语音状态变化（头像→main→主窗口 + 托盘）
  // --------------------------------------------
  safeIpcHandle('floating-avatar:voice-state-changed', async (_event, payload: unknown) => {
    const statePayload = payload as VoiceStateChangedPayload
    // 更新托盘图标状态
    const trayState = mapStateToTray(statePayload.state)
    TrayManager.getInstance().setIconState(trayState)
    // 转发到主窗口（用于主窗口 UI 联动）
    callbacks.forwardVoiceStateChanged(statePayload)
    return { success: true }
  })

  // --------------------------------------------
  // 保存对话历史（头像→main→主窗口）
  // --------------------------------------------
  safeIpcHandle('floating-avatar:save-conversation', async (_event, payload: unknown) => {
    try {
      const conv = payload as SaveConversationPayload
      if (!conv || typeof conv.userText !== 'string' || typeof conv.aiText !== 'string') {
        return { success: false, error: 'Invalid conversation payload' }
      }
      callbacks.forwardSaveConversation(conv)
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Save conversation failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 打开主窗口
  // --------------------------------------------
  safeIpcHandle('floating-avatar:open-main-window', async () => {
    try {
      callbacks.openMainWindow()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // --------------------------------------------
  // 麦克风权限请求（macOS）
  // --------------------------------------------
  safeIpcHandle('floating-avatar:request-mic-permission', async () => {
    try {
      if (process.platform !== 'darwin') {
        // 非 macOS 无需主进程介入，渲染进程 getUserMedia 会自行处理
        return { success: true, data: { granted: true, platform: process.platform } }
      }
      const granted = await systemPreferences.askForMediaAccess('microphone')
      logger.system.info('[FloatingAvatarIpc] Mic permission (macOS):', granted)
      return { success: true, data: { granted, platform: 'darwin' } }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Request mic permission failed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  // --------------------------------------------
  // 退出应用
  // --------------------------------------------
  safeIpcHandle('floating-avatar:quit-app', async () => {
    logger.system.info('[FloatingAvatarIpc] Quit requested from avatar/tray')
    callbacks.quitApp()
    return { success: true }
  })

  // --------------------------------------------
  // 拖拽频道获取（头像窗口启动时调用）
  // --------------------------------------------
  // 头像窗口的渲染进程需要知道拖拽 IPC 频道名（含窗口 id）才能发送拖拽开始/结束信号。
  // 频道名格式：floating-avatar:drag-start:${winId} / floating-avatar:drag-end:${winId}，
  // 由 registerDragHandler 注册。主进程在 start 时自取鼠标+窗口坐标，渲染层无需 payload。
  safeIpcHandle('floating-avatar:get-drag-channel', async () => {
    const channels = manager.getDragChannel()
    if (!channels) {
      return { success: false, error: 'Avatar window not created yet' }
    }
    return { success: true, data: channels }
  })

  // --------------------------------------------
  // 窗口展开/收起（对话面板）
  // --------------------------------------------
  safeIpcHandle('floating-avatar:expand', async () => {
    manager.expand()
    return { success: true, expanded: manager.isExpanded() }
  })

  safeIpcHandle('floating-avatar:collapse', async () => {
    manager.collapse()
    return { success: true, expanded: manager.isExpanded() }
  })

  safeIpcHandle('floating-avatar:is-expanded', async () => {
    return { success: true, expanded: manager.isExpanded() }
  })

  // --------------------------------------------
  // 主题色同步（主窗口→main→头像窗口）
  // --------------------------------------------
  // 主窗口主题变化时发送，主进程转发到头像窗口
  ipcMain.on('floating-avatar:update-theme', (_event, payload: { themeColor: string; themeMode: string }) => {
    manager.sendToAvatar('floating-avatar:update-theme', payload)
  })

  // --------------------------------------------
  // 主窗口→头像：主窗口全功能语音对话状态（单向 send，转发给头像窗口）
  // --------------------------------------------
  // 注意：此通道用 ipcMain.on（单向），不走 safeIpcHandle（双向 invoke）。
  // 主窗口通过 api.floatingAvatar.notifyMainConversationActive(active) 发送。
  ipcMain.on('floating-avatar:main-conversation-active', (_event, active: boolean) => {
    manager.sendToAvatar('floating-avatar:main-conversation-active', !!active)
  })

  // --------------------------------------------
  // 主窗口→头像：项目执行状态同步（单向 send，转发给头像窗口）
  // --------------------------------------------
  // 主窗口有项目任务执行时，将执行会话摘要推送到头像窗口，
  // 头像窗口在悬浮球上方显示执行状态指示器。
  // 主窗口通过 api.floatingAvatar.pushExecutionStatus(status) 发送。
  ipcMain.on('floating-avatar:execution-status', (_event, payload: unknown) => {
    manager.sendToAvatar('floating-avatar:execution-status', payload)
  })

  // --------------------------------------------
  // 头像→main：执行状态栏窗口扩展/收起
  // --------------------------------------------
  // 头像窗口收到执行状态后，需要扩展窗口高度以在球体上方显示 Pill。
  // 由头像窗口通过 api.floatingAvatar.expandForStatus() / collapseForStatus() 调用。
  ipcMain.on('floating-avatar:expand-for-status', () => {
    manager.expandForStatus()
  })
  ipcMain.on('floating-avatar:collapse-for-status', () => {
    manager.collapseForStatus()
  })

  // 头像→main：tooltip 扩展/收起窗口宽度（悬停时扩展以容纳 tooltip 文字）
  ipcMain.on('floating-avatar:expand-for-tooltip', () => {
    manager.expandForTooltip()
  })
  ipcMain.on('floating-avatar:collapse-for-tooltip', () => {
    manager.collapseForTooltip()
  })

  // --------------------------------------------
  // 模型列表请求/响应（头像→main→主窗口→main→头像）
  // --------------------------------------------
  // 头像窗口通过 invoke 发起请求 → 主进程向主窗口发事件 →
  // 主窗口从 store 构建模型列表 → 通过 send 发回主进程 → 主进程 resolve invoke
  const pendingModelRequests = new Map<
    string,
    { resolve: (models: AvatarModelOption[]) => void; timeout: ReturnType<typeof setTimeout> }
  >()

  safeIpcHandle('floating-avatar:get-available-models', async () => {
    const requestId = `models-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    return new Promise((resolve) => {
      // 15 秒超时：留足时间让主窗口获取云端模型列表（backendApi 网络请求）
      const timeout = setTimeout(() => {
        pendingModelRequests.delete(requestId)
        logger.system.warn('[FloatingAvatarIpc] Get models timeout')
        resolve({ success: false, error: 'Request timeout' })
      }, 15000)

      pendingModelRequests.set(requestId, {
        resolve: (models) => {
          clearTimeout(timeout)
          pendingModelRequests.delete(requestId)
          resolve({ success: true, data: models })
        },
        timeout,
      })

      // 转发请求到主窗口
      callbacks.forwardRequestModels(requestId)
    })
  })

  // 主窗口返回模型列表
  ipcMain.on('floating-avatar:models-response', (_event, payload: { requestId: string; models: AvatarModelOption[] }) => {
    const pending = pendingModelRequests.get(payload?.requestId)
    if (pending) {
      pending.resolve(payload?.models || [])
    }
  })

  // 头像窗口切换模型（转发到主窗口，主窗口更新 store + save + 重新 push voiceContext）
  safeIpcHandle('floating-avatar:select-model', async (_event, payload: unknown) => {
    const config = payload as SelectModelPayload
    if (!config || typeof config.provider !== 'string' || typeof config.model !== 'string') {
      return { success: false, error: 'Invalid model payload' }
    }
    try {
      callbacks.forwardSelectModel({ provider: config.provider, model: config.model, isCloud: !!config.isCloud })
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Select model failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 头像窗口切换授权方式（转发到主窗口，主窗口更新 store + save + 重新 push voiceContext）
  safeIpcHandle('floating-avatar:select-authorization-mode', async (_event, mode: unknown) => {
    const validModes = ['every-step', 'dangerous-only', 'never']
    if (!validModes.includes(mode as string)) {
      return { success: false, error: 'Invalid authorization mode' }
    }
    try {
      callbacks.forwardSelectAuthorizationMode(mode as 'every-step' | 'dangerous-only' | 'never')
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Select authorization mode failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 头像窗口切换工作模式（转发到主窗口，主窗口更新 useModeStore + 重新 push voiceContext）
  safeIpcHandle('floating-avatar:select-work-mode', async (_event, mode: unknown) => {
    const validModes = ['chat', 'agent', 'plan']
    if (!validModes.includes(mode as string)) {
      return { success: false, error: 'Invalid work mode' }
    }
    try {
      callbacks.forwardSelectWorkMode(mode as 'chat' | 'agent' | 'plan')
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Select work mode failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 头像窗口切换自定义智能体（转发到主窗口，主窗口更新 store + save + 重新 push voiceContext）
  safeIpcHandle('floating-avatar:select-agent', async (_event, agentId: unknown) => {
    if (agentId !== null && typeof agentId !== 'string') {
      return { success: false, error: 'Invalid agent id' }
    }
    try {
      callbacks.forwardSelectAgent(agentId as string | null)
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Select agent failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 头像窗口打开主窗口设置页（迷你聊天「创建智能体」入口，与右键菜单 openSettings 一致）
  safeIpcHandle('floating-avatar:open-settings', async () => {
    try {
      callbacks.openSettings()
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Open settings failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 主窗口推送当前对话快照 → 转发头像窗口（迷你聊天同步显示主窗口对话）
  ipcMain.on('floating-avatar:main-conversation', (_event, snapshot: unknown) => {
    if (!snapshot || typeof snapshot !== 'object') return
    manager.sendToAvatar('floating-avatar:main-conversation', snapshot)
  })

  // 启动截图提问（迷你助手按钮触发，与右键菜单共用 ScreenshotAskManager）
  // 渲染进程通过 api.floatingAvatar.startScreenshotAsk() 调用，
  // 主进程启动全屏区域选择覆盖窗口 → 用户框选 → 截图 → 推送结果到头像窗口
  safeIpcHandle('floating-avatar:start-screenshot-ask', async () => {
    try {
      callbacks.startScreenshotAsk()
      return { success: true }
    } catch (err) {
      logger.system.error('[FloatingAvatarIpc] Start screenshot ask failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.system.info('[FloatingAvatarIpc] Registered all handlers')
}

/** 将语音状态映射到托盘图标状态 */
function mapStateToTray(
  state: VoiceStateChangedPayload['state'],
): 'idle' | 'listening' | 'conversation' | 'error' {
  switch (state) {
    case 'listening':
    case 'recording':
      return 'listening'
    case 'processing':
    case 'speaking':
      return 'conversation'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'idle'
  }
}
