/**
 * useAvatarBridge - 头像窗口与主进程的 IPC 桥接 hook
 *
 * 职责：
 * 1. 启动时加载语音上下文（VoiceContext）和唤醒词配置（WakeWordConfig）
 * 2. 订阅 main→头像事件：语音上下文更新、唤醒开关切换、主窗口对话状态
 * 3. 获取拖拽 IPC 频道名（供拖拽逻辑使用）
 * 4. 暴露转发方法：唤醒命中通知、语音状态变化、保存对话历史
 *
 * 设计原则：
 * - 头像窗口不直接访问 @store，所有状态通过 IPC 从主窗口同步
 * - voiceApi 的 cloudMode 由本 hook 在收到 VoiceContext 后注入
 * - 麦克风权限在 macOS 上需主进程介入，提供 requestMicPermission 包装
 *
 * 使用方式：
 *   const bridge = useAvatarBridge()
 *   bridge.voiceContext   // 当前语音上下文
 *   bridge.wakeWordConfig // 唤醒词配置
 *   bridge.dragChannels   // 拖拽频道对象 { start, end }
 *   bridge.notifyWakeWordDetected()  // 通知 main 唤醒命中
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { setVoiceCloudMode } from '../services/voiceApi'
import { setServerUrl, setTokens } from '../adapters/backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import { themeManager } from '../config/themeDefinition'
import type { ThemeColor } from '../state/slices/themeSlice'
import type {
  VoiceContextPayload,
  WakeWordConfig,
  VoiceStateChangedPayload,
  SaveConversationPayload,
  ExecutionStatusSummary,
  MainConversationSnapshot,
  AvatarAgentConfig,
} from '../types/electronBridge'

// ============================================
// 类型定义
// ============================================

export interface AvatarBridgeState {
  /** 语音上下文（主窗口 push） */
  voiceContext: VoiceContextPayload | null
  /** 唤醒词配置 */
  wakeWordConfig: WakeWordConfig | null
  /** 拖拽 IPC 频道对象（启动后获取一次）：{ start, end } */
  dragChannels: { start: string; end: string } | null
  /** 主窗口全功能语音对话是否激活（激活时头像暂停唤醒检测） */
  mainConversationActive: boolean
  /** 是否已初始化完成 */
  ready: boolean
  /** 项目执行状态摘要（主窗口 push，null 表示无执行中任务） */
  executionStatus: ExecutionStatusSummary | null
  /** 状态栏边缘方向（主进程 push，null 表示未扩展；球体据此在窗口内靠左/靠右定位） */
  statusEdge: 'left' | 'right' | null
  /** 主窗口当前对话快照（主窗口 push，迷你聊天同步显示主窗口对话） */
  mainConversation: MainConversationSnapshot | null
}

/**
 * 将 voiceContext 中的智能体配置同步到头像窗口进程内的 store，
 * 使迷你聊天 buildAgentSystemPrompt → getActiveCustomAgent 能读到正确的智能体
 * （智能体 systemPrompt 注入 + 工具白名单生效）
 */
function syncAgentConfigToStore(agentConfig?: AvatarAgentConfig | null): void {
  if (!agentConfig) return
  try {
    const current = useStore.getState().agentConfig
    // 仅同步智能体相关字段，避免覆盖头像窗口进程内的其他配置
    useStore.getState().set('agentConfig', {
      ...(current || {}),
      activeCustomAgentId: agentConfig.activeCustomAgentId ?? undefined,
      customAgentProfiles: agentConfig.customAgentProfiles || [],
    })
  } catch (err) {
    logger.system.warn('[AvatarBridge] Sync agentConfig to store failed:', err)
  }
}

export interface AvatarBridgeActions {
  /** 通知 main：唤醒词命中 */
  notifyWakeWordDetected: (info?: { keyword: string; confidence: number }) => Promise<void>
  /** 通知 main：语音状态变化（转发主窗口 + 托盘） */
  notifyVoiceStateChanged: (payload: VoiceStateChangedPayload) => Promise<void>
  /** 通知 main→主窗口：保存对话历史 */
  notifySaveConversation: (payload: SaveConversationPayload) => Promise<void>
  /** 请求麦克风权限（macOS） */
  requestMicPermission: () => Promise<boolean>
  /** 打开主窗口 */
  openMainWindow: () => Promise<void>
  /** 退出应用 */
  quitApp: () => void
  /** 订阅截图提问结果（主进程推送截图 base64 + 落盘路径，头像窗口作为附件添加到输入框，由用户输入问题后手动发送） */
  onScreenshotResult: (
    callback: (payload: {
      base64: string
      mediaType: string
      width: number
      height: number
      filePath: string
      fileName: string
    }) => void,
  ) => () => void
}

