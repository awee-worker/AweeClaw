/**
 * Property-Based Tests for CompletionService
 * **Feature: aweeclaw-enhancement, Property 3: Context includes required fields**
 * **Validates: Requirements 1.5**
 * 
 * Tests that completion context always contains required fields:
 * filePath, fileContent, cursorPosition, and openFiles
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fc from 'fast-check'
import {
  CompletionContext,
  Position,
  completionService
} from '@services/completionService'

// Mock the store for testing
const mockStore = {
  openFiles: [] as Array<{ path: string; content: string; isDirty: boolean }>,
  activeFilePath: null as string | null,
  llmConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' }
}

// Mock useStore
vi.mock('../../src/renderer/store', () => ({
  useStore: {
    getState: () => mockStore
  }
}))

describe('CompletionService Property Tests', () => {
  beforeEach(() => {
    mockStore.openFiles = []
    mockStore.activeFilePath = null
  })

  /**
   * Property 3: Context includes required fields
   * For any completion request, the context object SHALL contain
   * filePath, fileContent, cursorPosition, and openFiles.
   */
  it('Property 3: buildContext always includes required fields', () => {
    // Reserved property names to exclude from generated strings
    const reservedNames = ['constructor', 'prototype', '__proto__', 'toString', 'valueOf']
    
    fc.assert(
      fc.property(
        // Generate arbitrary file paths (excluding reserved names)
        fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.length > 0 && !reservedNames.includes(s)),
        // Generate arbitrary file content
        fc.string({ minLength: 0, maxLength: 10000 }),

        // Generate valid cursor positions
        fc.nat({ max: 1000 }),
        fc.nat({ max: 500 }),
        (filePath, fileContent, line, column) => {
          // Ensure line is within bounds
          const lines = fileContent.split('\n')
          const validLine = Math.min(line, Math.max(0, lines.length - 1))
          const validColumn = Math.min(column, (lines[validLine]?.length || 0))
          
          const position: Position = { line: validLine, column: validColumn }
          
          const context = completionService.buildContext(
            filePath,
            fileContent,
            position
          )

          // Verify all required fields are present
          expect(context.filePath).toBeDefined()
          expect(typeof context.filePath).toBe('string')
          expect(context.filePath).toBe(filePath)

          expect(context.fileContent).toBeDefined()
          expect(typeof context.fileContent).toBe('string')
          expect(context.fileContent).toBe(fileContent)

          expect(context.cursorPosition).toBeDefined()
          expect(typeof context.cursorPosition.line).toBe('number')
          expect(typeof context.cursorPosition.column).toBe('number')

          expect(Array.isArray(context.openFiles)).toBe(true)

          // Verify prefix and suffix are strings
          expect(typeof context.prefix).toBe('string')
          expect(typeof context.suffix).toBe('string')

          // Verify language is detected
          expect(typeof context.language).toBe('string')
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property: validateContext correctly identifies valid contexts
   */
  it('validateContext returns true for valid contexts', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        fc.array(
          fc.record({
            path: fc.string({ minLength: 1 }),
            content: fc.string()
          }),
          { maxLength: 5 }
        ),
        (filePath, fileContent, line, column, openFiles) => {
          const context: CompletionContext = {
            filePath,
            fileContent,
            cursorPosition: { line, column },
            prefix: '',
            suffix: '',
            language: 'typescript',
            openFiles
          }

          expect(completionService.validateContext(context)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })


  /**
   * Property: validateContext returns false for invalid contexts
   */
  it('validateContext returns false when required fields are missing', () => {
    // Missing filePath
    expect(completionService.validateContext({
      filePath: '',
      fileContent: 'test',
      cursorPosition: { line: 0, column: 0 },
      prefix: '',
      suffix: '',
      language: 'typescript',
      openFiles: []
    })).toBe(false)

    // Missing cursorPosition fields
    expect(completionService.validateContext({
      filePath: 'test.ts',
      fileContent: 'test',
      cursorPosition: { line: undefined as unknown as number, column: 0 },
      prefix: '',
      suffix: '',
      language: 'typescript',
      openFiles: []
    })).toBe(false)

    // openFiles not an array
    expect(completionService.validateContext({
      filePath: 'test.ts',
      fileContent: 'test',
      cursorPosition: { line: 0, column: 0 },
      prefix: '',
      suffix: '',
      language: 'typescript',
      openFiles: null as unknown as Array<{ path: string; content: string }>
    })).toBe(false)
  })
})
