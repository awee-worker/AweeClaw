import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeDefinition'
import { BRAND } from '@shared/brand'

export type BuiltinThemeName = 'aweeclaw-light' | 'purple-light' | 'lobster-red-light' | 'forest-green-light' | 'aweeclaw-dark' | 'purple-dark' | 'lobster-red-dark' | 'forest-green-dark'

export type ThemeName = string

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeSlice {
    currentTheme: ThemeName;
    themeMode: ThemeMode;
    systemPrefersDark: boolean;
    setTheme: (theme: ThemeName) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setSystemPrefersDark: (prefersDark: boolean) => void;
}

const STORAGE_KEY_THEME_MODE = `${BRAND.cssPrefix}-theme-mode`

function getInitialThemeMode(): ThemeMode {
    if (typeof localStorage === 'undefined') return 'light'
    const saved = localStorage.getItem(STORAGE_KEY_THEME_MODE)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    return 'light'
}

function getSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(BRAND.storageKeys.themeId) : null
    const validIds = builtinThemes.map(t => t.id)
    const initialTheme = savedTheme && (validIds.includes(savedTheme) || savedTheme.startsWith('custom-'))
        ? savedTheme
        : BRAND.lightTheme

    const initialMode = getInitialThemeMode()

    return {
        currentTheme: initialTheme,
        themeMode: initialMode,
        systemPrefersDark: getSystemPrefersDark(),
        setTheme: (theme) => set({ currentTheme: theme }),
        setThemeMode: (mode) => {
            localStorage.setItem(STORAGE_KEY_THEME_MODE, mode)
            set({ themeMode: mode })
        },
        setSystemPrefersDark: (prefersDark) => set({ systemPrefersDark: prefersDark }),
    }
}
