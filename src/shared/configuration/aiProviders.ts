/**
 * Provider 定义与协议助手 — 集中管理 AI Provider 配置
 */

import { LLM_DEFAULTS } from './defaultProfile'

export type AuthType = 'bearer' | 'api-key' | 'header' | 'query' | 'none'
export type ApiProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'google' | 'custom'
export type OpenAICompatibilityProfile = 'compatible' | 'full'

export interface AuthConfig {
  type: AuthType
  placeholder?: string
  helpUrl?: string
}

export interface ProtocolConfig {
  authHeader?: {
    name: string
    template: string
  }
  staticHeaders?: Record<string, string>
}

export interface ProviderFeatures {
  streaming: boolean
  tools: boolean
  vision?: boolean
  reasoning?: boolean
}

export interface LLMDefaults {
  maxTokens: number
  temperature: number
  topP: number
  timeout: number
}

export interface BaseProviderConfig {
  id: string
  displayName: string
  description: string
  baseUrl: string
  models: string[]
  defaultModel: string
  protocol: ApiProtocol
  features: ProviderFeatures
  defaults: LLMDefaults
  auth: AuthConfig
}

export interface BuiltinProviderDef extends BaseProviderConfig {
  readonly isBuiltin: true
}

export interface CustomProviderConfig extends BaseProviderConfig {
  isBuiltin: false
  createdAt?: number
  updatedAt?: number
}

export interface UserProviderConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  model?: string
  customModels?: string[]
  headers?: Record<string, string>
  openAICompatibilityProfile?: OpenAICompatibilityProfile
  displayName?: string
  protocol?: ApiProtocol
  createdAt?: number
  updatedAt?: number
}

const PROTOCOL_CONFIGS: Record<ApiProtocol, ProtocolConfig> = {
  openai: {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  'openai-responses': {
    authHeader: {
      name: 'Authorization',
      template: 'Bearer {{apiKey}}',
    },
  },
  anthropic: {
    authHeader: {
      name: 'x-api-key',
      template: '{{apiKey}}',
    },
    staticHeaders: {
      'anthropic-version': '2023-06-01',
    },
  },
  google: {
    authHeader: {
      name: 'x-goog-api-key',
      template: '{{apiKey}}',
    },
  },
  custom: {},
}

export function getProtocolConfig(protocol: ApiProtocol): ProtocolConfig {
  return PROTOCOL_CONFIGS[protocol] || {}
}

export function getDefaultHeadersByProtocol(protocol: ApiProtocol): Record<string, string> {
  const config = getProtocolConfig(protocol)
  const headers: Record<string, string> = {}

  if (config.authHeader) {
    headers[config.authHeader.name] = config.authHeader.template
  }

  if (config.staticHeaders) {
    Object.assign(headers, config.staticHeaders)
  }

  return headers
}

export function getProviderDefaultHeaders(
  providerId: string,
  customProtocol?: ApiProtocol,
): Record<string, string> {
  const builtinProvider = BUILTIN_PROVIDERS[providerId]
  if (builtinProvider) {
    return getDefaultHeadersByProtocol(builtinProvider.protocol)
  }

  if (customProtocol) {
    return getDefaultHeadersByProtocol(customProtocol)
  }

  return {}
}

export function replaceHeaderTemplates(
  headers: Record<string, string>,
  apiKey: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = value.replace(/\{\{apiKey\}\}/g, apiKey)
  }
  return result
}

