import { StateCreator } from 'zustand'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { BRAND } from '@shared/brand'
import {
  setServerUrl,
  setTokens,
  getTokens,
  setOnTokenRefresh,
  setOnAuthFailed,
  tryRefreshToken,
  syncRefreshedTokens,
  backendApi,
} from '@services/backendApi'
import {
  preloadFeatures,
  clearFeatureGuardCache,
} from '@services/featureGuardService'
import { toast } from '@components/foundation/NotificationProvider'
import { api } from '../../adapters/electronBridge'
import { aweeclawDir } from '../../adapters/appDirService'
import { useStore } from '@store'
import { knowledgeSyncService } from '@intelligence/runtime/knowledgeService/syncService'
import { knowledgeGraphSyncService } from '@intelligence/runtime/knowledgeService/graphSyncService'
import { t, type Language } from '@renderer/i18n'
import { restoreWorkspaceAgentStore } from '@services/workspaceLoader'

/**
 * 检查用户是否已配置自定义模型。
 * 判断依据：llmConfig 中 provider 非空且 apiKey 非空，说明用户已手动配置过模型。
 * 此时登录不应强制覆盖为云端模式。
 */
function hasUserCustomModelConfig(): boolean {
  try {
    const store = useStore.getState()
    const llmConfig = store.llmConfig
    if (!llmConfig) return false
    // provider 非空且 apiKey 非空 = 用户已配置自定义模型
    return Boolean(llmConfig.provider && llmConfig.apiKey)
  } catch {
    return false
  }
}

/** 认证成功后：归属孤儿线程 + 修复缺失标题 + 重新加载会话数据 + 推送设备联动凭据 */
async function onAuthSuccess(userId: string | undefined): Promise<void> {
  if (userId) {
    try {
      await api.sessionDb.claimOrphanThreads(userId)
      logger.system.info('[Auth] Orphan threads claimed for user:', userId)
    } catch (e) {
      logger.system.warn('[Auth] claimOrphanThreads failed:', e)
    }
  }
  try {
    const count = await aweeclawDir.repairMissingTitles()
    if (count > 0) {
      logger.system.info('[Auth] Repaired missing titles:', count)
    }
  } catch (e) {
    logger.system.warn('[Auth] repairMissingTitles failed:', e)
  }
  try {
    await restoreWorkspaceAgentStore()
    logger.system.info('[Auth] Agent store rehydrated after auth')
  } catch (e) {
    logger.system.warn('[Auth] Rehydrate after auth failed:', e)
  }
  // 推送登录凭据给主进程的设备联动模块，触发 WebSocket 与后端长连接
  try {
    pushDeviceLinkCredentials()
  } catch (e) {
    logger.system.warn('[Auth] Push device-link credentials failed:', e)
  }
}

/**
 * 推送当前登录态到主进程的设备联动模块。
 * - 登录/注册/手机号登录成功后调用
 * - token 刷新后调用（让 WS 用新 token 重连）
 * - restoreSession 成功后调用（应用启动时恢复连接）
 * - 工作区切换后可再次调用以更新 workspacePath
 *
 * deviceName 不传，由主进程自动用 hostname + OS 填充。
 */
function pushDeviceLinkCredentials(): void {
  const state = useStore.getState()
  const serverUrl = state.serverUrl
  const tokens = getTokens()
  if (!serverUrl || !tokens?.accessToken) {
    logger.system.debug('[Auth] Skip device-link push: no serverUrl or accessToken')
    return
  }
  const workspacePath = state.workspacePath || undefined
  const workspaceName = workspacePath
    ? workspacePath.split(/[\\/]/).pop() || undefined
    : undefined
  void api.deviceLink
    .pushCredentials({
      serverUrl,
      accessToken: tokens.accessToken,
      workspacePath,
      workspaceName,
    })
    .catch((e) => {
      logger.system.warn('[Auth] deviceLink.pushCredentials failed:', e)
    })
}

export interface CloudUser {
  id: string
  email: string
  username?: string
  avatarUrl?: string
  phone?: string
  realName?: string
  gender?: string
  birthday?: string
  occupation?: string
  role: string
  planId: string
}

export interface CloudQuota {
  plan: string
  displayName?: string
  limit: number
  used: number
  remaining: number
  periodStart: string
  periodEnd: string
}

export interface CloudProviderModel {
  provider: string
  models: string[]
  baseUrl?: string
  displayName?: string
  logo?: string
  protocol?: string
  defaultModel?: string
  defaultMaxTokens?: number
  defaultTemperature?: number
  defaultTopP?: number
  defaultTimeout?: number
}

