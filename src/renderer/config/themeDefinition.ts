/**
 * 主题系统配置
 * 支持内置主题和自定义主题
 * 使用 RGB 格式以支持 Tailwind 透明度修饰符
 *
 * 架构说明：
 *   - ColorTheme：颜色主题，一个颜色包含 lightColors 和 darkColors 两套配色
 *   - Theme：运行时主题，由 ColorTheme + type 派生（向后兼容）
 *   - 用户选择颜色后，切换模式时自动应用对应配色的亮/暗色版本
 */

import { api } from '../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { BRAND } from '@shared/brand'
import type { ThemeColor } from '@/renderer/state/slices/themeSlice'

/** 颜色 → ColorTheme.id 映射 */
export const THEME_COLOR_MAP: Record<ThemeColor, string> = {
  blue:   'aweeclaw',
  purple: 'purple',
  red:    'lobster-red',
  green:  'forest-green',
}

/** 颜色选项元数据（用于UI展示） */
export const THEME_COLOR_OPTIONS: { value: ThemeColor; labelZh: string; labelEn: string }[] = [
  { value: 'blue',   labelZh: '天蓝', labelEn: 'Blue' },
  { value: 'purple', labelZh: '紫色', labelEn: 'Purple' },
  { value: 'red',    labelZh: '暖橙', labelEn: 'Red' },
  { value: 'green',  labelZh: '翠绿', labelEn: 'Green' },
]

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
  /** 关联的颜色主题ID（运行时主题由 ColorTheme + type 派生） */
  colorThemeId?: string
}

/**
 * 颜色主题：一个颜色包含亮色和暗色两套配色
 * 用户选择颜色后，切换模式时自动应用对应配色的亮/暗色版本
 */
export interface ColorTheme {
  /** 颜色主题ID（如 'aweeclaw', 'purple'） */
  id: string
  /** 颜色名称（如 'AweeClaw', 'Purple'） */
  name: string
  /** 对应的 ThemeColor 枚举值 */
  color: ThemeColor
  /** Monaco 编辑器主题 */
  monacoTheme: { light: string; dark: string }
  /** 亮色配色 */
  lightColors: ThemeColors
  /** 暗色配色 */
  darkColors: ThemeColors
}

