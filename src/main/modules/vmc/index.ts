/**
 * VMC 协议模块导出
 *
 * 双向 VMC（Virtual Motion Capture）协议实现：
 * - 出站：将 AweeClaw 的 VRM 动作发送给外部应用（VSeeFace、Warudo 等）
 * - 入站：接收外部 VMC 数据驱动 AweeClaw 的 VRM 模型
 *
 * 初始化时机：
 * 1. initVmcModule() 在 app ready 之后、后台异步阶段调用
 * 2. 默认关闭：需要在设置中显式开启
 *
 * @module vmc
 */

import { getVmcManager } from './VmcManager'
import { registerVmcIpcHandlers, cleanupVmcIpcHandlers } from './VmcIpc'

export { getVmcManager }
export type { VmcManagerState, VmcFramePayload } from './VmcManager'

export { getVmcStore } from './VmcStore'
export type { VmcConfig, VmcState } from './VmcStore'

export { getVmcSender } from './VmcSender'
export type { VmcSenderState } from './VmcSender'

export { getVmcReceiver } from './VmcReceiver'
export type { VmcReceiverState, VmcReceiverEvents } from './VmcReceiver'

export { getVmcMapper } from './VmcMapper'
export type { BoneMapping, BlendMapping, MappingResult } from './VmcMapper'

// 注意：必须产生本地绑定。仅用 `export { X } from './X'` 的 re-export 形式
// 不会在模块内声明 `X`，函数体内直接调用会抛 ReferenceError（被 try/catch 默默吃掉），
// 表现为渲染进程报「No handler registered for 'vmc:...'」。
export { registerVmcIpcHandlers, cleanupVmcIpcHandlers }

export {
  encodeOscMessage,
  encodeOscBundle,
  decodeOscMessage,
  decodeOscBundle,
  createHeartbeatMessage,
  createTimestampMessage,
  createBoneMessage,
  createRootBoneMessage,
  createBlendMessage,
  createBlendApplyMessage,
  parseBoneMessage,
  parseBlendMessage,
  type OscArg,
  type OscMessage,
  type OscBundle,
  type VmcBoneData,
  type VmcBlendData,
  type VmcFrameData,
} from './VmcCodec'

/**
 * 初始化 VMC 模块（app ready 之后调用）。
 *
 * 流程：初始化管理器 → 注册 IPC → 按配置决定是否启停模块。
 * 默认关闭：需要在设置中显式开启。
 */
export function initVmcModule(): void {
  try {
    // 先注册 IPC handler，确保渲染进程能正常调用（即使 manager 初始化失败）
    registerVmcIpcHandlers()

    const manager = getVmcManager()
    manager.init()

    console.log('[VmcModule] Module initialized')
  } catch (err) {
    console.error('[VmcModule] Module init failed:', err)
  }
}

/**
 * 销毁 VMC 模块（完整退出流程调用）。
 */
export function destroyVmcModule(): void {
  try {
    cleanupVmcIpcHandlers()
    getVmcManager().destroy()
    console.log('[VmcModule] Module destroyed')
  } catch (err) {
    console.error('[VmcModule] Module destroy failed:', err)
  }
}