export interface AuthSlice {
  isAuthenticated: boolean
  cloudUser: CloudUser | null
  cloudMode: 'local' | 'cloud'
  serverUrl: string
  quota: CloudQuota | null
  cloudModels: CloudProviderModel[]

  login: (serverUrl: string, email: string, password: string) => Promise<void>
  phoneLogin: (serverUrl: string, phone: string, code: string) => Promise<void>
  register: (serverUrl: string, email: string, password: string, username?: string) => Promise<void>
  forgotPassword: (serverUrl: string, email: string) => Promise<void>
  resetPassword: (serverUrl: string, email: string, code: string, newPassword: string) => Promise<void>
  logout: () => void
  setCloudMode: (mode: 'local' | 'cloud') => void
  setServerUrl: (url: string) => void
  fetchProfile: () => Promise<void>
  fetchQuota: () => Promise<void>
  fetchCloudModels: () => Promise<CloudProviderModel[]>
  restoreSession: () => Promise<void>
  selectCloudModel: () => Promise<void>
}

const STORAGE_KEY = BRAND.storageKeys.cloudAuth;

function persistAuth(data: {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  cloudMode: 'local' | 'cloud';
}) {
  StorageService.set(STORAGE_KEY, data);
}

function loadPersistedAuth(): {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  cloudMode: 'local' | 'cloud';
} | null {
  return StorageService.get<{
    serverUrl: string;
    accessToken: string;
    refreshToken: string;
    cloudMode: 'local' | 'cloud';
  }>(STORAGE_KEY);
}

function clearPersistedAuth() {
  StorageService.remove(STORAGE_KEY);
}

/**
 * 从应用配置文件（aweeclaw-config.json）读取 serverUrl
 * 用于 login/register 等场景的兜底：当 store.serverUrl 为空（如 restoreSession 未完成）时
 * 确保请求能发往正确的后端地址
 */
async function resolveServerUrlFromConfig(): Promise<string> {
  try {
    const { api } = await import('../../adapters/electronBridge')
    const config = await api.settings.getAppConfig()
    return config?.serverUrl || ''
  } catch {
    return ''
  }
}

