import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Search, X, Clock, Star, MessageSquare, FileText } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getFileName } from '@shared/toolkit/pathHelper'
import { StorageService } from '@shared/toolkit/StorageService'
import { keybindingService } from '@services/keybindingAdapter'
import {t, type Language} from '@renderer/i18n'
import { ActionButton } from '../ui'
import FileIcon from '../foundation/FileTypeIcon'
import { useElevatedToastLayer } from '@components/foundation/toastLayerStore'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentActions, useAllThreads } from '@hooks/useAgent'
import { getThreadDisplayTitle, getMessageText } from '@intelligence/providerTypes'
import type { ChatThread } from '@intelligence/providerTypes'

interface FileNavigatorProps {
  onClose: () => void
}

interface FileCandidate {
  path: string
  name: string
  score: number
  matchIndices: number[]
  lastOpened?: number
  isFavorite?: boolean
}

interface SessionCandidate {
  thread: ChatThread
  score: number
  matchIndices: number[]
  title: string
  preview: string
}

type TabType = 'files' | 'sessions'

const RECENT_FILES_KEY = 'recent_files'
const FAVORITES_KEY = 'file_favorites'

function loadRecentFiles(): string[] {
  return StorageService.get<string[]>(RECENT_FILES_KEY) || []
}

function saveRecentFile(path: string) {
  const recent = loadRecentFiles().filter(r => r !== path)
  recent.unshift(path)
  StorageService.set(RECENT_FILES_KEY, recent.slice(0, 30))
}

function loadFavorites(): string[] {
  return StorageService.get<string[]>(FAVORITES_KEY) || []
}

function computeRelevanceScore(query: string, text: string): { score: number; indices: number[] } | null {
  const qLower = query.toLowerCase()
  const tLower = text.toLowerCase()
  let qIdx = 0
  let score = 0
  const indices: number[] = []
  let consecutive = 0

  for (let i = 0; i < text.length && qIdx < query.length; i++) {
    if (tLower[i] === qLower[qIdx]) {
      indices.push(i)
      if (indices.length > 1 && indices[indices.length - 1] === indices[indices.length - 2] + 1) {
        consecutive += 4
      }
      if (i === 0 || '/\\._-'.includes(text[i - 1])) score += 8
      if (text[i] === text[i].toUpperCase() && text[i] !== text[i].toLowerCase()) score += 4
      score += 1
      qIdx++
    }
  }

  if (qIdx !== query.length) return null
  score += consecutive
  score -= text.length * 0.08
  return { score, indices }
}

function computeSessionRelevanceScore(query: string, thread: ChatThread): { score: number; indices: number[] } | null {
  const title = getThreadDisplayTitle(thread)
  const firstUserMsg = thread.messages.find(m => m.role === 'user')
  const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 80) : ''
  const searchText = `${title} ${preview}`.toLowerCase()
  const qLower = query.toLowerCase()

  if (!query.trim()) return { score: 0, indices: [] }
  if (searchText.includes(qLower)) {
    let score = 0
    const indices: number[] = []
    const titleLower = title.toLowerCase()
    const previewLower = preview.toLowerCase()

    if (titleLower.includes(qLower)) {
      score += 20
      const idx = titleLower.indexOf(qLower)
      for (let i = idx; i < idx + query.length && i < title.length; i++) {
        indices.push(i)
      }
    }
    if (previewLower.includes(qLower)) {
      score += 10
    }
    score += thread.lastModified > Date.now() - 86400000 * 7 ? 5 : 0
    return { score, indices }
  }
  return null
}

const HighlightedText = memo(function HighlightedText({
  text,
  matchIndices,
}: {
  text: string
  matchIndices: number[]
}) {
  const fragments: JSX.Element[] = []
  let lastPos = 0

  for (const pos of matchIndices) {
    if (pos > lastPos) {
      fragments.push(<span key={`t-${lastPos}`} className="text-text-muted">{text.slice(lastPos, pos)}</span>)
    }
    fragments.push(<span key={`m-${pos}`} className="text-accent font-semibold">{text[pos]}</span>)
    lastPos = pos + 1
  }

  if (lastPos < text.length) {
    fragments.push(<span key={`t-${lastPos}`} className="text-text-primary/70">{text.slice(lastPos)}</span>)
  }

  return <>{fragments}</>
})

