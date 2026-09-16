/**
 * useVrmCompanionBridge —— VRM 桌面伴侣窗口与主进程/主窗口的 IPC 桥接
 *
 * 职责：
 * 1. 启动时拉取语音上下文（VoiceContext，与悬浮头像共用主进程缓存）
 * 2. 订阅 main→伴侣事件：语音上下文更新、主窗口语音占用状态
 * 3. 把认证信息注入 voiceApi / backendApi（伴侣窗口是独立 renderer，
 *    模块级 serverUrl/tokens 默认为空，不注入则云端 STT/TTS 必然失败）
 * 4. 暴露转发方法：语音状态上报、对话保存、麦克风权限申请
 *
 * 与前身 useAvatarBridge 的差异：
 * - 不需要唤醒词 / 主题 / 执行状态 / 截图提问（伴侣窗口不做这些）
 * - 语音上下文走 vrm-companion:* 通道，避免与头像窗口的状态互相干扰
 *
 * 使用方式（VrmCompanionApp 顶层调用一次）：
 *   const bridge = useVrmCompanionBridge()
 *   bridge.voiceContext / bridge.mainConversationActive / bridge.requestMicPermission()
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@renderer/adapters/electronBridge'
import { setVoiceCloudMode, setVoiceConfigCloudMode } from '../services/voiceApi'
import { setServerUrl, setTokens } from '../adapters/backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import type { VoiceContextPayload } from '../types/electronBridge'

/**
 * 语音状态变化载荷（伴侣窗口 → main → 主窗口）。
 *
 * state 用 string 而不是联合类型：状态机由 useVoiceChat 定义，
 * 这里做透传即可，避免两端枚举不同步时出现类型打架。
 */
export interface CompanionVoiceStatePayload {
  state: string
  volume: number
}

/** 对话保存载荷（伴侣窗口 → main → 主窗口落库） */
export interface CompanionSaveConversationPayload {
  userText: string
  aiText: string
  toolCallRecords?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
    success: boolean
    resultSummary: string
  }>
}

export interface VrmCompanionBridge {
  /** 语音上下文（主窗口 push） */
  voiceContext: VoiceContextPayload | null
  /** 主窗口全功能语音是否激活（激活时伴侣应让出麦克风） */
  mainConversationActive: boolean
  /**
   * 伴侣窗口是否可见。
   *
   * 窗口隐藏/销毁时由主进程下发；不可见后渲染层必须结束语音对话 ——
   * 隐藏只隐藏窗口（warm renderer 仍在运行），VAD 循环与麦克风采集不会自动停止。
   */
  windowVisible: boolean
  /** 是否已完成初始化（首帧语音上下文已尝试加载） */
  ready: boolean
  /** 请求麦克风权限（macOS 需主进程弹系统授权） */
  requestMicPermission: () => Promise<boolean>
  /** 上报语音状态变化（主窗口 UI 联动） */
  notifyVoiceStateChanged: (payload: CompanionVoiceStatePayload) => void
  /** 上报对话完成（主窗口写入聊天历史） */
  notifySaveConversation: (payload: CompanionSaveConversationPayload) => void
}