let authFailedHandler: (() => void) | null = null

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set, get) => {
  authFailedHandler = () => {
    logger.system.warn('[Auth] authFailedHandler called, clearing all auth state')
    clearPersistedAuth();
    clearFeatureGuardCache();

    const wasAuthenticated = get().isAuthenticated;

    set({
      isAuthenticated: false,
      cloudUser: null,
      quota: null,
      cloudMode: 'local',
      cloudModels: [],
    });

    import('@store').then(({ useStore }) => {
      const storeState = useStore.getState()
      useStore.setState({
        llmConfig: {
          ...storeState.llmConfig,
          cloudMode: false,
          accessToken: undefined,
          serverUrl: undefined,
          refreshToken: undefined,
        },
      })

      if (wasAuthenticated) {
        const language = useStore.getState().language as 'en' | 'zh';
        toast.error(
          t('app.sessionexpired', language as Language),
          t('app.yoursessionhasexpiredplease', language as Language),
        );
        useStore.getState().setShowWelcomePage(true);
      }
    }).catch(() => {
      if (wasAuthenticated) {
        toast.error('登录已过期', '您的登录已过期，请重新登录');
      }
    });
  }

  return {
  isAuthenticated: false,
  cloudUser: null,
  cloudMode: 'local',
  serverUrl: '',
  quota: null,
  cloudModels: [],

  login: async (url, email, password) => {
    // 若调用方未传入有效 serverUrl（如 restoreSession 尚未完成），回退到配置文件
    const effectiveUrl = url || (await resolveServerUrlFromConfig())
    setServerUrl(effectiveUrl);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/login',
      { email, password },
    );
    // 设置 token + 持久化 + 更新 UI 状态
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    // 检查用户是否已配置自定义模型：若已配置则保留用户选择，不强制切到云端模式
    const hasCustomModel = hasUserCustomModelConfig();
    const targetMode = hasCustomModel ? 'local' : 'cloud';
    persistAuth({ serverUrl: effectiveUrl, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: targetMode });
    set({ serverUrl: effectiveUrl, isAuthenticated: true, cloudMode: targetMode });

    // 顺序：先获取 profile，再并发获取其他数据
    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    // 预加载功能权限配置（付费墙）
    preloadFeatures().catch(() => {});
    // 仅在未配置自定义模型时自动选择云端模型
    if (!hasCustomModel) {
      get().selectCloudModel().catch(() => {});
    }
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  phoneLogin: async (url, phone, code) => {
    const effectiveUrl = url || (await resolveServerUrlFromConfig())
    setServerUrl(effectiveUrl);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/phone-login',
      { phone, code },
    );
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    const hasCustomModel = hasUserCustomModelConfig();
    const targetMode = hasCustomModel ? 'local' : 'cloud';
    persistAuth({ serverUrl: effectiveUrl, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: targetMode });
    set({ serverUrl: effectiveUrl, isAuthenticated: true, cloudMode: targetMode });

    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    preloadFeatures().catch(() => {});
    if (!hasCustomModel) {
      get().selectCloudModel().catch(() => {});
    }
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  register: async (url, email, password, username) => {
    const effectiveUrl = url || (await resolveServerUrlFromConfig())
    setServerUrl(effectiveUrl);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/register',
      { email, password, username },
    );
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    const hasCustomModel = hasUserCustomModelConfig();
    const targetMode = hasCustomModel ? 'local' : 'cloud';
    persistAuth({ serverUrl: effectiveUrl, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: targetMode });
    set({ serverUrl: effectiveUrl, isAuthenticated: true, cloudMode: targetMode });

    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    preloadFeatures().catch(() => {});
    if (!hasCustomModel) {
      get().selectCloudModel().catch(() => {});
    }
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  forgotPassword: async (url, email) => {
    const effectiveUrl = url || (await resolveServerUrlFromConfig())
    setServerUrl(effectiveUrl);
    await backendApi.post<{ message: string }>(
      '/api/v1/auth/forgot-password',
      { email },
    );
  },

  resetPassword: async (url, email, code, newPassword) => {
    const effectiveUrl = url || (await resolveServerUrlFromConfig())
    setServerUrl(effectiveUrl);
    await backendApi.post<{ message: string }>(
      '/api/v1/auth/reset-password',
      { email, code, newPassword },
    );
  },

  logout: () => {
    knowledgeSyncService.stopAutoSync();
    knowledgeGraphSyncService.stopAutoSync();
    setTokens(null);
    clearFeatureGuardCache();
    clearPersistedAuth();
    set({ isAuthenticated: false, cloudUser: null, quota: null, cloudMode: 'local' });
    restoreWorkspaceAgentStore().catch(() => {});
    // 通知主进程断开设备联动 WebSocket 连接
    void api.deviceLink.clearCredentials().catch((e) => {
      logger.system.warn('[Auth] deviceLink.clearCredentials failed:', e)
    });
    import('@store').then(({ useStore }) => {
      useStore.getState().setShowWelcomePage(true);
    }).catch(() => {});
  },

  setCloudMode: (mode) => {
    set({ cloudMode: mode });
    const persisted = loadPersistedAuth();
    if (persisted) {
      persistAuth({ ...persisted, cloudMode: mode });
    }

    // 同步更新 llmConfig 中的云端字段
    // 切换到云端模式：注入 cloudMode/serverUrl/accessToken，主进程会路由到后端代理
    // 切换到本地模式：清除云端字段，主进程会使用 apiKey/baseUrl 直连
    if (mode === 'cloud') {
      const tokens = getTokens();
      useStore.setState((state) => ({
        llmConfig: {
          ...state.llmConfig,
          cloudMode: true as any,
          serverUrl: get().serverUrl,
          accessToken: tokens?.accessToken,
          refreshToken: tokens?.refreshToken,
        },
      }));
    } else {
      useStore.setState((state) => ({
        llmConfig: {
          ...state.llmConfig,
          cloudMode: false as any,
          serverUrl: undefined,
          accessToken: undefined,
          refreshToken: undefined,
        },
      }));
    }
  },

  setServerUrl: (url) => {
    setServerUrl(url);
    set({ serverUrl: url });
  },

  fetchProfile: async () => {
    try {
      const user = await backendApi.get<CloudUser>('/api/v1/user/profile');
      set({ cloudUser: user });
    } catch (e) {
      // 网络不可达（后端未启动）降级为 warn，避免 error 刷屏
      const isNetworkError = e instanceof TypeError && e.message.includes('Failed to fetch');
      if (isNetworkError) {
        logger.system?.warn('[Auth] Fetch profile failed: backend unreachable');
      } else {
        logger.system?.error('[Auth] Fetch profile failed:', e);
      }
    }
  },

  fetchQuota: async () => {
    try {
      const quota = await backendApi.get<CloudQuota>('/api/v1/user/quota');
      set({ quota });
    } catch (e) {
      // 网络不可达（后端未启动）降级为 warn，避免 error 刷屏
      const isNetworkError = e instanceof TypeError && e.message.includes('Failed to fetch');
      if (isNetworkError) {
        logger.system?.warn('[Auth] Fetch quota failed: backend unreachable');
      } else {
        logger.system?.error('[Auth] Fetch quota failed:', e);
      }
    }
  },

  fetchCloudModels: async () => {
    try {
      const models = await backendApi.get<CloudProviderModel[]>('/api/v1/llm/models');
      set({ cloudModels: models || [] });
      return models || [];
    } catch (e) {
      // 网络不可达（后端未启动）降级为 warn，避免 error 刷屏
      const isNetworkError = e instanceof TypeError && e.message.includes('Failed to fetch');
      if (isNetworkError) {
        logger.system?.warn('[Auth] Fetch cloud models failed: backend unreachable');
      } else {
        logger.system?.error('[Auth] Fetch cloud models failed:', e);
      }
      return [];
    }
  },

  selectCloudModel: async () => {
    try {
      const models = await backendApi.get<Array<{ provider: string; models: string[] }>>('/api/v1/llm/models');
      if (models.length === 0) return;

      const { useStore } = await import('@store');
      const currentConfig = useStore.getState().llmConfig;

      // 检查用户已保存的模型是否仍在云端可用列表中
      // 如果是，保留用户的选择（避免重启后恢复到第一个模型）
      if (currentConfig.model) {
        const currentProviderLower = currentConfig.provider?.toLowerCase();
        const currentModelLower = currentConfig.model.toLowerCase();
        const matchingProvider = models.find(
          (m) => m.provider.toLowerCase() === currentProviderLower,
        );
        // 模型名大小写不敏感比较（后端可能返回 'GPT-4' 而本地存的是 'gpt-4'）
        if (matchingProvider && matchingProvider.models.some(m => m.toLowerCase() === currentModelLower)) {
          // 用户保存的模型仍然有效，只需补充云端字段
          useStore.setState((state) => ({
            llmConfig: {
              ...state.llmConfig,
              cloudMode: true as any,
              serverUrl: get().serverUrl,
              accessToken: getTokens()?.accessToken,
            },
          }));
          return;
        }
      }

      // 用户未选择模型或保存的模型已不可用 → 选择第一个可用模型作为兜底
      const firstEntry = models.find((m) => m.models.length > 0);
      if (!firstEntry) return;
      const firstProvider = firstEntry.provider.toLowerCase();
      const firstModel = firstEntry.models[0];
      useStore.setState((state) => ({
        llmConfig: {
          ...state.llmConfig,
          provider: firstProvider,
          model: firstModel,
          cloudMode: true as any,
          serverUrl: get().serverUrl,
          accessToken: getTokens()?.accessToken,
        },
      }));
    } catch (e) {
      logger.system?.error('[Auth] DropdownSelector cloud model failed:', e);
    }
  },

  restoreSession: async () => {
    const persisted = loadPersistedAuth();

    // 始终优先从配置文件读取服务器地址（运维可通过 aweeclaw-config.json 统一切换环境）
    // 否则旧版本持久化的 localhost 等地址会一直被沿用，无法更新到生产域名
    let effectiveServerUrl = persisted?.serverUrl || ''
    try {
      const { api } = await import('../../adapters/electronBridge')
      const config = await api.settings.getAppConfig()
      if (config?.serverUrl) {
        effectiveServerUrl = config.serverUrl
        setServerUrl(config.serverUrl)
        set({ serverUrl: config.serverUrl })
        // 同步更新持久化的 serverUrl，避免下次启动仍使用旧值
        if (persisted && persisted.serverUrl !== config.serverUrl) {
          persistAuth({
            ...persisted,
            serverUrl: config.serverUrl,
          })
        }
      }
    } catch { /* 配置文件不存在或读取失败，忽略 */ }

    if (!persisted || !persisted.accessToken) return;

    // 使用配置文件中的 serverUrl（如有），否则回退到持久化的值
    setServerUrl(effectiveServerUrl);
    setTokens({ accessToken: persisted.accessToken, refreshToken: persisted.refreshToken });
    set({ serverUrl: effectiveServerUrl, cloudMode: persisted.cloudMode });

    // 用当前 accessToken 请求 profile
    // backendApi.request 内部自动处理 401 和 token refresh
    try {
      const profile = await backendApi.get<CloudUser>('/api/v1/user/profile');
      set({ isAuthenticated: true, cloudUser: profile });
    } catch (e) {
      // 检查 token 是否已被 backendApi 的 401 处理器清除
      if (!getTokens()) {
        logger.system.warn('[Auth] restoreSession: token cleared, session expired');
        return;
      }
      // token 有效但 profile 请求失败（网络问题等），保留认证状态
      logger.system.error('[Auth] Fetch profile after restore failed:', e);
      set({ isAuthenticated: true });
    }

    // 会话恢复成功后
    get().fetchQuota().catch(() => {});
    // 预加载功能权限配置（付费墙）
    preloadFeatures().catch(() => {});
    if (persisted.cloudMode === 'cloud') {
      get().selectCloudModel().catch(() => {});
    }
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },
  }
}

