/**
 * PluginIcon — 插件图标渲染组件
 *
 * 支持三种图标来源（按优先级判断）：
 * 1. 图片 URL（http:// / https:// 开头）—— 渲染 <img>
 * 2. Data URL（data: 开头）—— 渲染 <img>（base64 内嵌图片）
 * 3. Lucide 图标名（如 "Cloud"）—— 渲染对应 Lucide 图标
 * 4. 兜底：Package 图标
 *
 * 外层包裹圆角边框，尺寸通过 props 控制。
 */
import {
  Package,
  Cloud,
  Code2,
  Zap,
  Cpu,
  BarChart3,
  PenTool,
  Sparkles,
  TrendingUp,
  BookOpen,
  Heart,
  Layers,
  Search,
  MessageSquare,
  Shield,
  type LucideIcon,
} from 'lucide-react'

/** 内置 Lucide 图标映射（按分类 ID / 图标名） */
const ICON_MAP: Record<string, LucideIcon> = {
  // 分类图标
  productivity: Zap,
  development: Code2,
  automation: Cpu,
  data: BarChart3,
  creative: PenTool,
  ai: Sparkles,
  business: TrendingUp,
  education: BookOpen,
  lifestyle: Heart,
  composite: Layers,
  cloud: Cloud,
  search: Search,
  communication: MessageSquare,
  security: Shield,
  general: Package,
  // 常见图标名
  Package,
  Cloud,
  Code2,
  Zap,
}

/** 判断字符串是否为图片 URL 或 data URL */
function isImageUrl(icon: string): boolean {
  return (
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('data:')
  )
}

export interface PluginIconProps {
  /** icon 字段值：图片URL / data URL / lucide 图标名 / null */
  icon: string | null | undefined
  /** 分类 ID（icon 为空时按分类回退） */
  category?: string | null | undefined
  /** 尺寸（像素），默认 40 */
  size?: number
  /** 是否启用圆角边框（默认 true） */
  bordered?: boolean
  /** 自定义类名 */
  className?: string
}

export function PluginIcon({
  icon,
  category,
  size = 40,
  bordered = true,
  className = '',
}: PluginIconProps) {
  const px = `${size}px`
  const iconSize = Math.round(size * 0.5)

  // 1. 图片 URL / data URL
  if (icon && isImageUrl(icon)) {
    return (
      <div
        className={`shrink-0 flex items-center justify-center overflow-hidden bg-bg-hover ${
          bordered ? 'border border-border/40' : ''
        } rounded-xl ${className}`}
        style={{ width: px, height: px }}
      >
        <img
          src={icon}
          alt="plugin icon"
          className="w-full h-full object-cover"
          draggable={false}
          onError={(e) => {
            // 图片加载失败：隐藏 img，让兜底图标显示
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>
    )
  }

  // 2. Lucide 图标名 / 分类回退
  const IconComp = (icon && ICON_MAP[icon]) || (category && ICON_MAP[category]) || Package

  return (
    <div
      className={`shrink-0 flex items-center justify-center bg-accent/10 ${
        bordered ? 'border border-border/40' : ''
      } rounded-xl ${className}`}
      style={{ width: px, height: px }}
    >
      <IconComp
        className="text-accent"
        style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
      />
    </div>
  )
}
