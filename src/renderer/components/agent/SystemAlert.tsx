/**
 * 系统级别错误/警告提示组件
 * 设计风格：玻璃质感 + 渐变边框 + 图标动画
 */

import React from 'react'
import { AlertTriangle, Info, XCircle, CheckCircle, Lightbulb } from 'lucide-react'
import { motion } from 'framer-motion'
import { t } from '@renderer/i18n'
import type { SystemAlertAction } from '@/renderer/agent/types/messages'

export type AlertType = 'error' | 'warning' | 'info' | 'success'

interface SystemAlertProps {
  type: AlertType
  title?: string
  message: string
  suggestion?: string
  compact?: boolean
  action?: SystemAlertAction
  onAction?: (action: SystemAlertAction) => void
  className?: string
}

const alertConfig = {
  error: {
    icon: XCircle,
    bgColor: 'bg-red-500/5',
    borderColor: 'border-red-500/15',
    iconBgColor: 'bg-red-500/10',
    iconColor: 'text-red-500',
    titleColor: 'text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-amber-500/5',
    borderColor: 'border-amber-500/15',
    iconBgColor: 'bg-amber-500/10',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-400',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-500/5',
    borderColor: 'border-blue-500/15',
    iconBgColor: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-400',
  },
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-500/5',
    borderColor: 'border-green-500/15',
    iconBgColor: 'bg-green-500/10',
    iconColor: 'text-green-500',
    titleColor: 'text-green-400',
  },
}

export const SystemAlert: React.FC<SystemAlertProps> = ({
  type,
  title,
  message,
  suggestion,
  compact = false,
  action,
  onAction,
  className = '',
}) => {
  const config = alertConfig[type]
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.2 }}
      className={`group ${compact ? 'my-1 rounded-xl' : 'my-0.5 rounded-lg'} relative overflow-hidden transition-colors border ${config.bgColor} ${config.borderColor} ${className}`}
    >
      <div className={`flex items-start ${compact ? 'gap-2 px-2.5 py-2' : 'gap-2.5 px-3 py-2.5'}`}>
        <div className={`shrink-0 ${compact ? 'mt-[1px] w-3.5 h-3.5' : 'mt-[1.5px] w-4 h-4'} flex items-center justify-center`}>
          <div className={`${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} rounded-full flex items-center justify-center ${config.iconBgColor}`}>
            <Icon className={`${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'} ${config.iconColor}`} />
          </div>
        </div>

        <div className={`flex-1 min-w-0 ${compact ? 'space-y-0.5' : 'space-y-1'}`}>
          {title && (
            <div className={`${compact ? 'text-[12px]' : 'text-[12px]'} font-medium px-0.5 ${config.titleColor} tracking-tight`}>
              {title}
            </div>
          )}

          <div className={`${compact ? 'text-[10.5px]' : 'text-[12px]'} px-0.5 break-words ${title ? 'text-text-secondary' : config.titleColor} leading-relaxed`}>
            {message}
          </div>

          {suggestion && (
            <div className={`flex items-start gap-1.5 ${compact ? 'mt-1 pt-1' : 'mt-2 pt-1.5'} border-t border-border/30`}>
              <Lightbulb className={`${compact ? 'w-2.5 h-2.5 mt-[1px]' : 'w-3 h-3 mt-[1.5px]'} text-accent/70 shrink-0`} />
              <span className={`${compact ? 'text-[11px]' : 'text-[12px]'} text-text-muted break-words leading-relaxed`}>
                {suggestion}
              </span>
            </div>
          )}

          {action && (
            <div className={`${compact ? 'mt-1 pt-1' : 'mt-2 pt-1.5'} border-t border-border/30`}>
              <button
                onClick={() => onAction?.(action)}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                  text-[12px] font-medium transition-all duration-150
                  ${action.actionType === 'continue'
                    ? 'bg-accent/10 text-accent hover:bg-accent/20 active:bg-accent/30'
                    : action.actionType === 'retry'
                    ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 active:bg-blue-500/30'
                    : 'bg-border/30 text-text-secondary hover:bg-border/50 active:bg-border/60'
                  }
                `}
              >
                {action.label}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/**
 * 从文本中解析系统警告
 * 仅匹配循环检测相关的特定格式，避免误判 AI 回复中的 ⚠️ 标记
 */
export function parseSystemAlert(text: string, language?: string): {
  type: AlertType
  title?: string
  message: string
  suggestion?: string
} | null {
  const lang = (language || 'en') as any

  const loopKeywords = [
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

  const loopPattern = /⚠️\s*(.+?)(?:\n💡\s*(.+))?$/s
  const match = text.match(loopPattern)

  if (match) {
    const message = match[1].trim()
    const suggestion = match[2]?.trim()

    const isLoopRelated = loopKeywords.some(kw => kw.test(message))
    if (!isLoopRelated) return null

    let type: AlertType = 'warning'
    let title = t('alert.loopDetected', lang)

    if (message.includes('repeating pattern')) {
      title = t('alert.repeatingPattern', lang)
    } else if (message.includes('exact repeat')) {
      title = t('alert.exactRepeat', lang)
    } else if (message.includes('cycling')) {
      title = t('alert.contentCycling', lang)
    }

    return { type, title, message, suggestion }
  }

  return null
}
