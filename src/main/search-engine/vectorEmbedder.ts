/**
 * 向量嵌入服务 — 多 Provider Embedding 生成
 *
 * 通过组合多个专职组件实现向量嵌入：
 * - 令牌桶限流器：基于令牌桶算法控制请求频率
 * - 重试执行器：指数退避重试机制
 * - 批次分割器：按批次大小切分文本列表
 * - 模型校验器：校验模型名与 Provider 的匹配关系
 * - Provider 注册表：注册并分发各 Provider 的嵌入策略
 */

import {
  EmbeddingConfig,
  EmbeddingProvider,
  DEFAULT_EMBEDDING_MODELS,
  EMBEDDING_ENDPOINTS,
} from './providerTypes'
import { logger } from '@shared/toolkit/LogEngine'
import type { LLMConfig } from '@protocols'

/* ------------------------------------------------------------------ */
/* Provider 模型匹配模式                                               */
/* ------------------------------------------------------------------ */

/** 每个 Provider 支持的模型名前缀正则 */
const PROVIDER_MODEL_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  jina: /^jina-/i,
  voyage: /^voyage-/i,
  openai: /^text-embedding/i,
  cohere: /^embed-/i,
  huggingface: /^sentence-transformers\//i,
  ollama: /^(nomic|llama|mxbai)/i,
  transformers: /^Xenova\//i,
})

/** 每个 Provider 的速率限制配置 */
const PROVIDER_RATE_LIMITS: Readonly<Record<EmbeddingProvider, { rpm: number; batchSize: number }>> = Object.freeze({
  jina: { rpm: 60, batchSize: 100 },
  voyage: { rpm: 3, batchSize: 8 },
  openai: { rpm: 60, batchSize: 100 },
  cohere: { rpm: 100, batchSize: 96 },
  huggingface: { rpm: 30, batchSize: 1 },
  ollama: { rpm: 1000, batchSize: 1 },
  transformers: { rpm: 10000, batchSize: 32 },
  custom: { rpm: 60, batchSize: 50 },
})

/* ------------------------------------------------------------------ */
/* 令牌桶限流器                                                       */
/* ------------------------------------------------------------------ */

/** 基于令牌桶算法的请求频率控制器 */
class TokenBucketRateGate {
  private tokens: number
  private lastRefillTime: number

  /**
   * @param rpm 每分钟允许的请求数
   */
  constructor(private readonly rpm: number) {
    this.tokens = rpm
    this.lastRefillTime = Date.now()
  }

  /** 等待直到有可用令牌 */
  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens < 1) {
      const waitMs = this.estimateWaitTime()
      await this.delay(waitMs)
      this.refill()
    }
    this.tokens -= 1
  }

  /** 按时间流逝补充令牌 */
  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefillTime
    const replenished = (elapsed / 60000) * this.rpm
    this.tokens = Math.min(this.rpm, this.tokens + replenished)
    this.lastRefillTime = now
  }

  /** 估算需要等待的时间（毫秒） */
  private estimateWaitTime(): number {
    return Math.ceil(60000 / this.rpm)
  }

  /** 延迟工具 */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/* ------------------------------------------------------------------ */
/* 重试执行器                                                         */
/* ------------------------------------------------------------------ */

/** 带指数退避的重试执行器 */
class RetryExecutor {
  /** 默认最大重试次数 */
  private static readonly DEFAULT_MAX_RETRIES = 3
  /** 429 错误的基础等待时间（毫秒） */
  private static readonly RATE_LIMIT_BASE_WAIT = 20000

  /**
   * 执行带重试的异步操作
   *
   * @param operation 要执行的异步操作
   * @param maxRetries 最大重试次数
   * @returns 操作结果
   */
  async execute<T>(operation: () => Promise<T>, maxRetries = RetryExecutor.DEFAULT_MAX_RETRIES): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt < maxRetries - 1) {
          await this.delay(this.computeWaitTime(lastError, attempt))
        }
      }
    }

    throw lastError || new Error('操作在重试后仍失败')
  }

  /** 根据错误类型计算等待时间 */
  private computeWaitTime(error: Error, attempt: number): number {
    if (error.message.includes('429')) {
      const waitTime = Math.pow(2, attempt + 1) * RetryExecutor.RATE_LIMIT_BASE_WAIT
      logger.index.warn(`[EmbeddingService] 触发速率限制，等待 ${waitTime / 1000}s 后重试...`)
      return waitTime
    }
    return 1000 * (attempt + 1)
  }

  /** 延迟工具 */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/* ------------------------------------------------------------------ */
