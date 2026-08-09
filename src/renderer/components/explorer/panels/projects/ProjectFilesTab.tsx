/**
 * ProjectFilesTab — 项目文件浏览器 Tab
 *
 * 显示项目目录下的文件和子文件夹（类似工作区文件浏览器）。
 * 项目目录来源：project.workspacePaths[0]，未设置时使用工作区根目录。
 *
 * 布局设计（独立预览）：
 * ┌────────────────────┬──────────────────────────┐
 * │  文件树（可调宽）   │  预览面板（可拖拽/最大化）│
 * │  - 单击文件 → 预览 │  - 头部：文件名 + 操作    │
 * │  - 双击文件 → 编辑 │  - 正文：按类型预览       │
 * │  - 面包屑导航       │  - 底部：文件元信息       │
 * └────────────────────┴──────────────────────────┘
 *
 * 体验要点：
 *  - 单击文件即在右侧预览，不抢占工作区编辑器
 *  - 中间分隔条可拖拽调整宽度，宽度持久化到 localStorage
 *  - 预览面板支持「最大化」全宽查看，「在工作区编辑器中打开」保留编辑入口
 *  - 当前预览文件在树中高亮
 */
import { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, File, FileCode,
  FileText, Image, FileJson, Loader2, AlertCircle, RefreshCw,
  Home, ArrowLeft, PanelRightClose, FilePlus, FolderPlus,
} from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import type { FileItem } from '@shared/protocols'
import { ProjectFilePreview } from './ProjectFilePreview'
import { ProjectFileContextMenu } from './ProjectFileContextMenu'
import { explorerClipboardService } from '@services/clipboardService'
import { directoryCacheService } from '@services/dirCacheAdapter'
import { toast } from '@components/foundation/NotificationProvider'
import { joinPath } from '@shared/toolkit/pathHelper'

// ─── 布局常量 ─────────────────────────────────────────────
const MIN_PREVIEW_WIDTH = 320      // 预览面板最小宽度
const MIN_TREE_WIDTH = 200         // 文件树最小宽度
const DEFAULT_PREVIEW_WIDTH = 480  // 预览面板默认宽度
const STORAGE_KEY_WIDTH = 'aweeclaw:project-file-preview-width'

interface ProjectFilesTabProps {
  /** 项目的工作区路径列表，取第一个作为项目目录 */
  workspacePaths: string[]
  isZh: boolean
}

/** 文件图标映射 */
function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return null // 文件夹图标在渲染时单独处理
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'vue':
    case 'py':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return <FileCode className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
    case 'json':
      return <FileJson className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
    case 'md':
    case 'txt':
    case 'log':
      return <FileText className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <Image className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
    default:
      return <File className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
  }
}

/** 格式化文件大小 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化时间 */
function formatTime(timestamp?: number): string {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 读取持久化的预览宽度（带容错） */
function loadPersistedWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WIDTH)
    if (!raw) return DEFAULT_PREVIEW_WIDTH
    const w = Number.parseInt(raw, 10)
    return Number.isFinite(w) && w >= MIN_PREVIEW_WIDTH ? w : DEFAULT_PREVIEW_WIDTH
  } catch {
    return DEFAULT_PREVIEW_WIDTH
  }
}