// 辅助函数：将 HEX 转换为 RGB 格式 "r g b"
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0 0'
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`
}

/**
 * 从 ColorTheme 派生运行时 Theme
 * @param colorTheme 颜色主题
 * @param type 亮色/暗色
 */
function deriveTheme(colorTheme: ColorTheme, type: 'light' | 'dark'): Theme {
  return {
    id: `${colorTheme.id}-${type}`,
    name: `${colorTheme.name} ${type === 'light' ? 'Light' : 'Dark'}`,
    type,
    colors: type === 'light' ? colorTheme.lightColors : colorTheme.darkColors,
    monacoTheme: type === 'light' ? colorTheme.monacoTheme.light : colorTheme.monacoTheme.dark,
    colorThemeId: colorTheme.id,
  }
}

// 内置颜色主题 (使用 RGB 格式)
// 设计原则:
//   - 暗色主题: 深蓝灰基调而非纯黑，层间有6-8点亮度差，文字高对比度
//   - 亮色主题: 暖白基调，层间清晰可辨，代码块与聊天背景区分明显
//   - 配色: Accent 使用饱和度适中的色相，status 色明确直观
// 每个颜色主题包含 lightColors 和 darkColors 两套配色
export const builtinColorThemes: ColorTheme[] = [
  // ========== 天蓝色 (AweeClaw) ==========
  {
    id: 'aweeclaw',
    name: 'AweeClaw',
    color: 'blue',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    lightColors: {
      background: '248 250 252',          // #f8fafc  - 冷白基调
      backgroundSecondary: '241 245 249', // #f1f5f9
      backgroundTertiary: '233 238 245',  // #e9eef5
      chatBg: '244 247 250',              // #f4f7fa  - 聊天区微暖

      surface: '255 255 255',             // #ffffff  - 纯白卡片
      surfaceHover: '241 245 250',        // #f1f5fa
      surfaceActive: '230 237 247',       // #e6edf7
      surfaceMuted: '218 228 240',        // #dae4f0

      textPrimary: '15 23 42',            // #0f172a  - 深色文字高对比
      textSecondary: '51 65 85',          // #334155
      textMuted: '100 116 139',           // #64748b
      textInverted: '255 255 255',        // #ffffff

      border: '203 213 225',              // #cbd5e1
      borderSubtle: '226 232 240',        // #e2e8f0
      borderActive: '14 165 233',         // #0ea5e9

      accent: '14 165 233',               // #0ea5e9  - 天蓝色
      accentHover: '2 132 199',           // #0284c7
      accentActive: '3 105 161',          // #0369a1
      accentForeground: '255 255 255',    // #ffffff
      accentSubtle: '125 211 252',        // #7dd3fc

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235',            // #2563eb
    },
    darkColors: {
      background: '15 23 42',            // #0f172a  - 深蓝灰底（非纯黑）
      backgroundSecondary: '22 33 55',   // #162137
      backgroundTertiary: '30 42 66',    // #1e2a42
      chatBg: '18 28 48',                // #121c30  - 聊天区微亮

      surface: '22 33 55',               // #162137
      surfaceHover: '35 50 78',          // #23324e
      surfaceActive: '45 62 92',         // #2d3e5c
      surfaceMuted: '58 76 110',         // #3a4c6e

      textPrimary: '232 238 246',        // #e8eef6  - 高亮白
      textSecondary: '176 188 204',      // #b0bccc
      textMuted: '136 152 176',          // #8898b0
      textInverted: '15 23 42',          // #0f172a

      border: '45 62 92',                // #2d3e5c
      borderSubtle: '30 42 66',          // #1e2a42
      borderActive: '56 189 248',        // #38bdf8

      accent: '56 189 248',              // #38bdf8  - 亮天蓝
      accentHover: '14 165 233',         // #0ea5e9
      accentActive: '2 132 199',         // #0284c7
      accentForeground: '8 15 28',       // #080f1c
      accentSubtle: '125 211 252',       // #7dd3fc

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '248 113 113',        // #f87171
      statusInfo: '96 165 250'           // #60a5fa
    }
  },

  // ========== 紫色 (Purple) ==========
  {
    id: 'purple',
    name: 'Purple',
    color: 'purple',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    lightColors: {
      background: '250 248 254',           // #faf8fe
      backgroundSecondary: '243 240 251', // #f3f0fb
      backgroundTertiary: '235 230 248',  // #ebe6f8
      chatBg: '247 245 252',              // #f7f5fc

      surface: '255 255 255',             // #ffffff
      surfaceHover: '243 240 252',        // #f3f0fc
      surfaceActive: '233 228 248',       // #e9e4f8
      surfaceMuted: '221 214 242',        // #ddd6f2

      textPrimary: '25 14 55',            // #190e37
      textSecondary: '64 42 100',         // #402a64
      textMuted: '110 82 150',             // #6e5296
      textInverted: '255 255 255',        // #ffffff

      border: '215 206 238',               // #d7ceee
      borderSubtle: '233 227 246',        // #e9e3f6
      borderActive: '139 92 246',         // #8b5cf6

      accent: '139 92 246',                // #8b5cf6
      accentHover: '124 58 237',          // #7c3aed
      accentActive: '109 40 217',          // #6d28d9
      accentForeground: '255 255 255',     // #ffffff
      accentSubtle: '196 181 253',        // #c4b5fd

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '124 58 237'             // #7c3aed
    },
    darkColors: {
      background: '18 15 32',            // #120f20  - 深紫底
      backgroundSecondary: '26 22 45',   // #1a162d
      backgroundTertiary: '34 29 56',    // #221d38
      chatBg: '20 17 38',                // #141126

      surface: '26 22 45',               // #1a162d
      surfaceHover: '38 33 60',          // #26213c
      surfaceActive: '48 42 73',         // #302a49
      surfaceMuted: '60 54 88',          // #3c3658

      textPrimary: '240 238 248',        // #f0eef8  - 微紫白
      textSecondary: '190 182 216',      // #beb6d8
      textMuted: '148 138 182',          // #948ab6
      textInverted: '18 15 32',          // #120f20

      border: '38 33 60',                // #26213c
      borderSubtle: '30 25 50',          // #1e1932
      borderActive: '167 139 250',       // #a78bfa

      accent: '167 139 250',             // #a78bfa  - 亮紫
      accentHover: '139 92 246',         // #8b5cf6
      accentActive: '124 58 237',        // #7c3aed
      accentForeground: '255 255 255',   // #ffffff
      accentSubtle: '196 181 253',       // #c4b5fd

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '248 113 113',        // #f87171
      statusInfo: '129 140 248'          // #818cf8
    }
  },

  // ========== 暖橙色 (Lobster Red) ==========
  {
    id: 'lobster-red',
    name: 'Lobster Red',
    color: 'red',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    lightColors: {
      background: '255 252 250',          // #fffcfa
      backgroundSecondary: '252 247 243', // #fcf7f3
      backgroundTertiary: '246 238 232',  // #f6eee8
      chatBg: '253 250 246',              // #fdfaf6

      surface: '255 255 255',             // #ffffff
      surfaceHover: '250 244 238',        // #faf4ee
      surfaceActive: '243 234 226',       // #f3eae2
      surfaceMuted: '234 222 212',        // #eaded4

      textPrimary: '40 22 14',            // #28160e
      textSecondary: '92 60 42',          // #5c3c2a
      textMuted: '140 98 76',             // #8c624c
      textInverted: '255 255 255',        // #ffffff

      border: '232 220 208',              // #e8dcd0
      borderSubtle: '244 236 227',        // #f4ece3
      borderActive: '234 88 12',          // #ea580c

      accent: '234 88 12',                // #ea580c  - 暖橙色
      accentHover: '194 65 12',           // #c2410c
      accentActive: '154 52 18',          // #9a3412
      accentForeground: '255 255 255',    // #ffffff
      accentSubtle: '253 186 116',        // #fdba74

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235'             // #2563eb
    },
    darkColors: {
      background: '26 14 10',            // #1a0e0a  - 深棕底
      backgroundSecondary: '36 20 15',   // #24140f
      backgroundTertiary: '48 28 22',    // #301c16
      chatBg: '30 17 13',                // #1e110d

      surface: '36 20 15',               // #24140f
      surfaceHover: '52 33 26',          // #34211a
      surfaceActive: '66 44 35',         // #422c23
      surfaceMuted: '82 58 47',          // #523a2f

      textPrimary: '248 237 232',        // #f8ede8  - 暖白
      textSecondary: '212 180 172',      // #d4b4ac
      textMuted: '176 128 116',          // #b08074
      textInverted: '26 14 10',          // #1a0e0a

      border: '52 33 26',                // #34211a
      borderSubtle: '40 24 19',          // #281813
      borderActive: '251 113 86',        // #fb7156

      accent: '251 113 86',              // #fb7156  - 暖珊瑚
      accentHover: '240 90 58',          // #f05a3a
      accentActive: '220 65 38',         // #dc4126
      accentForeground: '255 255 255',   // #ffffff
      accentSubtle: '253 166 134',       // #fda686

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '252 85 72',          // #fc5548
      statusInfo: '96 165 250'           // #60a5fa
    }
  },

  // ========== 翠绿色 (Forest Green) ==========
  {
    id: 'forest-green',
    name: 'Forest Green',
    color: 'green',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    lightColors: {
      background: '246 252 248',          // #f6fcf8
      backgroundSecondary: '236 247 240', // #ecf7f0
      backgroundTertiary: '224 238 230',  // #e0eee6
      chatBg: '249 253 250',              // #f9fdfa

      surface: '255 255 255',             // #ffffff
      surfaceHover: '237 248 242',        // #edf8f2
      surfaceActive: '224 240 231',       // #e0f0e7
      surfaceMuted: '210 230 218',        // #d2e6da

      textPrimary: '15 42 30',            // #0f2a1e
      textSecondary: '44 80 58',          // #2c503a
      textMuted: '82 122 94',             // #527a5e
      textInverted: '255 255 255',        // #ffffff

      border: '204 222 210',              // #ccded2
      borderSubtle: '224 236 227',        // #e0ece3
      borderActive: '5 150 105',          // #059669

      accent: '5 150 105',                // #059669  - 翠绿色
      accentHover: '4 120 87',            // #047857
      accentActive: '6 95 70',            // #065f46
      accentForeground: '255 255 255',    // #ffffff
      accentSubtle: '110 231 183',        // #6ee7b7

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235'             // #2563eb
    },
    darkColors: {
      background: '10 21 16',            // #0a1510  - 深绿底
      backgroundSecondary: '15 30 22',   // #0f1e16
      backgroundTertiary: '21 42 30',    // #152a1e
      chatBg: '13 25 19',                // #0d1913

      surface: '15 30 22',               // #0f1e16
      surfaceHover: '27 46 36',          // #1b2e24
      surfaceActive: '37 60 46',         // #253c2e
      surfaceMuted: '50 78 60',          // #324e3c

      textPrimary: '232 245 236',        // #e8f5ec  - 微绿白
      textSecondary: '184 212 194',      // #b8d4c2
      textMuted: '138 176 152',          // #8ab098
      textInverted: '10 21 16',          // #0a1510

      border: '27 46 36',                // #1b2e24
      borderSubtle: '20 34 26',          // #14221a
      borderActive: '16 185 129',        // #10b981

      accent: '16 185 129',              // #10b981  - 亮翠绿
      accentHover: '5 150 105',          // #059669
      accentActive: '4 120 87',          // #047857
      accentForeground: '5 18 10',       // #05120a
      accentSubtle: '110 231 183',       // #6ee7b7

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '248 113 113',        // #f87171
      statusInfo: '96 165 250'           // #60a5fa
    }
  },
]

/**
 * 内置主题（从 builtinColorThemes 派生，向后兼容）
 * 展开4个 ColorTheme 为8个 Theme（4亮+4暗）
 */
export const builtinThemes: Theme[] = builtinColorThemes.flatMap(ct => [
  deriveTheme(ct, 'light'),
  deriveTheme(ct, 'dark'),
])

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
    // 从 StorageService 快速恢复主题（同步，避免闪烁）
    try {
      const savedThemeId = StorageService.get<string>(LOCAL_STORAGE_THEME_KEY)
      const savedCustomThemes = StorageService.get<Theme[]>(LOCAL_STORAGE_CUSTOM_THEMES_KEY)

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        this.customThemes = savedCustomThemes.filter(isValidTheme)
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
      // 忽略存储错误
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
        StorageService.set(LOCAL_STORAGE_CUSTOM_THEMES_KEY, validThemes)
      }

      if (savedThemeId && typeof savedThemeId === 'string') {
        const theme = this.getThemeById(savedThemeId)
        if (theme) {
          this.currentTheme = theme
          StorageService.set(LOCAL_STORAGE_THEME_KEY, savedThemeId)
          StorageService.set(BRAND.storageKeys.themeBg, theme.colors.background)
          StorageService.set(BRAND.storageKeys.themeType, theme.type)
          // Migrate old configs so main.ts can access themeBg on next startup
          try { api.settings.set('themeBg', theme.colors.background) } catch (e) { logger.ui.warn('Failed to sync themeBg to settings:', e) }
        }
      }
    } catch (e) {
      logger.settings.error('Failed to load theme from config:', e)
    }
  }

  private saveToConfig() {
    // 同步写入 StorageService
    try {
      StorageService.set(LOCAL_STORAGE_THEME_KEY, this.currentTheme.id)
      StorageService.set(BRAND.storageKeys.themeBg, this.currentTheme.colors.background)
      StorageService.set(BRAND.storageKeys.themeType, this.currentTheme.type)
      StorageService.set(LOCAL_STORAGE_CUSTOM_THEMES_KEY, this.customThemes)
    } catch (e) {
      // 忽略存储错误
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

  /** 获取所有颜色主题 */
  getAllColorThemes(): ColorTheme[] {
    return builtinColorThemes
  }

  /** 根据 ID 获取颜色主题 */
  getColorThemeById(id: string): ColorTheme | undefined {
    return builtinColorThemes.find(ct => ct.id === id)
  }

  /** 根据颜色获取颜色主题 */
  getColorThemeByColor(color: ThemeColor): ColorTheme | undefined {
    return builtinColorThemes.find(ct => ct.color === color)
  }

  getAllThemes(): Theme[] {
    return [...builtinThemes, ...this.customThemes]
  }

  getThemeById(id: string): Theme | undefined {
    // 1. 先从派生的 builtinThemes + customThemes 中查找
    const matched = this.getAllThemes().find(t => t.id === id)
    if (matched) return matched

    // 2. 兼容旧格式：尝试解析 'colorThemeId-type' 格式
    const lastDash = id.lastIndexOf('-')
    if (lastDash > 0) {
      const typeSuffix = id.substring(lastDash + 1)
      if (typeSuffix === 'light' || typeSuffix === 'dark') {
        const colorThemeId = id.substring(0, lastDash)
        const colorTheme = this.getColorThemeById(colorThemeId)
        if (colorTheme) {
          return deriveTheme(colorTheme, typeSuffix)
        }
      }
    }

    return undefined
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

  /**
   * 根据模式 + 颜色解析主题
   * 亮色和暗色均支持 4 种颜色：blue / purple / red / green
   * 直接从 ColorTheme 取对应配色的亮/暗色版本
   */
  resolveThemeByModeAndColor(mode: 'light' | 'dark' | 'system', color: ThemeColor): Theme {
    const targetType: 'light' | 'dark' = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode

    const colorTheme = this.getColorThemeByColor(color)
    if (colorTheme) {
      return deriveTheme(colorTheme, targetType)
    }

    // 回退：按模式解析
    return this.resolveThemeForMode(mode)
  }

  /**
   * 从主题 ID 反推颜色
   */
  resolveColorFromThemeId(themeId: string): ThemeColor {
    // 解析 'colorThemeId-type' 格式
    const lastDash = themeId.lastIndexOf('-')
    if (lastDash > 0) {
      const colorThemeId = themeId.substring(0, lastDash)
      const colorTheme = this.getColorThemeById(colorThemeId)
      if (colorTheme) return colorTheme.color
    }

    // 兼容旧格式：遍历 THEME_COLOR_MAP
    for (const [color, ctId] of Object.entries(THEME_COLOR_MAP) as [ThemeColor, string][]) {
      if (themeId.startsWith(ctId)) return color
    }
    return 'blue'
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
    // 编辑器背景：亮色主题使用纯白，暗色主题使用主题背景色
    root.style.setProperty('--editor-bg', theme.type === 'light' ? '255 255 255' : colors.background)

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
