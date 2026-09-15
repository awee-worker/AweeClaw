/**
 * VRM 桌面伴侣 API — preload 侧桥接
 *
 * 将主进程的伴侣窗口能力暴露给渲染进程，
 * 渲染进程通过 window.electronAPI.vrmCompanion.* 调用。
 *
 * 消费方：
 * - 伴侣窗口 vrmCompanionEntry.tsx：读取配置/模型、拖拽、穿透、好感度
 * - 主窗口设置面板：模型管理（导入/删除/选择）、开关配置
 *
 * 事件订阅返回取消订阅函数，调用方负责清理。
 */

import { ipcRenderer } from 'electron'
import { invoke, on, onVoid } from '../ipcHelpers'

/** 统一 IPC 返回包装 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 模型来源：内置 / 用户导入 */
export type VrmModelSource = 'builtin' | 'user'

/** 模型条目 */
export interface VrmModelInfo {
  id: string
  name: string
  source: VrmModelSource
  /** 渲染进程可直接加载的 URL（vrm-asset://asset/<id>） */
  url: string
  size: number
  selected: boolean
}

/** 在线模型下载进度（main → 渲染进程） */
export interface VrmDownloadProgress {
  /** 后端模型 id（用于前端定位是哪一项在下载） */
  id: string | null
  /** 已接收字节数 */
  received: number
  /** 总字节数（0 表示服务端未返回 Content-Length） */
  total: number
}

/** 动作（.vrma）条目 */
export interface VrmAnimationInfo {
  id: string
  name: string
  source: VrmModelSource
  /** 渲染进程可直接加载的 URL（vrm-asset://asset/<id>） */
  url: string
  size: number
  /** 是否适合作为待机循环动作（大幅全身动作会被排除） */
  idleFriendly: boolean
}

/** 伴侣窗口配置 */
export interface VrmCompanionConfig {
  enabled: boolean
  showOnStartup: boolean
  modelId: string | null
  scale: number
  width: number
  height: number
  positionX: number | null
  positionY: number | null
  /** 窗口置顶 */
  alwaysOnTop: boolean
  /** 锁定位置（禁止拖拽） */
  locked: boolean
  /** 窗口整体不透明度（0.3 ~ 1） */
  opacity: number
  /** 待机动作（呼吸 / 摇摆 / 眨眼） */
  idleAnimation: boolean
  /** 视线跟随鼠标 */
  lookAtCursor: boolean
  /** 自动隐藏：鼠标悬停在角色上时淡出并让窗口鼠标穿透 */
  autoHide: boolean
  /** 鼠标穿透：窗口忽略鼠标事件（默认开启）；指针压到操作栏时临时接管 */
  clickThrough: boolean
}

/** 指针位置推送载荷（main→伴侣窗口） */
export interface VrmPointerState {
  /** 指针是否在窗口内 */
  inside: boolean
  /** 相对窗口中心归一化后的横坐标（-1 ~ 1） */
  x: number
  /** 相对窗口中心归一化后的纵坐标（-1 ~ 1） */
  y: number
}

/** 伴侣窗口运行时状态（不落盘，仅主进程内存） */
export interface VrmCompanionState {
  visible: boolean
  created: boolean
  clickThrough: boolean
  alwaysOnTop: boolean
  locked: boolean
  opacity: number
}

/** 好感度：{ 用户名: { 属性名: 数值 } } */
export type AffectionStats = Record<string, number>
export type AffectionData = Record<string, AffectionStats>

/** 拖拽频道名 */
export interface VrmDragChannels {
  start: string
  end: string
}

/** 语音上下文（与主进程 VoiceContextCache 的 VoiceContext 对齐） */
export interface VrmVoiceContext {
  llmConfig: unknown | null
  cloudMode: 'cloud' | 'local'
  serverUrl: string | null
  accessToken: string | null
  refreshToken: string | null
  voiceModelConfig: unknown | null
  language: 'zh' | 'en'
  workspacePath: string | null
  workMode?: 'chat' | 'agent' | 'plan' | null
  agentConfig?: unknown | null
  updatedAt: number
}

