/**
 * Error handling utilities
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
