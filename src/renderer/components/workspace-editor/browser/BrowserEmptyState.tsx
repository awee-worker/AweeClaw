/**
 * 内置浏览器空状态
 *
 * 无预览会话时展示占位与引导文案。
 */
import { Globe } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

export default function BrowserEmptyState() {
  const language = useStore((state) => state.language) as Language

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 text-text-muted">
      <Globe className="w-10 h-10 mb-4 opacity-60" />
      <p className="text-sm font-medium text-text-primary">
        {t('editor.browser.emptyTitle', language)}
      </p>
      <p className="text-xs mt-2 max-w-md leading-relaxed">
        {t('editor.browser.emptyDesc', language)}
      </p>
    </div>
  )
}
