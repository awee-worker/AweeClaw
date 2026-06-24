/**
 * Agent Harness
 *
 * 客户端 Agent 驾驭架构入口，组合：
 * - HarnessContainer（DI 容器，复用共享包）
 * - Pipeline（工具执行 / LLM 调用管道，复用共享包）
 * - CapabilityRegistry（能力注册中心，复用共享包）
 * - ObservabilityBus（可观测性总线，客户端聚合层）
 * - LifecycleManager（生命周期管理，客户端特有）
 * - GracefulShutdown（优雅停机，复用共享包）
 *
 * 在 initialize() 时注入 LoggerPort / AuditSink 端口桥接，
 * 使共享包内的中间件使用客户端的日志与审计通道。
 */

import { logger } from '@toolkit/LogEngine'
import { setLogger, setAuditSink } from '@aweeclaw/harness-core'
import { HarnessContainer } from './kernel/Container'
import { TOKENS } from './kernel/Token'
import type { IFileService, ILintService, IMemoryService, ISkillService, IFileCacheService, IEventBus, IAgentStore, IGlobalStore, IElectronAPI } from './kernel/Token'
import { Pipeline } from './pipeline/Pipeline'
import { LoggingMiddleware } from './pipeline/builtins/logging'
import { AuditMiddleware } from './pipeline/builtins/audit'
import { RetryMiddleware } from './pipeline/builtins/retry'
import { RateLimitMiddleware } from './pipeline/builtins/rateLimit'
import { ErrorBoundaryMiddleware, CircuitBreakerMiddleware } from './pipeline/builtins/errorBoundary'
import { CapabilityRegistry } from './capability/CapabilityRegistry'
import type { CapabilityProvider } from './capability/Capability'
import { ObservabilityBus, globalObservability } from './observability/ObservabilityBus'
import { LifecycleManager } from './lifecycle/LifecycleManager'
import { GracefulShutdown } from './lifecycle/GracefulShutdown'
import { ClientLoggerBridge, ClientAuditSinkBridge } from './ports'

export interface ToolExecutionInput {
  toolName: string
  args: Record<string, unknown>
  context: unknown
}

export interface ToolExecutionOutput {
  success: boolean
  result?: unknown
  error?: string
}

export interface LlmCallInput {
  messages: unknown[]
  config: unknown
}

export interface LlmCallOutput {
  content?: string
  toolCalls?: unknown[]
  usage?: unknown
  error?: string
}

export class AgentHarness {
  readonly container: HarnessContainer
  readonly toolPipeline: Pipeline<ToolExecutionInput, ToolExecutionOutput>
  readonly llmPipeline: Pipeline<LlmCallInput, LlmCallOutput>
  readonly capabilityRegistry: CapabilityRegistry
  readonly observability: ObservabilityBus
  readonly lifecycle: LifecycleManager
  readonly gracefulShutdown: GracefulShutdown

  private initialized = false
  private portsInjected = false

  constructor() {
    this.container = new HarnessContainer(undefined, 'agent-harness')
    this.toolPipeline = new Pipeline<ToolExecutionInput, ToolExecutionOutput>('tool-execution')
    this.llmPipeline = new Pipeline<LlmCallInput, LlmCallOutput>('llm-call')
    this.capabilityRegistry = new CapabilityRegistry()
    this.observability = globalObservability
    this.lifecycle = new LifecycleManager()
    this.gracefulShutdown = new GracefulShutdown()
  }

  /**
   * 注入端口桥接
   *
   * 将客户端 LogEngine 与 Electron IPC 审计通道适配为共享包的 LoggerPort / AuditSink。
   * 幂等，仅在首次调用时生效。
   */
  private injectPorts(): void {
    if (this.portsInjected) return
    setLogger(new ClientLoggerBridge())
    setAuditSink(new ClientAuditSinkBridge())
    this.portsInjected = true
  }

