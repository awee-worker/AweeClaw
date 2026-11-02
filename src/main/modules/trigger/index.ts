/**
 * 事件触发器模块出口
 *
 * @module trigger
 */

export {
  triggerRegistry,
  globToRegExp,
  matchesAnyPattern,
} from './TriggerRegistry'

export { FileWatchSource, type FileWatchSourceOptions } from './sources/FileWatchSource'
export { HookEventSource, type HookEventSourceOptions } from './sources/HookEventSource'

export {
  DEFAULT_TRIGGER_CONFIG,
  TRIGGER_LOG_PREFIX,
  type SemanticChecker,
  type SemanticVerdict,
  type TriggerActionType,
  type TriggerEvent,
  type TriggerHit,
  type TriggerRule,
  type TriggerSource,
  type TriggerSourceType,
  type TriggerStats,
} from './types'
