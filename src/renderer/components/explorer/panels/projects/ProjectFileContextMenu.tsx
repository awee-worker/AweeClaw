/**
 * ProjectFileContextMenu — 项目文件树右键菜单
 *
 * 设计目标：与工作区文件树（VirtualTreeRenderer）右键菜单行为一致，
 * 但状态自洽、不依赖工作区特有的 props（onStartCreate / onRefresh 等内部状态机）。
 *
 * 复用的公共服务（与工作区同源，保证行为一致）：
 *  - api.file.*            文件操作（删除/重命名/复制/exists/mkdir/write/showInFolder/openInBrowser）
 *  - explorerClipboardService  剪贴板（复制/粘贴，与工作区共享剪贴板）
 *  - directoryCacheService    目录缓存失效
 *  - terminalManager          集成终端
 *  - globalDecide             确认弹窗
 *  - toast                    操作反馈
 *
 * 菜单项（与工作区对齐）：
 *  - 文件夹：新建文件/文件夹 | 复制/粘贴 | 重命名/删除 | 复制路径/相对路径 | 在文件夹中显示 | 在此处打开终端
 *  - 文件：   在浏览器打开(HTML) | 复制/粘贴 | 重命名/删除 | 复制路径/相对路径 | 在文件夹中显示 | 在此处打开终端
 *
 * 重命名/新建用原生 prompt 实现（项目树为辅助场景，避免引入 inline 编辑的复杂状态机）。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Copy, Clipboard, Edit2, Trash2, ExternalLink,
  FilePlus, FolderPlus, Globe,
} from 'lucide-react'
import type { ContextMenuItem } from '@renderer/components/ui'
import { FloatingMenu } from '@renderer/components/ui'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { globalPrompt } from '@components/foundation/PromptOverlay'
import { explorerClipboardService } from '@services/clipboardService'
import { directoryCacheService } from '@services/dirCacheAdapter'
import { formatShortcut } from '@services/keybindingAdapter'
import { getDirPath, joinPath, normalizePath } from '@shared/toolkit/pathHelper'
import type { FileItem } from '@shared/protocols'

export interface ProjectFileContextMenuProps {
  /** 触发菜单的文件/文件夹 */
  item: FileItem
  /** 菜单坐标 */
  position: { x: number; y: number }
  /** 项目根目录（用于计算相对路径） */
  projectRoot: string
  /** 当前剪贴板是否有内容（控制「粘贴」是否可用） */
  hasClipboard: boolean
  /** 操作完成后回调，通知父组件刷新指定目录 */
  onRefresh: (dirPath: string) => void
  /** 开始 inline 创建（文件/文件夹）— 与工作区文件树交互一致 */
  onStartCreate: (parentPath: string, type: 'file' | 'folder') => void
  /** 关闭菜单 */
  onClose: () => void
}