/**
 * 桌面伴侣的动作指令（主窗口 AI → 伴侣窗口）。
 *
 * 设计为「type + 参数」的扁平结构，而不是每种动作一个 IPC 通道：
 * 主进程只做透传，新增动作类型时无需改动主进程与 preload。
 */
export interface VrmCompanionCommand {
  /**
   * 指令类型：
   * - speak        说话（驱动口型，文本由 text 给出）
   * - stop_speak   立即停止说话
   * - play_action  播放一次性动作（name 指定动作名，缺省随机；支持语义别名如「挥手」）
   * - expression   设置表情（name: happy / angry / sad / relaxed / surprised / neutral）
   * - reset        回到自然站姿并清空表情
   * - look_at      视线（target: cursor / camera / center）
   */
  type: 'speak' | 'stop_speak' | 'play_action' | 'expression' | 'reset' | 'look_at'
  /** 文本（speak） */
  text?: string
  /** 动作名 / 语义别名 / 表情名 */
  name?: string
  /** 表情强度（0~1，默认 1） */
  weight?: number
  /** 表情保持时长（ms，缺省为自动衰减） */
  durationMs?: number
  /** 视线目标 */
  target?: 'cursor' | 'camera' | 'center'
}

/** 创建 VRM 伴侣 API 集合 */
export function createVrmCompanionApi() {
  return {
    // --------------------------------------------
    // 窗口显隐
    // --------------------------------------------
    show: invoke<IpcResponse<{ visible: boolean }>>('vrm-companion:show'),
    hide: invoke<IpcResponse<{ visible: boolean }>>('vrm-companion:hide'),
    toggle: invoke<IpcResponse<{ visible: boolean }>>('vrm-companion:toggle'),
    isVisible: invoke<IpcResponse<{ visible: boolean }>>('vrm-companion:is-visible'),

    // --------------------------------------------
    // 配置
    // --------------------------------------------
    getConfig: invoke<IpcResponse<VrmCompanionConfig>>('vrm-companion:get-config'),
    updateConfig: (partial: Partial<VrmCompanionConfig>) =>
      ipcRenderer.invoke('vrm-companion:update-config', partial) as Promise<
        IpcResponse<VrmCompanionConfig>
      >,

    // --------------------------------------------
    // 模型库
    // --------------------------------------------
    listModels: invoke<IpcResponse<VrmModelInfo[]>>('vrm-companion:list-models'),
    /** 列出可用动作（.vrma），用于构建待机动作队列 */
    listAnimations: invoke<IpcResponse<VrmAnimationInfo[]>>('vrm-companion:list-animations'),
    importModel: invoke<IpcResponse<VrmModelInfo>>('vrm-companion:import-model'),
    deleteModel: (id: string) =>
      ipcRenderer.invoke('vrm-companion:delete-model', id) as Promise<IpcResponse>,
    selectModel: (id: string | null) =>
      ipcRenderer.invoke('vrm-companion:select-model', id) as Promise<IpcResponse<VrmCompanionConfig>>,
    /**
     * 下载在线角色模型到本地用户模型目录。
     *
     * 渲染进程先从后端（/api/v1/vrm-models）拿到列表，再把选中的模型信息交给主进程，
     * 由主进程负责流式下载、完整性校验与落盘（大文件不宜走渲染进程内存）。
     */
    downloadOnlineModel: (payload: { id?: string; name: string; url: string }) =>
      ipcRenderer.invoke('vrm-companion:download-online-model', payload) as Promise<
        IpcResponse<VrmModelInfo>
      >,
    /** 订阅在线模型下载进度（main → 渲染进程，单向下发） */
    onDownloadProgress: on<VrmDownloadProgress>('vrm-companion:download-progress'),

    // --------------------------------------------
    // 拖拽
    // --------------------------------------------
    getDragChannel: invoke<IpcResponse<VrmDragChannels>>('vrm-companion:get-drag-channel'),
    /** 拖拽开始（单向 send，主进程自取鼠标坐标） */
    sendDragStart: (channel: string) => {
      ipcRenderer.send(channel)
    },
    /** 拖拽结束（单向 send） */
    sendDragEnd: (channel: string) => {
      ipcRenderer.send(channel)
    },

    // --------------------------------------------
    // 尺寸 / 位置
    // --------------------------------------------
    setSize: (width: number, height: number) =>
      ipcRenderer.invoke('vrm-companion:set-size', width, height) as Promise<
        IpcResponse<VrmCompanionConfig>
      >,
    setPosition: (x: number, y: number) =>
      ipcRenderer.invoke('vrm-companion:set-position', x, y) as Promise<IpcResponse>,

    // --------------------------------------------
    // 鼠标穿透
    // --------------------------------------------
    setClickThrough: (enabled: boolean) =>
      ipcRenderer.invoke('vrm-companion:set-click-through', enabled) as Promise<
        IpcResponse<{ clickThrough: boolean }>
      >,
    /**
     * 上报「指针是否压在角色 / 操作栏上」。
     *
     * 穿透模式下主进程据此按需临时接管鼠标事件：压在操作栏上时接收事件，
     * 离开后立刻交还穿透 —— 既保证按钮可点，又不长期遮挡桌面。
     */
    setPointerInteractive: (inside: boolean) =>
      ipcRenderer.invoke('vrm-companion:set-pointer-interactive', inside) as Promise<IpcResponse>,
    /** 设置「临时穿透」（自动隐藏悬停时让开点击），不改变用户穿透偏好 */
    setTransientPassThrough: (enabled: boolean) =>
      ipcRenderer.invoke('vrm-companion:set-transient-pass-through', enabled) as Promise<IpcResponse>,

    // --------------------------------------------
    // 窗口状态 / 位置
    // --------------------------------------------
    /** 读取窗口运行时状态（可见性 / 穿透 / 置顶 / 锁定 / 不透明度） */
    getState: invoke<IpcResponse<VrmCompanionState>>('vrm-companion:get-state'),
    /** 复位窗口到默认位置（右下角） */
    resetPosition: invoke<IpcResponse<{ x: number; y: number } | null>>(
      'vrm-companion:reset-position',
    ),

    // --------------------------------------------
    // 好感度
    // --------------------------------------------
    getAffection: invoke<IpcResponse<AffectionData>>('vrm-companion:get-affection'),
    /** 从 AI 回复文本提取好感度（主窗口在回复完成后调用） */
    checkAffection: (content: string) =>
      ipcRenderer.invoke('vrm-companion:check-affection', content) as Promise<
        IpcResponse<{ updated: boolean }>
      >,

    // --------------------------------------------
    // AI 动作指令（主窗口 AI 工具 → 伴侣窗口）
    // --------------------------------------------
    /**
     * 下发一条动作/表情/说话指令给伴侣窗口。
     *
     * 由 companion_control 工具执行器调用；data.delivered 为 false 表示
     * 伴侣窗口未创建/未显示，指令没有实际接收方。
     */
    sendCommand: (command: VrmCompanionCommand) =>
      ipcRenderer.invoke('vrm-companion:command', command) as Promise<
        IpcResponse<{ delivered: boolean }>
      >,
    /** 订阅伴侣动作指令（伴侣窗口消费） */
    onCommand: on<VrmCompanionCommand>('vrm-companion:command'),

    // --------------------------------------------
    // 语音对话（伴侣窗口内独立语音）
    // --------------------------------------------
    /** 读取语音上下文（伴侣窗口启动时拉取一次） */
    getVoiceContext: invoke<IpcResponse<VrmVoiceContext>>('vrm-companion:get-voice-context'),
    /** 主窗口 push 语音上下文（增量） */
    updateVoiceContext: (partial: Partial<VrmVoiceContext>) =>
      ipcRenderer.invoke('vrm-companion:update-voice-context', partial) as Promise<
        IpcResponse<VrmVoiceContext>
      >,
    /** 请求麦克风权限（macOS 需主进程触发系统授权弹窗） */
    requestMicPermission: invoke<IpcResponse<{ granted: boolean; platform: string }>>(
      'vrm-companion:request-mic-permission',
    ),
    /** 伴侣窗口 → 主进程 → 主窗口：语音状态变化 */
    notifyVoiceStateChanged: (payload: { state: string; volume: number }) => {
      ipcRenderer.send('vrm-companion:voice-state-changed', payload)
    },
    /** 伴侣窗口 → 主进程 → 主窗口：保存对话历史 */
    notifySaveConversation: (payload: {
      userText: string
      aiText: string
      toolCallRecords?: Array<{
        id: string
        name: string
        args: Record<string, unknown>
        success: boolean
        resultSummary: string
      }>
    }) => {
      ipcRenderer.send('vrm-companion:save-conversation', payload)
    },
    /** 主窗口 → 主进程 → 伴侣窗口：主窗口全功能语音是否激活 */
    notifyMainConversationActive: (active: boolean) => {
      ipcRenderer.send('vrm-companion:main-conversation-active', active)
    },
    /** 主窗口 → 主进程 → 伴侣窗口：语音上下文实时更新 */
    onVoiceContextUpdated: on<VrmVoiceContext>('vrm-companion:voice-context-updated'),
    /** 主窗口 → 主进程 → 伴侣窗口：主窗口全功能语音是否激活（激活时伴侣应让出麦克风） */
    onMainConversationActive: on<boolean>('vrm-companion:main-conversation-active'),
    /** 主窗口订阅：伴侣窗口语音状态变化 */
    onVoiceStateChanged: on<{ state: string; volume: number }>('vrm-companion:voice-state-changed'),
    /** 主窗口订阅：伴侣窗口对话完成（落库到聊天历史） */
    onSaveConversation: on<{
      userText: string
      aiText: string
      toolCallRecords?: Array<{
        id: string
        name: string
        args: Record<string, unknown>
        success: boolean
        resultSummary: string
      }>
    }>('vrm-companion:save-conversation'),

    // --------------------------------------------
    // 说话广播（主窗口 → 主进程 → 伴侣窗口）
    // --------------------------------------------
    /** 广播「开始说话」以驱动伴侣口型（text 用于估算时长） */
    broadcastSpeak: (payload: { text: string; durationMs?: number }) =>
      ipcRenderer.invoke('vrm-companion:broadcast-speak', payload) as Promise<IpcResponse>,
    /** 广播「停止说话」（立即闭口） */
    broadcastStopSpeak: () =>
      ipcRenderer.invoke('vrm-companion:broadcast-stop-speak') as Promise<IpcResponse>,
    /** 广播实时音量（0~1），优先级高于模拟口型 */
    broadcastVolume: (volume: number) =>
      ipcRenderer.invoke('vrm-companion:broadcast-volume', volume) as Promise<IpcResponse>,

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 配置更新（模型切换 / 缩放 / 尺寸变化） */
    onConfigUpdated: on<VrmCompanionConfig>('vrm-companion:config-updated'),
    /** 好感度更新 */
    onAffectionUpdated: on<AffectionData>('vrm-companion:affection-updated'),
    /**
     * 开始说话（main→伴侣窗口）：驱动口型。
     * text 用于估算说话时长；durationMs 若提供则优先使用（真实 TTS 时长）。
     */
    onSpeak: on<{ text: string; durationMs?: number }>('vrm-companion:speak'),
    /** 停止说话（main→伴侣窗口）：立即闭口 */
    onStopSpeak: onVoid('vrm-companion:stop-speak'),
    /** 实时音量（main→伴侣窗口）：0~1，由主窗口 TTS 分析后推送，优先于模拟口型 */
    onVolume: on<number>('vrm-companion:volume'),
    /**
     * 伴侣运行时状态变化（main→所有窗口）：显隐 / 鼠标穿透。
     * 供主窗口顶部栏开关、设置面板等外部 UI 同步状态，避免各处轮询。
     */
    onStateChanged: on<{ visible: boolean; clickThrough: boolean }>('vrm-companion:state-changed'),
    /**
     * 指针位置（main→伴侣窗口）。
     *
     * 穿透模式下窗口忽略鼠标事件，渲染层拿不到可靠的 mousemove，
     * 因此改由主进程轮询屏幕坐标下发：既驱动视线跟随，也用于判定
     * 「指针是否压在角色/操作栏上」。
     */
    onPointerState: on<VrmPointerState>('vrm-companion:pointer-state'),
  }
}
