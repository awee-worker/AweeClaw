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
import {
  applyWallpaper,
  DEFAULT_WALLPAPER_TUNING,
  isValidWallpaperConfig,
  normalizeCustomWallpaperTheme,
  normalizeWallpaperConfig,
  type CustomWallpaperTheme,
  type WallpaperConfig,
} from './wallpaper'

/** 颜色 → ColorTheme.id 映射 */
export const THEME_COLOR_MAP: Record<ThemeColor, string> = {
  blue:   'aweeclaw',
  purple: 'purple',
  red:    'lobster-red',
  green:  'forest-green',
  cyan:   'aurora',
  pink:   'sakura',
  gray:   'graphite',
}

/** 颜色选项元数据（用于UI展示） */
export const THEME_COLOR_OPTIONS: {
  value: ThemeColor
  labelZh: string
  labelEn: string
  descZh: string
  descEn: string
}[] = [
  { value: 'blue',   labelZh: '天蓝',     labelEn: 'Blue',     descZh: '清透冷静，适合长时间编码', descEn: 'Crisp and calm for long coding sessions' },
  { value: 'purple', labelZh: '紫罗兰',   labelEn: 'Violet',   descZh: '沉静内敛，夜间阅读友好',   descEn: 'Deep and quiet, easy on the eyes at night' },
  { value: 'red',    labelZh: '暖橙',     labelEn: 'Amber',    descZh: '温暖有活力，适合创作场景', descEn: 'Warm and energetic for creative work' },
  { value: 'green',  labelZh: '翠绿',     labelEn: 'Green',    descZh: '自然柔和，阅读舒适',       descEn: 'Natural and soft for comfortable reading' },
  { value: 'cyan',   labelZh: '极光青',   labelEn: 'Aurora',   descZh: '冷调极光，配深空壁纸',     descEn: 'Cool aurora tones with a deep-sky wallpaper' },
  { value: 'pink',   labelZh: '樱花粉',   labelEn: 'Sakura',   descZh: '柔和粉调，配樱雾壁纸',     descEn: 'Soft pink tones with a blossom-haze wallpaper' },
  { value: 'gray',   labelZh: '石墨灰',   labelEn: 'Graphite', descZh: '中性克制，配网格壁纸',     descEn: 'Neutral and restrained with a grid wallpaper' },
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
  /** 主题自带壁纸（用户未自定义背景时生效） */
  wallpaper?: WallpaperConfig | null
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
  /**
   * 主题自带的推荐壁纸（内置壁纸 id），可为空表示纯色主题。
   * 老的四套配色保持纯色，新增主题才挂壁纸，避免升级后界面突变。
   */
  wallpapers?: { light?: string; dark?: string }
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
  const wallpaperId = colorTheme.wallpapers?.[type]
  return {
    id: `${colorTheme.id}-${type}`,
    name: `${colorTheme.name} ${type === 'light' ? 'Light' : 'Dark'}`,
    type,
    colors: type === 'light' ? colorTheme.lightColors : colorTheme.darkColors,
    monacoTheme: type === 'light' ? colorTheme.monacoTheme.light : colorTheme.monacoTheme.dark,
    colorThemeId: colorTheme.id,
    wallpaper: wallpaperId
      ? normalizeWallpaperConfig({ id: wallpaperId, kind: 'builtin', ...DEFAULT_WALLPAPER_TUNING })
      : null,
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

  // ========== 极光青 (Aurora) ==========
  // 冷调青蓝，暗色下配「极光」壁纸，亮色下配「晨雾」
  {
    id: 'aurora',
    name: 'Aurora',
    color: 'cyan',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    wallpapers: { light: 'dawn-mist', dark: 'aurora' },
    lightColors: {
      background: '246 252 254',          // #f6fcfe
      backgroundSecondary: '236 249 253', // #ecf9fd
      backgroundTertiary: '224 244 250',  // #e0f4fa
      chatBg: '243 251 254',              // #f3fbfe

      surface: '255 255 255',             // #ffffff
      surfaceHover: '237 250 254',        // #edfafe
      surfaceActive: '224 244 251',       // #e0f4fb
      surfaceMuted: '209 235 245',        // #d1ebf5

      textPrimary: '8 34 45',             // #08222d
      textSecondary: '38 72 86',          // #264856
      textMuted: '86 116 130',            // #567482
      textInverted: '255 255 255',        // #ffffff

      border: '200 228 238',              // #c8e4ee
      borderSubtle: '222 241 248',        // #def1f8
      borderActive: '8 145 178',          // #0891b2

      accent: '8 145 178',                // #0891b2  - 青蓝
      accentHover: '14 116 144',          // #0e7490
      accentActive: '21 94 117',          // #155e75
      accentForeground: '255 255 255',    // #ffffff
      accentSubtle: '103 232 249',        // #67e8f9

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235'             // #2563eb
    },
    darkColors: {
      background: '6 20 28',             // #06141c
      backgroundSecondary: '10 30 40',   // #0a1e28
      backgroundTertiary: '14 40 53',    // #0e2835
      chatBg: '8 25 34',                 // #081922

      surface: '10 30 40',               // #0a1e28
      surfaceHover: '18 44 57',          // #122c39
      surfaceActive: '25 58 73',         // #193a49
      surfaceMuted: '38 76 92',          // #264c5c

      textPrimary: '226 246 250',        // #e2f6fa
      textSecondary: '170 210 220',      // #aad2dc
      textMuted: '120 165 178',          // #78a5b2
      textInverted: '6 20 28',           // #06141c

      border: '18 44 57',                // #122c39
      borderSubtle: '14 34 44',          // #0e222c
      borderActive: '34 211 238',        // #22d3ee

      accent: '34 211 238',              // #22d3ee  - 亮青
      accentHover: '8 145 178',          // #0891b2
      accentActive: '14 116 144',        // #0e7490
      accentForeground: '4 20 26',       // #04141a
      accentSubtle: '103 232 249',       // #67e8f9

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '248 113 113',        // #f87171
      statusInfo: '96 165 250'           // #60a5fa
    }
  },

  // ========== 樱花粉 (Sakura) ==========
  // 柔和粉调，亮色配「樱雾」，暗色配「星海」
  {
    id: 'sakura',
    name: 'Sakura',
    color: 'pink',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    wallpapers: { light: 'sakura-haze', dark: 'starfield' },
    lightColors: {
      background: '254 249 251',          // #fef9fb
      backgroundSecondary: '253 242 246', // #fdf2f6
      backgroundTertiary: '251 233 240',  // #fbe9f0
      chatBg: '254 246 249',              // #fef6f9

      surface: '255 255 255',             // #ffffff
      surfaceHover: '253 244 248',        // #fdf4f8
      surfaceActive: '250 235 242',       // #faebf2
      surfaceMuted: '244 220 232',        // #f4dce8

      textPrimary: '48 18 33',            // #301221
      textSecondary: '92 48 68',          // #5c3044
      textMuted: '140 100 118',           // #8c6476
      textInverted: '255 255 255',        // #ffffff

      border: '240 216 227',              // #f0d8e3
      borderSubtle: '248 232 238',        // #f8e8ee
      borderActive: '219 39 119',         // #db2777

      accent: '219 39 119',               // #db2777  - 玫红
      accentHover: '190 24 93',           // #be185d
      accentActive: '157 23 77',          // #9d174d
      accentForeground: '255 255 255',    // #ffffff
      accentSubtle: '249 168 212',        // #f9a8d4

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235'             // #2563eb
    },
    darkColors: {
      background: '26 16 22',            // #1a1016
      backgroundSecondary: '36 22 30',   // #24161e
      backgroundTertiary: '48 30 40',    // #301e28
      chatBg: '30 18 25',                // #1e1219

      surface: '36 22 30',               // #24161e
      surfaceHover: '52 33 43',          // #34212b
      surfaceActive: '66 43 56',         // #422b38
      surfaceMuted: '84 58 72',          // #543a48

      textPrimary: '250 233 240',        // #fae9f0
      textSecondary: '219 186 201',      // #dbbac9
      textMuted: '180 140 158',          // #b48c9e
      textInverted: '26 16 22',          // #1a1016

      border: '52 33 43',                // #34212b
      borderSubtle: '40 25 32',          // #281920
      borderActive: '244 114 182',       // #f472b6

      accent: '244 114 182',             // #f472b6  - 亮樱粉
      accentHover: '236 72 153',         // #ec4899
      accentActive: '219 39 119',        // #db2777
      accentForeground: '40 8 24',       // #280818
      accentSubtle: '251 207 232',       // #fbcfe8

      statusSuccess: '52 211 153',       // #34d399
      statusWarning: '251 191 36',       // #fbbf24
      statusError: '248 113 113',        // #f87171
      statusInfo: '96 165 250'           // #60a5fa
    }
  },

  // ========== 石墨灰 (Graphite) ==========
  // 中性无彩，亮色配「宣纸」，暗色配「夜幕网格」
  {
    id: 'graphite',
    name: 'Graphite',
    color: 'gray',
    monacoTheme: { light: 'vs', dark: 'vs-dark' },
    wallpapers: { light: 'paper-grain', dark: 'midnight-grid' },
    lightColors: {
      background: '247 247 248',          // #f7f7f8
      backgroundSecondary: '241 241 243', // #f1f1f3
      backgroundTertiary: '232 232 235',  // #e8e8eb
      chatBg: '245 245 247',              // #f5f5f7

      surface: '255 255 255',             // #ffffff
      surfaceHover: '242 242 244',        // #f2f2f4
      surfaceActive: '232 232 235',       // #e8e8eb
      surfaceMuted: '219 219 224',        // #dbdbe0

      textPrimary: '24 24 27',            // #18181b
      textSecondary: '63 63 70',          // #3f3f46
      textMuted: '113 113 122',           // #71717a
      textInverted: '255 255 255',        // #ffffff

      border: '212 212 216',              // #d4d4d8
      borderSubtle: '228 228 231',        // #e4e4e7
      borderActive: '82 82 91',           // #52525b

      accent: '63 63 70',                 // #3f3f46  - 石墨深灰
      accentHover: '39 39 42',            // #27272a
      accentActive: '24 24 27',           // #18181b
      accentForeground: '250 250 250',    // #fafafa
      accentSubtle: '161 161 170',        // #a1a1aa

      statusSuccess: '22 163 74',         // #16a34a
      statusWarning: '217 119 6',         // #d97706
      statusError: '220 38 38',           // #dc2626
      statusInfo: '37 99 235'             // #2563eb
    },
    darkColors: {
      background: '14 14 16',            // #0e0e10
      backgroundSecondary: '22 22 25',   // #161619
      backgroundTertiary: '30 30 34',    // #1e1e22
      chatBg: '18 18 21',                // #121215

      surface: '22 22 25',               // #161619
      surfaceHover: '34 34 38',          // #222226
      surfaceActive: '45 45 50',         // #2d2d32
      surfaceMuted: '63 63 69',          // #3f3f45

      textPrimary: '244 244 245',        // #f4f4f5
      textSecondary: '190 190 196',      // #bebec4
      textMuted: '148 148 156',          // #94949c
      textInverted: '14 14 16',          // #0e0e10

      border: '39 39 43',                // #27272b
      borderSubtle: '28 28 31',          // #1c1c1f
      borderActive: '113 113 122',       // #71717a

      accent: '161 161 170',             // #a1a1aa  - 中性浅灰
      accentHover: '212 212 216',        // #d4d4d8
      accentActive: '228 228 231',       // #e4e4e7
      accentForeground: '24 24 27',      // #18181b
      accentSubtle: '113 113 122',       // #71717a

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
/** 用户自定义壁纸的本地快照（启动时先行应用，避免壁纸闪一下才出来） */
const LOCAL_STORAGE_WALLPAPER_KEY = `${BRAND.cssPrefix}-wallpaper`
/** 用户自定义壁纸在配置文件中的 key */
const CONFIG_KEY_WALLPAPER = 'wallpaper'
/** 自定义壁纸主题列表的本地快照 */
const LOCAL_STORAGE_CUSTOM_WALLPAPER_THEMES_KEY = `${BRAND.cssPrefix}-custom-wallpaper-themes`
/** 自定义壁纸主题列表在配置文件中的 key */
const CONFIG_KEY_CUSTOM_WALLPAPER_THEMES = 'customWallpaperThemes'

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
  /** 应用级系统主题监听：与设置面板的监听互相独立，面板关闭不得影响它 */
  private appMediaQuery: MediaQueryList | null = null
  private appMediaQueryHandler: ((e: MediaQueryListEvent) => void) | null = null
  /** 用户自定义壁纸；为 null 时回落到主题自带壁纸 */
  private userWallpaper: WallpaperConfig | null = null
  /** 用户保存的自定义壁纸主题（含壁纸参数与配色设置） */
  private customWallpaperThemes: CustomWallpaperTheme[] = []

  constructor() {
    // 从 StorageService 快速恢复主题（同步，避免闪烁）
    try {
      const savedThemeId = StorageService.get<string>(LOCAL_STORAGE_THEME_KEY)
      const savedCustomThemes = StorageService.get<Theme[]>(LOCAL_STORAGE_CUSTOM_THEMES_KEY)
      const savedWallpaper = StorageService.get<WallpaperConfig>(LOCAL_STORAGE_WALLPAPER_KEY)
      const savedWallpaperThemes = StorageService.get<CustomWallpaperTheme[]>(
        LOCAL_STORAGE_CUSTOM_WALLPAPER_THEMES_KEY
      )

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        this.customThemes = savedCustomThemes.filter(isValidTheme)
      }

      if (savedWallpaperThemes && Array.isArray(savedWallpaperThemes)) {
        this.customWallpaperThemes = savedWallpaperThemes
          .map(normalizeCustomWallpaperTheme)
          .filter((t): t is CustomWallpaperTheme => t !== null)
      }

      if (isValidWallpaperConfig(savedWallpaper)) {
        this.userWallpaper = normalizeWallpaperConfig(savedWallpaper)
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
      const [savedThemeId, savedCustomThemes, savedWallpaper, savedWallpaperThemes] = await Promise.all([
        api.settings.get('themeId'),
        api.settings.get('customThemes'),
        api.settings.get(CONFIG_KEY_WALLPAPER),
        api.settings.get(CONFIG_KEY_CUSTOM_WALLPAPER_THEMES),
      ])

      if (savedCustomThemes && Array.isArray(savedCustomThemes)) {
        const validThemes = savedCustomThemes.filter(isValidTheme)
        this.customThemes = validThemes
        StorageService.set(LOCAL_STORAGE_CUSTOM_THEMES_KEY, validThemes)
      }

      if (Array.isArray(savedWallpaperThemes)) {
        const validWallpaperThemes = savedWallpaperThemes
          .map(normalizeCustomWallpaperTheme)
          .filter((t): t is CustomWallpaperTheme => t !== null)
        this.customWallpaperThemes = validWallpaperThemes
        StorageService.set(LOCAL_STORAGE_CUSTOM_WALLPAPER_THEMES_KEY, validWallpaperThemes)
      }

      if (isValidWallpaperConfig(savedWallpaper)) {
        this.userWallpaper = normalizeWallpaperConfig(savedWallpaper)
        StorageService.set(LOCAL_STORAGE_WALLPAPER_KEY, this.userWallpaper)
      } else if (savedWallpaper === null) {
        // 用户主动清除过壁纸，保持 null
        this.userWallpaper = null
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

  /**
   * 设置面板用的系统主题监听（同一时刻只保留一个）。
   *
   * ⚠️ 必须与应用级监听分开存放：设置面板卸载时会调用 stopSystemThemeListener()，
   *    若与应用级共用同一个槽位，面板一关就会把全局的「跟随系统」监听一并摘掉，
   *    此后系统外观变化不再触发任何主题切换。
   */
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
    }
    this.mediaQueryHandler = null
    this.mediaQuery = null
  }

  /** 注册应用级系统主题监听（生命周期与应用一致，不受设置面板挂载/卸载影响） */
  startAppSystemThemeListener(onSystemChange: (isDark: boolean) => void) {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return
    this.stopAppSystemThemeListener()

    this.appMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    this.appMediaQueryHandler = (e: MediaQueryListEvent) => {
      onSystemChange(e.matches)
    }
    this.appMediaQuery.addEventListener('change', this.appMediaQueryHandler)
  }

  stopAppSystemThemeListener() {
    if (this.appMediaQuery && this.appMediaQueryHandler) {
      this.appMediaQuery.removeEventListener('change', this.appMediaQueryHandler)
    }
    this.appMediaQueryHandler = null
    this.appMediaQuery = null
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

    // 输入框：亮色主题用纯白底 + 主题浅灰描边（亮色的 surface-active 灰调偏重，容易被误读成禁用态）；
    // 暗色主题抬高底色，并改用中性描边——各暗色主题的 border 与 surface-active 同色或近色，描不出轮廓
    root.style.setProperty('--input-bg', theme.type === 'light' ? '255 255 255' : colors.surfaceActive)
    root.style.setProperty('--input-border', theme.type === 'light' ? colors.border : '82 82 91')

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

    // 壁纸：用户自定义优先，否则用主题自带
    applyWallpaper(this.userWallpaper ?? theme.wallpaper ?? null)

    logger.settings.info('[Theme] Applied theme:', theme.name)
  }

  /** 取当前生效的壁纸配置（用户自定义优先） */
  getActiveWallpaper(): WallpaperConfig | null {
    return this.userWallpaper ?? this.currentTheme.wallpaper ?? null
  }

  /** 取用户自定义壁纸（不含主题自带） */
  getUserWallpaper(): WallpaperConfig | null {
    return this.userWallpaper
  }

  /**
   * 仅预览壁纸效果，不写任何配置。
   * 设置面板拖动滑块时高频调用，落盘由调用方节流。
   */
  previewWallpaper(config: WallpaperConfig | null): void {
    applyWallpaper(config ?? this.currentTheme.wallpaper ?? null)
  }

  /**
   * 应用其他窗口广播过来的壁纸配置。
   *
   * 与 setUserWallpaper 的区别：这里不回写配置文件，否则会触发
   * settings:set → settings:changed 广播 → 本方法再次执行的循环。
   */
  syncWallpaperFromExternal(config: WallpaperConfig | null): void {
    this.userWallpaper = config ? normalizeWallpaperConfig(config) : null
    applyWallpaper(this.getActiveWallpaper())
    try {
      StorageService.set(LOCAL_STORAGE_WALLPAPER_KEY, this.userWallpaper)
    } catch (e) {
      // 忽略本地快照写入失败
    }
  }

  /**
   * 设置用户自定义壁纸；传 null 表示恢复为主题自带壁纸。
   * 立即应用并持久化，不需要重建主题。
   */
  setUserWallpaper(config: WallpaperConfig | null): void {
    this.userWallpaper = config ? normalizeWallpaperConfig(config) : null
    applyWallpaper(this.getActiveWallpaper())

    try {
      StorageService.set(LOCAL_STORAGE_WALLPAPER_KEY, this.userWallpaper)
    } catch (e) {
      // 忽略本地快照写入失败
    }
    try {
      api.settings.set(CONFIG_KEY_WALLPAPER, this.userWallpaper)
    } catch (e) {
      logger.settings.error('Failed to save wallpaper to config:', e)
    }
  }

  // ============================================
  // 自定义壁纸主题
  // ============================================

  /** 取全部自定义壁纸主题（按保存时间新→旧） */
  getCustomWallpaperThemes(): CustomWallpaperTheme[] {
    return [...this.customWallpaperThemes]
  }

  /** 按 id 取自定义壁纸主题 */
  getCustomWallpaperTheme(themeId: string): CustomWallpaperTheme | undefined {
    return this.customWallpaperThemes.find(t => t.id === themeId)
  }

  /**
   * 保存自定义壁纸主题：传 id 视为更新，不传视为新增。
   * 返回落盘后的主题对象；名称为空时拒绝保存并返回 null。
   */
  saveCustomWallpaperTheme(input: {
    id?: string
    name: string
    wallpaper: WallpaperConfig
    themeMode: CustomWallpaperTheme['themeMode']
    colorThemeId: string
  }): CustomWallpaperTheme | null {
    const name = input.name.trim()
    if (!name) return null

    const now = Date.now()
    const existing = input.id ? this.customWallpaperThemes.find(t => t.id === input.id) : undefined

    const saved: CustomWallpaperTheme = {
      id: existing ? existing.id : `wp-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      wallpaper: normalizeWallpaperConfig(input.wallpaper),
      themeMode: input.themeMode,
      colorThemeId: input.colorThemeId,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    }

    if (existing) {
      this.customWallpaperThemes = this.customWallpaperThemes.map(t =>
        t.id === saved.id ? saved : t
      )
    } else {
      this.customWallpaperThemes = [saved, ...this.customWallpaperThemes]
    }

    this.persistCustomWallpaperThemes()
    return saved
  }

  /** 删除自定义壁纸主题；正在使用的壁纸本身保持不变 */
  removeCustomWallpaperTheme(themeId: string): void {
    const next = this.customWallpaperThemes.filter(t => t.id !== themeId)
    if (next.length === this.customWallpaperThemes.length) return
    this.customWallpaperThemes = next
    this.persistCustomWallpaperThemes()
  }

  /**
   * 应用其他窗口广播过来的自定义壁纸主题列表。
   * 与 saveCustomWallpaperTheme 的区别同 syncWallpaperFromExternal：不回写配置，避免广播循环。
   */
  syncCustomWallpaperThemesFromExternal(themes: unknown): void {
    if (!Array.isArray(themes)) return
    this.customWallpaperThemes = themes
      .map(normalizeCustomWallpaperTheme)
      .filter((t): t is CustomWallpaperTheme => t !== null)
    try {
      StorageService.set(LOCAL_STORAGE_CUSTOM_WALLPAPER_THEMES_KEY, this.customWallpaperThemes)
    } catch (e) {
      // 忽略本地快照写入失败
    }
  }

  private persistCustomWallpaperThemes() {
    try {
      StorageService.set(LOCAL_STORAGE_CUSTOM_WALLPAPER_THEMES_KEY, this.customWallpaperThemes)
    } catch (e) {
      // 忽略存储错误
    }
    try {
      api.settings.set(CONFIG_KEY_CUSTOM_WALLPAPER_THEMES, this.customWallpaperThemes)
    } catch (e) {
      logger.settings.error('Failed to save custom wallpaper themes:', e)
    }
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
