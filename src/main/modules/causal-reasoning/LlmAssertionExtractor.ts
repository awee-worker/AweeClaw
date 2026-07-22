/**
 * LLM 因果断言抽取器
 *
 * 职责：
 * - 调用主进程 AIProviderService（LLMService）抽取因果断言
 * - 使用结构化输出（JSON Schema）确保结果可解析
 * - 支持 cause/effect/relation/strength/confidence 字段
 * - 失败时返回空数组，不阻塞规则抽取
 *
 * 设计要点：
 * - 独立于渲染层，主进程直调，避免 IPC 来回开销
 * - 懒加载 LLMService，避免模块加载时循环依赖
 * - 提示词模板支持中英文双语
 *
 * @module causal-reasoning/LlmAssertionExtractor
 */

import { logger } from '@shared/toolkit/LogEngine';
import type { ExtractedAssertion, CausalEdgeRelation } from './CausalReasoningInterface';

// ============================================================
// 常量
// ============================================================

/** LLM 抽取的置信度阈值（低于此值的断言会被过滤） */
const DEFAULT_MIN_CONFIDENCE = 0.5;

/** LLM 调用超时（ms） */
const LLM_TIMEOUT_MS = 30000;

/** 最大输入文本长度（超出截断） */
const MAX_INPUT_TEXT_LENGTH = 8000;

/** 最大抽取断言数（防止单次抽取过多） */
const MAX_ASSERTIONS_PER_EXTRACTION = 20;

// ============================================================
// 类型定义
// ============================================================

/** LLM 抽取的单条断言（原始结构） */
interface LlmAssertionRaw {
  cause: string;
  effect: string;
  relation?: string;
  strength?: number;
  confidence?: number;
  evidence?: string;
}

/** LLM 抽取结果（结构化输出 schema） */
interface LlmExtractionResult {
  assertions: LlmAssertionRaw[];
}

