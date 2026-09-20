/**
 * ArtifactContextMenu — 「产物」面板的文件右键菜单
 *
 * 与工作区文件树（VirtualTreeRenderer）的文件右键菜单保持一致：相同的菜单项、
 * 相同的顺序、相同的公共服务（api.file / 共享剪贴板 / 目录缓存 / 集成终端）。
 *
 * 产物条目只可能是文件，因此这里只对齐工作区菜单的「文件」分支：
 *   在浏览器中打开(HTML) | 转换为 Word/PDF(Markdown) | 导出 | 分享 |
 *   在此处打开终端 | 复制 / 粘贴 | 重命名 / 删除 |
 *   复制路径 / 相对路径 | 在文件夹中显示 | 显示/隐藏系统目录
 *
 * 菜单内的删除与重命名会同步产物列表（删除即移除条目、重命名即改为新路径），
 * 并通过 workspace:files-changed 事件让工作区文件树一并刷新。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Copy, Clipboard, Edit2, Trash2, ExternalLink, Globe, Upload, Share2,
  Terminal, FileType, FileText, FileDown, Eye, EyeOff,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '@renderer/adapters/electronBridge'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { globalPrompt } from '@components/foundation/PromptOverlay'
import { explorerClipboardService } from '@services/clipboardService'
import { directoryCacheService } from '@services/dirCacheAdapter'
import { terminalManager } from '@services/TerminalAdapter'
import { formatShortcut } from '@services/keybindingAdapter'
import { getDirPath, getFileName, joinPath, resolveToRelative } from '@shared/toolkit/pathHelper'
import { FloatingMenu, type ContextMenuItem } from '../../ui'

export interface ArtifactContextMenuProps {
  /** 触发菜单的产物文件路径 */
  path: string
  /** 菜单坐标 */
  position: { x: number; y: number }
  /** 关闭菜单 */
  onClose: () => void
}

