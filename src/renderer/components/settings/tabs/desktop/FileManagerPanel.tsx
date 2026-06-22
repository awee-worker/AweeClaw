/**
 * 文件操作面板
 * 支持文件/目录的复制、移动、删除、重命名
 * 支持查看文件信息、判断存在、创建目录、列出目录内容
 */

import { useState, useCallback } from 'react'
import { Copy, Move, Trash2, Edit3, FileText, FolderPlus, Folder, RefreshCw, X } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface FileInfo {
  name: string
  path: string
  size: number
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
  permissions?: string
}

interface FileManagerPanelProps {
  language: Language
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

export function FileManagerPanel({ language }: FileManagerPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // 复制/移动参数
  const [sourcePath, setSourcePath] = useState('')
  const [targetPath, setTargetPath] = useState('')

  // 删除参数
  const [deletePath, setDeletePath] = useState('')

  // 重命名参数
  const [renamePath, setRenamePath] = useState('')
  const [newName, setNewName] = useState('')

  // 文件信息参数
  const [infoPath, setInfoPath] = useState('')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)

  // 目录列表参数
  const [dirPath, setDirPath] = useState('')
  const [dirEntries, setDirEntries] = useState<FileInfo[]>([])

  // 创建目录参数
  const [mkdirPath, setMkdirPath] = useState('')

  const runAction = useCallback(
    async (key: string, action: () => Promise<{ success: boolean; data?: unknown }>, successMsg?: string) => {
      setBusy(key)
      setError(null)
      setMessage(null)
      try {
        const result = await action()
        if (result.success) {
          if (successMsg) setMessage(successMsg)
        } else {
          setError(t('desktop.fileOpFailed', language) || '操作失败')
        }
        return result
      } catch (err) {
        logger.desktop?.error?.(`[FileManagerPanel] ${key} error:`, err)
        setError(err instanceof Error ? err.message : String(err))
        return { success: false }
      } finally {
        setBusy(null)
      }
    },
    [language],
  )

  const handleCopy = useCallback(() => {
    if (!sourcePath.trim() || !targetPath.trim()) {
      setError(t('desktop.pathsRequired', language) || '源路径和目标路径必填')
      return
    }
    void runAction(
      'copy',
      () => window.electronAPI.desktopCopyFile(sourcePath.trim(), targetPath.trim()),
      t('desktop.copySuccess', language) || '复制成功',
    )
  }, [sourcePath, targetPath, language, runAction])

  const handleMove = useCallback(() => {
    if (!sourcePath.trim() || !targetPath.trim()) {
      setError(t('desktop.pathsRequired', language) || '源路径和目标路径必填')
      return
    }
    void runAction(
      'move',
      () => window.electronAPI.desktopMoveFile(sourcePath.trim(), targetPath.trim()),
      t('desktop.moveSuccess', language) || '移动成功',
    )
  }, [sourcePath, targetPath, language, runAction])

  const handleDelete = useCallback(() => {
    if (!deletePath.trim()) {
      setError(t('desktop.pathRequired', language) || '路径必填')
      return
    }
    const confirmed = window.confirm(
      t('desktop.confirmDelete', language) || `确定要删除 "${deletePath}" 吗？此操作不可恢复！`,
    )
    if (!confirmed) return
    void runAction(
      'delete',
      () => window.electronAPI.desktopDeleteFile(deletePath.trim()),
      t('desktop.deleteSuccess', language) || '删除成功',
    )
  }, [deletePath, language, runAction])

  const handleRename = useCallback(() => {
    if (!renamePath.trim() || !newName.trim()) {
      setError(t('desktop.renameFieldsRequired', language) || '路径和新名称必填')
      return
    }
    void runAction(
      'rename',
      () => window.electronAPI.desktopRenameFile(renamePath.trim(), newName.trim()),
      t('desktop.renameSuccess', language) || '重命名成功',
    )
  }, [renamePath, newName, language, runAction])

  const handleGetInfo = useCallback(async () => {
    if (!infoPath.trim()) {
      setError(t('desktop.pathRequired', language) || '路径必填')
      return
    }
    setFileInfo(null)
    const result = await runAction('info', () => window.electronAPI.desktopGetFileInfo(infoPath.trim()))
    if (result.success) {
      setFileInfo(result.data as FileInfo)
    }
  }, [infoPath, language, runAction])

  const handleListDir = useCallback(async () => {
    if (!dirPath.trim()) {
      setError(t('desktop.pathRequired', language) || '路径必填')
      return
    }
    setDirEntries([])
    const result = await runAction('list', () => window.electronAPI.desktopListDirectory(dirPath.trim()))
    if (result.success) {
      setDirEntries((result.data as FileInfo[]) || [])
    }
  }, [dirPath, language, runAction])

