/**
 * Provider 定义与协议助手 — 集中管理 AI Provider 配置
 */

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
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
    defaultModel: 'gpt-4o',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-proj-...', helpUrl: 'https://platform.openai.com/api-keys' },
    isBuiltin: true,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude 3.5 and Claude 4 models',
    baseUrl: 'https://api.anthropic.com',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'api-key', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
    isBuiltin: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    description: 'Gemini Pro and Gemini Flash models',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.5-pro-preview-05-06'],
    defaultModel: 'gemini-2.0-flash-exp',
    protocol: 'google',
    features: { streaming: true, tools: true, vision: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'query', placeholder: 'AIzaSy...', helpUrl: 'https://aistudio.google.com/apikey' },
    isBuiltin: true,
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek-V3, DeepSeek-R1 推理模型',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.deepseek.com/api_keys' },
    isBuiltin: true,
  },
  qwen: {
    id: 'qwen',
    displayName: '通义千问',
    description: 'Qwen-Max, Qwen-Plus, Qwen-Turbo 系列模型',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-vl-max', 'qwen-coder-plus'],
    defaultModel: 'qwen-max',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://dashscope.console.aliyun.com/apiKey' },
    isBuiltin: true,
  },
  zhipu: {
    id: 'zhipu',
    displayName: '智谱AI',
    description: 'GLM-4, GLM-4V, GLM-4-Flash 系列模型',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-0520', 'glm-4-flash', 'glm-4-long', 'glm-4v-plus', 'glm-4v-flash'],
    defaultModel: 'glm-4-plus',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
    isBuiltin: true,
  },
  moonshot: {
    id: 'moonshot',
    displayName: 'Moonshot AI',
    description: 'Kimi 大模型，擅长长文本处理',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.moonshot.cn/console/api-keys' },
    isBuiltin: true,
  },
  doubao: {
    id: 'doubao',
    displayName: '豆包',
    description: '字节跳动豆包大模型，Doubao-Pro, Doubao-Lite 系列',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k', 'doubao-lite-128k', 'doubao-vision-pro-32k'],
    defaultModel: 'doubao-pro-32k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
    isBuiltin: true,
  },
  baichuan: {
    id: 'baichuan',
    displayName: '百川智能',
    description: 'Baichuan4, Baichuan3-Turbo 系列模型',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k', 'Baichuan2-Turbo'],
    defaultModel: 'Baichuan4',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.baichuan-ai.com/console/apikey' },
    isBuiltin: true,
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    description: 'MiniMax 大模型，Abab 系列及海螺AI',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5-chat', 'abab6.5g-chat'],
    defaultModel: 'MiniMax-Text-01',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.minimaxi.com/user-center/basic-information' },
    isBuiltin: true,
  },
  xiaomi: {
    id: 'xiaomi',
    displayName: '小米 MiMo',
    description: 'MiMo-V2-Pro 推理模型，MiMo-V2-Flash 高效模型，MiMo-V2-Omni 多模态',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2-pro', 'mimo-v2-flash', 'mimo-v2-omni'],
    defaultModel: 'mimo-v2.5-pro',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 0.95, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://platform.xiaomimimo.com/#/console/api-keys' },
    isBuiltin: true,
  },
  yi: {
    id: 'yi',
    displayName: '零一万物',
    description: 'Yi-Lightning, Yi-Vision 系列模型',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark', 'yi-vision-v2'],
    defaultModel: 'yi-lightning',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.lingyiwanwu.com/apikeys' },
    isBuiltin: true,
  },
  stepfun: {
    id: 'stepfun',
    displayName: '阶跃星辰',
    description: 'Step-2, Step-1.5V 多模态系列模型',
    baseUrl: 'https://api.stepfun.com/v1',
    models: ['step-2-16k', 'step-1-8k', 'step-1.5v-8k'],
    defaultModel: 'step-2-16k',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: true, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: '...', helpUrl: 'https://platform.stepfun.com/api-key' },
    isBuiltin: true,
  },
  siliconflow: {
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    description: '硅基流动，汇聚多种开源模型推理服务',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'THUDM/glm-4-9b-chat',
      'meta-llama/Meta-Llama-3.1-70B-Instruct',
    ],
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: true },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 120000 },
    auth: { type: 'bearer', placeholder: 'sk-...', helpUrl: 'https://cloud.siliconflow.cn/account/ak' },
    isBuiltin: true,
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    description: '本地运行开源大模型，无需 API Key',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:8b', 'deepseek-r1:8b', 'llama3.1:8b', 'gemma3:4b', 'codellama:7b', 'mistral:7b'],
    defaultModel: 'qwen3:8b',
    protocol: 'openai',
    features: { streaming: true, tools: true, vision: false, reasoning: false },
    defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: 300000 },
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
  const provider = BUILTIN_PROVIDERS[providerId]
  return provider?.defaultModel || provider?.models[0] || ''
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