// ─── 全局回调注册 ───────────────────────────────────────

setOnTokenRefresh((newTokens) => {
  const persisted = loadPersistedAuth();
  if (persisted) {
    persistAuth({ ...persisted, accessToken: newTokens.accessToken, refreshToken: newTokens.refreshToken });
  } else {
    // localStorage 被清空但内存中仍有 token，重新持久化
    import('@store').then(({ useStore }) => {
      const { serverUrl, cloudMode } = useStore.getState();
      if (serverUrl) {
        persistAuth({ serverUrl, accessToken: newTokens.accessToken, refreshToken: newTokens.refreshToken, cloudMode: cloudMode || 'cloud' });
      }
    }).catch(() => {});
  }
  // 同步推送新 token 给设备联动模块，让 WS 用新 token 重连
  pushDeviceLinkCredentials();
});

setOnAuthFailed(() => {
  if (authFailedHandler) {
    authFailedHandler();
  }
});

// 监听主进程云端 token 刷新事件
api.llm.onCloudTokenRefreshed((data) => {
  logger.system.info('[Auth] Cloud token refreshed from main process')
  syncRefreshedTokens(data.accessToken, data.refreshToken)
  // 主进程刷新的 token 也同步到设备联动模块
  pushDeviceLinkCredentials()
})

