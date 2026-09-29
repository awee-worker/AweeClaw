/**
 * 模式状态管理
 *
 * 通过 electron-store (preferencesStore) 持久化，
 * 与其他设置统一存储后端，通过 IPC 调用 settings:get/set
 *
 * 当前产品策略：默认固定为 expert（专家档）。历史 chat/agent/plan 值在写入时归一到 expert，
 * 避免界面隐藏模式选择后仍从本地缓存读回低档位或旧命名。
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { WorkMode } from './workModeTypes'
import { api } from '../adapters/electronBridge'

const STORE_KEY = 'modeStore'

/** 归一化到专家档：产品策略固定为 expert，历史 chat/agent/plan 不再作为可切换档位 */
function normalizeToExpertMode(_mode: WorkMode): WorkMode {
  return 'expert'
}

interface ModeState {
    /** 当前工作模式 */
    currentMode: WorkMode
    /** 上一个模式（用于切换回去） */
    previousMode: WorkMode | null
}

interface ModeActions {
    /** 设置当前模式 */
    setMode: (mode: WorkMode) => void
    /** 切换回上一个模式 */
    restorePreviousMode: () => void
    /** 检查是否为指定模式 */
    isMode: (mode: WorkMode) => boolean
}

type ModeStore = ModeState & ModeActions

/**
 * 自定义 Storage：通过 IPC 存到 electron-store 的 preferencesStore
 * 统一与其他设置的存储后端，避免使用 localStorage
 */
const electronStoreStorage = {
    getItem: async (name: string): Promise<string | null> => {
        try {
            const value = await api.settings.get(`${STORE_KEY}.${name}`)
            return value ? JSON.stringify(value) : null
        } catch {
            return null
        }
    },
    setItem: async (name: string, value: string): Promise<void> => {
        try {
            const parsed = JSON.parse(value)
            await api.settings.set(`${STORE_KEY}.${name}`, parsed)
        } catch { /* ignore */ }
    },
    removeItem: async (name: string): Promise<void> => {
        try {
            await api.settings.set(`${STORE_KEY}.${name}`, undefined)
        } catch { /* ignore */ }
    },
}

export const useModeStore = create<ModeStore>()(
    persist(
        (set, get) => ({
            currentMode: 'expert', // 默认专家档
            previousMode: null,

            setMode: (mode) => {
                const nextMode = normalizeToExpertMode(mode)
                const current = get().currentMode
                if (current !== nextMode) {
                    set({
                        currentMode: nextMode,
                        previousMode: current
                    })
                }
            },

            restorePreviousMode: () => {
                const previous = get().previousMode
                if (previous) {
                    set({
                        currentMode: normalizeToExpertMode(previous),
                        previousMode: null
                    })
                }
            },

            isMode: (mode) => get().currentMode === normalizeToExpertMode(mode)
        }),
        {
            name: 'aweeclaw-mode-store',
            storage: createJSONStorage(() => electronStoreStorage),
            partialize: (state) => ({
                currentMode: state.currentMode
            }),
            onRehydrateStorage: () => (state) => {
                if (state && state.currentMode !== 'expert') {
                    state.currentMode = 'expert'
                }
            }
        }
    )
)
