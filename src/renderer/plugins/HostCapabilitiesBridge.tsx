/**
 * HostCapabilitiesBridge — 场景 / 插件可用的宿主能力桥
 *
 * 与 PluginHostBridge 的分工：那个桥管「AI 会话」，这个桥管「本地能力」——
 * 语音合成、界面导航。两者都是插件 / 场景通过 window 事件发起、由宿主代理执行。
 *
 * 为什么要有这一层：
 * - 语音合成在客户端内部分了三路（离线引擎 / 后端代理 / 直连 Provider），
 *   配置与回退逻辑都在 voiceApi 里。场景自己拼一套只会在用户改配置后失效。
 * - 装插件、配语音这类动作的落点是侧栏面板与设置页，它们的入口只有宿主知道。
 *
 * 本组件不渲染任何 UI，只做事件监听与转译。
 *
 * @module renderer/plugins/HostCapabilitiesBridge
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import { api } from '@renderer/adapters/electronBridge'
import { voiceApi } from '@renderer/services/voiceApi'
import {
  loadLocalEngineConfig,
  resolveVoiceRoute,
} from '@renderer/services/localVoiceEngine'
import { getBuiltinVoicesForModel } from '@shared/localVoiceVoices'
import {
  HOST_NAVIGATE_REQUEST_EVENT,
  HOST_NAVIGATE_RESULT_EVENT,
  HOST_TTS_REQUEST_EVENT,
  HOST_TTS_RESULT_EVENT,
  HOST_VOICE_STATUS_REQUEST_EVENT,
  HOST_VOICE_STATUS_RESULT_EVENT,
  type HostNavigateRequestDetail,
  type HostNavigateResultDetail,
  type HostNavigateTarget,
  type HostTtsRequestDetail,
  type HostTtsResultDetail,
  type HostVoiceEngine,
  type HostVoiceOption,
  type HostVoiceStatusDetail,
} from './HostCapabilitiesApi'
import { setPluginMarketQuery } from '@components/plugin/pluginMarketIntent'

/** 单次合成长度上限：再长的正文应当拆句，一次性推送会被服务商截断 */
const MAX_TTS_CHARS = 4000

/** 云端 Provider 的常见音色。服务商没有查询接口，只能给可用的常见值 */
const CLOUD_VOICE_PRESETS: Record<string, HostVoiceOption[]> = {
  openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((id) => ({
    id,
    name: id,
    group: 'OpenAI',
  })),
  azure: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((id) => ({
    id,
    name: id,
    group: 'Azure OpenAI',
  })),
  custom: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((id) => ({
    id,
    name: id,
    group: 'OpenAI 兼容',
  })),
  siliconflow: [
    'alex',
    'anna',
    'benjamin',
    'bella',
    'charles',
    'claire',
    'david',
    'diana',
  ].map((id) => ({
    id: `FunAudioLLM/CosyVoice2-0.5B:${id}`,
    name: id,
    group: 'CosyVoice2',
  })),
  aliyun: [
    { id: 'longxiaochun', name: '龙小淳 · 女声' },
    { id: 'longxiaoxia', name: '龙小夏 · 女声' },
    { id: 'longxiaobai', name: '龙小白 · 女声' },
    { id: 'longwan', name: '龙婉 · 女声' },
    { id: 'longcheng', name: '龙橙 · 男声' },
    { id: 'longhua', name: '龙华 · 男声' },
    { id: 'longshu', name: '龙书 · 男声' },
    { id: 'longfei', name: '龙飞 · 男声' },
  ].map((item) => ({ ...item, group: 'CosyVoice' })),
}

/**
 * 补齐当前配置的音色
 *
 * 服务商没有音色查询接口，只能给预设表。预设里没有这家（自建代理、新上的
 * 服务商）时，下拉会只剩「默认音色」，用户看不到自己配的那个。把配置值并进
 * 列表既不编造也不缺项。
 */
function withConfiguredVoice(
  presets: HostVoiceOption[],
  voice: string,
  label: string,
): HostVoiceOption[] {
  if (!voice || presets.some((item) => item.id === voice)) return presets
  return [{ id: voice, name: `${voice} · 当前配置`, group: label }, ...presets]
}

