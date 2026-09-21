/**
 * 内置浏览器状态叠层
 *
 * 右下角横幅，按优先级展示两类问题：
 * - 本地服务已停止：探活判定服务不再响应，附「重新检测」入口；服务恢复后自动刷新
 * - 页面加载失败：展示失败原因
 *
 * loading 不使用全屏蒙版（SPA 页面可能不触发 did-finish-load 导致蒙版不消失），
 * 改由工具栏刷新按钮（loading 时变 X）与地址栏 spinner 轻量提示。
 */
import { ArrowUpRight, PlugZap, RotateCw } from 'lucide-react'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { devServerMonitor } from '@renderer/preview/devServerMonitor'
import { usePreviewServerStatus } from './hooks/usePreviewServerStatus'

interface BrowserStatusOverlayProps {
  session: PreviewSession
}

export default function BrowserStatusOverlay({ session }: BrowserStatusOverlayProps) {
  const language = useStore((state) => state.language) as Language
  const serverStatus = usePreviewServerStatus(session.id)

  // 服务停止比「加载失败」更能解释问题，优先展示
  const serverDown = serverStatus?.state === 'down'

  if (!serverDown && session.status !== 'error') {
    return null
  }

  if (serverDown) {
    return (
      <div className="absolute inset-x-4 bottom-4 rounded-xl border border-status-warning/30 bg-background-editor/90 px-4 py-3 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-status-warning/10 text-status-warning flex items-center justify-center shrink-0">
            <PlugZap className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">
              {t('editor.browser.serverDown', language)}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {t('editor.browser.serverDownDesc', language)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void devServerMonitor.probeNow()}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-lg hover:bg-text-primary/[0.05] transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
            {t('editor.browser.serverRetry', language)}
          </button>
        </div>
      </div>
    )
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

