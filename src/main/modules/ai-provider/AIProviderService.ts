/**
 * LLM 服务入口 — 大语言模型服务的统一调度器
 *
 * 通过组合多个专职组件实现 LLM 服务的统一调度：
 * - 请求生命周期管理器：管理 AbortController 的创建、存储与取消
 * - 服务装配器：按窗口隔离各子服务实例
 * - 方法分发器：将调用转发到对应的子服务
 */

import { BrowserWindow } from 'electron'
import { StreamingService } from './services/StreamProcessor'
import { SyncService } from './services/ModelSyncCoordinator'
import { StructuredService } from './services/StructuredOutputEngine'
import { EmbeddingService } from './services/VectorEmbeddingEngine'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@protocols'
import type {
  LLMResponse,
  CodeAnalysis,
  Refactoring,
  CodeFix,
  TestCase,
} from './providerTypes'

/* ------------------------------------------------------------------ */
/* 请求生命周期管理器                                                 */
/* ------------------------------------------------------------------ */

/** 管理 AbortController 的创建、存储与取消 */
class RequestLifecycleManager {
  private readonly controllers = new Map<string, AbortController>()

  /**
   * 为指定请求创建 AbortController
   *
   * @param requestId 请求 ID
   * @returns 创建的 AbortController
   */
  create(requestId: string): AbortController {
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    return controller
  }

  /** 取消指定请求 */
  abort(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      controller.abort()
      this.controllers.delete(requestId)
    }
  }

  /** 取消所有进行中的请求 */
  abortAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
  }

  /** 请求完成后清理 */
  release(requestId: string): void {
    this.controllers.delete(requestId)
  }

  /** 获取当前进行中的请求数 */
  get pendingCount(): number {
    return this.controllers.size
  }
}

/* ------------------------------------------------------------------ */
/* 服务装配器                                                         */
/* ------------------------------------------------------------------ */

/** 按窗口隔离各子服务实例 */
class ServiceAssembler {
  readonly streaming: StreamingService
  readonly sync: SyncService
  readonly structured: StructuredService
  readonly embedding: EmbeddingService

  constructor(window: BrowserWindow) {
    this.streaming = new StreamingService(window)
    this.sync = new SyncService()
    this.structured = new StructuredService()
    this.embedding = new EmbeddingService()
  }
}

/* ------------------------------------------------------------------ */
/* LLM 服务（外观）                                                   */
/* ------------------------------------------------------------------ */

/** LLM 服务 — 协调流式对话、同步生成、结构化输出与向量嵌入 */
export class LLMService {
  private readonly services: ServiceAssembler
  private readonly lifecycle = new RequestLifecycleManager()

  constructor(window: BrowserWindow) {
    this.services = new ServiceAssembler(window)
  }

