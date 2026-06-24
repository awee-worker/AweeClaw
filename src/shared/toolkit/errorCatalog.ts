/**
 * 统一错误处理工具集
 *
 * 架构分层：
 * 1. 错误码定义 — 按领域分组的错误码枚举
 * 2. 错误类 — 标准化错误对象，支持序列化
 * 3. 错误描述表 — 多语言错误消息映射
 * 4. 系统错误分类器 — 将 Node.js 系统错误映射到错误码
 * 5. AI 提供商错误分类器 — 将 AI SDK 错误映射到错误码
 * 6. 错误包装器 — 将任意错误转换为标准化错误对象
 *
 * 提供类型安全的错误处理和用户友好的错误消息
 */

import {
  APICallError,
  NoContentGeneratedError,
  InvalidPromptError,
  InvalidResponseDataError,
  EmptyResponseBodyError,
  LoadAPIKeyError,
  NoSuchModelError,
  TypeValidationError,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider'

import {
  NoOutputGeneratedError,
  RetryError,
} from 'ai'

/* ================================================================== */
/* 第一层：错误码定义                                                  */
/* ================================================================== */

export enum ErrorCode {
  // 通用错误
  UNKNOWN = 'UNKNOWN',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  ABORTED = 'ABORTED',

  // 文件系统错误
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED',
  FILE_READ = 'FILE_READ',
  FILE_WRITE = 'FILE_WRITE',

  // API 错误
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_CALL_FAILED = 'API_CALL_FAILED',

  // LSP 错误
  LSP_NOT_INITIALIZED = 'LSP_NOT_INITIALIZED',
  LSP_REQUEST_FAILED = 'LSP_REQUEST_FAILED',

  // MCP 错误
  MCP_NOT_INITIALIZED = 'MCP_NOT_INITIALIZED',
  MCP_SERVER_ERROR = 'MCP_SERVER_ERROR',
  MCP_TOOL_ERROR = 'MCP_TOOL_ERROR',

  // LLM 错误
  LLM_NO_CONTENT = 'LLM_NO_CONTENT',
  LLM_NO_OUTPUT = 'LLM_NO_OUTPUT',
  LLM_INVALID_PROMPT = 'LLM_INVALID_PROMPT',
  LLM_INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
  LLM_EMPTY_RESPONSE = 'LLM_EMPTY_RESPONSE',
  LLM_NO_SUCH_MODEL = 'LLM_NO_SUCH_MODEL',
  LLM_VALIDATION_FAILED = 'LLM_VALIDATION_FAILED',
  LLM_UNSUPPORTED = 'LLM_UNSUPPORTED',
  LLM_QUOTA_EXCEEDED = 'LLM_QUOTA_EXCEEDED',

  // 后端 LLM 代理错误（来自后端 LlmProxyController）
  MODEL_NO_VISION = 'MODEL_NO_VISION',
  INVALID_API_KEY = 'INVALID_API_KEY',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  CONTEXT_TOO_LONG = 'CONTEXT_TOO_LONG',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  VISION_MODEL_FAILED = 'VISION_MODEL_FAILED',
}

/* ================================================================== */
/* 第二层：标准化错误类                                                */
/* ================================================================== */

/**
 * 标准化操作错误
 *
 * 封装错误码、可重试标记和原始详情，支持 JSON 序列化
 */
export class OperationError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean = false,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'OperationError'
    Error.captureStackTrace?.(this, OperationError)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

/* ================================================================== */
/* 第三层：错误描述表                                                  */
/* ================================================================== */

type LocalizedDescription = { en: string; zh: string }

const ERROR_DESCRIPTIONS: Record<ErrorCode, LocalizedDescription> = {
  [ErrorCode.UNKNOWN]: {
    en: 'An unexpected error occurred',
    zh: '发生了未知错误'
  },
  [ErrorCode.NETWORK]: {
    en: 'Network error. Please check your connection',
    zh: '网络错误，请检查网络连接'
  },
  [ErrorCode.TIMEOUT]: {
    en: 'Request timed out',
    zh: '请求超时'
  },
  [ErrorCode.ABORTED]: {
    en: 'Request was cancelled',
    zh: '请求已取消'
  },
  [ErrorCode.FILE_NOT_FOUND]: {
    en: 'File not found',
    zh: '文件不存在'
  },
  [ErrorCode.FILE_ACCESS_DENIED]: {
    en: 'Permission denied',
    zh: '没有权限访问'
  },
  [ErrorCode.FILE_READ]: {
    en: 'Failed to read file',
    zh: '读取文件失败'
  },
  [ErrorCode.FILE_WRITE]: {
    en: 'Failed to write file',
    zh: '写入文件失败'
  },
  [ErrorCode.API_KEY_INVALID]: {
    en: 'Invalid API key',
    zh: 'API Key 无效'
  },
  [ErrorCode.API_RATE_LIMIT]: {
    en: 'Rate limit exceeded',
    zh: 'API 请求频率超限'
  },
  [ErrorCode.API_CALL_FAILED]: {
    en: 'API call failed',
    zh: 'API 调用失败'
  },
  [ErrorCode.LSP_NOT_INITIALIZED]: {
    en: 'Language server not initialized',
    zh: '语言服务器未初始化'
  },
  [ErrorCode.LSP_REQUEST_FAILED]: {
    en: 'Language server request failed',
    zh: '语言服务器请求失败'
  },
  [ErrorCode.MCP_NOT_INITIALIZED]: {
    en: 'MCP not initialized',
    zh: 'MCP 未初始化'
  },
  [ErrorCode.MCP_SERVER_ERROR]: {
    en: 'MCP server error',
    zh: 'MCP 服务器错误'
  },
  [ErrorCode.MCP_TOOL_ERROR]: {
    en: 'MCP tool execution failed',
    zh: 'MCP 工具执行失败'
  },
  [ErrorCode.LLM_NO_CONTENT]: {
    en: 'Model did not generate any content',
    zh: '模型未生成任何内容'
  },
  [ErrorCode.LLM_NO_OUTPUT]: {
    en: 'No output was generated',
    zh: '未生成输出'
  },
  [ErrorCode.LLM_INVALID_PROMPT]: {
    en: 'Invalid prompt format',
    zh: '提示词格式无效'
  },
  [ErrorCode.LLM_INVALID_RESPONSE]: {
    en: 'Invalid response from model',
    zh: '模型响应格式无效'
  },
  [ErrorCode.LLM_EMPTY_RESPONSE]: {
    en: 'Empty response from model',
    zh: '模型返回空响应'
  },
  [ErrorCode.LLM_NO_SUCH_MODEL]: {
    en: 'Model not found',
    zh: '模型不存在'
  },
  [ErrorCode.LLM_VALIDATION_FAILED]: {
    en: 'Response validation failed',
    zh: '响应验证失败'
  },
  [ErrorCode.LLM_UNSUPPORTED]: {
    en: 'Functionality not supported',
    zh: '功能不支持'
  },
  [ErrorCode.LLM_QUOTA_EXCEEDED]: {
    en: 'Token quota exceeded. Please upgrade your plan or wait for the next billing cycle.',
    zh: 'Token 配额已用完，请升级套餐或等待下个计费周期'
  },
  [ErrorCode.MODEL_NO_VISION]: {
    en: 'The current model does not support image recognition. The system will automatically route the image to a vision model for analysis.',
    zh: '当前模型不支持图片识别，系统将自动使用视觉模型分析图片'
  },
  [ErrorCode.INVALID_API_KEY]: {
    en: 'API Key is invalid or expired. Please update the provider API Key in the admin panel.',
    zh: 'API Key 无效或已过期，请前往后台管理更新模型服务商的 API Key'
  },
  [ErrorCode.PROVIDER_UNAVAILABLE]: {
    en: 'AI service provider is temporarily unavailable. Please try again later or switch to another provider.',
    zh: 'AI 服务商暂时不可用，请稍后重试或切换其他服务商'
  },
  [ErrorCode.CONTEXT_TOO_LONG]: {
    en: 'Conversation is too long. Try reducing images, shortening history, or starting a new chat.',
    zh: '对话内容过长，请尝试减少图片数量、缩短对话历史或开启新对话'
  },
  [ErrorCode.MODEL_NOT_FOUND]: {
    en: 'The requested model was not found or has been discontinued.',
    zh: '模型不存在或已下线，请前往后台管理更换其他可用模型'
  },
  [ErrorCode.RATE_LIMITED]: {
    en: 'Request rate limit exceeded. Please wait a moment and try again.',
    zh: '请求频率过高，请稍后重试'
  },
  [ErrorCode.VISION_MODEL_FAILED]: {
    en: 'Vision model failed to process the image. Please check the vision model configuration.',
    zh: '视觉模型分析图片失败，请检查视觉模型配置'
  },
}

/**
 * 根据错误码解析本地化描述
 */
export function resolveErrorDescription(code: ErrorCode, language: 'en' | 'zh' = 'en'): string {
  return ERROR_DESCRIPTIONS[code]?.[language] || ERROR_DESCRIPTIONS[ErrorCode.UNKNOWN][language]
}

/* ================================================================== */
/* 第四层：系统错误分类器                                              */
/* ================================================================== */

interface ErrorClassification {
  code: ErrorCode
  originalMessage: string
  retryable: boolean
}

/** Node.js errno 到错误码的映射 */
const SYSTEM_ERROR_MAP: Record<string, ErrorClassification> = {
  ENOENT: { code: ErrorCode.FILE_NOT_FOUND, originalMessage: '', retryable: false },
  EACCES: { code: ErrorCode.FILE_ACCESS_DENIED, originalMessage: '', retryable: false },
  EPERM: { code: ErrorCode.FILE_ACCESS_DENIED, originalMessage: '', retryable: false },
  ETIMEDOUT: { code: ErrorCode.TIMEOUT, originalMessage: '', retryable: true },
  ESOCKETTIMEDOUT: { code: ErrorCode.TIMEOUT, originalMessage: '', retryable: true },
  ECONNREFUSED: { code: ErrorCode.NETWORK, originalMessage: '', retryable: true },
  ENOTFOUND: { code: ErrorCode.NETWORK, originalMessage: '', retryable: true },
  ENETUNREACH: { code: ErrorCode.NETWORK, originalMessage: '', retryable: true },
}

/**
 * 将 Node.js 系统错误分类为标准错误码
 *
 * 返回错误码和原始消息（用于日志），不返回友好消息
 */
export function classifySystemError(error: NodeJS.ErrnoException): ErrorClassification {
  const errno = error.code || ''
  const originalMessage = error.message

  const mapped = SYSTEM_ERROR_MAP[errno]
  if (mapped) {
    return { ...mapped, originalMessage }
  }

  return {
    code: ErrorCode.UNKNOWN,
    originalMessage: originalMessage || 'System error',
    retryable: false,
  }
}

/* ================================================================== */
/* 第五层：AI 提供商错误分类器                                         */
/* ================================================================== */

interface AIErrorClassification extends ErrorClassification {
  suggestion?: string
}

/** 后端错误码到标准错误码的映射 */
const BACKEND_CODE_MAP: Record<string, ErrorCode> = {
  'MODEL_NO_VISION': ErrorCode.MODEL_NO_VISION,
  'INVALID_API_KEY': ErrorCode.INVALID_API_KEY,
  'QUOTA_EXCEEDED': ErrorCode.LLM_QUOTA_EXCEEDED,
  'RATE_LIMITED': ErrorCode.RATE_LIMITED,
  'CONTEXT_TOO_LONG': ErrorCode.CONTEXT_TOO_LONG,
  'MODEL_NOT_FOUND': ErrorCode.MODEL_NOT_FOUND,
  'PROVIDER_UNAVAILABLE': ErrorCode.PROVIDER_UNAVAILABLE,
  'VISION_MODEL_FAILED': ErrorCode.VISION_MODEL_FAILED,
  'LLM_API_ERROR': ErrorCode.API_CALL_FAILED,
}

/** 可重试的后端错误码 */
const RETRYABLE_BACKEND_CODES = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'])

/**
 * 从 HTTP 响应体中提取后端错误信息
 */
function extractBackendErrorInfo(
  responseBody: string | undefined,
  fallbackMessage: string
): { detailMessage: string; backendCode?: string; backendSuggestion?: string } {
  if (!responseBody || typeof responseBody !== 'string') {
    return { detailMessage: fallbackMessage }
  }

  try {
    const body = JSON.parse(responseBody)
    // 后端 LlmProxyController 返回格式: { error: { message, code, suggestion } }
    if (body.error && typeof body.error === 'object') {
      return {
        detailMessage: body.error.message || fallbackMessage,
        backendCode: body.error.code,
        backendSuggestion: body.error.suggestion,
      }
    }
    if (body.detail) {
      return { detailMessage: `${fallbackMessage}: ${body.detail}` }
    }
    if (body.message) {
      return { detailMessage: `${fallbackMessage}: ${body.message}` }
    }
  } catch {
    // JSON 解析失败，使用原始消息
  }
  return { detailMessage: fallbackMessage }
}

/**
 * 根据 HTTP 状态码分类 API 调用错误
 */
function classifyByStatusCode(
  statusCode: number,
  detailMessage: string,
  responseBody: string | undefined,
  isRetryable: boolean
): AIErrorClassification {
  if (statusCode === 429) {
    const isQuotaExceeded =
      detailMessage.toLowerCase().includes('quota') ||
      (typeof responseBody === 'string' && responseBody.includes('QUOTA_EXCEEDED'))
    if (isQuotaExceeded) {
      return {
        code: ErrorCode.LLM_QUOTA_EXCEEDED,
        originalMessage: detailMessage,
        retryable: false,
      }
    }
    return {
      code: ErrorCode.API_RATE_LIMIT,
      originalMessage: detailMessage,
      retryable: true,
    }
  }
  if (statusCode === 401 || statusCode === 403) {
    return {
      code: ErrorCode.API_KEY_INVALID,
      originalMessage: detailMessage,
      retryable: false,
    }
  }
  return {
    code: ErrorCode.API_CALL_FAILED,
    originalMessage: detailMessage,
    retryable: isRetryable,
  }
}

/** AI SDK 错误类型到错误码的映射（使用 isInstance 检测） */
interface SDKErrorMatcher {
  detect: (error: Error) => boolean
  classify: (error: Error, message: string) => AIErrorClassification
}

const SDK_ERROR_MATCHERS: SDKErrorMatcher[] = [
  {
    detect: (e) => NoOutputGeneratedError.isInstance(e),
    classify: (_e, message) => {
      const cause = (_e as NoOutputGeneratedError & { cause?: unknown }).cause
      if (cause && cause instanceof Error) {
        return classifyAIProviderError(cause)
      }
      return { code: ErrorCode.LLM_NO_OUTPUT, originalMessage: message, retryable: true }
    },
  },
  {
    detect: (e) => RetryError.isInstance(e),
    classify: (e, message) => {
      const lastError = (e as RetryError).lastError
      if (lastError) {
        return classifyAIProviderError(lastError)
      }
      return { code: ErrorCode.UNKNOWN, originalMessage: message, retryable: false }
    },
  },
  {
    detect: (e) => NoContentGeneratedError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_NO_CONTENT, originalMessage: message, retryable: true }),
  },
  {
    detect: (e) => APICallError.isInstance(e),
    classify: (e, message) => {
      const apiError = e as APICallError
      const { detailMessage, backendCode, backendSuggestion } = extractBackendErrorInfo(
        apiError.responseBody,
        message
      )

      if (backendCode) {
        const mappedCode = BACKEND_CODE_MAP[backendCode] || ErrorCode.API_CALL_FAILED
        return {
          code: mappedCode,
          originalMessage: detailMessage,
          retryable: RETRYABLE_BACKEND_CODES.has(backendCode),
          suggestion: backendSuggestion,
        }
      }

      const statusCode = apiError.statusCode
      if (typeof statusCode !== 'number') {
        return {
          code: ErrorCode.API_CALL_FAILED,
          originalMessage: detailMessage,
          retryable: apiError.isRetryable ?? true,
        }
      }

      return classifyByStatusCode(
        statusCode,
        detailMessage,
        apiError.responseBody,
        apiError.isRetryable ?? true
      )
    },
  },
  {
    detect: (e) => InvalidPromptError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_INVALID_PROMPT, originalMessage: message, retryable: false }),
  },
  {
    detect: (e) => InvalidResponseDataError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_INVALID_RESPONSE, originalMessage: message, retryable: true }),
  },
  {
    detect: (e) => EmptyResponseBodyError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_EMPTY_RESPONSE, originalMessage: message, retryable: true }),
  },
  {
    detect: (e) => LoadAPIKeyError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.API_KEY_INVALID, originalMessage: message, retryable: false }),
  },
  {
    detect: (e) => NoSuchModelError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_NO_SUCH_MODEL, originalMessage: message, retryable: false }),
  },
  {
    detect: (e) => TypeValidationError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_VALIDATION_FAILED, originalMessage: message, retryable: false }),
  },
  {
    detect: (e) => UnsupportedFunctionalityError.isInstance(e),
    classify: (_e, message) => ({ code: ErrorCode.LLM_UNSUPPORTED, originalMessage: message, retryable: false }),
  },
]

