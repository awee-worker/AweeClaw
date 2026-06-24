/**
 * 工作区/聊天切换栏组件
 * 在团队模式下提供工作区与聊天视图的切换
 */
import { MessageSquare, BrainCircuit } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface WorkspaceToggleBarProps {
  workspaceViewVisible: boolean
  setWorkspaceViewVisible: (visible: boolean) => void
  isExecuting: boolean
  language: Language
}

export function WorkspaceToggleBar({
  workspaceViewVisible,
  setWorkspaceViewVisible,
  isExecuting,
  language,
}: WorkspaceToggleBarProps) {
  return (
    <div className="flex items-center justify-center gap-1 px-4 pt-2 pb-1 border-b border-border/30 bg-surface/30">
      <button
        onClick={() => setWorkspaceViewVisible(false)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
          !workspaceViewVisible
            ? 'bg-accent/10 text-accent'
            : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
        }`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        {t('ai.chat', language)}
      </button>
      <button
        onClick={() => setWorkspaceViewVisible(true)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
          workspaceViewVisible
            ? 'bg-accent/10 text-accent'
            : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
        }`}
      >
        <BrainCircuit className="w-3.5 h-3.5" />
        {t('ai.workspace', language)}
        {isExecuting && (
          <span className="relative flex h-1.5 w-1.5 ml-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
          </span>
        )}
      </button>
    </div>
  )
}
