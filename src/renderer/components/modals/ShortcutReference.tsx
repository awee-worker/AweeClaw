import { useState, useMemo, memo } from 'react'
import { Keyboard, X, Search, AlertTriangle, Layers } from 'lucide-react'
import { formatShortcutKeys } from '@services/keybindingAdapter'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface BindingEntry {
  keys: string[]
  description: string
  category: string
  scenarioScope?: string[]
  isCustomizable?: boolean
}

const BINDINGS: BindingEntry[] = [
  { keys: ['Ctrl', 'S'], description: 'Save file', category: 'File', isCustomizable: true },
  { keys: ['Ctrl', 'W'], description: 'Close file', category: 'File', isCustomizable: true },
  { keys: ['Ctrl', 'O'], description: 'Open folder', category: 'File', isCustomizable: true },
  { keys: ['Ctrl', 'N'], description: 'New file', category: 'File', isCustomizable: true },

  { keys: ['Ctrl', 'Z'], description: 'Undo', category: 'Edit', isCustomizable: true },
  { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo', category: 'Edit', isCustomizable: true },
  { keys: ['Ctrl', 'C'], description: 'Copy', category: 'Edit' },
  { keys: ['Ctrl', 'V'], description: 'Paste', category: 'Edit' },
  { keys: ['Ctrl', 'X'], description: 'Cut', category: 'Edit' },
  { keys: ['Ctrl', 'A'], description: 'Select all', category: 'Edit' },
  { keys: ['Ctrl', 'F'], description: 'Find', category: 'Edit', isCustomizable: true },
  { keys: ['Ctrl', 'H'], description: 'Replace', category: 'Edit', isCustomizable: true },

  { keys: ['Ctrl', 'G'], description: 'Go to line', category: 'Navigation', isCustomizable: true },
  { keys: ['Ctrl', 'P'], description: 'File navigator', category: 'Navigation', isCustomizable: true },
  { keys: ['Ctrl', 'Tab'], description: 'Switch tab', category: 'Navigation' },
  { keys: ['Ctrl', 'Shift', 'P'], description: 'Command hub', category: 'Navigation', isCustomizable: true },

  { keys: ['Ctrl', 'K'], description: 'Inline edit with AI', category: 'AI', scenarioScope: ['code'], isCustomizable: true },
  { keys: ['Ctrl', 'Enter'], description: 'Send message', category: 'AI', isCustomizable: true },
  { keys: ['Escape'], description: 'Stop generation', category: 'AI' },
  { keys: ['@'], description: 'Reference file in chat', category: 'AI' },
  { keys: ['/'], description: 'Slash command', category: 'AI' },
  { keys: ['Ctrl', 'Shift', 'L'], description: 'Legal review mode', category: 'AI', scenarioScope: ['legal'] },
  { keys: ['Ctrl', 'Shift', 'M'], description: 'Medical check mode', category: 'AI', scenarioScope: ['medical'] },
  { keys: ['Ctrl', 'Shift', 'E'], description: 'Education tutor mode', category: 'AI', scenarioScope: ['education'] },

  { keys: ['Ctrl', '`'], description: 'Toggle terminal', category: 'View', isCustomizable: true },
  { keys: ['Ctrl', 'B'], description: 'Toggle sidebar', category: 'View', isCustomizable: true },
  { keys: ['Ctrl', ','], description: 'Open settings', category: 'View', isCustomizable: true },
  { keys: ['Ctrl', 'L'], description: 'Toggle AI panel', category: 'View', isCustomizable: true },
  { keys: ['Ctrl', 'J'], description: 'Toggle dock panel', category: 'View', isCustomizable: true },
]

interface ShortcutReferenceProps {
  onClose: () => void
}

const KeyCap = memo(function KeyCap({ keyName }: { keyName: string }) {
  return (
    <kbd className="px-2 py-0.5 text-[11px] font-mono bg-surface/80 border border-border/50 rounded shadow-sm min-w-[20px] text-center inline-block">
      {keyName}
    </kbd>
  )
})

export default function ShortcutReference({ onClose }: ShortcutReferenceProps) {
  const language = useStore(s => s.language)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const categories = useMemo(() => {
    const cats = new Set(BINDINGS.map(b => b.category))
    return ['all', ...Array.from(cats)]
  }, [])

  const conflictKeys = useMemo(() => {
    const keyMap = new Map<string, string[]>()
    for (const b of BINDINGS) {
      const key = b.keys.join('+')
      if (!keyMap.has(key)) keyMap.set(key, [])
      keyMap.get(key)!.push(b.description)
    }
    const conflicts: string[] = []
    for (const [key, descs] of keyMap) {
      if (descs.length > 1) conflicts.push(key)
    }
    return conflicts
  }, [])

  const filteredBindings = useMemo(() => {
    return BINDINGS.filter(b => {
      if (activeCategory !== 'all' && b.category !== activeCategory) return false
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return b.description.toLowerCase().includes(q) || b.keys.join('+').toLowerCase().includes(q) || b.category.toLowerCase().includes(q)
    })
  }, [searchQuery, activeCategory])

  const groupedBindings = useMemo(() => {
    const groups: Record<string, BindingEntry[]> = {}
    for (const b of filteredBindings) {
      if (!groups[b.category]) groups[b.category] = []
      groups[b.category].push(b)
    }
    return groups
  }, [filteredBindings])

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="bg-surface/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl w-[680px] max-h-[80vh] overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Keyboard className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">{t('modals.shortcutreference', language as Language)}</h2>
              <p className="text-[11px] text-text-muted">{t('modals.aweeclawscenarioawarekeybindings', language as Language)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-hover transition-colors">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30 bg-surface/30">
          <Search className="w-4 h-4 text-text-muted flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('modals.searchshortcuts', language as Language)}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none"
          />
          <div className="flex items-center gap-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${activeCategory === cat ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-white/5'}`}
              >
                {cat === 'all' ? (t('modals.all', language as Language)) : cat}
              </button>
            ))}
          </div>
        </div>

        {conflictKeys.length > 0 && (
          <div className="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-[11px] text-yellow-400/80">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{conflictKeys.length} {t('modals.keybindingconflictsdetected', language as Language)}</span>
          </div>
        )}

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-180px)] custom-scrollbar">
          <div className="grid grid-cols-2 gap-6">
            {Object.entries(groupedBindings).map(([category, items]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-black text-accent uppercase tracking-wider">{category}</span>
                  <span className="text-[10px] text-text-muted/40">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((binding, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-hover/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[12px] text-text-secondary truncate">{binding.description}</span>
                        {binding.scenarioScope && binding.scenarioScope.length > 0 && (
                          <div className="flex gap-0.5 flex-shrink-0">
                            {binding.scenarioScope.map(s => (
                              <span key={s} className="px-1 py-0.5 rounded text-[8px] font-bold bg-accent/5 text-accent/50 border border-accent/10">{s}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        {formatShortcutKeys(binding.keys).map((key, keyIdx) => (
                          <span key={keyIdx} className="flex items-center">
                            <KeyCap keyName={key} />
                            {keyIdx < binding.keys.length - 1 && (
                              <span className="mx-0.5 text-text-muted/40 text-[10px]">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border/30 bg-surface/20 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] text-text-muted/50">
            <Layers className="w-3 h-3" />
            <span>{t('modals.scenariotagsindicatecontextspecificbindings', language as Language)}</span>
          </div>
          <span className="text-[10px] text-text-muted/40">
            Press <KeyCap keyName="?" /> to toggle
          </span>
        </div>
      </div>
    </div>
  )
}
