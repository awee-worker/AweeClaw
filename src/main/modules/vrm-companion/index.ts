/**
 * VRM 桌面伴侣模块（barrel + 编排）
 *
 * 模块职责：
 * - VrmCompanionStore：模型库管理 + 资源协议 + 好感度系统（TS 移植）
 * - VrmCompanionManager：独立透明悬浮窗口管理（创建/显隐/拖拽/穿透）
 * - VrmCompanionIpc：渲染进程 ↔ 主进程 IPC
 *
 * 初始化时机：
 * 1. registerVrmAssetScheme() 必须在 app ready 之前调用（appBootstrap 顶部）
 * 2. initVrmCompanion() 在 ready 之后、后台异步阶段调用（不阻塞启动）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { VrmCompanionManager, getVrmCompanionManager } from './VrmCompanionManager'
import { registerVrmCompanionIpc } from './VrmCompanionIpc'
import { handleVrmAssetProtocol, getConfig } from './VrmCompanionStore'

export { VrmCompanionManager, getVrmCompanionManager } from './VrmCompanionManager'
export { registerVrmCompanionIpc } from './VrmCompanionIpc'
export {
  registerVrmAssetScheme,
  handleVrmAssetProtocol,
  getConfig as getVrmCompanionConfig,
  updateConfig as updateVrmCompanionConfig,
  listModels as listVrmModels,
  listAnimations as listVrmAnimations,
  loadAffectionData,
  extractAndUpdateAffection,
  VRM_ASSET_SCHEME,
  type VrmCompanionConfig,
  type VrmModelInfo,
  type VrmAnimationInfo,
  type AffectionData,
} from './VrmCompanionStore'

/**
 * 初始化 VRM 伴侣模块（app ready 之后调用）。
 *
 * 流程：挂载资源协议 → 注册 IPC → 按配置决定是否创建/显示窗口。
 * 窗口默认不创建，用户开启后才实例化（避免无谓的 3D 渲染开销）。
 */
export function initVrmCompanion(): void {
  try {
    // 1. 挂载 vrm-asset:// 协议（必须 ready 后）
    handleVrmAssetProtocol()

    // 2. 注册 IPC handler
    registerVrmCompanionIpc()

    // 3. 按配置决定是否随启动显示
    const config = getConfig()
    if (config.enabled && config.showOnStartup) {
      const manager = getVrmCompanionManager()
      // 延迟到下一个事件循环，避免与主窗口启动争抢资源
      setTimeout(() => {
        try {
          manager.show()
        } catch (err) {
          logger.system.warn('[VrmCompanion] Delayed show failed:', err)
        }
      }, 1200)
    }

    logger.system.info('[VrmCompanion] Module initialized', {
      enabled: config.enabled,
      showOnStartup: config.showOnStartup,
    })
  } catch (err) {
    logger.system.warn('[VrmCompanion] Module init skipped:', err)
  }
}

/** 销毁伴侣窗口（完整退出流程调用） */
export function destroyVrmCompanion(): void {
  try {
    VrmCompanionManager.getInstance().destroy()
  } catch (err) {
    logger.system.warn('[VrmCompanion] Destroy failed:', err)
  }
}
