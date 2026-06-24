/**
 * 应用异常体系
 *
 * 提供错误分类、错误描述与异常对象的统一管理。
 * 错误码按业务域分段，便于快速定位问题来源。
 */

/* ------------------------------------------------------------------ */
/* 错误码定义                                                        */
/* ------------------------------------------------------------------ */

/**
 * 错误码分段规则：
 * - 1xxx：通用错误
 * - 2xxx：文件系统
 * - 3xxx：网络通信
 * - 4xxx：大模型服务
 * - 5xxx：工具执行
 * - 6xxx：安全策略
 * - 7xxx：版本控制
 * - 8xxx：代码索引
 */
export const ErrorCodes = {
  UNKNOWN: 1000,
  VALIDATION_ERROR: 1001,
  TIMEOUT: 1002,
  ABORTED: 1003,

  FILE_NOT_FOUND: 2001,
  FILE_READ_ERROR: 2002,
  FILE_WRITE_ERROR: 2003,
  FILE_DELETE_ERROR: 2004,
  DIRECTORY_NOT_FOUND: 2005,
  PATH_OUTSIDE_WORKSPACE: 2006,
  SENSITIVE_PATH: 2007,

  NETWORK_ERROR: 3001,
  CONNECTION_REFUSED: 3002,
  DNS_ERROR: 3003,
  SSL_ERROR: 3004,

  LLM_API_ERROR: 4001,
  LLM_RATE_LIMIT: 4002,
  LLM_QUOTA_EXCEEDED: 4003,
  LLM_INVALID_API_KEY: 4004,
  LLM_MODEL_NOT_FOUND: 4005,
  LLM_CONTEXT_LENGTH_EXCEEDED: 4006,
  LLM_INVALID_REQUEST: 4007,

  TOOL_NOT_FOUND: 5001,
  TOOL_VALIDATION_ERROR: 5002,
  TOOL_EXECUTION_ERROR: 5003,
  TOOL_TIMEOUT: 5004,
  TOOL_REJECTED: 5005,

  SECURITY_PERMISSION_DENIED: 6001,
  SECURITY_WHITELIST_BLOCKED: 6002,
  SECURITY_WORKSPACE_VIOLATION: 6003,

  GIT_NOT_INITIALIZED: 7001,
  GIT_COMMAND_FAILED: 7002,
  GIT_MERGE_CONFLICT: 7003,

  INDEX_NOT_INITIALIZED: 8001,
  INDEX_EMBEDDING_ERROR: 8002,
  INDEX_SEARCH_ERROR: 8003,
} as const

/** 错误码类型 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/* ------------------------------------------------------------------ */
/* 错误描述                                                          */
/* ------------------------------------------------------------------ */

/** 错误描述信息 */
export interface ErrorDescriptor {
  /** 标题 */
  title: string
  /** 详细描述 */
  description: string
  /** 修复建议 */
  suggestion?: string
}

