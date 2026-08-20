/**
 * 错误处理代码片段集合
 *
 * 提供场景开发中常用的错误处理样板：
 *  - try-catch-result:     执行器内的 try/catch + 结构化错误返回
 *  - custom-error-class:   自定义错误类（带错误码）
 *  - error-code-registry:  错误码统一注册表
 */
import type { Snippet } from './types'

// ==========================================
// 执行器 try/catch 样板
// ==========================================
export const tryCatchResultSnippet: Snippet = {
  id: 'try-catch-result',
  name: 'Try Catch Result',
  nameZh: '执行器 try/catch 样板',
  description: 'Standard try/catch pattern for tool executors with structured result',
  descriptionZh: '执行器标准 try/catch 样板，返回结构化结果',
  category: 'error',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'ShieldAlert',
  tags: ['error', 'try-catch', 'executor'],
  difficulty: 'beginner',
  targetFile: 'src/tools/executors.ts',
  variables: [
    {
      name: 'toolName',
      defaultValue: 'my_tool',
      description: 'Tool name for logging',
      descriptionZh: '工具名（用于日志）',
      required: true,
    },
  ],
  code: `try {
  context.getLogger().info('[\${toolName}] start')
  // TODO: 业务逻辑
  const data = {}

  context.getLogger().info('[\${toolName}] success')
  return {
    success: true,
    result: JSON.stringify({ data, message: '操作成功' }),
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  context.getLogger().error('[\${toolName}] failed:', err)
  return {
    success: false,
    result: '',
    error: message,
  }
}`,
  usage: '插入到执行器主体，替代裸露的业务代码；保证异常都被捕获并结构化返回。',
}

// ==========================================
// 自定义错误类（带错误码）
// ==========================================
export const customErrorClassSnippet: Snippet = {
  id: 'custom-error-class',
  name: 'Custom Error Class',
  nameZh: '自定义错误类',
  description: 'Custom Error subclass with error code and context',
  descriptionZh: '带错误码与上下文的自定义 Error 子类',
  category: 'error',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'Bug',
  tags: ['error', 'class', 'error-code'],
  difficulty: 'intermediate',
  targetFile: 'src/utils/errors.ts',
  variables: [],
  code: `/**
 * 自定义错误基类
 * 携带错误码、HTTP 状态码、上下文数据
 */
export class AppError extends Error {
  /** 错误码（如 'VALIDATION_ERROR'） */
  readonly code: string
  /** HTTP 状态码（默认 400） */
  readonly statusCode: number
  /** 附加上下文（用于日志） */
  readonly context?: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    options: {
      statusCode?: number
      context?: Record<string, unknown>
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = options.statusCode ?? 400
    this.context = options.context
    // 兼容 Error cause（Node 16.9+）
    if (options.cause !== undefined && !('cause' in this)) {
      ;(this as any).cause = options.cause
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
    }
  }
}

/** 参数校验错误 */
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, { statusCode: 422, context })
  }
}

/** 未找到资源 */
export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, unknown>) {
    super('NOT_FOUND', resource + ' 不存在', { statusCode: 404, context })
  }
}

/** 权限不足 */
export class ForbiddenError extends AppError {
  constructor(message = '权限不足', context?: Record<string, unknown>) {
    super('FORBIDDEN', message, { statusCode: 403, context })
  }
}`,
  usage: '业务逻辑中抛出 throw new ValidationError("title 不能为空")；执行器 catch 中通过 instanceof 判断类型返回对应 HTTP 状态码。',
}

// ==========================================
// 错误码统一注册表
// ==========================================
export const errorCodeRegistrySnippet: Snippet = {
  id: 'error-code-registry',
  name: 'Error Code Registry',
  nameZh: '错误码注册表',
  description: 'Centralized error code registry for consistent error handling',
  descriptionZh: '集中式错误码注册表，保证全场景错误码一致',
  category: 'error',
  applicableTypes: ['both'],
  language: 'typescript',
  icon: 'ListChecks',
  tags: ['error', 'registry', 'error-code'],
  difficulty: 'intermediate',
  targetFile: 'src/utils/errorCodes.ts',
  variables: [],
  code: `/**
 * 错误码注册表
 * 命名规范：<域>_<动作>_<原因>，如 DB_QUERY_TIMEOUT
 */
export const ErrorCodes = {
  // 参数校验
  PARAM_MISSING: 'PARAM_MISSING',
  PARAM_INVALID: 'PARAM_INVALID',
  PARAM_TYPE: 'PARAM_TYPE',

  // 数据库
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_NOT_FOUND: 'DB_NOT_FOUND',
  DB_DUPLICATE: 'DB_DUPLICATE',
  DB_CONSTRAINT: 'DB_CONSTRAINT',

  // 权限
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',

  // 外部依赖
  EXTERNAL_API_TIMEOUT: 'EXTERNAL_API_TIMEOUT',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',

  // 业务
  BIZ_RULE_VIOLATION: 'BIZ_RULE_VIOLATION',
  BIZ_STATE_INVALID: 'BIZ_STATE_INVALID',
} as const

export type ErrorCode = keyof typeof ErrorCodes

/** 错误码对应的默认消息（中英双语） */
export const ErrorMessages: Record<string, { en: string; zh: string }> = {
  [ErrorCodes.PARAM_MISSING]: { en: 'Missing parameter', zh: '缺少参数' },
  [ErrorCodes.PARAM_INVALID]: { en: 'Invalid parameter', zh: '参数无效' },
  [ErrorCodes.PARAM_TYPE]: { en: 'Parameter type mismatch', zh: '参数类型不匹配' },
  [ErrorCodes.DB_QUERY_FAILED]: { en: 'Database query failed', zh: '数据库查询失败' },
  [ErrorCodes.DB_NOT_FOUND]: { en: 'Resource not found', zh: '资源未找到' },
  [ErrorCodes.DB_DUPLICATE]: { en: 'Resource already exists', zh: '资源已存在' },
  [ErrorCodes.DB_CONSTRAINT]: { en: 'Constraint violation', zh: '约束冲突' },
  [ErrorCodes.AUTH_REQUIRED]: { en: 'Authentication required', zh: '需要登录' },
  [ErrorCodes.AUTH_FORBIDDEN]: { en: 'Permission denied', zh: '权限不足' },
  [ErrorCodes.EXTERNAL_API_TIMEOUT]: { en: 'External API timeout', zh: '外部 API 超时' },
  [ErrorCodes.EXTERNAL_API_ERROR]: { en: 'External API error', zh: '外部 API 异常' },
  [ErrorCodes.BIZ_RULE_VIOLATION]: { en: 'Business rule violation', zh: '业务规则冲突' },
  [ErrorCodes.BIZ_STATE_INVALID]: { en: 'Invalid business state', zh: '业务状态无效' },
}

/** 根据错误码获取本地化消息 */
export function getErrorMessage(code: string, lang: 'en' | 'zh' = 'zh'): string {
  return ErrorMessages[code]?.[lang] ?? code
}`,
  usage: '执行器返回错误时使用统一码：return { success: false, result: "", error: getErrorMessage(ErrorCodes.DB_NOT_FOUND) }。',
}
