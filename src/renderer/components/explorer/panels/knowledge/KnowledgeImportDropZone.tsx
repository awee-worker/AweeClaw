import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, X, Check, AlertCircle, Loader2 } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface ImportFileItem {
  name: string
  path: string
  status: 'pending' | 'importing' | 'success' | 'error'
  error?: string
}

interface ImportDropZoneProps {
  language: Language
  onImportFiles: (paths: string[]) => Promise<void>
  onClose: () => void
}

export function ImportDropZone({
  language,
  onImportFiles,
  onClose,
}: ImportDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<ImportFileItem[]>([])
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length === 0) return

      const items: ImportFileItem[] = droppedFiles
        .filter((f) => {
          const ext = f.name.split('.').pop()?.toLowerCase()
          return ['txt', 'md', 'json', 'csv', 'pdf', 'doc', 'docx'].includes(
            ext || '',
          )
        })
        .map((f) => ({
          name: f.name,
          path: (f as unknown as { path: string }).path || f.name,
          status: 'pending' as const,
        }))

      if (items.length === 0) return
      setFiles(items)
    },
    [],
  )

  const handleSelectFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files || [])
      const items: ImportFileItem[] = selected.map((f) => ({
        name: f.name,
        path: (f as unknown as { path: string }).path || f.name,
        status: 'pending' as const,
      }))
      setFiles(items)
    },
    [],
  )

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleImport = useCallback(async () => {
    if (files.length === 0) return
    setImporting(true)

    const paths = files.map((f) => f.path)
    setFiles((prev) =>
      prev.map((f) => ({ ...f, status: 'importing' as const })),
    )

    try {
      await onImportFiles(paths)
      setFiles((prev) =>
        prev.map((f) => ({ ...f, status: 'success' as const })),
      )
    } catch {
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: 'error' as const,
          error: t('app.importfailed', language as Language),
        })),
      )
    }

    setImporting(false)
  }, [files, onImportFiles, t])

  const successCount = files.filter((f) => f.status === 'success').length
  const allDone = files.length > 0 && successCount === files.length

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-text-primary">
          {t('app.importfiles', language as Language)}
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleSelectFiles}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-accent bg-accent/5'
              : 'border-border/30 hover:border-accent/50 hover:bg-surface/10'
          }`}
        >
          <Upload
            className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-accent' : 'text-text-muted'}`}
          />
          <p className="text-[13px] text-text-primary font-medium">
            {isDragging
              ? t('app.dropfileshere', language as Language)
              : t('app.dragfileshere', language as Language)}
          </p>
          <p className="text-[12px] text-text-muted mt-1">
            {t('app.orclicktoselect', language as Language)}
          </p>
          <p className="text-[12px] text-text-muted mt-2">
            {t('app.supportstxtmdjson', language as Language)}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
            accept=".txt,.md,.json,.csv,.pdf,.doc,.docx"
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-text-secondary">
                {t('app.files', language as Language, { length: files.length })}
              </span>
              {successCount > 0 && (
                <span className="text-[12px] text-green-500">
                  {t('app.done2', language as Language, { successCount: successCount })}
                </span>
              )}
            </div>
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 px-3 py-2 bg-surface/20 rounded-lg border border-border/10"
              >
                <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                <span className="flex-1 text-[12px] text-text-primary truncate min-w-0">
                  {file.name}
                </span>
                {file.status === 'importing' && (
                  <Loader2 className="w-4 h-4 text-accent animate-spin flex-shrink-0" />
                )}
                {file.status === 'success' && (
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                )}
                {file.status === 'error' && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-[12px] text-red-500">{file.error}</span>
                  </div>
                )}
                {file.status === 'pending' && !importing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(index)
                    }}
                    className="p-0.5 text-text-muted hover:text-red-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border/20 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary transition-colors rounded-lg hover:bg-surface-hover"
        >
          {allDone ? t('app.done', language as Language) : t('app.cancel', language as Language)}
        </button>
        {!allDone && (
          <button
            onClick={handleImport}
            disabled={files.length === 0 || importing}
            className="px-4 py-2 text-[13px] text-white bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors rounded-lg"
          >
            {importing
              ? t('app.importing', language as Language)
              : t('app.importfiles2', language as Language, { length: files.length })}
          </button>
        )}
      </div>
    </div>
  )
}
