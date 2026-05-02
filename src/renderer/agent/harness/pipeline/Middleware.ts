export interface MiddlewareContext {
  readonly pipelineId: string
  readonly timestamp: number
  readonly metadata: Record<string, unknown>
  readonly signal?: AbortSignal
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
}

export class PipelineContext implements MiddlewareContext {
  readonly pipelineId: string
  readonly timestamp: number
  readonly metadata: Record<string, unknown>
  readonly signal?: AbortSignal
  private store = new Map<string, unknown>()

  constructor(pipelineId: string, metadata?: Record<string, unknown>, signal?: AbortSignal) {
    this.pipelineId = pipelineId
    this.timestamp = Date.now()
    this.metadata = metadata ?? {}
    this.signal = signal
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value)
  }
}

export interface Middleware<TInput, TOutput> {
  readonly id: string
  readonly order: number
  before?(input: TInput, ctx: MiddlewareContext): Promise<TInput | void>
  after?(output: TOutput, ctx: MiddlewareContext): Promise<TOutput | void>
  onError?(error: Error, ctx: MiddlewareContext): Promise<void>
}