export function ProjectFilesTab({ workspacePaths, isZh }: ProjectFilesTabProps) {
  const workspaceRoot = useStore((s) => s.workspacePath)

  // 项目目录：workspacePaths[0] 或工作区根目录
  const projectDir = useMemo(() => {
    return workspacePaths?.[0] || workspaceRoot || ''
  }, [workspacePaths, workspaceRoot])

  // 当前浏览路径（支持导航进入子目录）
  const [currentPath, setCurrentPath] = useState(projectDir)
  const [items, setItems] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 展开的文件夹（按路径记录展开状态）
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  // 子目录内容缓存
  const [dirContents, setDirContents] = useState<Record<string, FileItem[]>>({})

  // ─── 独立预览状态 ─────────────────────────────────────
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [previewWidth, setPreviewWidth] = useState<number>(loadPersistedWidth)

  // ─── 右键菜单状态 ─────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ item: FileItem; x: number; y: number } | null>(null)
  const [clipboardItem, setClipboardItem] = useState(explorerClipboardService.getState().entry)

  // ─── inline 创建状态（与工作区文件树交互一致） ────────
  // creatingIn 记录「在哪个目录下创建什么类型」，树中对应位置渲染输入框
  const [creatingIn, setCreatingIn] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)

  const bodyRef = useRef<HTMLDivElement>(null)
  const previewWidthRef = useRef(previewWidth)
  previewWidthRef.current = previewWidth

  // 项目目录变化时重置当前路径与预览
  useEffect(() => {
    setCurrentPath(projectDir)
    setExpandedPaths(new Set())
    setDirContents({})
    setSelectedFile(null)
    setShowPreview(false)
    setIsMaximized(false)
  }, [projectDir])

  // 容器尺寸变化时夹紧预览宽度，防止溢出
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const clamp = () => {
      const avail = el.clientWidth
      const max = Math.max(MIN_PREVIEW_WIDTH, avail - MIN_TREE_WIDTH - 6)
      if (previewWidthRef.current > max) setPreviewWidth(max)
    }
    clamp()
    const ro = new ResizeObserver(clamp)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 加载目录内容
  const loadDir = useCallback(async (path: string): Promise<FileItem[]> => {
    const result = await api.file.readDir(path)
    // 排序：文件夹在前，然后按名称排序
    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [])

  // 加载当前路径
  const reload = useCallback(async () => {
    if (!currentPath) {
      setError(isZh ? '未设置项目目录' : 'No project directory set')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await loadDir(currentPath)
      setItems(result)
    } catch {
      setError(isZh
        ? `无法读取目录：${currentPath}`
        : `Failed to read directory: ${currentPath}`)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [currentPath, loadDir, isZh])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 刷新指定目录：右键菜单操作（删除/重命名/粘贴/新建）后调用。
   * - 若被刷新的是当前浏览目录 → 更新 items
   * - 若是已展开的子目录 → 更新 dirContents 缓存
   * - 若选中的预览文件已被删除 → 关闭预览
   */
  const refreshDir = useCallback(async (dirPath: string) => {
    try {
      const result = await loadDir(dirPath)
      if (dirPath === currentPath) {
        setItems(result)
        // 若当前预览的文件已不在目录中，关闭预览
        if (selectedFile) {
          const stillExists = result.some(f => f.path === selectedFile.path)
          if (!stillExists) {
            setSelectedFile(null)
            setShowPreview(false)
          }
        }
      }
      // 若该目录已展开（在缓存中），同步更新缓存
      setDirContents(prev => {
        if (!(dirPath in prev)) return prev
        return { ...prev, [dirPath]: result }
      })
    } catch {
      // 刷新失败静默忽略（目录可能已被删除）
    }
  }, [currentPath, loadDir, selectedFile])

  // 订阅剪贴板变化，控制「粘贴」菜单项可用性
  useEffect(() => {
    const unsub = explorerClipboardService.subscribe(() => {
      setClipboardItem(explorerClipboardService.getState().entry)
    })
    return unsub
  }, [])

  // 右键菜单触发
  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileItem) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ item, x: e.clientX, y: e.clientY })
  }, [])

  // 切换文件夹展开/折叠
  const toggleExpand = useCallback(async (item: FileItem) => {
    if (!item.isDirectory) return
    const path = item.path
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        // 加载子目录内容（如果尚未加载）
        if (!dirContents[path]) {
          void loadDir(path).then(result => {
            setDirContents(prevContents => ({ ...prevContents, [path]: result }))
          }).catch(() => {
            setDirContents(prevContents => ({ ...prevContents, [path]: [] }))
          })
        }
      }
      return next
    })
  }, [dirContents, loadDir])

  // ─── inline 创建：开始 / 提交 / 取消（与工作区文件树一致） ───

  /** 开始创建：确保父目录展开，然后设置 creatingIn 触发 inline 输入框 */
  const handleStartCreate = useCallback((parentPath: string, type: 'file' | 'folder') => {
    // 当前浏览目录的内容存在 items 中（非 dirContents），无需展开/预加载
    if (parentPath !== currentPath) {
      setExpandedPaths(prev => {
        if (prev.has(parentPath)) return prev
        const next = new Set(prev)
        next.add(parentPath)
        // 若尚未加载子目录内容，预加载
        if (!dirContents[parentPath]) {
          void loadDir(parentPath).then(result => {
            setDirContents(prevContents => ({ ...prevContents, [parentPath]: result }))
          }).catch(() => {
            setDirContents(prevContents => ({ ...prevContents, [parentPath]: [] }))
          })
        }
        return next
      })
    }
    setCreatingIn({ path: parentPath, type })
  }, [currentPath, dirContents, loadDir])

  /** 提交创建：调用 api 写入文件/创建目录，成功后刷新目录 */
  const handleCreateSubmit = useCallback(async (parentPath: string, name: string, type: 'file' | 'folder') => {
    const fullPath = joinPath(parentPath, name)
    let success = false
    try {
      if (type === 'file') {
        success = await api.file.write(fullPath, '')
      } else {
        success = await api.file.mkdir(fullPath)
      }
    } catch {
      success = false
    }
    if (success) {
      directoryCacheService.invalidate(parentPath)
      await refreshDir(parentPath)
      toast.success(type === 'file' ? (isZh ? '文件已创建' : 'File created') : (isZh ? '文件夹已创建' : 'Folder created'))
    } else {
      toast.error(isZh ? '创建失败' : 'Failed to create')
    }
    setCreatingIn(null)
  }, [refreshDir, isZh])

  /** 取消创建 */
  const handleCancelCreate = useCallback(() => {
    setCreatingIn(null)
  }, [])

  // 单击文件 → 在右侧预览面板打开（不抢占工作区编辑器）
  const handleFilePreview = useCallback((item: FileItem) => {
    if (item.isDirectory) return
    setSelectedFile(item)
    setShowPreview(true)
    // 打开预览时自动收起主窗口左侧导航菜单栏，为预览面板腾出更多横向空间。
    // 与 AweeApp 中 activeFilePath 触发收起的模式保持一致；关闭预览不自动恢复，
    // 由用户按需手动展开，避免与用户主动操作冲突。
    useStore.getState().setNavRailExpanded(false)
  }, [])

  // 双击文件 / 头部「在编辑器中打开」→ 在工作区编辑器中打开（保留原能力）
  const handleOpenInEditor = useCallback(async (item: FileItem) => {
    if (item.isDirectory) return
    try {
      const content = await api.file.read(item.path)
      if (content !== null) {
        useStore.getState().openFile(item.path, content)
      }
    } catch {
      // 忽略打开错误
    }
  }, [])

  // 关闭预览
  const handleClosePreview = useCallback(() => {
    setShowPreview(false)
    setIsMaximized(false)
  }, [])

  // 切换最大化
  const handleToggleMaximize = useCallback(() => {
    setIsMaximized(v => !v)
  }, [])

  // ─── 拖拽分隔条调整预览宽度 ───────────────────────────
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return
    e.preventDefault()
    const containerEl = bodyRef.current
    if (!containerEl) return
    const containerWidth = containerEl.clientWidth
    const startX = e.clientX
    const startWidth = previewWidthRef.current

    const onMove = (ev: MouseEvent) => {
      // 预览在右侧，鼠标左移 → 宽度增加
      const delta = startX - ev.clientX
      const max = Math.max(MIN_PREVIEW_WIDTH, containerWidth - MIN_TREE_WIDTH - 6)
      const next = Math.max(MIN_PREVIEW_WIDTH, Math.min(max, startWidth + delta))
      setPreviewWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        localStorage.setItem(STORAGE_KEY_WIDTH, String(previewWidthRef.current))
      } catch {
        /* localStorage 不可用时静默忽略 */
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [isMaximized])

  // Escape 关闭预览
  useEffect(() => {
    if (!showPreview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isMaximized) handleClosePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPreview, isMaximized, handleClosePreview])

  // 面包屑路径段
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return []
    const parts = currentPath.split('/').filter(Boolean)
    const segments: { label: string; path: string }[] = []
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : `/${part}`
      segments.push({ label: part, path: acc })
    }
    return segments
  }, [currentPath])

  // 是否在项目根目录
  const isAtRoot = currentPath === projectDir

  // 返回上级目录
  const handleGoUp = useCallback(() => {
    if (isAtRoot || !currentPath) return
    const parts = currentPath.split('/')
    parts.pop()
    setCurrentPath(parts.join('/') || '/')
  }, [currentPath, isAtRoot])

  // 无项目目录
  if (!projectDir) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <Folder className="w-10 h-10 mb-3 opacity-25" />
        <p className="text-[13px] font-medium">{isZh ? '未设置项目目录' : 'No project directory'}</p>
        <p className="text-[12px] mt-1.5 text-text-muted/60 text-center max-w-xs">
          {isZh
            ? '在项目设置中选择项目目录，或编辑项目时设置「项目目录」字段'
            : 'Set a project directory in project settings, or choose one when creating/editing the project'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border/20 flex items-center gap-2">
        {/* 返回上级 */}
        <button
          onClick={handleGoUp}
          disabled={isAtRoot}
          className="p-1 rounded hover:bg-surface-hover/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={isZh ? '返回上级' : 'Go up'}
        >
          <ArrowLeft className="w-3.5 h-3.5 text-text-secondary" />
        </button>

        {/* 项目根目录 */}
        <button
          onClick={() => setCurrentPath(projectDir)}
          className="p-1 rounded hover:bg-surface-hover/50 transition-colors"
          title={isZh ? '项目根目录' : 'Project root'}
        >
          <Home className="w-3.5 h-3.5 text-text-secondary" />
        </button>

        {/* 面包屑 */}
        <div className="flex-1 flex items-center gap-0.5 min-w-0 overflow-x-auto">
          {breadcrumbs.map((seg, idx) => (
            <div key={seg.path} className="flex items-center gap-0.5 flex-shrink-0">
              {idx > 0 && <ChevronRight className="w-3 h-3 text-text-muted/40" />}
              <button
                onClick={() => setCurrentPath(seg.path)}
                className={`px-1.5 py-0.5 rounded text-[12px] hover:bg-surface-hover/50 transition-colors truncate max-w-[120px] ${
                  idx === breadcrumbs.length - 1 ? 'text-text-primary font-medium' : 'text-text-muted'
                }`}
              >
                {seg.label}
              </button>
            </div>
          ))}
        </div>

        {/* 新建文件 */}
        <button
          onClick={() => handleStartCreate(currentPath, 'file')}
          className="p-1 rounded hover:bg-surface-hover/50 transition-colors"
          title={isZh ? '新建文件' : 'New file'}
        >
          <FilePlus className="w-3.5 h-3.5 text-text-secondary" />
        </button>

        {/* 新建文件夹 */}
        <button
          onClick={() => handleStartCreate(currentPath, 'folder')}
          className="p-1 rounded hover:bg-surface-hover/50 transition-colors"
          title={isZh ? '新建文件夹' : 'New folder'}
        >
          <FolderPlus className="w-3.5 h-3.5 text-text-secondary" />
        </button>

        {/* 刷新 */}
        <button
          onClick={reload}
          className="p-1 rounded hover:bg-surface-hover/50 transition-colors"
          title={isZh ? '刷新' : 'Refresh'}
        >
          <RefreshCw className={`w-3.5 h-3.5 text-text-secondary ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* 预览状态切换 */}
        {selectedFile && showPreview && (
          <button
            onClick={handleClosePreview}
            className="p-1 rounded hover:bg-surface-hover/50 transition-colors"
            title={isZh ? '隐藏预览' : 'Hide preview'}
          >
            <PanelRightClose className="w-3.5 h-3.5 text-text-secondary" />
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-[12px] text-red-500">{error}</span>
        </div>
      )}

      {/* 主体：文件树 + 分隔条 + 预览面板 */}
      <div ref={bodyRef} className="flex-1 overflow-hidden flex min-h-0">
        {/* 文件树（最大化时隐藏） */}
        {!isMaximized && (
          <div className="flex-1 min-w-0 overflow-y-auto px-2 py-2 custom-scrollbar">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <Folder className="w-8 h-8 mb-2 opacity-25" />
                <p className="text-[12px]">{isZh ? '空目录' : 'Empty directory'}</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {/* 顶层 inline 创建输入框（在当前浏览目录下新建） */}
                {creatingIn?.path === currentPath && (
                  <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: '8px' }}>
                    <span className="w-3 flex-shrink-0" />
                    {creatingIn.type === 'folder' ? (
                      <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    ) : (
                      <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    )}
                    <input
                      autoFocus
                      placeholder={creatingIn.type === 'file' ? 'filename.ext' : 'folder name'}
                      className="flex-1 h-6 px-1.5 text-[12px] bg-surface border border-accent/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary placeholder:text-text-muted/50"
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v) handleCreateSubmit(currentPath, v, creatingIn.type)
                        else handleCancelCreate()
                      }}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          e.preventDefault()
                          handleCreateSubmit(currentPath, e.currentTarget.value.trim(), creatingIn.type)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          handleCancelCreate()
                        }
                      }}
                    />
                  </div>
                )}
                {items.map(item => (
                  <FileTreeItem
                    key={item.path}
                    item={item}
                    expandedPaths={expandedPaths}
                    dirContents={dirContents}
                    selectedFilePath={selectedFile?.path ?? null}
                    creatingIn={creatingIn}
                    onToggle={toggleExpand}
                    onPreview={handleFilePreview}
                    onOpenInEditor={handleOpenInEditor}
                    onContextMenu={handleContextMenu}
                    onCreateSubmit={handleCreateSubmit}
                    onCancelCreate={handleCancelCreate}
                    isZh={isZh}
                    depth={0}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 可拖拽分隔条 */}
        {showPreview && selectedFile && !isMaximized && (
          <div
            onMouseDown={startDrag}
            className="flex-shrink-0 w-1.5 cursor-col-resize group relative bg-transparent hover:bg-accent/20 transition-colors"
            title={isZh ? '拖拽调整宽度' : 'Drag to resize'}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-accent/40 transition-colors" />
          </div>
        )}

        {/* 预览面板 */}
        {showPreview && selectedFile && (
          <div
            className={`flex-shrink-0 min-w-0 border-l border-border bg-background overflow-hidden flex flex-col ${isMaximized ? 'flex-1' : ''}`}
            style={isMaximized ? undefined : { width: `${previewWidth}px` }}
          >
            <ProjectFilePreview
              file={selectedFile}
              isZh={isZh}
              isMaximized={isMaximized}
              onClose={handleClosePreview}
              onToggleMaximize={handleToggleMaximize}
              onOpenInEditor={handleOpenInEditor}
            />
          </div>
        )}
      </div>

      {/* 右键菜单（与工作区文件树行为一致） */}
      {contextMenu && (
        <ProjectFileContextMenu
          item={contextMenu.item}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          projectRoot={projectDir}
          hasClipboard={!!clipboardItem}
          onRefresh={refreshDir}
          onStartCreate={handleStartCreate}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ─── 文件树条目 ─────────────────────────────────────────────

interface FileTreeItemProps {
  item: FileItem
  /** 全局展开路径集合（由父级维护，递归透传） */
  expandedPaths: Set<string>
  /** 全局子目录内容缓存（由父级维护，递归透传） */
  dirContents: Record<string, FileItem[]>
  /** 当前预览选中的文件路径（递归透传，用于高亮） */
  selectedFilePath: string | null
  /** 当前 inline 创建状态（递归透传，用于在对应目录下渲染输入框） */
  creatingIn: { path: string; type: 'file' | 'folder' } | null
  onToggle: (item: FileItem) => void
  /** 单击文件 → 预览 */
  onPreview: (item: FileItem) => void
  /** 双击文件 → 在工作区编辑器中打开 */
  onOpenInEditor: (item: FileItem) => void
  /** 右键 → 弹出上下文菜单 */
  onContextMenu: (e: React.MouseEvent, item: FileItem) => void
  /** inline 创建提交（Enter 或失焦时触发） */
  onCreateSubmit: (parentPath: string, name: string, type: 'file' | 'folder') => void
  /** inline 创建取消（Esc 时触发） */
  onCancelCreate: () => void
  isZh: boolean
  depth: number
}

/**
 * 文件树条目（递归组件）
 *
 * 关键设计：isExpanded / isSelected / children 不再由父级传入硬编码值，
 * 而是从透传的 expandedPaths / selectedFilePath / dirContents 中计算得出。
 * 这样任意层级的文件夹都能正确展开、加载子目录、高亮选中文件。
 */
function FileTreeItem({
  item, expandedPaths, dirContents, selectedFilePath, creatingIn, onToggle, onPreview, onOpenInEditor, onContextMenu, onCreateSubmit, onCancelCreate, isZh, depth,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(item.path)
  const isSelected = selectedFilePath === item.path
  const children = item.isDirectory ? dirContents[item.path] : undefined
  const icon = getFileIcon(item.name, item.isDirectory)

  const handleClick = () => {
    if (item.isDirectory) onToggle(item)
    else onPreview(item)
  }
  const handleDoubleClick = () => {
    if (!item.isDirectory) onOpenInEditor(item)
  }

  return (
    <div>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, item)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors group ${
          isSelected ? 'bg-accent/15 text-accent' : 'hover:bg-surface-hover/50'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* 展开/折叠箭头 */}
        {item.isDirectory ? (
          isExpanded ? (
            <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* 文件/文件夹图标 */}
        {item.isDirectory ? (
          isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-accent/70 flex-shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-accent/70 flex-shrink-0" />
          )
        ) : (
          icon
        )}

        {/* 名称 */}
        <span className={`flex-1 min-w-0 text-[12px] truncate ${isSelected ? 'text-accent font-medium' : 'text-text-primary'}`}>
          {item.name}
        </span>

        {/* 大小（仅文件） */}
        {!item.isDirectory && item.size !== undefined && (
          <span className="text-[12px] text-text-muted/60 flex-shrink-0 group-hover:opacity-0 transition-opacity">
            {formatFileSize(item.size)}
          </span>
        )}

        {/* 修改时间 */}
        {item.lastModified && (
          <span className="text-[12px] text-text-muted/40 flex-shrink-0 group-hover:opacity-0 transition-opacity">
            {formatTime(item.lastModified)}
          </span>
        )}
      </div>

      {/* 子目录内容（含 inline 创建输入框） */}
      {item.isDirectory && isExpanded && (
        <div>
          {/* inline 创建输入框（在子项列表顶部，与工作区文件树一致） */}
          {creatingIn?.path === item.path && (
            <div
              className="flex items-center gap-1.5 px-2 py-1"
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              <span className="w-3.5 flex-shrink-0" />
              {creatingIn.type === 'folder' ? (
                <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
              ) : (
                <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
              )}
              <input
                autoFocus
                placeholder={creatingIn.type === 'file' ? 'filename.ext' : 'folder name'}
                className="flex-1 h-6 px-1.5 text-[12px] bg-surface border border-accent/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40 text-text-primary placeholder:text-text-muted/50"
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v) onCreateSubmit(item.path, v, creatingIn.type)
                  else onCancelCreate()
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    e.preventDefault()
                    onCreateSubmit(item.path, e.currentTarget.value.trim(), creatingIn.type)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    onCancelCreate()
                  }
                }}
              />
            </div>
          )}

          {/* 子项列表 */}
          {children && children.length === 0 && !creatingIn ? (
            <div
              className="text-[12px] text-text-muted/40 py-1"
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              {isZh ? '空文件夹' : 'Empty'}
            </div>
          ) : children ? (
            children.map(child => (
              <FileTreeItem
                key={child.path}
                item={child}
                expandedPaths={expandedPaths}
                dirContents={dirContents}
                selectedFilePath={selectedFilePath}
                creatingIn={creatingIn}
                onToggle={onToggle}
                onPreview={onPreview}
                onOpenInEditor={onOpenInEditor}
                onContextMenu={onContextMenu}
                onCreateSubmit={onCreateSubmit}
                onCancelCreate={onCancelCreate}
                isZh={isZh}
                depth={depth + 1}
              />
            ))
          ) : null}

          {/* 子目录加载中（非创建状态时才显示加载指示） */}
          {!children && !creatingIn && (
            <div
              className="flex items-center gap-1.5 py-1"
              style={{ paddingLeft: `${24 + depth * 16}px` }}
            >
              <Loader2 className="w-3 h-3 text-text-muted animate-spin" />
              <span className="text-[12px] text-text-muted/50">{isZh ? '加载中...' : 'Loading...'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
