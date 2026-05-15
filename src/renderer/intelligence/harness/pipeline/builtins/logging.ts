import { logger } from '@toolkit/LogEngine'
import type { Middleware, MiddlewareContext } from '../Middleware'

export class LoggingMiddleware<TInput, TOutput> implements Middleware<TInput, TOutput> {
  readonly id = 'logging'
  readonly order = 10

  async before(input: TInput, ctx: MiddlewareContext): Promise<void> {
    logger.agent.info(`[Pipeline:${ctx.pipelineId}] Executing with input type: ${typeof input}`)
  }

  async after(_output: TOutput, ctx: MiddlewareContext): Promise<void> {
    const duration = Date.now() - ctx.timestamp
    logger.agent.info(`[Pipeline:${ctx.pipelineId}] Completed in ${duration}ms`)
  }

  async onError(error: Error, ctx: MiddlewareContext): Promise<void> {
    const duration = Date.now() - ctx.timestamp
    logger.agent.error(`[Pipeline:${ctx.pipelineId}] Error after ${duration}ms: ${error.message}`)
  }
}