/** 错误码到描述的映射表 */
const ERROR_TABLE: Record<number, ErrorDescriptor> = {
  [ErrorCodes.UNKNOWN]: {
    title: 'Unknown Error',
    description: 'An unexpected error occurred.',
    suggestion: 'Please try again or restart the application.',
  },
  [ErrorCodes.VALIDATION_ERROR]: {
    title: 'Validation Error',
    description: 'The provided input is invalid.',
  },
  [ErrorCodes.TIMEOUT]: {
    title: 'Operation Timeout',
    description: 'The operation took too long to complete.',
    suggestion: 'Try again or check your network connection.',
  },
  [ErrorCodes.ABORTED]: {
    title: 'Operation Aborted',
    description: 'The operation was cancelled.',
  },

  [ErrorCodes.FILE_NOT_FOUND]: {
    title: 'File Not Found',
    description: 'The specified file does not exist.',
  },
  [ErrorCodes.FILE_READ_ERROR]: {
    title: 'File Read Error',
    description: 'Failed to read the file.',
    suggestion: 'Check file permissions and try again.',
  },
  [ErrorCodes.FILE_WRITE_ERROR]: {
    title: 'File Write Error',
    description: 'Failed to write to the file.',
    suggestion: 'Check file permissions and disk space.',
  },
  [ErrorCodes.FILE_DELETE_ERROR]: {
    title: 'File Delete Error',
    description: 'Failed to delete the file.',
  },
  [ErrorCodes.DIRECTORY_NOT_FOUND]: {
    title: 'Directory Not Found',
    description: 'The specified directory does not exist.',
  },
  [ErrorCodes.PATH_OUTSIDE_WORKSPACE]: {
    title: 'Path Outside Workspace',
    description: 'The path is outside the current workspace.',
    suggestion: 'Only files within the workspace can be accessed.',
  },
  [ErrorCodes.SENSITIVE_PATH]: {
    title: 'Sensitive Path',
    description: 'Access to this path is restricted for security reasons.',
  },

  [ErrorCodes.NETWORK_ERROR]: {
    title: 'Network Error',
    description: 'A network error occurred.',
    suggestion: 'Check your internet connection.',
  },
  [ErrorCodes.CONNECTION_REFUSED]: {
    title: 'Connection Refused',
    description: 'The server refused the connection.',
    suggestion: 'Check if the server is running and accessible.',
  },
  [ErrorCodes.DNS_ERROR]: {
    title: 'DNS Error',
    description: 'Failed to resolve the server address.',
    suggestion: 'Check your DNS settings or try again later.',
  },
  [ErrorCodes.SSL_ERROR]: {
    title: 'SSL Error',
    description: 'SSL/TLS connection failed.',
    suggestion: 'Check your SSL certificates or try disabling SSL verification.',
  },

  [ErrorCodes.LLM_API_ERROR]: {
    title: 'API Error',
    description: 'The LLM API returned an error.',
  },
  [ErrorCodes.LLM_RATE_LIMIT]: {
    title: 'Rate Limited',
    description: 'Too many requests. Please wait before trying again.',
    suggestion: 'Wait a few seconds and try again.',
  },
  [ErrorCodes.LLM_QUOTA_EXCEEDED]: {
    title: 'Quota Exceeded',
    description: 'Your API quota has been exceeded.',
    suggestion: 'Check your API usage and billing.',
  },
  [ErrorCodes.LLM_INVALID_API_KEY]: {
    title: 'Invalid API Key',
    description: 'The API key is invalid or expired.',
    suggestion: 'Check your API key in Settings > Provider.',
  },
  [ErrorCodes.LLM_MODEL_NOT_FOUND]: {
    title: 'Model Not Found',
    description: 'The specified model does not exist.',
    suggestion: 'Check the model name or select a different model.',
  },
  [ErrorCodes.LLM_CONTEXT_LENGTH_EXCEEDED]: {
    title: 'Context Too Long',
    description: 'The conversation is too long for the model.',
    suggestion: 'Start a new conversation or use a model with larger context.',
  },
  [ErrorCodes.LLM_INVALID_REQUEST]: {
    title: 'Invalid Request',
    description: 'The request to the LLM was invalid.',
  },

  [ErrorCodes.TOOL_NOT_FOUND]: {
    title: 'Tool Not Found',
    description: 'The specified tool does not exist.',
  },
  [ErrorCodes.TOOL_VALIDATION_ERROR]: {
    title: 'Tool Validation Error',
    description: 'The tool parameters are invalid.',
  },
  [ErrorCodes.TOOL_EXECUTION_ERROR]: {
    title: 'Tool Execution Error',
    description: 'The tool failed to execute.',
  },
  [ErrorCodes.TOOL_TIMEOUT]: {
    title: 'Tool Timeout',
    description: 'The tool execution timed out.',
    suggestion: 'Try again or increase the timeout.',
  },
  [ErrorCodes.TOOL_REJECTED]: {
    title: 'Tool Rejected',
    description: 'The tool execution was rejected by the user.',
  },

  [ErrorCodes.SECURITY_PERMISSION_DENIED]: {
    title: 'Permission Denied',
    description: 'You do not have permission to perform this action.',
  },
  [ErrorCodes.SECURITY_WHITELIST_BLOCKED]: {
    title: 'Command Blocked',
    description: 'This command is not in the whitelist.',
    suggestion: 'Add the command to Settings > Security > Shell Command Whitelist.',
  },
  [ErrorCodes.SECURITY_WORKSPACE_VIOLATION]: {
    title: 'Workspace Violation',
    description: 'This operation violates workspace security boundaries.',
  },

  [ErrorCodes.GIT_NOT_INITIALIZED]: {
    title: 'Git Not Initialized',
    description: 'This folder is not a Git repository.',
    suggestion: 'Run "git init" to initialize a repository.',
  },
  [ErrorCodes.GIT_COMMAND_FAILED]: {
    title: 'Git Command Failed',
    description: 'The Git command failed to execute.',
  },
  [ErrorCodes.GIT_MERGE_CONFLICT]: {
    title: 'Merge Conflict',
    description: 'There are merge conflicts that need to be resolved.',
  },

  [ErrorCodes.INDEX_NOT_INITIALIZED]: {
    title: 'Index Not Ready',
    description: 'The codebase index is not initialized.',
    suggestion: 'Wait for indexing to complete or trigger a re-index.',
  },
  [ErrorCodes.INDEX_EMBEDDING_ERROR]: {
    title: 'Embedding Error',
    description: 'Failed to generate embeddings.',
    suggestion: 'Check your embedding service configuration.',
  },
  [ErrorCodes.INDEX_SEARCH_ERROR]: {
    title: 'Search Error',
    description: 'Failed to search the codebase.',
  },
}

