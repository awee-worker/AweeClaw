/**
 * 文件安全校验辅助 — 统一的安全检查逻辑
 *
 * 设计理念：
 * - 单一职责：仅负责安全校验，不涉及业务逻辑
 * - 可组合：提供细粒度的校验函数，便于复用
 * - 可观测性：所有校验失败均记录安全日志
 * - 性能优化：禁止类型正则预编译
 */

import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { securityManager, OperationType } from './securityPolicyEngine'

/** 禁止写入的文件类型（可执行文件、系统文件） */
const FORBIDDEN_WRITE_PATTERNS: ReadonlyArray<RegExp> = [
  /\.exe$/i,
  /\.dll$/i,
  /\.sys$/i,
  /\.tmp$/i,
  /\.temp$/i,
]

/** 禁止写入的二进制文件类型（更严格） */
const FORBIDDEN_BINARY_PATTERNS: ReadonlyArray<RegExp> = [
  /\.exe$/i,
  /\.dll$/i,
  /\.sys$/i,
]

/** 工作区会话 */
interface WorkspaceSession {
  roots: string[]
}

/** 安全校验结果 */
interface SecurityCheckResult {
  /** 是否通过校验 */
  passed: boolean
  /** 失败原因（通过时为 undefined） */
  reason?: string
}

/**
 * 校验路径是否在工作区边界内
 *
 * @param filePath 文件路径
 * @param workspace 工作区会话
 * @returns 校验结果
 */
export function validateWorkspaceBoundary(
  filePath: string,
  workspace: WorkspaceSession | null,
): SecurityCheckResult {
  if (workspace && !securityManager.validateWorkspacePath(filePath, workspace.roots)) {
    return { passed: false, reason: '安全底线：超出工作区边界' }
  }
  return { passed: true }
}

/**
 * 校验路径是否为敏感路径
 *
 * @param filePath 文件路径
 * @returns 校验结果
 */
export function validateNotSensitive(filePath: string): SecurityCheckResult {
  if (securityManager.isSensitivePath(filePath)) {
    return { passed: false, reason: '安全底线：敏感路径' }
  }
  return { passed: true }
}

/**
 * 校验文件类型是否允许写入
 *
 * @param filePath 文件路径
 * @param binary 是否为二进制文件
 * @returns 校验结果
 */
export function validateFileType(
  filePath: string,
  binary: boolean = false,
): SecurityCheckResult {
  const patterns = binary ? FORBIDDEN_BINARY_PATTERNS : FORBIDDEN_WRITE_PATTERNS

  for (const pattern of patterns) {
    if (pattern.test(filePath)) {
      return { passed: false, reason: '安全底线：禁止类型' }
    }
  }

  return { passed: true }
}

/**
 * 执行完整的安全校验（工作区边界 + 敏感路径 + 文件类型）
 *
 * @param filePath 文件路径
 * @param workspace 工作区会话
 * @param operation 操作类型
 * @param binary 是否为二进制文件
 * @returns 校验结果
 */
export function validateFileOperation(
  filePath: string,
  workspace: WorkspaceSession | null,
  operation: OperationType,
  binary: boolean = false,
): SecurityCheckResult {
  // 工作区边界校验
  const boundaryCheck = validateWorkspaceBoundary(filePath, workspace)
  if (!boundaryCheck.passed) {
    securityManager.logOperation(operation, filePath, false, { reason: boundaryCheck.reason })
    return boundaryCheck
  }

  // 敏感路径校验
  const sensitiveCheck = validateNotSensitive(filePath)
  if (!sensitiveCheck.passed) {
    securityManager.logOperation(operation, filePath, false, { reason: sensitiveCheck.reason })
    return sensitiveCheck
  }

  // 文件类型校验（仅写入操作）
  if (operation === OperationType.FILE_WRITE) {
    const typeCheck = validateFileType(filePath, binary)
    if (!typeCheck.passed) {
      securityManager.logOperation(operation, filePath, false, { reason: typeCheck.reason })
      return typeCheck
    }
  }

  return { passed: true }
}

/**
 * 记录文件操作成功日志
 *
 * @param operation 操作类型
 * @param filePath 文件路径
 * @param metadata 附加元数据
 */
