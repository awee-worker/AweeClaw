/**
 * ProjectAttachmentsPanel — 项目附件管理面板（本地优先架构）
 *
 * 功能：
 * - 展示项目下所有附件列表（文件名、大小、类型图标、上传时间）
 * - 上传新附件：点击按钮选择 / 拖拽上传（整个面板均为 drop zone）
 * - 删除附件（hover 显示删除按钮）
 * - 拖拽悬浮遮罩提示"松开以上传"
 *
 * 拖拽上传设计：
 * - 使用 useFileDropZone hook 统一管理悬浮态与边界检测防抖
 * - window 级别 preventDefault 防止拖到面板外时浏览器打开文件
 * - 上传中禁用拖拽（disabled），光标显示 none
 * - 扩展名白名单来自 BRAND.attachmentConfig，与主进程校验一致
 *
 * 数据安全隐私：
 * - 附件文件优先存储到工作区 .aweeclaw/attachments/ 目录
 * - 后端仅作为可选的跨设备同步兜底
 * - 所有读写操作通过 localAttachmentsService → 主进程 IPC 完成
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Paperclip, Upload, Trash2, FileText, FileImage, FileArchive,
  FileSpreadsheet, File, Loader2, AlertCircle,
} from 'lucide-react'
import { BRAND } from '@shared/brand'
import { localAttachmentsService } from '@renderer/adapters/localAttachmentsService'
import type { LocalAttachmentItem } from '@renderer/adapters/electronBridge'
import { useFileDropZone } from '@renderer/hooks/useFileDropZone'

interface ProjectAttachmentsPanelProps {
  projectId: string
  isZh: boolean
}

/** 根据 mimeType 选择文件图标 */
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('text')) return FileText
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return FileSpreadsheet
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return FileArchive
  return File
}

/** 格式化文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 允许上传的文件扩展名（来自 BRAND 单一真相源，与主进程一致） */
const ALLOWED_EXTENSIONS = [...BRAND.attachmentConfig.allowedExtensions]

/** <input accept> 属性 */
const ACCEPT_ATTR = BRAND.attachmentConfig.acceptAttr