export const BUILTIN_PROVIDERS: Record<string, BuiltinProviderDef> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    description: 'GPT-4, GPT-4o, o-series, and GPT-5 models',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
    defaultModel: 'gpt-4o',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-proj-...', helpUrl: 'https://platform.openai.com/api-keys' },
    isBuiltin: true,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5 and Claude 4 models',
    baseUrl: 'https://api.anthropic.com',
    models: [],
    defaultModel: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'api-key', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    isBuiltin: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro and Gemini Flash models',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [],
    defaultModel: 'gemini-2.0-flash-exp',
    protocol: 'google',
    features: { streaming: true, tools: true, vision: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'query', placeholder: 'AIzaSy...', helpUrl: 'https://aistudio.google.com/apikey' },
    isBuiltin: true,
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek-V3, DeepSeek-R1 推理模型',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [],
    defaultModel: 'deepseek-chat',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.deepseek.com/api_keys' },
    isBuiltin: true,
  },
  qwen: {
    id: 'qwen',
    displayName: '阿里云百炼',
    description: '阿里云百炼平台（原 DashScope），通义千问 Qwen-Max, Qwen-Plus, Qwen-Turbo 系列模型',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [],
    defaultModel: 'qwen-max',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key' },
    isBuiltin: true,
  },
  zhipu: {
    id: 'zhipu',
    displayName: '智谱 AI',
    description: 'GLM-4, GLM-4V, GLM-4-Flash 系列模型',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [],
    defaultModel: 'glm-4-plus',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
    isBuiltin: true,
  },
  moonshot: {
    id: 'moonshot',
    displayName: '月之暗面 Kimi',
    description: 'Moonshot AI 的 Kimi 大模型，擅长长文本处理',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [],
    defaultModel: 'moonshot-v1-8k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.moonshot.cn/console/api-keys' },
    isBuiltin: true,
  },
  doubao: {
    id: 'doubao',
    displayName: '火山方舟（豆包）',
    description: '字节跳动火山方舟平台，豆包 Doubao-Pro, Doubao-Lite 系列模型',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [],
    defaultModel: 'doubao-pro-32k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
    isBuiltin: true,
  },
  baichuan: {
    id: 'baichuan',
    displayName: '百川智能',
    description: 'Baichuan4, Baichuan3-Turbo 系列模型',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    models: [],
    defaultModel: 'Baichuan4',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.baichuan-ai.com/console/apikey' },
    isBuiltin: true,
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    description: 'MiniMax 大模型，Abab 系列及海螺AI',
    baseUrl: 'https://api.minimax.chat/v1',
    models: [],
    defaultModel: 'MiniMax-Text-01',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.minimaxi.com/user-center/basic-information' },
    isBuiltin: true,
  },
  xiaomi: {
    id: 'xiaomi',
    displayName: '小米 MiMo',
    description: 'MiMo-V2.5-Pro 推理模型，MiMo-V2 系列，MiMo-V2-Omni 多模态',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: [],
    defaultModel: 'mimo-v2.5-pro',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 0.95, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.xiaomimimo.com/#/console/api-keys' },
    isBuiltin: true,
  },
  yi: {
    id: 'yi',
    displayName: '零一万物',
    description: 'Yi-Lightning, Yi-Vision 系列模型',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    models: [],
    defaultModel: 'yi-lightning',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.lingyiwanwu.com/apikeys' },
    isBuiltin: true,
  },
  stepfun: {
    id: 'stepfun',
    displayName: '阶跃星辰',
    description: 'Step-2, Step-1.5V 多模态系列模型',
    baseUrl: 'https://api.stepfun.com/v1',
    models: [],
    defaultModel: 'step-2-16k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.stepfun.com/api-key' },
    isBuiltin: true,
  },
  siliconflow: {
    id: 'siliconflow',
    displayName: '硅基流动 SiliconFlow',
    description: '硅基流动，汇聚多种开源模型推理服务',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [],
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://cloud.siliconflow.cn/account/ak' },
    isBuiltin: true,
  },
  hunyuan: {
    id: 'hunyuan',
    displayName: '腾讯混元',
    description: '腾讯混元大模型，Hunyuan TurboS / T1 / Vision 系列',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: [],
    defaultModel: 'hunyuan-turbos-latest',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://console.cloud.tencent.com/hunyuan/api-key' },
    isBuiltin: true,
  },
  qianfan: {
    id: 'qianfan',
    displayName: '百度千帆',
    description: '百度千帆平台，文心 ERNIE 系列及平台上的第三方模型',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: [],
    defaultModel: 'ernie-4.5-turbo-128k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'bce-v3/ALTAK-...', helpUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list' },
    isBuiltin: true,
  },
  spark: {
    id: 'spark',
    displayName: '讯飞星火',
    description: '讯飞星火认知大模型，API Key 填 APIPassword 或「AK:SK」拼接串',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    models: [],
    defaultModel: 'generalv3.5',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'APIPassword 或 AK:SK', helpUrl: 'https://console.xfyun.cn/app/myapp' },
    isBuiltin: true,
  },
  xai: {
    id: 'xai',
    displayName: 'xAI Grok',
    description: 'xAI 的 Grok 系列模型',
    baseUrl: 'https://api.x.ai/v1',
    models: [],
    defaultModel: 'grok-4',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'xai-...', helpUrl: 'https://console.x.ai/' },
    isBuiltin: true,
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral AI',
    description: 'Mistral Large, Mistral Small 系列模型',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [],
    defaultModel: 'mistral-large-latest',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://console.mistral.ai/api-keys' },
    isBuiltin: true,
  },
  groq: {
    id: 'groq',
    displayName: 'Groq',
    description: 'Groq 超低延迟推理服务，托管 Llama、Qwen、Kimi 等开源模型',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [],
    defaultModel: 'llama-3.3-70b-versatile',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'gsk_...', helpUrl: 'https://console.groq.com/keys' },
    isBuiltin: true,
  },
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    description: '统一聚合多家服务商模型，一个 Key 调用数百个模型',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
    defaultModel: 'openai/gpt-4o-mini',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-or-...', helpUrl: 'https://openrouter.ai/keys' },
    isBuiltin: true,
  },
  together: {
    id: 'together',
    displayName: 'Together AI',
    description: 'Together AI 开源模型托管服务',
    baseUrl: 'https://api.together.xyz/v1',
    models: [],
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://api.together.xyz/settings/api-keys' },
    isBuiltin: true,
  },
  perplexity: {
    id: 'perplexity',
    displayName: 'Perplexity',
    description: 'Perplexity Sonar 联网检索增强模型',
    baseUrl: 'https://api.perplexity.ai',
    models: [],
    defaultModel: 'sonar',
    protocol: 'openai',
    features: { streaming: true, tools: false, vision: false, reasoning: true },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'pplx-...', helpUrl: 'https://www.perplexity.ai/settings/api' },
    isBuiltin: true,
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    description: '本地运行开源大模型，无需 API Key',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    defaultModel: 'qwen3:8b',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: LLM_DEFAULTS.maxTokens, temperature: 0.7, topP: 1, timeout: 300000 },
    auth: { type: 'none', placeholder: '', helpUrl: 'https://ollama.com' },
    isBuiltin: true,
  },
}

