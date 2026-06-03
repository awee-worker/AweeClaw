/**
 * 主题系统配置
 * 支持内置主题和自定义主题
 * 使用 RGB 格式以支持 Tailwind 透明度修饰符
 */

import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { BRAND } from '@shared/brand'

export interface ThemeColors {
  // 背景色 (RGB 格式: "r g b")
  background: string
  backgroundSecondary: string
  backgroundTertiary: string
  chatBg: string

  // 表面色
  surface: string
  surfaceHover: string
  surfaceActive: string
  surfaceMuted: string

  // 文字色
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverted: string

  // 边框色
  border: string
  borderSubtle: string
  borderActive: string

  // 强调色
  accent: string
  accentHover: string
  accentActive: string
  accentForeground: string
  accentSubtle: string

  // 状态色
  statusSuccess: string
  statusWarning: string
  statusError: string
  statusInfo: string
}

export interface Theme {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: ThemeColors
  monacoTheme: string
}

// 辅助函数：将 HEX 转换为 RGB 格式 "r g b"
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0 0'
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
}

// 内置主题 (使用 RGB 格式)
// 命名规范：亮色 *-light / 暗色 *-dark，按色系配对排列
export const builtinThemes: Theme[] = [
  // ========== 亮色主题 ==========
  {
    id: 'aweeclaw-light',
    name: 'AweeClaw Light',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '245 250 255',          // #f5faff 冰蓝白
      backgroundSecondary: '238 246 253', // #eef6fd 淡蓝白
      backgroundTertiary: '228 240 250',  // #e4f0fa 浅蓝灰
      chatBg: '248 251 255',              // #f8fbff 纯净蓝白

      surface: '255 255 255',
      surfaceHover: '228 240 250',
      surfaceActive: '215 232 245',
      surfaceMuted: '200 222 240',

      textPrimary: '15 30 50',
      textSecondary: '50 70 95',
      textMuted: '100 120 145',
      textInverted: '245 250 255',

      border: '200 222 240',
      borderSubtle: '222 238 250',
      borderActive: '57 190 248',

      accent: '57 190 248',            // #39bef8 天空蓝
      accentHover: '30 165 230',       // #1ea5e6 深天空蓝
      accentActive: '15 140 210',      // #0f8cd2 更深蓝
      accentForeground: '255 255 255',
      accentSubtle: '100 210 255',     // #64d2ff 亮天蓝

      statusSuccess: '22 140 70',
      statusWarning: '195 120 15',
      statusError: '195 45 35',
      statusInfo: '30 130 200',
    },
  },
  {
    id: 'purple-light',
    name: 'Purple Light',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '248 245 255',          // #f8f5ff 淡紫白
      backgroundSecondary: '242 238 252', // #f2eefc 浅紫灰
      backgroundTertiary: '232 225 245',  // #e8e1f5 紫灰
      chatBg: '250 248 255',              // #faf8ff 纯净紫白

      surface: '255 255 255',
      surfaceHover: '232 225 245',
      surfaceActive: '220 210 238',
      surfaceMuted: '205 195 225',

      textPrimary: '30 20 50',
      textSecondary: '60 45 85',
      textMuted: '110 90 135',
      textInverted: '248 245 255',

      border: '205 195 225',
      borderSubtle: '228 222 242',
      borderActive: '139 92 246',

      accent: '139 92 246',            // Violet 500
      accentHover: '124 58 237',       // Violet 600
      accentActive: '109 40 217',      // Violet 700
      accentForeground: '255 255 255',
      accentSubtle: '167 139 250',     // Violet 400

      statusSuccess: '22 140 70',
      statusWarning: '195 120 15',
      statusError: '195 45 35',
      statusInfo: '80 100 200',
    },
  },
  {
    id: 'lobster-red-light',
    name: 'Lobster Red Light',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '255 252 249',         // #fffcf9 暖白
      backgroundSecondary: '250 245 240', // #faf5f0 淡暖灰
      backgroundTertiary: '243 236 229',  // #f3ece5 暖灰
      chatBg: '253 249 245',              // #fdf9f5 暖白

      surface: '255 255 255',
      surfaceHover: '243 236 229',
      surfaceActive: '235 226 218',
      surfaceMuted: '222 212 202',

      textPrimary: '45 30 25',
      textSecondary: '95 75 65',
      textMuted: '140 120 108',
      textInverted: '255 252 249',

      border: '225 215 205',
      borderSubtle: '240 233 225',
      borderActive: '190 165 150',

      accent: '210 60 42',           // 小龙虾红
      accentHover: '190 48 35',      // 深龙虾红
      accentActive: '165 38 28',     // 更深红
      accentForeground: '255 255 255',
      accentSubtle: '230 100 80',    // 亮珊瑚

      statusSuccess: '22 140 70',
      statusWarning: '195 120 15',
      statusError: '195 45 35',
      statusInfo: '40 100 180',
    },
  },
  {
    id: 'forest-green-light',
    name: 'Forest Green Light',
    type: 'light',
    monacoTheme: 'vs',
    colors: {
      background: '245 252 252',          // #f5fcfc 薄荷白
      backgroundSecondary: '238 248 248', // #eef8f8 淡绿白
      backgroundTertiary: '228 242 242',  // #e4f2f2 浅绿灰
      chatBg: '248 253 253',              // #f8fdfd 纯净绿白

      surface: '255 255 255',
      surfaceHover: '228 242 242',
      surfaceActive: '215 234 234',
      surfaceMuted: '200 225 225',

      textPrimary: '20 50 50',
      textSecondary: '50 80 80',
      textMuted: '90 120 120',
      textInverted: '245 252 252',

      border: '200 225 225',
      borderSubtle: '218 240 240',
      borderActive: '0 140 140',

      accent: '0 140 140',            // 森林青绿
      accentHover: '0 120 120',       // 深青绿
      accentActive: '0 100 100',      // 更深青绿
      accentForeground: '255 255 255',
      accentSubtle: '0 170 170',      // 亮青绿

      statusSuccess: '22 140 70',
      statusWarning: '195 120 15',
      statusError: '195 45 35',
      statusInfo: '0 120 160',
    },
  },

  // ========== 暗色主题 ==========
  {
    id: 'aweeclaw-dark',
    name: 'AweeClaw Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '22 27 34',         // #161b22 深蓝灰
      backgroundSecondary: '28 33 42', // #1c212a 侧边栏
      backgroundTertiary: '37 43 54',  // #252b36 输入框
      chatBg: '28 33 42',

      surface: '28 33 42',
      surfaceHover: '45 51 65',
      surfaceActive: '55 61 75',
      surfaceMuted: '70 78 94',

      textPrimary: '220 225 235',
      textSecondary: '155 165 185',
      textMuted: '110 120 140',
      textInverted: '22 27 34',

      border: '45 51 65',
      borderSubtle: '30 36 48',
      borderActive: '80 90 110',

      accent: '56 189 248',          // Sky 400 冰川蓝
      accentHover: '14 165 233',     // Sky 500
      accentActive: '2 132 199',     // Sky 600
      accentForeground: '15 23 42',
      accentSubtle: '125 211 252',   // Sky 300

      statusSuccess: '46 160 90',
      statusWarning: '210 160 30',
      statusError: '240 80 80',
      statusInfo: '60 160 240',
    },
  },
  {
    id: 'purple-dark',
    name: 'Purple Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '18 18 21',         // #121215 极深紫灰
      backgroundSecondary: '25 25 29', // #19191D 侧边栏
      backgroundTertiary: '32 32 37',  // #202025 输入框
      chatBg: '25 25 29',

      surface: '25 25 29',
      surfaceHover: '38 38 44',
      surfaceActive: '45 45 52',
      surfaceMuted: '63 63 70',

      textPrimary: '242 242 247',
      textSecondary: '175 175 192',
      textMuted: '130 130 148',
      textInverted: '18 18 21',

      border: '40 40 48',
      borderSubtle: '32 32 37',
      borderActive: '82 82 100',

      accent: '139 92 246',          // Violet 500
      accentHover: '124 58 237',     // Violet 600
      accentActive: '109 40 217',    // Violet 700
      accentForeground: '255 255 255',
      accentSubtle: '167 139 250',   // Violet 400

      statusSuccess: '52 211 153',
      statusWarning: '251 191 36',
      statusError: '248 113 113',
      statusInfo: '96 165 250',
    },
  },
  {
    id: 'lobster-red-dark',
    name: 'Lobster Red Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '20 14 12',         // #140e0c 极深暖棕黑
      backgroundSecondary: '28 20 18', // #1c1412 深棕
      backgroundTertiary: '38 28 24',  // #261c18 暖棕
      chatBg: '28 20 18',

      surface: '28 20 18',
      surfaceHover: '45 32 28',
      surfaceActive: '58 42 36',
      surfaceMuted: '78 58 50',

      textPrimary: '245 235 228',
      textSecondary: '195 175 165',
      textMuted: '145 125 115',
      textInverted: '20 14 12',

      border: '50 36 30',
      borderSubtle: '35 26 22',
      borderActive: '120 70 55',

      accent: '220 70 50',           // 小龙虾红
      accentHover: '200 55 40',      // 深龙虾红
      accentActive: '175 42 32',     // 更深红
      accentForeground: '255 255 255',
      accentSubtle: '240 110 85',    // 亮珊瑚

      statusSuccess: '72 187 120',
      statusWarning: '237 160 50',
      statusError: '230 80 65',
      statusInfo: '90 155 210',
    },
  },
  {
    id: 'forest-green-dark',
    name: 'Forest Green Dark',
    type: 'dark',
    monacoTheme: 'vs-dark',
    colors: {
      background: '14 22 20',         // #0e1614 极深森林黑
      backgroundSecondary: '20 30 28', // #141e1c 深绿黑
      backgroundTertiary: '28 40 36',  // #1c2824 暗绿灰
      chatBg: '20 30 28',

      surface: '20 30 28',
      surfaceHover: '38 52 48',
      surfaceActive: '48 65 58',
      surfaceMuted: '65 85 75',

      textPrimary: '230 245 238',
      textSecondary: '170 195 180',
      textMuted: '120 145 130',
      textInverted: '14 22 20',

      border: '40 55 48',
      borderSubtle: '28 40 36',
      borderActive: '80 110 90',

      accent: '52 211 153',          // Emerald 400 翡翠绿
      accentHover: '16 185 129',     // Emerald 500
      accentActive: '5 150 105',     // Emerald 600
      accentForeground: '10 30 20',
      accentSubtle: '110 231 183',   // Emerald 300

      statusSuccess: '52 211 153',
      statusWarning: '237 160 50',
      statusError: '230 80 65',
      statusInfo: '90 155 210',
    },
  },
]