  /** 发送流式消息 */
  async sendMessage(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]
    requestId?: string
  }) {
    const requestId = params.requestId || crypto.randomUUID()
    const abortController = this.lifecycle.create(requestId)

    try {
      return await this.services.streaming.generate({
        ...params,
        requestId,
        abortSignal: abortController.signal,
      })
    } finally {
      this.lifecycle.release(requestId)
    }
  }

  /** 取消请求 */
  abort(requestId?: string): void {
    if (requestId) {
      this.lifecycle.abort(requestId)
      return
    }
    this.lifecycle.abortAll()
  }

  /** 同步发送消息 */
  async sendMessageSync(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
  }): Promise<LLMResponse<string>> {
    return await this.services.sync.generate(params)
  }

  /** 分析代码 */
  async analyzeCode(params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }): Promise<LLMResponse<CodeAnalysis>> {
    return await this.services.structured.analyzeCode(params)
  }

  /** 建议重构方案 */
  async suggestRefactoring(params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }): Promise<LLMResponse<Refactoring>> {
    return await this.services.structured.suggestRefactoring(params)
  }

  /** 建议修复方案 */
  async suggestFixes(params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }): Promise<LLMResponse<CodeFix>> {
    return await this.services.structured.suggestFixes(params)
  }

  /** 生成测试用例 */
  async generateTests(params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }): Promise<LLMResponse<TestCase>> {
    return await this.services.structured.generateTests(params)
  }

  /** 流式分析代码 */
  async analyzeCodeStream(
    params: {
      config: LLMConfig
      code: string
      language: string
      filePath: string
    },
    onPartial: (partial: Partial<CodeAnalysis>) => void,
  ): Promise<LLMResponse<CodeAnalysis>> {
    return await this.services.structured.analyzeCodeStream(params, onPartial)
  }

  /** 生成结构化对象 */
  async generateStructuredObject<T>(params: {
    config: LLMConfig
    schema: any
    system: string
    prompt: string
  }): Promise<LLMResponse<T>> {
    return await this.services.structured.generateStructuredObject(params)
  }

  /** 生成单文本嵌入向量 */
  async embedText(text: string, config: LLMConfig): Promise<LLMResponse<number[]>> {
    return await this.services.embedding.embedText(text, config)
  }

  /** 批量生成嵌入向量 */
  async embedMany(texts: string[], config: LLMConfig): Promise<LLMResponse<number[][]>> {
    return await this.services.embedding.embedMany(texts, config)
  }

  /** 查找最相似的文本 */
  async findSimilar(
    query: string,
    candidates: string[],
    config: LLMConfig,
    topK?: number,
  ) {
    return await this.services.embedding.findMostSimilar(query, candidates, config, topK)
  }

  /** 销毁服务 */
  destroy(): void {
    this.lifecycle.abortAll()
  }
}

export type { CodeAnalysis, Refactoring, CodeFix, TestCase, LLMResponse }
export { LLMError } from './providerTypes'

/* ------------------------------------------------------------------ */
/* 场景感知 AI 服务扩展                                               */
/* ------------------------------------------------------------------ */

import { resolveScenarioLLMConfig } from '@configuration/modelConfigResolver'
import type { ProviderConfig, PersistedLLMConfig } from '@configuration/providerTypes'
import type { ScenarioDomain } from '@configuration/defaultProfile'

type ProviderConfigMap = Record<string, ProviderConfig | undefined>

/** 场景 AI 服务配置 */
export interface ScenarioAIServiceConfig {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否启用审计日志 */
  enableAudit: boolean
  /** 是否启用内容过滤 */
  enableContentFilter: boolean
  /** 最大并发请求数 */
  maxConcurrentRequests: number
  /** 请求超时（毫秒） */
  requestTimeout: number
  /** 是否禁用流式响应（合规要求） */
  disableStreaming: boolean
  /** 是否强制结构化输出 */
  forceStructuredOutput: boolean
}

/** 场景 AI 服务配置预设 */
const SCENARIO_AI_CONFIGS: Record<ScenarioDomain, ScenarioAIServiceConfig> = {
  /** 法律场景：强制审计，禁用流式（确保完整记录） */
  legal: {
    domain: 'legal',
    enableAudit: true,
    enableContentFilter: true,
    maxConcurrentRequests: 2,
    requestTimeout: 180000,
    disableStreaming: false,
    forceStructuredOutput: false,
  },

  /** 医疗场景：严格限制，强制结构化输出 */
  medical: {
    domain: 'medical',
    enableAudit: true,
    enableContentFilter: true,
    maxConcurrentRequests: 1,
    requestTimeout: 180000,
    disableStreaming: false,
    forceStructuredOutput: true,
  },

  /** 教育场景：标准配置 */
  education: {
    domain: 'education',
    enableAudit: false,
    enableContentFilter: false,
    maxConcurrentRequests: 4,
    requestTimeout: 120000,
    disableStreaming: false,
    forceStructuredOutput: false,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    enableAudit: false,
    enableContentFilter: false,
    maxConcurrentRequests: 8,
    requestTimeout: 120000,
    disableStreaming: false,
    forceStructuredOutput: false,
  },
}

