/**
 * 主题颜色解析
 *
 * 渲染进程与主进程之间通过 RGB 字符串（如 "245 252 255"）传递颜色，
 * 此模块负责：
 * 1. 解析 Store 中存储的主题背景色，回退到主题 ID 字典
 * 2. 规范化任意颜色字符串为 "R G B" 格式
 * 3. 在窗口销毁时从 Store 推导关闭界面所需配色（fallback）
 */
import { BRAND } from '@shared/brand'
import { getConfigStore } from './stores'
import type { ShutdownWindowPresentation } from '../modules/lifecycle/GracefulShutdownController'

/** 默认背景色（浅色主题） */
export const DEFAULT_BG_COLOR = '#f5faff'

/** 旧版本主题 ID → 背景色映射，用于老配置兼容 */
const LEGACY_THEME_BG_MAP: Record<string, string> = {
  'aweeclaw-light': '#f5faff',
  'purple-light': '#f8f5ff',
  'lobster-red-light': '#fffcf9',
  'forest-green-light': '#f5fcfc',
  'aweeclaw-dark': '#161b22',
  'purple-dark': '#121215',
  'lobster-red-dark': '#140e0c',
  'forest-green-dark': '#0e1614',
}

/** 获取窗口背景色（BrowserWindow.backgroundColor） */
export function getThemeBackgroundColor(): string {
  try {
    const store = getConfigStore()
    const themeBg = store.get('themeBg') as string | undefined

    if (themeBg) {
      // 兼容 "18 18 21" 这种 RGB 空格分隔格式，转换为 #hex
      if (themeBg.includes(' ')) {
        const [r, g, b] = themeBg.split(' ').map(Number)
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          const toHex = (n: number) => n.toString(16).padStart(2, '0')
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`
        }
      }
      return themeBg
    }

    const themeId = (store.get('themeId') as string) || BRAND.defaultTheme
    return LEGACY_THEME_BG_MAP[themeId] || DEFAULT_BG_COLOR
  } catch {
    return DEFAULT_BG_COLOR
  }
}

/**
 * 将任意颜色值规范化为 "R G B" 字符串。
 * 支持 "R G B" 和 "#RRGGBB" 两种输入格式，无法识别时返回 fallback。
 */
export function normalizeRgbColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const normalized = value.trim().replace(/\s+/g, ' ')
  if (/^\d{1,3}( \d{1,3}){2}$/.test(normalized)) {
    return normalized
  }

  if (/^#?[0-9a-fA-F]{6}$/.test(normalized)) {
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ].join(' ')
  }

  return fallback
}

/**
 * 在无法从渲染进程读取实时配色时，基于 Store 中的主题配置推导关闭界面配色。
 * 用于窗口已销毁或 executeJavaScript 失败的兜底场景。
 */
export function getShutdownFallbackPresentation(): ShutdownWindowPresentation {
  const store = getConfigStore()
  const themeBg = normalizeRgbColor(store.get('themeBg'), '245 252 255')
  const themeId = (store.get('themeId') as string) || ''
  const themeType: 'light' | 'dark' = themeId.endsWith('-light') ? 'light' : 'dark'

  return {
    language: store.get('language') === 'en' ? 'en' : 'zh',
    themeType,
    background: themeBg,
    surface: themeType === 'light' ? '248 249 250' : '25 25 29',
    border: themeType === 'light' ? '222 226 230' : '40 40 48',
    text: themeType === 'light' ? '33 37 41' : '242 242 247',
    muted: themeType === 'light' ? '134 142 150' : '161 161 180',
    accent: themeType === 'light' ? '37 99 235' : '139 92 246',
    success: themeType === 'light' ? '22 163 74' : '52 211 153',
    warning: themeType === 'light' ? '217 119 6' : '251 191 36',
  }
}