/* 批次分割器                                                         */
/* ------------------------------------------------------------------ */

/** 将文本列表按固定大小切分为批次 */
class BatchSplitter {
  /**
   * @param batchSize 每批的最大文本数
   */
  constructor(private readonly batchSize: number) {}

  /**
   * 将文本列表切分为批次
   *
   * @param texts 文本列表
   * @returns 批次列表
   */
  split(texts: string[]): string[][] {
    const batches: string[][] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize))
    }
    return batches
  }
}

/* ------------------------------------------------------------------ */
/* 模型校验器                                                         */
/* ------------------------------------------------------------------ */

/** 校验模型名与 Provider 的匹配关系 */
class ModelValidator {
  /**
   * 解析并校验模型名
   *
   * @param provider Provider 名称
   * @param model 模型名
   * @returns 校验后的模型名
   */
  resolve(provider: string, model?: string): string {
    if (provider === 'custom') return model || ''
    if (!model) return this.getDefault(provider)
    if (!this.matches(provider, model)) {
      logger.index.warn(
        `[EmbeddingService] 模型 "${model}" 与 Provider "${provider}" 不匹配，使用默认值: ${this.getDefault(provider)}`,
      )
      return this.getDefault(provider)
    }
    return model
  }

  /** 获取 Provider 的默认模型 */
  private getDefault(provider: string): string {
    return DEFAULT_EMBEDDING_MODELS[provider as keyof typeof DEFAULT_EMBEDDING_MODELS] || ''
  }

  /** 检查模型名是否匹配 Provider 的模式 */
  private matches(provider: string, model: string): boolean {
    const pattern = PROVIDER_MODEL_PATTERNS[provider]
    return !pattern || pattern.test(model)
  }
}

/* ------------------------------------------------------------------ */
/* HTTP 请求构建器                                                    */
/* ------------------------------------------------------------------ */