const FileCandidateRow = memo(function FileCandidateRow({
  candidate,
  isSelected,
  onSelect,
}: {
  candidate: FileCandidate
  isSelected: boolean
  onSelect: () => void
}) {
  const fileName = getFileName(candidate.path) || candidate.path
  const dirPath = candidate.path.slice(0, candidate.path.length - fileName.length - 1)
  const fileNameStart = candidate.path.length - fileName.length
  const fileNameMatches = candidate.matchIndices.filter(m => m >= fileNameStart).map(m => m - fileNameStart)

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-150 mx-2 rounded-lg group
        ${isSelected ? 'bg-accent/10 text-text-primary ring-1 ring-accent/15' : 'text-text-secondary hover:bg-surface-hover'}
      `}
    >
      <div className="flex-shrink-0">
        <FileIcon filename={fileName} size={18} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="text-[13px] font-medium truncate leading-tight flex items-center gap-2">
          <HighlightedText text={fileName} matchIndices={fileNameMatches} />
          {candidate.isFavorite && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />}
        </div>
        {dirPath && (
          <div className="text-[11px] text-text-muted truncate opacity-50 leading-tight">{dirPath}</div>
        )}
      </div>

      {isSelected && (
        <div className="flex-shrink-0 text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity">
          ⏎
        </div>
      )}
    </div>
  )
})

const SessionCandidateRow = memo(function SessionCandidateRow({
  candidate,
  isSelected,
  isCurrent,
  onSelect,
  language,
}: {
  candidate: SessionCandidate
  isSelected: boolean
  isCurrent: boolean
  onSelect: () => void
  language: Language
}) {
  const { thread, title, preview } = candidate
  const msgCount = thread.messageCount ?? thread.messages.length ?? 0

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) {
      return t('modals.today', language as Language, { hours: date.getHours().toString().padStart(2, '0'), minutes: date.getMinutes().toString().padStart(2, '0') })
    }
    const y = date.getFullYear()
    const m = (date.getMonth() + 1).toString().padStart(2, '0')
    const d = date.getDate().toString().padStart(2, '0')
    return t('modals.text0', language as Language, { m: m, d: d, y: y })
  }

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all duration-150 mx-2 rounded-lg group
        ${isSelected ? 'bg-accent/10 text-text-primary ring-1 ring-accent/15' : 'text-text-secondary hover:bg-surface-hover'}
      `}
    >
      <div className="flex-shrink-0 p-1.5 rounded-md bg-accent/10 text-accent">
        <MessageSquare className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <div className="text-[13px] font-medium truncate leading-tight flex items-center gap-2">
          <HighlightedText text={title} matchIndices={candidate.matchIndices} />
          {isCurrent && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
              {t('modals.current', language as Language)}
            </span>
          )}
        </div>
        {preview && preview !== '-' && (
          <div className="text-[11px] text-text-muted truncate opacity-60 leading-tight">{preview}</div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="text-[10px] text-text-muted/50 font-mono">{msgCount}</span>
        <span className="text-[10px] text-text-muted/40">{formatTime(thread.lastModified)}</span>
      </div>

      {isSelected && (
        <div className="flex-shrink-0 text-[10px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity">
          ⏎
        </div>
      )}
    </div>
  )
})

