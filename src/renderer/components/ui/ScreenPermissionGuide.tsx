/**
 * 屏幕录制权限引导弹窗（macOS）
 *
 * 当截图功能因缺少「屏幕录制」权限失败（SCREEN_PERMISSION_DENIED）时展示，
 * 引导用户到系统设置开启权限，并提供「打开系统设置」快捷入口。
 *
 * 主窗口聊天输入框（ConversationInput）与悬浮球迷你聊天（MiniChatPanel）共用。
 * 权限开启后需完全退出并重新启动应用才能生效（macOS TCC 行为）。
 */
import React, { memo, useCallback } from 'react'
import { MonitorUp, Check } from 'lucide-react'
import { OverlayDialog } from './OverlayDialog'
import { api } from '../../adapters/electronBridge'

interface ScreenPermissionGuideProps {
  isOpen: boolean
  onClose: () => void
  language?: 'zh' | 'en'
}

export const ScreenPermissionGuide: React.FC<ScreenPermissionGuideProps> = memo(
  function ScreenPermissionGuide({ isOpen, onClose, language = 'zh' }) {
    const isZh = language === 'zh'

    const handleOpenSettings = useCallback(() => {
      void api.screenshot.openPermissionSettings()
    }, [])

    const steps = isZh
      ? [
          '点击下方「打开系统设置」按钮',
          '在「隐私与安全性 → 屏幕录制」中勾选 AweeClaw（若列表中未显示，点击 + 号添加）',
          '完全退出并重新启动 AweeClaw，权限即生效',
        ]
      : [
          'Click "Open System Settings" below',
          'In "Privacy & Security → Screen Recording", check AweeClaw (click + to add if not listed)',
          'Fully quit and restart AweeClaw for the permission to take effect',
        ]

    return (
      <OverlayDialog
        isOpen={isOpen}
        onClose={onClose}
        title={isZh ? '需要屏幕录制权限' : 'Screen Recording Permission Required'}
        size="md"
      >
        <div className="flex flex-col gap-4">
          {/* 图标 + 说明 */}
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
              <MonitorUp className="w-5 h-5" />
            </div>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {isZh
                ? '截图功能需要 macOS「屏幕录制」权限。未授权时截图会显示黑屏或无法截取。开启后请重启应用。'
                : 'Screenshots require the macOS "Screen Recording" permission. Without it, captures appear black or fail. Please restart the app after granting.'}
            </p>
          </div>

          {/* 操作步骤 */}
          <div className="flex flex-col gap-2 rounded-xl bg-surface/60 border border-border/40 p-3">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/10 text-accent flex items-center justify-center mt-0.5">
                  <Check className="w-3 h-3" />
                </span>
                <span className="text-[13px] leading-relaxed text-text-primary">{step}</span>
              </div>
            ))}
          </div>

          {/* 终端运行提示 */}
          <p className="text-[12px] leading-relaxed text-text-muted">
            {isZh
              ? '提示：通过终端（Trae / VS Code 等）运行 npm run dev 时，权限归属终端应用；独立启动 AweeClaw 时需为 AweeClaw 本体授权。'
              : 'Note: when running via a terminal (Trae / VS Code), the permission belongs to the terminal app; when running AweeClaw standalone, grant permission to AweeClaw itself.'}
          </p>

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[13px] font-medium text-text-secondary hover:bg-surface-active hover:text-text-primary transition-all"
            >
              {isZh ? '取消' : 'Cancel'}
            </button>
            <button
              onClick={handleOpenSettings}
              className="px-4 py-2 rounded-xl text-[13px] font-medium bg-accent text-white shadow-md shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
            >
              {isZh ? '打开系统设置' : 'Open System Settings'}
            </button>
          </div>
        </div>
      </OverlayDialog>
    )
  },
)

export default ScreenPermissionGuide