  async initialize(deps: {
    fileService: IFileService
    lintService: ILintService
    memoryService: IMemoryService
    skillService: ISkillService
    fileCacheService: IFileCacheService
    eventBus: IEventBus
    agentStore: IAgentStore
    globalStore: IGlobalStore
    electronAPI: IElectronAPI
    workspacePath: string
  }): Promise<void> {
    if (this.initialized) {
      logger.agent.warn('[AgentHarness] Already initialized, skipping')
      return
    }

    // 注入端口桥接，使共享包中间件使用客户端日志与审计通道
    this.injectPorts()

    this.container.value(TOKENS.FileService, deps.fileService)
    this.container.value(TOKENS.LintService, deps.lintService)
    this.container.value(TOKENS.MemoryService, deps.memoryService)
    this.container.value(TOKENS.SkillService, deps.skillService)
    this.container.value(TOKENS.FileCacheService, deps.fileCacheService)
    this.container.value(TOKENS.EventBus, deps.eventBus)
    this.container.value(TOKENS.AgentStore, deps.agentStore)
    this.container.value(TOKENS.GlobalStore, deps.globalStore)
    this.container.value(TOKENS.ElectronAPI, deps.electronAPI)
    this.container.value(TOKENS.WorkspacePath, deps.workspacePath)

    this.setupDefaultPipelines()
    this.setupHealthChecks()

    await this.lifecycle.start()
    this.initialized = true

    logger.agent.info('[AgentHarness] Initialized successfully')
  }

  private setupDefaultPipelines(): void {
    this.toolPipeline
      .use(new ErrorBoundaryMiddleware<ToolExecutionInput, ToolExecutionOutput>())
      .use(new AuditMiddleware<ToolExecutionInput, ToolExecutionOutput>())
      .use(new RateLimitMiddleware<ToolExecutionInput, ToolExecutionOutput>({
        maxCalls: 30,
        windowMs: 60_000,
        keyExtractor: (input) => {
          if (typeof input === 'object' && input !== null) {
            const obj = input as Record<string, unknown>
            if (typeof obj.toolName === 'string') return `tool:${obj.toolName}`
          }
          return 'default'
        },
      }))
      .use(new LoggingMiddleware<ToolExecutionInput, ToolExecutionOutput>())
      .use(new RetryMiddleware<ToolExecutionInput, ToolExecutionOutput>({ maxRetries: 2 }))

    this.llmPipeline
      .use(new ErrorBoundaryMiddleware<LlmCallInput, LlmCallOutput>())
      .use(new AuditMiddleware<LlmCallInput, LlmCallOutput>())
      .use(new LoggingMiddleware<LlmCallInput, LlmCallOutput>())
      .use(new CircuitBreakerMiddleware<LlmCallInput, LlmCallOutput>(5, 30000))
  }

  private setupHealthChecks(): void {
    this.observability.health.register('container', async () => ({
      healthy: !this.container.isDisposed,
      message: this.container.isDisposed ? 'Container disposed' : 'Container active',
      checkedAt: Date.now(),
    }))

    this.observability.health.register('capabilities', async () => ({
      healthy: true,
      details: { count: this.capabilityRegistry.size },
      checkedAt: Date.now(),
    }))
  }

  createThreadScope(threadId: string): HarnessContainer {
    return this.container.createScope(`thread-${threadId}`)
  }

  async loadCapabilityProvider(provider: CapabilityProvider): Promise<void> {
    await this.capabilityRegistry.loadProvider(provider)
  }

  async shutdown(reason?: string): Promise<void> {
    logger.agent.info(`[AgentHarness] Shutting down${reason ? `: ${reason}` : ''}`)
    await this.gracefulShutdown.shutdown()
    await this.lifecycle.shutdown(reason)
    await this.container.dispose()
    this.observability.reset()
    this.initialized = false
  }

  private initializationWarned = false

  get isInitialized(): boolean {
    if (!this.initialized && !this.initializationWarned) {
      this.initializationWarned = true
      logger.agent.warn('[AgentHarness] Harness accessed before initialization. Middleware (retry, rate-limit, circuit-breaker, audit) will be skipped. Call agentHarness.initialize() during app startup.')
    }
    return this.initialized
  }
}

export const agentHarness = new AgentHarness()
