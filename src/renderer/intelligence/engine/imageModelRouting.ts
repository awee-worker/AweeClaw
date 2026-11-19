/**
 * 图像生成模型的对话路由
 *
 * 用户可能在模型选择器里选中一个「图像生成」模型（如 wan2.7-image、qwen-image），
 * 然后直接在对话框里说「生成一张图」。这类模型只产出图片、不产出 assistant 文本，
 * 把对话请求发给它必然被服务端按 messages 结构拒绝：
 *
 *   Input should be 'user': input.messages.0.role
 *   Input should be a valid list: input.messages.0.content
 *
 * 报错信息对用户没有任何指导价值，且不是偶发——只要用它对话就会复现。
 * 因此本轮请求在发出去之前改道：换回一个可用的对话模型，并在系统提示词里
 * 说明「用户当前选择的是图像模型 X，生图请用 generate_image 工具并指定该模型」，
 * 由对话模型去调用文生图插件。
 *
 * 这样既不会打断用户的操作流，也不需要让图像模型去承担它不具备的能力。
 */

import { BUILTIN_PROVIDERS } from '@shared/configuration/aiProviders'
import type { ProviderModelConfig } from '@shared/configuration/preferenceSync'
import { inferCapabilities, type ModelCapability } from '@renderer/types/modelProvider'
import type { LLMConfig } from '@intelligence/providerTypes'

/** 可作为对话模型的兜底配置 */
export interface ChatModelFallback {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
}

/**
 * 解析某模型实际生效的能力标签
 *
 * 用户在「模型服务」里改过的标签是权威值；没有配置过才按模型名推断。
 * 两处口径必须一致，否则同一个模型在选择器里显示「图片生成」，
 * 在这里却被当成对话模型放行。
 */
export function resolveModelCapabilities(
  modelId: string,
  providerId: string | undefined,
  providerConfigs: Record<string, ProviderModelConfig>,
): ModelCapability[] {
  const configured = providerId ? providerConfigs[providerId]?.modelConfigs?.[modelId]?.capabilities : undefined
  if (configured && configured.length > 0) return configured
  return inferCapabilities(modelId)
}

/**
 * 该模型是否只能生图、不能对话
 *
 * 判定条件是「带 image-gen 且不带 llm」：
 * 将来若出现既能对话又能生图的多模态模型，它会被判为可对话，不会被本路由拦截。
 */
export function isImageGenerationOnlyModel(
  modelId: string,
  providerId: string | undefined,
  providerConfigs: Record<string, ProviderModelConfig>,
): boolean {
  if (!modelId) return false
  const caps = resolveModelCapabilities(modelId, providerId, providerConfigs)
  return caps.includes('image-gen') && !caps.includes('llm')
}

/** 某服务商下已启用、已填凭证的模型 id 列表 */
function enabledModelIds(providerId: string, config: ProviderModelConfig): string[] {
  const custom = config.customModels || []
  if (custom.length > 0) {
    const modelConfigs = config.modelConfigs || {}
    return custom.filter((id) => id && modelConfigs[id]?.enabled === true)
  }
  // 内置服务商可能只配了密钥、没显式启用过模型，此时退回它的默认模型
  const builtin = BUILTIN_PROVIDERS[providerId]
  return builtin?.defaultModel ? [builtin.defaultModel] : []
}

/**
 * 找一个可用的对话模型来承载本轮请求
 *
 * 优先同一个服务商：切换 provider 往往意味着切换 apiKey 与接入地址，
 * 能不动就不动，减少一层失败可能。
 */
export function findChatModelFallback(
  current: { provider: string; model: string },
  providerConfigs: Record<string, ProviderModelConfig>,
): ChatModelFallback | null {
  const providerOrder = [
    current.provider,
    ...Object.keys(providerConfigs).filter((id) => id !== current.provider),
  ]

  for (const providerId of providerOrder) {
    const config = providerConfigs[providerId]
    // 云端模式没有本地 apiKey，这里只处理本地配置好的服务商
    if (!config?.enabled || !config.apiKey) continue

    const builtin = BUILTIN_PROVIDERS[providerId]
    const baseUrl = config.baseUrl || builtin?.baseUrl

    for (const modelId of enabledModelIds(providerId, config)) {
      if (providerId === current.provider && modelId === current.model) continue
      if (isImageGenerationOnlyModel(modelId, providerId, providerConfigs)) continue
      return { provider: providerId, model: modelId, apiKey: config.apiKey, baseUrl }
    }
  }

  return null
}

/**
 * 为「图像模型被选为对话模型」的场景构造系统提示词补充说明
 *
 * 明确告诉对话模型：不要自己描述图片，而是调用生图工具，并把模型名传下去。
 */
export function buildImageModelRoutingNotice(params: {
  imageModel: string
  providerId: string
  language: 'zh' | 'en'
}): string {
  const { imageModel, providerId, language } = params
  if (language === 'en') {
    return [
      `[Runtime routing] The user selected "${imageModel}" (provider: ${providerId}) as the chat model.`,
      'That model can only generate images and cannot hold a conversation, so this request is handled by a chat model instead.',
      `When the user asks for an image, call the generate_image tool with the prompt, and set model="${imageModel}" and provider="${providerId}" so the configured image model is used.`,
      'Do not claim you cannot generate images — the tool is available.',
    ].join(' ')
  }
  return [
    `[运行时路由] 用户当前选择的对话模型是图像生成模型「${imageModel}」（服务商：${providerId}）。`,
    '该模型只能生成图片、无法承担对话，本轮请求已自动改用对话模型处理。',
    `当用户提出生图需求时，请调用 generate_image 工具，并在调用时指定 model="${imageModel}"、provider="${providerId}"，以使用用户配置的图像模型。`,
    '不要回答"我无法生成图片"——工具是可用的。',
  ].join('')
}

/** 改道结果 */
export interface ImageModelRoutingResult {
  /** 实际用于本轮请求的配置（未改道时等于入参） */
  config: LLMConfig
  /** 需要静默附加给模型的说明 */
  notice?: string
  /** 无法改道时面向用户的原因 */
  error?: string
}

/**
 * 图像模型改道：把「图像模型被选为对话模型」这一情形收敛成一个入口
 *
 * 未命中时原样返回，调用方无需判断；命中且找不到替代对话模型时只返回 error，
 * 由调用方展示——不抛异常，避免把可读提示变成一次「未知错误」。
 */
export function routeImageModelSelection(
  config: LLMConfig,
  providerConfigs: Record<string, ProviderModelConfig>,
  language: 'zh' | 'en',
): ImageModelRoutingResult {
  if (!isImageGenerationOnlyModel(config.model, config.provider, providerConfigs)) {
    return { config }
  }

  const fallback = findChatModelFallback(
    { provider: config.provider, model: config.model },
    providerConfigs,
  )

  if (!fallback) {
    return {
      config,
      error:
        language === 'zh'
          ? `当前选择的「${config.model}」是图像生成模型，不能用于对话；同时没有找到可用的对话模型。请到「设置 → 模型服务」启用一个对话模型（如 qwen-max）后再试。`
          : `"${config.model}" is an image generation model and cannot hold a conversation. No chat model is available either — enable one in Settings → Model Services and retry.`,
    }
  }

  return {
    config: {
      ...config,
      provider: fallback.provider,
      model: fallback.model,
      apiKey: fallback.apiKey,
      baseUrl: fallback.baseUrl,
    },
    notice: buildImageModelRoutingNotice({
      imageModel: config.model,
      providerId: config.provider,
      language,
    }),
  }
}
