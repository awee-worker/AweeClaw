/**
 * 会议纪要模块入口（barrel + 编排）
 *
 * 聚合导出 MeetingNotesManager，并提供 initMeetingNotesModule(deps) 编排函数。
 *
 * 用法：
 * - 在 moduleInitializer.ts 的 initFloatingAvatarModule 中，由 floating-avatar/index.ts
 *   通过 `MeetingNotesManager.getInstance(getWorkspacePath)` 获取实例，
 *   菜单回调 `startMeetingNotes: () => manager.show()` 触发显示。
 * - IPC 在首次 show() 时幂等注册，无需显式 init。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { MeetingNotesManager } from './MeetingNotesManager'
import type { WorkspacePathGetter } from './types'

export { MeetingNotesManager } from './MeetingNotesManager'
export { generateDocxBuffer } from './DocxGenerator'
export type { WorkspacePathGetter, MeetingNotesDirInfo } from './types'

/** 模块依赖（由外部注入） */
export interface MeetingNotesModuleDeps {
  /** 获取当前工作区路径 */
  getWorkspacePath: WorkspacePathGetter
}

/**
 * 初始化会议纪要模块
 *
 * 预获取单例（内部完成 IPC 幂等注册的预备）。
 * 实际窗口创建延迟到首次 show() 调用。
 *
 * 幂等：重复调用安全。
 */
export function initMeetingNotesModule(deps: MeetingNotesModuleDeps): MeetingNotesManager {
  try {
    const manager = MeetingNotesManager.getInstance(deps.getWorkspacePath)
    logger.system.info('[MeetingNotes] Module initialized')
    return manager
  } catch (err) {
    logger.system.error('[MeetingNotes] Module init failed:', err)
    throw err
  }
}
