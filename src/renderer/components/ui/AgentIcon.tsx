/**
 * AgentIcon - 智能体图标统一渲染组件
 *
 * 支持三种 icon 值：
 * 1. data:image/* → 渲染 <img>（自定义上传）
 * 2. lucide 图标名（如 'bot'、'brain'）→ 渲染对应 lucide 组件
 * 3. 其他任意字符（旧数据：emoji / 文本）→ 直接渲染文本
 */
import {
  Bot, Brain, Zap, Target, Sparkles, Rocket, Code2, Wrench, Settings, Search,
  Lightbulb, Palette, MessageSquare, Globe, Database, ShieldCheck, Cpu, Gem,
  Puzzle, Layers, type LucideIcon,
} from 'lucide-react'

// ─── 预设图标（lucide）───
export const AGENT_PRESET_ICONS: Array<{ id: string; component: LucideIcon }> = [
  { id: 'bot', component: Bot },
  { id: 'brain', component: Brain },
  { id: 'zap', component: Zap },
  { id: 'target', component: Target },
  { id: 'sparkles', component: Sparkles },
  { id: 'rocket', component: Rocket },
  { id: 'code-2', component: Code2 },
  { id: 'wrench', component: Wrench },
  { id: 'cog', component: Settings },
  { id: 'search', component: Search },
  { id: 'lightbulb', component: Lightbulb },
  { id: 'palette', component: Palette },
  { id: 'message-square', component: MessageSquare },
  { id: 'globe', component: Globe },
  { id: 'database', component: Database },
  { id: 'shield-check', component: ShieldCheck },
  { id: 'cpu', component: Cpu },
  { id: 'gem', component: Gem },
  { id: 'puzzle', component: Puzzle },
  { id: 'layers', component: Layers },
]

const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_PRESET_ICONS.map(i => [i.id, i.component]),
)

/** 是否为自定义上传的图片（data URL） */
export function isCustomIcon(icon?: string): boolean {
  return !!icon && icon.startsWith('data:image')
}

interface AgentIconProps {
  icon?: string
  className?: string
  size?: number
}

/** 渲染单个智能体图标（按类型分发） */
export function AgentIcon({ icon, className = '', size = 16 }: AgentIconProps) {
  if (!icon) return null
  if (icon.startsWith('data:image')) {
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        className={`object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  const Comp = ICON_MAP[icon]
  if (Comp) {
    return <Comp className={className} style={{ width: size, height: size }} />
  }
  // 旧数据兜底：emoji / 文本
  return (
    <span className={`leading-none ${className}`} style={{ fontSize: size }}>
      {icon}
    </span>
  )
}

interface AgentIconPreviewProps extends AgentIconProps {
  fallback?: string
}

/** 带兜底的图标预览（无 icon 时显示 fallback，默认机器人 emoji） */
export function AgentIconPreview({ icon, fallback = '🤖', className = '', size = 20 }: AgentIconPreviewProps) {
  if (!icon) {
    return (
      <span className={`leading-none ${className}`} style={{ fontSize: size }}>
        {fallback}
      </span>
    )
  }
  return <AgentIcon icon={icon} size={size} className={className} />
}
