/**
 * 终端面板组件（作为 DockPanel 子组件）
 */

import { useEffect, useRef, useState, useCallback, memo } from 'react'
import { X, Terminal } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { terminalManager, TerminalManagerState } from '@services/TerminalAdapter'
import { XTERM_STYLE, getTerminalTheme } from '@services/terminalThemeAdapter'
import { t } from '@renderer/i18n'
import { formatShortcut } from '@services/keybindingAdapter'

const TerminalPanel = memo(function TerminalPanel() {
    const { workspace, currentTheme, setTerminalLayout, language } = useStore(useShallow(s => ({ workspace: s.workspace, currentTheme: s.currentTheme, setTerminalLayout: s.setTerminalLayout, language: s.language })))

    const [selectedRoot, setSelectedRoot] = useState<string>(() => workspace?.roots?.[0] || '')
    const [contextMenu, setContextMenu] = useState<{
        visible: boolean
        x: number
        y: number
        termId: string | null
    }>({
        visible: false,
        x: 0,
        y: 0,
        termId: null,
    })
    const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
    const contextMenuRef = useRef<HTMLDivElement>(null)

    const [managerState, setManagerState] = useState<TerminalManagerState>(() => terminalManager.getState())

    const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const mountedTerminals = useRef<Set<string>>(new Set())

    useEffect(() => {
        return terminalManager.subscribe(setManagerState)
    }, [])

    useEffect(() => {
        const theme = getTerminalTheme(currentTheme)
        terminalManager.setTheme(theme)
    }, [currentTheme])

    useEffect(() => {
        const timer = setTimeout(() => {
            for (const terminal of managerState.terminals) {
                const container = containerRefs.current.get(terminal.id)
                
                if (container && !mountedTerminals.current.has(terminal.id)) {
                    terminalManager.mountTerminal(terminal.id, container)
                    mountedTerminals.current.add(terminal.id)
                    
                    setTimeout(() => {
                        terminalManager.fitTerminal(terminal.id)
                    }, 100)
                }
            }

            for (const id of mountedTerminals.current) {
                if (!managerState.terminals.find(t => t.id === id)) {
                    terminalManager.unmountTerminal(id)
                    mountedTerminals.current.delete(id)
                }
            }
        }, 100)

        return () => clearTimeout(timer)
    }, [managerState.terminals.length, managerState.terminals.map(t => t.id).join(',')])

    useEffect(() => {
        return () => {
            for (const id of mountedTerminals.current) {
                terminalManager.unmountTerminal(id)
            }
            mountedTerminals.current.clear()
        }
    }, [])

    const lastProcessedRootRef = useRef<string | null>(null)
    useEffect(() => {
        const newRoot = workspace?.roots?.[0]
        if (!newRoot) return
        if (lastProcessedRootRef.current === null) {
            lastProcessedRootRef.current = newRoot
            if (newRoot !== selectedRoot) setSelectedRoot(newRoot)
            return
        }
        if (newRoot !== lastProcessedRootRef.current) {
            lastProcessedRootRef.current = newRoot
            setSelectedRoot(newRoot)
            const oldTerminals = managerState.terminals.filter(t => !workspace?.roots?.includes(t.cwd))
            oldTerminals.forEach(t => terminalManager.closeTerminal(t.id))
        }
    }, [workspace?.roots?.[0]])

    useEffect(() => {
        if (!selectedRoot && workspace?.roots?.[0]) {
            setSelectedRoot(workspace.roots[0])
        }
    }, [selectedRoot, workspace?.roots?.[0]])

    useEffect(() => {
        if (!workspace?.roots?.[0]) return

        const timer = setTimeout(() => {
            const liveState = terminalManager.getState()
            if (liveState.terminals.length === 0) {
                createTerminal()
            } else if (!liveState.activeId) {
                terminalManager.setActiveTerminal(liveState.terminals[0].id)
            }
        }, 200)

        return () => clearTimeout(timer)
    }, [workspace?.roots?.[0]])

    const closeTerminal = useCallback((id: string) => {
        terminalManager.closeTerminal(id)
        if (managerState.terminals.length <= 2) {
            setTerminalLayout('tabs')
        }
    }, [managerState.terminals.length, setTerminalLayout])

    useEffect(() => {
        if (!contextMenu.visible) return
        const handleClick = () => {
            setContextMenu(prev => ({ ...prev, visible: false }))
        }
        window.addEventListener('click', handleClick)
        return () => window.removeEventListener('click', handleClick)
    }, [contextMenu.visible])

    useEffect(() => {
        if (!contextMenu.visible || !contextMenuRef.current) {
            setContextMenuPos({ x: contextMenu.x, y: contextMenu.y })
            return
        }
        const rect = contextMenuRef.current.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        let ax = contextMenu.x
        let ay = contextMenu.y
        if (ax + rect.width > vw) ax = vw - rect.width - 8
        if (ay + rect.height > vh) {
            ay = contextMenu.y - rect.height
            if (ay < 8) ay = 8
        }
        setContextMenuPos({ x: Math.max(8, ax), y: Math.max(8, ay) })
    }, [contextMenu.visible, contextMenu.x, contextMenu.y])

    const createTerminal = useCallback(async (shellPath?: string, shellName?: string) => {
        const cwd = selectedRoot || workspace?.roots?.[0] || ''
        if (!cwd) return

        const terminalId = await terminalManager.createTerminal({
            name: shellName || 'Terminal',
            cwd,
            shell: shellPath,
        })
        setTimeout(() => {
            terminalManager.setActiveTerminal(terminalId)
        }, 50)
        return terminalId
    }, [selectedRoot, workspace?.roots?.[0]])

    const { terminals, activeId } = managerState

    return (
        <>
            <style>{XTERM_STYLE}</style>
            <div className="h-full bg-background-editor relative" style={{ boxSizing: 'border-box' }}>
                <div className={`h-full w-full ${terminals.length > 1 ? 'pr-[200px]' : ''}`} style={{ boxSizing: 'border-box' }}>
                    {terminals.map(term => (
                        <div
                            key={term.id}
                            ref={el => { if (el) containerRefs.current.set(term.id, el) }}
                            className={`h-full w-full ${activeId === term.id ? '' : 'hidden'}`}
                            onClick={() => terminalManager.setActiveTerminal(term.id)}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setContextMenu({
                                    visible: true,
                                    x: e.clientX,
                                    y: e.clientY,
                                    termId: term.id,
                                })
                            }}
                        />
                    ))}
                </div>
                {terminals.length > 1 && (
                    <div className="absolute right-0 top-0 bottom-0 flex flex-col gap-1.5 px-2 py-1.5 border-l border-border/40 bg-background-editor" style={{ width: 200, boxSizing: 'border-box' }}>
                        {terminals.map(term => (
                            <button
                                key={term.id}
                                onClick={() => terminalManager.setActiveTerminal(term.id)}
                                className={`flex items-center justify-start gap-1.5 px-2 py-1 rounded-md text-xs transition-colors group ${
                                    activeId === term.id
                                        ? 'bg-background border border-border text-text-primary'
                                        : 'text-text-muted hover:text-text-primary hover:bg-surface/60'
                                }`}
                            >
                                <Terminal className="w-3 h-3 flex-shrink-0" />
                                <span className="max-w-[120px] truncate flex-1 text-left">{term.name}</span>
                                <span
                                    onClick={(e) => { e.stopPropagation(); closeTerminal(term.id) }}
                                    className="opacity-0 group-hover:opacity-100 group-hover:text-red-400 transition-opacity cursor-pointer flex-shrink-0 ml-auto"
                                >
                                    <X className="w-3 h-3" />
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {contextMenu.visible && contextMenu.termId && (
                    <div
                        ref={contextMenuRef}
                        className="fixed z-[200] min-w-[200px] bg-surface border border-border rounded-md shadow-xl py-1 text-xs select-none"
                        style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={() => {
                                createTerminal()
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('newTerminal', language)}</span>
                            <span className="text-[11px] text-text-muted">{formatShortcut('Ctrl+Shift+`')}</span>
                        </button>
                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={() => {
                                createTerminal()
                                setTerminalLayout('split')
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('splitTerminal', language)}</span>
                            <span className="text-[11px] text-text-muted">{formatShortcut('Ctrl+Shift+5')}</span>
                        </button>

                        <div className="my-1 h-px bg-border/60" />

                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={async () => {
                                const term = contextMenu.termId ? terminalManager.getXterm(contextMenu.termId) : null
                                const sel = term?.getSelection()
                                if (sel) {
                                    try {
                                        await navigator.clipboard.writeText(sel)
                                    } catch {
                                        // ignore
                                    }
                                }
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('ctxCopy', language)}</span>
                            <span className="text-[11px] text-text-muted">{formatShortcut('Ctrl+Shift+C')}</span>
                        </button>
                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={async () => {
                                try {
                                    const text = await navigator.clipboard.readText()
                                    if (text && contextMenu.termId) {
                                        terminalManager.writeToTerminal(contextMenu.termId, text)
                                    }
                                } catch {
                                    // ignore
                                }
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('ctxPaste', language)}</span>
                            <span className="text-[11px] text-text-muted">{formatShortcut('Ctrl+Shift+V')}</span>
                        </button>
                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={() => {
                                const term = contextMenu.termId ? terminalManager.getXterm(contextMenu.termId) : null
                                term?.selectAll()
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('selectAll', language)}</span>
                        </button>

                        <div className="my-1 h-px bg-border/60" />

                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-surface-hover"
                            onClick={() => {
                                const term = contextMenu.termId ? terminalManager.getXterm(contextMenu.termId) : null
                                term?.clear()
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('clearTerminal', language)}</span>
                        </button>
                        <button
                            className="flex items-center justify-between w-full px-3 py-1.5 hover:bg-red-500/10 text-status-error"
                            onClick={() => {
                                if (contextMenu.termId) {
                                    closeTerminal(contextMenu.termId)
                                }
                                setContextMenu(prev => ({ ...prev, visible: false }))
                            }}
                        >
                            <span>{t('killTerminal', language)}</span>
                        </button>
                    </div>
                )}
            </div>
        </>
    )
})

export default TerminalPanel
