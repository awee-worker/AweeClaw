/**
 * 工作区视图
 */

import { api } from '../../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderOpen, Plus, RefreshCw, FolderPlus, FilePlus, ExternalLink, Crosshair, Terminal, Clipboard, Download, Eye, EyeOff } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {t, type Language} from '@renderer/i18n'
import { getDirPath, joinPath, pathStartsWith, pathEquals } from '@shared/toolkit/pathHelper'
import { gitService } from '@services/gitAdapter'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { toast } from '@components/foundation/NotificationProvider'
import { workspaceManager } from '@services/WorkspaceAdapter'
import { directoryCacheService } from '@services/dirCacheAdapter'
import { ActionButton, HintOverlay, FloatingMenu, ContextMenuItem } from '../../ui'
import { TreeSkeleton } from '../../ui/ProgressIndicator'
import { VirtualFileTree } from '@components/file-tree/VirtualTreeRenderer'
import { terminalManager } from '@services/TerminalAdapter'
import { explorerClipboardService, type ExplorerClipboardItem } from '@services/clipboardService'
import { formatShortcut } from '@services/keybindingAdapter'
import { ArtifactPanel } from './ArtifactPanel'

export interface TreeRefreshOptions {
  resetTree?: boolean
  affectedPaths?: string[]
  deletedPaths?: string[]
  refreshRoot?: boolean
}

interface WorkspaceFilesChangedDetail {
  affectedPaths?: string[]
  deletedPaths?: string[]
  refreshRoot?: boolean
}

