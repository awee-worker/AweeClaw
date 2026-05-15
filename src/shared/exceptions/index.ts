/**
 * 统一错误处理模块
 * 定义错误码、错误类型和用户友好提示
 */

// ===== 错误码定义 =====

export enum ErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN = 1000,
  VALIDATION_ERROR = 1001,
  TIMEOUT = 1002,
  ABORTED = 1003,

  // 文件系统错误 (2xxx)
  FILE_NOT_FOUND = 2001,
  FILE_READ_ERROR = 2002,
  FILE_WRITE_ERROR = 2003,
  FILE_DELETE_ERROR = 2004,
  DIRECTORY_NOT_FOUND = 2005,
  PATH_OUTSIDE_WORKSPACE = 2006,
  SENSITIVE_PATH = 2007,

  // 网络错误 (3xxx)
  NETWORK_ERROR = 3001,
  CONNECTION_REFUSED = 3002,
  DNS_ERROR = 3003,
  SSL_ERROR = 3004,

  // LLM 错误 (4xxx)
  LLM_API_ERROR = 4001,
  LLM_RATE_LIMIT = 4002,
  LLM_QUOTA_EXCEEDED = 4003,
  LLM_INVALID_API_KEY = 4004,
  LLM_MODEL_NOT_FOUND = 4005,
  LLM_CONTEXT_LENGTH_EXCEEDED = 4006,
  LLM_INVALID_REQUEST = 4007,

  // 工具执行错误 (5xxx)
  TOOL_NOT_FOUND = 5001,
  TOOL_VALIDATION_ERROR = 5002,
  TOOL_EXECUTION_ERROR = 5003,
  TOOL_TIMEOUT = 5004,
  TOOL_REJECTED = 5005,

  // 安全错误 (6xxx)
  SECURITY_PERMISSION_DENIED = 6001,
  SECURITY_WHITELIST_BLOCKED = 6002,
  SECURITY_WORKSPACE_VIOLATION = 6003,

  // Git 错误 (7xxx)
  GIT_NOT_INITIALIZED = 7001,
  GIT_COMMAND_FAILED = 7002,
  GIT_MERGE_CONFLICT = 7003,

  // 索引错误 (8xxx)
  INDEX_NOT_INITIALIZED = 8001,
  INDEX_EMBEDDING_ERROR = 8002,
  INDEX_SEARCH_ERROR = 8003,
}

// ===== 错误消息映射 =====