export default function FileNavigator({ onClose }: FileNavigatorProps) {
  useElevatedToastLayer(true)
  const { workspacePath, openFile, language, setChatVisible } = useStore(useShallow(s => ({
    workspacePath: s.workspacePath,
    openFile: s.openFile,
    language: s.language,
    setChatVisible: s.setChatVisible,
  })))
  const { switchThread } = useAgentActions()
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const allThreads = useAllThreads()

  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('files')
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [fileCandidates, setFileCandidates] = useState<FileCandidate[]>([])
  const [sessionCandidates, setSessionCandidates] = useState<SessionCandidate[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [showRecent, setShowRecent] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const favorites = useRef(loadFavorites())

  const collectWorkspaceFiles = useCallback(async (dirPath: string, prefix: string = ''): Promise<string[]> => {
    const items = await api.file.readDir(dirPath)
    if (!items) return []
    const collected: string[] = []
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist' || item.name === '.git') continue
      const relPath = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isDirectory) {
        const subFiles = await collectWorkspaceFiles(item.path, relPath)
        collected.push(...subFiles)
      } else {
        collected.push(relPath)
      }
    }
    return collected
  }, [])

  useEffect(() => {
    if (!workspacePath) { setIsLoading(false); return }
    setIsLoading(true)
    collectWorkspaceFiles(workspacePath).then(files => { setAllFiles(files); setIsLoading(false) })
  }, [workspacePath, collectWorkspaceFiles])

  useEffect(() => {
    if (activeTab !== 'files') return

    if (showRecent && !query.trim()) {
      const recentPaths = loadRecentFiles()
      const recentCandidates: FileCandidate[] = recentPaths
        .filter(p => allFiles.includes(p) || true)
        .map(path => ({
          path,
          name: getFileName(path) || path,
          score: 100,
          matchIndices: [],
          lastOpened: Date.now(),
          isFavorite: favorites.current.includes(path),
        }))
      setFileCandidates(recentCandidates.slice(0, 30))
      setSelectedIndex(0)
      return
    }

    if (!query.trim()) {
      setFileCandidates(allFiles.slice(0, 20).map(path => ({
        path,
        name: getFileName(path) || path,
        score: 0,
        matchIndices: [],
        isFavorite: favorites.current.includes(path),
      })))
      setSelectedIndex(0)
      return
    }

    const results: FileCandidate[] = []
    for (const filePath of allFiles) {
      const result = computeRelevanceScore(query, filePath)
      if (result) {
        results.push({
          path: filePath,
          name: getFileName(filePath) || filePath,
          score: result.score + (favorites.current.includes(filePath) ? 5 : 0),
          matchIndices: result.indices,
          isFavorite: favorites.current.includes(filePath),
        })
      }
    }
    results.sort((a, b) => b.score - a.score)
    setFileCandidates(results.slice(0, 50))
    setSelectedIndex(0)
  }, [query, allFiles, showRecent, activeTab])

  useEffect(() => {
    if (activeTab !== 'sessions') return

    if (!query.trim()) {
      setSessionCandidates(
        allThreads.slice(0, 30).map(thread => {
          const title = getThreadDisplayTitle(thread)
          const firstUserMsg = thread.messages.find(m => m.role === 'user')
          const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 80) : '-'
          return {
            thread,
            score: 0,
            matchIndices: [],
            title,
            preview,
          }
        })
      )
      setSelectedIndex(0)
      return
    }

    const results: SessionCandidate[] = []
    for (const thread of allThreads) {
      const result = computeSessionRelevanceScore(query, thread)
      if (result) {
        const title = getThreadDisplayTitle(thread)
        const firstUserMsg = thread.messages.find(m => m.role === 'user')
        const preview = firstUserMsg ? getMessageText(firstUserMsg.content).slice(0, 80) : '-'
        results.push({
          thread,
          score: result.score,
          matchIndices: result.indices,
          title,
          preview,
        })
      }
    }
    results.sort((a, b) => b.score - a.score || b.thread.lastModified - a.thread.lastModified)
    setSessionCandidates(results.slice(0, 50))
    setSelectedIndex(0)
  }, [query, allThreads, activeTab])

  const openFilePath = useCallback(async (filePath: string) => {
    if (!workspacePath) return
    const fullPath = `${workspacePath}/${filePath}`
    const content = await api.file.read(fullPath)
    if (content !== null) {
      saveRecentFile(filePath)
      openFile(fullPath, content)
      onClose()
    }
  }, [workspacePath, openFile, onClose])

  const openSession = useCallback((threadId: string) => {
    switchThread(threadId)
    setChatVisible(true)
    onClose()
  }, [switchThread, setChatVisible, onClose])

  const currentCandidates = activeTab === 'files' ? fileCandidates : sessionCandidates
  const currentCount = currentCandidates.length

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e, 'list.focusDown')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, currentCount - 1))
    } else if (keybindingService.matches(e, 'list.focusUp')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (keybindingService.matches(e, 'list.select')) {
      e.preventDefault()
      if (activeTab === 'files' && fileCandidates[selectedIndex]) {
        openFilePath(fileCandidates[selectedIndex].path)
      } else if (activeTab === 'sessions' && sessionCandidates[selectedIndex]) {
        openSession(sessionCandidates[selectedIndex].thread.id)
      }
    } else if (keybindingService.matches(e, 'list.cancel')) {
      e.preventDefault()
      onClose()
    }
  }, [currentCount, activeTab, fileCandidates, sessionCandidates, selectedIndex, openFilePath, openSession, onClose])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSelectedIndex(0) }, [query, activeTab, showRecent])
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const placeholder = activeTab === 'files'
    ? t('modals.searchFilesPlaceholder', language)
    : (t('modals.searchsessionhistory', language as Language))

  const emptyText = activeTab === 'files'
    ? (query ? t('modals.noFilesFound', language) : t('modals.noFilesInWorkspace', language))
    : (t('modals.nosessionrecordsyet', language as Language))

  const emptySearchText = activeTab === 'files'
    ? (query ? t('modals.noFilesFound', language) : t('modals.noFilesInWorkspace', language))
    : (t('modals.nomatchingsessionsfound', language as Language))

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] animate-fade-in" onClick={onClose}>
      <div className="fixed inset-0 bg-background/20 backdrop-blur-sm transition-opacity" />

      <div
        className="relative w-[660px] max-h-[65vh] flex flex-col bg-background/85 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden animate-scale-in origin-top ring-1 ring-text-primary/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40 shrink-0">
          <Search className="w-5 h-5 text-text-muted" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-lg font-medium text-text-primary placeholder:text-text-muted/70 focus:outline-none"
            spellCheck={false}
          />
          {query && (
            <ActionButton variant="ghost" size="icon" onClick={() => setQuery('')} className="rounded-full w-6 h-6 min-h-0 p-0 text-text-muted hover:text-text-primary">
              <X className="w-4 h-4" />
            </ActionButton>
          )}
        </div>

        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border/25 bg-surface/15">
          <button
            onClick={() => { setActiveTab('files'); setShowRecent(false); setQuery('') }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${activeTab === 'files' && !showRecent ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <FileText className="w-3 h-3" />
            {t('modals.files', language as Language)}
          </button>
          {activeTab === 'files' && (
            <button
              onClick={() => { setShowRecent(true); setQuery('') }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${showRecent ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
            >
              <Clock className="w-3 h-3" />
              {t('modals.recent', language as Language)}
            </button>
          )}
          <button
            onClick={() => { setActiveTab('sessions'); setShowRecent(false); setQuery('') }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${activeTab === 'sessions' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <MessageSquare className="w-3 h-3" />
            {t('modals.sessions', language as Language)}
          </button>
          <span className="ml-auto text-[10px] text-text-muted/50 font-mono">{currentCount} {t('modals.items', language as Language)}</span>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-2 custom-scrollbar scroll-p-2">
          {isLoading && activeTab === 'files' ? (
            <div className="px-4 py-14 text-center text-text-muted flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium opacity-60">{t('modals.loadingFiles', language)}</p>
            </div>
          ) : currentCount === 0 ? (
            <div className="px-4 py-14 text-center text-text-muted flex flex-col items-center gap-2">
              <p className="text-sm font-medium">{query ? emptySearchText : emptyText}</p>
            </div>
          ) : activeTab === 'files' ? (
            <div className="flex flex-col gap-0.5">
              {fileCandidates.map((candidate, idx) => (
                <div key={candidate.path} data-index={idx}>
                  <FileCandidateRow
                    candidate={candidate}
                    isSelected={idx === selectedIndex}
                    onSelect={() => openFilePath(candidate.path)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {sessionCandidates.map((candidate, idx) => (
                <div key={candidate.thread.id} data-index={idx}>
                  <SessionCandidateRow
                    candidate={candidate}
                    isSelected={idx === selectedIndex}
                    isCurrent={currentThreadId === candidate.thread.id}
                    onSelect={() => openSession(candidate.thread.id)}
                    language={language}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-2 bg-surface/25 border-t border-border/35 text-[10px] font-medium text-text-muted/60 flex justify-between items-center shrink-0 backdrop-blur-md">
          <div className="flex gap-3">
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1 py-0.5 rounded min-w-[14px] text-center text-[9px]">↑↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1.5 py-0.5 rounded text-[9px]">↵</kbd>
              <span>{activeTab === 'files' ? 'open' : 'switch'}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans bg-surface/70 border border-border/40 px-1.5 py-0.5 rounded text-[9px]">esc</kbd>
              <span>close</span>
            </span>
          </div>
          <span className="opacity-40 font-bold tracking-wide">AweeClaw Navigator</span>
        </div>
      </div>
    </div>
  )
}
