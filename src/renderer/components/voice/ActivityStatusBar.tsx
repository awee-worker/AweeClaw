/**
 * ActivityStatusBar - 语音对话活动状态栏
 *
 * 显示 AI 当前正在做什么，让用户在工具执行期间不会感到困惑。
 *
 * 设计特点：
 * - 图标根据工具类型变化（写文件/读文件/搜索/命令/删除）
 * - 显示操作对象（文件路径、命令内容等）
 * - 步骤指示（第N步）
 * - 实时计时（已执行X秒）
 * - 渐变背景 + 呼吸动画，视觉舒适
 */

import { memo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FilePen, FileSearch, Terminal, Trash2, FileText, Wrench } from 'lucide-react'
import { getActivityIcon, formatElapsedTime, type ActivityStatus } from '../../utils/voiceActivityStatus'

interface ActivityStatusBarProps {
  activity: ActivityStatus | null
  isVisible: boolean
  isZh: boolean
}

/** 根据工具图标类型获取对应的 lucide 图标组件 */
function getActivityIconComponent(icon: ReturnType<typeof getActivityIcon>) {
  switch (icon) {
    case 'write': return FilePen
    case 'read': return FileText
    case 'search': return FileSearch
    case 'command': return Terminal
    case 'delete': return Trash2
    default: return Wrench
  }
}

/** 根据工具图标类型获取颜色主题 */
function getActivityColor(icon: ReturnType<typeof getActivityIcon>): {
  text: string
  bg: string
  border: string
  spin: string
} {
  switch (icon) {
    case 'write':
      return {
        text: 'text-emerald-300',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        spin: 'border-emerald-400/30 border-t-emerald-400',
      }
    case 'read':
      return {
        text: 'text-blue-300',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        spin: 'border-blue-400/30 border-t-blue-400',
      }
    case 'search':
      return {
        text: 'text-violet-300',
        bg: 'bg-violet-500/10',
        border: 'border-violet-500/30',
        spin: 'border-violet-400/30 border-t-violet-400',
      }
    case 'command':
      return {
        text: 'text-amber-300',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        spin: 'border-amber-400/30 border-t-amber-400',
      }
    case 'delete':
      return {
        text: 'text-red-300',
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        spin: 'border-red-400/30 border-t-red-400',
      }
    default:
      return {
        text: 'text-text-secondary',
        bg: 'bg-surface/60',
        border: 'border-border/40',
        spin: 'border-text-muted/30 border-t-text-muted',
      }
  }
}

function ActivityStatusBarImpl({ activity, isVisible, isZh }: ActivityStatusBarProps) {
  // 实时更新计时
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!activity) return
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [activity])

  const shouldShow = isVisible && activity && (activity.action || activity.toolName)

  return (
    <AnimatePresence>
      {shouldShow && (() => {
        const iconType = getActivityIcon(activity!.toolName)
        const Icon = getActivityIconComponent(iconType)
        const colors = getActivityColor(iconType)
        const elapsed = formatElapsedTime(activity!.startTime, Date.now())
        const stepText = isZh
          ? `第 ${activity!.step} 步`
          : `Step ${activity!.step}`

        return (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.9 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl ${colors.bg} border ${colors.border} backdrop-blur-md shadow-lg max-w-md`}
          >
            {/* 图标 + 旋转指示器 */}
            <div className="relative flex-shrink-0">
              <Icon className={`w-4 h-4 ${colors.text}`} />
              <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${colors.spin} animate-spin`} />
            </div>

            {/* 文字信息 */}
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              {/* 动作 + 步骤 */}
              <div className="flex items-center gap-2">
                <span className={`text-[13px] font-medium ${colors.text} truncate`}>
                  {activity!.action}
                </span>
                <span className="text-[12px] text-text-muted flex-shrink-0">
                  · {stepText}
                </span>
              </div>

              {/* 操作对象 */}
              {activity!.target && (
                <span className="text-[12px] text-text-muted truncate font-mono">
                  {activity!.target}
                </span>
              )}
            </div>

            {/* 计时 */}
            <span className="text-[12px] text-text-muted flex-shrink-0 tabular-nums">
              {elapsed}
            </span>
          </motion.div>
        )
      })()}
    </AnimatePresence>
  )
}

export const ActivityStatusBar = memo(ActivityStatusBarImpl)
