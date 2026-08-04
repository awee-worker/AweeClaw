/**
 * Floating Avatar API — 悬浮头像 IPC 桥接（preload 侧）
 *
 * 将主进程的悬浮头像能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.floatingAvatar.* 调用。
 *
 * 消费方：
 * - 主窗口 AweeApp.tsx：push 语音上下文、转发保存对话、同步主窗口对话状态
 * - 头像窗口 useAvatarBridge.ts：读取语音上下文、控制窗口、通知唤醒/状态/保存
 *
 * 事件订阅返回取消订阅函数，调用方负责清理。
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'

/** 语音上下文（与主进程 VoiceContext 对齐） */
export interface VoiceContext {
  llmConfig: unknown | null
  cloudMode: 'cloud' | 'local'
  serverUrl: string | null
  accessToken: string | null
  refreshToken: string | null
  voiceModelConfig: unknown | null
  language: 'zh' | 'en'
  workspacePath: string | null
  updatedAt: number
}

/** 头像偏好配置 */
export interface FloatingAvatarConfig {
  enabled: boolean
  showOnStartup: boolean
  size: number
  positionX: number | null
  positionY: number | null
}

/** 语音状态变化载荷 */
export interface VoiceStateChangedPayload {
  state: 'idle' | 'listening' | 'recording' | 'processing' | 'speaking' | 'error'
  volume: number
}

/** 保存对话历史载荷 */
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

/** 统一 IPC 响应格式 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 拖拽频道对象（start/end 两个频道） */
interface DragChannels {
  start: string
  end: string
}

/** 头像右键菜单项（与主进程 AvatarMenuItem 对齐） */
export interface AvatarContextMenuItem {
  id: string
  label: string
  separator?: boolean
  checked?: boolean
}

/** 可用模型选项（扁平化，供头像窗口渲染模型选择器） */
export interface AvatarModelOption {
  id: string
  name: string
  provider: string
  providerName: string
  isCloud: boolean
}

/** 模型切换载荷 */
export interface SelectModelPayload {
  provider: string
  model: string
  isCloud: boolean
}

/**
 * 创建悬浮头像 API（preload 侧工厂）
 *
 * 在 preloadBridge.ts 中以 `floatingAvatar: createFloatingAvatarApi()` 形式聚合。
 */
