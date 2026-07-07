import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeDefinition'
import { BRAND } from '@shared/brand'
import { StorageService } from '@shared/toolkit/StorageService'
import { logger } from '@shared/toolkit/LogEngine'

export type BuiltinThemeName = 'aweeclaw-light' | 'purple-light' | 'lobster-red-light' | 'forest-green-light' | 'aweeclaw-dark' | 'purple-dark' | 'lobster-red-dark' | 'forest-green-dark'

export type ThemeName = string

export type ThemeMode = 'light' | 'dark' | 'system'

/** 主题颜色（与模式独立，亮/暗色均支持这4种颜色） */
export type ThemeColor = 'blue' | 'purple' | 'red' | 'green'

export interface ThemeSlice {
    currentTheme: ThemeName;
    themeMode: ThemeMode;
    themeColor: ThemeColor;
    systemPrefersDark: boolean;
    setTheme: (theme: ThemeName) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setThemeColor: (color: ThemeColor) => void;
    setSystemPrefersDark: (prefersDark: boolean) => void;
}

const STORAGE_KEY_THEME_MODE = `${BRAND.cssPrefix}-theme-mode`
const STORAGE_KEY_THEME_COLOR = `${BRAND.cssPrefix}-theme-color`

function getInitialThemeMode(): ThemeMode {
    const saved = StorageService.get<string>(STORAGE_KEY_THEME_MODE)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved

    // 兜底 1：从 themeType 推断（themeManager.saveToConfig 保存的值）
    const savedType = StorageService.get<string>(BRAND.storageKeys.themeType)
    if (savedType === 'light' || savedType === 'dark') return savedType

    // 兜底 2：从 themeId 推断（主题 ID 以 -dark 结尾则为暗色）
    const savedThemeId = StorageService.get<string>(BRAND.storageKeys.themeId)
    if (savedThemeId) {
        if (savedThemeId.endsWith('-dark')) return 'dark'
        if (savedThemeId.endsWith('-light')) return 'light'
    }

    return 'light'
}

function getInitialThemeColor(): ThemeColor {
    const saved = StorageService.get<string>(STORAGE_KEY_THEME_COLOR)
    if (saved === 'blue' || saved === 'purple' || saved === 'red' || saved === 'green') return saved
    return 'blue'
}

function getSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    const savedTheme = StorageService.get<string>(BRAND.storageKeys.themeId)
    const validIds = builtinThemes.map(t => t.id)
    const initialTheme = savedTheme && (validIds.includes(savedTheme) || savedTheme.startsWith('custom-'))
        ? savedTheme
        : BRAND.lightTheme

    const initialMode = getInitialThemeMode()
    const initialColor = getInitialThemeColor()

    return {
        currentTheme: initialTheme,
        themeMode: initialMode,
        themeColor: initialColor,
        systemPrefersDark: getSystemPrefersDark(),
        setTheme: (theme) => set({ currentTheme: theme }),
        setThemeMode: (mode) => {
            StorageService.set(STORAGE_KEY_THEME_MODE, mode)
            set({ themeMode: mode })
            // 异步同步到 electron-store（持久化到文件，防止 localStorage 丢失）
            try {
                import('@/renderer/adapters/electronBridge').then(({ api }) => {
                    api.settings.set('themeMode', mode).catch((e: unknown) => {
                        logger.ui.warn('[ThemeSlice] Failed to persist themeMode to electron-store:', e)
                    })
                })
            } catch (e) {
                // ignore import errors
            }
        },
        setThemeColor: (color) => {
            StorageService.set(STORAGE_KEY_THEME_COLOR, color)
            set({ themeColor: color })
            // 异步同步到 electron-store
            try {
                import('@/renderer/adapters/electronBridge').then(({ api }) => {
                    api.settings.set('themeColor', color).catch((e: unknown) => {
                        logger.ui.warn('[ThemeSlice] Failed to persist themeColor to electron-store:', e)
                    })
                })
            } catch (e) {
                // ignore import errors
            }
        },
        setSystemPrefersDark: (prefersDark) => set({ systemPrefersDark: prefersDark }),
    }
}