/** 消息关键词到错误码的启发式映射 */
const MESSAGE_KEYWORD_MAP: Array<{ keywords: string[]; classification: ErrorClassification }> = [
  {
    keywords: ['network', 'fetch', 'econnrefused'],
    classification: { code: ErrorCode.NETWORK, originalMessage: '', retryable: true },
  },
  {
    keywords: ['terminated', 'socket hang up', 'other side closed', 'connection closed'],
    classification: { code: ErrorCode.NETWORK, originalMessage: '', retryable: true },
  },
  {
    keywords: ['timeout'],
    classification: { code: ErrorCode.TIMEOUT, originalMessage: '', retryable: true },
  },
]

/**
 * 将 AI SDK 错误分类为标准错误码
 *
 * 使用类型安全的 isInstance 方法，返回错误码和原始错误消息（用于日志）
 */
export function classifyAIProviderError(error: unknown): AIErrorClassification {
  // 确保是 Error 对象
  if (!(error instanceof Error)) {
    return {
      code: ErrorCode.UNKNOWN,
      originalMessage: String(error),
      retryable: false,
    }
  }

  const originalMessage = error.message

  // AbortError (标准 DOM 错误)
  if (error.name === 'AbortError') {
    return {
      code: ErrorCode.ABORTED,
      originalMessage,
      retryable: false,
    }
  }

  // 使用策略匹配器检测 AI SDK 错误类型
  for (const matcher of SDK_ERROR_MATCHERS) {
    if (matcher.detect(error)) {
      return matcher.classify(error, originalMessage)
    }
  }

  // 兜底：按 error.name 识别（兼容非 SDK 实例，如测试或 RPC 序列化后的错误）
  if (error.name === 'NoContentGeneratedError') {
    return { code: ErrorCode.LLM_NO_CONTENT, originalMessage, retryable: true }
  }
  const statusCode = (error as Error & { statusCode?: number }).statusCode
  if (error.name === 'APICallError' && typeof statusCode === 'number') {
    return classifyByStatusCode(statusCode, originalMessage, undefined, (error as Error & { isRetryable?: boolean }).isRetryable ?? true)
  }

  // 消息关键词启发式分析
  const msg = originalMessage.toLowerCase()
  for (const entry of MESSAGE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => msg === kw || msg.includes(kw))) {
      return { ...entry.classification, originalMessage } as ErrorClassification
    }
  }

  // 未知错误
  return {
    code: ErrorCode.UNKNOWN,
    originalMessage,
    retryable: false,
  }
}

