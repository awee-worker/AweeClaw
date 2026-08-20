import React from 'react'
import { AlertTriangle, Info, XCircle, CheckCircle, Lightbulb, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { t } from '@renderer/i18n'
import type { SystemAlertAction } from '@intelligence/types/conversationModel'

export type AlertType = 'error' | 'warning' | 'info' | 'success'

interface SystemAlertProps {
    type: AlertType
    title?: string
    message: string
    suggestion?: string
    compact?: boolean
    /** 单个动作按钮（向后兼容） */
    action?: SystemAlertAction
    /** 多个动作按钮（优先于 action） */
    actions?: SystemAlertAction[]
    onAction?: (action: SystemAlertAction) => void
    className?: string
}

/** 告警视觉配置 */
interface AlertVisual {
    icon: LucideIcon
    bgColor: string
    borderColor: string
    iconBgColor: string
    iconColor: string
    titleColor: string
}

/** 根据告警类型构建视觉配置 */
function buildAlertVisual(type: AlertType): AlertVisual {
    const palette: Record<AlertType, { bg: string; border: string; iconBg: string; icon: string; title: string }> = {
        error: { bg: 'bg-red-500/5', border: 'border-red-500/15', iconBg: 'bg-red-500/10', icon: 'text-red-500', title: 'text-red-400' },
        warning: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', iconBg: 'bg-amber-500/10', icon: 'text-amber-500', title: 'text-amber-400' },
        info: { bg: 'bg-blue-500/5', border: 'border-blue-500/15', iconBg: 'bg-blue-500/10', icon: 'text-blue-500', title: 'text-blue-400' },
        success: { bg: 'bg-green-500/5', border: 'border-green-500/15', iconBg: 'bg-green-500/10', icon: 'text-green-500', title: 'text-green-400' },
    }
    const iconMap: Record<AlertType, LucideIcon> = {
        error: XCircle,
        warning: AlertTriangle,
        info: Info,
        success: CheckCircle,
    }
    const p = palette[type]
    return { icon: iconMap[type], bgColor: p.bg, borderColor: p.border, iconBgColor: p.iconBg, iconColor: p.icon, titleColor: p.title }
}

/** 动作按钮样式映射 */
function getActionStyle(actionType: string): string {
    const styles: Record<string, string> = {
        continue: 'bg-accent/10 text-accent hover:bg-accent/20 active:bg-accent/30',
        retry: 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:bg-blue-500/30',
        upgrade: 'bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 active:bg-violet-500/35',
    }
    return styles[actionType] || 'bg-border/30 text-text-secondary hover:bg-border/50 active:bg-border/60'
}

/** 图标容器 */
function AlertIcon({ visual, compact }: { visual: AlertVisual; compact: boolean }) {
    const Icon = visual.icon
    return (
        <div className={`shrink-0 ${compact ? 'mt-[1px] w-3.5 h-3.5' : 'mt-[1.5px] w-4 h-4'} flex items-center justify-center`}>
            <div className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full flex items-center justify-center ${visual.iconBgColor}`}>
                <Icon className={`${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'} ${visual.iconColor}`} />
            </div>
        </div>
    )
}

/** 建议区块 */
function SuggestionBlock({ text, compact }: { text: string; compact: boolean }) {
    return (
        <div className={`flex items-start gap-1.5 ${compact ? 'mt-1 pt-1' : 'mt-2 pt-1.5'} border-t border-border/30`}>
            <Lightbulb className={`${compact ? 'w-2.5 h-2.5 mt-[1px]' : 'w-3 h-3 mt-[1.5px]'} text-accent/70 shrink-0`} />
            <span className={`${compact ? 'text-[11px]' : 'text-[12px]'} text-text-muted break-words leading-relaxed`}>
                {text}
            </span>
        </div>
    )
}

/** 动作按钮 */
function ActionButton({ action, onAction }: { action: SystemAlertAction; onAction?: (a: SystemAlertAction) => void }) {
    return (
        <button
            onClick={() => onAction?.(action)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150 ${getActionStyle(action.actionType)}`}
        >
            {action.label}
        </button>
    )
}

/** 动作按钮组容器 */
function ActionGroup({ actions, onAction }: { actions: SystemAlertAction[]; onAction?: (a: SystemAlertAction) => void }) {
    return (
        <div className="mt-2 pt-1.5 border-t border-border/30 flex flex-wrap items-center gap-2">
            {actions.map((action, idx) => (
                <ActionButton key={`${action.actionType}-${idx}`} action={action} onAction={onAction} />
            ))}
        </div>
    )
}

/**
 * 系统告警组件
 *
 * 以告警类型驱动视觉配置，支持紧凑模式、建议区块和动作按钮。
 */
export const SystemAlert: React.FC<SystemAlertProps> = ({
    type,
    title,
    message,
    suggestion,
    compact = false,
    action,
    actions,
    onAction,
    className = '',
}) => {
    const visual = buildAlertVisual(type)
    // actions 数组优先；否则降级到单个 action
    const actionList = actions && actions.length > 0 ? actions : (action ? [action] : [])

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2 }}
            className={`group ${compact ? 'my-1 rounded-xl' : 'my-0.5 rounded-lg'} relative overflow-hidden transition-colors border ${visual.bgColor} ${visual.borderColor} ${className}`}
        >
            <div className={`flex items-start ${compact ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5'}`}>
                <AlertIcon visual={visual} compact={compact} />

                <div className={`flex-1 min-w-0 ${compact ? 'space-y-0.5' : 'space-y-1'}`}>
                    {title && (
                        <div className="text-[12px] font-medium px-0.5 tracking-tight" style={{ color: 'inherit' }}>
                            <span className={visual.titleColor}>{title}</span>
                        </div>
                    )}

                    <div className={`${compact ? 'text-[10.5px]' : 'text-[12px]'} px-0.5 break-words ${title ? 'text-text-secondary' : visual.titleColor} leading-relaxed`}>
                        {message}
                    </div>

                    {suggestion && <SuggestionBlock text={suggestion} compact={compact} />}

                    {actionList.length > 0 && <ActionGroup actions={actionList} onAction={onAction} />}
                </div>
            </div>
        </motion.div>
    )
}

/** 循环检测关键词匹配器 */
const LOOP_KEYWORD_MATCHERS: RegExp[] = [
    /repeating\s+pattern/i,
    /exact\s+repeat/i,
    /same\s+(tool|arguments|parameters)\s+(repeatedly|again)/i,
    /content\s+cycl/i,
    /loop\s+detect/i,
    /stuck\s+in\s+a?\s*loop/i,
    /重复模式/,
    /精确重复/,
    /相同.*重复/,
    /内容循环/,
    /循环检测/,
    /陷入循环/,
]

/** 告警标记正则：⚠️ message\n💡 suggestion */
const ALERT_PATTERN = /⚠️\s*(.+?)(?:\n💡\s*(.+))?$/

/** 标题匹配规则 */
const TITLE_RULES: Array<{ test: RegExp; key: string }> = [
    { test: /repeating pattern/i, key: 'alert.repeatingPattern' },
    { test: /exact repeat/i, key: 'alert.exactRepeat' },
    { test: /cycling/i, key: 'alert.contentCycling' },
]

/** 从文本中解析系统告警 */
export function parseSystemAlert(text: string, language?: string): {
    type: AlertType
    title?: string
    message: string
    suggestion?: string
} | null {
    const lang = (language || 'en') as any
    const match = text.match(ALERT_PATTERN)

    if (!match) return null

    const message = match[1].trim()
    const suggestion = match[2]?.trim()

    if (!LOOP_KEYWORD_MATCHERS.some((kw) => kw.test(message))) return null

    const titleRule = TITLE_RULES.find((rule) => rule.test.test(message))
    const title = titleRule ? t(titleRule.key, lang) : t('alert.loopDetected', lang)

    return { type: 'warning', title, message, suggestion }
}
