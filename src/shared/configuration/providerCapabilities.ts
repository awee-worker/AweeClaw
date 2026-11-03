/**
 * 服务商能力声明 — `BUILTIN_PROVIDERS[*].features` 的唯一消费入口
 *
 * `features` 描述的是**协议层面**的能力（这个接口是否支持流式、工具调用、
 * 图片输入、推理参数），而不是某个具体模型的能力。模型级能力仍由模型名
 * 推导（见 modelCapabilityProfile），两者职责不同：
 *
 * - 服务商说「这个接口不支持工具调用」→ 请求里不要再带 tools；
 * - 模型名说「这是视觉模型」→ 界面标 Vision 标签。
 *
 * 把 `features` 收进这里，是为了避免各调用点各自 `BUILTIN_PROVIDERS[id].features.xxx`
 * 取字段时对可空字段做出不一致的兜底。
 */

import { BUILTIN_PROVIDERS, type ApiProtocol } from './aiProviders'

export interface ProviderCapabilities {
  streaming: boolean
  tools: boolean
  vision: boolean
  reasoning: boolean
}

/** 自定义端点按协议给出的保守默认值 */
const PROTOCOL_FALLBACK: ProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: false,
  reasoning: false,
}

/**
 * 解析服务商能力。
 *
 * @param providerId provider 标识
 * @param protocol 显式协议（自定义 provider 用它推断能力边界）
 */
export function resolveProviderCapabilities(
  providerId: string,
  _protocol?: ApiProtocol,
): ProviderCapabilities {
  const builtin = BUILTIN_PROVIDERS[providerId]

  if (!builtin) {
    return { ...PROTOCOL_FALLBACK }
  }

  return {
    streaming: builtin.features.streaming,
    tools: builtin.features.tools,
    vision: builtin.features.vision ?? false,
    reasoning: builtin.features.reasoning ?? false,
  }
}

/** 该服务商在当前配置下是否允许发送工具定义 */
export function providerSupportsTools(
  providerId: string,
  protocol?: ApiProtocol,
): boolean {
  return resolveProviderCapabilities(providerId, protocol).tools
}
