/**
 * ExecutionFileTree — 项目执行窗口左侧文件树（轻量级）
 *
 * 不依赖主窗口全局 store，独立加载目录内容。
 * 支持展开/折叠文件夹，点击文件通知父组件。
 *
 * 设计要点：
 * - 通过 api.fileOps.readDir 异步加载目录
 * - 子目录懒加载（展开时才加载）
 * - 支持刷新
 * - 排除 .git、node_modules 等干扰目录
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileText, FileCode,
  FileJson, FileImage, File, RefreshCw, HardDrive, Loader2,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import type { FileItem } from '@shared/protocols'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 常量
// ============================================

/** 需要隐藏的目录名（干扰文件、构建产物等） */
const HIDDEN_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.cache',
  '.aweeclaw', '__pycache__', '.pytest_cache', '.venv', 'venv',
  '.idea', '.vscode', 'target', '.gradle', '.mvn',
])

/** 文件扩展名 → 图标映射 */
function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return FileCode
  if (['json', 'jsonc'].includes(ext)) return FileJson
  if (['vue', 'svelte'].includes(ext)) return FileCode
  if (['py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h'].includes(ext)) return FileCode
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return FileImage
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return FileCode
  if (['html', 'htm', 'xml'].includes(ext)) return FileCode
  if (['md', 'mdx', 'txt', 'log'].includes(ext)) return FileText
  return File
}

/** 排序：文件夹在前，文件在后，各自按名称排序 */
function sortItems(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

/** 过滤隐藏目录 */
function filterHidden(items: FileItem[]): FileItem[] {
  return items.filter(item => !HIDDEN_DIRS.has(item.name))
}

// ============================================
// 类型定义
// ============================================

interface ExecutionFileTreeProps {
  /** 工作区根路径 */
  workspacePath: string | null
  /** 文件点击回调 */
  onFileSelect?: (filePath: string) => void
}

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  loaded?: boolean
  loading?: boolean
}

// ============================================
// 主组件
// ============================================

export function ExecutionFileTree({ workspacePath, onFileSelect }: ExecutionFileTreeProps) {
  const [rootItems, setRootItems] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // 加载根目录
  const loadRoot = useCallback(async () => {
    if (!workspacePath) return
    setLoading(true)
    setError(null)
    try {
      const items = await api.file.readDir(workspacePath)
      const filtered = filterHidden(items)
      const sorted = sortItems(filtered)
      const nodes: TreeNode[] = sorted.map(item => ({
        name: item.name,
        path: item.path,
        isDirectory: item.isDirectory,
        loaded: false,
      }))
      setRootItems(nodes)
    } catch (e) {
      setError('加载文件失败')
      logger.agent.warn('[ExecutionFileTree] Load root failed:', e)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  // 首次加载 + workspacePath 变化时重新加载
  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  // 加载子目录
  const loadChildren = useCallback(async (nodePath: string) => {
    if (loadingPaths.has(nodePath)) return
    setLoadingPaths(prev => new Set(prev).add(nodePath))
    try {
      const items = await api.file.readDir(nodePath)
      const filtered = filterHidden(items)
      const sorted = sortItems(filtered)
      const childNodes: TreeNode[] = sorted.map(item => ({
        name: item.name,
        path: item.path,
        isDirectory: item.isDirectory,
        loaded: false,
      }))

      // 递归更新树
      const updateNode = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map(node => {
          if (node.path === nodePath) {
            return { ...node, children: childNodes, loaded: true }
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) }
          }
          return node
        })

      setRootItems(prev => updateNode(prev))
    } catch (e) {
      logger.agent.warn('[ExecutionFileTree] Load children failed:', e)
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(nodePath)
        return next
      })
    }
  }, [loadingPaths])

  // 切换文件夹展开/折叠
  const toggleFolder = useCallback((node: TreeNode) => {
    const isExpanded = expandedPaths.has(node.path)
    if (isExpanded) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(node.path)
        return next
      })
    } else {
      setExpandedPaths(prev => new Set(prev).add(node.path))
      // 懒加载：首次展开时加载子目录
      if (!node.loaded && !node.children) {
        loadChildren(node.path)
      }
    }
  }, [expandedPaths, loadChildren])

  // 文件点击
  const handleFileClick = useCallback((node: TreeNode) => {
    setSelectedPath(node.path)
    onFileSelect?.(node.path)
  }, [onFileSelect])

  // 递归渲染树节点
  const renderNode = useCallback((node: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path)
    const isLoading = loadingPaths.has(node.path)
    const isSelected = selectedPath === node.path
    const Icon = node.isDirectory
      ? (isExpanded ? FolderOpen : Folder)
      : getFileIcon(node.name)
    const Chevron = isExpanded ? ChevronDown : ChevronRight

    return (
      <div key={node.path}>
        <div
          onClick={() => node.isDirectory ? toggleFolder(node) : handleFileClick(node)}
          className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer transition-colors text-[12px] leading-relaxed ${
            isSelected
              ? 'bg-accent/10 text-accent'
              : 'text-text-primary hover:bg-surface-hover/40'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          title={node.name}
        >
          {/* 展开/折叠箭头（文件夹才有） */}
          {node.isDirectory ? (
            <Chevron className={`w-3 h-3 flex-shrink-0 text-text-muted ${isLoading ? 'animate-spin' : ''}`} />
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${node.isDirectory ? 'text-accent/70' : 'text-text-muted'}`} />
          <span className="truncate">{node.name}</span>
        </div>

        {/* 子节点（展开时显示） */}
        {node.isDirectory && isExpanded && (
          <>
            {isLoading && !node.children ? (
              <div className="flex items-center gap-1 px-2 py-0.5 text-[12px] text-text-muted" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>加载中...</span>
              </div>
            ) : node.children && node.children.length > 0 ? (
              node.children.map(child => renderNode(child, depth + 1))
            ) : node.loaded ? (
              <div className="px-2 py-0.5 text-[12px] text-text-muted/50" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
                空目录
              </div>
            ) : null}
          </>
        )}
      </div>
    )
  }, [expandedPaths, loadingPaths, selectedPath, toggleFolder, handleFileClick])

  // 渲染
  if (!workspacePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted/50 py-4">
        <HardDrive className="w-6 h-6 mb-1.5 opacity-30" />
        <span className="text-[12px]">未加载工作区</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部 */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-3 h-9 border-b border-border/30">
        <Folder className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-[12px] font-medium text-text-primary">项目文件</span>
        <button
          onClick={loadRoot}
          className="ml-auto p-0.5 rounded hover:bg-surface-hover/50 text-text-muted hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {loading ? (
          <div className="flex items-center justify-center py-4 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-[12px] text-red-500 text-center">{error}</div>
        ) : rootItems.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-text-muted text-center">空目录</div>
        ) : (
          rootItems.map(node => renderNode(node, 0))
        )}
      </div>
    </div>
  )
}
