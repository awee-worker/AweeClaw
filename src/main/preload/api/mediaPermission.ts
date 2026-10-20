/**
 * 媒体设备权限 API — preload 侧桥接
 *
 * 渲染进程在调用 getUserMedia 之前先经这里确认麦克风授权状态，
 * 被拒绝时再跳转系统设置。渲染进程无法自行触发 macOS 的授权弹窗，
 * 因此这三步必须由主进程完成。
 *
 * 覆盖 IPC 频道：
 * - media-permission:get-mic-status
 * - media-permission:request-mic
 * - media-permission:open-mic-settings
 *
 * @module preload/api/mediaPermission
 */
import { invoke } from '../ipcHelpers'

/** 麦克风授权状态（与主进程 MicAccessStatus 对齐） */
export type MicAccessStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'unsupported'

export interface MicAccessResult {
  status: MicAccessStatus
  granted: boolean
  platform: string
}

/** 统一 IPC 返回包装 */
interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function createMediaPermissionApi() {
  return {
    /** 查询麦克风授权状态（只读，不弹系统框） */
    getMicStatus: invoke<IpcResponse<MicAccessResult>>('media-permission:get-mic-status'),
    /** 请求麦克风授权（macOS 会弹系统授权框） */
    requestMic: invoke<IpcResponse<MicAccessResult>>('media-permission:request-mic'),
    /** 打开系统麦克风隐私设置页 */
    openMicSettings: invoke<IpcResponse<{ opened: boolean; error?: string }>>(
      'media-permission:open-mic-settings',
    ),
  }
}