export const ERROR_MESSAGES: Record<ErrorCode, { title: string; description: string; suggestion?: string }> = {
  // 通用错误
  [ErrorCode.UNKNOWN]: {
    title: 'Unknown Error',
    description: 'An unexpected error occurred.',
    suggestion: 'Please try again or restart the application.',
  },
  [ErrorCode.VALIDATION_ERROR]: {
    title: 'Validation Error',
    description: 'The provided input is invalid.',
  },
  [ErrorCode.TIMEOUT]: {
    title: 'Operation Timeout',
    description: 'The operation took too long to complete.',
    suggestion: 'Try again or check your network connection.',
  },
  [ErrorCode.ABORTED]: {
    title: 'Operation Aborted',
    description: 'The operation was cancelled.',
  },

  // 文件系统错误
  [ErrorCode.FILE_NOT_FOUND]: {
    title: 'File Not Found',
    description: 'The specified file does not exist.',
  },
  [ErrorCode.FILE_READ_ERROR]: {
    title: 'File Read Error',
    description: 'Failed to read the file.',
    suggestion: 'Check file permissions and try again.',
  },
  [ErrorCode.FILE_WRITE_ERROR]: {
    title: 'File Write Error',
    description: 'Failed to write to the file.',
    suggestion: 'Check file permissions and disk space.',
  },
  [ErrorCode.FILE_DELETE_ERROR]: {
    title: 'File Delete Error',
    description: 'Failed to delete the file.',
  },
  [ErrorCode.DIRECTORY_NOT_FOUND]: {
    title: 'Directory Not Found',
    description: 'The specified directory does not exist.',
  },
  [ErrorCode.PATH_OUTSIDE_WORKSPACE]: {
    title: 'Path Outside Workspace',
    description: 'The path is outside the current workspace.',
    suggestion: 'Only files within the workspace can be accessed.',
  },
  [ErrorCode.SENSITIVE_PATH]: {
    title: 'Sensitive Path',
    description: 'Access to this path is restricted for security reasons.',
  },

  // 网络错误
  [ErrorCode.NETWORK_ERROR]: {
    title: 'Network Error',
    description: 'A network error occurred.',
    suggestion: 'Check your internet connection.',
  },
  [ErrorCode.CONNECTION_REFUSED]: {
    title: 'Connection Refused',
    description: 'The server refused the connection.',
    suggestion: 'Check if the server is running and accessible.',
  },
  [ErrorCode.DNS_ERROR]: {
    title: 'DNS Error',
    description: 'Failed to resolve the server address.',
    suggestion: 'Check your DNS settings or try again later.',
  },
  [ErrorCode.SSL_ERROR]: {
    title: 'SSL Error',
    description: 'SSL/TLS connection failed.',
    suggestion: 'Check your SSL certificates or try disabling SSL verification.',
  },

  // LLM 错误
  [ErrorCode.LLM_API_ERROR]: {
    title: 'API Error',
    description: 'The LLM API returned an error.',
  },
  [ErrorCode.LLM_RATE_LIMIT]: {
    title: 'Rate Limited',
    description: 'Too many requests. Please wait before trying again.',
    suggestion: 'Wait a few seconds and try again.',
  },
  [ErrorCode.LLM_QUOTA_EXCEEDED]: {
    title: 'Quota Exceeded',
    description: 'Your API quota has been exceeded.',
    suggestion: 'Check your API usage and billing.',
  },
  [ErrorCode.LLM_INVALID_API_KEY]: {
    title: 'Invalid API Key',
    description: 'The API key is invalid or expired.',
    suggestion: 'Check your API key in Settings > Provider.',
  },
  [ErrorCode.LLM_MODEL_NOT_FOUND]: {
    title: 'Model Not Found',
    description: 'The specified model does not exist.',
    suggestion: 'Check the model name or select a different model.',
  },
  [ErrorCode.LLM_CONTEXT_LENGTH_EXCEEDED]: {
    title: 'Context Too Long',
    description: 'The conversation is too long for the model.',
    suggestion: 'Start a new conversation or use a model with larger context.',
  },
  [ErrorCode.LLM_INVALID_REQUEST]: {
    title: 'Invalid Request',
    description: 'The request to the LLM was invalid.',
  },

  // 工具执行错误
  [ErrorCode.TOOL_NOT_FOUND]: {
    title: 'Tool Not Found',
    description: 'The specified tool does not exist.',
  },
  [ErrorCode.TOOL_VALIDATION_ERROR]: {
    title: 'Tool Validation Error',
    description: 'The tool parameters are invalid.',
  },
  [ErrorCode.TOOL_EXECUTION_ERROR]: {
    title: 'Tool Execution Error',
    description: 'The tool failed to execute.',
  },
  [ErrorCode.TOOL_TIMEOUT]: {
    title: 'Tool Timeout',
    description: 'The tool execution timed out.',
    suggestion: 'Try again or increase the timeout.',
  },
  [ErrorCode.TOOL_REJECTED]: {
    title: 'Tool Rejected',
    description: 'The tool execution was rejected by the user.',
  },

  // 安全错误
  [ErrorCode.SECURITY_PERMISSION_DENIED]: {
    title: 'Permission Denied',
    description: 'You do not have permission to perform this action.',
  },
  [ErrorCode.SECURITY_WHITELIST_BLOCKED]: {
    title: 'Command Blocked',
    description: 'This command is not in the whitelist.',
    suggestion: 'Add the command to Settings > Security > Shell Command Whitelist.',
  },
  [ErrorCode.SECURITY_WORKSPACE_VIOLATION]: {
    title: 'Workspace Violation',
    description: 'This operation violates workspace security boundaries.',
  },

  // Git 错误
  [ErrorCode.GIT_NOT_INITIALIZED]: {
    title: 'Git Not Initialized',
    description: 'This folder is not a Git repository.',
    suggestion: 'Run "git init" to initialize a repository.',
  },
  [ErrorCode.GIT_COMMAND_FAILED]: {
    title: 'Git Command Failed',
    description: 'The Git command failed to execute.',
  },
  [ErrorCode.GIT_MERGE_CONFLICT]: {
    title: 'Merge Conflict',
    description: 'There are merge conflicts that need to be resolved.',
  },

  // 索引错误
  [ErrorCode.INDEX_NOT_INITIALIZED]: {
    title: 'Index Not Ready',
    description: 'The codebase index is not initialized.',
    suggestion: 'Wait for indexing to complete or trigger a re-index.',
  },
  [ErrorCode.INDEX_EMBEDDING_ERROR]: {
    title: 'Embedding Error',
    description: 'Failed to generate embeddings.',
    suggestion: 'Check your embedding service configuration.',
  },
  [ErrorCode.INDEX_SEARCH_ERROR]: {
    title: 'Search Error',
    description: 'Failed to search the codebase.',
  },
}

