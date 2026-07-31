/**
 * 内置浏览器状态叠层
 *
 * 仅保留 error 横幅（右下角，展示失败原因）。
 * loading 状态不再使用全屏蒙版（SPA 页面可能不触发 did-finish-load 导致蒙版不消失），
 * 改由工具栏刷新按钮（loading 时变 X）+ 地址栏 Globe 图标位 spinner 轻量提示。
 */
import { ArrowUpRight } from 'lucide-react'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface BrowserStatusOverlayProps {
  session: PreviewSession
}

export default function BrowserStatusOverlay({ session }: BrowserStatusOverlayProps) {
  const language = useStore((state) => state.language) as Language

  if (session.status !== 'error') {
    return null
  }

  return (
    <div className="absolute inset-x-4 bottom-4 rounded-xl border border-status-error/30 bg-background-editor/90 px-4 py-3 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-status-error/10 text-status-error flex items-center justify-center shrink-0">
          <ArrowUpRight className="w-4 h-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-text-primary">
            {t('editor.previewfailedtoload', language)}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {session.lastError || session.url}
          </p>
        </div>
      </div>
    </div>
  )
}
