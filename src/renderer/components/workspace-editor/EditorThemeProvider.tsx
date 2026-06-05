import React, { useEffect, ReactNode } from 'react';
import { logger } from '@shared/toolkit/LogEngine';
import { useStore } from '@store';
import { ThemeName } from '@store/slices/themeSlice';
import { themeManager } from '@/renderer/config/themeDefinition';
import { api } from '../../adapters/electronBridge';
import { BRAND } from '@shared/brand';

interface ThemeManagerProps {
    children: ReactNode;
}

export const ThemeManager: React.FC<ThemeManagerProps> = ({ children }) => {
    const currentTheme = useStore((state) => state.currentTheme) as ThemeName;

    useEffect(() => {
        const theme = themeManager.getThemeById(currentTheme) || themeManager.getThemeById(BRAND.defaultTheme)!;

        // Use the global themeManager to apply CSS vars and attributes
        themeManager.applyTheme(theme);

        const isLight = theme.type === 'light';
        const bgColors = (typeof theme.colors.background === 'string' ? theme.colors.background : '').split(' ').map(Number);

        // Convert Tailwind RGB string (e.g. "255 255 255") to Hex for Electron
        let hexColor = isLight ? '#ffffff' : '#09090b';
        if (bgColors.length === 3 && !bgColors.some(isNaN)) {
            const [r, g, b] = bgColors;
            hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        }

        // SYNC OS LEVEL THEME SO CHROME INVERTS CARET/CURSOR COLOR
        api.window.setTheme(isLight ? 'light' : 'dark', hexColor).catch(err => {
            logger.ui.error('Failed to sync OS native theme:', err)
        });

    }, [currentTheme]);

    return <>{children}</>;
};
