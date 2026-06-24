/**
 * 错误处理工具 — 应用错误类型与错误转换
 */
export interface AppError {
  code: string
  message: string
  details?: unknown
  timestamp: number
}

export function createError(code: string, message: string, details?: unknown): AppError {
  return { code, message, details, timestamp: Date.now() }
}

export function isAppError(error: unknown): error is AppError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
}
