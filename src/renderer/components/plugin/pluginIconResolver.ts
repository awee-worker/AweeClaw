/**
 * pluginIconResolver — 插件/技能图标解析工具
 *
 * 插件 manifest.icon 支持三种来源：
 * 1. 图片 URL（http:// / https:// / data:）—— 渲染 <img>
 * 2. Lucide 图标名（如 "Clock"、"Braces"）—— 渲染对应 Lucide 图标
 * 3. 空值 —— 由调用方按分类/默认回退
 *
 * 通过 `import * as LucideIcons` 按名称动态解析，可覆盖任意 lucide 图标名，
 * 避免手动维护映射表导致新图标漏配（表现为图标回退成默认图标）。
 */
import * as LucideIcons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** 判断字符串是否为图片 URL 或 data URL */
export function isImageIcon(value: string | null | undefined): value is string {
  return (
    !!value &&
    (value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('data:'))
  )
}

/**
 * 按 lucide 图标名解析图标组件
 * @param name 图标名（如 "Clock"、"Braces"、"Code2"）
 * @returns 图标组件；未知名返回 null（调用方回退）
 */
export function resolveLucideIcon(name?: string | null): LucideIcon | null {
  if (!name) return null
  const icons = LucideIcons as Record<string, LucideIcon>
  return icons[name] || null
}
