/**
 * 文件附件视图
 * 展示用户消息附带的非图片文件（PDF/Word/Excel 等）
 *
 * 布局策略：
 * - 单文件：宽卡片，图标+文件名+扩展名标签
 * - 多文件：自适应网格，每行最多 2 个
 */
import React from 'react'
import { FileText, FileSpreadsheet, FileCode, FileType } from 'lucide-react'

interface FileAttachment {
  name: string
  media_type: string
}

interface FileAttachmentsViewProps {
  files: FileAttachment[]
}

/** 文件类型配置：图标 + 主题色 */
interface FileTypeConfig {
  Icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  label: string
}

function getFileTypeConfig(ext: string): FileTypeConfig {
  const documentExts = ['pdf', 'doc', 'docx', 'odt', 'rtf']
  const spreadsheetExts = ['xlsx', 'xls', 'csv', 'ods']
  const codeExts = ['txt', 'md', 'json', 'xml', 'html', 'js', 'ts', 'py', 'go', 'java', 'c', 'cpp']

  if (documentExts.includes(ext)) {
    return { Icon: FileType, color: 'text-red-400', bg: 'bg-red-500/10', label: '文档' }
  }
  if (spreadsheetExts.includes(ext)) {
    return { Icon: FileSpreadsheet, color: 'text-green-400', bg: 'bg-green-500/10', label: '表格' }
  }
  if (codeExts.includes(ext)) {
    return { Icon: FileCode, color: 'text-blue-400', bg: 'bg-blue-500/10', label: '代码' }
  }
  return { Icon: FileText, color: 'text-accent', bg: 'bg-accent/10', label: '文件' }
}

/** 截断过长的文件名（保留扩展名） */
function truncateFileName(name: string, maxLen = 24): string {
  if (name.length <= maxLen) return name
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex < 0) return name.slice(0, maxLen - 3) + '...'
  const ext = name.slice(dotIndex)
  const baseMax = maxLen - ext.length - 3
  if (baseMax <= 0) return name.slice(0, maxLen - 3) + '...'
  return name.slice(0, baseMax) + '...' + ext
}

function FileAttachmentsViewBase({ files }: FileAttachmentsViewProps) {
  if (!files || files.length === 0) return null

  const isSingle = files.length === 1

  return (
    <div className={`flex flex-wrap gap-1.5 max-w-[360px] ${isSingle ? '' : 'justify-end'}`}>
      {files.map((file, i) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        const { Icon, color, bg, label } = getFileTypeConfig(ext)
        const displayName = truncateFileName(file.name)

        return (
          <div
            key={`file-${file.name}-${i}`}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border border-border/40 bg-surface/60 hover:bg-surface/80 hover:border-border/60 transition-colors ${
              isSingle ? 'w-full max-w-[300px]' : 'min-w-[140px] max-w-[200px] flex-1'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary truncate" title={file.name}>
                {displayName}
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">
                {ext.toUpperCase()} · {label}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const FileAttachmentsView = React.memo(FileAttachmentsViewBase)
FileAttachmentsView.displayName = 'FileAttachmentsView'
