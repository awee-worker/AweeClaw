import { StateCreator } from 'zustand'
import { logger } from '@shared/utils/Logger'
import {
  setServerUrl,
  setTokens,
  getTokens,
  setOnTokenRefresh,
  setOnAuthFailed,
  tryRefreshToken,
  backendApi,
} from '@renderer/services/backendApi'
import { toast } from '@renderer/components/common/ToastProvider'
import { api } from '@renderer/services/electronAPI'

export interface CloudUser {
  id: string
  email: string
  username?: string
  avatarUrl?: string
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
}

export interface AuthSlice {
  isAuthenticated: boolean
  cloudUser: CloudUser | null
  cloudMode: 'local' | 'cloud'
  serverUrl: string
  quota: CloudQuota | null
  cloudModels: CloudProviderModel[]

  login: (serverUrl: string, email: string, password: string) => Promise<void>
  register: (serverUrl: string, email: string, password: string, username?: string) => Promise<void>
  logout: () => void
  setCloudMode: (mode: 'local' | 'cloud') => void
  setServerUrl: (url: string) => void
  fetchProfile: () => Promise<void>
  fetchQuota: () => Promise<void>
  fetchCloudModels: () => Promise<CloudProviderModel[]>
  restoreSession: () => Promise<void>
  selectCloudModel: () => Promise<void>
}

const STORAGE_KEY = 'aweeclaw-cloud-auth';

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
  authFailedHandler = () => {
    clearPersistedAuth();
    const state = get();
    if (state.isAuthenticated) {
      set({ isAuthenticated: false, cloudUser: null, quota: null, cloudMode: 'local' });
      import('@store').then(({ useStore }) => {
        const language = useStore.getState().language as 'en' | 'zh';
        toast.error(
          language === 'zh' ? '登录已过期' : 'Session Expired',
          language === 'zh' ? '您的登录已过期，请重新登录' : 'Your session has expired. Please sign in again.',
        );
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
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
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
    get().fetchQuota().catch(() => {});
    get().selectCloudModel().catch(() => {});
  },

  logout: () => {
    setTokens(null);
    clearPersistedAuth();
    set({ isAuthenticated: false, cloudUser: null, quota: null, cloudMode: 'local' });
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
      logger.system?.error('[Auth] Select cloud model failed:', e);
    }
  },

  restoreSession: async () => {
    const persisted = loadPersistedAuth();
    if (!persisted) return;

    setServerUrl(persisted.serverUrl);
    setTokens({ accessToken: persisted.accessToken, refreshToken: persisted.refreshToken });
    set({ serverUrl: persisted.serverUrl, cloudMode: persisted.cloudMode });

    try {
      const profile = await backendApi.get<CloudUser>('/api/v1/user/profile');
      set({ isAuthenticated: true, cloudUser: profile });
      get().fetchQuota().catch(() => {});
      if (persisted.cloudMode === 'cloud') {
        get().selectCloudModel().catch(() => {});
      }
    } catch {
      const currentTokens = getTokens();
      if (currentTokens?.refreshToken) {
        try {
          const data = await backendApi.post<{ accessToken: string; refreshToken: string }>(
            '/api/v1/auth/refresh',
            { refreshToken: currentTokens.refreshToken },
          );
          setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          persistAuth({
            serverUrl: persisted.serverUrl,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            cloudMode: persisted.cloudMode,
          });
          const profile = await backendApi.get<CloudUser>('/api/v1/user/profile');
          set({ isAuthenticated: true, cloudUser: profile });
          get().fetchQuota().catch(() => {});
          if (persisted.cloudMode === 'cloud') {
            get().selectCloudModel().catch(() => {});
          }
        } catch {
          setTokens(null);
          clearPersistedAuth();
          set({ isAuthenticated: false, cloudUser: null, cloudMode: 'local' });
        }
      } else {
        setTokens(null);
        clearPersistedAuth();
        set({ isAuthenticated: false, cloudUser: null, cloudMode: 'local' });
      }
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

api.system.onResume(() => {
  logger.system.info('[Auth] System resumed from sleep, attempting token refresh')
  tryRefreshToken().catch(() => {})
})
