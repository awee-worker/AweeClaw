import { Search, TerminalSquare, FolderOpen, Settings, Keyboard } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'

export function EditorWelcome() {
  const language = useStore((state) => state.language)
  const setShowSettingsPage = useStore((state) => state.setShowSettingsPage)
  const openQuickOpen = () => useStore.getState().setShowQuickOpen(true)
  const openCommandPalette = () => useStore.getState().setShowCommandPalette(true)

  const shortcuts = [
    { icon: <Search className="w-4 h-4" />, label: t('editorWelcome.searchTitle', language), action: openQuickOpen, keys: ['Ctrl', 'P'] },
    { icon: <TerminalSquare className="w-4 h-4" />, label: t('editorWelcome.commandsTitle', language), action: openCommandPalette, keys: ['Ctrl', 'Shift', 'P'] },
    { icon: <FolderOpen className="w-4 h-4" />, label: t('editorWelcome.openRecentFile', language), action: openQuickOpen, keys: null },
    { icon: <Settings className="w-4 h-4" />, label: t('settings', language), action: () => setShowSettingsPage(true), keys: ['Ctrl', ','] },
  ]

  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 max-w-md w-full px-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Keyboard className="w-6 h-6 text-accent" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t('editorWelcome.title', language)}
          </h2>
          <p className="text-sm text-text-muted text-center leading-relaxed">
            {t('editorWelcome.subtitle', language)}
          </p>
        </div>

        <div className="w-full flex flex-col gap-1">
          {shortcuts.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors duration-150 group"
            >
              <span className="text-text-muted group-hover:text-accent transition-colors">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.keys && (
                <span className="flex items-center gap-1">
                  {item.keys.map((key) => (
                    <kbd key={key} className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                      {key}
                    </kbd>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