export function ProjectFileContextMenu({
  item, position, projectRoot, hasClipboard, onRefresh, onStartCreate, onClose,
}: ProjectFileContextMenuProps) {
  const language = useStore(s => s.language) as Language
  const [clipboardChanged, setClipboardChanged] = useState(0)

  // 订阅剪贴板变化（复制后「粘贴」立即可用）
  useEffect(() => {
    const unsub = explorerClipboardService.subscribe(() => setClipboardChanged(n => n + 1))
    return unsub
  }, [])

  const clipboardEnabled = hasClipboard || clipboardChanged > 0
  const dirPath = item.isDirectory ? item.path : getDirPath(item.path)

  // ─── 操作：复制 ───────────────────────────────────────
  const handleCopy = useCallback(() => {
    explorerClipboardService.setItem({
      path: item.path,
      name: item.name,
      isDirectory: item.isDirectory,
      copiedAt: Date.now(),
    })
    toast.success(item.isDirectory ? '文件夹已复制' : '文件已复制')
    onClose()
  }, [item, onClose])

  // ─── 操作：粘贴（复制到当前目录） ─────────────────────
  const handlePaste = useCallback(async () => {
    const clip = explorerClipboardService.getState().entry
    if (!clip) {
      onClose()
      return
    }
    const normalizedSource = normalizePath(clip.path)
    const normalizedTarget = normalizePath(dirPath)
    if (!normalizedSource || !normalizedTarget) {
      onClose()
      return
    }
    // 防止把文件夹粘贴到自身内部
    if (clip.isDirectory && normalizedTarget.startsWith(`${normalizedSource}/`)) {
      toast.error('不能将文件夹粘贴到自身内部')
      onClose()
      return
    }
    // 计算不重名的目标路径（"xxx - 副本"）
    const nameParts = clip.isDirectory ? null : clip.name.match(/^(.*?)(\.[^.]*)?$/)
    const baseName = clip.isDirectory ? clip.name : (nameParts?.[1] || clip.name)
    const ext = clip.isDirectory ? '' : (nameParts?.[2] || '')
    let candidateName = `${baseName} - 副本${ext}`
    let candidatePath = joinPath(dirPath, candidateName)
    let counter = 2
    try {
      while (await api.file.exists(candidatePath)) {
        candidateName = `${baseName} - 副本 ${counter}${ext}`
        candidatePath = joinPath(dirPath, candidateName)
        counter += 1
      }
      const ok = await api.file.copy(clip.path, candidatePath)
      if (!ok) {
        toast.error('粘贴失败')
      } else {
        directoryCacheService.invalidate(dirPath)
        onRefresh(dirPath)
        toast.success(clip.isDirectory ? '文件夹已粘贴' : '文件已粘贴')
      }
    } catch {
      toast.error('粘贴失败')
    }
    onClose()
  }, [dirPath, onRefresh, onClose])

  // ─── 操作：重命名 ─────────────────────────────────────
  const handleRename = useCallback(async () => {
    const newName = await globalPrompt({
      title: t('contextMenu.rename', language),
      message: t('contextMenu.rename', language),
      defaultValue: item.name,
      confirmText: t('common.confirm', language) || '确定',
    })
    if (newName === null || !newName.trim() || newName.trim() === item.name) {
      onClose()
      return
    }
    const trimmed = newName.trim()
    // 简单校验：禁止非法字符
    if (/[\\/:*?"<>|]/.test(trimmed)) {
      toast.error('名称包含非法字符')
      onClose()
      return
    }
    const parentDir = getDirPath(item.path)
    const newPath = joinPath(parentDir, trimmed)
    try {
      const ok = await api.file.rename(item.path, newPath)
      if (!ok) {
        toast.error('重命名失败')
      } else {
        directoryCacheService.invalidate(parentDir)
        onRefresh(parentDir)
        toast.success('重命名成功')
      }
    } catch {
      toast.error('重命名失败')
    }
    onClose()
  }, [item, language, onRefresh, onClose])

  // ─── 操作：删除 ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const confirmed = await globalConfirm({
      title: t('contextMenu.delete', language),
      message: t('contextMenu.confirmDelete', language, { name: item.name }),
      confirmText: t('contextMenu.delete', language),
      cancelText: t('cancel', language),
      variant: 'danger',
    })
    if (!confirmed) {
      onClose()
      return
    }
    try {
      await api.file.delete(item.path)
      directoryCacheService.invalidate(dirPath)
      onRefresh(dirPath)
      toast.success('删除成功')
    } catch {
      toast.error('删除失败')
    }
    onClose()
  }, [item, dirPath, language, onRefresh, onClose])

  // ─── 操作：复制路径 / 相对路径 ─────────────────────────
  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(item.path)
    toast.success(t('pathCopied', language) || '路径已复制')
    onClose()
  }, [item.path, language, onClose])

  const handleCopyRelativePath = useCallback(() => {
    if (projectRoot) {
      const rel = item.path.replace(projectRoot, '').replace(/^[\\/]/, '')
      navigator.clipboard.writeText(rel)
      toast.success(t('pathCopied', language) || '路径已复制')
    }
    onClose()
  }, [item.path, projectRoot, language, onClose])

  // ─── 操作：在文件夹中显示 ─────────────────────────────
  const handleReveal = useCallback(() => {
    api.file.showInFolder(item.path)
    onClose()
  }, [item.path, onClose])

  // ─── 操作：在浏览器中打开（HTML） ─────────────────────
  const handleOpenInBrowser = useCallback(async () => {
    const ok = await api.file.openInBrowser(item.path)
    if (!ok) toast.error(t('failedToOpenInBrowser', language) || '无法在浏览器中打开')
    onClose()
  }, [item.path, language, onClose])

  // ─── 操作：新建文件 / 文件夹（inline 编辑，与工作区一致） ────
  // 仅触发回调，实际创建逻辑（inline input + api 调用）由父组件 ProjectFilesTab 处理
  const handleNewFile = useCallback(() => {
    onStartCreate(item.path, 'file')
    onClose()
  }, [item, onStartCreate, onClose])

  const handleNewFolder = useCallback(() => {
    onStartCreate(item.path, 'folder')
    onClose()
  }, [item, onStartCreate, onClose])

  // ─── 构建菜单项 ───────────────────────────────────────
  const items = useCallback((): ContextMenuItem[] => {
    const isHtml = /\.(html?|htm)$/i.test(item.name)

    if (item.isDirectory) {
      return [
        { id: 'newFile', label: t('newFile', language), icon: FilePlus, onClick: handleNewFile },
        { id: 'newFolder', label: t('newFolder', language), icon: FolderPlus, onClick: handleNewFolder },
        { id: 'sep1', label: '', separator: true },
        { id: 'copy', label: t('contextMenu.copy', language), icon: Copy, shortcut: formatShortcut('Ctrl+C'), onClick: handleCopy },
        { id: 'paste', label: t('paste', language), icon: Clipboard, shortcut: formatShortcut('Ctrl+V'), disabled: !clipboardEnabled, onClick: handlePaste },
        { id: 'sep2', label: '', separator: true },
        { id: 'rename', label: t('contextMenu.rename', language), icon: Edit2, onClick: handleRename },
        { id: 'delete', label: t('contextMenu.delete', language), icon: Trash2, danger: true, onClick: handleDelete },
        { id: 'sep3', label: '', separator: true },
        { id: 'copyPath', label: t('contextMenu.copyPath', language), icon: Copy, onClick: handleCopyPath },
        { id: 'copyRelPath', label: t('contextMenu.copyRelativePath', language), icon: Clipboard, onClick: handleCopyRelativePath },
        { id: 'reveal', label: t('contextMenu.revealFolderLocation', language), icon: ExternalLink, onClick: handleReveal },
      ]
    }

    // 文件
    const fileItems: ContextMenuItem[] = []
    if (isHtml) {
      fileItems.push(
        { id: 'openInBrowser', label: t('contextMenu.openInBrowser', language), icon: Globe, onClick: handleOpenInBrowser },
        { id: 'sepHtml', label: '', separator: true },
      )
    }
    fileItems.push(
      { id: 'copy', label: t('contextMenu.copy', language), icon: Copy, shortcut: formatShortcut('Ctrl+C'), onClick: handleCopy },
      { id: 'paste', label: t('paste', language), icon: Clipboard, shortcut: formatShortcut('Ctrl+V'), disabled: !clipboardEnabled, onClick: handlePaste },
      { id: 'sep1', label: '', separator: true },
      { id: 'rename', label: t('contextMenu.rename', language), icon: Edit2, onClick: handleRename },
      { id: 'delete', label: t('contextMenu.delete', language), icon: Trash2, danger: true, onClick: handleDelete },
      { id: 'sep2', label: '', separator: true },
      { id: 'copyPath', label: t('contextMenu.copyPath', language), icon: Copy, onClick: handleCopyPath },
      { id: 'copyRelPath', label: t('contextMenu.copyRelativePath', language), icon: Clipboard, onClick: handleCopyRelativePath },
      { id: 'reveal', label: t('contextMenu.revealFileLocation', language), icon: ExternalLink, onClick: handleReveal },
    )
    return fileItems
  }, [
    item, language, clipboardEnabled,
    handleNewFile, handleNewFolder, handleCopy, handlePaste,
    handleRename, handleDelete, handleCopyPath, handleCopyRelativePath,
    handleReveal, handleOpenInBrowser,
  ])

  return (
    <FloatingMenu
      x={position.x}
      y={position.y}
      items={items()}
      onClose={onClose}
    />
  )
}

export default ProjectFileContextMenu