export function getBuiltinProviderIds(): string[] {
  return Object.keys(BUILTIN_PROVIDERS)
}

export function isBuiltinProvider(providerId: string): boolean {
  return providerId in BUILTIN_PROVIDERS
}

export function getBuiltinProvider(providerId: string): BuiltinProviderDef | undefined {
  return BUILTIN_PROVIDERS[providerId]
}

export function getProviderDefaultModel(providerId: string): string {
  return BUILTIN_PROVIDERS[providerId]?.defaultModel || ''
}

export function getProviderProtocol(providerId: string): ApiProtocol {
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.protocol || 'openai'
}

export function isOpenAIStyleProtocol(
  protocol: ApiProtocol | undefined,
): protocol is 'openai' | 'openai-responses' {
  return protocol === 'openai' || protocol === 'openai-responses'
}

export function getDefaultOpenAICompatibilityProfile(
  providerId: string,
  protocol: ApiProtocol | undefined,
): OpenAICompatibilityProfile | undefined {
  if (!isOpenAIStyleProtocol(protocol)) {
    return undefined
  }

  if (providerId === 'openai' || protocol === 'openai-responses') {
    return 'full'
  }

  return 'compatible'
}

export function resolveOpenAICompatibilityProfile(
  providerId: string,
  protocol: ApiProtocol | undefined,
  configuredProfile?: OpenAICompatibilityProfile,
): OpenAICompatibilityProfile | undefined {
  return configuredProfile ?? getDefaultOpenAICompatibilityProfile(providerId, protocol)
}

export function supportsFullOpenAIStyleFeatures(
  providerId: string,
  protocol: ApiProtocol | undefined,
  configuredProfile?: OpenAICompatibilityProfile,
): boolean {
  return resolveOpenAICompatibilityProfile(providerId, protocol, configuredProfile) === 'full'
}

/** @deprecated Use BUILTIN_PROVIDERS directly. */
export const PROVIDERS = BUILTIN_PROVIDERS
