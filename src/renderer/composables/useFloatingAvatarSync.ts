/**
 * useFloatingAvatarSync - 主窗口与悬浮头像窗口的状态同步
 *
 * 职责：
 * 1. 推送语音上下文到头像窗口（VoiceContext：llmConfig/cloudMode/tokens/voiceModelConfig/...）
 *    - 主窗口状态变化时主动 push，头像窗口通过 onVoiceContextUpdated 接收
 *    - 头像窗口启动时通过 getVoiceContext 拉取初始值
 * 2. 接收头像窗口的对话保存请求（onSaveConversation），写入 IntelligenceStore 聊天历史
 * 3. 同步主窗口语音对话状态到头像窗口（notifyMainConversationActive）
 *    - 主窗口激活语音对话时通知头像暂停唤醒检测，避免双窗口同时录音
 *
 * 使用方式：
 *   // 在 AweeApp.tsx 顶层调用
 *   useFloatingAvatarSync()
 *
 * 设计原则：
 * - 不阻塞主窗口渲染：所有 IPC 调用异步执行，失败时仅 warn 不 throw
 * - 去重推送：VoiceContext 字段未变化时不重复 push（由 updatedAt 自然去重）
 * - 清理订阅：组件卸载时取消所有 IPC 事件订阅
 */

import { useEffect, useRef, useState } from 'react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { getMessageText } from '@intelligence/types/conversationModel'
import { api } from '@renderer/adapters/electronBridge'
import { getTokens } from '@renderer/adapters/backendApi'
import { setVoiceCloudMode, reloadVoiceCloudModeFromDb } from '../services/voiceApi'
import { saveVoiceConversationToHistory } from '@intelligence/state/saveConversation'
import { logger } from '@shared/toolkit/LogEngine'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/configuration/aiProviders'
import type {
  AvatarModelOption,
  MainConversationMessage,
  MainConversationSnapshot,
} from '@renderer/types/electronBridge'
/**
 * 主窗口 → 头像窗口状态同步 hook
 *
 * 在 AweeApp 顶层调用一次。
 */
