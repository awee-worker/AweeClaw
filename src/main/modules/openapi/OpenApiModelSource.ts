/**
 * 对外 API 网关的「模型 / 智能体」来源解析（主进程）
 *
 * `/v1/models`、`/v1/agents`、`/v1/chat/completions` 三个端点都要读同一份用户配置，
 * 因此这里统一收口，避免三处各写一遍「怎么从 store 里挖出可用模型」。
 *
 * 原则：**只读用户已配置的内容，不硬编码模型清单**（内置 provider 的候选模型除外，
 * 那是 SDK 层的既有事实，不是这里新造的）。
 *
 * @module openapi/OpenApiModelSource
 */

import { getConfigStore } from '../../bootstrap/stores'
import { BUILTIN_PROVIDERS } from '@shared/configuration/aiProviders'
import {
  resolveRuntimeLLMConfig,
  resolveTaskLLMConfig,
} from '@shared/configuration/modelConfigResolver'
import { logger } from '@shared/toolkit/LogEngine'
import { OPEN_API_AGENT_MODEL_PREFIX } from '@shared/protocols/openApiProtocol'
import type { OpenAiAgentObject } from '@shared/protocols/openApiProtocol'
import type { LLMConfig } from '@protocols'

/** 从 store 读到的 app-settings 形状（只声明我们会读的键） */
interface AppSettingsShape {
  llmConfig?: Record<string, unknown>
  providerConfigs?: Record<string, unknown>
  customAgentProfiles?: Array<{
    id?: string
    name?: string
    description?: string
    systemPrompt?: string
    enabled?: boolean
    callable?: boolean
  }>
}

/** 读 app-settings（读取失败返回 null，调用方给出可读提示） */
function readAppSettings(): AppSettingsShape | null {
  try {
    const store = getConfigStore()
    const settings = store.get('app-settings') as AppSettingsShape | undefined
    return settings ?? null
  } catch (err) {
    logger.system.warn('[OpenApi] read app-settings failed:', err)
    return null
  }
}

/** 单一可用模型条目 */
export interface AvailableModelEntry {
  /** 对外的 model id（裸名，与 OpenAI 客户端习惯一致） */
  id: string
  /** 归属 provider id（用于冲突时区分与路由） */
  provider: string
  /** 是否当前正在用 */
  active: boolean
}

/**
 * 列出可用模型。
 *
 * 只列 **配了 apiKey 的 provider**：列出一堆连不上的模型，第三方客户端选了就报错，
 * 比不列更糟。当前 provider 优先排在最前，便于客户端默认选中。
 */
export function listAvailableModels(): AvailableModelEntry[] {
  const settings = readAppSettings()
  if (!settings) return []

  const providerConfigs = (settings.providerConfigs || {}) as Record<
    string,
    { apiKey?: string; model?: string; customModels?: string[] } | undefined
  >
  const activeProvider = (settings.llmConfig?.provider as string) || ''
  const activeModel = (settings.llmConfig?.model as string) || ''

  const byId = new Map<string, AvailableModelEntry>()

  const push = (id: string, provider: string, active: boolean): void => {
    const trimmed = (id || '').trim()
    if (!trimmed) return
    const existing = byId.get(trimmed)
    // 当前模型优先占用 id；其余先到先得
    if (existing && !active) return
    byId.set(trimmed, { id: trimmed, provider, active })
  }

  // 当前生效的模型排最前
  if (activeModel) push(activeModel, activeProvider, true)

  for (const [providerId, config] of Object.entries(providerConfigs)) {
    if (!config || !config.apiKey) continue
    const active = providerId === activeProvider
    if (config.model) push(config.model, providerId, active && config.model === activeModel)
    for (const custom of config.customModels || []) push(custom, providerId, false)
  }

  return [...byId.values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.id.localeCompare(b.id)
  })
}

/** 模型解析结果 */
export interface ResolvedModelRequest {
  /** 解析出的 LLM 配置（null = 失败，看 error） */
  config: LLMConfig | null
  /** 命中的自定义智能体 id（`agent:<id>` 形式时非空） */
  agentId?: string
  /** 该智能体的系统提示词（会覆盖默认 systemPrompt） */
  agentSystemPrompt?: string
  /** 失败原因（中文，可直接回给第三方客户端） */
  error?: string
}

