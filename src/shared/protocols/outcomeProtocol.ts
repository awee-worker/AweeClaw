/**
 * 统一的 Result 类型
 * 用于表示操作结果，替代 try-catch 或 Promise rejection
 */

/**
 * 成功结果
 */
export interface SuccessResult<T = void> {
  success: true
  data: T
}

/**
 * 失败结果
 */
export interface FailureResult {
  success: false
  error: string
  code?: string | number
  details?: unknown
}

/**
 * 操作结果类型
 */
export type Result<T = void> = SuccessResult<T> | FailureResult

/**
 * 创建成功结果
 */
export function ok<T>(data: T): SuccessResult<T> {
  return { success: true, data }
}

/**
 * 创建成功结果（无数据）
 */
export function okVoid(): SuccessResult<void> {
  return { success: true, data: undefined }
}

/**
 * 创建失败结果
 */
export function fail(error: string, options?: { code?: string | number; details?: unknown }): FailureResult {
  return {
    success: false,
    error,
    ...(options?.code !== undefined && { code: options.code }),
    ...(options?.details !== undefined && { details: options.details }),
  }
}

/**
 * 从 Error 创建失败结果
 */
export function failFromError(err: unknown, defaultMessage = 'Unknown error'): FailureResult {
  if (err instanceof Error) {
    return fail(err.message)
  }
  return fail(typeof err === 'string' ? err : defaultMessage)
}

/**
 * 判断是否为成功结果
 */
export function isOk<T>(result: Result<T>): result is SuccessResult<T> {
  return result.success === true
}

/**
 * 判断是否为失败结果
 */
export function isFail(result: Result<unknown>): result is FailureResult {
  return result.success === false
}

/**
 * 包装异步函数，返回 Result
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn()
    return ok(data)
  } catch (err) {
    return failFromError(err)
  }
}

/**
 * 包装同步函数，返回 Result
 */
export function tryCatchSync<T>(fn: () => T): Result<T> {
  try {
    const data = fn()
    return ok(data)
  } catch (err) {
    return failFromError(err)
  }
}

/**
 * 解包 Result，失败时抛出异常
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.success) {
    return result.data
  }
  throw new Error(result.error)
}

/**
 * 解包 Result，失败时返回默认值
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
  return result.success ? result.data : defaultValue
}
