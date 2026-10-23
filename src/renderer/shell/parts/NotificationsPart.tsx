/**
 * 消息中心部件（notifications）
 *
 * 角标 = 本地运行消息（toast）+ 后端未读通知（套餐 / 场景 / 插件到期等）。
 * 两者对用户都是「有事情要处理」，合并成一个入口才不会漏看。
 *
 * 通知轮询也归本部件管理：它是唯一的消费者，挂在部件内可以避免外壳层
 * 为了一个角标而订阅整条通知链路。
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { BRAND } from '@shared/brand'
import { useInlineToast } from '@components/foundation/InlineNotification'
import { useHasElevatedToastLayer } from '@components/foundation/toastLayerStore'
import DockPopover from '@components/ui/DockPopover'
import NotificationCenterContent, { NotificationClearButton } from '@components/dock-panels/NotificationPanel'
import ServiceStatusPopover from '@components/layout/ServiceStatusPopover'
import { Volume2 } from 'lucide-react'
import {
  useUserNotificationStore,
  startUserNotificationPolling,
  stopUserNotificationPolling,
} from '@store/userNotificationStore'
import type { HostPartComponentProps } from '../HostPartRegistry'

export function NotificationsPart({ placement = 'bottom' }: HostPartComponentProps & { placement?: 'top' | 'bottom' }) {
  const language = useStore((s) => s.language)
  const isAuthenticated = useStore((s) => s.isAuthenticated)

  const { toasts, visibleIds } = useInlineToast()
  const unread = useUserNotificationStore((s) => s.unreadCount)
  const notificationCount = toasts.length + unread

  // 消息中心 popover 受控：点击通知跳转后需要主动收起，否则浮层会挡在目标页面上
  const [messagesOpen, setMessagesOpen] = useState(false)

  const latestVisibleToastId = [...visibleIds].reverse().find((id) => {
    const toast = toasts.find((item) => item.id === id)
    return toast?.variant === 'inline'
  })
  const activeToast = latestVisibleToastId ? toasts.find((item) => item.id === latestVisibleToastId) : null
  const shouldEject = useHasElevatedToastLayer()

  // 登录后启动通知轮询，登出时停止并清空（避免角标残留上一账号的未读数）
  useEffect(() => {
    if (isAuthenticated) startUserNotificationPolling()
    else stopUserNotificationPolling()
  }, [isAuthenticated])

  return (
    <>
      <DockPopover
        placement={placement}
        // 角标交给 DockPopover 统一渲染：与服务图标同源，右上角定位一致，
        // 不在 bell 自身的 16px 容器里各自计算偏移（会导致两者上下错位）。
        badge={
          notificationCount > 0 && (!activeToast || shouldEject)
            ? notificationCount > 9
              ? '9+'
              : notificationCount
            : undefined
        }
        icon={
          <div className="relative flex items-center justify-center">
            <AnimatePresence mode="wait">
              {activeToast && !shouldEject ? (
                <motion.div
                  layoutId={BRAND.layout.dynamicIslandId}
                  key={activeToast.id}
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Volume2 className={`w-3.5 h-3.5 animate-pulse shrink-0 ${
                    activeToast.type === 'success' ? 'text-emerald-400' :
                      activeToast.type === 'error' ? 'text-red-400' :
                        activeToast.type === 'warning' ? 'text-amber-400' :
                          'text-blue-400'
                  }`} />
                  <span className="text-[10.5px] text-text-primary font-medium truncate max-w-[160px]">
                    {activeToast.message}
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="bell"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="relative flex items-center justify-center"
                >
                  <Bell className={`w-4 h-4 ${notificationCount > 0 ? 'text-accent' : ''}`} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
        tooltip={t('layout.messages', language as Language)}
        title={t('layout.messages', language as Language)}
        headerActions={<NotificationClearButton language={language as 'en' | 'zh'} />}
        width={360}
        height={420}
        language={language as 'en' | 'zh'}
        open={messagesOpen}
        onOpenChange={setMessagesOpen}
      >
        <NotificationCenterContent
          language={language as 'en' | 'zh'}
          onNavigate={() => setMessagesOpen(false)}
        />
      </DockPopover>

      {/* 后台服务状态：紧跟消息图标，仅在确有服务运行时显示 */}
      <ServiceStatusPopover language={language as Language} />
    </>
  )
}

export default NotificationsPart
