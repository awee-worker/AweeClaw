/**
 * 媒体设备权限模块入口
 *
 * 仅注册 IPC，不持有任何运行时状态：权限状态始终以系统为准，
 * 缓存下来只会让「用户刚在系统设置里打开权限」这种情况读到旧值。
 *
 * @module modules/media-permission
 */
export { registerMediaPermissionIpc } from './MediaPermissionIpc'
export type { MicAccessResult, MicAccessStatus } from './MediaPermissionIpc'

import { registerMediaPermissionIpc } from './MediaPermissionIpc'

/** 初始化媒体设备权限模块（注册 IPC 处理器） */
export function initializeMediaPermissionModule(): void {
  registerMediaPermissionIpc()
}