// 主题管理器
const LOCAL_STORAGE_THEME_KEY = BRAND.storageKeys.themeId
const LOCAL_STORAGE_CUSTOM_THEMES_KEY = `${BRAND.cssPrefix}-custom-themes`

/** 校验自定义主题的 colors 字段是否完整且为字符串 */
function isValidTheme(t: unknown): t is Theme {
  if (!t || typeof t !== 'object') return false
  const theme = t as Record<string, unknown>
  if (typeof theme.id !== 'string' || typeof theme.name !== 'string') return false
  if (!theme.colors || typeof theme.colors !== 'object') return false
  const colors = theme.colors as Record<string, unknown>
  return typeof colors.background === 'string' && typeof colors.accent === 'string'
}

class ThemeManager {
  private currentTheme: Theme = builtinThemes[0]
  private customThemes: Theme[] = []
  private listeners: Set<(theme: Theme) => void> = new Set()
  private initialized = false
  private mediaQuery: MediaQueryList | null = null
  private mediaQueryHandler: ((e: MediaQueryListEvent) => void) | null = null

  constructor() {
    // 从 localStorage 快速恢复主题（同步，避免闪烁）
    try {
      const savedThemeId = localStorage.getItem(LOCAL_STORAGE_THEME_KEY)
      const savedCustomThemes = localStorage.getItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY)

      if (savedCustomThemes) {
        const parsed = JSON.parse(savedCustomThemes)
        if (Array.isArray(parsed)) {
          this.customThemes = parsed.filter(isValidTheme)
        }
      }

      if (savedThemeId) {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          // 立即应用主题（避免白屏）
          this.applyTheme(theme)
        }
      }
    } catch (e) {
      // 忽略 localStorage 错误
    }
  }

  async loadFromConfig() {
    try {
      // 并行读取主题配置
      const [savedThemeId, savedCustomThemes] = await Promise.all([
        api.settings.get('themeId'),
        api.settings.get('customThemes'),
      ])

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        const validThemes = savedCustomThemes.filter(isValidTheme)
        this.customThemes = validThemes
        localStorage.setItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(validThemes))
      }

      if (savedThemeId && typeof savedThemeId === 'string') {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          localStorage.setItem(LOCAL_STORAGE_THEME_KEY, savedThemeId)
          localStorage.setItem(BRAND.storageKeys.themeBg, theme.colors.background)
          localStorage.setItem(BRAND.storageKeys.themeType, theme.type)
          // Migrate old configs so main.ts can access themeBg on next startup
          try { api.settings.set('themeBg', theme.colors.background) } catch (e) { }
        }
      }
    } catch (e) {
      logger.settings.error('Failed to load theme from config:', e)
    }
  }

  private saveToConfig() {
    // 同步写入 localStorage
    try {
      localStorage.setItem(LOCAL_STORAGE_THEME_KEY, this.currentTheme.id)
      localStorage.setItem(BRAND.storageKeys.themeBg, this.currentTheme.colors.background)
      localStorage.setItem(BRAND.storageKeys.themeType, this.currentTheme.type)
      localStorage.setItem(LOCAL_STORAGE_CUSTOM_THEMES_KEY, JSON.stringify(this.customThemes))
    } catch (e) {
      // 忽略 localStorage 错误
    }
    // 异步写入文件
    try {
      api.settings.set('themeId', this.currentTheme.id)
      api.settings.set('themeBg', this.currentTheme.colors.background)
      api.settings.set('customThemes', this.customThemes)
    } catch (e) {
      logger.settings.error('Failed to save theme to config:', e)
    }
  }

  getAllThemes(): Theme[] {
    return [...builtinThemes, ...this.customThemes]
  }

  getThemeById(id: string): Theme | undefined {
    return this.getAllThemes().find(t => t.id === id)
  }

  getCurrentTheme(): Theme {
    return this.currentTheme
  }

  setTheme(themeId: string) {
    const theme = this.getThemeById(themeId)
    if (theme) {
      this.currentTheme = theme
      this.applyTheme(theme)
      this.saveToConfig()
      this.notifyListeners()
    }
  }

  resolveThemeForMode(mode: 'light' | 'dark' | 'system'): Theme {
    if (mode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const targetType = prefersDark ? 'dark' : 'light'
      const matched = this.getAllThemes().find(t => t.type === targetType)
      return matched || this.currentTheme
    }
    const matched = this.getAllThemes().find(t => t.type === mode)
    return matched || this.currentTheme
  }

  startSystemThemeListener(onSystemChange: (isDark: boolean) => void) {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return
    this.stopSystemThemeListener()

    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    this.mediaQueryHandler = (e: MediaQueryListEvent) => {
      onSystemChange(e.matches)
    }
    this.mediaQuery.addEventListener('change', this.mediaQueryHandler)
  }

  stopSystemThemeListener() {
    if (this.mediaQuery && this.mediaQueryHandler) {
      this.mediaQuery.removeEventListener('change', this.mediaQueryHandler)
      this.mediaQueryHandler = null
    }
    this.mediaQuery = null
  }

  addCustomTheme(theme: Theme) {
    if (this.getThemeById(theme.id)) {
      theme.id = `${theme.id}-${Date.now()}`
    }
    this.customThemes.push(theme)
    this.saveToConfig()
  }

  removeCustomTheme(themeId: string) {
    this.customThemes = this.customThemes.filter(t => t.id !== themeId)
    if (this.currentTheme.id === themeId) {
      this.setTheme(BRAND.defaultTheme)
    }
    this.saveToConfig()
  }

  applyTheme(theme: Theme) {
    const root = document.documentElement
    const colors = theme.colors

    // 设置 CSS 变量 (RGB 格式) - 修复变量名以匹配 Tailwind Config
    root.style.setProperty('--background', colors.background)
    root.style.setProperty('--background-secondary', colors.backgroundSecondary)
    root.style.setProperty('--background-tertiary', colors.backgroundTertiary)
    root.style.setProperty('--chat-bg', colors.chatBg)

    root.style.setProperty('--surface', colors.surface)
    root.style.setProperty('--surface-hover', colors.surfaceHover)
    root.style.setProperty('--surface-active', colors.surfaceActive)
    root.style.setProperty('--surface-muted', colors.surfaceMuted)

    root.style.setProperty('--text-primary', colors.textPrimary)
    root.style.setProperty('--text-secondary', colors.textSecondary)
    root.style.setProperty('--text-muted', colors.textMuted)
    root.style.setProperty('--text-inverted', colors.textInverted)

    root.style.setProperty('--border', colors.border)
    root.style.setProperty('--border-subtle', colors.borderSubtle)
    root.style.setProperty('--border-active', colors.borderActive)

    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-hover', colors.accentHover)
    root.style.setProperty('--accent-active', colors.accentActive)
    root.style.setProperty('--accent-foreground', colors.accentForeground)
    root.style.setProperty('--accent-subtle', colors.accentSubtle)

    root.style.setProperty('--status-success', colors.statusSuccess)
    root.style.setProperty('--status-warning', colors.statusWarning)
    root.style.setProperty('--status-error', colors.statusError)
    root.style.setProperty('--status-info', colors.statusInfo)

    // 设置主题类型
    root.setAttribute('data-theme', theme.type)

    // 更新 color-scheme
    root.style.colorScheme = theme.type

    logger.settings.info('[Theme] Applied theme:', theme.name)
  }

  subscribe(callback: (theme: Theme) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners() {
    this.listeners.forEach(cb => cb(this.currentTheme))
  }

  async init() {
    if (this.initialized) return
    await this.loadFromConfig()
    this.applyTheme(this.currentTheme)
    this.initialized = true
  }
}

export const themeManager = new ThemeManager()

// 导出辅助函数
export { hexToRgb }
