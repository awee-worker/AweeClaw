/**
 * 工具转换器 — 把工具声明的 JSON Schema 原样交给 AI SDK
 *
 * 之前的实现用 `switch (type)` 把 JSON Schema 重建成 Zod，重建过程会丢掉
 * anyOf / oneOf / $ref / 联合类型（type 为数组）/ 数值范围 / additionalProperties
 * 等约束。MCP 工具里这些写法很常见，结果是模型收到的契约与插件真实契约不一致，
 * 参数校验形同虚设。
 *
 * AI SDK 提供 `jsonSchema()` 可直接透传原始 JSON Schema，因此这里不做任何
 * 有损转换。
 */

import { jsonSchema, tool } from '@ai-sdk/provider-utils'
import type { Tool } from '@ai-sdk/provider-utils'
import type { JSONSchema7 } from '@ai-sdk/provider'
import type { ToolDefinition } from '@protocols'

export class ToolConverter {
  /** 转换工具列表 */
  convert(tools: ToolDefinition[]): Record<string, Tool> {
    const result: Record<string, Tool> = {}

    for (const t of tools) {
      result[t.name] = tool({
        description: t.description,
        // 不做有损的 Zod 重建：anyOf / $ref / 联合类型 / 数值范围等约束
        // 才能原样到达模型。未声明 additionalProperties 时 JSON Schema 默认
        // 允许额外字段，与原有 passthrough 行为一致。
        inputSchema: jsonSchema<Record<string, unknown>>(toJSONSchema(t.parameters)),
        // 不提供 execute — 工具执行由外部处理
      })
    }

    return result
  }
}

/** 工具声明的 parameters 本身就是 JSON Schema 结构，这里只做类型对齐 */
function toJSONSchema(parameters: ToolDefinition['parameters']): JSONSchema7 {
  return parameters as unknown as JSONSchema7
}