/* ================================================================== */
/* 第六层：错误包装器                                                  */
/* ================================================================== */

/**
 * 将任意错误包装为标准化操作错误
 *
 * 使用友好消息（前端可根据用户语言转换）
 */
export function wrapAsOperationError(error: unknown, language: 'en' | 'zh' = 'en'): OperationError {
  if (error instanceof OperationError) {
    return error
  }

  if (error instanceof Error) {
    // 尝试进行启发式分析 (包含对 fetch, network, timeout 等关键词的识别)
    const classified = classifyAIProviderError(error)
    if (classified.code !== ErrorCode.UNKNOWN) {
      const friendlyMessage = resolveErrorDescription(classified.code, language)
      return new OperationError(friendlyMessage, classified.code, classified.retryable, error)
    }

    // Node.js 系统错误 (如果有 code 且启发式分析未捕获)
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code) {
      const nodeClassified = classifySystemError(nodeError)
      const friendlyMessage = resolveErrorDescription(nodeClassified.code, language)
      return new OperationError(friendlyMessage, nodeClassified.code, nodeClassified.retryable, error)
    }

    // 普通 Error：保留原始消息便于排查
    return new OperationError(error.message, ErrorCode.UNKNOWN, false, error)
  }

  if (typeof error === 'string') {
    return new OperationError(error, ErrorCode.UNKNOWN, false)
  }

  const friendlyMessage = resolveErrorDescription(ErrorCode.UNKNOWN, language)
  return new OperationError(friendlyMessage, ErrorCode.UNKNOWN, false, error)
}

/* ================================================================== */
/* 向后兼容别名（供逐步迁移使用）                                      */
/* ================================================================== */

export const AppError = OperationError
export const getErrorMessage = resolveErrorDescription
export const mapNodeError = classifySystemError
export const mapAISDKError = classifyAIProviderError
export const toAppError = wrapAsOperationError