export function useFloatingAvatarSync(): void {
  // 视觉设置独立的云端/自定义模式（vision_model_config.cloud_mode），注入 cloudVisionMode 到头像迷你聊天
  const [visionCloudMode, setVisionCloudMode] = useState<'cloud' | 'local'>('cloud')

  // 从本地设置数据库读取视觉独立云端模式（异步，不阻塞渲染）
  useEffect(() => {
    let cancelled = false
    api.settings
      .dbGetVisionModelConfig()
      .then((cfg) => {
        if (cancelled) return
        const cm = (cfg as { cloudMode?: 'cloud' | 'local' } | null)?.cloudMode
        if (cm) setVisionCloudMode(cm)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  // 从 store 读取语音上下文相关状态（仅订阅必要字段，避免无关渲染）
  const {
    llmConfig,
    cloudMode,
    serverUrl,
    language,
    workspace,
    voiceConversationActive,
    themeColor,
    themeMode,
    systemPrefersDark,
    authorizationMode,
    agentConfig,
  } = useStore(
    useShallow((state) => ({
      llmConfig: state.llmConfig,
      cloudMode: state.cloudMode,
      serverUrl: state.serverUrl,
      language: state.language,
      workspace: state.workspace,
      voiceConversationActive: state.voiceConversationActive,
      themeColor: state.themeColor,
      themeMode: state.themeMode,
      systemPrefersDark: state.systemPrefersDark,
      authorizationMode: state.authorizationMode,
      agentConfig: state.agentConfig,
    })),
  )

  // 工作模式来自独立的 useModeStore（chat/agent/plan）
  const workMode = useModeStore((s) => s.currentMode)

  // 用 ref 跟踪上一次推送的上下文，避免重复推送
  const lastPushedRef = useRef<string>('')

  // --------------------------------------------
  // 1. 推送语音上下文到头像窗口
  // --------------------------------------------
  const workspacePath = workspace?.roots?.[0] || null
  const tokens = getTokens()

  useEffect(() => {
    // 同步 cloudMode 到 voiceApi（主窗口侧也需注入）
    setVoiceCloudMode(cloudMode)
    // 同步语音设置独立的云端/自定义模式（voice_model_config.cloud_mode）
    // 语音分流优先使用该独立值，不受服务商 cloudMode 控制
    reloadVoiceCloudModeFromDb()

    // 自定义智能体配置（精简为迷你聊天所需字段，含完整 systemPrompt/工具白名单供生效）
    const avatarAgentConfig = agentConfig
      ? {
          activeCustomAgentId: agentConfig.activeCustomAgentId ?? null,
          customAgentProfiles: (agentConfig.customAgentProfiles || []).map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            systemPrompt: p.systemPrompt,
            capabilities: p.capabilities || [],
            priority: p.priority ?? 0,
            enabled: p.enabled,
            icon: p.icon,
            identifier: p.identifier,
            callable: p.callable,
            triggerMode: p.triggerMode,
            builtinTools: p.builtinTools,
            mcpServices: p.mcpServices,
            plugins: p.plugins,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
        }
      : null

    // 构建语音上下文（注入视觉独立云端模式：cloudVisionMode 控制头像聊天图片是否走后端视觉接口）
    const voiceContext = {
      llmConfig: llmConfig
        ? { ...llmConfig, cloudVisionMode: visionCloudMode === 'cloud' }
        : null,
      cloudMode,
      serverUrl: serverUrl || null,
      accessToken: tokens?.accessToken || null,
      refreshToken: tokens?.refreshToken || null,
      voiceModelConfig: null, // voiceModelConfig 由 settings DB 管理，异步加载后补充推送
      language: language === 'en' ? 'en' as const : 'zh' as const,
      workspacePath,
      authorizationMode: authorizationMode ?? 'dangerous-only',
      workMode,
      agentConfig: avatarAgentConfig,
      updatedAt: Date.now(),
    }

    // 去重：序列化关键字段，与上次推送比较
    // accessToken 取末尾 8 字符参与签名，确保 token 刷新时能检测到变化并重新推送
    const signature = JSON.stringify({
      llmConfig: voiceContext.llmConfig,
      cloudMode: voiceContext.cloudMode,
      serverUrl: voiceContext.serverUrl,
      accessToken: voiceContext.accessToken ? voiceContext.accessToken.slice(-8) : null,
      language: voiceContext.language,
      workspacePath: voiceContext.workspacePath,
      authorizationMode: voiceContext.authorizationMode,
      workMode: voiceContext.workMode,
      cloudVisionMode: visionCloudMode,
      agentActiveId: voiceContext.agentConfig?.activeCustomAgentId ?? null,
      agentProfiles: (voiceContext.agentConfig?.customAgentProfiles || []).map((p) => p.id).join(','),
    })

    if (signature === lastPushedRef.current) return
    lastPushedRef.current = signature

    // 异步推送（不阻塞渲染）
    void api.floatingAvatar
      .updateVoiceContext(voiceContext)
      .then(() => {
        logger.system.debug('[FloatingAvatarSync] Voice context pushed', { cloudMode })
      })
      .catch((err) => {
        logger.system.warn('[FloatingAvatarSync] Push voice context failed:', err)
      })
  }, [llmConfig, cloudMode, serverUrl, language, workspacePath, tokens?.accessToken, authorizationMode, workMode, agentConfig, visionCloudMode])

  // --------------------------------------------
  // 2. 异步加载 voiceModelConfig 并推送
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadAndPushVoiceModelConfig() {
      try {
        const config = await api.settings.dbGetVoiceModelConfig()
        if (cancelled || !config) return

        // 推送 voiceModelConfig 到头像窗口
        await api.floatingAvatar.updateVoiceContext({ voiceModelConfig: config })
        logger.system.debug('[FloatingAvatarSync] Voice model config pushed')
      } catch (err) {
        logger.system.warn('[FloatingAvatarSync] Load voice model config failed:', err)
      }
    }

    void loadAndPushVoiceModelConfig()
    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------
  // 3. 同步主窗口语音对话状态到头像窗口
  // --------------------------------------------
  useEffect(() => {
    api.floatingAvatar.notifyMainConversationActive(voiceConversationActive)
    logger.system.info('[FloatingAvatarSync] Main conversation active:', voiceConversationActive)
  }, [voiceConversationActive])

  // --------------------------------------------
  // 3b. 同步主题色到头像窗口（主题色/模式变化 + 系统暗色偏好变化时推送）
  // --------------------------------------------
  useEffect(() => {
    api.floatingAvatar.updateTheme({ themeColor, themeMode })
    logger.system.debug('[FloatingAvatarSync] Theme pushed to avatar', { themeColor, themeMode })
  }, [themeColor, themeMode, systemPrefersDark])

  // --------------------------------------------
  // 4. 接收头像窗口的对话保存请求
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onSaveConversation((payload) => {
      logger.system.info('[FloatingAvatarSync] Save conversation from avatar', {
        userTextLength: payload.userText.length,
        aiTextLength: payload.aiText.length,
        toolCalls: payload.toolCallRecords?.length || 0,
      })

      try {
        saveVoiceConversationToHistory({
          userText: payload.userText,
          aiText: payload.aiText,
          toolCallRecords: payload.toolCallRecords,
        })
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Save conversation failed:', err)
      }
    })

    return unsubscribe
  }, [])

  // --------------------------------------------
  // 5. 接收头像窗口的语音状态变化（用于主窗口 UI 联动）
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onVoiceStateChanged((payload) => {
      // 可在此触发主窗口 UI 联动（如显示「头像对话中」提示）
      logger.system.debug('[FloatingAvatarSync] Avatar voice state:', payload.state)
    })

    return unsubscribe
  }, [])

  // --------------------------------------------
  // 6. 接收右键菜单/托盘「设置」点击，打开设置页指定 tab
  // --------------------------------------------
  const setShowSettingsPage = useStore((s) => s.setShowSettingsPage)
  const setShowSettings = useStore((s) => s.setShowSettings)
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onOpenSettings((tab) => {
      logger.system.info('[FloatingAvatarSync] Open settings from avatar menu', { tab })
      // tab 传给 settingsInitialTab，PreferencesDialog 会自动切换到对应 tab
      setShowSettings(true, tab)
      setShowSettingsPage(true)
    })

    return unsubscribe
  }, [setShowSettings, setShowSettingsPage])

  // --------------------------------------------
  // 7. 接收头像窗口的模型列表请求（从 store 构建，返回给主进程转发）
  // --------------------------------------------
  const providerConfigsRef = useStore(useShallow((s) => s.providerConfigs))
  const llmConfigRef = useStore(useShallow((s) => s.llmConfig))
  const cloudModeRef = useStore(useShallow((s) => s.cloudMode))
  const isAuthenticatedRef = useStore(useShallow((s) => s.isAuthenticated))
  const serverUrlRef = useStore(useShallow((s) => s.serverUrl))
  const updateRef = useStore((s) => s.update)
  const saveRef = useStore((s) => s.save)

  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onRequestModels(async (requestId) => {
      logger.system.info('[FloatingAvatarSync] onRequestModels received:', requestId, {
        isAuthenticated: isAuthenticatedRef,
        hasServerUrl: !!serverUrlRef,
        cloudMode: cloudModeRef,
      })
      try {
        // 构建本地/自定义模型
        const models = buildAvailableModels({
          providerConfigs: providerConfigsRef,
          llmConfig: llmConfigRef,
          cloudMode: cloudModeRef,
          isAuthenticated: isAuthenticatedRef,
        })
        logger.system.info('[FloatingAvatarSync] Local models built:', models.length)

        // 已认证时追加云端模型列表（无论当前是否为云端模式，
        // 允许用户在迷你聊天模型选择器的「云端」Tab 中浏览并切换）
        if (isAuthenticatedRef) {
          try {
            const sUrl = serverUrlRef || ''
            if (sUrl) {
              const { backendApi, getServerUrl } = await import('@services/backendApi')
              const url = getServerUrl() || sUrl
              if (url) {
                const data = await backendApi.get<Array<{ provider: string; models: string[] }>>(
                  '/api/v1/llm/models',
                )
                logger.system.info('[FloatingAvatarSync] Cloud models fetched:', data.length, 'providers')
                const seenCloud = new Set<string>()
                for (const item of data) {
                  for (const modelId of item.models) {
                    const key = `${item.provider.toLowerCase()}::${modelId}`
                    if (seenCloud.has(key)) continue
                    seenCloud.add(key)
                    models.push({
                      id: modelId,
                      name: modelId.split('/').pop() || modelId,
                      provider: item.provider.toLowerCase(),
                      providerName: item.provider,
                      isCloud: true,
                    })
                  }
                }
              }
            }
          } catch (err) {
            logger.system.warn('[FloatingAvatarSync] Fetch cloud models failed:', err)
          }
        }

        logger.system.info('[FloatingAvatarSync] Sending models response:', {
          requestId,
          total: models.length,
          cloud: models.filter((m) => m.isCloud).length,
          local: models.filter((m) => !m.isCloud).length,
        })
        api.floatingAvatar.sendModelsResponse(requestId, models)
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Build models failed:', err)
        api.floatingAvatar.sendModelsResponse(requestId, [])
      }
    })

    return unsubscribe
  }, [providerConfigsRef, llmConfigRef, cloudModeRef, isAuthenticatedRef, serverUrlRef])

  // --------------------------------------------
  // 8. 接收头像窗口的模型切换请求（更新 store + save，voiceContext 会自动重新 push）
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onSelectModel(({ provider, model, isCloud }) => {
      logger.system.info('[FloatingAvatarSync] Select model from avatar', { provider, model, isCloud })

      try {
        if (isCloud) {
          // 云端模式：只更新 provider/model
          updateRef('llmConfig', { provider, model })
          saveRef()
          return
        }

        // 本地模式：切换 provider 时恢复对应的 apiKey/baseUrl
        const builtinProvider = getBuiltinProvider(provider)
        const config = providerConfigsRef[provider]

        if (llmConfigRef.provider === provider) {
          updateRef('llmConfig', { model })
        } else {
          updateRef('llmConfig', {
            provider,
            model,
            apiKey: config?.apiKey || '',
            baseUrl: config?.baseUrl || builtinProvider?.baseUrl,
            timeout: config?.timeout || builtinProvider?.defaults.timeout || llmConfigRef.timeout,
            protocol: builtinProvider?.protocol || config?.protocol,
            headers: config?.headers,
          })
        }
        saveRef()
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Select model failed:', err)
      }
    })

    return unsubscribe
  }, [providerConfigsRef, llmConfigRef, updateRef, saveRef])

  // --------------------------------------------
  // 9. 接收头像窗口的授权方式切换请求（更新 store + save，voiceContext 会自动重新 push）
  // --------------------------------------------
  const setRef = useStore((s) => s.set)
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onSelectAuthorizationMode((mode) => {
      logger.system.info('[FloatingAvatarSync] Select authorization mode from avatar:', mode)
      try {
        setRef('authorizationMode', mode)
        void saveRef()
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Select authorization mode failed:', err)
      }
    })
    return unsubscribe
  }, [setRef, saveRef])

  // --------------------------------------------
  // 10. 接收头像窗口的工作模式切换请求（更新 useModeStore，voiceContext 会自动重新 push）
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onSelectWorkMode((mode) => {
      logger.system.info('[FloatingAvatarSync] Select work mode from avatar:', mode)
      try {
        useModeStore.getState().setMode(mode)
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Select work mode failed:', err)
      }
    })
    return unsubscribe
  }, [])

  // --------------------------------------------
  // 11. 接收头像窗口的自定义智能体切换请求（更新 store + save，voiceContext 会自动重新 push）
  // --------------------------------------------
  useEffect(() => {
    const unsubscribe = api.floatingAvatar.onSelectAgent((agentId) => {
      logger.system.info('[FloatingAvatarSync] Select agent from avatar:', agentId)
      try {
        const current = useStore.getState().agentConfig
        useStore.getState().set('agentConfig', {
          ...current,
          activeCustomAgentId: agentId || undefined,
        })
        void saveRef()
      } catch (err) {
        logger.system.error('[FloatingAvatarSync] Select agent failed:', err)
      }
    })
    return unsubscribe
  }, [saveRef])

  // --------------------------------------------
  // 12. 推送主窗口当前对话快照到头像窗口（迷你聊天同步显示主窗口对话）
  // 订阅当前线程的 user/assistant 消息，转换为轻量快照后单向 push
  // --------------------------------------------
  const mainThreadMessages = useAgentStore(
    useShallow((state) => {
      const thread = state.currentThreadId ? state.threads[state.currentThreadId] : undefined
      return thread?.messages ?? null
    }),
  )
  const mainThreadId = useAgentStore((state) => state.currentThreadId)

  // 上次推送的消息指纹（消息数 + 最后一条内容前 120 字符），避免无变化时重复推送
  const lastConversationSigRef = useRef('')
  // 防抖定时器：流式输出期间消息高频变化，合并为一次推送（600ms 内无变化才推送）
  const conversationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (conversationTimerRef.current) {
      clearTimeout(conversationTimerRef.current)
      conversationTimerRef.current = null
    }

    conversationTimerRef.current = setTimeout(() => {
      const list = mainThreadMessages
      if (!list || list.length === 0) {
        if (lastConversationSigRef.current !== 'empty') {
          lastConversationSigRef.current = 'empty'
          const empty: MainConversationSnapshot = {
            threadId: mainThreadId ?? null,
            messages: [],
            updatedAt: Date.now(),
          }
          api.floatingAvatar.pushMainConversation(empty)
        }
        return
      }

      // 提取 user/assistant 消息文本（限制条数与单条长度，避免超大 payload）
      const messages: MainConversationMessage[] = []
      for (const m of list) {
        if (m.role !== 'user' && m.role !== 'assistant') continue
        const text = getMessageText(m.content as never)
        if (!text.trim()) continue
        messages.push({
          id: m.id,
          role: m.role,
          content: text.length > 4000 ? text.slice(0, 4000) : text,
          reasoning:
            m.role === 'assistant' && m.reasoning
              ? m.reasoning.length > 2000
                ? m.reasoning.slice(0, 2000)
                : m.reasoning
              : undefined,
          timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
        })
        // 最多同步最近 50 条，避免历史过长导致 payload 过大
        if (messages.length >= 50) break
      }
      if (messages.length === 0) return

      const lastMsg = messages[messages.length - 1]
      const sig = `${messages.length}:${lastMsg.id}:${lastMsg.content.slice(0, 120)}`
      if (sig === lastConversationSigRef.current) return
      lastConversationSigRef.current = sig

      const snapshot: MainConversationSnapshot = {
        threadId: mainThreadId ?? null,
        messages,
        updatedAt: Date.now(),
      }
      api.floatingAvatar.pushMainConversation(snapshot)
      // 调试日志：仅在快照实际变化时输出
      logger.system.debug('[FloatingAvatarSync] Main conversation pushed', {
        count: messages.length,
        threadId: mainThreadId,
      })
    }, 600)

    return () => {
      if (conversationTimerRef.current) {
        clearTimeout(conversationTimerRef.current)
        conversationTimerRef.current = null
      }
    }
  }, [mainThreadMessages, mainThreadId])
}