export function ProjectAttachmentsPanel({ projectId, isZh }: ProjectAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<LocalAttachmentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 加载附件列表（本地优先） */
  const loadAttachments = useCallback(async () => {
    setLoading(true)
    try {
      const data = await localAttachmentsService.list(projectId)
      setAttachments(data)
      setError(null)
    } catch (e) {
      setError(isZh ? '加载附件失败' : 'Failed to load attachments')
    }
    setLoading(false)
  }, [projectId, isZh])

  useEffect(() => {
    loadAttachments()
  }, [loadAttachments])

  /** 处理文件上传（存到工作区 .aweeclaw/attachments/） */
  const handleUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const newAttachments = await localAttachmentsService.upload(projectId, files)
      setAttachments(prev => [...prev, ...newAttachments])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(isZh ? `上传附件失败：${msg}` : `Failed to upload: ${msg}`)
    }
    setUploading(false)
  }, [projectId, isZh])

  /** 删除附件（本地） */
  const handleRemove = useCallback(async (attachmentId: string) => {
    setRemovingId(attachmentId)
    setError(null)
    try {
      await localAttachmentsService.remove(projectId, attachmentId)
      setAttachments(prev => prev.filter(a => a.id !== attachmentId))
    } catch (e) {
      setError(isZh ? '删除附件失败' : 'Failed to delete attachment')
    }
    setRemovingId(null)
  }, [projectId, isZh])

  /**
   * 拖拽上传：整个面板作为 drop zone
   * - accept 扩展名白名单过滤（与主进程一致）
   * - 上传中禁用拖拽
   * - 拒绝文件给出提示
   */
  const { isDragging, dragHandlers } = useFileDropZone({
    onDrop: handleUpload,
    accept: ALLOWED_EXTENSIONS,
    disabled: uploading,
    onRejected: (rejected) => {
      const names = rejected.map(f => f.name).join(', ')
      setError(isZh ? `不支持的文件类型：${names}` : `Unsupported file type: ${names}`)
    },
  })

  /**
   * 全局阻止浏览器默认的拖拽行为（打开文件/导航）
   * 仅在面板挂载期间生效，避免拖到面板外区域时 Electron 打开文件
   */
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault()
    }
    window.addEventListener('dragover', preventDefault)
    window.addEventListener('drop', preventDefault)
    return () => {
      window.removeEventListener('dragover', preventDefault)
      window.removeEventListener('drop', preventDefault)
    }
  }, [])

  /** 点击文件选择器 */
  const openFilePicker = useCallback(() => {
    if (!uploading) fileInputRef.current?.click()
  }, [uploading])

  return (
    <div
      className="relative p-5 max-w-3xl"
      {...dragHandlers}
    >
      {/* 操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-text-muted" />
          <span className="text-[13px] text-text-secondary">
            {isZh ? `附件 (${attachments.length})` : `Attachments (${attachments.length})`}
          </span>
          <span className="text-[12px] text-text-muted/60 ml-1">
            {isZh ? '工作区本地存储' : 'Workspace local'}
          </span>
        </div>
        <button
          onClick={openFilePicker}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-md text-[12px] font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {isZh ? '上传附件' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleUpload(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <span className="text-[12px] text-red-500 flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[12px] text-red-500/70 hover:text-red-500">
            ✕
          </button>
        </div>
      )}

      {/* 附件列表 / 空状态 */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
        </div>
      ) : attachments.length === 0 ? (
        <div
          onClick={openFilePicker}
          className={`flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
            isDragging
              ? 'border-accent bg-accent/10'
              : 'border-border/40 hover:border-border/60 hover:bg-surface-hover/20'
          }`}
        >
          <Upload className={`w-8 h-8 mb-3 ${isDragging ? 'text-accent' : 'text-text-muted/40'}`} />
          <p className="text-[13px] text-text-muted">
            {isZh ? '拖拽文件到此处，或点击上传' : 'Drag files here, or click to upload'}
          </p>
          <p className="text-[12px] mt-1 text-text-muted/60">
            {isZh ? '支持 PDF、Word、Excel、PPT、文本、图片（单文件 20MB）' : 'PDF, Word, Excel, PPT, text, images (max 20MB each)'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((attachment) => {
            const Icon = getFileIcon(attachment.mimeType)
            return (
              <div
                key={attachment.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:bg-surface-hover/40 hover:border-border/20 transition-all"
              >
                <Icon className="w-4 h-4 text-text-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text-primary truncate">
                      {attachment.fileName}
                    </span>
                    {attachment.hasText && (
                      <span
                        title={isZh ? '已提取文本，AI 可读取' : 'Text extracted, readable by AI'}
                        className="flex-shrink-0 px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 text-[12px] font-medium"
                      >
                        {isZh ? '可读' : 'Text'}
                      </span>
                    )}
                    {attachment.textTruncated && (
                      <span
                        title={isZh ? '文本内容较长，已截断' : 'Text truncated'}
                        className="flex-shrink-0 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[12px] font-medium"
                      >
                        {isZh ? '截断' : 'Trunc'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[12px] text-text-muted">
                    <span>{formatFileSize(attachment.fileSize)}</span>
                    <span>{new Date(attachment.createdAt).toLocaleString(isZh ? 'zh-CN' : 'en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}</span>
                  </div>
                </div>
                {/* 删除按钮 */}
                <button
                  onClick={() => handleRemove(attachment.id)}
                  disabled={removingId === attachment.id}
                  title={isZh ? '删除附件' : 'Delete attachment'}
                  className="p-1 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                >
                  {removingId === attachment.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
            )
          })}

          {/* 拖拽引导提示（有附件时，非拖拽态显示） */}
          {!isDragging && !uploading && (
            <p className="text-[12px] text-text-muted/50 text-center pt-2">
              {isZh ? '也可拖拽文件到此处上传' : 'You can also drag files here to upload'}
            </p>
          )}

          {/* 上传中提示 */}
          {uploading && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
              <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
              <span className="text-[12px] text-accent">
                {isZh ? '正在上传并提取文本...' : 'Uploading and extracting text...'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 拖拽悬浮遮罩：松开鼠标以上传（覆盖整个面板，视觉醒目） */}
      {isDragging && !uploading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg bg-accent/10 backdrop-blur-[1px] border-2 border-dashed border-accent pointer-events-none">
          <Upload className="w-10 h-10 text-accent mb-2" />
          <p className="text-[14px] font-medium text-accent">
            {isZh ? '松开鼠标以上传' : 'Drop to upload'}
          </p>
        </div>
      )}
    </div>
  )
}