  const handleMkdir = useCallback(() => {
    if (!mkdirPath.trim()) {
      setError(t('desktop.pathRequired', language) || '路径必填')
      return
    }
    void runAction(
      'mkdir',
      () => window.electronAPI.desktopCreateDirectory(mkdirPath.trim()),
      t('desktop.mkdirSuccess', language) || '目录创建成功',
    )
  }, [mkdirPath, language, runAction])

  return (
    <div className="space-y-4">
      {/* 消息提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {message && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm">
          <span className="flex-1">{message}</span>
          <button onClick={() => setMessage(null)} className="text-emerald-600 hover:text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 复制文件 */}
        <FileActionCard
          icon={<Copy className="w-4 h-4" />}
          title={t('desktop.copyFile', language) || '复制文件/目录'}
          busy={busy === 'copy'}
          onRun={handleCopy}
          runLabel={t('common.copy', language) || '复制'}
          language={language}
        >
          <PathInput
            label={t('desktop.sourcePath', language) || '源路径'}
            value={sourcePath}
            onChange={setSourcePath}
            placeholder="/path/to/source"
            language={language}
          />
          <PathInput
            label={t('desktop.targetPath', language) || '目标路径'}
            value={targetPath}
            onChange={setTargetPath}
            placeholder="/path/to/target"
            language={language}
          />
        </FileActionCard>

        {/* 移动文件 */}
        <FileActionCard
          icon={<Move className="w-4 h-4" />}
          title={t('desktop.moveFile', language) || '移动文件/目录'}
          busy={busy === 'move'}
          onRun={handleMove}
          runLabel={t('common.move', language) || '移动'}
          language={language}
        >
          <PathInput
            label={t('desktop.sourcePath', language) || '源路径'}
            value={sourcePath}
            onChange={setSourcePath}
            placeholder="/path/to/source"
            language={language}
          />
          <PathInput
            label={t('desktop.targetPath', language) || '目标路径'}
            value={targetPath}
            onChange={setTargetPath}
            placeholder="/path/to/target"
            language={language}
          />
        </FileActionCard>

        {/* 删除文件 */}
        <FileActionCard
          icon={<Trash2 className="w-4 h-4" />}
          title={t('desktop.deleteFile', language) || '删除文件/目录'}
          busy={busy === 'delete'}
          onRun={handleDelete}
          runLabel={t('common.delete', language) || '删除'}
          language={language}
          danger
        >
          <PathInput
            label={t('desktop.targetPath', language) || '目标路径'}
            value={deletePath}
            onChange={setDeletePath}
            placeholder="/path/to/delete"
            language={language}
          />
        </FileActionCard>

        {/* 重命名 */}
        <FileActionCard
          icon={<Edit3 className="w-4 h-4" />}
          title={t('desktop.renameFile', language) || '重命名'}
          busy={busy === 'rename'}
          onRun={handleRename}
          runLabel={t('common.rename', language) || '重命名'}
          language={language}
        >
          <PathInput
            label={t('desktop.sourcePath', language) || '源路径'}
            value={renamePath}
            onChange={setRenamePath}
            placeholder="/path/to/file"
            language={language}
          />
          <PathInput
            label={t('desktop.newName', language) || '新名称'}
            value={newName}
            onChange={setNewName}
            placeholder="newname.txt"
            language={language}
          />
        </FileActionCard>

        {/* 创建目录 */}
        <FileActionCard
          icon={<FolderPlus className="w-4 h-4" />}
          title={t('desktop.createDirectory', language) || '创建目录'}
          busy={busy === 'mkdir'}
          onRun={handleMkdir}
          runLabel={t('desktop.create', language) || '创建'}
          language={language}
        >
          <PathInput
            label={t('desktop.directoryPath', language) || '目录路径'}
            value={mkdirPath}
            onChange={setMkdirPath}
            placeholder="/path/to/new/dir"
            language={language}
          />
        </FileActionCard>

        {/* 文件信息 */}
        <FileActionCard
          icon={<FileText className="w-4 h-4" />}
          title={t('desktop.fileInfo', language) || '文件信息'}
          busy={busy === 'info'}
          onRun={handleGetInfo}
          runLabel={t('desktop.query', language) || '查询'}
          language={language}
        >
          <PathInput
            label={t('desktop.filePath', language) || '文件路径'}
            value={infoPath}
            onChange={setInfoPath}
            placeholder="/path/to/file"
            language={language}
          />
        </FileActionCard>
      </div>

      {/* 文件信息展示 */}
      {fileInfo && (
        <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">
              {t('desktop.fileInfoTitle', language) || '文件详情'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <InfoRow label={t('desktop.fileName', language) || '名称'} value={fileInfo.name} />
            <InfoRow label={t('desktop.fileSize', language) || '大小'} value={formatBytes(fileInfo.size)} />
            <InfoRow
              label={t('desktop.fileType', language) || '类型'}
              value={fileInfo.isDirectory ? (t('desktop.directory', language) || '目录') : (t('desktop.file', language) || '文件')}
            />
            <InfoRow label={t('desktop.permissions', language) || '权限'} value={fileInfo.permissions || '-'} />
            <InfoRow label={t('desktop.createdAt', language) || '创建时间'} value={formatTime(fileInfo.createdAt)} />
            <InfoRow label={t('desktop.modifiedAt', language) || '修改时间'} value={formatTime(fileInfo.modifiedAt)} />
            <div className="col-span-2">
              <InfoRow label={t('desktop.filePath', language) || '路径'} value={fileInfo.path} />
            </div>
          </div>
        </div>
      )}

      {/* 目录列表 */}
      <div className="rounded-xl border border-border/40 bg-surface/50">
        <div className="flex items-center gap-2 p-3 border-b border-border/40">
          <Folder className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">
            {t('desktop.directoryList', language) || '目录列表'}
          </span>
          <div className="flex-1 ml-2">
            <input
              type="text"
              value={dirPath}
              onChange={e => setDirPath(e.target.value)}
              placeholder={t('desktop.directoryPathPlaceholder', language) || '/path/to/directory'}
              className="w-full px-3 py-1.5 rounded-md bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          <ActionButton
            onClick={() => void handleListDir()}
            variant="ghost"
            size="sm"
            disabled={busy === 'list'}
          >
            <RefreshCw className={`w-4 h-4 ${busy === 'list' ? 'animate-spin' : ''}`} />
          </ActionButton>
        </div>

        {dirEntries.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-text-muted uppercase tracking-wide border-b border-border/40 bg-surface-hover/30">
              <div className="col-span-5">{t('desktop.fileName', language) || '名称'}</div>
              <div className="col-span-3">{t('desktop.fileType', language) || '类型'}</div>
              <div className="col-span-2 text-right">{t('desktop.fileSize', language) || '大小'}</div>
              <div className="col-span-2 text-right">{t('desktop.modifiedAt', language) || '修改时间'}</div>
            </div>
            {dirEntries.map(entry => (
              <div
                key={entry.path}
                className="grid grid-cols-12 gap-2 px-4 py-2 text-sm hover:bg-surface-hover/30 border-b border-border/20 last:border-0"
              >
                <div className="col-span-5 flex items-center gap-2 min-w-0">
                  {entry.isDirectory ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
                  )}
                  <span className="text-text-primary truncate" title={entry.name}>
                    {entry.name}
                  </span>
                </div>
                <div className="col-span-3 text-text-muted text-xs">
                  {entry.isDirectory ? (t('desktop.directory', language) || '目录') : (t('desktop.file', language) || '文件')}
                </div>
                <div className="col-span-2 text-right text-text-muted font-mono text-xs">
                  {entry.isDirectory ? '-' : formatBytes(entry.size)}
                </div>
                <div className="col-span-2 text-right text-text-muted text-xs">
                  {formatTime(entry.modifiedAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-text-muted text-sm">
            {t('desktop.emptyDirectory', language) || '输入目录路径并点击刷新按钮查看内容'}
          </div>
        )}
      </div>
    </div>
  )
}

/** 文件操作卡片 */
function FileActionCard({
  icon,
  title,
  busy,
  onRun,
  runLabel,
  language,
  danger = false,
  children,
}: {
  icon: React.ReactNode
  title: string
  busy: boolean
  onRun: () => void
  runLabel: string
  language: Language
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`p-1.5 rounded-md ${
            danger ? 'bg-red-500/10 text-red-600' : 'bg-accent/10 text-accent'
          }`}
        >
          {icon}
        </div>
        <span className="text-sm font-medium text-text-primary">{title}</span>
      </div>
      <div className="space-y-2 mb-3">{children}</div>
      <ActionButton
        onClick={onRun}
        variant={danger ? 'danger' : 'primary'}
        size="sm"
        disabled={busy}
        className="w-full"
      >
        {busy ? (t('desktop.executing', language) || '执行中...') : runLabel}
      </ActionButton>
    </div>
  )
}

/** 路径输入 */
function PathInput({
  label,
  value,
  onChange,
  placeholder,
  language: _language,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  language: Language
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md bg-surface border border-border/60 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
      />
    </div>
  )
}

/** 信息行 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-muted shrink-0">{label}:</span>
      <span className="text-sm text-text-primary truncate" title={value}>
        {value}
      </span>
    </div>
  )
}

export default FileManagerPanel
