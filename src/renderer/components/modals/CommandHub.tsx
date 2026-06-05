import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  Search, FolderOpen, Settings, Terminal,
  MessageSquare, History, Trash2, RefreshCw, Save,
  X, Zap, Keyboard, Sparkles, Plus, FolderPlus, PanelRight,
  Clock, Shield, BookOpen, Layers
} from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentHistoryActions } from '@hooks/useAgent'
import {t, type Language} from '@renderer/i18n'
import { keybindingService, formatShortcut, isMac } from '@services/keybindingAdapter'
import { aweeclawDir } from '@services/appDirService'
import { StorageService } from '@shared/toolkit/StorageService'
import { toast } from '@components/foundation/NotificationProvider'
import { useElevatedToastLayer } from '@components/foundation/toastLayerStore'

interface HubCommand {
  id: string
  label: string
  description?: string
  icon: typeof Search
  category: string
  action: () => void
  shortcut?: string
  scenarioScope?: string[]
  frequency?: number
}

interface CommandHubProps {
  onClose: () => void
  onShowKeyboardShortcuts: () => void
}

const RECENT_KEY = 'command_hub_recent'

function loadRecentCommands(): string[] {
  return StorageService.get<string[]>(RECENT_KEY) || []
}

function saveRecentCommand(id: string) {
  const recent = loadRecentCommands().filter(r => r !== id)
  recent.unshift(id)
  StorageService.set(RECENT_KEY, recent.slice(0, 10))
}