/** 封装 Embedding HTTP 请求的构建与发送 */
class EmbeddingHttpClient {
  /**
   * 发送 POST 请求并解析 JSON 响应
   *
   * @param url 请求地址
   * @param apiKey API 密钥（可选）
   * @param body 请求体
   * @param providerName Provider 名称（用于错误信息）
   * @returns 解析后的 JSON 数据
   */
  static async post<T>(
    url: string,
    apiKey: string | undefined,
    body: unknown,
    providerName: string,
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${providerName} API 错误: ${response.status} - ${errorText}`)
    }
    return response.json() as Promise<T>
  }
}

/* ------------------------------------------------------------------ */
/* Provider 嵌入策略                                                  */
/* ------------------------------------------------------------------ */

/** Provider 嵌入策略接口 */
interface EmbeddingStrategy {
  /** 生成文本列表的向量嵌入 */
  embed(texts: string[], config: EmbeddingConfig): Promise<number[][]>
}

/** Jina AI 嵌入策略 */
class JinaStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const url = config.baseUrl || EMBEDDING_ENDPOINTS.jina
    const data = await EmbeddingHttpClient.post<{ data: { embedding: number[] }[] }>(
      url, config.apiKey, { model: config.model, input: texts }, 'Jina',
    )
    return data.data.map((item) => item.embedding)
  }
}

/** Voyage AI 嵌入策略 */
class VoyageStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const url = config.baseUrl || EMBEDDING_ENDPOINTS.voyage
    const data = await EmbeddingHttpClient.post<{ data: { embedding: number[] }[] }>(
      url, config.apiKey, { model: config.model, input: texts }, 'Voyage',
    )
    return data.data.map((item) => item.embedding)
  }
}

/** OpenAI 嵌入策略 */
class OpenAIStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const url = config.baseUrl || EMBEDDING_ENDPOINTS.openai
    const data = await EmbeddingHttpClient.post<{ data: { embedding: number[]; index: number }[] }>(
      url, config.apiKey, { model: config.model, input: texts }, 'OpenAI',
    )
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding)
  }
}

/** Cohere 嵌入策略 */
class CohereStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const url = config.baseUrl || EMBEDDING_ENDPOINTS.cohere
    const data = await EmbeddingHttpClient.post<{ embeddings: number[][] }>(
      url, config.apiKey,
      { model: config.model, texts, input_type: 'search_document' },
      'Cohere',
    )
    return data.embeddings
  }
}

/** HuggingFace 嵌入策略 */
class HuggingFaceStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const model = config.model || 'sentence-transformers/all-MiniLM-L6-v2'
    const url = config.baseUrl || `${EMBEDDING_ENDPOINTS.huggingface}/${model}`
    const results: number[][] = []

    for (const text of texts) {
      const data = await EmbeddingHttpClient.post<number[] | number[][]>(
        url, config.apiKey, { inputs: text }, 'HuggingFace',
      )
      if (Array.isArray(data) && Array.isArray(data[0])) {
        results.push(PoolingUtil.mean(data as number[][]))
      } else {
        results.push(data as number[])
      }
    }
    return results
  }
}

/** Ollama 嵌入策略 */
class OllamaStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const url = config.baseUrl || EMBEDDING_ENDPOINTS.ollama
    const results: number[][] = []

    for (const text of texts) {
      const data = await EmbeddingHttpClient.post<{ embedding: number[] }>(
        url, undefined, { model: config.model, prompt: text }, 'Ollama',
      )
      results.push(data.embedding)
    }
    return results
  }
}

/** 自定义嵌入策略（兼容 OpenAI API 格式） */
class CustomStrategy implements EmbeddingStrategy {
  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    if (!config.baseUrl) throw new Error('自定义嵌入服务需要配置 baseUrl')
    const data = await EmbeddingHttpClient.post<{ data: { embedding: number[]; index?: number }[] }>(
      config.baseUrl, config.apiKey,
      { model: config.model || 'default', input: texts },
      'Custom',
    )
    if (data.data[0]?.index !== undefined) {
      return data.data
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((item) => item.embedding)
    }
    return data.data.map((item) => item.embedding)
  }
}

/** Transformers.js 本地嵌入策略 */
class TransformersStrategy implements EmbeddingStrategy {
  private static pipeline: any = null
  private static loadingPromise: Promise<any> | null = null

  async embed(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
    const model = config.model || 'Xenova/all-MiniLM-L6-v2'
    await this.ensurePipeline(model, config.cacheDir)

    const results: number[][] = []
    for (const text of texts) {
      const output = await TransformersStrategy.pipeline(text, { pooling: 'mean', normalize: true })
      results.push(Array.from(output.data))
    }
    return results
  }

  /** 确保 pipeline 已加载 */
  private async ensurePipeline(model: string, cacheDir?: string): Promise<void> {
    if (TransformersStrategy.pipeline) return

    if (!TransformersStrategy.loadingPromise) {
      TransformersStrategy.loadingPromise = this.loadPipeline(model, cacheDir)
    }
    await TransformersStrategy.loadingPromise
  }

  /** 加载 Transformers.js pipeline */
  private async loadPipeline(model: string, cacheDir?: string): Promise<void> {
    logger.index.info('[EmbeddingService] 加载本地 Transformers 模型:', model)
    try {
      // @ts-ignore
      const { pipeline, env } = await import('@xenova/transformers')
      if (cacheDir) env.cacheDir = cacheDir
      env.allowLocalModels = false
      TransformersStrategy.pipeline = await pipeline('feature-extraction', model, { quantized: true })
      logger.index.info('[EmbeddingService] 本地模型加载完成')
    } catch (e) {
      logger.index.error('[EmbeddingService] 本地模型加载失败:', e)
      TransformersStrategy.loadingPromise = null
      throw e
    }
  }
}

/* ------------------------------------------------------------------ */
/* 池化工具                                                           */
/* ------------------------------------------------------------------ */

/** 向量池化工具 */
class PoolingUtil {
  /** 平均池化：将 token 级嵌入聚合为句子级嵌入 */
  static mean(tokenEmbeddings: number[][]): number[] {
    if (tokenEmbeddings.length === 0) return []
    const dim = tokenEmbeddings[0].length
    const result = new Array(dim).fill(0)
    for (const emb of tokenEmbeddings) {
      for (let i = 0; i < dim; i++) result[i] += emb[i]
    }
    for (let i = 0; i < dim; i++) result[i] /= tokenEmbeddings.length
    return result
  }
}

/* ------------------------------------------------------------------ */
/* Provider 注册表                                                    */
/* ------------------------------------------------------------------ */

/** 管理各 Provider 的嵌入策略 */
class ProviderRegistry {
  private readonly strategies = new Map<EmbeddingProvider, EmbeddingStrategy>()

  constructor() {
    this.register('jina', new JinaStrategy())
    this.register('voyage', new VoyageStrategy())
    this.register('openai', new OpenAIStrategy())
    this.register('cohere', new CohereStrategy())
    this.register('huggingface', new HuggingFaceStrategy())
    this.register('ollama', new OllamaStrategy())
    this.register('transformers', new TransformersStrategy())
    this.register('custom', new CustomStrategy())
  }

  /** 注册 Provider 策略 */
  register(provider: EmbeddingProvider, strategy: EmbeddingStrategy): void {
    this.strategies.set(provider, strategy)
  }

  /** 获取指定 Provider 的策略 */
  get(provider: EmbeddingProvider): EmbeddingStrategy {
    const strategy = this.strategies.get(provider)
    if (!strategy) throw new Error(`不支持的嵌入 Provider: ${provider}`)
    return strategy
  }
}

/* ------------------------------------------------------------------ */
/* 嵌入服务（外观）                                                   */
/* ------------------------------------------------------------------ */

/** 向量嵌入服务 — 协调限流、重试、批次与 Provider 分发 */
export class EmbeddingService {
  private config: EmbeddingConfig
  private rateGate: TokenBucketRateGate
  private batchSplitter: BatchSplitter
  private readonly retryExecutor = new RetryExecutor()
  private readonly modelValidator = new ModelValidator()
  private readonly providerRegistry = new ProviderRegistry()
  private llmConfig: LLMConfig | null = null
  private useLLMEmbeddings = false

  constructor(config: EmbeddingConfig, llmConfig?: LLMConfig) {
    this.config = {
      ...config,
      model: this.modelValidator.resolve(config.provider, config.model),
    }
    const limits = PROVIDER_RATE_LIMITS[config.provider]
    this.rateGate = new TokenBucketRateGate(limits.rpm)
    this.batchSplitter = new BatchSplitter(limits.batchSize)

    if (llmConfig && config.provider === 'custom' && !config.baseUrl) {
      this.llmConfig = llmConfig
      this.useLLMEmbeddings = true
    }
  }

  /** 设置 LLM 配置 */
  setLLMConfig(llmConfig: LLMConfig): void {
    this.llmConfig = llmConfig
    if (this.config.provider === 'custom' && !this.config.baseUrl) {
      this.useLLMEmbeddings = true
    }
  }

  /** 更新配置 */
  updateConfig(config: Partial<EmbeddingConfig>): void {
    const newProvider = config.provider || this.config.provider
    const providerChanged = config.provider && config.provider !== this.config.provider
    const modelToUse = providerChanged ? config.model : (config.model || this.config.model)
    const newModel = this.modelValidator.resolve(newProvider, modelToUse)

    this.config = { ...this.config, ...config, model: newModel }

    if (config.provider) {
      const limits = PROVIDER_RATE_LIMITS[config.provider]
      this.rateGate = new TokenBucketRateGate(limits.rpm)
      this.batchSplitter = new BatchSplitter(limits.batchSize)
    }
  }

  /** 获取单个文本的嵌入向量 */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text])
    return results[0]
  }

  /** 批量获取嵌入向量（自动分批 + 限流 + 重试） */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: number[][] = []
    for (const batch of this.batchSplitter.split(texts)) {
      await this.rateGate.acquire()
      const batchResults = await this.retryExecutor.execute(() => this.embedSingle(batch))
      results.push(...batchResults)
    }
    return results
  }

  /** 单次嵌入请求（不带重试） */
  private async embedSingle(texts: string[]): Promise<number[][]> {
    if (this.useLLMEmbeddings && this.llmConfig) return this.embedLLM(texts)
    const strategy = this.providerRegistry.get(this.config.provider)
    return strategy.embed(texts, this.config)
  }

  /** 使用 LLM 配置的嵌入 */
  private async embedLLM(texts: string[]): Promise<number[][]> {
    if (!this.llmConfig) throw new Error('未设置 LLM 配置，请先调用 setLLMConfig()')
    const { EmbeddingService: LLMEmbeddingService } = await import(
      '../modules/ai-provider/services/VectorEmbeddingEngine'
    )
    const service = new LLMEmbeddingService()
    const response = await service.embedMany(texts, this.llmConfig)
    return response.data
  }

  /** 测试连接 */
  async testConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const start = Date.now()
    try {
      await this.embed('test connection')
      return { success: true, latency: Date.now() - start }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