export function createFloatingAvatarApi() {
  return {
    // --------------------------------------------
    // 窗口显隐控制
    // --------------------------------------------
    show: invoke<IpcResponse>('floating-avatar:show'),
    hide: invoke<IpcResponse>('floating-avatar:hide'),
    toggle: invoke<IpcResponse<{ success: boolean; visible: boolean }>>(
      'floating-avatar:toggle',
    ),
    isVisible: invoke<IpcResponse<{ visible: boolean }>>('floating-avatar:isVisible'),

    // --------------------------------------------
    // 偏好配置
    // --------------------------------------------
    getConfig: invoke<IpcResponse<FloatingAvatarConfig>>('floating-avatar:get-config'),
    updateConfig: (config: Partial<FloatingAvatarConfig>) =>
      ipcRenderer.invoke('floating-avatar:update-config', config) as Promise<
        IpcResponse<FloatingAvatarConfig>
      >,

    // --------------------------------------------
    // 位置
    // --------------------------------------------
    getPosition: invoke<IpcResponse<{ x: number; y: number } | null>>(
      'floating-avatar:get-position',
    ),
    setPosition: (x: number, y: number) =>
      ipcRenderer.invoke('floating-avatar:set-position', x, y) as Promise<IpcResponse>,

    // --------------------------------------------
    // 语音上下文
    // --------------------------------------------
    getVoiceContext: invoke<IpcResponse<VoiceContext>>(
      'floating-avatar:get-voice-context',
    ),
    updateVoiceContext: (partial: Partial<VoiceContext>) =>
      ipcRenderer.invoke('floating-avatar:update-voice-context', partial) as Promise<
        IpcResponse<VoiceContext>
      >,

    // --------------------------------------------
    // 唤醒 / 状态 / 保存（头像→main）
    // --------------------------------------------
    wakeWordDetected: (info: unknown) =>
      ipcRenderer.invoke('floating-avatar:wake-word-detected', info) as Promise<IpcResponse>,
    voiceStateChanged: (payload: VoiceStateChangedPayload) =>
      ipcRenderer.invoke('floating-avatar:voice-state-changed', payload) as Promise<IpcResponse>,
    saveConversation: (payload: SaveConversationPayload) =>
      ipcRenderer.invoke('floating-avatar:save-conversation', payload) as Promise<IpcResponse>,

    // --------------------------------------------
    // 主窗口控制
    // --------------------------------------------
    openMainWindow: invoke<IpcResponse>('floating-avatar:open-main-window'),
    requestMicPermission: invoke<
      IpcResponse<{ granted: boolean; platform: string }>
    >('floating-avatar:request-mic-permission'),
    quitApp: invoke<IpcResponse>('floating-avatar:quit-app'),

    // --------------------------------------------
    // 拖拽频道获取（头像窗口启动时调用一次）
    // --------------------------------------------
    // 返回 { start, end } 两个频道，渲染层在 mousedown 后发 start、mouseup 发 end。
    // 主进程在 start 时自取鼠标+窗口坐标，渲染层无需传递 payload。
    getDragChannel: invoke<IpcResponse<DragChannels>>('floating-avatar:get-drag-channel'),

    // --------------------------------------------
    // 模型列表 / 模型切换（头像窗口→main→主窗口）
    // --------------------------------------------
    // 获取可用模型列表（主进程向主窗口请求，主窗口从 store 构建后返回）
    getAvailableModels: invoke<IpcResponse<AvatarModelOption[]>>(
      'floating-avatar:get-available-models',
    ),
    // 切换模型（转发到主窗口，主窗口更新 store + save + 重新 push voiceContext）
    selectModel: (payload: SelectModelPayload) =>
      ipcRenderer.invoke('floating-avatar:select-model', payload) as Promise<IpcResponse>,
    // 主窗口返回模型列表（主窗口→main，内部中转用，渲染层一般不直接调用）
    sendModelsResponse: (requestId: string, models: AvatarModelOption[]) => {
      ipcRenderer.send('floating-avatar:models-response', { requestId, models })
    },
    // 事件：主窗口收到模型列表请求（main→主窗口监听）
    onRequestModels: on<string>('floating-avatar:request-models'),
    // 事件：头像窗口请求切换模型（main→主窗口监听）
    onSelectModel: on<SelectModelPayload>('floating-avatar:select-model'),

    // --------------------------------------------
    // 授权方式切换（头像窗口→main→主窗口）
    // --------------------------------------------
    // 切换授权方式（转发到主窗口，主窗口更新 store + save + 重新 push voiceContext）
    selectAuthorizationMode: (mode: 'every-step' | 'dangerous-only' | 'never') =>
      ipcRenderer.invoke('floating-avatar:select-authorization-mode', mode) as Promise<IpcResponse>,
    // 事件：头像窗口请求切换授权方式（main→主窗口监听）
    onSelectAuthorizationMode: on<'every-step' | 'dangerous-only' | 'never'>(
      'floating-avatar:select-authorization-mode',
    ),

    // --------------------------------------------
    // 主题色同步（主窗口→main→头像窗口）
    // --------------------------------------------
    // 主窗口主题变化时调用，头像窗口收到后通过 ThemeManager.applyTheme 更新 CSS 变量
    updateTheme: (payload: { themeColor: string; themeMode: string }) => {
      ipcRenderer.send('floating-avatar:update-theme', payload)
    },
    // 事件：主题更新（main→头像窗口监听）
    onUpdateTheme: on<{ themeColor: string; themeMode: string }>('floating-avatar:update-theme'),

    // --------------------------------------------
    // 窗口展开/收起（对话面板）
    // --------------------------------------------
    expand: invoke<IpcResponse<{ expanded: boolean }>>('floating-avatar:expand'),
    collapse: invoke<IpcResponse<{ expanded: boolean }>>('floating-avatar:collapse'),
    isExpanded: invoke<IpcResponse<{ expanded: boolean }>>('floating-avatar:is-expanded'),

    // --------------------------------------------
    // 主窗口→头像：推送「主窗口全功能语音对话是否激活」
    // 通过 send 单向通知（main 进程在 IPC handler 中转发给头像窗口）
    // --------------------------------------------
    notifyMainConversationActive: (active: boolean) => {
      // 走 update-voice-context 的旁路：直接 send 一个独立频道，由 main 转发
      ipcRenderer.send('floating-avatar:main-conversation-active', active)
    },

    // --------------------------------------------
    // 事件订阅（main→渲染进程）
    // --------------------------------------------
    /** 语音上下文已更新（main push 后转发给头像窗口） */
    onVoiceContextUpdated: on<VoiceContext>('floating-avatar:voice-context-updated'),
    /** 主窗口全功能语音对话状态变化（main→头像） */
    onMainConversationActive: on<boolean>('floating-avatar:main-conversation-active'),
    /** 唤醒开关被托盘/菜单切换（main→头像） */
    onWakeWordToggled: on<boolean>('floating-avatar:wake-word-toggled'),
    /** 对话历史保存请求（main→主窗口：头像对话完成后转发到主窗口存历史） */
    onSaveConversation: on<SaveConversationPayload>('floating-avatar:save-conversation'),
    /** 语音状态变化转发（main→主窗口：头像语音状态变化用于 UI 联动） */
    onVoiceStateChanged: on<VoiceStateChangedPayload>('floating-avatar:voice-state-changed'),
    /** 右键菜单/托盘「设置」点击（main→主窗口：打开设置页指定 tab） */
    onOpenSettings: on<string | undefined>('floating-avatar:open-settings'),
    /** 截图提问完成（main→头像窗口：截图 base64 + 落盘路径，头像窗口作为附件添加到输入框，由用户输入问题后手动发送） */
    onScreenshotResult: on<{
      base64: string
      mediaType: string
      width: number
      height: number
      filePath: string
      fileName: string
    }>('floating-avatar:screenshot-result'),

    // --------------------------------------------
    // 拖拽（渲染进程→main，动态频道）
    // --------------------------------------------
    /**
     * 发送拖拽开始信号到主进程（主进程接管后续鼠标追踪）。
     * 频道名包含窗口 id，由 useAvatarBridge 在窗口创建后获取。
     * 主进程在收到信号时自取鼠标+窗口坐标，无需渲染层传递 payload。
     */
    sendDragStart: (channel: string) => {
      ipcRenderer.send(channel)
    },
    /** 发送拖拽结束信号到主进程（触发边缘吸附 + 位置持久化） */
    sendDragEnd: (channel: string) => {
      ipcRenderer.send(channel)
    },

    // --------------------------------------------
    // 右键菜单窗口（菜单窗口渲染进程专用）
    // --------------------------------------------
    /** 获取菜单项列表（菜单窗口挂载后调用，主进程实时构建最新状态） */
    menuGetItems: invoke<AvatarContextMenuItem[]>('avatar-menu:get-items'),
    /** 点击菜单项（主进程分发动作并关闭菜单） */
    menuClick: (itemId: string) => {
      ipcRenderer.send('avatar-menu:click', itemId)
    },
    /** 请求关闭菜单（ESC 键） */
    menuClose: () => {
      ipcRenderer.send('avatar-menu:close')
    },
  }
}
