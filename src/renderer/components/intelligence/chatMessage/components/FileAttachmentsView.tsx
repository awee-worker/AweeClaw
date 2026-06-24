/**
 * 文件附件视图
 * 展示用户消息附带的非图片文件
 */
import React from 'react'

interface FileAttachment {
  name: string
  media_type: string
}

interface FileAttachmentsViewProps {
  files: FileAttachment[]
}

function FileAttachmentsViewBase({ files }: FileAttachmentsViewProps) {
  if (!files || files.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2 justify-end">
      {files.map((file, i) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        return (
          <div
            key={`file-${file.name}-${i}`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-text-inverted/10 bg-surface/30 max-w-[220px]"
          >
            <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-accent uppercase">{ext || '?'}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-primary truncate">{file.name}</p>
              <p className="text-[11px] text-text-muted">{file.media_type}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const FileAttachmentsView = React.memo(FileAttachmentsViewBase)
FileAttachmentsView.displayName = 'FileAttachmentsView'