/** ArrayBuffer → base64，分块处理避免超长参数把调用栈撑爆 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 派发应答事件；宿主未就绪时只记日志 */
function emitResult<T>(eventName: string, detail: T): void {
  try {
    window.dispatchEvent(new CustomEvent<T>(eventName, { detail }))
  } catch (err) {
    logger.system.warn(`[HostCapabilitiesBridge] 派发 ${eventName} 失败:`, err)
  }
}

/**
 * 读取语音配置，判断「能不能合成」
 *
 * 判断顺序与 voiceApi 的分流顺序保持一致：先看离线引擎是否被选为主路径，
 * 再看云端 / 直连需不需要填 Key。只报配置层面的事实，不假装做过连通性测试。
 */
async function readVoiceStatus(): Promise<Omit<HostVoiceStatusDetail, 'requestId'>> {
  const route = await resolveVoiceRoute('tts')
  const engineConfig = await loadLocalEngineConfig()

  let provider = ''
  let model = ''
  let voice = ''
  let cloudMode: 'cloud' | 'local' | null = null
  let ttsEnabled = false
  let hasApiKey = false

  try {
    const cfg = (await api.settings.dbGetVoiceModelConfig()) as
      | {
          cloudMode?: 'cloud' | 'local'
          ttsEnabled?: boolean
          ttsProvider?: string
          ttsModel?: string
          ttsVoice?: string
          ttsApiKey?: string
        }
      | null
      | undefined
    if (cfg) {
      cloudMode = cfg.cloudMode ?? null
      ttsEnabled = Boolean(cfg.ttsEnabled)
      provider = cfg.ttsProvider ?? ''
      model = cfg.ttsModel ?? ''
      voice = cfg.ttsVoice ?? ''
      hasApiKey = Boolean(cfg.ttsApiKey)
    }
  } catch (err) {
    logger.system.warn('[HostCapabilitiesBridge] 读取语音配置失败:', err)
  }

  /** 本地引擎做主路径：音色由「设置 → 本地语音」选的模型决定，与其下拉同源 */
  if (route.primary === 'local') {
    const localVoice = engineConfig?.tts?.defaultVoice ?? '';
    const modelName = engineConfig?.tts?.modelName ?? '';
    return {
      configured: Boolean(engineConfig?.tts?.enabled),
      engine: 'local',
      provider: 'local-engine',
      providerLabel: '本地语音引擎',
      model: modelName,
      voice: localVoice,
      voices: getBuiltinVoicesForModel(modelName).map(
        (item: { voice: string; displayName: string; group: string }) => ({
          id: item.voice,
          name: item.displayName,
          group: item.group,
        }),
      ),
      reason: engineConfig?.tts?.enabled
        ? undefined
        : '本地语音引擎未开启 TTS，或优先级设置让本地语音不可用',
      settingsTarget: 'local-voice',
    }
  }

  /** 云端模式：走客户端后端代理，只要登录就能用，不看本地 Key */
  if (cloudMode === 'cloud') {
    return {
      configured: true,
      engine: 'cloud',
      provider: provider || 'cloud',
      providerLabel: '云端语音（后端代理）',
      model,
      voice,
      voices: withConfiguredVoice(
        CLOUD_VOICE_PRESETS[provider] ?? [],
        voice,
        '云端语音（后端代理）',
      ),
      settingsTarget: 'voice',
    }
  }

  // 各服务商的直连链路都需要 Key（阿里云走专有协议但同样要鉴权）
  const needsKey = !hasApiKey
  const configured = ttsEnabled && !needsKey
  const presets = withConfiguredVoice(CLOUD_VOICE_PRESETS[provider] ?? [], voice, provider || '当前配置')

  return {
    configured,
    engine: configured ? 'direct' : 'none',
    provider,
    providerLabel: provider || '未选择',
    model,
    voice,
    voices: presets,
    reason: configured
      ? undefined
      : !ttsEnabled
        ? '语音合成未启用'
        : needsKey
          ? '语音服务商未填写 API Key'
          : '语音配置不完整',
    settingsTarget: 'voice',
  }
}

