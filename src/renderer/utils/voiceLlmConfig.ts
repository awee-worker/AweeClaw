/**
 * 语音 LLM 配置解析工具
 *
 * 主窗口 useVoiceChat 与头像窗口 useAvatarVoiceChat 共享。
 *
 * 核心职责：云端模式兜底补全。
 *
 * 背景：authSlice.cloudMode === 'cloud' 时，llmConfig 中的 cloudMode 字段可能缺失
 * （llmConfig 来自 provider 配置，cloudMode/serverUrl/accessToken 由 auth 层维护）。
 * 此时若不补全，主进程会误用本地 apiKey 走直连，而非后端代理。
 * 本工具统一处理该兜底逻辑，避免主窗口与头像窗口各写一份。
 */

import type { LLMConfig } from '@shared/protocols/modelGateway'

/** 认证 token 对（与 backendApi.getTokens() 返回结构对齐） */
export interface VoiceAuthTokens {
  accessToken?: string | null
  refreshToken?: string | null
}

/** 默认 LLM 配置（llmConfig 缺失时兜底，避免主进程因空配置崩溃） */
const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
}

/**
 * 解析语音对话使用的 LLM 配置，补全云端模式字段
 *
 * @param llmConfig 上层传入的 LLM 配置（可能为空）
 * @param cloudMode 云端模式状态：'cloud' | 'local'
 * @param serverUrl 后端服务地址（云端模式使用）
 * @param tokens 认证 token（云端模式使用）
 * @returns 补全后的 LLM 配置（新对象，不修改入参）
 */
export function resolveVoiceLlmConfig(
  llmConfig: LLMConfig | null | undefined,
  cloudMode: 'cloud' | 'local',
  serverUrl?: string,
  tokens?: VoiceAuthTokens | null,
): LLMConfig {
  const resolved: LLMConfig = {
    ...(llmConfig || DEFAULT_LLM_CONFIG),
  }

  // 云端模式兜底：cloudMode === 'cloud' 但 llmConfig 中 cloudMode 字段缺失时，
  // 自动补充 cloudMode/serverUrl/accessToken，确保主进程走后端代理而非本地 apiKey
  if (cloudMode === 'cloud' && !resolved.cloudMode) {
    resolved.cloudMode = true
    resolved.serverUrl = serverUrl
    resolved.accessToken = tokens?.accessToken || undefined
    resolved.refreshToken = tokens?.refreshToken || undefined
  }

  return resolved
}