export function logFileSuccess(
  operation: OperationType,
  filePath: string,
  metadata?: Record<string, unknown>,
): void {
  securityManager.logOperation(operation, filePath, true, metadata)
}

/**
 * 记录文件操作失败日志
 *
 * @param operation 操作类型
 * @param filePath 文件路径
 * @param error 错误信息
 */
export function logFileFailure(
  operation: OperationType,
  filePath: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error)
  logger.security.warn('[fileSecurity] 操作失败', {
    operation,
    path: filePath,
    error: message,
  })
  securityManager.logOperation(operation, filePath, false, { error: message })
}

/**
 * 确保文件路径的父目录存在
 *
 * @param filePath 文件路径
 */
export async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath)
  const { promises: fsPromises } = await import('fs')
  await fsPromises.mkdir(dir, { recursive: true })
}

/**
 * 检查文件是否为新文件（不存在）
 *
 * @param filePath 文件路径
 * @returns 是新文件返回 true
 */
export async function isNewFile(filePath: string): Promise<boolean> {
  const fs = await import('fs')
  return !fs.existsSync(filePath)
}

/**
 * 可重试的瞬时错误码集合
 *
 * 这些错误通常是临时性的，重试可以成功：
 * - EBUSY: 资源繁忙（Windows 文件被占用）
 * - EAGAIN: 资源暂时不可用
 * - EACCES: 权限不足（可能是临时锁定）
 * - ENOENT: 文件/目录不存在（可能正在被创建/删除）
 * - EIO: I/O 错误（通常是临时的）
 * - EFILE: 文件错误（Windows 兼容）
 * - EROFS: 只读文件系统（部分场景可恢复）
 * - ENOSPC: 磁盘空间不足（短暂情况）
 * - EEXIST: 文件已存在（创建临时文件时的竞态）
 *
 * 注意：EACCES 通常是永久性权限问题，但在某些场景（如父目录刚创建）下重试可成功，
 * 因此也纳入可重试范围。
 */
const RETRYABLE_ERROR_CODES = new Set([
  'EBUSY',
  'EAGAIN',
  'EACCES',
  'ENOENT',
  'EIO',
  'EFILE',
  'EROFS',
  'ENOSPC',
  'EEXIST',
  'EPERM',
])

/**
 * 判断错误是否可重试
 *
 * Node.js 错误码位于 error.code（大写），同时检查 error.errno 作为兜底。
 */
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as NodeJS.ErrnoException).code
  const errno = (err as NodeJS.ErrnoException).errno
  if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) return true
  if (typeof errno === 'string' && RETRYABLE_ERROR_CODES.has(errno)) return true
  return false
}

/** 简单的异步延迟 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 原子写入文件：写入同目录临时文件后 rename 替换目标文件
 *
 * 优势：
 * - 避免部分写入：rename 是原子操作，要么完全成功要么完全不变
 * - 减少文件锁冲突：写入临时文件不会长期持有目标文件的锁
 * - 并发安全：多个进程同时写入时不会出现交错内容
 *
 * Windows 注意：若目标文件被其他进程独占（编辑器、LSP），rename 会失败，
 * 此时回退到直接写入目标文件（仍会经过外层的重试机制）。
 *
 * @param filePath 目标文件路径
 * @param data 写入数据（字符串或 Buffer）
 * @param encoding 写入编码（仅对字符串有效，二进制时传 undefined）
 */