/** 导航目标 → 实际动作 */
function applyNavigate(target: HostNavigateTarget, query?: string): { success: boolean; error?: string } {
  const state = useStore.getState()

  switch (target) {
    case 'plugin-market':
      state.setActiveSidePanel('plugin-market')
      if (query) setPluginMarketQuery(query)
      return { success: true }

    case 'scenario-market':
      state.setActiveSidePanel('scenarios')
      return { success: true }

    case 'voice-settings':
      state.setSettingsIntent({ tab: 'voice' })
      state.setShowSettingsPage(true)
      return { success: true }

    case 'local-voice-settings':
      state.setSettingsIntent({ tab: 'local-voice' })
      state.setShowSettingsPage(true)
      return { success: true }

    case 'settings':
      state.setSettingsIntent(null)
      state.setShowSettingsPage(true)
      return { success: true }

    case 'environment':
      state.setShowEnvironmentSetup(true)
      return { success: true }

    default:
      return { success: false, error: `未知的导航目标: ${String(target)}` }
  }
}

export function HostCapabilitiesBridge() {
  /** 合成串行化：同一时刻只允许一个请求打到服务商 */
  const ttsQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const handleTts = (event: Event) => {
      const detail = (event as CustomEvent<HostTtsRequestDetail>).detail
      const requestId = detail?.requestId
      if (!requestId) {
        logger.system.warn('[HostCapabilitiesBridge] TTS 请求缺少 requestId，已忽略')
        return
      }

      const text = String(detail.text ?? '').trim()
      if (!text) {
        emitResult<HostTtsResultDetail>(HOST_TTS_RESULT_EVENT, {
          requestId,
          success: false,
          error: '文本为空',
        })
        return
      }
      if (text.length > MAX_TTS_CHARS) {
        emitResult<HostTtsResultDetail>(HOST_TTS_RESULT_EVENT, {
          requestId,
          success: false,
          error: `单次合成上限 ${MAX_TTS_CHARS} 字符，当前 ${text.length}，请先分句`,
        })
        return
      }

      const format = detail.format === 'wav' ? 'wav' : 'mp3'

      ttsQueue.current = ttsQueue.current.then(async () => {
        try {
          const blob = await voiceApi.textToSpeech(text, {
            voice: detail.voice || undefined,
            speed: detail.speed,
            format,
            language: detail.language,
          })
          const base64 = arrayBufferToBase64(await blob.arrayBuffer())
          emitResult<HostTtsResultDetail>(HOST_TTS_RESULT_EVENT, {
            requestId,
            success: true,
            base64,
            mime: blob.type || `audio/${format}`,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          logger.system.warn('[HostCapabilitiesBridge] 语音合成失败:', message)
          emitResult<HostTtsResultDetail>(HOST_TTS_RESULT_EVENT, {
            requestId,
            success: false,
            error: message,
          })
        }
      })
    }

    const handleVoiceStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail
      const requestId = detail?.requestId
      if (!requestId) return

      void readVoiceStatus()
        .then((status) => {
          emitResult<HostVoiceStatusDetail>(HOST_VOICE_STATUS_RESULT_EVENT, { requestId, ...status })
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          emitResult<HostVoiceStatusDetail>(HOST_VOICE_STATUS_RESULT_EVENT, {
            requestId,
            configured: false,
            engine: 'none' as HostVoiceEngine,
            provider: '',
            providerLabel: '',
            model: '',
            voice: '',
            voices: [],
            reason: `读取语音配置失败：${message}`,
            settingsTarget: 'voice',
          })
        })
    }

    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<HostNavigateRequestDetail>).detail
      const requestId = detail?.requestId
      let result: { success: boolean; error?: string }
      try {
        result = applyNavigate(detail.target, detail.query)
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (requestId) {
        emitResult<HostNavigateResultDetail>(HOST_NAVIGATE_RESULT_EVENT, { requestId, ...result })
      }
    }

    window.addEventListener(HOST_TTS_REQUEST_EVENT, handleTts)
    window.addEventListener(HOST_VOICE_STATUS_REQUEST_EVENT, handleVoiceStatus)
    window.addEventListener(HOST_NAVIGATE_REQUEST_EVENT, handleNavigate)

    return () => {
      window.removeEventListener(HOST_TTS_REQUEST_EVENT, handleTts)
      window.removeEventListener(HOST_VOICE_STATUS_REQUEST_EVENT, handleVoiceStatus)
      window.removeEventListener(HOST_NAVIGATE_REQUEST_EVENT, handleNavigate)
    }
  }, [])

  return null
}

export default HostCapabilitiesBridge