/**
 * 解析请求里的 `model` 字段。
 *
 * 支持三种写法（越具体越优先）：
 *   1. `agent:<agentId>`  → 用该自定义智能体的人格，模型仍取当前配置
 *   2. `<providerId>:<model>` → 指定 provider 与模型
 *   3. `<model>` 或省略   → 用当前配置；若该模型名属于某个已配置 provider 则回退过去
 *
 * ⚠️ `agent:` 路由**只带人格、不带工具**：工具执行（写文件/跑命令）在渲染层，
 * 主进程没有沙箱与审批通道，让外部 API 直接跑本机工具是越权的。
 * 需要工具能力的场景走 `/mcp`（有独立开关 `allowDangerousToolCall`）。
 */
export function resolveModelRequest(modelField: string | undefined): ResolvedModelRequest {
  const settings = readAppSettings()
  if (!settings) {
    return { config: null, error: '本机配置读取失败，请重启 AweeClaw 后重试' }
  }

  const providerConfigs = (settings.providerConfigs || {}) as Record<string, never>
  const raw = (modelField || '').trim()

  // --- 1. agent:<id> ---
  if (raw.startsWith(OPEN_API_AGENT_MODEL_PREFIX)) {
    const agentId = raw.slice(OPEN_API_AGENT_MODEL_PREFIX.length).trim()
    const profiles = settings.customAgentProfiles || []
    const profile = profiles.find((p) => p.id === agentId)
    if (!profile) {
      return { config: null, error: `未找到智能体：${agentId}（可用列表见 GET /v1/agents）` }
    }
    const base = resolveRuntimeLLMConfig(settings.llmConfig as never, providerConfigs)
    if (!base.apiKey) return { config: null, error: NO_MODEL_MESSAGE }
    return {
      config: base,
      agentId,
      agentSystemPrompt: profile.systemPrompt || '',
    }
  }

  // --- 2. provider:model ---
  const colonIndex = raw.indexOf(':')
  if (colonIndex > 0) {
    const providerId = raw.slice(0, colonIndex).trim()
    const modelId = raw.slice(colonIndex + 1).trim()
    if (providerId && modelId) {
      const config = resolveTaskLLMConfig(
        providerId,
        modelId,
        providerConfigs,
        settings.llmConfig as never,
      )
      if (!config) {
        return { config: null, error: `模型不可用：${raw}（该服务商未配置 API Key）` }
      }
      return { config }
    }
  }

  // --- 3. 裸模型名 / 省略 ---
  const runtime = resolveRuntimeLLMConfig(settings.llmConfig as never, providerConfigs)

  if (!raw) {
    if (!runtime.apiKey) return { config: null, error: NO_MODEL_MESSAGE }
    return { config: runtime }
  }

  // 裸名匹配到了别的 provider → 回退到那个 provider（同名优先当前 provider）
  if (raw !== runtime.model) {
    const owner = findProviderForModel(raw, providerConfigs)
    if (owner) {
      const config = resolveTaskLLMConfig(owner, raw, providerConfigs, settings.llmConfig as never)
      if (config) return { config }
    }
  }

  if (!runtime.apiKey) return { config: null, error: NO_MODEL_MESSAGE }
  return { config: { ...runtime, model: raw } }
}

/** 找出提供该模型名的 provider（命中多个时返回第一个） */
function findProviderForModel(
  modelId: string,
  providerConfigs: Record<string, { apiKey?: string; model?: string; customModels?: string[] } | undefined>,
): string | null {
  for (const [providerId, config] of Object.entries(providerConfigs)) {
    if (!config?.apiKey) continue
    if (config.model === modelId) return providerId
    if ((config.customModels || []).includes(modelId)) return providerId
  }
  return null
}

/** 未配置模型时的统一提示 */
const NO_MODEL_MESSAGE = '本机未配置可用的大模型，请在 AweeClaw「设置 → 模型」中完成配置后重试'

/** 当前生效的模型 id（用于非流式/流式响应的 model 字段回填） */
export function getActiveModelId(): string {
  const settings = readAppSettings()
  return (settings?.llmConfig?.model as string) || 'aweeclaw'
}

/**
 * 列出可供外部调用的智能体。
 *
 * 只暴露**用户已启用**的：未启用的智能体在 AweeClaw 内部也不会被调度，
 * 对外列出会让人以为「配了就生效」。
 */
export function listAgents(): OpenAiAgentObject[] {
  const settings = readAppSettings()
  if (!settings) return []

  const activeProvider = (settings.llmConfig?.provider as string) || ''
  const activeModel = (settings.llmConfig?.model as string) || ''

  return (settings.customAgentProfiles || [])
    .filter((p) => p.enabled !== false && p.id)
    .map((p) => ({
      id: `agent:${p.id}`,
      name: p.name || p.id || '未命名智能体',
      description: p.description || '',
      model: activeModel || activeProvider || '',
    }))
}
