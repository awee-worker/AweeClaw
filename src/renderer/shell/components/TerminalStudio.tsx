import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Maximize2,
  Minimize2,
  FolderOpen,
  FolderTree,
  HardDrive,
  LayoutPanelLeft,
  MessageSquare,
  Play,
  Plus,
  Search,
  Server,
  Settings2,
  Sparkles,
  Star,
  Terminal as TerminalIcon,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useResizePanel } from '@hooks/useResizePanel'
import { ActionButton, TextField } from '@/renderer/components/ui'
import { useAgentStore } from '../../intelligence'
import { terminalManager, type TerminalManagerState } from '@services/TerminalAdapter'
import { shellRegistryService, shellService } from '@/renderer/shell'
import type { AvailableShell, RemoteServerConfig, ShellLink, ShellPreset, ShellState } from '@/renderer/shell'
import { TerminalManagerDialog } from './TerminalManagerDialog'
import { RemoteExplorer } from './RemoteExplorer'
import { XTERM_STYLE, getTerminalTheme } from '@services/terminalThemeAdapter'
import { t, type Language } from '@renderer/i18n'

type Selection =
  | { kind: 'root'; root: string }
  | { kind: 'preset'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'session'; id: string }
  | null

type NavSectionKey = 'favorites' | 'roots' | 'presets' | 'links'

const INSPECTOR_WIDTH_KEY = 'aweeclaw.shellStudio.inspectorWidth'
const SHELL_STUDIO_FOCUS_KEY = 'aweeclaw.shellStudio.focusMode'
const SHELL_STUDIO_NAV_KEY = 'aweeclaw.shellStudio.navCollapsed'
const SHELL_STUDIO_NAV_WIDTH_KEY = 'aweeclaw.shellStudio.navWidth'
const DEFAULT_INSPECTOR_WIDTH = 320
const DEFAULT_NAV_WIDTH = 280

