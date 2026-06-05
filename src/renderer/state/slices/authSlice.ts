import { StateCreator } from 'zustand'
import { logger } from '@shared/toolkit/LogEngine'
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
import { knowledgeSyncService } from '@intelligence/runtime/knowledgeService/syncService'
import { knowledgeGraphSyncService } from '@intelligence/runtime/knowledgeService/graphSyncService'
import { t, type Language } from '@renderer/i18n'
import { restoreWorkspaceAgentStore } from '@services/workspaceLoader'

/** 认证成功后：归属孤儿线程 + 重新加载会话数据 */
async function onAuthSuccess(userId: string | undefined): Promise<void> {
  if (userId) {
    try {
      await api.sessionDb.claimOrphanThreads(userId)
      logger.system.info('[Auth] Orphan threads claimed for user:', userId)
    } catch (e) {
      logger.system.warn('[Auth] claimOrphanThreads failed:', e)
    }
  }
  // 重新加载会话数据（此时 cloudUser 已设置，buildSessionCatalog 会按 userId 过滤）
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function loadPersistedAuth(): {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  cloudMode: 'local' | 'cloud';
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPersistedAuth() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

let authFailedHandler: (() => void) | null = null

export const createAuthSlice: StateCreator<AuthSlice, [], [], AuthSlice> = (set, get) => {
  // onAuthFailed 仅在 refresh token 确认失效（401/403）时由 backendApi 触发
  // 临时网络错误和服务器 5xx 不会触发此回调
  authFailedHandler = () => {
    clearPersistedAuth();

    const state = get();
    if (state.isAuthenticated) {
      set({ isAuthenticated: false, cloudUser: null, quota: null, cloudMode: 'local' });
      import('@store').then(({ useStore }) => {
        const language = useStore.getState().language as 'en' | 'zh';
        toast.error(
          t('app.sessionexpired', language as Language),
          t('app.yoursessionhasexpiredplease', language as Language),
        );
        useStore.getState().setShowWelcomePage(true);
      }).catch(() => {
        toast.error('登录已过期', '您的登录已过期，请重新登录');
      });
    }
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
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });
    persistAuth({
      serverUrl: url,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      cloudMode: 'cloud',
    });
    await get().fetchProfile();
    // 登录成功后：归属孤儿线程 + 重新加载会话
    onAuthSuccess(get().cloudUser?.id).catch(() => {})
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
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
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });
    persistAuth({
      serverUrl: url,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      cloudMode: 'cloud',
    });
    await get().fetchProfile();
    onAuthSuccess(get().cloudUser?.id).catch(() => {})
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
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
    set({ serverUrl: url, isAuthenticated: true, cloudMode: 'cloud' });
    persistAuth({
      serverUrl: url,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      cloudMode: 'cloud',
    });
    await get().fetchProfile();
    onAuthSuccess(get().cloudUser?.id).catch(() => {})
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
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
    // 登出后重新加载未关联用户的线程
    restoreWorkspaceAgentStore().catch(() => {})
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
      logger.system?.error('[Auth] Fetch profile failed:', e);
    }
  },

  fetchQuota: async () => {
    try {
      const quota = await backendApi.get<CloudQuota>('/api/v1/user/quota');
      set({ quota });
    } catch (e) {
      logger.system?.error('[Auth] Fetch quota failed:', e);
    }
  },

  fetchCloudModels: async () => {
    try {
      const models = await backendApi.get<CloudProviderModel[]>('/api/v1/llm/models');
      set({ cloudModels: models || [] });
      return models || [];
    } catch (e) {
      logger.system?.error('[Auth] Fetch cloud models failed:', e);
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
    if (!persisted) return;

    setServerUrl(persisted.serverUrl);
    setTokens({ accessToken: persisted.accessToken, refreshToken: persisted.refreshToken });
    set({ serverUrl: persisted.serverUrl, cloudMode: persisted.cloudMode });

    // 先尝试用 refreshToken 刷新获取新的 accessToken，避免旧 accessToken 过期导致 401
    let sessionRestored = false;

    if (persisted.refreshToken) {
      try {
        const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
          '/api/v1/auth/refresh',
          { refreshToken: persisted.refreshToken },
        );
        setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        persistAuth({
          serverUrl: persisted.serverUrl,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          cloudMode: persisted.cloudMode,
        });
        sessionRestored = true;
      } catch {
        // refreshToken 也失效了，尝试用旧 accessToken 请求 profile 作为最后手段
        logger.system.warn('[Auth] Refresh token failed, trying existing access token');
      }
    }

    if (!sessionRestored) {
      // 降级：尝试用旧 accessToken 直接请求 profile
      try {
        const profile = await backendApi.get<CloudUser>('/api/v1/user/profile');
        set({ isAuthenticated: true, cloudUser: profile });
        sessionRestored = true;
      } catch {
        // accessToken 也过期了，清除认证状态
        setTokens(null);
        clearPersistedAuth();
        set({ isAuthenticated: false, cloudUser: null, cloudMode: 'local' });
        return;
      }
    }

    if (sessionRestored) {
      try {
        const profile = await backendApi.get<CloudUser>('/api/v1/user/profile');
        set({ isAuthenticated: true, cloudUser: profile });
      } catch (e) {
        logger.system.error('[Auth] Fetch profile after restore failed:', e);
        // profile 获取失败不影响登录状态
        set({ isAuthenticated: true });
      }
      get().fetchQuota().catch(() => {});
      if (persisted.cloudMode === 'cloud') {
        get().selectCloudModel().catch(() => {});
      }
      // 会话恢复成功后：归属孤儿线程 + 重新加载会话数据
      onAuthSuccess(get().cloudUser?.id).catch(() => {})
      knowledgeSyncService.startAutoSync();
      knowledgeSyncService.syncToServer().catch(() => {});
      knowledgeGraphSyncService.startAutoSync();
    }
  },
  }
}

setOnTokenRefresh((newTokens) => {
  const persisted = loadPersistedAuth();
  if (persisted) {
    persistAuth({
      ...persisted,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    });
  }
});

setOnAuthFailed(() => {
  if (authFailedHandler) {
    authFailedHandler();
  }
});

// 监听主进程云端 token 刷新事件，同步到渲染进程
// 避免 cloudFetch 刷新 token 后，渲染进程仍使用已撤销的 refreshToken 导致认证失效
api.llm.onCloudTokenRefreshed((data) => {
  logger.system.info('[Auth] Cloud token refreshed from main process, syncing to renderer')
  syncRefreshedTokens(data.accessToken, data.refreshToken)
})

api.system.onResume(() => {
  logger.system.info('[Auth] System resumed from sleep, attempting token refresh')
  tryRefreshToken().catch(() => {})
})

// 页面从后台恢复到前台时，检查并刷新 token
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tryRefreshToken().catch(() => {})
  }
})