export function ExplorerView() {
  const {
    workspacePath,
    workspace,
    files,
    setFiles,
    language,
    setGitStatus,
    setIsGitRepo,
    expandFolder,
    activeFilePath,
    activeScenarioId,
    showWorkspaceSystemDir,
    setShowWorkspaceSystemDir,
    artifactRatio,
    artifactCollapsed,
    setArtifactRatio,
    setArtifactCollapsed,
  } = useStore(useShallow(s => ({
    workspacePath: s.workspacePath, workspace: s.workspace, files: s.files, setFiles: s.setFiles,
    language: s.language,
    setGitStatus: s.setGitStatus, setIsGitRepo: s.setIsGitRepo,
    expandFolder: s.expandFolder, activeFilePath: s.activeFilePath,
    activeScenarioId: s.activeScenarioId,
    showWorkspaceSystemDir: s.showWorkspaceSystemDir, setShowWorkspaceSystemDir: s.setShowWorkspaceSystemDir,
    artifactRatio: s.artifactRatio, artifactCollapsed: s.artifactCollapsed,
    setArtifactRatio: s.setArtifactRatio, setArtifactCollapsed: s.setArtifactCollapsed,
  })))
  const setTerminalVisible = useStore(state => state.setTerminalVisible)

  const [creatingIn, setCreatingIn] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [treeVersion, setTreeVersion] = useState(0)
  const [treeRefreshSignal, setTreeRefreshSignal] = useState<{ tick: number; affectedPaths: string[]; deletedPaths: string[] }>({
    tick: 0,
    affectedPaths: [],
    deletedPaths: [],
  })
  const [clipboardItem, setClipboardItem] = useState<ExplorerClipboardItem | null>(
    () => explorerClipboardService.getState().entry
  )

  const bodyRef = useRef<HTMLDivElement>(null)
  const [isResizingArtifacts, setIsResizingArtifacts] = useState(false)

  // 拖动分割线调整产物栏高度：用指针位置相对内容区底部的比例换算
  useEffect(() => {
    if (!isResizingArtifacts) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect || rect.height <= 0) return
      setArtifactRatio((rect.bottom - e.clientY) / rect.height)
    }

    const stopResizing = () => setIsResizingArtifacts(false)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResizing)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizingArtifacts, setArtifactRatio])

  // 产物栏显隐跟随产物：当前工作区有产物自动展开，产物清空后自动收起。
  // 只订阅「是否有产物」这个布尔值，产物落盘引起的列表更新不会带来额外渲染。
  const hasArtifacts = useStore(state => {
    if (state.artifacts.length === 0) return false
    const ws = state.workspacePath
    if (!ws) return true
    return state.artifacts.some(item => pathStartsWith(item.path, ws))
  })

  // 记录上一次判定依据：产物有无未变化时保持现状，不覆盖用户手动折叠 / 展开的选择
  const artifactPresenceRef = useRef<{ workspacePath: string | null; hasArtifacts: boolean } | null>(null)

  useEffect(() => {
    const previous = artifactPresenceRef.current
    artifactPresenceRef.current = { workspacePath, hasArtifacts }

    const workspaceChanged = !previous || previous.workspacePath !== workspacePath
    // 切换工作区或产物有无发生翻转时重新判定；其余情况交给用户自己控制
    if (!workspaceChanged && previous.hasArtifacts === hasArtifacts) return

    setArtifactCollapsed(!hasArtifacts)
  }, [hasArtifacts, workspacePath, setArtifactCollapsed])

  // Reveal active file in explorer
  const handleRevealActiveFile = useCallback(() => {
    if (activeFilePath) {
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
    }
  }, [activeFilePath])

  // 更新 Git 状态（带重试逻辑）
  const updateGitStatus = useCallback(async () => {
    if (!workspacePath) {
      setGitStatus(null)
      setIsGitRepo(false)
      return
    }

    gitService.setWorkspace(workspacePath)
    
    // 重试逻辑：有时工作区刚设置时 git 命令可能失败
    let retries = 3
    let isRepo = false
    
    while (retries > 0) {
      isRepo = await gitService.isGitRepo()
      if (isRepo) break
      
      // 如果失败，等待一小段时间后重试
      retries--
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
    
    setIsGitRepo(isRepo)

    if (isRepo) {
      const status = await gitService.getStatus()
      setGitStatus(status)
    }
  }, [workspacePath, setGitStatus, setIsGitRepo])

  // 刷新文件列表
  const refreshFiles = useCallback(async (options?: TreeRefreshOptions) => {
    if (!workspacePath) return

    const affectedPaths = Array.from(new Set(options?.affectedPaths?.filter(Boolean) ?? []))
    const deletedPaths = Array.from(new Set(options?.deletedPaths?.filter(Boolean) ?? []))
    const shouldResetTree = options?.resetTree === true
    const shouldRefreshRoot = shouldResetTree
      || options?.refreshRoot === true
      || affectedPaths.some(path => pathEquals(path, workspacePath))
      || deletedPaths.some(path => pathEquals(getDirPath(path), workspacePath))

    if (shouldResetTree) {
      directoryCacheService.clear()
    } else {
      affectedPaths.forEach(path => directoryCacheService.invalidate(path))
      deletedPaths.forEach(path => directoryCacheService.invalidateTree(path))
    }

    if (shouldRefreshRoot) {
      const items = await directoryCacheService.getDirectory(workspacePath, true)
      setFiles(items)
    }

    if (shouldResetTree) {
      setTreeVersion((version) => version + 1)
    } else if (affectedPaths.length > 0 || deletedPaths.length > 0) {
      setTreeRefreshSignal(prev => ({
        tick: prev.tick + 1,
        affectedPaths,
        deletedPaths,
      }))
    }

    void updateGitStatus()
  }, [workspacePath, setFiles, updateGitStatus])

  // 工作区变化时更新 Git 状态（只在初始化时执行一次）
  useEffect(() => {
    if (!workspacePath) return
    updateGitStatus()
  }, [workspacePath])

  // 挂载时（即用户切换到工作区面板时）自动刷新一次目录
  // ExplorerView 在切换侧边栏面板时会卸载/重新挂载，因此此 effect 会在每次激活工作区时触发
  useEffect(() => {
    if (!workspacePath) return
    void refreshFiles({ refreshRoot: true })
    // 仅在挂载时执行一次，不依赖 refreshFiles（避免重复刷新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath])

  useEffect(() => {
    return explorerClipboardService.subscribe(state => {
      setClipboardItem(state.entry)
    })
  }, [])

  useEffect(() => {
    if (!workspacePath) return

    const handleWorkspaceFilesChanged = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceFilesChangedDetail>
      const affectedPaths = (customEvent.detail?.affectedPaths ?? [])
        .filter((path): path is string => Boolean(path))
        .filter((path) => pathEquals(path, workspacePath) || pathStartsWith(path, workspacePath))
      const deletedPaths = (customEvent.detail?.deletedPaths ?? [])
        .filter((path): path is string => Boolean(path))
        .filter((path) => pathEquals(path, workspacePath) || pathStartsWith(path, workspacePath))
      const refreshRoot = customEvent.detail?.refreshRoot === true

      if (affectedPaths.length === 0 && deletedPaths.length === 0 && !refreshRoot) {
        return
      }

      void refreshFiles({
        affectedPaths,
        deletedPaths,
        refreshRoot,
      })
    }

    window.addEventListener('workspace:files-changed', handleWorkspaceFilesChanged)
    return () => {
      window.removeEventListener('workspace:files-changed', handleWorkspaceFilesChanged)
    }
  }, [refreshFiles, workspacePath])

  // 监听文件变化事件
  useEffect(() => {
    if (!workspacePath) return

    const config = getEditorConfig()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let gitDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingChanges: Array<{ path: string; event: string }> = []

    const unsubscribe = api.file.onChanged((event: { event: 'create' | 'update' | 'delete'; path: string }) => {
      if (pathStartsWith(event.path, workspacePath)) {
        pendingChanges.push({ path: event.path, event: event.event })

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const affectedDirectoryPaths = new Set<string>()
          const deletedPaths = new Set<string>()
          let shouldRefreshRoot = false

          pendingChanges.forEach((change) => {
            const eventType = change.event === 'create' ? 'create' : change.event === 'delete' ? 'delete' : 'update'
            directoryCacheService.handleFileChange(change.path, eventType)
            if (eventType === 'create' || eventType === 'delete') {
              const parentPath = getDirPath(change.path) || workspacePath
              if (parentPath) {
                affectedDirectoryPaths.add(parentPath)
                if (parentPath === workspacePath) {
                  shouldRefreshRoot = true
                }
              }
              if (eventType === 'delete') {
                deletedPaths.add(change.path)
              }
            }
          })
          pendingChanges = []

          if (affectedDirectoryPaths.size > 0 || deletedPaths.size > 0) {
            refreshFiles({
              affectedPaths: Array.from(affectedDirectoryPaths),
              deletedPaths: Array.from(deletedPaths),
              refreshRoot: shouldRefreshRoot,
            })
          }
        }, config.performance.fileChangeDebounceMs)
        
        // 如果启用了自动刷新且是 .git 目录变化，延迟刷新 Git 状态
        if (config.git.autoRefresh && event.path.includes('.git')) {
          if (gitDebounceTimer) clearTimeout(gitDebounceTimer)
          gitDebounceTimer = setTimeout(updateGitStatus, 500)
        }
      }
    })

    return () => {
      unsubscribe()
      if (debounceTimer) clearTimeout(debounceTimer)
      if (gitDebounceTimer) clearTimeout(gitDebounceTimer)
    }
  }, [workspacePath, refreshFiles, updateGitStatus])

  const handleOpenFolder = async () => {
    // 选择器同时接受文件夹与 .aweeclaw-workspace 文件（多根）
    await workspaceManager.openFolderFromDialog()
  }

  const handleStartCreate = useCallback((path: string, type: 'file' | 'folder') => {
    // 确保父文件夹展开
    expandFolder(path)
    setCreatingIn({ path, type })
  }, [expandFolder])

  const handleCancelCreate = useCallback(() => {
    setCreatingIn(null)
  }, [])

  const handleCreateSubmit = useCallback(
    async (parentPath: string, name: string, type: 'file' | 'folder') => {
      const fullPath = joinPath(parentPath, name)
      let success = false

      if (type === 'file') {
        success = await api.file.write(fullPath, '')
      } else {
        success = await api.file.mkdir(fullPath)
      }

      if (success) {
        await refreshFiles({
          affectedPaths: [parentPath],
          refreshRoot: parentPath === workspacePath,
        })
        toast.success(type === 'file' ? 'File created' : 'Folder created')
      }
      setCreatingIn(null)
    },
    [refreshFiles, workspacePath]
  )

  const handleRootCreate = useCallback(
    (type: 'file' | 'folder') => {
      if (workspacePath) {
        setCreatingIn({ path: workspacePath, type })
      }
    },
    [workspacePath]
  )

  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (workspacePath) {
        setRootContextMenu({ x: e.clientX, y: e.clientY })
      }
    },
    [workspacePath]
  )

  const openTerminalAtPath = useCallback(async (cwd: string) => {
    setTerminalVisible(true)
    await terminalManager.createTerminal({
      cwd,
      name: t('terminal', language),
    })
  }, [language, setTerminalVisible])

  const handlePasteToWorkspaceRoot = useCallback(() => {
    if (!workspacePath || !clipboardItem) return
    window.dispatchEvent(new CustomEvent('explorer:paste-into', {
      detail: { targetDirectoryPath: workspacePath },
    }))
  }, [clipboardItem, workspacePath])

  const handleImportToDirectory = useCallback(async (targetDir: string) => {
    const selectedPaths = await api.file.selectForImport({
      title: t('explorer.importfilesorfolders', language as Language),
      allowFiles: true,
      allowDirs: true,
      multiSelection: true,
    })
    if (!selectedPaths || selectedPaths.length === 0) return

    const result = await api.file.importIntoWorkspace(selectedPaths, targetDir)
    if (result.success) {
      toast.success(t('explorer.successfullyimporteditems', language as Language, { length: selectedPaths.length }))
      await refreshFiles({ affectedPaths: [targetDir], refreshRoot: targetDir === workspacePath })
    } else {
      const failedCount = result.results?.filter(r => !r.success).length || selectedPaths.length
      toast.error(t('explorer.failedtoimportitems', language as Language, { failedCount: failedCount }))
      if (targetDir === workspacePath || result.results?.some(r => r.success)) {
        await refreshFiles({ affectedPaths: [targetDir], refreshRoot: targetDir === workspacePath })
      }
    }
  }, [language, refreshFiles, workspacePath])

  const isWorkspaceEditor = activeScenarioId === 'dev-assistant'

  const rootMenuItems: ContextMenuItem[] = [
    { id: 'newFile', label: t('newFile', language as Language), icon: FilePlus, onClick: () => handleRootCreate('file') },
    { id: 'newFolder', label: t('newFolder', language as Language), icon: FolderPlus, onClick: () => handleRootCreate('folder') },
    { id: 'sep1', label: '', separator: true },
    {
      id: 'import',
      label: t('explorer.import', language as Language),
      icon: Download,
      onClick: () => workspacePath && handleImportToDirectory(workspacePath),
    },
    ...(isWorkspaceEditor
      ? [
          { id: 'sep2', label: '', separator: true } as ContextMenuItem,
          {
            id: 'openTerminal',
            label: t('contextMenu.openIntegratedTerminalHere', language as Language),
            icon: Terminal,
            onClick: () => workspacePath && openTerminalAtPath(workspacePath),
          } as ContextMenuItem,
        ]
      : []),
    { id: 'sepTerminal', label: '', separator: true },
    {
      id: 'paste',
      label: t('paste', language as Language),
      icon: Clipboard,
      shortcut: formatShortcut('Ctrl+V'),
      disabled: !clipboardItem,
      onClick: handlePasteToWorkspaceRoot,
    },
    { id: 'sepPaste', label: '', separator: true },
    { id: 'refresh', label: t('refresh', language as Language), icon: RefreshCw, onClick: () => refreshFiles({ refreshRoot: true }) },
    {
      id: 'reveal',
      label: t('contextMenu.revealInWorkspace', language as Language),
      icon: ExternalLink,
      onClick: () => workspacePath && api.file.showInFolder(workspacePath),
    },
    { id: 'sepHidden', label: '', separator: true },
    {
      id: 'toggleHidden',
      label: showWorkspaceSystemDir ? t('contextMenu.hideWorkspaceSystemDir', language as Language) : t('contextMenu.showWorkspaceSystemDir', language as Language),
      icon: showWorkspaceSystemDir ? EyeOff : Eye,
      onClick: () => setShowWorkspaceSystemDir(!showWorkspaceSystemDir),
    },
  ]

  return (
    <div className="h-full flex flex-col bg-transparent">
      <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
        <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
          {t('explorer', language)}
        </span>
        <div className="flex items-center gap-0.5 opacity-100 transition-all duration-300 flex-shrink-0">
          <HintOverlay content={t('revealActiveFile', language) || 'Reveal Active File'}>
            <button onClick={handleRevealActiveFile} disabled={!activeFilePath} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-all active:scale-90">
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          </HintOverlay>
          <HintOverlay content={t('newFile', language)}>
            <button onClick={() => handleRootCreate('file')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-all active:scale-90">
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </HintOverlay>
          <HintOverlay content={t('newFolder', language)}>
            <button onClick={() => handleRootCreate('folder')} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-all active:scale-90">
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </HintOverlay>
          <HintOverlay content={t('refresh', language)}>
            <button onClick={() => refreshFiles({ refreshRoot: true })} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-all active:scale-90">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </HintOverlay>
          <HintOverlay content={t('paste', language) || 'Paste'}>
            <button
              onClick={handlePasteToWorkspaceRoot}
              disabled={!clipboardItem}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary disabled:text-text-muted/75 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all active:scale-90 disabled:active:scale-100"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
          </HintOverlay>
        </div>
      </div>
      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col" onContextMenu={handleRootContextMenu}>
        {workspace && workspace.roots.length > 0 && files.length > 0 ? (
          <VirtualFileTree
            items={files}
            treeVersion={treeVersion}
            refreshSignal={treeRefreshSignal}
            onRefresh={refreshFiles}
            creatingIn={creatingIn}
            onStartCreate={handleStartCreate}
            onCancelCreate={handleCancelCreate}
            onCreateSubmit={handleCreateSubmit}
            onOpenTerminal={openTerminalAtPath}
          />
        ) : workspace && workspace.roots.length > 0 ? (
          <div className="flex-1 overflow-hidden">
            <TreeSkeleton rows={14} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 bg-surface/50 rounded-3xl flex items-center justify-center mb-6 border border-border/50 shadow-sm">
              <FolderOpen className="w-8 h-8 text-accent/50" />
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">{t('noFolderOpened', language)}</p>
            <p className="text-xs text-text-muted mb-6 opacity-60">Open a folder to start coding</p>
            <ActionButton
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl shadow-lg shadow-accent/20"
            >
              <Plus className="w-4 h-4" />
              {t('openFolder', language)}
            </ActionButton>
          </div>
        )}
        </div>

        {/* 产物栏：展示 AI 执行任务产出的文件，拖动上方分割线可调整高度 */}
        {workspace && workspace.roots.length > 0 && (
          <div
            className="relative min-h-0 flex-shrink-0"
            style={{ flex: artifactCollapsed ? '0 0 30px' : `0 0 ${(artifactRatio * 100).toFixed(4)}%` }}
          >
            <div
              className="absolute -top-0.5 left-0 right-0 h-1 z-30 cursor-row-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
              onMouseDown={e => {
                e.preventDefault()
                // 从折叠状态直接拖开时自动展开，避免拖了没反应
                if (artifactCollapsed) setArtifactCollapsed(false)
                setIsResizingArtifacts(true)
              }}
            />
            <ArtifactPanel
              collapsed={artifactCollapsed}
              onToggleCollapse={() => setArtifactCollapsed(!artifactCollapsed)}
            />
          </div>
        )}
      </div>

      {rootContextMenu && (
        <FloatingMenu x={rootContextMenu.x} y={rootContextMenu.y} items={rootMenuItems} onClose={() => setRootContextMenu(null)} />
      )}
    </div>
  )
}
