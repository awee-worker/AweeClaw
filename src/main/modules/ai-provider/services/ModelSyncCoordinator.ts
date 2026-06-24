/**
 * 同步生成服务 — 基于 AI SDK generateText 的非流式生成
 *
 * 职责：
 * - 调用 AI SDK 的 generateText 进行同步生成
 * - 支持工具调用与系统提示
 * - 为需要完整结果再处理的场景提供支持
 *
 * 差异化特性（相比基础实现）：
 * - 请求预处理管道（executePreparedRequest）
 * - 消息适配器（MessageConverter）
 * - 工具 Schema 适配器（ToolConverter）
 * - 统一的 Usage 转换（convertUsage）
 */

import { generateText } from 'ai'
import { logger } from '@shared/toolkit/LogEngine'
import { createModel } from '../modelRegistry'
import { MessageConverter } from '../core/MessageAdapter'
import { ToolConverter } from '../core/ToolSchemaAdapter'
import { executePreparedRequest } from '@modules/ai-provider/core/ModelRequestRunner'
import { LLMError, convertUsage } from '../providerTypes'
import type { LLMResponse } from '../providerTypes'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@protocols'

export interface SyncParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  timeout?: number
}

export class SyncService {
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter

  constructor() {
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  async generate(params: SyncParams): Promise<LLMResponse<string>> {
    const { config, messages, tools, systemPrompt, abortSignal, timeout } = params

    logger.system.info('[SyncService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
    })

    try {
      const model = createModel(config)
      const baseMessages = this.messageConverter.convert(messages, systemPrompt)
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      const result = await executePreparedRequest({
        config,
        operation: 'sync',
        originalMessages: messages,
        baseMessages,
        abortSignal,
        execute: async (prepared: any) =>
          await generateText({
            model,
            messages: prepared.messages,
            tools: coreTools,
            ...prepared.settings,
            ...prepared.callOptions,
            providerOptions: prepared.providerOptions,
            abortSignal,
            timeout: timeout ?? prepared.callOptions?.timeout ?? 120_000,
          }),
      })

      if (result.warnings && result.warnings.length > 0) {
        logger.llm.warn('[SyncService] Provider warnings', {
          provider: config.provider,
          model: config.model,
          warnings: result.warnings,
        })
      }

      return {
        data: result.text,
        usage: result.usage ? convertUsage(result.usage, result.providerMetadata) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
        toolCalls: result.toolCalls?.map((tc: any) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: (tc as any).input || (tc as any).args || {},
        })),
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[SyncService] Generation failed:', llmError)
      throw llmError
    }
  }
}
