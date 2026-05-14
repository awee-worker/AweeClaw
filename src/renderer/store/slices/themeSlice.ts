import { StateCreator } from 'zustand'
import { builtinThemes } from '@/renderer/config/themeConfig'
import { BRAND } from '@shared/brand'

export type BuiltinThemeName = typeof BRAND.lightTheme | typeof BRAND.defaultTheme | 'midnight' | 'dawn' | 'cyberpunk' | 'lobster'

export type ThemeName = string

export interface ThemeSlice {
    currentTheme: ThemeName;
    setTheme: (theme: ThemeName) => void;
}

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set) => {
    const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(BRAND.storageKeys.themeId) : null
    const validIds = builtinThemes.map(t => t.id)
    const initialTheme = savedTheme && (validIds.includes(savedTheme) || savedTheme.startsWith('custom-'))
        ? savedTheme
        : BRAND.lightTheme

    return {
        currentTheme: initialTheme,
        setTheme: (theme) => set({ currentTheme: theme }),
    }
}
