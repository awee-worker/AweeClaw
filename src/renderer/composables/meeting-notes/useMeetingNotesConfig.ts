/**
 * 会议纪要配置加载（LLM 配置 + 云端模式）
 *
 * 会议纪要窗口作为独立 renderer，需要从主进程获取语音上下文：
 * - llmConfig：用于翻译和整理（LLM 调用）
 * - cloudMode：用于 STT 路由（云端走后端代理，自定义模式直连）
 * - workspacePath：用于文件落盘
 * - serverUrl + accessToken：云端模式下 STT 走后端代理时必须注入到 backendApi
 *
 * 复用 floatingAvatar.getVoiceContext IPC（语音上下文缓存），
 * 避免重新设计一套会议纪要专用的配置链路。
 *
 * 关键：与头像窗口（useAvatarBridge）一样，需要把 serverUrl/tokens/cloudMode
 * 注入到 voiceApi 和 backendApi 的模块级变量，否则 STT 云端模式会因
 * getServerUrl() 返回空而抛出 "Server URL not configured" 错误。
 *
 * 设计：
 * - 启动时调用一次，订阅 voiceContextUpdated 事件实时更新
 * - 返回 ready 标志（首次加载完成）和 error（加载失败信息）
 */

import { useEffect, useState } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { setServerUrl, setTokens } from '../../adapters/backendApi'
import { setVoiceCloudMode } from '../../services/voiceApi'
import type { LLMConfig } from '@shared/protocols/modelProtocol'

export interface VoiceContextPayload {
  llmConfig: unknown
  cloudMode: 'cloud' | 'local'
  serverUrl: string | null
  accessToken: string | null
  refreshToken: string | null
  voiceModelConfig: unknown
  language: 'zh' | 'en'
  workspacePath: string | null
  updatedAt: number
}

export interface UseMeetingNotesConfigResult {
  /** 配置是否已加载完成 */
  ready: boolean
  /** LLM 配置（用于翻译/整理） */
  llmConfig: LLMConfig | null
  /** 云端模式 */
  cloudMode: 'cloud' | 'local'
  /** 工作区路径 */
  workspacePath: string | null
  /** 加载错误 */
  error: string | null
}

/**
 * 将语音上下文中的认证信息注入到 voiceApi / backendApi 模块级变量
 *
 * 会议纪要窗口是独立 renderer，backendApi 的模块级变量 serverUrl/tokens 默认为空，
 * 必须从主窗口 push 的 VoiceContext 中注入，否则 voiceApi.speechToText()（云端模式）
 * 会因 getServerUrl() 返回空字符串而抛错 "Server URL not configured"。
 */
function injectAuthToBackendApi(ctx: VoiceContextPayload): void {
  if (ctx.serverUrl) {
    setServerUrl(ctx.serverUrl)
  }
  if (ctx.accessToken || ctx.refreshToken) {
    setTokens({
      accessToken: ctx.accessToken || '',
      refreshToken: ctx.refreshToken || '',
    })
  }
}

export function useMeetingNotesConfig(): UseMeetingNotesConfigResult {
  const [ready, setReady] = useState(false)
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null)
  const [cloudMode, setCloudMode] = useState<'cloud' | 'local'>('cloud')
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    const load = async (): Promise<void> => {
      try {
        const ctx = await window.electronAPI.floatingAvatar.getVoiceContext()
        if (!ctx?.success || !ctx.data) {
          setError('未获取到语音上下文，请先在主窗口登录并配置 LLM')
          setReady(true)
          return
        }

        const data = ctx.data as VoiceContextPayload
        setLlmConfig((data.llmConfig as LLMConfig | null) ?? null)
        setCloudMode(data.cloudMode ?? 'cloud')
        setWorkspacePath(data.workspacePath ?? null)
        setReady(true)
        setError(null)

        // 注入 cloudMode 到 voiceApi（STT 路由依赖）
        setVoiceCloudMode(data.cloudMode ?? 'cloud')
        // 注入 serverUrl + tokens 到 backendApi（云端 STT 依赖）
        injectAuthToBackendApi(data)

        logger.system.info('[MeetingNotesConfig] Voice context loaded', {
          cloudMode: data.cloudMode,
          hasLlmConfig: !!data.llmConfig,
          hasServerUrl: !!data.serverUrl,
          hasAccessToken: !!data.accessToken,
          workspacePath: data.workspacePath,
        })

        // 订阅后续更新（主窗口配置变化时推送）
        unsubscribe = window.electronAPI.floatingAvatar.onVoiceContextUpdated((updated) => {
          const next = updated as VoiceContextPayload
          if (next?.llmConfig) setLlmConfig(next.llmConfig as LLMConfig)
          if (next?.cloudMode) {
            setCloudMode(next.cloudMode)
            setVoiceCloudMode(next.cloudMode)
          }
          if (next?.workspacePath !== undefined) setWorkspacePath(next.workspacePath)
          // 认证信息变化时重新注入
          if (next?.serverUrl || next?.accessToken || next?.refreshToken) {
            injectAuthToBackendApi(next)
          }
          logger.system.debug('[MeetingNotesConfig] Voice context updated')
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.system.error('[MeetingNotesConfig] Load failed:', err)
        setError(`加载配置失败：${msg}`)
        setReady(true)
      }
    }

    void load()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  return { ready, llmConfig, cloudMode, workspacePath, error }
}