// ===== 自定义错误类 =====

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly details?: unknown
  public readonly retryable: boolean
  public readonly timestamp: number

  constructor(
    code: ErrorCode,
    message?: string,
    options?: {
      details?: unknown
      retryable?: boolean
      cause?: Error
    }
  ) {
    const errorInfo = ERROR_MESSAGES[code] || ERROR_MESSAGES[ErrorCode.UNKNOWN]
    super(message || errorInfo.description)

    this.name = 'AppError'
    this.code = code
    this.details = options?.details
    this.retryable = options?.retryable ?? false
    this.timestamp = Date.now()

    if (options?.cause) {
      this.cause = options.cause
    }

    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * 获取用户友好的错误信息
   */
  getUserMessage(): { title: string; description: string; suggestion?: string } {
    const info = ERROR_MESSAGES[this.code] || ERROR_MESSAGES[ErrorCode.UNKNOWN]
    return {
      title: info.title,
      description: this.message || info.description,
      suggestion: info.suggestion,
    }
  }

  /**
   * 转换为可序列化的对象
   */
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

  /**
   * 从普通错误创建 AppError
   */
  static fromError(error: unknown, defaultCode: ErrorCode = ErrorCode.UNKNOWN): AppError {
    if (error instanceof AppError) {
      return error
    }

    if (error instanceof Error) {
      // 尝试从错误消息推断错误码
      const code = inferErrorCode(error.message) || defaultCode
      return new AppError(code, error.message, { cause: error })
    }

    return new AppError(defaultCode, String(error))
  }
}

// ===== 错误码推断 =====

function inferErrorCode(message: string): ErrorCode | null {
  const lowerMessage = message.toLowerCase()

  // 网络错误
  if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused')) {
    return ErrorCode.NETWORK_ERROR
  }
  if (lowerMessage.includes('timeout') || lowerMessage.includes('etimedout')) {
    return ErrorCode.TIMEOUT
  }
  if (lowerMessage.includes('dns') || lowerMessage.includes('enotfound')) {
    return ErrorCode.DNS_ERROR
  }

  // LLM 错误
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return ErrorCode.LLM_RATE_LIMIT
  }
  if (lowerMessage.includes('api key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
    return ErrorCode.LLM_INVALID_API_KEY
  }
  if (lowerMessage.includes('quota') || lowerMessage.includes('billing')) {
    return ErrorCode.LLM_QUOTA_EXCEEDED
  }
  if (lowerMessage.includes('context length') || lowerMessage.includes('too long')) {
    return ErrorCode.LLM_CONTEXT_LENGTH_EXCEEDED
  }

  // 文件错误
  if (lowerMessage.includes('enoent') || lowerMessage.includes('not found')) {
    return ErrorCode.FILE_NOT_FOUND
  }
  if (lowerMessage.includes('permission') || lowerMessage.includes('eacces')) {
    return ErrorCode.SECURITY_PERMISSION_DENIED
  }
  if (lowerMessage.includes('whitelist') || lowerMessage.includes('白名单')) {
    return ErrorCode.SECURITY_WHITELIST_BLOCKED
  }

  return null
}

// ===== 错误处理工具函数 =====

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable
  }

  const retryableCodes = [
    ErrorCode.TIMEOUT,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.LLM_RATE_LIMIT,
    ErrorCode.CONNECTION_REFUSED,
  ]

  if (error instanceof Error) {
    const inferred = inferErrorCode(error.message)
    return inferred !== null && retryableCodes.includes(inferred)
  }

  return false
}

/**
 * 格式化错误为用户友好的字符串
 */
export function formatErrorMessage(error: unknown): string {
  const appError = AppError.fromError(error)
  const { title, description, suggestion } = appError.getUserMessage()

  let message = `❌ ${title}: ${description}`
  if (suggestion) {
    message += `\n💡 ${suggestion}`
  }

  return message
}

/**
 * 创建错误处理器
 */
export function createErrorHandler(
  onError: (error: AppError) => void,
  options?: { rethrow?: boolean }
) {
  return (error: unknown) => {
    const appError = AppError.fromError(error)
    onError(appError)

    if (options?.rethrow) {
      throw appError
    }
  }
}
