import { History, Trash2, GraduationCap, Shield, Zap } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

interface ChatHeaderProps {
  showSessions: boolean
  setShowSessions: (show: boolean) => void
  onClearMessages: () => void
}

export default function ChatHeader({
  showSessions,
  setShowSessions,
  onClearMessages,
}: ChatHeaderProps) {
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const isZh = language === 'zh'

  // 头部改用不透明底色，不再叠加 backdrop-filter：
  // 会话列表在流式期间每帧都在长高，毛玻璃需要同步重新采样并模糊其背后的内容，
  // 这份开销在整段回复期间持续存在，换成纯色底色可完全消除。
  return (
    <div className="h-12 flex items-center justify-between px-4 border-b border-border bg-background z-20">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface border border-border-subtle">
          <GraduationCap className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-medium text-text-secondary">{isZh ? '专家' : 'Expert'}</span>
        </div>
        {activeScenarioId && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent/5 border border-accent/10 text-accent text-[10px] font-medium">
            <Zap className="w-3 h-3" />
            <span>{activeScenarioId}</span>
            <Shield className="w-3 h-3 opacity-60" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowSessions(!showSessions)}
          className={`p-1.5 rounded-md hover:bg-surface-hover transition-colors ${showSessions ? 'text-accent' : 'text-text-muted'
            }`}
          title={t('history', language)}
        >
          <History className="w-4 h-4" />
        </button>
        <button
          onClick={onClearMessages}
          className="p-1.5 rounded-md hover:bg-surface-hover hover:text-status-error transition-colors"
          title={t('clearChat', language)}
        >
          <Trash2 className="w-4 h-4 text-text-muted" />
        </button>
      </div>
    </div>
  )
}
