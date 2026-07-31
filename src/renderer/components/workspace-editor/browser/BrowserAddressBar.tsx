/**
 * 内置浏览器地址栏
 *
 * 结构：🌐 Globe 图标 + URL 输入框 + 清空按钮
 * 交互：
 * - Enter 提交导航（onNavigate）
 * - Esc 还原为当前 URL（onReset）
 * - 非空时显示清空按钮
 */
import { Globe, X, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface BrowserAddressBarProps {
  /** 当前输入值 */
  value: string
  /** 输入变化回调 */
  onChange: (value: string) => void
  /** 提交导航（Enter） */
  onNavigate: (url: string) => void
  /** 还原地址（Esc） */
  onReset: () => void
  /** 是否正在加载（加载时在地址栏左侧显示旋转图标） */
  isLoading?: boolean
}

export default function BrowserAddressBar({
  value,
  onChange,
  onNavigate,
  onReset,
  isLoading = false,
}: BrowserAddressBarProps) {
  const language = useStore((state) => state.language) as Language

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onNavigate(value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div className="flex-1 h-8 rounded-lg border border-border/50 bg-surface/40 flex items-center gap-2 px-2.5 focus-within:border-accent/40 transition-colors">
      {isLoading ? (
        <RefreshCw className="w-3.5 h-3.5 text-accent shrink-0 animate-spin" />
      ) : (
        <Globe className="w-3.5 h-3.5 text-text-muted shrink-0" />
      )}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 min-w-0 bg-transparent text-sm outline-none text-text-primary placeholder:text-text-muted"
        placeholder={t('editor.browser.addressPlaceholder', language)}
        spellCheck={false}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          title={t('editor.browser.clearAddress', language)}
          aria-label={t('editor.browser.clearAddress', language)}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
