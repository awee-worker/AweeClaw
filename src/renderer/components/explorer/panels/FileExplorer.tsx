/**
 * 工作空间视图
 */

import { api } from '../../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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

/**
 * 应用内部快照目录（与工具层的备份目录同名）
 *
 * 每次编辑 / 覆写前，工具会把原文件复制一份到这里，而这次复制会以 file:changed
 * 通知的形式回到渲染进程。路径落在工作空间内，于是命中文件树的刷新条件 ——
 * 结果每个工具编辑都额外多一次目录重读与文件树重渲染，而这些快照文件本身从不
 * 需要出现在文件树里。这里把它们排除在刷新链路之外。
 */
const INTERNAL_SNAPSHOT_DIR = '.history'

/** 路径是否位于应用内部快照目录内 */
function isInternalSnapshotPath(filePath: string, workspaceRoot: string): boolean {
  if (!pathStartsWith(filePath, workspaceRoot)) return false
  const relative = filePath.slice(workspaceRoot.length)
  return relative.split(/[/\\]/).includes(INTERNAL_SNAPSHOT_DIR)
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

  // 产物栏显隐跟随产物：当前工作空间有产物自动展开，产物清空后自动收起。
  //
  // 不在 selector 里直接算这个布尔值：zustand 的 selector 在每次 store 变更时都会
  // 重新执行，而流式对话期间 store 每秒会更新数十次。产物列表有上限但仍可能上百条，
  // 每次都遍历一遍做路径匹配，等于让侧边栏白白吃掉整场对话的 CPU。
  // 改成订阅列表引用本身，只有产物真的增删时才重算。
  const artifacts = useStore(state => state.artifacts)
  const hasArtifacts = useMemo(() => {
    if (artifacts.length === 0) return false
    if (!workspacePath) return true
    return artifacts.some(item => pathStartsWith(item.path, workspacePath))
  }, [artifacts, workspacePath])

  // 记录上一次判定依据：产物有无未变化时保持现状，不覆盖用户手动折叠 / 展开的选择
  const artifactPresenceRef = useRef<{ workspacePath: string | null; hasArtifacts: boolean } | null>(null)

  useEffect(() => {
    const previous = artifactPresenceRef.current
    artifactPresenceRef.current = { workspacePath, hasArtifacts }

    const workspaceChanged = !previous || previous.workspacePath !== workspacePath
    // 切换工作空间或产物有无发生翻转时重新判定；其余情况交给用户自己控制
    if (!workspaceChanged && previous.hasArtifacts === hasArtifacts) return

    setArtifactCollapsed(!hasArtifacts)
  }, [hasArtifacts, workspacePath, setArtifactCollapsed])

  // Reveal active file in explorer
  const handleRevealActiveFile = useCallback(() => {
    if (activeFilePath) {
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
    }
  }, [activeFilePath])

  /**
   * 「当前工作空间是不是 Git 仓库」的探测结果缓存
   *
   * 仓库属性只在切换工作空间时可能改变，文件一有改动就重新探测没有意义：
   * 每次探测要 spawn 一个 git 子进程，失败还要重试三轮（每轮间隔 200ms）。
   * AI 连续写文件时这条链路会被高频触发，Windows 上进程启动开销高，足以
   * 在工具执行期间拖出可见的停顿。
   */
  const repoProbeRef = useRef<{ workspacePath: string; isRepo: boolean } | null>(null)

  /** Git 状态刷新的合并定时器：短时间内多次文件变更只落后一次查询 */
  const gitRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 更新 Git 状态（带重试逻辑）
  const updateGitStatus = useCallback(async () => {
    if (!workspacePath) {
      setGitStatus(null)
      setIsGitRepo(false)
      repoProbeRef.current = null
      return
    }

    gitService.setWorkspace(workspacePath)

    const cached = repoProbeRef.current
    if (cached && cached.workspacePath === workspacePath && cached.isRepo) {
      setIsGitRepo(true)
      setGitStatus(await gitService.getStatus())
      return
    }

    // 重试逻辑：有时工作空间刚设置时 git 命令可能失败
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

    repoProbeRef.current = { workspacePath, isRepo }
    setIsGitRepo(isRepo)

    if (isRepo) {
      const status = await gitService.getStatus()
      setGitStatus(status)
    }
  }, [workspacePath, setGitStatus, setIsGitRepo])

  /**
   * 合并 Git 状态刷新
   *
   * 文件树刷新与 Git 状态查询来自同一次文件变更，但后者贵得多（至少一次子进程）。
   * 变更事件在 Windows 上会为「目录延迟可见」补发一次，再加上文件监听自身的防抖，
   * 同一次写入能触达三次；这里统一收敛成一次查询。
   */
  const scheduleGitStatusUpdate = useCallback((delayMs = 400) => {
    if (gitRefreshTimerRef.current) clearTimeout(gitRefreshTimerRef.current)
    gitRefreshTimerRef.current = setTimeout(() => {
      gitRefreshTimerRef.current = null
      void updateGitStatus()
    }, delayMs)
  }, [updateGitStatus])

  // 切换工作空间时缓存必须失效，否则新目录会沿用上一个目录的探测结论
  useEffect(() => {
    repoProbeRef.current = null
  }, [workspacePath])

  useEffect(() => {
    return () => {
      if (gitRefreshTimerRef.current) clearTimeout(gitRefreshTimerRef.current)
      gitRefreshTimerRef.current = null
    }
  }, [])

  /**
   * 最近一次自动刷新的指纹
   *
   * 一次写入会经由几条独立的路触发刷新：工具主动通知（Windows 上还会补发一次）、
   * 主进程文件监听的批量事件、以及 .git 状态的延迟查询。它们描述的是同一批变更，
   * 却各自去读一遍目录、重建一次文件树；根目录命中时还要整棵树重渲染。这里按
   * 「受影响路径 + 删除路径 + 是否刷根」记指纹，短窗口内完全相同的自动刷新直接跳过。
   *
   * 手动刷新（resetTree）不参与去重，用户点刷新应当立刻生效。
   */
  const lastAutoRefreshRef = useRef<{ signature: string; at: number } | null>(null)

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

    if (!shouldResetTree && (affectedPaths.length > 0 || deletedPaths.length > 0)) {
      const signature = [
        [...affectedPaths].sort().join('|'),
        [...deletedPaths].sort().join('|'),
        shouldRefreshRoot ? 'root' : '',
      ].join('#')
      const now = Date.now()
      const last = lastAutoRefreshRef.current
      if (last && last.signature === signature && now - last.at < 300) {
        return
      }
      lastAutoRefreshRef.current = { signature, at: now }
    }

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

    // Git 状态查询比目录刷新贵得多（子进程），统一合并到一次延迟查询里
    scheduleGitStatusUpdate()
  }, [workspacePath, setFiles, scheduleGitStatusUpdate])

  // 工作空间变化时更新 Git 状态（只在初始化时执行一次）
  useEffect(() => {
    if (!workspacePath) return
    updateGitStatus()
  }, [workspacePath])

  // 挂载时（即用户切换到工作空间面板时）自动刷新一次目录
  // ExplorerView 在切换侧边栏面板时会卸载/重新挂载，因此此 effect 会在每次激活工作空间时触发
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
    let pendingChanges: Array<{ path: string; event: string }> = []

    const unsubscribe = api.file.onChanged((event: { event: 'create' | 'update' | 'delete'; path: string }) => {
      if (isInternalSnapshotPath(event.path, workspacePath)) return
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
        
        // 如果启用了自动刷新且是 .git 目录变化，延迟刷新 Git 状态。
        // 走统一的合并入口：它与目录刷新引起的 Git 查询是同一次变更的两种触发，
        // 各起一个定时器只会让同一次变更查询两次。
        if (config.git.autoRefresh && event.path.includes('.git')) {
          scheduleGitStatusUpdate(500)
        }
      }
    })

    return () => {
      unsubscribe()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [workspacePath, refreshFiles, scheduleGitStatusUpdate])

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

  /**
   * 导入到目标目录。
   *
   * mode 区分「导入文件」与「导入文件夹」：Windows / Linux 的打开对话框不能同时
   * 充当文件选择器与目录选择器（同时请求会退化为只选文件夹，文件全部置灰），
   * 所以拆成两个独立入口。
   */
  const handleImportToDirectory = useCallback(async (targetDir: string, mode: 'files' | 'dirs' = 'files') => {
    const selectedPaths = await api.file.selectForImport({
      title: t('explorer.importfilesorfolders', language as Language),
      allowFiles: mode === 'files',
      allowDirs: mode === 'dirs',
      mode,
      multiSelection: true,
    })
    if (!selectedPaths || selectedPaths.length === 0) return

    const result = await api.file.importIntoWorkspace(selectedPaths, targetDir)
    const failedCount = result.results?.filter(r => !r.success).length || 0
    // 全部成功时静默处理，只在出现失败时提示
    if (result.success && failedCount === 0) {
      await refreshFiles({ affectedPaths: [targetDir], refreshRoot: targetDir === workspacePath })
    } else {
      toast.error(
        t('explorer.failedtoimportitems', language as Language, {
          failedCount: failedCount || selectedPaths.length,
        }),
      )
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
      children: [
        {
          id: 'importFiles',
          label: t('contextMenu.importFileOnly', language as Language),
          icon: FilePlus,
          onClick: () => workspacePath && handleImportToDirectory(workspacePath, 'files'),
        },
        {
          id: 'importFolder',
          label: t('contextMenu.importFolderOnly', language as Language),
          icon: FolderPlus,
          onClick: () => workspacePath && handleImportToDirectory(workspacePath, 'dirs'),
        },
      ],
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
