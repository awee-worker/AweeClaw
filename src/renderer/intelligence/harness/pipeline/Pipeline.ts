import { Middleware, MiddlewareContext, PipelineContext } from './Middleware'

export class Pipeline<TInput, TOutput> {
  private middlewares: Middleware<TInput, TOutput>[] = []
  readonly id: string

  constructor(id: string) {
    this.id = id
  }

  use(middleware: Middleware<TInput, TOutput>): this {
    this.middlewares.push(middleware)
    this.middlewares.sort((a, b) => a.order - b.order)
    return this
  }

  remove(middlewareId: string): this {
    this.middlewares = this.middlewares.filter(m => m.id !== middlewareId)
    return this
  }

  clear(): this {
    this.middlewares = []
    return this
  }

  async execute(
    input: TInput,
    handler: (input: TInput, ctx: MiddlewareContext) => Promise<TOutput>,
    metadata?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<TOutput> {
    const ctx = new PipelineContext(this.id, metadata, signal)

    let currentInput = input

    for (const mw of this.middlewares) {
      if (signal?.aborted) {
        throw new PipelineAbortedError(this.id, mw.id)
      }
      if (mw.before) {
        const result = await mw.before(currentInput, ctx)
        if (result !== undefined) {
          currentInput = result
        }
      }
    }

    let output: TOutput
    try {
      output = await handler(currentInput, ctx)
    } catch (error) {
      for (let i = this.middlewares.length - 1; i >= 0; i--) {
        const mw = this.middlewares[i]
        if (mw.onError) {
          try {
            await mw.onError(error instanceof Error ? error : new Error(String(error)), ctx)
          } catch {
            // swallow middleware errors during error handling
          }
        }
      }
      throw error
    }

    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]
      if (mw.after) {
        const result = await mw.after(output, ctx)
        if (result !== undefined) {
          output = result
        }
      }
    }

    return output
  }

  getMiddlewareIds(): string[] {
    return this.middlewares.map(m => m.id)
  }

  has(middlewareId: string): boolean {
    return this.middlewares.some(m => m.id === middlewareId)
  }
}

export class PipelineAbortedError extends Error {
  readonly pipelineId: string
  readonly middlewareId: string

  constructor(pipelineId: string, middlewareId: string) {
    super(`Pipeline "${pipelineId}" aborted before middleware "${middlewareId}"`)
    this.name = 'PipelineAbortedError'
    this.pipelineId = pipelineId
    this.middlewareId = middlewareId
  }
}
