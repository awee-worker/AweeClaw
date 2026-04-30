/**
 * 错误处理模块测试
 */

import { describe, it, expect } from 'vitest'
import {
  AppError,
  ErrorCode,
  formatErrorMessage,
  isRetryableError,
} from '@shared/errors'

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create basic error', () => {
      const error = new AppError(ErrorCode.UNKNOWN, 'Test error')
      expect(error.message).toBe('Test error')
      expect(error.name).toBe('AppError')
      expect(error.code).toBe(ErrorCode.UNKNOWN)
    })

    it('should create error with code', () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR)
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(error.message).toBeTruthy()
    })

    it('should create error with details', () => {
      const error = new AppError(ErrorCode.UNKNOWN, 'Test error', { details: { foo: 'bar' } })
      expect(error.details).toEqual({ foo: 'bar' })
    })

    it('should create file error', () => {
      const error = new AppError(ErrorCode.FILE_NOT_FOUND, 'File not found', {
        details: { filePath: '/path/to/file' },
      })
      expect(error.message).toBe('File not found')
      expect(error.code).toBe(ErrorCode.FILE_NOT_FOUND)
    })

    it('should create LLM error', () => {
      const error = new AppError(ErrorCode.LLM_API_ERROR, 'API error', {
        details: { provider: 'openai' },
      })
      expect(error.message).toBe('API error')
      expect(error.code).toBe(ErrorCode.LLM_API_ERROR)
    })

    it('should create tool error', () => {
      const error = new AppError(ErrorCode.TOOL_EXECUTION_ERROR, 'Execution failed', {
        details: { toolName: 'read_file' },
      })
      expect(error.message).toBe('Execution failed')
      expect(error.code).toBe(ErrorCode.TOOL_EXECUTION_ERROR)
    })

    it('should create validation error', () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid input', {
        details: { field: 'username' },
      })
      expect(error.message).toBe('Invalid input')
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('should create network error', () => {
      const error = new AppError(ErrorCode.NETWORK_ERROR, 'Connection failed', {
        details: { url: 'https://api.example.com' },
      })
      expect(error.message).toBe('Connection failed')
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
    })

    it('should create security error', () => {
      const error = new AppError(ErrorCode.SECURITY_PERMISSION_DENIED, 'Access denied')
      expect(error.message).toBe('Access denied')
      expect(error.code).toBe(ErrorCode.SECURITY_PERMISSION_DENIED)
    })

    it('should identify AppError', () => {
      const error = new AppError(ErrorCode.UNKNOWN, 'Test')
      expect(error).toBeInstanceOf(AppError)
      expect(error.name).toBe('AppError')
    })

    it('should identify FileError as AppError', () => {
      const error = new AppError(ErrorCode.FILE_NOT_FOUND, 'Test', {
        details: { filePath: '/path' },
      })
      expect(error).toBeInstanceOf(AppError)
    })

    it('should reject regular Error', () => {
      const error = new Error('Test')
      expect(error).not.toBeInstanceOf(AppError)
    })

    it('should reject non-error objects', () => {
      expect({}).not.toBeInstanceOf(AppError)
      expect(null).not.toBeInstanceOf(AppError)
      expect(undefined).not.toBeInstanceOf(AppError)
    })
  })
})

describe('Error Utilities', () => {
  describe('AppError.fromError', () => {
    it('should format AppError', () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR, 'Test error')
      const formatted = formatErrorMessage(error)
      expect(formatted).toContain('Test error')
      expect(formatted).toContain('❌')
    })

    it('should format regular Error', () => {
      const error = new Error('Test error')
      const formatted = formatErrorMessage(error)
      expect(formatted).toContain('Test error')
    })

    it('should format string', () => {
      const formatted = formatErrorMessage('Test error')
      expect(formatted).toContain('Test error')
    })

    it('should format unknown type', () => {
      const formatted = formatErrorMessage({ foo: 'bar' })
      expect(formatted).toBeTruthy()
    })

    it('should pass through AppError', () => {
      const original = new AppError(ErrorCode.UNKNOWN, 'Test')
      const result = AppError.fromError(original)
      expect(result).toBe(original)
    })

    it('should wrap regular Error', () => {
      const original = new Error('Test')
      const result = AppError.fromError(original)
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('Test')
    })

    it('should create error from string', () => {
      const result = AppError.fromError('Test error')
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toBe('Test error')
    })

    it('should create error from unknown type', () => {
      const result = AppError.fromError({ foo: 'bar' })
      expect(result).toBeInstanceOf(AppError)
      expect(result.message).toContain('[object Object]')
    })
  })

  describe('isRetryableError', () => {
    it('should identify retryable errors', () => {
      const error = new AppError(ErrorCode.TIMEOUT, 'Timeout', { retryable: true })
      expect(isRetryableError(error)).toBe(true)
    })

    it('should identify non-retryable errors', () => {
      const error = new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid')
      expect(isRetryableError(error)).toBe(false)
    })

    it('should infer retryable from error message', () => {
      const error = new Error('Network timeout')
      expect(isRetryableError(error)).toBe(true)
    })
  })
})
