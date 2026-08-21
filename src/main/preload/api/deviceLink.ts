/**
 * 设备联动 preload API
 *
 * 供桌面客户端渲染进程调用，封装与主进程的 IPC 通信。
 * 通过 contextBridge 暴露到 window.electronAPI.deviceLink
 *
 * 消费方：
 * - renderer 启动时调用 pushCredentials(serverUrl, accessToken, ...) 推送登录凭据
 * - renderer 在 token 刷新后调用 pushCredentials 更新 token
 * - renderer 在用户登出时调用 clearCredentials
 * - 设置界面调用 setPreferences 更新策略开关
 * - 设置界面调用 getStatus 查询连接状态
 * - 接收主进程推送的任务接续事件（来自其他设备）
 *
 * 频道：
 * - device-link:set-credentials   renderer → 主进程：推送凭据，触发 WS 连接
 * - device-link:clear-credentials renderer → 主进程：登出，断开 WS
 * - device-link:set-preferences    renderer → 主进程：更新允许策略
 * - device-link:get-status        renderer → 主进程：查询连接状态
 * - device-link:get-device-id     renderer → 主进程：查询设备 ID
 * - device-link:task-transfer     主进程 → renderer：来自其他设备的任务接续
 */

import { invoke, on, send } from '../ipcHelpers'

/** 设备联动凭据（推送 WS 连接所需的所有信息） */
export interface DeviceLinkCredentialsPayload {
  /** 后端服务地址（如 https://api.aweeclaw.com） */
  serverUrl: string
  /** 登录 access token */
  accessToken: string
  /** 设备显示名称（可选，未提供时主进程自动用 hostname + OS 填充） */
  deviceName?: string
  /** 工作区绝对路径（用于 RPC 路径校验） */
  workspacePath?: string
  /** 工作区名称（如 my-project） */
  workspaceName?: string
}

/** 设备联动偏好（开关类配置） */
export interface DeviceLinkPreferencesPayload {
  /** 允许远程执行命令（默认 false） */
  allowRemoteCommand?: boolean
  /** 允许远程剪贴板推送（默认 true） */
  allowClipboardPush?: boolean
  /** 允许远程截图（默认 true） */
  allowScreenshot?: boolean
  /** 允许远程休眠/唤醒（默认 false） */
  allowPowerControl?: boolean
}

/** 设备联动连接状态 */
export interface DeviceLinkStatusPayload {
  /** 是否已启动（模块初始化完成） */
  started: boolean
  /** 设备 ID */
  deviceId: string
  /** WebSocket 是否已连接 */
  connected: boolean
  /** 当前重连次数 */
  reconnectAttempts: number
  /** 凭据是否有效 */
  credentialsValid: boolean
}

/** 任务接续事件载荷（来自其他设备） */
export interface DeviceLinkTaskTransferEvent {
  /** 源设备 ID */
  fromDeviceId: string
  /** 源设备的会话线程 ID */
  threadId: string
  /** 接续消息片段 */
  snippet: string
}

/** AI 任务请求载荷（主进程转发自远程设备） */
export interface DeviceLinkAiTaskEvent {
  /** 请求 ID（回复时用） */
  requestId: string
  /** AI 提示词 */
  prompt: string
  /** 关联场景 ID */
  scenarioId?: string
  /** 是否需要返回结果 */
  needResult?: boolean
}

/** 场景运行请求载荷（主进程转发自远程设备） */
export interface DeviceLinkRunScenarioEvent {
  /** 请求 ID（回复时用） */
  requestId: string
  /** 场景 ID */
  scenarioId?: string
  /** 提示词 */
  prompt?: string
}

/** Renderer 回复主进程的结果 */
export interface DeviceLinkReplyResult {
  success: boolean
  output?: string
  error?: string
}

/**
 * 创建设备联动 preload API。
 *
 * 在 preloadBridge.ts 中以 `deviceLink: createDeviceLinkApi()` 形式聚合。
 */
export function createDeviceLinkApi() {
  return {
    /**
     * 推送登录凭据，触发或重用 WebSocket 连接。
     * 登录成功后应立即调用，token 刷新后也应调用。
     */
    pushCredentials: (payload: DeviceLinkCredentialsPayload) =>
      invoke<{ ok: boolean }>('device-link:set-credentials')(payload),

    /** 用户登出：清除凭据并断开 WS 连接 */
    clearCredentials: () =>
      invoke<{ ok: boolean }>('device-link:clear-credentials')(),

    /** 更新偏好策略（设置面板调用） */
    setPreferences: (patch: DeviceLinkPreferencesPayload) =>
      invoke<{ ok: boolean }>('device-link:set-preferences')(patch),

    /** 查询连接状态（设置面板状态指示器调用） */
    getStatus: () => invoke<DeviceLinkStatusPayload>('device-link:get-status')(),

    /** 查询设备 ID */
    getDeviceId: () => invoke<string>('device-link:get-device-id')(),

    /**
     * 订阅任务接续事件（来自其他设备推送会话上下文）。
     * 主进程在收到 task.transfer.deliver 后转发此事件到 renderer，
     * renderer 收到后应切换到对应 threadId 并加载 snippet 上下文。
     */
    onTaskTransfer: on<DeviceLinkTaskTransferEvent>('device-link:task-transfer'),

    /**
     * 订阅 AI 任务请求（来自远程移动端）。
     * renderer 收到后调用 LLM 执行任务，完成后调用 replyResult 回复。
     */
    onAiTask: on<DeviceLinkAiTaskEvent>('device-link:ai-task'),

    /**
     * 订阅场景运行请求（来自远程移动端）。
     * renderer 收到后启动对应场景，完成后调用 replyResult 回复。
     */
    onRunScenario: on<DeviceLinkRunScenarioEvent>('device-link:run-scenario'),

    /**
     * 回复主进程的 AI 任务/场景运行结果。
     * requestId 必须与收到的 onAiTask/onRunScenario 事件中的 requestId 一致。
     */
    replyResult: (requestId: string, result: DeviceLinkReplyResult) =>
      send(`device-link:renderer-reply:${requestId}`)(result),

    // ===== 方向4：场景模式跨端协同 =====

    /**
     * 推送场景模式切换到移动端（PC→移动端）
     *
     * PC 端切换模式时调用，通过后端 WS 中转到移动端。
     *
     * @param mode 目标模式
     */
    pushSceneMode: (mode: string) => invoke<boolean>('device-link:push-scene-mode')({ mode }),

    /**
     * 订阅场景模式同步事件（移动端→PC）
     *
     * 移动端切换模式时，后端推送此事件到 PC 端。
     * 收到后应静默切换模式（避免反向推送形成循环）。
     *
     * @returns 取消订阅函数
     */
    onSceneModeSync: on<{ mode: string }>('device-link:scene-mode-sync'),
  }
}