/** 兼容旧引用的别名 */
export const ERROR_MESSAGES = ERROR_TABLE

/** 获取错误描述 */
function describe(code: number): ErrorDescriptor {
  return ERROR_TABLE[code] ?? ERROR_TABLE[ErrorCodes.UNKNOWN]
}

/* ------------------------------------------------------------------ */
/* 异常对象                                                          */
/* ------------------------------------------------------------------ */

/** AppError 构造选项 */
export interface AppErrorOptions {
  details?: unknown
  retryable?: boolean
  cause?: Error
}

/** 应用统一异常 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown
  readonly retryable: boolean
  readonly timestamp: number

  constructor(code: ErrorCode, message?: string, options?: AppErrorOptions) {
    const descriptor = describe(code)
    super(message || descriptor.description)

    this.name = 'AppError'
    this.code = code
    this.details = options?.details
    this.retryable = options?.retryable ?? false
    this.timestamp = Date.now()

    if (options?.cause) {
      this.cause = options.cause
    }

    Object.setPrototypeOf(this, AppError.prototype)
  }

  /** 获取面向用户的错误信息 */
  getUserMessage(): ErrorDescriptor {
    const info = describe(this.code)
    return {
      title: info.title,
      description: this.message || info.description,
      suggestion: info.suggestion,
    }
  }

  /** 序列化为可传输对象 */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      timestamp: this.timestamp,
    }
  }

  /** 从任意错误转换为 AppError */
  static fromError(error: unknown, fallback: ErrorCode = ErrorCodes.UNKNOWN): AppError {
    if (error instanceof AppError) return error

    if (error instanceof Error) {
      const code = guessCode(error.message) ?? fallback
      return new AppError(code, error.message, { cause: error })
    }

    return new AppError(fallback, String(error))
  }
}

/* ------------------------------------------------------------------ */
/* 错误码推断                                                        */
/* ------------------------------------------------------------------ */

/** 推断规则：匹配关键字到错误码 */
interface InferenceRule {
  keywords: string[]
  code: ErrorCode
}

const INFERENCE_RULES: InferenceRule[] = [
  { keywords: ['network', 'econnrefused'], code: ErrorCodes.NETWORK_ERROR },
  { keywords: ['timeout', 'etimedout'], code: ErrorCodes.TIMEOUT },
  { keywords: ['dns', 'enotfound'], code: ErrorCodes.DNS_ERROR },
  { keywords: ['rate limit', '429'], code: ErrorCodes.LLM_RATE_LIMIT },
  { keywords: ['api key', 'unauthorized', '401'], code: ErrorCodes.LLM_INVALID_API_KEY },
  { keywords: ['quota', 'billing'], code: ErrorCodes.LLM_QUOTA_EXCEEDED },
  { keywords: ['context length', 'too long'], code: ErrorCodes.LLM_CONTEXT_LENGTH_EXCEEDED },
  { keywords: ['enoent', 'not found'], code: ErrorCodes.FILE_NOT_FOUND },
  { keywords: ['permission', 'eacces'], code: ErrorCodes.SECURITY_PERMISSION_DENIED },
  { keywords: ['whitelist', '白名单'], code: ErrorCodes.SECURITY_WHITELIST_BLOCKED },
]

/** 根据错误消息推断错误码 */
function guessCode(message: string): ErrorCode | null {
  const lower = message.toLowerCase()
  for (const rule of INFERENCE_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.code
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                          */
/* ------------------------------------------------------------------ */

/** 可重试错误码集合 */
const RETRYABLE_CODES = new Set<ErrorCode>([
  ErrorCodes.TIMEOUT,
  ErrorCodes.NETWORK_ERROR,
  ErrorCodes.LLM_RATE_LIMIT,
  ErrorCodes.CONNECTION_REFUSED,
])

/** 判断错误是否可重试 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable
  if (error instanceof Error) {
    const code = guessCode(error.message)
    return code !== null && RETRYABLE_CODES.has(code)
  }
  return false
}

/** 格式化错误为用户友好的字符串 */
export function formatErrorMessage(error: unknown): string {
  const appError = AppError.fromError(error)
  const { title, description, suggestion } = appError.getUserMessage()

  let message = `❌ ${title}: ${description}`
  if (suggestion) message += `\n💡 ${suggestion}`
  return message
}

/** 创建错误处理器 */
export function createErrorHandler(
  onError: (error: AppError) => void,
  options?: { rethrow?: boolean },
) {
  return (error: unknown) => {
    const appError = AppError.fromError(error)
    onError(appError)
    if (options?.rethrow) throw appError
  }
}
