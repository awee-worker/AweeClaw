import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeDefinition'
import { BRAND } from '@shared/brand'
import { StorageService } from '@shared/toolkit/StorageService'

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
        },
        setThemeColor: (color) => {
            StorageService.set(STORAGE_KEY_THEME_COLOR, color)
            set({ themeColor: color })
        },
        setSystemPrefersDark: (prefersDark) => set({ systemPrefersDark: prefersDark }),
    }
}