function formatTime(timestamp: number, language: Language) {
  return new Intl.DateTimeFormat(t('shell.enus', language as Language), {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 1000) return '0s'
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return remain > 0 ? `${minutes}m ${remain}s` : `${minutes}m`
}

function getCommandStatusMeta(session: TerminalManagerState['commandInfoByTerminal'][string]['current'] | TerminalManagerState['commandInfoByTerminal'][string]['last'], language: Language) {
  if (!session) {
    return {
      label: t('shell.idle', language as Language),
      tone: 'muted' as const,
      icon: null as React.ReactNode,
    }
  }

  switch (session.status) {
    case 'queued':
    case 'running':
      return {
        label: t('shell.running', language as Language),
        tone: 'accent' as const,
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      }
    case 'completed':
      return {
        label: t('shell.completed', language as Language),
        tone: 'success' as const,
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      }
    case 'detached':
      return {
        label: t('shell.detached', language as Language),
        tone: 'success' as const,
        icon: <Play className="h-3.5 w-3.5" />,
      }
    case 'timed_out':
      return {
        label: t('shell.timedout', language as Language),
        tone: 'warning' as const,
        icon: <Clock3 className="h-3.5 w-3.5" />,
      }
    case 'failed':
    case 'cancelled':
    case 'interrupted':
    case 'shell_exited':
      return {
        label: t('shell.endedwithissues', language as Language),
        tone: 'danger' as const,
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      }
    default:
      return {
        label: session.status,
        tone: 'muted' as const,
        icon: null,
      }
  }
}

function getToneClasses(tone: 'muted' | 'accent' | 'success' | 'warning' | 'danger') {
  switch (tone) {
    case 'accent':
      return 'text-accent bg-accent/10 border-accent/20'
    case 'success':
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    case 'warning':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    case 'danger':
      return 'text-orange-400 bg-orange-500/10 border-orange-500/20'
    default:
      return 'text-text-muted bg-background/60 border-border'
  }
}

function getSessionTabContent(session: TerminalManagerState['terminals'][number]) {
  const name = session.name.trim()
  const displayName = name && name !== 'Terminal' ? name : ''
  const fallbackLabel = session.cwd.split('/').filter(Boolean).pop() || name || 'Terminal'

  if (session.remoteHost) {
    if (displayName) {
      return {
        title: displayName,
        subtitle: session.remoteHost,
      }
    }

    return {
      title: session.remoteHost,
      subtitle: '',
    }
  }

  return {
    title: displayName || fallbackLabel,
    subtitle: '',
  }
}

export default function TerminalStudio() {
  const { workspace, workspacePath, currentTheme, language, setShowWorkflow } = useStore(useShallow(s => ({ workspace: s.workspace, workspacePath: s.workspacePath, currentTheme: s.currentTheme, language: s.language, setShowWorkflow: s.setShowWorkflow })))
  const setInputPrompt = useAgentStore((state) => state.setInputPrompt)
  const [query, setQuery] = useState('')
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([])
  const [shellState, setShellState] = useState<ShellState>(() => shellRegistryService.getState())
  const [managerState, setManagerState] = useState<TerminalManagerState>(() => terminalManager.getState())
  const [selection, setSelection] = useState<Selection>(null)
  const [showManager, setShowManager] = useState(false)
  const [managerInitialCreate, setManagerInitialCreate] = useState<'preset' | 'directory' | 'remote' | 'command' | undefined>(undefined)
  const [managerInitialEdit, setManagerInitialEdit] = useState<{ kind: 'preset' | 'link'; id: string } | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState<number>(() => {
    const raw = localStorage.getItem(INSPECTOR_WIDTH_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? parsed : DEFAULT_INSPECTOR_WIDTH
  })
  const [navWidth, setNavWidth] = useState<number>(() => {
    const raw = localStorage.getItem(SHELL_STUDIO_NAV_WIDTH_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? parsed : DEFAULT_NAV_WIDTH
  })
  const [focusMode, setFocusMode] = useState<boolean>(() => localStorage.getItem(SHELL_STUDIO_FOCUS_KEY) === '1')
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => localStorage.getItem(SHELL_STUDIO_NAV_KEY) === '1')
  const [showSftpPanel, setShowSftpPanel] = useState(false)
  const [sftpPanelServer, setSftpPanelServer] = useState<RemoteServerConfig | null>(null)
  const [sftpPanelLabel, setSftpPanelLabel] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<Record<NavSectionKey, boolean>>({
    favorites: false,
    roots: false,
    presets: false,
    links: false,
  })
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)

  const roots = useMemo(() => (workspace?.roots || [workspacePath].filter(Boolean)) as string[], [workspace?.roots, workspacePath])
  const activeSession = useMemo(
    () => managerState.terminals.find((terminal) => terminal.id === managerState.activeId) || null,
    [managerState.activeId, managerState.terminals],
  )

  useEffect(() => {
    shellRegistryService.load().catch(() => {})
    const unsubscribeShell = shellRegistryService.subscribe(setShellState)
    const unsubscribeTerminal = terminalManager.subscribe(setManagerState)
    shellService.getAvailableShells().then(setAvailableShells).catch(() => setAvailableShells([]))
    return () => {
      unsubscribeShell()
      unsubscribeTerminal()
    }
  }, [])

  useEffect(() => {
    terminalManager.setTheme(getTerminalTheme(currentTheme))
  }, [currentTheme])

  useEffect(() => {
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth))
  }, [inspectorWidth])

  useEffect(() => {
    localStorage.setItem(SHELL_STUDIO_NAV_WIDTH_KEY, String(navWidth))
  }, [navWidth])

  useEffect(() => {
    localStorage.setItem(SHELL_STUDIO_FOCUS_KEY, focusMode ? '1' : '0')
  }, [focusMode])

  useEffect(() => {
    localStorage.setItem(SHELL_STUDIO_NAV_KEY, navCollapsed ? '1' : '0')
  }, [navCollapsed])

  useEffect(() => {
    if (!selection && activeSession) {
      setSelection({ kind: 'session', id: activeSession.id })
    }
  }, [activeSession, selection])

  useEffect(() => {
    if (!selection) return

    if (selection.kind === 'preset' && !shellState.presets.some((item) => item.id === selection.id)) {
      setSelection(null)
      return
    }

    if (selection.kind === 'link' && !shellState.links.some((item) => item.id === selection.id)) {
      setSelection(null)
      return
    }

    if (selection.kind === 'session' && !managerState.terminals.some((item) => item.id === selection.id)) {
      setSelection(activeSession ? { kind: 'session', id: activeSession.id } : null)
    }
  }, [activeSession, managerState.terminals, selection, shellState.links, shellState.presets])

  useEffect(() => {
    const container = terminalContainerRef.current
    if (!container || !activeSession) return

    terminalManager.mountTerminal(activeSession.id, container)
    const fitIfVisible = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        terminalManager.fitTerminal(activeSession.id)
      }
    }
    const frame = window.requestAnimationFrame(fitIfVisible)
    const observer = new ResizeObserver(fitIfVisible)
    observer.observe(container)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      terminalManager.unmountTerminal(activeSession.id)
    }
  }, [activeSession])

  const createTerminalAtRoot = useCallback(async (cwd?: string) => {
    const targetCwd = cwd || roots[0]
    if (!targetCwd) return

    const fallback = shellService.resolveDefaultShell({
      availableShells,
      defaultShell: shellState.defaultShell,
      selectedRoot: targetCwd,
      workspaceRoots: roots,
    })

    const terminalId = await terminalManager.createTerminal({
      name: targetCwd.split('/').filter(Boolean).pop() || 'Terminal',
      cwd: targetCwd,
      shell: fallback.shell,
    })

    setSelection({ kind: 'session', id: terminalId })
  }, [availableShells, roots, shellState.defaultShell])

  const openPreset = useCallback(async (preset: ShellPreset) => {
    const terminalId = await shellService.openPreset(preset, {
      availableShells,
      defaultShell: shellState.defaultShell,
      selectedRoot: roots[0],
      workspaceRoots: roots,
    })
    if (terminalId) setSelection({ kind: 'session', id: terminalId })
  }, [availableShells, roots, shellState.defaultShell])

  const openLink = useCallback(async (link: ShellLink) => {
    const terminalId = await shellService.openLink(link, {
      availableShells,
      defaultShell: shellState.defaultShell,
      selectedRoot: roots[0],
      workspaceRoots: roots,
    })
    if (terminalId) setSelection({ kind: 'session', id: terminalId })
  }, [availableShells, roots, shellState.defaultShell])

  const openManagerCreate = useCallback((type: 'preset' | 'directory' | 'remote' | 'command') => {
    setManagerInitialEdit(null)
    setManagerInitialCreate(type)
    setShowManager(true)
  }, [])

  const openManagerEdit = useCallback((kind: 'preset' | 'link', id: string) => {
    setManagerInitialCreate(undefined)
    setManagerInitialEdit({ kind, id })
    setShowManager(true)
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const matchQuery = useCallback((value: string) => value.toLowerCase().includes(normalizedQuery), [normalizedQuery])

  const favoriteItems = useMemo(() => {
    const presets = shellState.presets.filter((item) => item.favorite).map((item) => ({ kind: 'preset' as const, id: item.id, name: item.name, subtitle: item.cwd || item.group || 'Preset', action: () => openPreset(item) }))
    const links = shellState.links.filter((item) => item.favorite).map((item) => ({ kind: 'link' as const, id: item.id, name: item.name, subtitle: item.target || item.group || item.type, action: () => openLink(item) }))
    return [...presets, ...links].filter((item) => !normalizedQuery || matchQuery(`${item.name} ${item.subtitle}`))
  }, [shellState.presets, shellState.links, normalizedQuery, matchQuery, openPreset, openLink])

  const filteredRoots = useMemo(() => roots.filter((root) => !normalizedQuery || matchQuery(root)), [roots, normalizedQuery, matchQuery])
  const filteredPresets = useMemo(() => shellState.presets.filter((item) => !normalizedQuery || matchQuery(`${item.name} ${item.cwd || ''} ${item.group || ''}`)), [shellState.presets, normalizedQuery, matchQuery])
  const filteredLinks = useMemo(() => shellState.links.filter((item) => !normalizedQuery || matchQuery(`${item.name} ${item.target} ${item.group || ''} ${item.type}`)), [shellState.links, normalizedQuery, matchQuery])
  const filteredSessions = useMemo(() => managerState.terminals.filter((item) => !normalizedQuery || matchQuery(`${item.name} ${item.cwd} ${item.shell}`)), [managerState.terminals, normalizedQuery, matchQuery])

  const selectedPreset = selection?.kind === 'preset' ? shellState.presets.find((item) => item.id === selection.id) || null : null
  const selectedLink = selection?.kind === 'link' ? shellState.links.find((item) => item.id === selection.id) || null : null
  const selectedSession = selection?.kind === 'session' ? managerState.terminals.find((item) => item.id === selection.id) || null : null
  const selectedRoot = selection?.kind === 'root' ? selection.root : null
  const activeBufferStats = activeSession ? terminalManager.getBufferStats(activeSession.id) : null
  const terminalPreview = useMemo(
    () => (activeSession ? terminalManager.getOutputPreview(activeSession.id) : ''),
    [activeSession?.id, managerState.commandInfoByTerminal, managerState.activeId],
  )

  const { startResize: startNavResize } = useResizePanel({
    direction: 'left',
    minSize: 220,
    maxSize: 420,
    onResizeEnd: setNavWidth,
    panelRef: navRef,
  })

  const { startResize: startInspectorResize } = useResizePanel({
    direction: 'right',
    minSize: 260,
    maxSize: 560,
    onResizeEnd: setInspectorWidth,
    panelRef: inspectorRef,
  })

  const toggleSection = useCallback((key: NavSectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const copyTerminalOutput = useCallback(async () => {
    if (!terminalPreview) return
    await navigator.clipboard.writeText(terminalPreview)
  }, [terminalPreview])

  const sendTerminalOutputToAi = useCallback(() => {
    if (!terminalPreview) return
    setInputPrompt(`${t('shell.pleaseanalyzethefollowingterminal', language as Language)}\n\n\`\`\`\n${terminalPreview}\n\`\`\``)
    setShowWorkflow(true)
  }, [language, setInputPrompt, setShowWorkflow, terminalPreview])

  const fitActiveTerminalIfVisible = useCallback(() => {
    if (activeSession?.id && terminalContainerRef.current && terminalContainerRef.current.clientWidth > 0 && terminalContainerRef.current.clientHeight > 0) {
      terminalManager.fitTerminal(activeSession.id)
    }
  }, [activeSession?.id])

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev)
    window.requestAnimationFrame(fitActiveTerminalIfVisible)
  }, [fitActiveTerminalIfVisible])

  const toggleNavCollapsed = useCallback(() => {
    setNavCollapsed((prev) => !prev)
    window.requestAnimationFrame(fitActiveTerminalIfVisible)
  }, [fitActiveTerminalIfVisible])

  const resetNavWidth = useCallback(() => {
    setNavWidth(DEFAULT_NAV_WIDTH)
    if (navRef.current) {
      navRef.current.style.width = `${DEFAULT_NAV_WIDTH}px`
    }
    window.requestAnimationFrame(fitActiveTerminalIfVisible)
  }, [fitActiveTerminalIfVisible])

  const resetInspectorWidth = useCallback(() => {
    setInspectorWidth(DEFAULT_INSPECTOR_WIDTH)
    if (inspectorRef.current) {
      inspectorRef.current.style.width = `${DEFAULT_INSPECTOR_WIDTH}px`
    }
    window.requestAnimationFrame(fitActiveTerminalIfVisible)
  }, [fitActiveTerminalIfVisible])

  const openSftpPanel = useCallback((server: RemoteServerConfig, label: string) => {
    setSftpPanelServer(server)
    setSftpPanelLabel(label)
    setShowSftpPanel(true)
  }, [])

  const closeSftpPanel = useCallback(() => {
    setShowSftpPanel(false)
  }, [])

  const renderSectionHeader = (key: NavSectionKey, icon: React.ReactNode, label: string, count?: number) => (
    <button
      onClick={() => toggleSection(key)}
      className="mb-2 flex w-full items-center justify-between gap-2 px-1 text-[12px] uppercase tracking-[0.18em] text-text-muted"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
        {typeof count === 'number' && <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[11px] normal-case tracking-normal">{count}</span>}
      </span>
      {collapsedSections[key] ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
  )

  const renderNavButton = (content: {
    key: string
    icon: React.ReactNode
    title: string
    subtitle?: string
    active?: boolean
    onClick: () => void
    trailing?: React.ReactNode
  }) => (
    <div
      key={content.key}
      className={`flex items-start gap-2 rounded-2xl border px-3 py-3 transition-all ${content.active ? 'border-accent/40 bg-accent/10 shadow-[0_0_0_1px_rgba(var(--accent),0.15)]' : 'border-border bg-surface/40 hover:border-border-active hover:bg-surface/80'}`}
    >
      <button onClick={content.onClick} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${content.active ? 'bg-accent/15 text-accent' : 'bg-white/5 text-text-muted'}`}>
          {content.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text-primary">{content.title}</div>
          {content.subtitle && <div className="mt-1 truncate text-xs text-text-muted">{content.subtitle}</div>}
        </div>
      </button>
      {content.trailing && <div className="flex-shrink-0">{content.trailing}</div>}
    </div>
  )

  return (
    <div className="h-full min-h-0 bg-background">
      <style>{XTERM_STYLE}</style>
      <div className="h-full min-h-0 p-4 md:p-5">
        <div className="h-full min-h-0 rounded-[28px] border border-border bg-background-secondary overflow-hidden">
          <div className="flex h-16 items-center justify-between border-b border-border px-5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                <LayoutPanelLeft className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">{t('shell.shellstudio', language as Language)}</div>
                <div className="truncate text-xs text-text-muted">{t('shell.unifiedshelllaunchsessionsand', language as Language)}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!focusMode && (
                <ActionButton variant="ghost" size="icon" onClick={toggleNavCollapsed} title={navCollapsed ? (t('shell.expandnavigation', language as Language)) : (t('shell.collapsenavigation', language as Language))}>
                  {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </ActionButton>
              )}
              <ActionButton variant="ghost" size="icon" onClick={toggleFocusMode} title={focusMode ? (t('shell.exitfocusmode', language as Language)) : (t('shell.maximizeterminal', language as Language))}>
                {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </ActionButton>
              <ActionButton variant="ghost" size="sm" onClick={() => openManagerCreate('preset')} leftIcon={<Star className="h-4 w-4" />}>
                {t('shell.newpreset', language as Language)}
              </ActionButton>
              <ActionButton variant="primary" size="sm" onClick={() => createTerminalAtRoot()} leftIcon={<Plus className="h-4 w-4" />}>
                {t('shell.newterminal', language as Language)}
              </ActionButton>
            </div>
          </div>

          <div className="flex h-[calc(100%-4rem)] min-h-0">
            {!focusMode && !navCollapsed && <div ref={navRef} style={{ width: navWidth }} className="min-h-0 flex-shrink-0 border-r border-border bg-background/40 p-4">
              <TextField
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('shell.searchrootspresetslinksand', language as Language)}
                leftIcon={<Search className="h-4 w-4" />}
              />

              <div className="mt-4 h-[calc(100%-3rem)] space-y-5 overflow-y-auto pr-1">
                {favoriteItems.length > 0 && (
                  <section>
                    {renderSectionHeader('favorites', <Sparkles className="h-3.5 w-3.5" />, t('shell.favorites', language as Language), favoriteItems.length)}
                    {!collapsedSections.favorites && (
                      <div className="space-y-2">
                        {favoriteItems.map((item) => renderNavButton({
                          key: `${item.kind}-${item.id}`,
                          icon: item.kind === 'preset' ? <Star className="h-4 w-4" /> : <TerminalIcon className="h-4 w-4" />,
                          title: item.name,
                          subtitle: item.subtitle,
                          active: selection?.kind === item.kind && selection.id === item.id,
                          onClick: () => setSelection({ kind: item.kind, id: item.id } as Selection),
                          trailing: (
                            <button
                              onClick={(event) => { event.stopPropagation(); item.action() }}
                              className="rounded-lg p-1 text-text-muted hover:bg-white/5 hover:text-text-primary"
                              title={t('shell.launch', language as Language)}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          ),
                        }))}
                      </div>
                    )}
                  </section>
                )}

                <section>
                  {renderSectionHeader('roots', <FolderTree className="h-3.5 w-3.5" />, t('shell.workspaceroots', language as Language), filteredRoots.length)}
                  {!collapsedSections.roots && (
                    <div className="space-y-2">
                      {filteredRoots.map((root) => renderNavButton({
                        key: root,
                        icon: <FolderOpen className="h-4 w-4" />,
                        title: root.split('/').filter(Boolean).pop() || root,
                        subtitle: root,
                        active: selection?.kind === 'root' && selection.root === root,
                        onClick: () => setSelection({ kind: 'root', root }),
                        trailing: (
                          <button
                            onClick={(event) => { event.stopPropagation(); createTerminalAtRoot(root) }}
                            className="rounded-lg p-1 text-text-muted hover:bg-white/5 hover:text-text-primary"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        ),
                      }))}
                    </div>
                  )}
                </section>

                <section>
                  {renderSectionHeader('presets', <Star className="h-3.5 w-3.5" />, 'Presets', filteredPresets.length)}
                  {!collapsedSections.presets && (
                    <div className="space-y-2">
                      {filteredPresets.map((preset) => renderNavButton({
                        key: preset.id,
                        icon: <TerminalIcon className="h-4 w-4" />,
                        title: preset.name,
                        subtitle: preset.cwd || preset.group || (t('shell.reusablelaunchpreset', language as Language)),
                        active: selection?.kind === 'preset' && selection.id === preset.id,
                        onClick: () => setSelection({ kind: 'preset', id: preset.id }),
                        trailing: (
                          <button
                            onClick={(event) => { event.stopPropagation(); openPreset(preset) }}
                            className="rounded-lg p-1 text-text-muted hover:bg-white/5 hover:text-text-primary"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        ),
                      }))}
                    </div>
                  )}
                </section>

                <section>
                  {renderSectionHeader('links', <HardDrive className="h-3.5 w-3.5" />, t('shell.linkscommands', language as Language), filteredLinks.length)}
                  {!collapsedSections.links && (
                    <div className="space-y-2">
                      {filteredLinks.map((link) => renderNavButton({
                        key: link.id,
                        icon: link.type === 'remote' ? <Server className="h-4 w-4" /> : <TerminalIcon className="h-4 w-4" />,
                        title: link.name,
                        subtitle: link.target || link.group || link.type,
                        active: selection?.kind === 'link' && selection.id === link.id,
                        onClick: () => setSelection({ kind: 'link', id: link.id }),
                        trailing: (
                          <button
                            onClick={(event) => { event.stopPropagation(); openLink(link) }}
                            className="rounded-lg p-1 text-text-muted hover:bg-white/5 hover:text-text-primary"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        ),
                      }))}
                    </div>
                  )}
                </section>
              </div>
            </div>}

            {!focusMode && !navCollapsed && (
              <div
                className="w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/30 active:bg-accent"
                onMouseDown={startNavResize}
                onDoubleClick={resetNavWidth}
                title={t('shell.dragtoresizenavigationdouble', language as Language)}
              />
            )}

            <div className="min-h-0 min-w-0 flex-1 bg-background px-4 py-4">
              <div className="flex h-full min-h-0 flex-col gap-4">
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-border bg-surface/40 p-3">
                    <div className="text-xs text-text-muted">{t('shell.activesessions', language as Language)}</div>
                    <div className="mt-2 text-2xl font-semibold text-text-primary">{managerState.terminals.length}</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface/40 p-3">
                    <div className="text-xs text-text-muted">Presets</div>
                    <div className="mt-2 text-2xl font-semibold text-text-primary">{shellState.presets.length}</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface/40 p-3">
                    <div className="text-xs text-text-muted">{t('shell.links', language as Language)}</div>
                    <div className="mt-2 text-2xl font-semibold text-text-primary">{shellState.links.length}</div>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface/40 p-3">
                    <div className="text-xs text-text-muted">{t('shell.bufferedoutput', language as Language)}</div>
                    <div className="mt-2 text-2xl font-semibold text-text-primary">{activeBufferStats?.lines || 0}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {filteredSessions.map((session) => {
                    const active = session.id === managerState.activeId
                    const sessionContent = getSessionTabContent(session)
                    const commandInfo = managerState.commandInfoByTerminal[session.id]
                    const commandSession = commandInfo?.current || commandInfo?.last || null
                    const commandStatus = getCommandStatusMeta(commandSession, language)
                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            terminalManager.setActiveTerminal(session.id)
                            setSelection({ kind: 'session', id: session.id })
                          }
                        }}
                        onClick={() => {
                          terminalManager.setActiveTerminal(session.id)
                          setSelection({ kind: 'session', id: session.id })
                        }}
                        title={sessionContent.subtitle ? `${sessionContent.title}\n${sessionContent.subtitle}` : sessionContent.title}
                        className={`group cursor-pointer min-w-[120px] max-w-[220px] rounded-2xl border px-3 py-2 text-left transition-all ${active ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface/30 hover:border-border-active hover:bg-surface/70'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-text-primary">{sessionContent.title}</div>
                            {sessionContent.subtitle && (
                              <div className="mt-0.5 truncate text-xs text-text-muted">{sessionContent.subtitle}</div>
                            )}
                            {commandSession && (
                              <div className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${getToneClasses(commandStatus.tone)}`}>
                                {commandStatus.icon}
                                <span>{commandStatus.label}</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              terminalManager.closeTerminal(session.id)
                            }}
                            className="rounded-md p-1 text-text-muted opacity-0 transition-opacity hover:bg-white/5 hover:text-text-primary group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex flex-1 min-h-0 flex-col rounded-[24px] border border-border bg-background overflow-hidden">
                  <div className="shrink-0 border-b border-border px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <TerminalIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {activeSession?.name || (t('shell.noactiveterminal', language as Language))}
                          </div>
                          {activeSession && (
                            <div
                              className="mt-1 overflow-x-auto whitespace-nowrap text-xs text-text-muted [scrollbar-width:thin]"
                              title={activeSession.cwd}
                            >
                              {activeSession.cwd}
                            </div>
                          )}
                          {activeSession && (() => {
                            const commandInfo = managerState.commandInfoByTerminal[activeSession.id]
                            const commandSession = commandInfo?.current || commandInfo?.last || null
                            const commandStatus = getCommandStatusMeta(commandSession, language)
                            return commandSession ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${getToneClasses(commandStatus.tone)}`}>
                                  {commandStatus.icon}
                                  {commandStatus.label}
                                </span>
                                <span className="truncate text-text-muted max-w-[460px]" title={commandSession.command}>
                                  {commandSession.command}
                                </span>
                              </div>
                            ) : null
                          })()}
                        </div>
                      </div>
                      {activeSession && (
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {activeSession.remote && (
                            <ActionButton
                              variant="ghost"
                              size="sm"
                              onClick={() => openSftpPanel(activeSession.remote!, activeSession.name)}
                              leftIcon={<Server className="h-4 w-4" />}
                              title={t('shell.opensftppanel', language as Language)}
                            >
                              SFTP
                            </ActionButton>
                          )}
                          <ActionButton variant="ghost" size="icon" onClick={copyTerminalOutput} title={t('shell.copyoutput', language as Language)}>
                            <Copy className="h-4 w-4" />
                          </ActionButton>
                          <ActionButton variant="ghost" size="icon" onClick={sendTerminalOutputToAi} title={t('shell.sendtoai', language as Language)}>
                            <MessageSquare className="h-4 w-4" />
                          </ActionButton>
                          {!focusMode && (
                            <ActionButton variant="ghost" size="icon" onClick={toggleNavCollapsed} title={navCollapsed ? (t('shell.expandnavigation2', language as Language)) : (t('shell.collapsenavigation2', language as Language))}>
                              {navCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                            </ActionButton>
                          )}
                          <ActionButton variant="ghost" size="icon" onClick={toggleFocusMode} title={focusMode ? (t('shell.exitfocusmode2', language as Language)) : (t('shell.maximizeterminal2', language as Language))}>
                            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                          </ActionButton>
                        </div>
                      )}
                    </div>
                  </div>
                  {activeSession ? (
                    <div ref={terminalContainerRef} className="min-h-0 flex-1 w-full" />
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/10 text-accent">
                        <TerminalIcon className="h-8 w-8" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-text-primary">{t('shell.startyourfirstshellsession', language as Language)}</div>
                        <div className="mt-2 text-sm text-text-muted">{t('shell.launchdirectlyfromaworkspace', language as Language)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <ActionButton variant="primary" size="sm" onClick={() => createTerminalAtRoot()} leftIcon={<Plus className="h-4 w-4" />}>
                          {t('shell.newterminal2', language as Language)}
                        </ActionButton>
                        <ActionButton variant="outline" size="sm" onClick={() => openManagerCreate('command')} leftIcon={<Sparkles className="h-4 w-4" />}>
                          {t('shell.createcommand', language as Language)}
                        </ActionButton>
                      </div>
                    </div>
                  )}
                </div>
                {showSftpPanel && sftpPanelServer && (
                  <div className="min-h-0 h-[360px] rounded-[24px] border border-border bg-background-secondary/55 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{t('shell.sftpfilepanel', language as Language)}</div>
                        <div className="truncate text-xs text-text-muted">
                          {sftpPanelLabel || (t('shell.remotefilebrowser', language as Language))}
                        </div>
                      </div>
                      <ActionButton variant="ghost" size="sm" onClick={closeSftpPanel} leftIcon={<X className="h-4 w-4" />}>
                        {t('shell.close', language as Language)}
                      </ActionButton>
                    </div>
                    <div className="h-[calc(100%-57px)] p-4">
                      <RemoteExplorer server={sftpPanelServer} language={language} onClose={closeSftpPanel} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!focusMode && (
              <>
                <div
                  className="w-1 flex-shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/30 active:bg-accent"
                  onMouseDown={startInspectorResize}
                  onDoubleClick={resetInspectorWidth}
                  title={t('shell.dragtoresizedoubleclick', language as Language)}
                />
                <div ref={inspectorRef} style={{ width: inspectorWidth }} className="min-h-0 w-full max-w-full flex-shrink-0 overflow-hidden border-l border-border bg-background/30 p-4">
                  <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1">
                    <div className="rounded-2xl border border-border bg-surface/40 p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">{t('shell.inspector', language as Language)}</div>
                      <div className="mt-1 text-xs text-text-muted">{t('shell.inspectcontextandactionsfor', language as Language)}</div>
                    </div>
                    <ActionButton variant="ghost" size="icon" onClick={() => setShowManager(true)} title={t('shell.openmanager', language as Language)}>
                      <Settings2 className="h-4 w-4" />
                    </ActionButton>
                  </div>
                </div>

                {selectedSession && (
                  <>
                    <div className="rounded-2xl border border-border bg-surface/40 p-4 space-y-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-text-muted">{t('shell.session', language as Language)}</div>
                        <div className="mt-2 text-lg font-semibold text-text-primary">{selectedSession.name}</div>
                        <div className="mt-1 text-sm text-text-muted break-all">{selectedSession.cwd}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Shell</div><div className="mt-1 text-text-primary break-all">{selectedSession.shell || 'default'}</div></div>
                        <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">{t('shell.created', language as Language)}</div><div className="mt-1 text-text-primary">{formatTime(selectedSession.createdAt, language)}</div></div>
                        {selectedSession.remote && (
                          <div className="col-span-2 rounded-xl border border-border bg-background/60 p-3">
                            <div className="text-text-muted">{t('shell.remotehost', language as Language)}</div>
                            <div className="mt-1 text-text-primary break-all">
                              {selectedSession.remote.username ? `${selectedSession.remote.username}@` : ''}
                              {selectedSession.remote.host}
                              :{selectedSession.remote.port || 22}
                            </div>
                          </div>
                        )}
                      </div>
                      {(() => {
                        const commandInfo = managerState.commandInfoByTerminal[selectedSession.id]
                        const commandSession = commandInfo?.current || commandInfo?.last || null
                        const commandStatus = getCommandStatusMeta(commandSession, language)
                        return commandSession ? (
                          <div className="rounded-xl border border-border bg-background/60 p-3 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${getToneClasses(commandStatus.tone)}`}>
                                {commandStatus.icon}
                                {commandStatus.label}
                              </span>
                              <span className="text-xs text-text-muted">{commandSession.commandSessionId}</span>
                            </div>
                            <div className="text-sm text-text-primary break-all">{commandSession.command}</div>
                            <div className="grid grid-cols-2 gap-3 text-xs text-text-muted">
                              <div>Exit code: {commandSession.exitCode ?? '—'}</div>
                              <div>{t('shell.duration', language as Language)}: {formatDuration(commandSession.endedAt ? commandSession.endedAt - commandSession.startedAt : Date.now() - commandSession.startedAt)}</div>
                              <div>{t('shell.reason', language as Language)}: {commandSession.terminationReason || '—'}</div>
                              <div>Sentinel: {commandSession.sentinelMatched ? 'yes' : 'no'}</div>
                            </div>
                            {(commandSession.output || commandSession.partialOutput) && (
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-text-primary">{commandSession.output || commandSession.partialOutput}</pre>
                            )}
                          </div>
                        ) : null
                      })()}
                      <div className="rounded-xl border border-border bg-background/60 p-3">
                        <div className="text-text-muted text-sm">{t('shell.terminalsnippet', language as Language)}</div>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-text-primary">{terminalPreview || (t('shell.nooutputyet', language as Language))}</pre>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <ActionButton variant="outline" size="sm" onClick={() => terminalManager.setActiveTerminal(selectedSession.id)} leftIcon={<Play className="h-4 w-4" />}>
                          {t('shell.focus', language as Language)}
                        </ActionButton>
                        {selectedSession.remote && (
                          <ActionButton
                            variant="outline"
                            size="sm"
                            onClick={() => openSftpPanel(selectedSession.remote!, selectedSession.name)}
                            leftIcon={<Server className="h-4 w-4" />}
                          >
                            {t('shell.opensftp', language as Language)}
                          </ActionButton>
                        )}
                        <ActionButton variant="outline" size="sm" onClick={copyTerminalOutput} leftIcon={<Copy className="h-4 w-4" />}>
                          {t('shell.copyoutput2', language as Language)}
                        </ActionButton>
                        <ActionButton variant="outline" size="sm" onClick={sendTerminalOutputToAi} leftIcon={<MessageSquare className="h-4 w-4" />}>
                          {t('shell.askai', language as Language)}
                        </ActionButton>
                        <ActionButton variant="danger" size="sm" onClick={() => terminalManager.closeTerminal(selectedSession.id)} leftIcon={<X className="h-4 w-4" />}>
                          {t('shell.close2', language as Language)}
                        </ActionButton>
                      </div>
                    </div>
                  </>
                )}

                {selectedRoot && (
                  <div className="rounded-2xl border border-border bg-surface/40 p-4 space-y-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-text-muted">{t('shell.rootlaunch', language as Language)}</div>
                    <div className="text-lg font-semibold text-text-primary">{selectedRoot.split('/').filter(Boolean).pop() || selectedRoot}</div>
                    <div className="text-sm text-text-muted break-all">{selectedRoot}</div>
                    <ActionButton variant="primary" size="sm" onClick={() => createTerminalAtRoot(selectedRoot)} leftIcon={<Play className="h-4 w-4" />}>
                      {t('shell.launchhere', language as Language)}
                    </ActionButton>
                  </div>
                )}

                {selectedPreset && (
                  <div className="rounded-2xl border border-border bg-surface/40 p-4 space-y-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Preset</div>
                    <div className="text-lg font-semibold text-text-primary">{selectedPreset.name}</div>
                    <div className="grid gap-3 text-sm">
                      <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">CWD</div><div className="mt-1 text-text-primary break-all">{selectedPreset.cwd || roots[0] || '-'}</div></div>
                      <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Shell</div><div className="mt-1 text-text-primary break-all">{selectedPreset.shellPath || shellState.defaultShell || 'default'}</div></div>
                      <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Args</div><div className="mt-1 text-text-primary break-all">{selectedPreset.args?.join(' ') || '-'}</div></div>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton variant="primary" size="sm" onClick={() => openPreset(selectedPreset)} leftIcon={<Play className="h-4 w-4" />}>
                        {t('shell.runpreset', language as Language)}
                      </ActionButton>
                      <ActionButton variant="outline" size="sm" onClick={() => openManagerEdit('preset', selectedPreset.id)} leftIcon={<Settings2 className="h-4 w-4" />}>
                        {t('shell.edit', language as Language)}
                      </ActionButton>
                    </div>
                  </div>
                )}

                {selectedLink && (
                  <>
                    <div className="rounded-2xl border border-border bg-surface/40 p-4 space-y-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">{t('shell.link', language as Language)}</div>
                      <div className="flex items-center gap-2">
                        {selectedLink.type === 'remote' ? <Server className="h-4 w-4 text-accent" /> : <TerminalIcon className="h-4 w-4 text-accent" />}
                        <div className="text-lg font-semibold text-text-primary">{selectedLink.name}</div>
                      </div>
                      <div className="grid gap-3 text-sm">
                        <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Type</div><div className="mt-1 text-text-primary">{selectedLink.type}</div></div>
                        <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Target</div><div className="mt-1 text-text-primary break-all">{selectedLink.target || '-'}</div></div>
                        <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">CWD</div><div className="mt-1 text-text-primary break-all">{selectedLink.cwd || roots[0] || '-'}</div></div>
                        {selectedLink.type === 'remote' && (
                          <div className="rounded-xl border border-border bg-background/60 p-3"><div className="text-text-muted">Auth</div><div className="mt-1 text-text-primary break-all">{selectedLink.remote?.privateKeyPath ? (t('shell.privatekey', language as Language)) : ''}{selectedLink.remote?.privateKeyPath && selectedLink.remote?.password ? ' + ' : ''}{selectedLink.remote?.password ? (t('shell.password', language as Language)) : (!selectedLink.remote?.privateKeyPath ? '-' : '')}</div></div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <ActionButton variant="primary" size="sm" onClick={() => openLink(selectedLink)} leftIcon={<Play className="h-4 w-4" />}>
                          {t('shell.openlink', language as Language)}
                        </ActionButton>
                        {selectedLink.type === 'remote' && selectedLink.remote && (
                          <ActionButton
                            variant="outline"
                            size="sm"
                            onClick={() => openSftpPanel(selectedLink.remote!, selectedLink.name)}
                            leftIcon={<Server className="h-4 w-4" />}
                          >
                            {t('shell.opensftp2', language as Language)}
                          </ActionButton>
                        )}
                        <ActionButton variant="outline" size="sm" onClick={() => openManagerEdit('link', selectedLink.id)} leftIcon={<Settings2 className="h-4 w-4" />}>
                          {t('shell.edit2', language as Language)}
                        </ActionButton>
                      </div>
                    </div>
                  </>
                )}

                <div className="rounded-2xl border border-border bg-surface/40 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-text-muted">{t('shell.quickcreate', language as Language)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <ActionButton variant="ghost" size="sm" onClick={() => openManagerCreate('preset')} leftIcon={<Star className="h-4 w-4" />}>Preset</ActionButton>
                    <ActionButton variant="ghost" size="sm" onClick={() => openManagerCreate('directory')} leftIcon={<FolderOpen className="h-4 w-4" />}>{t('shell.directory', language as Language)}</ActionButton>
                    <ActionButton variant="ghost" size="sm" onClick={() => openManagerCreate('remote')} leftIcon={<Server className="h-4 w-4" />}>{t('shell.remote', language as Language)}</ActionButton>
                    <ActionButton variant="ghost" size="sm" onClick={() => openManagerCreate('command')} leftIcon={<TerminalIcon className="h-4 w-4" />}>{t('shell.command', language as Language)}</ActionButton>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-surface/40 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-text-muted">
                    <Clock3 className="h-3.5 w-3.5" />
                    {t('shell.recentsessions', language as Language)}
                  </div>
                  <div className="space-y-2">
                    {managerState.terminals.slice(-4).reverse().map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          terminalManager.setActiveTerminal(session.id)
                          setSelection({ kind: 'session', id: session.id })
                        }}
                        className="w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-left hover:border-border-active hover:bg-background"
                      >
                        <div className="truncate text-sm font-medium text-text-primary">{session.name}</div>
                        <div className="mt-1 truncate text-xs text-text-muted">{session.cwd}</div>
                      </button>
                    ))}
                  </div>
                </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <TerminalManagerDialog
        isOpen={showManager}
        onClose={() => setShowManager(false)}
        availableShells={availableShells}
        presets={shellState.presets}
        links={shellState.links}
        defaultShell={shellState.defaultShell}
        initialCreate={managerInitialCreate}
        initialEdit={managerInitialEdit}
      />
    </div>
  )
}
