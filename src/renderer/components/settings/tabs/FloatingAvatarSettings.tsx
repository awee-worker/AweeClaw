/**
 * FloatingAvatarSettings - 悬浮头像设置面板
 *
 * 从 WakeWordSettings 迁移至「外观设置」页面，包含：
 * - 开关：启用悬浮头像
 * - 启动时显示：应用启动时自动显示头像
 *
 * 设计原则：
 * - 独立组件，可嵌入任意设置页面
 * - 配置变更实时保存到 app_settings KV 表
 * - 启用/禁用开关时实时显隐头像窗口
 */

import { useState, useEffect, useCallback } from 'react'
import { Circle, Sparkles, Loader2 } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@components/foundation/NotificationProvider'
import type { Language } from '@renderer/i18n'

// ============================================
// 类型定义
// ============================================

interface FloatingAvatarConfig {
  enabled: boolean
  showOnStartup: boolean
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_AVATAR_CONFIG: FloatingAvatarConfig = {
  enabled: true,
  showOnStartup: true,
}

// ============================================
// 主组件
// ============================================

export function FloatingAvatarSettings() {
  const { language } = useStore(
    useShallow((state) => ({
      language: state.language as Language,
    })),
  )

  const tt = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const [avatarConfig, setAvatarConfig] = useState<FloatingAvatarConfig>(DEFAULT_AVATAR_CONFIG)
  const [loading, setLoading] = useState(true)

  // --------------------------------------------
  // 加载配置
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      try {
        const avatarRes = await api.floatingAvatar.getConfig()

        if (cancelled) return

        if (avatarRes.success && avatarRes.data) {
          setAvatarConfig({
            enabled: avatarRes.data.enabled,
            showOnStartup: avatarRes.data.showOnStartup,
          })
        }
      } catch (err) {
        console.error('[FloatingAvatarSettings] Load config failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  // --------------------------------------------
  // 配置变更
  // --------------------------------------------
  const handleAvatarConfigChange = useCallback(
    async (partial: Partial<FloatingAvatarConfig>) => {
      const newConfig = { ...avatarConfig, ...partial }
      setAvatarConfig(newConfig)
      try {
        await api.floatingAvatar.updateConfig(newConfig)
        if (partial.enabled !== undefined) {
          // 开关变化时显隐头像
          if (partial.enabled) {
            await api.floatingAvatar.show()
          } else {
            await api.floatingAvatar.hide()
          }
        }
        toast.success(tt('悬浮头像配置已保存', 'Floating avatar settings saved'))
      } catch (err) {
        console.error('[FloatingAvatarSettings] Save avatar config failed:', err)
        toast.error(tt('保存失败', 'Save failed'))
      }
    },
    [avatarConfig, language],
  )

  // --------------------------------------------
  // 渲染
  // --------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ============ 悬浮头像设置 ============ */}
      <div className="rounded-xl border border-border/40 bg-surface/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Circle className="w-3.5 h-3.5 text-accent" />
          <p className="text-xs font-semibold text-text-primary">
            {tt('悬浮头像', 'Floating Avatar')}
          </p>
        </div>

        {/* 启用悬浮头像 */}
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {tt('启用悬浮头像', 'Enable Floating Avatar')}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {tt(
                '在屏幕右下角显示悬浮头像，层级最高，类似豆包',
                'Show a floating avatar in the bottom-right corner, always on top',
              )}
            </div>
          </div>
          <ToggleSwitch
            checked={avatarConfig.enabled}
            onChange={(e) => void handleAvatarConfigChange({ enabled: e.target.checked })}
          />
        </div>

        {/* 启动时显示 */}
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary">
              {tt('启动时显示', 'Show on Startup')}
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              {tt(
                '应用启动时自动显示悬浮头像',
                'Automatically show the floating avatar on app startup',
              )}
            </div>
          </div>
          <ToggleSwitch
            checked={avatarConfig.showOnStartup}
            onChange={(e) => void handleAvatarConfigChange({ showOnStartup: e.target.checked })}
          />
        </div>

        {/* 提示信息 */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/5 border border-accent/20">
          <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
          <div className="text-xs text-text-secondary">
            {tt(
              '关闭主窗口后悬浮头像仍保持显示，需通过托盘菜单「退出」或右键菜单「退出」完全退出。',
              'The floating avatar persists after closing the main window. Use the tray menu "Quit" or right-click "Quit" to fully exit.',
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
