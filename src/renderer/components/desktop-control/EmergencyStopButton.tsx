/**
 * 紧急停止浮动按钮（Phase 3）
 *
 * 职责：
 * - 始终可见的红色停止按钮，可立即中止所有桌面自动化操作
 * - 监听紧急停止状态，触发后变为"解除"按钮
 * - 不依赖任何上下文，可在任何界面使用
 *
 * 设计原则：
 * - 极简：单一按钮，无多余 UI
 * - 高可用：即使主进程卡死也能响应点击（通过 IPC 异步触发）
 * - 视觉醒目：红色脉动动画
 */

import { useState, useEffect, useCallback } from 'react'
import { StopCircle, PlayCircle } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { useI18n } from '@renderer/i18n'

interface EmergencyStopButtonProps {
  /** 自定义类名 */
  className?: string
}

export default function EmergencyStopButton({ className = '' }: EmergencyStopButtonProps) {
  const { t } = useI18n()
  const [isActive, setIsActive] = useState(false)

  // 订阅紧急停止状态
  useEffect(() => {
    // 初始加载状态
    api.desktop.emergencyStop.getState().then((result) => {
      if (result.success && result.data) {
        setIsActive(result.data.stopped)
      }
    }).catch(() => {
      // 忽略错误，按钮仍可点击
    })

    // 订阅状态变化
    const unsubscribe = api.desktop.emergencyStop.onStateChange((state) => {
      setIsActive(state?.stopped ?? false)
    })
    return unsubscribe
  }, [])

  const handleClick = useCallback(async () => {
    try {
      if (isActive) {
        await api.desktop.emergencyStop.reset()
      } else {
        await api.desktop.emergencyStop.trigger({
          source: 'user',
          reason: 'Triggered from floating button',
        })
      }
    } catch (err) {
      console.error('[EmergencyStopButton] Failed to toggle:', err)
    }
  }, [isActive])

  return (
    <button
      onClick={handleClick}
      title={isActive ? t('desktop.emergencyStop.reset') : t('desktop.emergencyStop.trigger')}
      className={`fixed bottom-6 right-6 z-50 flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-all duration-200 ${
        isActive
          ? 'bg-emerald-500/90 hover:bg-emerald-500 text-white'
          : 'bg-red-500/90 hover:bg-red-500 text-white animate-pulse'
      } ${className}`}
    >
      {isActive ? (
        <PlayCircle className="w-6 h-6" />
      ) : (
        <StopCircle className="w-6 h-6" />
      )}
    </button>
  )
}
