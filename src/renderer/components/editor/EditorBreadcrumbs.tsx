import { memo } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { getPathSeparator } from '@shared/utils/pathUtils'
import { getLargeFileWarning } from '@renderer/services/largeFileService'
import type { LargeFileInfo } from '@renderer/services/largeFileService'

interface EditorBreadcrumbsProps {
  filePath: string
  largeFileInfo: LargeFileInfo | null
  language: 'en' | 'zh'
}

function getBreadcrumbs(path: string) {
  const sep = getPathSeparator(path)
  const parts = path.split(sep === '\\' ? /\\/ : /\//)
  return parts.slice(-4)
}

export const EditorBreadcrumbs = memo(function EditorBreadcrumbs({
  filePath,
  largeFileInfo,
  language,
}: EditorBreadcrumbsProps) {
  const breadcrumbs = getBreadcrumbs(filePath)

  return (
    <div className="h-6 flex items-center px-3 bg-background/50 border-b border-border/20 text-[11px] text-text-muted select-none">
      {breadcrumbs.map((part, index, arr) => (
        <div key={`${part}-${index}`} className="flex items-center flex-shrink-0">
          {index > 0 && <ChevronRight className="w-3 h-3 opacity-25 mx-0.5" />}
          <span className={`px-1 ${index === arr.length - 1 ? 'text-text-primary' : ''}`}>
            {part}
          </span>
        </div>
      ))}

      {largeFileInfo?.isLarge && (
        <div className="ml-auto flex items-center gap-1 text-status-warning">
          <AlertTriangle className="w-3 h-3" />
          <span>{getLargeFileWarning(largeFileInfo, language)}</span>
        </div>
      )}
    </div>
  )
})
