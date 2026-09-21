/**
 * 内置浏览器空状态
 *
 * 无预览会话时展示引导文案与最近的预览记录：重启后想回到刚才那个页面，
 * 不必再去翻终端里滚过去的那行地址。
 */
import { useState } from 'react'
import { Globe, History, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { openBuiltinPreview } from '@renderer/preview/openBuiltinPreview'
import {
  clearPreviewHistory,
  getRecentPreviews,
  type PreviewHistoryEntry,
} from '@renderer/preview/previewHistory'

export default function BrowserEmptyState() {
  const language = useStore((state) => state.language) as Language
  const [history, setHistory] = useState<PreviewHistoryEntry[]>(() => getRecentPreviews())
  const [error, setError] = useState('')

  const handleOpen = async (entry: PreviewHistoryEntry) => {
    setError('')

    // 本地预览凭目录重开：静态服务的端口与根目录登记都是运行期状态，旧地址重启后已失效
    const result = entry.previewRoot
      ? await openBuiltinPreview({ path: entry.previewRoot, title: entry.title })
      : await openBuiltinPreview({ url: entry.url, title: entry.title })

    if (!result.success) {
      setError(result.error || t('editor.browser.historyOpenFailed', language))
    }
  }

  const handleClear = () => {
    clearPreviewHistory()
    setHistory([])
    setError('')
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 text-text-muted">
      <Globe className="w-10 h-10 mb-4 opacity-60" />
      <p className="text-sm font-medium text-text-primary">
        {t('editor.browser.emptyTitle', language)}
      </p>
      <p className="text-xs mt-2 max-w-md leading-relaxed">
        {t('editor.browser.emptyDesc', language)}
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-status-error/10 px-3 py-1.5 text-[11px] text-status-error">
          {error}
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-6 w-full max-w-md text-left">
          <div className="flex items-center justify-between px-1">
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <History className="w-3.5 h-3.5" />
              {t('editor.browser.historyTitle', language)}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-status-error/10 hover:text-status-error"
            >
              <Trash2 className="w-3 h-3" />
              {t('editor.browser.historyClear', language)}
            </button>
          </div>

          <div className="mt-2 space-y-1">
            {history.map((entry) => (
              <button
                key={`${entry.url}-${entry.openedAt}`}
                type="button"
                onClick={() => void handleOpen(entry)}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-text-primary/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text-primary">{entry.title}</p>
                  <p className="truncate text-[11px] text-text-muted">{entry.url}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

