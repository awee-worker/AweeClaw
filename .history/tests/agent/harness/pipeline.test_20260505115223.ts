import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Pipeline, PipelineAbortedError } from '@renderer/agent/harness/pipeline/Pipeline'
import type { Middleware, MiddlewareContext } from '@renderer/agent/harness/pipeline/Middleware'
import { AuditMiddleware, getAuditLog, clearAuditLog } from '@renderer/agent/harness/pipeline/builtins/audit'
import { RateLimitMiddleware, RateLimitError } from '@renderer/agent/harness/pipeline/builtins/rateLimit'
import { ErrorBoundaryMiddleware } from '@renderer/agent/harness/pipeline/builtins/errorBoundary'

describe('Pipeline', () => {
  it('executes handler without middleware', async () => {
    const pipeline = new Pipeline<number, number>('test')
    const result = await pipeline.execute(5, async (input) => input * 2)
    expect(result).toBe(10)
  })

  it('passes input through before middleware', async () => {
    const pipeline = new Pipeline<number, number>('test')
    const doubleMiddleware: Middleware<number, number> = {
      id: 'double',
      order: 1,
      async before(input) { return input * 3 },
    }
    pipeline.use(doubleMiddleware)
    const result = await pipeline.execute(5, async (input) => input * 2)
    expect(result).toBe(30)
  })

  it('passes output through after middleware', async () => {
    const pipeline = new Pipeline<number, number>('test')
    const addMiddleware: Middleware<number, number> = {
      id: 'add',
      order: 1,
      async after(output) { return output + 10 },
    }
    pipeline.use(addMiddleware)
    const result = await pipeline.execute(5, async (input) => input * 2)
    expect(result).toBe(20)
  })

  it('sorts middleware by order', async () => {
    const pipeline = new Pipeline<number, number>('test')
    const log: string[] = []

    pipeline.use({ id: 'second', order: 20, async before(input) { log.push('second'); return input } })
    pipeline.use({ id: 'first', order: 10, async before(input) { log.push('first'); return input } })

    await pipeline.execute(1, async (input) => input)
    expect(log).toEqual(['first', 'second'])
  })

  it('calls onError on middleware when handler throws', async () => {
    const pipeline = new Pipeline<number, number>('test')
    let errorCaught = false

    pipeline.use({
      id: 'catcher',
      order: 1,
      async onError(error) { errorCaught = true },
    })

    await expect(
      pipeline.execute(1, async () => { throw new Error('boom') })
    ).rejects.toThrow('boom')

    expect(errorCaught).toBe(true)
  })

  it('supports AbortSignal', async () => {
    const pipeline = new Pipeline<number, number>('test')
    const controller = new AbortController()
    controller.abort()

    await expect(
      pipeline.execute(1, async (input) => input, undefined, controller.signal)
    ).rejects.toThrow(PipelineAbortedError)
  })

  it('removes middleware by id', () => {
    const pipeline = new Pipeline<number, number>('test')
    pipeline.use({ id: 'mw1', order: 1 })
    pipeline.use({ id: 'mw2', order: 2 })

    expect(pipeline.getMiddlewareIds()).toEqual(['mw1', 'mw2'])
    pipeline.remove('mw1')
    expect(pipeline.getMiddlewareIds()).toEqual(['mw2'])
  })
})

describe('AuditMiddleware', () => {
  beforeEach(() => {
    clearAuditLog()
  })

  it('records audit entries for tool executions', async () => {
    const pipeline = new Pipeline<{ toolName: string; args: Record<string, unknown> }, { success: boolean }>('tool-execution')
    pipeline.use(new AuditMiddleware())

    await pipeline.execute(
      { toolName: 'read_file', args: { path: '/src/index.ts' } },
      async () => ({ success: true })
    )

    const log = getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0].action).toBe('read_file')
    expect(log[0].resource).toBe('/src/index.ts')
    expect(log[0].outcome).toBe('allow')
  })

  it('records error outcome when handler fails', async () => {
    const pipeline = new Pipeline<{ toolName: string }, { success: boolean }>('tool-execution')
    pipeline.use(new AuditMiddleware())
    pipeline.use(new ErrorBoundaryMiddleware())

    await pipeline.execute(
      { toolName: 'edit_file' },
      async () => { throw new Error('write failed') }
    ).catch(() => {})

    const log = getAuditLog()
    expect(log).toHaveLength(1)
    expect(log[0].outcome).toBe('error')
  })

  it('respects max audit entries limit', async () => {
    const pipeline = new Pipeline<{ toolName: string }, { success: boolean }>('test')
    pipeline.use(new AuditMiddleware())

    for (let i = 0; i < 1100; i++) {
      await pipeline.execute(
        { toolName: `tool_${i}` },
        async () => ({ success: true })
      )
    }

    const log = getAuditLog()
    expect(log.length).toBeLessThanOrEqual(1000)
  })
})

describe('RateLimitMiddleware', () => {
  it('allows requests within limit', async () => {
    const pipeline = new Pipeline<{ toolName: string }, { success: boolean }>('test')
    pipeline.use(new RateLimitMiddleware({ maxCalls: 5, windowMs: 1000 }))

    for (let i = 0; i < 5; i++) {
      const result = await pipeline.execute(
        { toolName: 'read_file' },
        async () => ({ success: true })
      )
      expect(result.success).toBe(true)
    }
  })

  it('throws RateLimitError when limit exceeded', async () => {
    const pipeline = new Pipeline<{ toolName: string }, { success: boolean }>('test')
    pipeline.use(new RateLimitMiddleware({ maxCalls: 2, windowMs: 10000 }))

    await pipeline.execute({ toolName: 'read_file' }, async () => ({ success: true }))
    await pipeline.execute({ toolName: 'read_file' }, async () => ({ success: true }))

    await expect(
      pipeline.execute({ toolName: 'read_file' }, async () => ({ success: true }))
    ).rejects.toThrow(RateLimitError)
  })

  it('uses custom key extractor', async () => {
    const pipeline = new Pipeline<{ toolName: string }, { success: boolean }>('test')
    pipeline.use(new RateLimitMiddleware({
      maxCalls: 1,
      windowMs: 10000,
      keyExtractor: (input) => `tool:${(input as any).toolName}`,
    }))

    await pipeline.execute({ toolName: 'read_file' }, async () => ({ success: true }))

    await expect(
      pipeline.execute({ toolName: 'read_file' }, async () => ({ success: true }))
    ).rejects.toThrow(RateLimitError)

    const result = await pipeline.execute({ toolName: 'edit_file' }, async () => ({ success: true }))
    expect(result.success).toBe(true)
  })
})