// 监听主进程云端认证失效事件
api.llm.onCloudAuthFailed(() => {
  logger.system.warn('[Auth] Cloud auth failed from main process')
  // 通知设备联动模块断开 WS（避免用失效 token 持续重连）
  void api.deviceLink.clearCredentials().catch(() => {})
  if (authFailedHandler) {
    authFailedHandler()
  }
})

// 系统从睡眠恢复时，检查 token 是否需要刷新
api.system.onResume(() => {
  logger.system.info('[Auth] System resumed from sleep, checking token')
  tryRefreshToken().catch(() => {})
})

// 页面从后台恢复到前台时，检查 token
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tryRefreshToken().catch(() => {})
  }
})

// ============================================================================
// 设备联动：监听来自移动端的 AI 任务 / 场景运行请求
// ============================================================================

/**
 * 收到远程 AI 任务请求后，通过 window CustomEvent 派发给 PluginHostBridge，
 * 由其调用 useAgentCommands().sendMessage() 发送到当前会话。
 * 完成后通过 api.deviceLink.replyResult 回复主进程。
 */
api.deviceLink.onAiTask((payload) => {
  const { requestId, prompt, needResult } = payload
  logger.system.info(`[DeviceLink] AI task received: requestId=${requestId} prompt=${prompt.slice(0, 60)}...`)

  if (!prompt) {
    api.deviceLink.replyResult(requestId, { success: false, error: 'empty_prompt' })
    return
  }

  // 通过 window event 派发给 PluginHostBridge（复用插件发送消息的机制）
  const event = new CustomEvent('aweeclaw:device-link:ai-task', {
    detail: { text: prompt },
  })
  window.dispatchEvent(event)

  // AI 任务是异步的，LLM 流式回复需要时间，这里立即回复 queued
  // 实际结果会通过 SSE command-result 事件推送到移动端
  if (needResult) {
    // 给一定时间让消息发送流程启动，超时则回复 queued
    setTimeout(() => {
      api.deviceLink.replyResult(requestId, {
        success: true,
        output: 'task_queued',
      })
    }, 500)
  } else {
    api.deviceLink.replyResult(requestId, { success: true })
  }
})

/**
 * 收到远程场景运行请求后，同样通过 window event 派发。
 */
api.deviceLink.onRunScenario((payload) => {
  const { requestId, scenarioId, prompt } = payload
  logger.system.info(`[DeviceLink] Run scenario: requestId=${requestId} scenario=${scenarioId}`)

  if (prompt) {
    const event = new CustomEvent('aweeclaw:device-link:ai-task', {
      detail: { text: prompt, scenarioId },
    })
    window.dispatchEvent(event)
  }

  api.deviceLink.replyResult(requestId, { success: true, output: 'scenario_started' })
})