export type AvatarBridge = AvatarBridgeState & AvatarBridgeActions

// ============================================
// 主 hook
// ============================================

/**
 * 头像窗口 IPC 桥接
 *
 * 在 AvatarApp 顶层调用一次，向下通过 props 或 context 传递。
 */
export function useAvatarBridge(): AvatarBridge {
  const [voiceContext, setVoiceContext] = useState<VoiceContextPayload | null>(null)
  const [wakeWordConfig, setWakeWordConfig] = useState<WakeWordConfig | null>(null)
  const [dragChannels, setDragChannels] = useState<{ start: string; end: string } | null>(null)
  const [mainConversationActive, setMainConversationActive] = useState(false)
  const [ready, setReady] = useState(false)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatusSummary | null>(null)
  const [statusEdge, setStatusEdge] = useState<'left' | 'right' | null>(null)
  const [mainConversation, setMainConversation] = useState<MainConversationSnapshot | null>(null)

  // 用 ref 保存最新的 voiceContext，供回调内读取（避免闭包旧值）
  const voiceContextRef = useRef<VoiceContextPayload | null>(null)
  voiceContextRef.current = voiceContext

  // --------------------------------------------
  // 将 VoiceContext 中的认证信息注入 backendApi
  // 头像窗口是独立 renderer，backendApi 的模块级变量 serverUrl/tokens 默认为空，
  // 必须从主窗口 push 的 VoiceContext 中注入，否则 voiceApi.speechToText()（云端模式）
  // 会因 getServerUrl() 返回空字符串而抛错，导致唤醒词检测失效。
  // --------------------------------------------
  const injectAuthToBackendApi = useCallback((ctx: VoiceContextPayload) => {
    if (ctx.serverUrl) {
      setServerUrl(ctx.serverUrl)
    }
    if (ctx.accessToken || ctx.refreshToken) {
      setTokens({
        accessToken: ctx.accessToken || '',
        refreshToken: ctx.refreshToken || '',
      })
    }
  }, [])

  // --------------------------------------------
  // 初始化：加载语音上下文 + 唤醒配置 + 拖拽频道
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // 并行加载语音上下文、唤醒配置、拖拽频道
        const [ctxRes, wakeRes, dragRes] = await Promise.all([
          api.floatingAvatar.getVoiceContext(),
          api.settings.dbGetWakeWordConfig(),
          api.floatingAvatar.getDragChannel(),
        ])

        if (cancelled) return

        if (ctxRes.success && ctxRes.data) {
          setVoiceContext(ctxRes.data)
          // 注入 cloudMode 到 voiceApi（解除与 @store 的耦合）
          setVoiceCloudMode(ctxRes.data.cloudMode)
          // 注入 serverUrl + tokens 到 backendApi（唤醒词 STT 云端模式依赖）
          injectAuthToBackendApi(ctxRes.data)
          // 同步智能体配置到头像窗口 store（迷你聊天智能体生效）
          syncAgentConfigToStore(ctxRes.data.agentConfig)
          logger.system.info('[AvatarBridge] Voice context loaded', {
            cloudMode: ctxRes.data.cloudMode,
            hasLlmConfig: !!ctxRes.data.llmConfig,
            language: ctxRes.data.language,
            hasServerUrl: !!ctxRes.data.serverUrl,
            hasAccessToken: !!ctxRes.data.accessToken,
          })
        }

        if (wakeRes) {
          setWakeWordConfig(wakeRes)
          logger.system.info('[AvatarBridge] Wake word config loaded', {
            enabled: wakeRes.enabled,
            keyword: wakeRes.keyword,
          })
        }

        if (dragRes.success && dragRes.data) {
          setDragChannels(dragRes.data)
        }

        setReady(true)
      } catch (err) {
        logger.system.error('[AvatarBridge] Init failed:', err)
        setReady(true) // 即使加载失败也标记 ready，避免 UI 永久卡在加载态
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------
  // 订阅：语音上下文更新（主窗口 push）
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onVoiceContextUpdated((payload) => {
      setVoiceContext(payload)
      // 同步注入 cloudMode 到 voiceApi
      if (payload.cloudMode) {
        setVoiceCloudMode(payload.cloudMode)
      }
      // 同步注入 serverUrl + tokens（token 可能已刷新）
      injectAuthToBackendApi(payload)
      // 同步智能体配置到头像窗口 store（迷你聊天智能体生效）
      syncAgentConfigToStore(payload.agentConfig)
      voiceContextRef.current = payload
      logger.system.debug('[AvatarBridge] Voice context updated', {
        cloudMode: payload.cloudMode,
        updatedAt: payload.updatedAt,
      })
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：唤醒开关被托盘/菜单切换
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onWakeWordToggled((enabled) => {
      setWakeWordConfig((prev: WakeWordConfig | null) =>
        prev ? { ...prev, enabled, updatedAt: Date.now() } : prev,
      )
      logger.system.info('[AvatarBridge] Wake word toggled:', enabled)
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：主窗口全功能语音对话状态
  // --------------------------------------------
  // 主窗口激活语音对话时，头像暂停唤醒检测（避免双窗口同时录音冲突）
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onMainConversationActive((active) => {
      setMainConversationActive(active)
      logger.system.info('[AvatarBridge] Main conversation active:', active)
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：主题色更新（主窗口→main→头像窗口）
  // --------------------------------------------
  // 主窗口主题变化时推送，头像窗口通过 ThemeManager.applyTheme 更新 CSS 变量
  // 使迷你聊天窗等 UI 的主题色跟随系统主题
  useEffect(() => {
    const applyThemeUpdate = (payload: { themeColor: string; themeMode: string }) => {
      try {
        const theme = themeManager.resolveThemeByModeAndColor(
          payload.themeMode as 'light' | 'dark' | 'system',
          payload.themeColor as ThemeColor,
        )
        themeManager.applyTheme(theme)
        logger.system.debug('[AvatarBridge] Theme applied', {
          color: payload.themeColor,
          mode: payload.themeMode,
          type: theme.type,
        })
      } catch (err) {
        logger.system.warn('[AvatarBridge] Apply theme failed:', err)
      }
    }

    const unsubscribe = api.floatingAvatar.onUpdateTheme(applyThemeUpdate)
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：项目执行状态更新（主窗口→main→头像窗口）
  // --------------------------------------------
  // 主窗口有项目任务执行时推送执行状态摘要，头像窗口在悬浮球上方显示指示器
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onExecutionStatus((status) => {
      setExecutionStatus(status)
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：状态栏边缘方向（main→头像窗口）
  // --------------------------------------------
  // 主进程在扩展/收起状态栏时推送边缘方向：
  // - 'left' | 'right'：窗口已扩展，球体需在窗口对应侧定位
  // - null：窗口已收起，球体回到居中
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onStatusEdge((edge) => {
      setStatusEdge(edge)
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 订阅：主窗口当前对话快照（主窗口→main→头像窗口）
  // --------------------------------------------
  // 迷你聊天同步显示主窗口对话内容，并在提问时作为上下文
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onMainConversation((snapshot) => {
      setMainConversation(snapshot)
      logger.system.debug('[AvatarBridge] Main conversation updated', {
        count: snapshot?.messages?.length ?? 0,
        threadId: snapshot?.threadId ?? null,
      })
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 转发方法
  // --------------------------------------------

  const notifyWakeWordDetected = useCallback(
    async (info?: { keyword: string; confidence: number }) => {
      try {
        await api.floatingAvatar.wakeWordDetected(info || { keyword: '', confidence: 1 })
      } catch (err) {
        logger.system.warn('[AvatarBridge] notifyWakeWordDetected failed:', err)
      }
    },
    [],
  )

  const notifyVoiceStateChanged = useCallback(
    async (payload: VoiceStateChangedPayload) => {
      try {
        await api.floatingAvatar.voiceStateChanged(payload)
      } catch (err) {
        logger.system.warn('[AvatarBridge] notifyVoiceStateChanged failed:', err)
      }
    },
    [],
  )

  const notifySaveConversation = useCallback(async (payload: SaveConversationPayload) => {
    try {
      await api.floatingAvatar.saveConversation(payload)
    } catch (err) {
      logger.system.warn('[AvatarBridge] notifySaveConversation failed:', err)
    }
  }, [])

  const requestMicPermission = useCallback(async () => {
    try {
      const res = await api.floatingAvatar.requestMicPermission()
      return res.success && res.data ? res.data.granted : false
    } catch (err) {
      logger.system.warn('[AvatarBridge] requestMicPermission failed:', err)
      return false
    }
  }, [])

  const openMainWindow = useCallback(async () => {
    try {
      await api.floatingAvatar.openMainWindow()
    } catch (err) {
      logger.system.warn('[AvatarBridge] openMainWindow failed:', err)
    }
  }, [])

  const quitApp = useCallback(async () => {
    try {
      await api.floatingAvatar.quitApp()
    } catch (err) {
      logger.system.warn('[AvatarBridge] quitApp failed:', err)
    }
  }, [])

  return {
    voiceContext,
    wakeWordConfig,
    dragChannels,
    mainConversationActive,
    ready,
    executionStatus,
    statusEdge,
    mainConversation,
    notifyWakeWordDetected,
    notifyVoiceStateChanged,
    notifySaveConversation,
    requestMicPermission,
    openMainWindow,
    quitApp,
    onScreenshotResult: api.floatingAvatar.onScreenshotResult,
  }
}
