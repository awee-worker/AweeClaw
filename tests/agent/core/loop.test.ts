import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LoopDetector } from '@intelligence/utils/LoopDetector'
import type { ToolCall } from '@protocols'

vi.mock('@intelligence/utils/AgentConfig', () => ({
  getAgentConfig: () => ({
    loopDetection: {
      maxExactRepeats: 3,
      maxSameTargetRepeats: 4,
      maxHistory: 100,
      dynamicThreshold: false,
      enabled: true,
      patternRepeatHardStop: 3,
    },
    maxToolLoops: 50,
    dynamicConcurrency: { enabled: false },
    toolDependencies: {},
    maxToolResultChars: 50000,
  }),
}))

vi.mock('@store', () => ({
  useStore: {
    getState: () => ({
      agentConfig: { loopDetection: { enabled: true } },
    }),
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2, 8)}`,
    name,
    arguments: args,
    status: 'running' as const,
  }
}

describe('LoopDetector', () => {
  let detector: LoopDetector

  beforeEach(() => {
    detector = new LoopDetector()
  })

  describe('exact repeat detection', () => {
    it('does not flag a single tool call', () => {
      const calls = [makeToolCall('read_file', { path: '/src/index.ts' })]
      const result = detector.checkLoop(calls)
      expect(result.isLoop).toBe(false)
    })

    it('does not flag different arguments to the same tool', () => {
      for (let i = 0; i < 5; i++) {
        const calls = [makeToolCall('read_file', { path: `/src/file${i}.ts` })]
        const result = detector.checkLoop(calls)
        expect(result.isLoop).toBe(false)
        detector.recordExecutedTool(calls[0], true)
      }
    })

    it('flags exact repeat of write tool after threshold is exceeded', () => {
      const args = { path: '/src/index.ts', old_string: 'foo', new_string: 'bar' }
      for (let i = 0; i < 3; i++) {
        const calls = [makeToolCall('edit_file', args)]
        detector.checkLoop(calls)
        detector.recordExecutedTool(calls[0], true)
      }

      const calls = [makeToolCall('edit_file', args)]
      const result = detector.checkLoop(calls)
      expect(result.isLoop).toBe(true)
      expect(result.details?.category).toBe('exact_repeat')
    })

    it('does not flag read operations below readOpMultiplier threshold', () => {
      const args = { path: '/src/index.ts' }
      for (let i = 0; i < 3; i++) {
        const calls = [makeToolCall('read_file', args)]
        const result = detector.checkLoop(calls)
        expect(result.isLoop).toBe(false)
        detector.recordExecutedTool(calls[0], true)
      }
    })
  })

  describe('same target detection', () => {
    it('flags when the same file is edited repeatedly with different args', () => {
      const path = '/src/app.tsx'
      for (let i = 0; i < 4; i++) {
        const calls = [makeToolCall('edit_file', { path, old_string: `old${i}`, new_string: `new${i}` })]
        detector.checkLoop(calls)
        detector.recordExecutedTool(calls[0], true)
      }

      const calls = [makeToolCall('edit_file', { path, old_string: 'old5', new_string: 'new5' })]
      const result = detector.checkLoop(calls)
      expect(result.isLoop).toBe(true)
      expect(result.details?.category).toBeDefined()
    })
  })

  describe('content cycle detection', () => {
    it('detects when file content oscillates between values', () => {
      const path = '/src/config.ts'
      const contents = new Map<string, string>()

      for (let i = 0; i < 6; i++) {
        const content = i % 2 === 0 ? 'option-a' : 'option-b'
        contents.set(path, content)
        const calls = [makeToolCall('edit_file', { path, content })]
        detector.checkLoop(calls, contents)
        detector.recordExecutedTool(calls[0], true, contents)
        detector.updateContentHash(path, content)
      }

      contents.set(path, 'option-a')
      const calls = [makeToolCall('edit_file', { path, content: 'option-a' })]
      const result = detector.checkLoop(calls, contents)
      expect(result.isLoop || result.warning).toBeTruthy()
    })
  })

  describe('pattern loop detection', () => {
    it('detects repeating tool sequences', () => {
      const pattern = [
        makeToolCall('read_file', { path: '/src/a.ts' }),
        makeToolCall('edit_file', { path: '/src/a.ts', old_string: 'x', new_string: 'y' }),
      ]

      for (let round = 0; round < 4; round++) {
        for (const tc of pattern) {
          detector.checkLoop([tc])
          detector.recordExecutedTool(tc, true)
        }
      }

      const calls = [makeToolCall('read_file', { path: '/src/a.ts' })]
      const result = detector.checkLoop(calls)
      expect(result.isLoop || result.warning).toBeTruthy()
    })
  })

  describe('progress signal', () => {
    it('increases threshold when agent produces text between tool calls', () => {
      const args = { path: '/src/index.ts' }

      for (let i = 0; i < 3; i++) {
        detector.signalProgress()
        const calls = [makeToolCall('read_file', args)]
        detector.checkLoop(calls)
        detector.recordExecutedTool(calls[0], true)
      }

      const calls = [makeToolCall('read_file', args)]
      const result = detector.checkLoop(calls)
      expect(result.isLoop).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const args = { path: '/src/index.ts' }
      for (let i = 0; i < 3; i++) {
        const calls = [makeToolCall('read_file', args)]
        detector.checkLoop(calls)
        detector.recordExecutedTool(calls[0], true)
      }

      detector.reset()

      const calls = [makeToolCall('read_file', args)]
      const result = detector.checkLoop(calls)
      expect(result.isLoop).toBe(false)
    })
  })

  describe('warning severity', () => {
    it('emits low-severity warning before hard stop', () => {
      const args = { path: '/src/index.ts' }
      let gotWarning = false

      for (let i = 0; i < 10; i++) {
        const calls = [makeToolCall('read_file', args)]
        const result = detector.checkLoop(calls)
        if (result.warning) gotWarning = true
        if (result.isLoop) break
        detector.recordExecutedTool(calls[0], true)
      }

      expect(gotWarning).toBe(true)
    })
  })
})
