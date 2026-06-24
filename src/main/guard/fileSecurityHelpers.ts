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