async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  encoding?: BufferEncoding,
): Promise<void> {
  const fsP = (await import('fs')).promises
  // 临时文件放在同目录（保证同分区，rename 原子性）
  // 包含 pid 防止并发冲突，包含时间戳便于排查
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.aweeclaw-tmp`

  try {
    // 1. 写入临时文件
    if (typeof data === 'string') {
      await fsP.writeFile(tmpPath, data, encoding || 'utf-8')
    } else {
      await fsP.writeFile(tmpPath, data)
    }

    // 2. 同步文件内容到磁盘（减少突然崩溃导致的数据丢失）
    // 仅对文本写入场景做 fsync，二进制大文件跳过避免性能损耗
    if (typeof data === 'string' && data.length < 1_000_000) {
      try {
        const fd = await fsP.open(tmpPath, 'r')
        await fd.sync()
        await fd.close()
      } catch {
        // fsync 失败不阻断写入流程
      }
    }

    // 3. 原子替换目标文件
    await fsP.rename(tmpPath, filePath)
  } catch (err) {
    // 清理临时文件
    try {
      await fsP.unlink(tmpPath)
    } catch {
      // 临时文件清理失败忽略（可能已被删除或 rename 成功）
    }

    // Windows 上 rename 可能因目标文件被占用而失败（EPERM / EBUSY / EACCES）
    // 此时回退到直接写入目标文件（覆盖写入）
    // 这种回退没有原子性，但能保证写入成功
    if (isRetryableError(err)) {
      if (typeof data === 'string') {
        await fsP.writeFile(filePath, data, encoding || 'utf-8')
      } else {
        await fsP.writeFile(filePath, data)
      }
      return
    }

    throw err
  }
}

/**
 * 带重试的文件写入
 *
 * 1. 使用原子写入（临时文件 + rename）减少锁冲突和部分写入
 * 2. 对瞬时错误自动重试，最多 3 次，间隔递增（80ms → 160ms → 320ms）
 *
 * 解决场景：
 * - 文件被 LSP / 编辑器 / Git 短暂占用 → 等待后重试
 * - 父目录刚创建还未完全就绪 → 等待后重试
 * - 跨进程 IPC 偶发的瞬时 I/O 错误 → 重试
 * - 文件监听器触发的衍生操作短暂占用文件 → 等待后重试
 *
 * @param filePath 目标文件路径
 * @param content 写入内容（字符串）
 * @param encoding 写入编码，默认 utf-8
 * @param options 可选配置
 * @returns true 表示写入成功，false 表示最终失败
 */
export async function writeFileWithRetry(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8',
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<boolean> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const baseDelayMs = Math.max(10, options.baseDelayMs ?? 80)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await atomicWriteFile(filePath, content, encoding)
      return true
    } catch (err) {

      // 不可重试错误立即返回
      if (!isRetryableError(err)) {
        logger.security.warn('[fileSecurity] 写入失败（不可重试）', {
          path: filePath,
          attempt,
          error: err instanceof Error ? err.message : String(err),
          code: (err as NodeJS.ErrnoException).code,
        })
        return false
      }

      // 最后一次尝试不再等待
      if (attempt >= maxAttempts) {
        logger.security.warn('[fileSecurity] 写入失败（重试耗尽）', {
          path: filePath,
          attempts: maxAttempts,
          error: err instanceof Error ? err.message : String(err),
          code: (err as NodeJS.ErrnoException).code,
        })
        return false
      }

      // 递增延迟：80ms → 160ms → 320ms
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1)
      logger.security.debug?.('[fileSecurity] 写入失败，准备重试', {
        path: filePath,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        code: (err as NodeJS.ErrnoException).code,
      })
      await delay(delayMs)
    }
  }

  return false
}

/**
 * 带重试的二进制文件写入
 *
 * 与 writeFileWithRetry 类似，但写入 Buffer 而非字符串，不做 fsync（大文件性能考量）。
 *
 * @param filePath 目标文件路径
 * @param buffer 写入的二进制数据
 * @param options 可选配置
 * @returns true 表示写入成功，false 表示最终失败
 */
export async function writeBinaryFileWithRetry(
  filePath: string,
  buffer: Buffer,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<boolean> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const baseDelayMs = Math.max(10, options.baseDelayMs ?? 80)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await atomicWriteFile(filePath, buffer)
      return true
    } catch (err) {
      if (!isRetryableError(err)) {
        logger.security.warn('[fileSecurity] 二进制写入失败（不可重试）', {
          path: filePath,
          attempt,
          error: err instanceof Error ? err.message : String(err),
          code: (err as NodeJS.ErrnoException).code,
        })
        return false
      }

      if (attempt >= maxAttempts) {
        logger.security.warn('[fileSecurity] 二进制写入失败（重试耗尽）', {
          path: filePath,
          attempts: maxAttempts,
          error: err instanceof Error ? err.message : String(err),
          code: (err as NodeJS.ErrnoException).code,
        })
        return false
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1)
      await delay(delayMs)
    }
  }

  return false
}