export function ArtifactContextMenu({ path, position, onClose }: ArtifactContextMenuProps) {
  const {
    language,
    workspacePath,
    activeScenarioId,
    showWorkspaceSystemDir,
    setShowWorkspaceSystemDir,
    setTerminalVisible,
    removeArtifact,
    recordArtifact,
  } = useStore(useShallow(s => ({
    language: s.language,
    workspacePath: s.workspacePath,
    activeScenarioId: s.activeScenarioId,
    showWorkspaceSystemDir: s.showWorkspaceSystemDir,
    setShowWorkspaceSystemDir: s.setShowWorkspaceSystemDir,
    setTerminalVisible: s.setTerminalVisible,
    removeArtifact: s.removeArtifact,
    recordArtifact: s.recordArtifact,
  })))

  const [clipboardEnabled, setClipboardEnabled] = useState(
    () => Boolean(explorerClipboardService.getState().entry),
  )

  // 订阅共享剪贴板：复制之后「粘贴」立即可用
  useEffect(() => {
    return explorerClipboardService.subscribe(state => setClipboardEnabled(Boolean(state.entry)))
  }, [])

  const fileName = getFileName(path)
  const dirPath = getDirPath(path)

  /** 通知工作区文件树刷新受影响目录 */
  const notifyFilesChanged = useCallback((affectedDir: string, deletedPath?: string) => {
    if (!affectedDir) return
    directoryCacheService.invalidate(affectedDir)
    window.dispatchEvent(new CustomEvent('workspace:files-changed', {
      detail: {
        affectedPaths: [affectedDir],
        deletedPaths: deletedPath ? [deletedPath] : [],
        refreshRoot: false,
      },
    }))
  }, [])

  // ─── 操作：复制 ───────────────────────────────────────
  const handleCopy = useCallback(() => {
    explorerClipboardService.setItem({
      path,
      name: fileName,
      isDirectory: false,
      copiedAt: Date.now(),
    })
    toast.success(t('file-tree.filecopied', language as Language))
    onClose()
  }, [path, fileName, language, onClose])

  // ─── 操作：粘贴到产物所在目录（重名自动加「- 副本」） ────
  const handlePaste = useCallback(async () => {
    const clip = explorerClipboardService.getState().entry
    if (!clip || !dirPath) {
      onClose()
      return
    }

    const nameParts = clip.name.match(/^(.*?)(\.[^.]*)?$/)
    const baseName = nameParts?.[1] || clip.name
    const extension = clip.isDirectory ? '' : (nameParts?.[2] || '')

    let candidateName = `${baseName} - 副本${extension}`
    let candidatePath = joinPath(dirPath, candidateName)
    let counter = 2

    try {
      while (await api.file.exists(candidatePath)) {
        candidateName = `${baseName} - 副本 ${counter}${extension}`
        candidatePath = joinPath(dirPath, candidateName)
        counter += 1
      }

      const ok = await api.file.copy(clip.path, candidatePath)
      if (!ok) {
        toast.error(t('file-tree.pastefailed', language as Language))
      } else {
        notifyFilesChanged(dirPath)
        toast.success(t('file-tree.filepasted', language as Language))
      }
    } catch {
      toast.error(t('file-tree.pastefailed', language as Language))
    }
    onClose()
  }, [dirPath, language, notifyFilesChanged, onClose])

  // ─── 操作：重命名 ─────────────────────────────────────
  const handleRename = useCallback(async () => {
    const input = await globalPrompt({
      title: t('contextMenu.rename', language as Language),
      message: t('contextMenu.rename', language as Language),
      defaultValue: fileName,
      confirmText: t('common.confirm', language as Language) || '确定',
    })
    if (input === null || !input.trim() || input.trim() === fileName) {
      onClose()
      return
    }

    const trimmed = input.trim()
    if (/[\\/:*?"<>|]/.test(trimmed)) {
      toast.error(t('contextMenu.invalidFileName', language as Language) || '名称包含非法字符')
      onClose()
      return
    }

    const newPath = joinPath(dirPath, trimmed)
    try {
      const ok = await api.file.rename(path, newPath)
      if (!ok) {
        toast.error(t('contextMenu.renameFailed', language as Language) || '重命名失败')
      } else {
        // 产物条目跟随重命名：旧路径移除，新路径重新登记
        removeArtifact(path)
        if (workspacePath) {
          recordArtifact({ path: newPath, workspacePath, action: 'edit' })
        }
        notifyFilesChanged(dirPath, path)
        toast.success(t('contextMenu.renameSuccess', language as Language) || '重命名成功')
      }
    } catch {
      toast.error(t('contextMenu.renameFailed', language as Language) || '重命名失败')
    }
    onClose()
  }, [dirPath, fileName, language, notifyFilesChanged, onClose, path, recordArtifact, removeArtifact, workspacePath])

  // ─── 操作：删除 ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    const confirmed = await globalConfirm({
      title: t('contextMenu.delete', language as Language),
      message: t('contextMenu.confirmDelete', language as Language, { name: fileName }),
      confirmText: t('contextMenu.delete', language as Language),
      cancelText: t('cancel', language as Language),
      variant: 'danger',
    })
    if (!confirmed) {
      onClose()
      return
    }

    try {
      await api.file.delete(path)
      removeArtifact(path)
      notifyFilesChanged(dirPath, path)
      toast.success(t('contextMenu.deleteSuccess', language as Language) || '删除成功')
    } catch {
      toast.error(t('contextMenu.deleteFailed', language as Language) || '删除失败')
    }
    onClose()
  }, [dirPath, fileName, language, notifyFilesChanged, onClose, path, removeArtifact])

  // ─── 操作：复制路径 / 相对路径 ─────────────────────────
  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(path)
    toast.success(t('pathCopied', language as Language) || '路径已复制')
    onClose()
  }, [path, language, onClose])

  const handleCopyRelativePath = useCallback(() => {
    if (!workspacePath) {
      onClose()
      return
    }
    navigator.clipboard.writeText(resolveToRelative(path, workspacePath))
    toast.success(t('pathCopied', language as Language) || '路径已复制')
    onClose()
  }, [path, workspacePath, language, onClose])

  // ─── 操作：在文件夹中显示 ─────────────────────────────
  const handleReveal = useCallback(() => {
    api.file.showInFolder(path)
    onClose()
  }, [path, onClose])

  // ─── 操作：在浏览器中打开（HTML） ─────────────────────
  const handleOpenInBrowser = useCallback(async () => {
    const ok = await api.file.openInBrowser(path)
    if (!ok) toast.error(t('failedToOpenInBrowser', language as Language) || '无法在浏览器中打开')
    onClose()
  }, [path, language, onClose])

  // ─── 操作：导出到工作区外 ─────────────────────────────
  const handleExport = useCallback(async () => {
    const targetDir = await api.file.selectForExport({
      title: t('file-tree.exportto', language as Language),
      defaultPath: dirPath,
    })
    if (!targetDir) {
      onClose()
      return
    }
    const result = await api.file.exportFromWorkspace(path, targetDir)
    if (result.success) {
      toast.success(t('file-tree.successfullyexportedto', language as Language, { target: result.target }))
    } else {
      toast.error(t('file-tree.exportfailed', language as Language, { error: result.error }))
    }
    onClose()
  }, [path, dirPath, language, onClose])

  // ─── 操作：分享 ───────────────────────────────────────
  const handleShare = useCallback(async () => {
    const result = await api.file.shareItem([path])
    if (!result.success) {
      if (result.error === 'Share is only supported on macOS') {
        toast.warning(t('file-tree.shareisonlysupportedon', language as Language))
      } else {
        toast.error(t('file-tree.sharefailed', language as Language, { error: result.error }))
      }
    }
    onClose()
  }, [path, language, onClose])

  // ─── 操作：在此处打开集成终端 ─────────────────────────
  const handleOpenTerminal = useCallback(async () => {
    if (!dirPath) {
      onClose()
      return
    }
    setTerminalVisible(true)
    await terminalManager.createTerminal({
      cwd: dirPath,
      name: t('terminal', language as Language),
    })
    onClose()
  }, [dirPath, language, setTerminalVisible, onClose])

  // ─── 操作：Markdown 转换为 Word / PDF ─────────────────
  const handleConvert = useCallback(async (targetFormat: 'docx' | 'pdf') => {
    const targetPath = path.replace(/\.[^.]+$/, `.${targetFormat}`)
    toast.info(t('contextMenu.converting', language as Language) || `Converting to ${targetFormat}...`)

    try {
      const convertFn = (api.file as unknown as {
        convertDocument?: (src: string, fmt: string, dst: string) => Promise<boolean>
      }).convertDocument
      const ok = convertFn ? await convertFn(path, targetFormat, targetPath) : false

      if (ok) {
        toast.success(t('contextMenu.convertSuccess', language as Language) || `Converted to ${targetFormat}`)
        notifyFilesChanged(dirPath)
      } else {
        // 主进程未提供转换能力时，交给 AI 执行转换（ChatPanel 监听该事件）
        toast.info(t('contextMenu.convertViaAgent', language as Language) || 'Launching AI agent to convert...')
        const prompt = `请将 Markdown 文件 "${path}" 转换为 ${targetFormat.toUpperCase()} 格式，保存到 "${targetPath}"。要求：1) 保留原文档的标题层级、列表、代码块、表格等格式；2) 如果需要安装转换工具（如 pandoc），请先安装再执行转换；3) 转换完成后告诉我输出文件的路径。`
        window.dispatchEvent(new CustomEvent('chat-send-message', { detail: { content: prompt } }))
      }
    } catch (e) {
      toast.error(t('contextMenu.convertFailed', language as Language) || `Conversion failed: ${e}`)
    }
    onClose()
  }, [path, dirPath, language, notifyFilesChanged, onClose])

  // ─── 构建菜单项（与工作区文件菜单的文件分支对齐） ────────
  const items: ContextMenuItem[] = []
  const lowerName = fileName.toLowerCase()
  const isHtmlFile = lowerName.endsWith('.html') || lowerName.endsWith('.htm')
  const isMdFile = lowerName.endsWith('.md') || lowerName.endsWith('.markdown')
  const isWorkspaceEditor = activeScenarioId === 'dev-assistant'

  if (isHtmlFile) {
    items.push({ id: 'openInBrowser', label: t('contextMenu.openInBrowser', language as Language), icon: Globe, onClick: () => void handleOpenInBrowser() })
    items.push({ id: 'sepHtml', label: '', separator: true })
  }

  if (isMdFile) {
    items.push({
      id: 'convertTo',
      label: t('contextMenu.convertTo', language as Language),
      icon: FileType,
      children: [
        { id: 'convertToDocx', label: 'Word', icon: FileText, onClick: () => void handleConvert('docx') },
        { id: 'convertToPdf', label: 'PDF', icon: FileDown, onClick: () => void handleConvert('pdf') },
      ],
    })
    items.push({ id: 'sepConvert', label: '', separator: true })
  }

  items.push(
    { id: 'export', label: t('contextMenu.exportFiles', language as Language), icon: Upload, onClick: () => void handleExport() },
    { id: 'share', label: t('contextMenu.shareItem', language as Language), icon: Share2, onClick: () => void handleShare() },
    ...(isWorkspaceEditor
      ? [
          { id: 'sepTerminalOpen', label: '', separator: true } as ContextMenuItem,
          { id: 'openTerminal', label: t('contextMenu.openIntegratedTerminalHere', language as Language), icon: Terminal, onClick: () => void handleOpenTerminal() } as ContextMenuItem,
        ]
      : []),
    { id: 'sepClipboard', label: '', separator: true },
    { id: 'copy', label: t('contextMenu.copy', language as Language), icon: Copy, shortcut: formatShortcut('Ctrl+C'), onClick: handleCopy },
    { id: 'paste', label: t('paste', language as Language), icon: Clipboard, shortcut: formatShortcut('Ctrl+V'), disabled: !clipboardEnabled, onClick: () => void handlePaste() },
    { id: 'sepEdit', label: '', separator: true },
    { id: 'rename', label: t('contextMenu.rename', language as Language), icon: Edit2, onClick: () => void handleRename() },
    { id: 'delete', label: t('contextMenu.delete', language as Language), icon: Trash2, danger: true, onClick: () => void handleDelete() },
    { id: 'sepPath', label: '', separator: true },
    { id: 'copyPath', label: t('contextMenu.copyPath', language as Language), icon: Copy, onClick: handleCopyPath },
    { id: 'copyRelPath', label: t('contextMenu.copyRelativePath', language as Language), icon: Clipboard, onClick: handleCopyRelativePath },
    { id: 'reveal', label: t('contextMenu.revealFileLocation', language as Language), icon: ExternalLink, onClick: handleReveal },
    { id: 'sepHidden', label: '', separator: true },
    {
      id: 'toggleHidden',
      label: showWorkspaceSystemDir
        ? t('contextMenu.hideWorkspaceSystemDir', language as Language)
        : t('contextMenu.showWorkspaceSystemDir', language as Language),
      icon: showWorkspaceSystemDir ? EyeOff : Eye,
      onClick: () => {
        setShowWorkspaceSystemDir(!showWorkspaceSystemDir)
        onClose()
      },
    },
  )

  return (
    <FloatingMenu
      x={position.x}
      y={position.y}
      items={items}
      onClose={onClose}
    />
  )
}

export default ArtifactContextMenu