const HubCommandRow = memo(function HubCommandRow({
  command,
  isSelected,
  onSelect,
}: {
  command: HubCommand
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-150 mx-2 rounded-lg group
        ${isSelected
          ? 'bg-accent/10 text-text-primary ring-1 ring-accent/20'
          : 'text-text-secondary hover:bg-surface-hover'}
      `}
    >
      <div className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${isSelected ? 'bg-accent/15 text-accent' : 'bg-surface/40 text-text-muted group-hover:text-text-primary'}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={`text-[13px] font-medium transition-colors leading-tight ${isSelected ? 'text-text-primary' : ''}`}>{command.label}</div>
        {command.description && (
          <div className={`text-[11px] truncate transition-opacity leading-tight mt-0.5 ${isSelected ? 'text-text-secondary opacity-80' : 'text-text-muted opacity-50'}`}>{command.description}</div>
        )}
      </div>

      {command.scenarioScope && command.scenarioScope.length > 0 && (
        <div className="flex-shrink-0 flex gap-1">
          {command.scenarioScope.slice(0, 2).map(s => (
            <span key={s} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/5 text-accent/60 border border-accent/10">{s}</span>
          ))}
        </div>
      )}

      {command.shortcut && (
        <kbd className={`
          px-2 py-0.5 text-[10px] font-mono rounded border relative z-10 transition-colors flex-shrink-0
          ${isSelected
            ? 'bg-background/50 border-accent/25 text-accent'
            : 'bg-surface border-border text-text-muted'}
        `}>
          {command.shortcut}
        </kbd>
      )}

      {isSelected && !command.shortcut && (
        <div className="flex-shrink-0 text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity">
          ⏎
        </div>
      )}
    </div>
  )
})

export default function CommandHub({ onClose, onShowKeyboardShortcuts }: CommandHubProps) {
  useElevatedToastLayer(true)
  const {
    setShowSettingsPage,
    setTerminalVisible,
    terminalVisible,
    workspacePath,
    activeFilePath,
    language,
    setShowQuickOpen,
    setShowWorkflow,
    setShowAbout,
    chatVisible,
    setChatVisible,
  } = useStore(useShallow(s => ({
    setShowSettingsPage: s.setShowSettingsPage,
    setTerminalVisible: s.setTerminalVisible,
    terminalVisible: s.terminalVisible,
    workspacePath: s.workspacePath,
    activeFilePath: s.activeFilePath,
    language: s.language,
    setShowQuickOpen: s.setShowQuickOpen,
    setShowWorkflow: s.setShowWorkflow,
    setShowAbout: s.setShowAbout,
    chatVisible: s.chatVisible,
    setChatVisible: s.setChatVisible,
  })))

  const setInputPrompt = useAgentStore(state => state.setInputPrompt)
  const setMode = useModeStore(s => s.setMode)
  const { clearMessages, clearCheckpoints } = useAgentHistoryActions()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const recentIds = useRef(loadRecentCommands())

  const commands: HubCommand[] = [
    {
      id: 'ai-chat',
      label: 'Ask AI...',
      description: 'Start a new chat conversation',
      icon: Sparkles,
      category: 'AI',
      action: () => { setChatVisible(true); setMode('chat'); if (query) setInputPrompt(query) },
      frequency: 10,
    },
    {
      id: 'ai-explain',
      label: 'Explain Current File',
      description: 'Ask AI to explain the active file',
      icon: MessageSquare,
      category: 'AI',
      scenarioScope: ['code'],
      action: () => { if (activeFilePath) { setChatVisible(true); setMode('chat'); setInputPrompt(`Explain the file ${activeFilePath} in detail.`) } },
      frequency: 7,
    },
    {
      id: 'ai-refactor',
      label: 'Refactor File',
      description: 'Ask AI to suggest refactoring improvements',
      icon: Zap,
      category: 'AI',
      scenarioScope: ['code'],
      action: () => { if (activeFilePath) { setChatVisible(true); setMode('chat'); setInputPrompt(`Analyze ${activeFilePath} and suggest refactoring improvements.`) } },
      frequency: 5,
    },
    {
      id: 'ai-fix',
      label: 'Fix Bugs',
      description: 'Ask AI to find and fix bugs in current file',
      icon: Shield,
      category: 'AI',
      scenarioScope: ['code'],
      action: () => { if (activeFilePath) { setChatVisible(true); setMode('chat'); setInputPrompt(`Find potential bugs in ${activeFilePath} and provide fixes.`) } },
      frequency: 6,
    },
    {
      id: 'ai-legal-review',
      label: 'Legal Document Review',
      description: 'AI-powered contract and legal document analysis',
      icon: BookOpen,
      category: 'AI',
      scenarioScope: ['legal'],
      action: () => { setChatVisible(true); setMode('chat'); setInputPrompt('Review this legal document for potential issues, compliance gaps, and risk areas.') },
      frequency: 3,
    },
    {
      id: 'ai-medical-check',
      label: 'Medical Safety Check',
      description: 'Verify medical content accuracy and safety',
      icon: Shield,
      category: 'AI',
      scenarioScope: ['medical'],
      action: () => { setChatVisible(true); setMode('chat'); setInputPrompt('Perform a medical safety and accuracy check on this content.') },
      frequency: 2,
    },
    {
      id: 'open-folder',
      label: 'Open Folder',
      description: 'Open a workspace folder',
      icon: FolderOpen,
      category: 'File',
      action: () => api.file.openFolder(),
      shortcut: formatShortcut('Ctrl+O'),
    },
    {
      id: 'new-window',
      label: 'New Window',
      description: 'Open a new application window',
      icon: Plus,
      category: 'Window',
      action: () => api.window.new(),
      shortcut: formatShortcut('Ctrl+Shift+N'),
    },
    {
      id: 'add-folder',
      label: 'Add Folder to Workspace...',
      description: 'Add a new root folder to the current workspace',
      icon: FolderPlus,
      category: 'Workspace',
      action: async () => {
        const path = await api.workspace.addFolder()
        if (path) {
          const { addRoot } = useStore.getState()
          addRoot(path)
          await aweeclawDir.initialize(path)
          toast.success(`Added ${path} to workspace`)
        }
      },
    },
    {
      id: 'save-workspace',
      label: 'Save Workspace As...',
      description: 'Save the current multi-root workspace configuration',
      icon: Save,
      category: 'Workspace',
      action: async () => {
        const { workspace } = useStore.getState()
        if (workspace) {
          const success = await api.workspace.save(workspace.configPath || '', workspace.roots)
          if (success) toast.success('Workspace saved')
        }
      },
    },
    {
      id: 'save-file',
      label: 'Save File',
      description: 'Save the current file',
      icon: Save,
      category: 'File',
      action: () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: !isMac, metaKey: isMac })) },
      shortcut: formatShortcut('Ctrl+S'),
    },
    {
      id: 'refresh-files',
      label: 'Refresh File Explorer',
      description: 'Reload the file tree',
      icon: RefreshCw,
      category: 'File',
      action: async () => { if (workspacePath) { const files = await api.file.readDir(workspacePath); if (files) useStore.getState().setFiles(files) } },
    },
    {
      id: 'quick-open',
      label: 'Go to File...',
      description: 'Search and open files by name',
      icon: Search,
      category: 'Navigation',
      action: () => setShowQuickOpen(true),
      shortcut: formatShortcut('Ctrl+P'),
    },
    {
      id: 'toggle-terminal',
      label: terminalVisible ? 'Hide Terminal' : 'Show Terminal',
      description: 'Toggle the terminal panel',
      icon: Terminal,
      category: 'View',
      action: () => setTerminalVisible(!terminalVisible),
      shortcut: formatShortcut('Ctrl+`'),
    },
    {
      id: 'toggle-ai-panel',
      label: chatVisible ? 'Hide AI Panel' : 'Show AI Panel',
      description: 'Toggle the AI assistant panel',
      icon: PanelRight,
      category: 'View',
      action: () => setChatVisible(!chatVisible),
      shortcut: formatShortcut('Ctrl+L'),
    },
    {
      id: 'open-workflow',
      label: 'Open Workflow',
      description: 'Multi-agent collaboration workflow',
      icon: Layers,
      category: 'AI',
      action: () => setShowWorkflow(true),
      shortcut: formatShortcut('Ctrl+Shift+I'),
    },
    {
      id: 'settings',
      label: 'Open Settings',
      description: 'Configure API keys and preferences',
      icon: Settings,
      category: 'Preferences',
      action: () => setShowSettingsPage(true),
      shortcut: formatShortcut('Ctrl+,'),
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all keyboard shortcuts',
      icon: Keyboard,
      category: 'Help',
      action: () => onShowKeyboardShortcuts(),
      shortcut: '?',
    },
    {
      id: 'about',
      label: 'About AweeClaw',
      description: 'View application information',
      icon: MessageSquare,
      category: 'Help',
      action: () => setShowAbout(true),
    },
    {
      id: 'clear-chat',
      label: 'Clear Chat History',
      description: 'Remove all messages from the chat',
      icon: Trash2,
      category: 'Maintenance',
      action: () => clearMessages(),
    },
    {
      id: 'clear-checkpoints',
      label: 'Clear All Checkpoints',
      description: 'Remove all saved checkpoints',
      icon: History,
      category: 'Maintenance',
      action: () => clearCheckpoints(),
    },
  ]

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'recent', label: 'Recent', icon: Clock },
    { id: 'AI', label: 'AI' },
    { id: 'File', label: 'File' },
    { id: 'View', label: 'View' },
  ]

  const filteredCommands = commands.filter(cmd => {
    if (activeFilter === 'recent') return recentIds.current.includes(cmd.id)
    if (activeFilter !== 'all') return cmd.category === activeFilter
    if (!query) return true
    const searchStr = `${cmd.label} ${cmd.description || ''} ${cmd.category}`.toLowerCase()
    return searchStr.includes(query.toLowerCase())
  })

  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = []
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, HubCommand[]>)

  const flatCommands = Object.values(groupedCommands).flat()

  const executeCommand = useCallback((cmd: HubCommand) => {
    saveRecentCommand(cmd.id)
    cmd.action()
    onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e, 'list.focusDown')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, flatCommands.length - 1))
    } else if (keybindingService.matches(e, 'list.focusUp')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (keybindingService.matches(e, 'list.select')) {
      e.preventDefault()
      if (flatCommands[selectedIndex]) executeCommand(flatCommands[selectedIndex])
    } else if (keybindingService.matches(e, 'list.cancel')) {
      e.preventDefault()
      onClose()
    }
  }, [flatCommands, selectedIndex, onClose, executeCommand])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelectedIndex(0) }, [query, activeFilter])
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  let commandIndex = 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] animate-fade-in" onClick={onClose}>
      <div className="fixed inset-0 bg-background/20 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-[680px] max-h-[65vh] flex flex-col bg-background/85 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden animate-scale-in ring-1 ring-text-primary/5 origin-top"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40 shrink-0">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommandOrSearch', language)}
            className="flex-1 bg-transparent text-lg font-medium text-text-primary placeholder:text-text-muted/70 focus:outline-none"
            spellCheck={false}
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-1 rounded-full hover:bg-surface-hover transition-colors">
              <X className="w-4 h-4 text-text-muted" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 px-4 py-2 border-b border-border/30 bg-surface/20">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold transition-all ${activeFilter === f.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-white/5'}`}
            >
              {f.icon && <f.icon className="w-3 h-3" />}
              {f.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-2 custom-scrollbar scroll-p-2">
          {activeFilter === 'recent' && recentIds.current.length === 0 && (
            <div className="px-4 py-10 text-center text-text-muted flex flex-col items-center gap-3 opacity-50">
              <Clock className="w-8 h-8" />
              <p className="text-sm font-medium">{t('modals.norecentcommandsyet', language as Language)}</p>
            </div>
          )}
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category} className="mb-1.5">
              <div className="px-5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-text-muted/50 sticky top-0 bg-background/95 backdrop-blur-md z-10">
                {category}
              </div>
              <div className="space-y-0.5 px-1">
                {cmds.map((cmd) => {
                  const idx = commandIndex++
                  return (
                    <div key={cmd.id} data-index={idx}>
                      <HubCommandRow
                        command={cmd}
                        isSelected={idx === selectedIndex}
                        onSelect={() => executeCommand(cmd)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {flatCommands.length === 0 && activeFilter !== 'recent' && (
            <div className="px-4 py-14 text-center text-text-muted flex flex-col items-center gap-3 opacity-50">
              <div className="w-14 h-14 rounded-full bg-surface/50 flex items-center justify-center border border-border">
                <Sparkles className="w-7 h-7 opacity-40 text-accent" />
              </div>
              <p className="text-sm font-medium">{t('noCommandsFound', language)}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-2 bg-surface/25 border-t border-border/35 text-[10px] font-medium text-text-muted/70 flex justify-between items-center backdrop-blur-md shrink-0">
          <div className="flex gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1 py-0.5 rounded min-w-[14px] text-center text-[9px]">↑↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1.5 py-0.5 rounded text-[9px]">↵</kbd>
              <span>run</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1.5 py-0.5 rounded text-[9px]">esc</kbd>
              <span>close</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 opacity-40">
            <Sparkles className="w-3 h-3 text-accent" />
            <span className="font-bold tracking-wide">AweeClaw Hub</span>
          </div>
        </div>
      </div>
    </div>
  )
}
