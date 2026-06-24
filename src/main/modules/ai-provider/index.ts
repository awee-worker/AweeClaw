/**
 * AI Provider 服务入口
 *
 * 统一导出 LLM 服务、模型工厂与类型定义：
 * - LLMService：流式对话、同步生成、结构化输出、Embeddings
 * - createModel：模型实例工厂
 * - 类型定义：CodeAnalysis / Refactoring / CodeFix / TestCase / LLMResponse
 */

export { LLMService, LLMError } from './AIProviderService'
export type { CodeAnalysis, Refactoring, CodeFix, TestCase, LLMResponse } from './providerTypes'
export { createModel } from './modelRegistry'
