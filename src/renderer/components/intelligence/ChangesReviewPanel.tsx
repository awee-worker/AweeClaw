import { useState, useCallback, useMemo, memo } from 'react'
import {
  CheckCheck,
  XCircle,
  FileCode,
  FilePlus,
  FileX,
} from 'lucide-react'
import { OverlayDialog } from '../ui/OverlayDialog'
import { DiffPreview, type DiffView } from '../code-editor/DiffViewerPanel'
import { getFileName, getDirname } from '@shared/toolkit/pathHelper'
import type { PendingChange } from '@intelligence/providerTypes'
import { useStore } from '@store'

interface ChangesReviewPanelProps {
  isOpen: boolean
  onClose: () => void
  pendingChanges: PendingChange[]
  onAcceptFile: (filePath: string) => void
  onRejectFile: (filePath: string) => void
  onAcceptAll: () => void
  onRejectAll: () => void
}

function ChangesReviewPanel({
  isOpen,
  onClose,
  pendingChanges,
  onAcceptFile,
  onRejectFile,
  onAcceptAll,
  onRejectAll,
}: ChangesReviewPanelProps) {
  const language = useStore(s => s.language)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)

  const selectedChange = useMemo(
    () => pendingChanges.find(c => c.filePath === selectedFilePath),
    [pendingChanges, selectedFilePath]
  )

  const diffView = useMemo<DiffView | null>(() => {
    if (!selectedChange) return null
    return {
      original: selectedChange.snapshot?.content || '',
      modified: selectedChange.newContent || '',
      filePath: selectedChange.filePath,
    }
  }, [selectedChange])

  const stats = useMemo(() => {
    let linesAdded = 0
    let linesRemoved = 0
    pendingChanges.forEach(c => {
      linesAdded += c.linesAdded || 0
      linesRemoved += c.linesRemoved || 0
    })
    return { total: pendingChanges.length, linesAdded, linesRemoved }
  }, [pendingChanges])

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFilePath(filePath)
  }, [])

  const handleAcceptAndNext = useCallback(() => {
    if (!selectedFilePath) return
    onAcceptFile(selectedFilePath)
    const remaining = pendingChanges.filter(c => c.filePath !== selectedFilePath)
    if (remaining.length > 0) {
      setSelectedFilePath(remaining[0].filePath)
    } else {
      setSelectedFilePath(null)
    }
  }, [selectedFilePath, onAcceptFile, pendingChanges])

  const handleRejectAndNext = useCallback(() => {
    if (!selectedFilePath) return
    onRejectFile(selectedFilePath)
    const remaining = pendingChanges.filter(c => c.filePath !== selectedFilePath)
    if (remaining.length > 0) {
      setSelectedFilePath(remaining[0].filePath)
    } else {
      setSelectedFilePath(null)
    }
  }, [selectedFilePath, onRejectFile, pendingChanges])

  const autoSelectFirst = useMemo(() => {
    if (selectedFilePath && pendingChanges.some(c => c.filePath === selectedFilePath)) {
      return selectedFilePath
    }
    return pendingChanges.length > 0 ? pendingChanges[0].filePath : null
  }, [pendingChanges, selectedFilePath])

  return (
    <OverlayDialog
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'zh' ? '变更审查' : 'Review Changes'}
      size="5xl"
      noPadding
      showCloseButton
    >
      <div className="flex h-[70vh]">
        {/* 左侧：文件列表 */}
        <div className="w-[280px] border-r border-border/50 bg-surface/30 flex flex-col shrink-0">
          {/* 统计头 */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-text-primary">
                {language === 'zh' ? '文件变更' : 'Files Changed'}
              </span>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <span className="text-green-400">+{stats.linesAdded}</span>
                <span className="text-red-400">-{stats.linesRemoved}</span>
              </div>
            </div>
            <div className="text-[11px] text-text-muted/70 mt-1">
              {stats.total} {language === 'zh' ? '个文件' : 'files'}
            </div>
          </div>

          {/* 文件列表 */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {pendingChanges.map(change => {
              const isActive = autoSelectFirst === change.filePath
              const fileName = getFileName(change.relativePath || change.filePath)
              const dir = getDirname(change.relativePath || change.filePath)
              const TypeIcon = change.changeType === 'create' ? FilePlus
                : change.changeType === 'delete' ? FileX
                : FileCode
              const typeColor = change.changeType === 'create' ? 'text-green-400/60'
                : change.changeType === 'delete' ? 'text-red-400/60'
                : 'text-text-muted/70'

              return (
                <div
                  key={change.filePath}
                  onClick={() => handleSelectFile(change.filePath)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 cursor-pointer transition-colors border-l-2 ${
                    isActive
                      ? 'bg-accent/5 border-l-accent text-text-primary'
                      : 'border-l-transparent hover:bg-surface-hover text-text-muted/90'
                  }`}
                >
                  <TypeIcon className={`w-3.5 h-3.5 ${typeColor} shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{fileName}</div>
                    {dir && (
                      <div className="text-[10px] text-text-muted/50 truncate">{dir}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
                    {change.linesAdded > 0 && <span className="text-green-400/70">+{change.linesAdded}</span>}
                    {change.linesRemoved > 0 && <span className="text-red-400/70">-{change.linesRemoved}</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 底部批量操作 */}
          <div className="px-4 py-3 border-t border-border/50 flex items-center gap-2">
            <button
              onClick={onRejectAll}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all border border-border/50"
            >
              <XCircle className="w-3 h-3" />
              {language === 'zh' ? '全部拒绝' : 'Reject All'}
            </button>
            <button
              onClick={onAcceptAll}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-all border border-green-500/20"
            >
              <CheckCheck className="w-3 h-3" />
              {language === 'zh' ? '全部接受' : 'Accept All'}
            </button>
          </div>
        </div>

        {/* 右侧：Diff 预览 */}
        <div className="flex-1 flex flex-col min-w-0">
          {diffView && selectedChange ? (
            <DiffPreview
              key={diffView.filePath}
              diff={diffView}
              isPending={selectedChange.status === 'pending'}
              language={language}
              onClose={onClose}
              onAccept={handleAcceptAndNext}
              onReject={handleRejectAndNext}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted/50">
              <div className="text-center">
                <FileCode className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-[13px]">
                  {language === 'zh' ? '选择文件查看变更' : 'DropdownSelector a file to review changes'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </OverlayDialog>
  )
}

export default memo(ChangesReviewPanel)
