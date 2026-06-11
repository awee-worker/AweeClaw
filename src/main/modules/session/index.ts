/**
 * Session 模块入口
 *
 * 提供 Session 生命周期管理能力。
 */

export { sessionLifecycleManager } from './SessionLifecycleManager'
export type {
  SessionState,
  SessionLifecycleConfig,
  SessionContext,
} from './SessionLifecycleManager'
export { DEFAULT_SESSION_LIFECYCLE_CONFIG } from './SessionLifecycleManager'
