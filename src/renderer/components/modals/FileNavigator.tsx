import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Search, X, Clock, Star, Filter } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getFileName } from '@shared/toolkit/pathHelper'
import { keybindingService } from '@services/keybindingAdapter'
import { t } from '@renderer/i18n'
import { ActionButton } from '../ui'
import FileIcon from '../foundation/FileTypeIcon'
import { useElevatedToastLayer } from '@components/foundation/toastLayerStore'

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

const RECENT_FILES_KEY = 'aweeclaw_recent_files'
const FAVORITES_KEY = 'aweeclaw_file_favorites'

function loadRecentFiles(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]') } catch { return [] }
}

function saveRecentFile(path: string) {
  const recent = loadRecentFiles().filter(r => r !== path)
  recent.unshift(path)
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recent.slice(0, 30)))
}

function loadFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]') } catch { return [] }
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

const HighlightedFileName = memo(function HighlightedFileName({
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
          <HighlightedFileName text={fileName} matchIndices={fileNameMatches} />
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

export default function FileNavigator({ onClose }: FileNavigatorProps) {
  useElevatedToastLayer(true)
  const { workspacePath, openFile, language } = useStore(useShallow(s => ({ workspacePath: s.workspacePath, openFile: s.openFile, language: s.language })))
  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [candidates, setCandidates] = useState<FileCandidate[]>([])
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
      setCandidates(recentCandidates.slice(0, 30))
      setSelectedIndex(0)
      return
    }

    if (!query.trim()) {
      setCandidates(allFiles.slice(0, 20).map(path => ({
        path,
        name: getFileName(path) || path,
        score: 0,
        matchIndices: [],
        isFavorite: favorites.current.includes(path),
      })))
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
    setCandidates(results.slice(0, 50))
    setSelectedIndex(0)
  }, [query, allFiles, showRecent])

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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e, 'list.focusDown')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, candidates.length - 1))
    } else if (keybindingService.matches(e, 'list.focusUp')) {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (keybindingService.matches(e, 'list.select')) {
      e.preventDefault()
      if (candidates[selectedIndex]) openFilePath(candidates[selectedIndex].path)
    } else if (keybindingService.matches(e, 'list.cancel')) {
      e.preventDefault()
      onClose()
    }
  }, [candidates, selectedIndex, openFilePath, onClose])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

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
            placeholder={t('searchFilesPlaceholder', language)}
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
            onClick={() => { setShowRecent(false); setQuery('') }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${!showRecent ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <Filter className="w-3 h-3" />
            {language === 'zh' ? '全部' : 'All'}
          </button>
          <button
            onClick={() => { setShowRecent(true); setQuery('') }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${showRecent ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <Clock className="w-3 h-3" />
            {language === 'zh' ? '最近' : 'Recent'}
          </button>
          <span className="ml-auto text-[10px] text-text-muted/50 font-mono">{candidates.length} {language === 'zh' ? '项' : 'items'}</span>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-2 custom-scrollbar scroll-p-2">
          {isLoading ? (
            <div className="px-4 py-14 text-center text-text-muted flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium opacity-60">{t('loadingFiles', language)}</p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="px-4 py-14 text-center text-text-muted flex flex-col items-center gap-2">
              <p className="text-sm font-medium">{query ? t('noFilesFound', language) : t('noFilesInWorkspace', language)}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {candidates.map((candidate, idx) => (
                <div key={candidate.path} data-index={idx}>
                  <FileCandidateRow
                    candidate={candidate}
                    isSelected={idx === selectedIndex}
                    onSelect={() => openFilePath(candidate.path)}
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
              <span>open</span>
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
