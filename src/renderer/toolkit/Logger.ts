/**
 * 统一日志工具
 * 重新导出 shared 版本，保持向后兼容
 */

export { logger, type LogLevel, type LogCategory, type LogEntry } from '@shared/toolkit/LogEngine'
export { logger as default } from '@shared/toolkit/LogEngine'