export function useVrmCompanionBridge(): VrmCompanionBridge {
  const [voiceContext, setVoiceContext] = useState<VoiceContextPayload | null>(null)
  const [mainConversationActive, setMainConversationActive] = useState(false)
  const [ready, setReady] = useState(false)
  /**
   * 窗口可见性。
   *
   * 初值取 true 而不是查询主进程：窗口创建后默认显示（`show:false` 只是创建参数，
   * 随后由 show() 立即显示），而 show 事件可能早于本 renderer 加载完成而丢失，
   * 用真实值校正反而会把「可见」误判为「不可见」。
   */
  const [windowVisible, setWindowVisible] = useState(true)

  /** 供回调内读取最新上下文（避免闭包旧值） */
  const voiceContextRef = useRef<VoiceContextPayload | null>(null)
  voiceContextRef.current = voiceContext

  /**
   * 把上下文里的认证信息注入 voiceApi / backendApi。
   *
   * 伴侣窗口与主窗口是两个独立 renderer，backendApi 的 serverUrl/tokens
   * 是模块级变量，必须显式注入 —— 否则云端模式下 STT/TTS 会因
   * getServerUrl() 为空或缺少 Bearer token 而直接抛错。
   */
  const injectAuth = useCallback((ctx: VoiceContextPayload) => {
    if (ctx.serverUrl) {
      setServerUrl(ctx.serverUrl)
    }
    if (ctx.accessToken || ctx.refreshToken) {
      setTokens({
        accessToken: ctx.accessToken || '',
        refreshToken: ctx.refreshToken || '',
      })
    }
    // 语音分流的云端/自定义模式：
    // 优先使用语音设置独立的 cloudMode（voiceModelConfig.cloud_mode），回退到服务商模式
    const vmc = ctx.voiceModelConfig as { cloudMode?: 'cloud' | 'local' } | null
    setVoiceCloudMode(ctx.cloudMode)
    setVoiceConfigCloudMode(vmc?.cloudMode ?? null)
  }, [])

  // --------------------------------------------
  // 初始化：拉取语音上下文
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await api.vrmCompanion.getVoiceContext()
        if (cancelled) return
        if (res.success && res.data) {
          setVoiceContext(res.data as VoiceContextPayload)
          injectAuth(res.data as VoiceContextPayload)
          logger.system.info('[VrmCompanionBridge] Voice context loaded', {
            cloudMode: (res.data as VoiceContextPayload).cloudMode,
            hasLlmConfig: !!(res.data as VoiceContextPayload).llmConfig,
            language: (res.data as VoiceContextPayload).language,
          })
        }
      } catch (err) {
        logger.system.error('[VrmCompanionBridge] Init failed:', err)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [injectAuth])

  // --------------------------------------------
  // 订阅：语音上下文更新（主窗口 push → main 缓存 → 伴侣窗口）
  // --------------------------------------------
  useEffect(() => {
    const off = api.vrmCompanion.onVoiceContextUpdated((ctx) => {
      setVoiceContext(ctx)
      injectAuth(ctx)
    })
    return off
  }, [injectAuth])

  // --------------------------------------------
  // 订阅：主窗口语音占用状态
  // --------------------------------------------
  useEffect(() => {
    const off = api.vrmCompanion.onMainConversationActive((active) => {
      setMainConversationActive(active)
    })
    return off
  }, [])

  // --------------------------------------------
  // 订阅：伴侣窗口可见性（main → 伴侣窗口）
  //
  // 窗口被隐藏/销毁后必须结束语音对话，否则麦克风与 VAD 会持续运行。
  // --------------------------------------------
  useEffect(() => {
    const off = api.vrmCompanion.onVisibilityChanged((payload) => {
      // 载荷异常时不改动状态：宁可漏一次停止，也不要因脏数据误停正在进行的对话
      if (typeof payload?.visible === 'boolean') setWindowVisible(payload.visible)
    })
    return off
  }, [])

  // --------------------------------------------
  // 转发方法
  // --------------------------------------------
  const requestMicPermission = useCallback(async () => {
    try {
      const res = await api.vrmCompanion.requestMicPermission()
      return res.success && res.data ? res.data.granted : false
    } catch (err) {
      logger.system.warn('[VrmCompanionBridge] requestMicPermission failed:', err)
      return false
    }
  }, [])

  const notifyVoiceStateChanged = useCallback((payload: CompanionVoiceStatePayload) => {
    try {
      api.vrmCompanion.notifyVoiceStateChanged(payload)
    } catch (err) {
      logger.system.debug('[VrmCompanionBridge] notifyVoiceStateChanged failed:', err)
    }
  }, [])

  const notifySaveConversation = useCallback((payload: CompanionSaveConversationPayload) => {
    try {
      api.vrmCompanion.notifySaveConversation(payload)
    } catch (err) {
      logger.system.warn('[VrmCompanionBridge] notifySaveConversation failed:', err)
    }
  }, [])

  return {
    voiceContext,
    mainConversationActive,
    windowVisible,
    ready,
    requestMicPermission,
    notifyVoiceStateChanged,
    notifySaveConversation,
  }
}