// ============================================
// 辅助函数：从 store 构建本地可用模型列表
// ============================================

function buildAvailableModels(options: {
  providerConfigs: Record<string, any>
  llmConfig: any
  cloudMode: string
  isAuthenticated: boolean
}): AvatarModelOption[] {
  const { providerConfigs, llmConfig } = options
  const models: AvatarModelOption[] = []
  const seen = new Set<string>()

  // 内置 provider 的模型
  for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    const providerConfig = providerConfigs[providerId]
    if (providerConfig?.enabled !== true) continue
    if (!providerConfig?.apiKey && !llmConfig.apiKey && providerId !== 'ollama') continue

    const customModels = providerConfig?.customModels || []
    const modelConfigs = providerConfig?.modelConfigs || {}

    for (const id of customModels) {
      if (modelConfigs[id]?.enabled !== true) continue
      const key = `${providerId}::${id}`
      if (!seen.has(key)) {
        seen.add(key)
        models.push({
          id,
          name: id.split('/').pop() || id,
          provider: providerId,
          providerName: provider.displayName,
          isCloud: false,
        })
      }
    }
  }

  // 自定义 provider 的模型
  for (const [providerId, config] of Object.entries(providerConfigs)) {
    if (!providerId.startsWith('custom-')) continue
    if (config?.enabled !== true) continue
    if (!config?.apiKey) continue

    const modelIds = config.customModels || []
    const providerName = config.displayName || providerId
    const modelConfigs = config?.modelConfigs || {}

    for (const id of modelIds) {
      if (modelConfigs[id]?.enabled !== true) continue
      const key = `${providerId}::${id}`
      if (!seen.has(key)) {
        seen.add(key)
        models.push({
          id,
          name: id.split('/').pop() || id,
          provider: providerId,
          providerName,
          isCloud: false,
        })
      }
    }
  }

  return models
}
