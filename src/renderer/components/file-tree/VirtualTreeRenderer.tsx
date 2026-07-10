/**
 * 虚拟化文件树组件
 * 只渲染可见区域的节点，提升大目录性能
 */
import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  Edit2,
  Trash2,
  Copy,
  Clipboard,
  ExternalLink,
  Loader2,
  Globe,
  Terminal,
  Download,
  Upload,
  Share2,
  Eye,
  EyeOff,
  Play,
  FileDown,
  FileType,
  FileText
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { FileItem } from '@protocols'
import { BRAND } from '@shared/brand'
import {t, type Language} from '@renderer/i18n'
import { getDirPath, joinPath, pathEquals, pathStartsWith, normalizePath } from '@shared/toolkit/pathHelper'
import { formatShortcut, keybindingService } from '@services/keybindingAdapter'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import { TextField, FloatingMenu, ContextMenuItem } from '../ui'
import { directoryCacheService } from '@services/dirCacheAdapter'
import { explorerClipboardService, type ExplorerClipboardItem } from '@services/clipboardService'
import { FileIcon } from '../foundation/FileTypeIcon'
import { getFileType } from '../workspace-editor/FilePreviewPanel'
import type { TreeRefreshOptions } from '../explorer/panels/FileExplorer'

// 每个节点的高度（像素）
const ITEM_HEIGHT = 30
// 额外渲染的缓冲区节点数
const BUFFER_SIZE = 5

interface FlattenedNode {
  item: FileItem
  depth: number
  isExpanded: boolean
  hasChildren: boolean
  kind?: 'item' | 'loading'
}

interface VirtualFileTreeProps {
  items: FileItem[]
  treeVersion: number
  refreshSignal: { tick: number; affectedPaths: string[]; deletedPaths: string[] }
  onRefresh: (options?: TreeRefreshOptions) => void | Promise<void>
  creatingIn: { path: string; type: 'file' | 'folder' } | null
  onStartCreate: (path: string, type: 'file' | 'folder') => void
  onCancelCreate: () => void
  onCreateSubmit: (parentPath: string, name: string, type: 'file' | 'folder') => void
  onOpenTerminal: (cwd: string) => Promise<void>
}

