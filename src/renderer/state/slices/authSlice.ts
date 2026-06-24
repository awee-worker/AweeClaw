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
import { toast } from '@components/foundation/NotificationProvider'
import { api } from '../../adapters/electronBridge'
import { aweeclawDir } from '../../adapters/appDirService'
import { knowledgeSyncService } from '@intelligence/runtime/knowledgeService/syncService'
import { knowledgeGraphSyncService } from '@intelligence/runtime/knowledgeService/graphSyncService'
import { t, type Language } from '@renderer/i18n'
import { restoreWorkspaceAgentStore } from '@services/workspaceLoader'

/** 认证成功后：归属孤儿线程 + 修复缺失标题 + 重新加载会话数据 */
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

let authFailedHandler: (() => void) | null = null

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set, get) => {
  authFailedHandler = () => {
    logger.system.warn('[Auth] authFailedHandler called, clearing all auth state')
    clearPersistedAuth();

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
    setServerUrl(url);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/login',
      { email, password },
    );
    // 设置 token + 持久化 + 更新 UI 状态
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    persistAuth({ serverUrl: url, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: 'cloud' });
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });

    // 顺序：先获取 profile，再并发获取其他数据
    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  phoneLogin: async (url, phone, code) => {
    setServerUrl(url);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/phone-login',
      { phone, code },
    );
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    persistAuth({ serverUrl: url, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: 'cloud' });
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });

    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  register: async (url, email, password, username) => {
    setServerUrl(url);
    const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
      '/api/v1/auth/register',
      { email, password, username },
    );
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    persistAuth({ serverUrl: url, accessToken: data.accessToken, refreshToken: data.refreshToken, cloudMode: 'cloud' });
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });

    await get().fetchProfile();
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
    onAuthSuccess(get().cloudUser?.id).catch(() => {});
    knowledgeSyncService.startAutoSync();
    knowledgeSyncService.syncToServer().catch(() => {});
    knowledgeGraphSyncService.startAutoSync();
  },

  forgotPassword: async (url, email) => {
    setServerUrl(url);
    await backendApi.post<{ message: string }>(
      '/api/v1/auth/forgot-password',
      { email },
    );
  },

  resetPassword: async (url, email, code, newPassword) => {
    setServerUrl(url);
    await backendApi.post<{ message: string }>(
      '/api/v1/auth/reset-password',
      { email, code, newPassword },
    );
  },

  logout: () => {
    knowledgeSyncService.stopAutoSync();
    knowledgeGraphSyncService.stopAutoSync();
    setTokens(null);
    clearPersistedAuth();
    set({ isAuthenticated: false, cloudUser: null, quota: null, cloudMode: 'local' });
    restoreWorkspaceAgentStore().catch(() => {});
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
      if (models.length > 0 && models[0].models.length > 0) {
        const firstProvider = models[0].provider.toLowerCase();
        const firstModel = models[0].models[0];
        const { useStore } = await import('@store');
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
      }
    } catch (e) {
      logger.system?.error('[Auth] DropdownSelector cloud model failed:', e);
    }
  },

  restoreSession: async () => {
    const persisted = loadPersistedAuth();

    // 即使没有持久化的登录信息，也尝试从配置文件读取服务器地址
    if (!persisted?.serverUrl) {
      try {
        const { api } = await import('../../adapters/electronBridge')
        const config = await api.settings.getAppConfig()
        if (config?.serverUrl) {
          setServerUrl(config.serverUrl)
          set({ serverUrl: config.serverUrl })
        }
      } catch { /* 配置文件不存在或读取失败，忽略 */ }
    }

    if (!persisted || !persisted.accessToken) return;

    setServerUrl(persisted.serverUrl);
    setTokens({ accessToken: persisted.accessToken, refreshToken: persisted.refreshToken });
    set({ serverUrl: persisted.serverUrl, cloudMode: persisted.cloudMode });

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
})

// 监听主进程云端认证失效事件
api.llm.onCloudAuthFailed(() => {
  logger.system.warn('[Auth] Cloud auth failed from main process')
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