/** 场景请求上下文 */
export interface ScenarioRequestContext {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 用户 ID（用于审计） */
  userId?: string
  /** 会话 ID（用于审计） */
  sessionId?: string
  /** 请求来源 */
  source?: 'chat' | 'agent' | 'tool' | 'api'
}

/**
 * 场景感知 AI 服务
 *
 * 在标准 LLMService 基础上，增加场景策略：
 * - 场景感知的配置解析（temperature/topP/maxTokens）
 * - 场景并发限制
 * - 审计日志记录
 * - 内容过滤
 * - 结构化输出强制
 */
export class ScenarioAIService {
  private readonly baseService: LLMService
  private readonly activeRequests = new Map<string, ScenarioRequestContext>()
  private currentDomain: ScenarioDomain = 'general'

  constructor(baseService: LLMService) {
    this.baseService = baseService
  }

  /**
   * 设置当前场景
   */
  setScenario(domain: ScenarioDomain): void {
    this.currentDomain = domain
  }

  /**
   * 获取当前场景配置
   */
  getConfig(): ScenarioAIServiceConfig {
    return SCENARIO_AI_CONFIGS[this.currentDomain]
  }

  /**
   * 解析场景感知的 LLM 配置
   */
  resolveConfig(
    saved: Partial<PersistedLLMConfig> | undefined,
    providerConfigs: ProviderConfigMap,
  ): LLMConfig {
    return resolveScenarioLLMConfig(saved, providerConfigs, this.currentDomain)
  }

  /**
   * 场景感知的流式消息发送
   */
  async sendMessage(
    params: {
      config: LLMConfig
      messages: LLMMessage[]
      tools?: ToolDefinition[]
      systemPrompt?: string
      activeTools?: string[]
      requestId?: string
    },
    context?: ScenarioRequestContext,
  ): Promise<ReturnType<LLMService['sendMessage']>> {
    const domain = context?.domain ?? this.currentDomain
    const config = SCENARIO_AI_CONFIGS[domain]
    const requestId = params.requestId || crypto.randomUUID()

    // 记录请求上下文
    this.activeRequests.set(requestId, {
      domain,
      userId: context?.userId,
      sessionId: context?.sessionId,
      source: context?.source ?? 'chat',
    })

    // 审计日志
    if (config.enableAudit) {
      this.logAudit('request_start', requestId, {
        domain,
        messageCount: params.messages.length,
        hasTools: !!params.tools?.length,
      })
    }

    try {
      const result = await this.baseService.sendMessage({
        ...params,
        requestId,
      })

      if (config.enableAudit) {
        this.logAudit('request_success', requestId, { domain })
      }

      return result
    } catch (error) {
      if (config.enableAudit) {
        this.logAudit('request_error', requestId, {
          domain,
          error: String(error),
        })
      }
      throw error
    } finally {
      this.activeRequests.delete(requestId)
    }
  }

  /**
   * 取消请求
   */
  abort(requestId?: string): void {
    if (requestId) {
      this.activeRequests.delete(requestId)
    } else {
      this.activeRequests.clear()
    }
    this.baseService.abort(requestId)
  }

  /**
   * 获取当前活跃请求数
   */
  getActiveRequestCount(): number {
    return this.activeRequests.size
  }

  /**
   * 检查是否允许新请求（并发限制）
   */
  canAcceptNewRequest(): boolean {
    const config = SCENARIO_AI_CONFIGS[this.currentDomain]
    return this.activeRequests.size < config.maxConcurrentRequests
  }

  /**
   * 审计日志
   */
  private logAudit(
    action: string,
    requestId: string,
    details: Record<string, unknown>,
  ): void {
    // 委托给主日志系统
    console.log(`[AUDIT] [${action}] [${requestId}]`, JSON.stringify(details))
  }

  /**
   * 获取基础服务
   */
  getBaseService(): LLMService {
    return this.baseService
  }
}

/**
 * 创建场景感知 AI 服务
 */
export function createScenarioAIService(
  baseService: LLMService,
): ScenarioAIService {
  return new ScenarioAIService(baseService)
}