export const VirtualFileTree = memo(function VirtualFileTree({
  items,
  treeVersion,
  refreshSignal,
  onRefresh,
  creatingIn,
  onStartCreate,
  onCancelCreate,
  onCreateSubmit,
  onOpenTerminal
}: VirtualFileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  // 子目录缓存
  const [childrenCache, setChildrenCache] = useState<Map<string, FileItem[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  const {
    expandedFolders,
    toggleFolder,
    expandFolder,
    openFile,
    setActiveFile,
    activeFilePath,
    language,
    workspacePath,
    activeScenarioId,
    showWorkspaceSystemDir,
    setShowWorkspaceSystemDir
  } = useStore(useShallow(s => ({
    expandedFolders: s.expandedFolders,
    toggleFolder: s.toggleFolder,
    expandFolder: s.expandFolder,
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    activeFilePath: s.activeFilePath,
    language: s.language,
    workspacePath: s.workspacePath,
    activeScenarioId: s.activeScenarioId,
    showWorkspaceSystemDir: s.showWorkspaceSystemDir,
    setShowWorkspaceSystemDir: s.setShowWorkspaceSystemDir
  })))

  // 焦点状态
  const [focusedPath, setFocusedPath] = useState<string | null>(null)

  // 定位高亮状态（闪烁动画）
  const [highlightPath, setHighlightPath] = useState<string | null>(null)

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    node: FlattenedNode
  } | null>(null)
  const [clipboardItem, setClipboardItem] = useState<ExplorerClipboardItem | null>(
    () => explorerClipboardService.getState().entry
  )

  // 重命名状态
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const dragSourcePathRef = useRef<string | null>(null)

  useEffect(() => {
    return explorerClipboardService.subscribe(state => {
      setClipboardItem(state.entry)
    })
  }, [])

  // 监听容器尺寸变化
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })

    observer.observe(container)
    setContainerHeight(container.clientHeight)

    return () => observer.disconnect()
  }, [])

  const childrenCacheRef = useRef(childrenCache)
  const loadingDirsRef = useRef(loadingDirs)
  
  useEffect(() => {
    childrenCacheRef.current = childrenCache
    loadingDirsRef.current = loadingDirs
  }, [childrenCache, loadingDirs])

  // 加载子目录
  const loadChildren = useCallback(async (
    path: string,
    options?: { forceRefresh?: boolean; showLoading?: boolean }
  ) => {
    const forceRefresh = options?.forceRefresh === true
    const hasCachedChildren = childrenCacheRef.current.has(path)
    if ((!forceRefresh && hasCachedChildren) || loadingDirsRef.current.has(path)) return

    const shouldShowLoading = options?.showLoading ?? !hasCachedChildren
    if (shouldShowLoading) {
      setLoadingDirs((prev) => new Set(prev).add(path))
    }
    try {
      const children = await directoryCacheService.getDirectory(path, forceRefresh)
      setChildrenCache((prev) => new Map(prev).set(path, children))

      // 预加载下一层
      const subDirs = children.filter((c) => c.isDirectory).slice(0, 3)
      if (subDirs.length > 0) {
        directoryCacheService.preload(subDirs.map((d) => d.path))
      }
    } finally {
      if (shouldShowLoading) {
        setLoadingDirs((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    }
  }, [])

  useEffect(() => {
    setChildrenCache(new Map())
    setLoadingDirs(new Set())
    setFocusedPath(null)
    setHighlightPath(null)
  }, [treeVersion, workspacePath])

  useEffect(() => {
    if (!refreshSignal.tick) return

    setChildrenCache((prev) => {
      let changed = false
      const next = new Map(prev)

      refreshSignal.affectedPaths.forEach((path) => {
        // 使用 pathEquals 比较展开状态（忽略大小写和分隔符差异）
        const isExpanded = Array.from(expandedFolders).some(fp => pathEquals(fp, path))
        if (!isExpanded) {
          // 在 childrenCache 中查找匹配的 key（可能因分隔符差异而不匹配）
          for (const key of next.keys()) {
            if (pathEquals(key, path)) {
              next.delete(key)
              changed = true
              break
            }
          }
        }
      })

      refreshSignal.deletedPaths.forEach((deletedPath) => {
        for (const key of next.keys()) {
          if (pathEquals(key, deletedPath) || pathStartsWith(key, deletedPath)) {
            next.delete(key)
            changed = true
          }
        }
      })

      return changed ? next : prev
    })

    refreshSignal.affectedPaths.forEach((path) => {
      // 使用 pathEquals 检查是否已展开
      const isExpanded = Array.from(expandedFolders).some(fp => pathEquals(fp, path))
      if (isExpanded) {
        void loadChildren(path, { forceRefresh: true, showLoading: false })
      }
    })
  }, [refreshSignal, expandedFolders, loadChildren])

  // 展开文件夹时加载子目录
  useEffect(() => {
    expandedFolders.forEach((path) => {
      if (!childrenCacheRef.current.has(path)) {
        loadChildren(path)
      }
    })
  }, [expandedFolders, loadChildren])

  // 滚动到指定文件的状态（使用文件路径作为触发器）
  const [scrollToFile, setScrollToFile] = useState<string | null>(null)

  // 加载目录并返回子项（直接返回，不依赖状态更新）
  const loadDirectoryChildren = useCallback(async (dirPath: string): Promise<FileItem[]> => {
    // 先检查缓存
    const cached = childrenCacheRef.current.get(dirPath)
    if (cached) return cached

    try {
      const children = await directoryCacheService.getDirectory(dirPath)
      // 更新缓存状态
      setChildrenCache((prev) => new Map(prev).set(dirPath, children))
      return children
    } catch {
      return []
    }
  }, [])

  // 展开文件所在的所有父目录
  const revealFile = useCallback(async (filePath: string) => {
    if (!workspacePath) return

    const normalizedFilePath = normalizePath(filePath)
    const normalizedWorkspace = normalizePath(workspacePath)

    // 收集需要展开的目录路径（从工作区根目录开始，到文件的直接父目录）
    const pathsToExpand: string[] = []
    let currentPath = getDirPath(normalizedFilePath)

    while (currentPath && currentPath.length > normalizedWorkspace.length) {
      pathsToExpand.unshift(currentPath)
      const parentPath = getDirPath(currentPath)
      if (parentPath === currentPath) break
      currentPath = parentPath
    }

    // 从根目录的 items 开始，逐级查找并展开
    let currentItems: FileItem[] = items
    const pathsToExpandActual: string[] = []

    for (const normalizedPath of pathsToExpand) {
      // 在当前层级的 items 中查找匹配的目录
      const targetDir = currentItems.find(item =>
        item.isDirectory && pathEquals(item.path, normalizedPath)
      )

      if (targetDir) {
        pathsToExpandActual.push(targetDir.path)

        // 展开该目录
        const isExpanded = expandedFolders.has(targetDir.path)
        if (!isExpanded) {
          expandFolder(targetDir.path)
        }

        // 加载子目录内容（直接获取返回值，不等待状态更新）
        currentItems = await loadDirectoryChildren(targetDir.path)
      } else {
        // 找不到匹配的目录，可能路径格式不一致，尝试直接使用 normalized 路径
        pathsToExpandActual.push(normalizedPath)
        expandFolder(normalizedPath)
        currentItems = await loadDirectoryChildren(normalizedPath)
      }
    }

    setFocusedPath(filePath)
    setScrollToFile(filePath)
  }, [workspacePath, items, expandedFolders, expandFolder, loadDirectoryChildren])

  // 监听 "Reveal in Explorer" 事件
  useEffect(() => {
    const handleReveal = () => {
      if (activeFilePath && workspacePath) {
        revealFile(activeFilePath)
      }
    }
    // 支持定位任意文件（通过 detail.filePath 传入）
    const handleRevealFile = (e: Event) => {
      const customEvent = e as CustomEvent<{ filePath: string }>
      if (customEvent.detail?.filePath && workspacePath) {
        revealFile(customEvent.detail.filePath)
      }
    }
    window.addEventListener('explorer:reveal-active-file', handleReveal)
    window.addEventListener('explorer:reveal-file', handleRevealFile)
    return () => {
      window.removeEventListener('explorer:reveal-active-file', handleReveal)
      window.removeEventListener('explorer:reveal-file', handleRevealFile)
    }
  }, [activeFilePath, workspacePath, revealFile])

  // 扁平化树结构（只包含可见节点）
  const flattenedNodes = useMemo(() => {
    const result: FlattenedNode[] = []

    const sortItems = (items: FileItem[]) => {
      return [...items]
        .filter(item => showWorkspaceSystemDir || !(item.isDirectory && item.name === '.aweeclaw'))
        .sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
          return a.isDirectory ? -1 : 1
        })
    }

    const traverse = (items: FileItem[], depth: number) => {
      for (const item of sortItems(items)) {
        const isExpanded = expandedFolders.has(item.path)
        const children = childrenCache.get(item.path)
        const hasChildren = item.isDirectory

        result.push({ item, depth, isExpanded, hasChildren })

        // 如果是正在创建的目录，添加创建输入框占位
        if (creatingIn?.path === item.path && isExpanded) {
          result.push({
            item: { name: '__creating__', path: `${item.path}/__creating__`, isDirectory: false },
            depth: depth + 1,
            isExpanded: false,
            hasChildren: false
          })
        }

        if (item.isDirectory && isExpanded && children) {
          traverse(children, depth + 1)
        } else if (item.isDirectory && isExpanded && loadingDirs.has(item.path)) {
          for (let i = 0; i < 4; i++) {
            result.push({
              item: {
                name: `__loading__${i}`,
                path: `${item.path}/__loading__${i}`,
                isDirectory: false
              },
              depth: depth + 1,
              isExpanded: false,
              hasChildren: false,
              kind: 'loading'
            })
          }
        }
      }
    }

    // 根目录创建输入框
    if (creatingIn?.path === workspacePath) {
      result.push({
        item: { name: '__creating__', path: `${workspacePath}/__creating__`, isDirectory: false },
        depth: 0,
        isExpanded: false,
        hasChildren: false
      })
    }

    traverse(items, 0)
    return result
  }, [items, expandedFolders, childrenCache, creatingIn, workspacePath, showWorkspaceSystemDir])

  // 处理滚动到目标文件（必须在 flattenedNodes 定义之后）
  useEffect(() => {
    if (!scrollToFile) return

    const index = flattenedNodes.findIndex(node => pathEquals(node.item.path, scrollToFile))

    if (index !== -1 && containerRef.current) {
      const top = index * ITEM_HEIGHT
      containerRef.current.scrollTo({
        top: Math.max(0, top - containerHeight / 2),
        behavior: 'smooth'
      })

      // 触发闪烁高亮动画
      setHighlightPath(scrollToFile)
      setTimeout(() => setHighlightPath(null), 2000)
    }

    setScrollToFile(null)
  }, [scrollToFile, flattenedNodes, containerHeight])

  // 计算可见范围
  const visibleRange = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_SIZE)
    const endIndex = Math.min(
      flattenedNodes.length,
      Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER_SIZE
    )
    return { startIndex, endIndex }
  }, [scrollTop, containerHeight, flattenedNodes.length])

  // 可见节点
  const visibleNodes = useMemo(() => {
    return flattenedNodes.slice(visibleRange.startIndex, visibleRange.endIndex)
  }, [flattenedNodes, visibleRange])

  // 总高度
  const totalHeight = flattenedNodes.length * ITEM_HEIGHT

  // 滚动处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // 点击节点
  const handleNodeClick = useCallback(async (node: FlattenedNode) => {
    setFocusedPath(node.item.path)

    if (renamingPath === node.item.path) return

    if (node.item.isDirectory) {
      toggleFolder(node.item.path)
      if (!expandedFolders.has(node.item.path)) {
        loadChildren(node.item.path)
      }
    } else {
      // 检查文件类型
      const fileType = getFileType(node.item.path)

      if (fileType === 'image' || fileType === 'binary') {
        // 图片和二进制文件不需要读取内容，直接打开
        openFile(node.item.path, '')
        setActiveFile(node.item.path)
      } else {
        const content = await api.file.read(node.item.path)
        if (content !== null) {
          openFile(node.item.path, content)
          setActiveFile(node.item.path)
        } else {
          // 文件读取失败，可能是二进制文件或权限问题
          toast.warning(t('error.fileNotFound', language, { path: node.item.name }))
        }
      }
    }
  }, [renamingPath, toggleFolder, expandedFolders, loadChildren, openFile, setActiveFile, language])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FlattenedNode) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.item.name === '__creating__') return
    setFocusedPath(node.item.path)
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  // 菜单操作
  const handleDelete = useCallback(async (node: FlattenedNode) => {
    const confirmed = await globalConfirm({
      title: t('contextMenu.delete', language as Language),
      message: t('contextMenu.confirmDelete', language as Language, { name: node.item.name }),
      confirmText: t('contextMenu.delete', language as Language),
      cancelText: t('cancel', language as Language),
      variant: 'danger',
    })
    if (confirmed) {
      await api.file.delete(node.item.path)
      directoryCacheService.invalidate(getDirPath(node.item.path))
      setChildrenCache((prev) => {
        const next = new Map(prev)
        next.delete(node.item.path)
        return next
      })
      onRefresh({
        affectedPaths: [getDirPath(node.item.path)],
        deletedPaths: [node.item.path],
        refreshRoot: pathEquals(getDirPath(node.item.path), workspacePath || ''),
      })
    }
  }, [language, onRefresh, workspacePath])

  const handleRenameStart = useCallback((node: FlattenedNode) => {
    setRenamingPath(node.item.path)
    setRenameValue(node.item.name)
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null)
      return
    }

    const node = flattenedNodes.find((n) => n.item.path === renamingPath)
    if (!node || renameValue === node.item.name) {
      setRenamingPath(null)
      return
    }

    const newPath = joinPath(getDirPath(renamingPath), renameValue)
    const success = await api.file.rename(renamingPath, newPath)
    if (success) {
      directoryCacheService.invalidate(getDirPath(renamingPath))
      setChildrenCache((prev) => {
        const next = new Map(prev)
        next.delete(renamingPath)
        return next
      })
      onRefresh({
        affectedPaths: [getDirPath(renamingPath), getDirPath(newPath)],
        deletedPaths: [renamingPath],
        refreshRoot: pathEquals(getDirPath(renamingPath), workspacePath || ''),
      })
    }
    setRenamingPath(null)
  }, [renamingPath, renameValue, flattenedNodes, onRefresh, workspacePath])

  // 全局快捷键处理 (F2 重命名)
  const handleCopyItem = useCallback((node: FlattenedNode) => {
    explorerClipboardService.setItem({
      path: node.item.path,
      name: node.item.name,
      isDirectory: node.item.isDirectory,
      copiedAt: Date.now(),
    })
    toast.success(node.item.isDirectory
      ? (t('file-tree.foldercopied', language as Language))
      : (t('file-tree.filecopied', language as Language)))
  }, [language])

  const getCopyDestinationPath = useCallback(async (targetDirectoryPath: string, item: ExplorerClipboardItem) => {
    const nameParts = item.isDirectory ? null : item.name.match(/^(.*?)(\.[^.]*)?$/)
    const baseName = item.isDirectory ? item.name : (nameParts?.[1] || item.name)
    const extension = item.isDirectory ? '' : (nameParts?.[2] || '')

    let candidateName = `${baseName} - 副本${extension}`
    let candidatePath = joinPath(targetDirectoryPath, candidateName)
    let counter = 2

    while (await api.file.exists(candidatePath)) {
      candidateName = `${baseName} - 副本 ${counter}${extension}`
      candidatePath = joinPath(targetDirectoryPath, candidateName)
      counter += 1
    }

    return candidatePath
  }, [])

  const handlePasteIntoDirectory = useCallback(async (targetDirectoryPath: string) => {
    const item = explorerClipboardService.getState().entry
    if (!item) return

    const normalizedSourcePath = normalizePath(item.path)
    const normalizedTargetDirectoryPath = normalizePath(targetDirectoryPath)
    if (!normalizedSourcePath || !normalizedTargetDirectoryPath) return

    if (item.isDirectory && normalizedTargetDirectoryPath.startsWith(`${normalizedSourcePath}/`)) {
      toast.error(t('file-tree.cannotpasteafolderinside', language as Language))
      return
    }

    const destinationPath = await getCopyDestinationPath(targetDirectoryPath, item)
    const success = await api.file.copy(item.path, destinationPath)
    if (!success) {
      toast.error(t('file-tree.pastefailed', language as Language))
      return
    }

    directoryCacheService.invalidate(targetDirectoryPath)
    onRefresh({
      affectedPaths: [targetDirectoryPath],
      refreshRoot: pathEquals(targetDirectoryPath, workspacePath || ''),
    })
    toast.success(item.isDirectory
      ? (t('file-tree.folderpasted', language as Language))
      : (t('file-tree.filepasted', language as Language)))
  }, [getCopyDestinationPath, language, onRefresh, workspacePath])

  const handlePasteForNode = useCallback((node: FlattenedNode) => {
    const targetDirectoryPath = node.item.isDirectory ? node.item.path : getDirPath(node.item.path)
    void handlePasteIntoDirectory(targetDirectoryPath)
  }, [handlePasteIntoDirectory])

  useEffect(() => {
    const handlePasteInto = (event: Event) => {
      const customEvent = event as CustomEvent<{ targetDirectoryPath?: string }>
      const targetDirectoryPath = customEvent.detail?.targetDirectoryPath
      if (!targetDirectoryPath) return
      void handlePasteIntoDirectory(targetDirectoryPath)
    }

    window.addEventListener('explorer:paste-into', handlePasteInto)
    return () => {
      window.removeEventListener('explorer:paste-into', handlePasteInto)
    }
  }, [handlePasteIntoDirectory])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'F2' && focusedPath && !renamingPath) {
      e.preventDefault()
      const node = flattenedNodes.find(n => pathEquals(n.item.path, focusedPath))
      if (node) {
        handleRenameStart(node)
      }
      return
    }

    if (keybindingService.matches(e, 'explorer.copy') && focusedPath) {
      const node = flattenedNodes.find(n => pathEquals(n.item.path, focusedPath))
      if (node) {
        e.preventDefault()
        handleCopyItem(node)
      }
      return
    }

    if (keybindingService.matches(e, 'explorer.paste') && clipboardItem) {
      e.preventDefault()
      const node = focusedPath
        ? flattenedNodes.find(n => pathEquals(n.item.path, focusedPath))
        : null

      if (node) {
        handlePasteForNode(node)
      } else if (workspacePath) {
        void handlePasteIntoDirectory(workspacePath)
      }
    }
  }, [clipboardItem, focusedPath, flattenedNodes, handleCopyItem, handlePasteForNode, handlePasteIntoDirectory, renamingPath, workspacePath, handleRenameStart])

  const handleCopyPath = useCallback((node: FlattenedNode) => {
    navigator.clipboard.writeText(node.item.path)
    toast.success(t('pathCopied', language) || 'Path copied')
  }, [language])

  const handleCopyRelativePath = useCallback((node: FlattenedNode) => {
    if (workspacePath) {
      const relativePath = node.item.path.replace(workspacePath, '').replace(/^[\\/]/, '')
      navigator.clipboard.writeText(relativePath)
      toast.success(t('pathCopied', language) || 'Path copied')
    }
  }, [workspacePath, language])

  const handleRevealInExplorer = useCallback((node: FlattenedNode) => {
    api.file.showInFolder(node.item.path)
  }, [])

  const handleOpenInBrowser = useCallback(async (node: FlattenedNode) => {
    const success = await api.file.openInBrowser(node.item.path)
    if (!success) {
      toast.error(t('failedToOpenInBrowser', language) || 'Failed to open in browser')
    }
  }, [language])

  const handleNewFile = useCallback((node: FlattenedNode) => {
    if (node.item.isDirectory) {
      expandFolder(node.item.path)
      loadChildren(node.item.path)
      onStartCreate(node.item.path, 'file')
    }
  }, [expandFolder, loadChildren, onStartCreate])

  const handleNewFolder = useCallback((node: FlattenedNode) => {
    if (node.item.isDirectory) {
      expandFolder(node.item.path)
      loadChildren(node.item.path)
      onStartCreate(node.item.path, 'folder')
    }
  }, [expandFolder, loadChildren, onStartCreate])

  const moveItemToDirectory = useCallback(async (sourcePath: string, targetDirectoryPath: string) => {
    const normalizedSourcePath = normalizePath(sourcePath)
    const normalizedTargetDirectoryPath = normalizePath(targetDirectoryPath)

    if (!normalizedSourcePath || !normalizedTargetDirectoryPath) return
    if (normalizedSourcePath === normalizedTargetDirectoryPath) return
    if (normalizedTargetDirectoryPath.startsWith(`${normalizedSourcePath}/`)) return

    const sourceName = sourcePath.split(/[/\\]/).pop()
    if (!sourceName) return

    const sourceParentPath = getDirPath(sourcePath)
    const destinationPath = joinPath(targetDirectoryPath, sourceName)
    if (pathEquals(sourcePath, destinationPath)) return

    const success = await api.file.rename(sourcePath, destinationPath)
    if (success) {
      directoryCacheService.invalidate(sourceParentPath)
      directoryCacheService.invalidate(targetDirectoryPath)
      setChildrenCache((prev) => {
        const next = new Map(prev)
        next.delete(sourcePath)
        return next
      })
      expandFolder(targetDirectoryPath)
      onRefresh({
        affectedPaths: [sourceParentPath, targetDirectoryPath],
        deletedPaths: [sourcePath],
        refreshRoot: pathEquals(sourceParentPath, workspacePath || '') || pathEquals(targetDirectoryPath, workspacePath || ''),
      })
    } else {
      toast.error('Move failed')
    }
  }, [expandFolder, onRefresh, workspacePath])

  const handleDropOnDirectory = useCallback(async (targetNode: FlattenedNode, sourcePath: string) => {
    if (!targetNode.item.isDirectory) return
    await moveItemToDirectory(sourcePath, targetNode.item.path)
  }, [moveItemToDirectory])

  const handleDropNextToNode = useCallback(async (targetNode: FlattenedNode, sourcePath: string) => {
    const targetDirectoryPath = targetNode.item.isDirectory ? targetNode.item.path : getDirPath(targetNode.item.path)
    await moveItemToDirectory(sourcePath, targetDirectoryPath)
  }, [moveItemToDirectory])

  const handleOpenTerminalHere = useCallback((node: FlattenedNode) => {
    const cwd = node.item.isDirectory ? node.item.path : getDirPath(node.item.path)
    void onOpenTerminal(cwd)
  }, [onOpenTerminal])

  /**
   * 检测目录的项目类型并返回对应的运行命令。
   * 支持：Node.js (npm/yarn/pnpm)、Python (pyproject.toml/requirements.txt)、
   *      Go (go.mod)、Rust (Cargo.toml)、Java (pom.xml/build.gradle)
   */
  const detectProjectRunCommand = useCallback(async (dirPath: string): Promise<{
    command: string
    label: string
    /** 运行模式：terminal=在终端中执行命令，browser=在浏览器中打开文件 */
    runMode: 'terminal' | 'browser'
    /** browser 模式下要打开的文件路径 */
    htmlPath?: string
  } | null> => {
    try {
      const entries = await api.file.readDir(dirPath)
      const fileNames = new Set(entries?.map(e => e.name) || [])

      // Node.js 项目
      if (fileNames.has('package.json')) {
        // 优先使用 pnpm，其次 yarn，最后 npm
        if (fileNames.has('pnpm-lock.yaml')) return { command: 'pnpm run dev', label: 'pnpm run dev', runMode: 'terminal' }
        if (fileNames.has('yarn.lock')) return { command: 'yarn dev', label: 'yarn dev', runMode: 'terminal' }
        return { command: 'npm run dev', label: 'npm run dev', runMode: 'terminal' }
      }
      // Python 项目
      if (fileNames.has('pyproject.toml') || fileNames.has('requirements.txt')) {
        if (fileNames.has('main.py')) return { command: 'python main.py', label: 'python main.py', runMode: 'terminal' }
        if (fileNames.has('app.py')) return { command: 'python app.py', label: 'python app.py', runMode: 'terminal' }
        return { command: 'python main.py', label: 'python main.py', runMode: 'terminal' }
      }
      // Go 项目
      if (fileNames.has('go.mod')) {
        return { command: 'go run .', label: 'go run .', runMode: 'terminal' }
      }
      // Rust 项目
      if (fileNames.has('Cargo.toml')) {
        return { command: 'cargo run', label: 'cargo run', runMode: 'terminal' }
      }
      // Java Maven 项目
      if (fileNames.has('pom.xml')) {
        return { command: 'mvn spring-boot:run', label: 'mvn spring-boot:run', runMode: 'terminal' }
      }
      // Java Gradle 项目
      if (fileNames.has('build.gradle') || fileNames.has('build.gradle.kts')) {
        return { command: './gradlew run', label: './gradlew run', runMode: 'terminal' }
      }
      // 静态 HTML 项目：目录中有 .html 文件但无项目配置文件
      const htmlFiles = entries?.filter(e => !e.isDirectory && /\.html?$/i.test(e.name)) || []
      if (htmlFiles.length > 0) {
        // 优先使用 index.html
        const indexHtml = htmlFiles.find(f => /^index\.html?$/i.test(f.name)) || htmlFiles[0]
        return {
          command: '',
          label: indexHtml.name,
          runMode: 'browser',
          htmlPath: joinPath(dirPath, indexHtml.name),
        }
      }
    } catch {
      // 读取目录失败，忽略
    }
    return null
  }, [])

  /** 运行项目：根据项目类型选择最佳运行方式（终端命令 / 浏览器打开） */
  const handleRunProject = useCallback(async (node: FlattenedNode) => {
    const dirPath = node.item.isDirectory ? node.item.path : getDirPath(node.item.path)
    const runInfo = await detectProjectRunCommand(dirPath)
    if (!runInfo) {
      toast.error(t('contextMenu.noRunScriptDetected', language as Language) || 'No run script detected')
      return
    }

    // 静态 HTML：在浏览器中打开，无需终端
    if (runInfo.runMode === 'browser' && runInfo.htmlPath) {
      const success = await api.file.openInBrowser(runInfo.htmlPath)
      if (!success) {
        toast.error(t('failedToOpenInBrowser', language as Language) || 'Failed to open in browser')
      }
      return
    }

    // 终端模式：关闭全屏页面，显示编辑器区 + 终端面板
    const { terminalManager } = await import('@services/TerminalAdapter')
    const store = useStore.getState()
    // 关闭设置/欢迎等全屏页面，回到编辑器主界面
    store.closeAllFullPages()
    // 显示底部 dock 的终端面板
    store.setTerminalVisible(true)
    const termId = await terminalManager.createTerminal({
      cwd: dirPath,
      name: runInfo.label,
    })
    // 发送运行命令到终端（附加换行符执行）
    terminalManager.writeToTerminal(termId, runInfo.command + '\r')
  }, [detectProjectRunCommand, language])

  /** 将 Markdown 文件转换为指定格式 */
  const handleConvertFile = useCallback(async (node: FlattenedNode, targetFormat: 'docx' | 'pdf') => {
    const sourcePath = node.item.path
    const targetPath = sourcePath.replace(/\.[^.]+$/, `.${targetFormat}`)

    toast.info(t('contextMenu.converting', language as Language) || `Converting to ${targetFormat}...`)

    try {
      // 调用主进程的文件转换 IPC（如果可用）
      const convertFn = (api.file as any).convertDocument as ((src: string, fmt: string, dst: string) => Promise<boolean>) | undefined
      const result = convertFn ? await convertFn(sourcePath, targetFormat, targetPath) : false
      if (result) {
        toast.success(t('contextMenu.convertSuccess', language as Language) || `Converted to ${targetFormat}`)
        // 刷新工作区
        window.dispatchEvent(new CustomEvent('workspace:files-changed', {
          detail: { affectedPaths: [getDirPath(sourcePath)], refreshRoot: false },
        }))
      } else {
        // IPC 不可用时，通过 AI Agent 执行转换
        toast.info(t('contextMenu.convertViaAgent', language as Language) || 'Launching AI agent to convert...')
        // 通过全局事件触发 AI 聊天发送（ChatPanel 监听 'chat-send-message' 事件）
        const prompt = `请将 Markdown 文件 "${sourcePath}" 转换为 ${targetFormat.toUpperCase()} 格式，保存到 "${targetPath}"。要求：1) 保留原文档的标题层级、列表、代码块、表格等格式；2) 如果需要安装转换工具（如 pandoc），请先安装再执行转换；3) 转换完成后告诉我输出文件的路径。`
        window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: prompt } }))
      }
    } catch (e) {
      toast.error(t('contextMenu.convertFailed', language as Language) || `Conversion failed: ${e}`)
    }
  }, [language])

  const handleImportIntoFolder = useCallback(async (node: FlattenedNode) => {
    const targetDir = node.item.isDirectory ? node.item.path : getDirPath(node.item.path)
    const selectedPaths = await api.file.selectForImport({
      title: t('file-tree.importfilesorfolders', language as Language),
      allowFiles: true,
      allowDirs: true,
      multiSelection: true,
    })
    if (!selectedPaths || selectedPaths.length === 0) return

    const result = await api.file.importIntoWorkspace(selectedPaths, targetDir)
    if (result.success) {
      toast.success(t('file-tree.successfullyimporteditems', language as Language, { count: selectedPaths.length }))
      if (node.item.isDirectory) {
        expandFolder(targetDir)
      }
      onRefresh({
        affectedPaths: [targetDir],
        refreshRoot: targetDir === workspacePath,
      })
    } else {
      const failedCount = result.results?.filter(r => !r.success).length || selectedPaths.length
      toast.error(t('file-tree.failedtoimportitems', language as Language, { failedCount }))
      if (result.results?.some(r => r.success)) {
        onRefresh({
          affectedPaths: [targetDir],
          refreshRoot: targetDir === workspacePath,
        })
      }
    }
  }, [language, expandFolder, onRefresh, workspacePath])

  const handleExportFromNode = useCallback(async (node: FlattenedNode) => {
    const sourcePath = node.item.path
    const targetDir = await api.file.selectForExport({
      title: t('file-tree.exportto', language as Language),
      defaultPath: getDirPath(sourcePath),
    })
    if (!targetDir) return

    const result = await api.file.exportFromWorkspace(sourcePath, targetDir)
    if (result.success) {
      toast.success(t('file-tree.successfullyexportedto', language as Language, { target: result.target }))
    } else {
      toast.error(t('file-tree.exportfailed', language as Language, { error: result.error }))
    }
  }, [language])

  const handleShareItem = useCallback(async (node: FlattenedNode) => {
    const result = await api.file.shareItem([node.item.path])
    if (!result.success) {
      if (result.error === 'Share is only supported on macOS') {
        toast.warning(t('file-tree.shareisonlysupportedon', language as Language))
      } else {
        toast.error(t('file-tree.sharefailed', language as Language, { error: result.error }))
      }
    }
  }, [language])

  /** 同步检查目录是否有可运行的项目文件（基于缓存，未缓存时乐观显示） */
  const hasRunnableProject = useCallback((dirPath: string): boolean => {
    const children = childrenCache.get(dirPath)
    // 未缓存时乐观显示，由 handleRunProject 兜底处理
    if (!children) return true
    const fileNames = new Set(children.map(c => c.name))
    // 项目配置文件
    if (fileNames.has('package.json') || fileNames.has('pyproject.toml') ||
        fileNames.has('requirements.txt') || fileNames.has('go.mod') ||
        fileNames.has('Cargo.toml') || fileNames.has('pom.xml') ||
        fileNames.has('build.gradle') || fileNames.has('build.gradle.kts')) {
      return true
    }
    // 静态 HTML 文件
    return children.some(c => !c.isDirectory && /\.html?$/i.test(c.name))
  }, [childrenCache])

  // 聚焦重命名输入框
  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingPath])

  // 构建右键菜单项
  const getContextMenuItems = useCallback((node: FlattenedNode): ContextMenuItem[] => {
    const contextMenuLanguage = language as Language
    const isWorkspaceEditor = activeScenarioId === 'dev-assistant'

    if (node.item.isDirectory) {
      const dirItems: ContextMenuItem[] = []
      // 只在有可运行文件时显示"运行项目"
      if (hasRunnableProject(node.item.path)) {
        dirItems.push({ id: 'runProject', label: t('contextMenu.runProject', contextMenuLanguage), icon: Play, onClick: () => handleRunProject(node) })
        dirItems.push({ id: 'sepRun', label: '', separator: true })
      }
      dirItems.push(
        { id: 'newFile', label: t('newFile', contextMenuLanguage), icon: FilePlus, onClick: () => handleNewFile(node) },
        { id: 'newFolder', label: t('newFolder', contextMenuLanguage), icon: FolderPlus, onClick: () => handleNewFolder(node) },
        { id: 'sep1', label: '', separator: true },
        { id: 'import', label: t('contextMenu.importFiles', contextMenuLanguage), icon: Download, onClick: () => handleImportIntoFolder(node) },
        { id: 'export', label: t('contextMenu.exportFiles', contextMenuLanguage), icon: Upload, onClick: () => handleExportFromNode(node) },
        { id: 'share', label: t('contextMenu.shareItem', contextMenuLanguage), icon: Share2, onClick: () => handleShareItem(node) },
        ...(isWorkspaceEditor
          ? [
              { id: 'sep2', label: '', separator: true } as ContextMenuItem,
              { id: 'openTerminal', label: t('contextMenu.openIntegratedTerminalHere', contextMenuLanguage), icon: Terminal, onClick: () => handleOpenTerminalHere(node) } as ContextMenuItem,
            ]
          : []),
        { id: 'sepTerminal', label: '', separator: true },
        { id: 'copy', label: t('contextMenu.copy', contextMenuLanguage), icon: Copy, shortcut: formatShortcut('Ctrl+C'), onClick: () => handleCopyItem(node) },
        { id: 'paste', label: t('paste', contextMenuLanguage), icon: Clipboard, shortcut: formatShortcut('Ctrl+V'), disabled: !clipboardItem, onClick: () => handlePasteForNode(node) },
        { id: 'sepClipboard', label: '', separator: true },
        { id: 'rename', label: t('contextMenu.rename', contextMenuLanguage), icon: Edit2, onClick: () => handleRenameStart(node) },
        { id: 'delete', label: t('contextMenu.delete', contextMenuLanguage), icon: Trash2, danger: true, onClick: () => handleDelete(node) },
        { id: 'sep3', label: '', separator: true },
        { id: 'copyPath', label: t('contextMenu.copyPath', contextMenuLanguage), icon: Copy, onClick: () => handleCopyPath(node) },
        { id: 'copyRelPath', label: t('contextMenu.copyRelativePath', contextMenuLanguage), icon: Clipboard, onClick: () => handleCopyRelativePath(node) },
        { id: 'reveal', label: t('contextMenu.revealInExplorer', contextMenuLanguage), icon: ExternalLink, onClick: () => handleRevealInExplorer(node) },
        { id: 'sepHidden', label: '', separator: true },
        { id: 'toggleHidden', label: showWorkspaceSystemDir ? t('contextMenu.hideWorkspaceSystemDir', contextMenuLanguage) : t('contextMenu.showWorkspaceSystemDir', contextMenuLanguage), icon: showWorkspaceSystemDir ? EyeOff : Eye, onClick: () => setShowWorkspaceSystemDir(!showWorkspaceSystemDir) },
      )
      return dirItems
    }
    const isHtmlFile = node.item.name.toLowerCase().endsWith('.html') ||
      node.item.name.toLowerCase().endsWith('.htm')
    const isMdFile = node.item.name.toLowerCase().endsWith('.md') ||
      node.item.name.toLowerCase().endsWith('.markdown')

    const items: ContextMenuItem[] = []

    // 在浏览器中打开（HTML 文件）— 放在最前面
    if (isHtmlFile) {
      items.push({ id: 'openInBrowser', label: t('contextMenu.openInBrowser', contextMenuLanguage), icon: Globe, onClick: () => handleOpenInBrowser(node) })
      items.push({ id: 'sepHtml', label: '', separator: true })
    }

    // 转换为（Markdown 文件）— 二级菜单：Word / PDF
    if (isMdFile) {
      items.push({
        id: 'convertTo',
        label: t('contextMenu.convertTo', contextMenuLanguage),
        icon: FileType,
        children: [
          { id: 'convertToDocx', label: 'Word', icon: FileText, onClick: () => handleConvertFile(node, 'docx') },
          { id: 'convertToPdf', label: 'PDF', icon: FileDown, onClick: () => handleConvertFile(node, 'pdf') },
        ],
      })
      items.push({ id: 'sepConvert', label: '', separator: true })
    }

    items.push(
      { id: 'export', label: t('contextMenu.exportFiles', contextMenuLanguage), icon: Upload, onClick: () => handleExportFromNode(node) },
      { id: 'share', label: t('contextMenu.shareItem', contextMenuLanguage), icon: Share2, onClick: () => handleShareItem(node) },
      ...(isWorkspaceEditor
        ? [
            { id: 'sep1', label: '', separator: true } as ContextMenuItem,
            { id: 'openTerminal', label: t('contextMenu.openIntegratedTerminalHere', contextMenuLanguage), icon: Terminal, onClick: () => handleOpenTerminalHere(node) } as ContextMenuItem,
          ]
        : []),
      { id: 'sepTerminal', label: '', separator: true },
      { id: 'copy', label: t('contextMenu.copy', contextMenuLanguage), icon: Copy, shortcut: formatShortcut('Ctrl+C'), onClick: () => handleCopyItem(node) },
      { id: 'paste', label: t('paste', contextMenuLanguage), icon: Clipboard, shortcut: formatShortcut('Ctrl+V'), disabled: !clipboardItem, onClick: () => handlePasteForNode(node) },
      { id: 'sepClipboard', label: '', separator: true },
      { id: 'rename', label: t('contextMenu.rename', contextMenuLanguage), icon: Edit2, onClick: () => handleRenameStart(node) },
      { id: 'delete', label: t('contextMenu.delete', contextMenuLanguage), icon: Trash2, danger: true, onClick: () => handleDelete(node) },
      { id: 'sep2', label: '', separator: true },
      { id: 'copyPath', label: t('contextMenu.copyPath', contextMenuLanguage), icon: Copy, onClick: () => handleCopyPath(node) },
      { id: 'copyRelPath', label: t('contextMenu.copyRelativePath', contextMenuLanguage), icon: Clipboard, onClick: () => handleCopyRelativePath(node) },
      { id: 'reveal', label: t('contextMenu.revealInExplorer', contextMenuLanguage), icon: ExternalLink, onClick: () => handleRevealInExplorer(node) },
    )

    items.push({ id: 'sepHidden', label: '', separator: true })
    items.push({ id: 'toggleHidden', label: showWorkspaceSystemDir ? t('contextMenu.hideWorkspaceSystemDir', contextMenuLanguage) : t('contextMenu.showWorkspaceSystemDir', contextMenuLanguage), icon: showWorkspaceSystemDir ? EyeOff : Eye, onClick: () => setShowWorkspaceSystemDir(!showWorkspaceSystemDir) })

    return items
  }, [activeScenarioId, clipboardItem, handleNewFile, handleNewFolder, handleOpenTerminalHere, handleCopyItem, handlePasteForNode, handleRenameStart, handleDelete, handleCopyPath, handleCopyRelativePath, handleRevealInExplorer, handleOpenInBrowser, handleImportIntoFolder, handleExportFromNode, handleShareItem, handleRunProject, handleConvertFile, hasRunnableProject, showWorkspaceSystemDir, setShowWorkspaceSystemDir, language])

  // 渲染单个节点
  const renderNode = (node: FlattenedNode, index: number) => {
    const { item, depth, isExpanded } = node
    const isActive = pathEquals(activeFilePath || '', item.path)
    const isFocused = focusedPath ? pathEquals(focusedPath, item.path) && !isActive : false
    const isHighlighted = highlightPath ? pathEquals(highlightPath, item.path) : false
    const isRenaming = renamingPath === item.path
    const isLoading = loadingDirs.has(item.path)
    const isCreatingInput = item.name === '__creating__'
    const isLoadingPlaceholder = node.kind === 'loading'

    // 创建输入框
    if (isCreatingInput && creatingIn) {
      return (
        <div
          key={item.path}
          className="flex items-center gap-1.5 py-1 pr-2"
          style={{
            height: ITEM_HEIGHT,
            paddingLeft: `${depth * 12 + 12}px`,
            position: 'absolute',
            top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
            left: 0,
            right: 0
          }}
        >
          <span className="w-3.5 flex-shrink-0" />
          {creatingIn.type === 'folder' ? (
            <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          ) : (
            <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          )}
          <TextField
            autoFocus
            placeholder={creatingIn.type === 'file' ? 'filename.ext' : 'folder name'}
            className="flex-1 h-6 text-[13px]"
            onBlur={(e) => {
              if (e.target.value.trim()) {
                onCreateSubmit(creatingIn.path, e.target.value.trim(), creatingIn.type)
              } else {
                onCancelCreate()
              }
            }}
            onKeyDown={(e) => {
              // 输入法组合中不处理回车
              if (e.nativeEvent.isComposing) return

              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                e.preventDefault()
                onCreateSubmit(creatingIn.path, e.currentTarget.value.trim(), creatingIn.type)
              } else if (e.key === 'Escape') {
                onCancelCreate()
              }
            }}
          />
        </div>
      )
    }

    if (isLoadingPlaceholder) {
      return (
        <div
          key={item.path}
          className="flex items-center gap-2 px-2 py-1.5"
          style={{
            height: ITEM_HEIGHT,
            paddingLeft: `${depth * 12 + 8}px`,
            position: 'absolute',
            top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
            left: 0,
            right: 0
          }}
        >
          <div className="w-3 flex-shrink-0" />
          <div className="w-3.5 h-3.5 rounded-sm bg-surface-active/45 animate-pulse flex-shrink-0" />
          <div
            className="h-3 rounded bg-surface-active/30 animate-pulse"
            style={{ width: `${58 + (index % 3) * 10}%` }}
          />
        </div>
      )
    }

    return (
      <div
        key={item.path}
        onClick={() => handleNodeClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
        draggable={!isRenaming}
        onDragStart={(e) => {
          dragSourcePathRef.current = item.path
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(BRAND.dragDrop.fileMimeType, item.path)
          e.dataTransfer.setData('text/uri-list', `file:///${item.path.replace(/\\/g, '/')}`)
          e.dataTransfer.setData('text/plain', item.path)
          // 设置拖动时的图标
          const dragImage = document.createElement('div')
          dragImage.textContent = item.name
          dragImage.style.cssText = 'position: absolute; top: -1000px; padding: 4px 8px; background: var(--surface); border-radius: 4px; font-size: 12px; color: var(--text-primary);'
          document.body.appendChild(dragImage)
          e.dataTransfer.setDragImage(dragImage, 0, 0)
          setTimeout(() => document.body.removeChild(dragImage), 0)
        }}
        onDragEnd={() => {
          dragSourcePathRef.current = null
          setDragOverPath(null)
        }}
        onDragEnter={(e) => {
          if (isRenaming) return
          const sourcePath = dragSourcePathRef.current
          if (!sourcePath || pathEquals(sourcePath, item.path)) return
          e.preventDefault()
          setDragOverPath(item.path)
        }}
        onDragOver={(e) => {
          if (isRenaming) return
          const sourcePath = dragSourcePathRef.current
          if (!sourcePath || pathEquals(sourcePath, item.path)) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'move'
          if (!pathEquals(dragOverPath || '', item.path)) {
            setDragOverPath(item.path)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOverPath((prev) => (prev === item.path ? null : prev))
          }
        }}
        onDrop={async (e) => {
          e.preventDefault()
          e.stopPropagation()
          const sourcePath = dragSourcePathRef.current
          dragSourcePathRef.current = null
          setDragOverPath(null)
          if (!sourcePath) return
          if (item.isDirectory) {
            await handleDropOnDirectory(node, sourcePath)
            return
          }
          await handleDropNextToNode(node, sourcePath)
        }}
        className={`
          group flex items-center gap-2 pr-2 cursor-pointer transition-colors duration-150 relative select-none rounded-md mx-2 my-[2px] min-w-max
          ${isActive
            ? 'bg-accent/15 text-accent font-medium'
            : isFocused
              ? 'bg-surface-hover/80 text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover/40'
          }
          ${isHighlighted ? 'animate-reveal-highlight' : ''}
          ${dragOverPath && pathEquals(dragOverPath, item.path) ? 'ring-1 ring-accent bg-accent/10' : ''}
        `}
        style={{
          height: ITEM_HEIGHT,
          paddingLeft: `${depth * 12 + 8}px`,
          position: 'absolute',
          top: (visibleRange.startIndex + index) * ITEM_HEIGHT,
          left: 0,
          minWidth: 'calc(100% - 16px)'
        }}
      >
        {/* Indent Guide - Very subtle line */}
        {depth > 0 && Array.from({ length: depth }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/20 group-hover:border-border/40 transition-colors"
            style={{ left: `${(i + 1) * 12}px` }}
          />
        ))}

        {/* Icon & Toggle */}
        {item.isDirectory ? (
          <>
            <div className="flex items-center justify-center w-4 h-4 -ml-1 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted opacity-40 group-hover:opacity-100" />
            </div>
            {isLoading ? (
              <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
            ) : (
              <FileIcon filename={item.name} isDirectory isOpen={isExpanded} size={16} className="flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <div className="w-3 flex-shrink-0" />
            <FileIcon filename={item.name} size={16} className="flex-shrink-0" />
          </>
        )}

        {/* Name */}
        {isRenaming ? (
          <TextField
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              // 输入法组合中不处理回车
              if (e.nativeEvent.isComposing) return

              if (e.key === 'Enter') {
                e.preventDefault()
                handleRenameSubmit()
              }
              if (e.key === 'Escape') setRenamingPath(null)
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 h-5 text-[13px] px-1 py-0"
            autoFocus
          />
        ) : (
          <span className="text-[13px] leading-normal whitespace-nowrap opacity-90 group-hover:opacity-100">
            {item.name}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar focus:outline-none"
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onBlur={() => {
        // Only clear focus if not renaming and not opening context menu
        if (!renamingPath && !contextMenu) {
          setFocusedPath(null)
        }
      }}
      onDragLeave={() => setDragOverPath(null)}
      onDrop={() => {
        dragSourcePathRef.current = null
        setDragOverPath(null)
      }}
    >
      <div style={{ height: totalHeight, position: 'relative', minWidth: 'max-content', width: '100%' }}>
        {visibleNodes.map((node, index) => renderNode(node, index))}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <FloatingMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})