/** LLM 配置（最小接口，与 LLMConfig 兼容） */
interface LlmConfigLike {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/** LLM 服务最小接口（与 LLMService.generateStructuredObject 兼容） */
interface LlmServiceLike {
  generateStructuredObject<T>(params: {
    config: LlmConfigLike;
    schema: unknown;
    system: string;
    prompt: string;
  }): Promise<{ data: T }>;
}

// ============================================================
// 提示词模板
// ============================================================

const SYSTEM_PROMPT = `你是一个因果推理专家，负责从自然语言文本中抽取因果断言。

任务：
1. 识别文本中的因果关系（A 导致 B、A 引发 B、A 影响 B 等）
2. 为每条断言分配关系类型和强度

关系类型（relation）必须为以下之一：
- "causes"：A 直接导致 B（强因果）
- "enables"：A 使能 B（A 是 B 发生的必要条件）
- "prevents"：A 阻止 B（A 导致 B 不发生）
- "inhibits"：A 抑制 B（弱负因果）

强度（strength）取值范围 [0, 1]：
- 0.9-1.0：明确的直接因果
- 0.7-0.9：较强因果
- 0.5-0.7：中等因果
- 0.3-0.5：弱因果
- 0.0-0.3：微弱关联

置信度（confidence）取值范围 [0, 1]：表示对这条断言正确性的把握程度。

输出格式：严格的 JSON 对象，包含 assertions 数组。`;

const USER_PROMPT_TEMPLATE = `请从以下文本中抽取因果断言。

要求：
1. 只抽取明确表达因果关系的断言，不臆测
2. cause 和 effect 使用简洁的名词短语（≤20 字）
3. 如果文本中没有因果关系，返回空数组
4. 最多抽取 ${MAX_ASSERTIONS_PER_EXTRACTION} 条断言

文本：
"""
{text}
"""

请以 JSON 格式返回：`;

// ============================================================
// JSON Schema（结构化输出约束）
// ============================================================

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    assertions: {
      type: 'array',
      maxItems: MAX_ASSERTIONS_PER_EXTRACTION,
      items: {
        type: 'object',
        properties: {
          cause: {
            type: 'string',
            maxLength: 100,
            description: '原因节点名（简洁名词短语）',
          },
          effect: {
            type: 'string',
            maxLength: 100,
            description: '结果节点名（简洁名词短语）',
          },
          relation: {
            type: 'string',
            enum: ['causes', 'enables', 'prevents', 'inhibits'],
            description: '关系类型',
          },
          strength: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '因果强度 [0, 1]',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '断言置信度 [0, 1]',
          },
          evidence: {
            type: 'string',
            maxLength: 200,
            description: '支撑断言的原文片段',
          },
        },
        required: ['cause', 'effect', 'relation', 'strength', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['assertions'],
  additionalProperties: false,
};

// ============================================================
// LlmAssertionExtractor 实现
// ============================================================

export class LlmAssertionExtractor {
  /** LLM 服务实例（懒加载） */
  private llmService: LlmServiceLike | null = null;

  /** LLM 配置 */
  private llmConfig: LlmConfigLike | null = null;

  /** 是否已初始化 */
  private initialized = false;

  /**
   * 初始化抽取器
   *
   * @param llmService LLM 服务实例（LLMService）
   * @param llmConfig LLM 配置（model + apiKey + baseUrl 等）
   */
  initialize(llmService: LlmServiceLike, llmConfig: LlmConfigLike): void {
    this.llmService = llmService;
    this.llmConfig = llmConfig;
    this.initialized = true;
    logger.causal?.info(
      '[LlmAssertionExtractor] 已初始化，模型:',
      llmConfig.model,
    );
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** 重置（清除 LLM 配置） */
  reset(): void {
    this.llmService = null;
    this.llmConfig = null;
    this.initialized = false;
    logger.causal?.info('[LlmAssertionExtractor] 已重置');
  }

  /**
   * 从文本抽取因果断言
   *
   * @param sourceText 原始文本
   * @param minConfidence 最小置信度阈值
   * @returns 抽取的断言数组（失败时返回空数组）
   */
  async extract(
    sourceText: string,
    minConfidence: number = DEFAULT_MIN_CONFIDENCE,
  ): Promise<ExtractedAssertion[]> {
    if (!this.initialized || !this.llmService || !this.llmConfig) {
      logger.causal?.warn('[LlmAssertionExtractor] 未初始化，跳过 LLM 抽取');
      return [];
    }

    // 截断过长的输入文本
    const truncatedText =
      sourceText.length > MAX_INPUT_TEXT_LENGTH
        ? sourceText.slice(0, MAX_INPUT_TEXT_LENGTH) +
          '\n...（文本已截断）'
        : sourceText;

    const prompt = USER_PROMPT_TEMPLATE.replace('{text}', truncatedText);

    try {
      logger.causal?.info(
        '[LlmAssertionExtractor] 开始抽取，文本长度:',
        truncatedText.length,
      );

      const result = await this.callWithTimeout(
        this.llmService.generateStructuredObject<LlmExtractionResult>({
          config: this.llmConfig,
          schema: EXTRACTION_SCHEMA,
          system: SYSTEM_PROMPT,
          prompt,
        }),
        LLM_TIMEOUT_MS,
      );

      const rawAssertions = result?.data?.assertions || [];
      if (!Array.isArray(rawAssertions)) {
        logger.causal?.warn('[LlmAssertionExtractor] LLM 返回非数组');
        return [];
      }

      // 转换并过滤
      const assertions: ExtractedAssertion[] = [];
      for (const raw of rawAssertions) {
        const assertion = this.normalizeAssertion(raw, sourceText);
        if (!assertion) continue;

        const confidence =
          assertion.extractMeta?.confidence ?? DEFAULT_MIN_CONFIDENCE;
        if (confidence < minConfidence) continue;

        assertions.push(assertion);
      }

      logger.causal?.info(
        `[LlmAssertionExtractor] 抽取完成，有效断言 ${assertions.length}/${rawAssertions.length} 条`,
      );

      return assertions;
    } catch (err) {
      logger.causal?.warn(
        '[LlmAssertionExtractor] 抽取失败:',
        err instanceof Error ? err.message : String(err),
      );
      return [];
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 将 LLM 原始输出规范化为 ExtractedAssertion
   *
   * @returns 规范化后的断言，无效时返回 null
   */
  private normalizeAssertion(
    raw: LlmAssertionRaw,
    sourceText: string,
  ): ExtractedAssertion | null {
    const cause = raw.cause?.trim();
    const effect = raw.effect?.trim();
    if (!cause || !effect) return null;
    if (cause.length > 128 || effect.length > 128) return null;

    const relation = this.normalizeRelation(raw.relation);
    const strength = this.clamp(raw.strength ?? 0.5, 0, 1);
    const confidence = this.clamp(raw.confidence ?? 0.5, 0, 1);

    return {
      sourceText: raw.evidence || sourceText.slice(0, 200),
      causeName: cause,
      effectName: effect,
      relation,
      strength,
      extractor: 'llm',
      extractMeta: {
        confidence,
        template: 'llm_extraction',
        match: raw.evidence,
      },
    };
  }

  /** 规范化关系类型 */
  private normalizeRelation(relation?: string): CausalEdgeRelation {
    const valid: CausalEdgeRelation[] = ['causes', 'enables', 'prevents', 'inhibits'];
    if (relation && valid.includes(relation as CausalEdgeRelation)) {
      return relation as CausalEdgeRelation;
    }
    return 'causes';
  }

  /** 数值钳制 */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * 带超时的 Promise 调用
   *
   * @param promise 原始 Promise
   * @param timeoutMs 超时毫秒
   */
  private async callWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`LLM 调用超时（${timeoutMs}ms）`)),
        timeoutMs,
      );
    });
    return Promise.race([promise, timeout]) as Promise<T>;
  }
}

// ============================================================
// 单例导出
// ============================================================

export const llmAssertionExtractor = new LlmAssertionExtractor();
