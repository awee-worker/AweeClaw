import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth/mammoth.browser.min.js'
import * as XLSX from 'xlsx'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Loader2, FileSpreadsheet } from 'lucide-react'
import { Button } from '../ui'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { api } from '@/renderer/services/electronAPI'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface PdfPreviewProps {
  path: string
}

export function PdfPreview({ path }: PdfPreviewProps) {
  const language = useStore(s => s.language)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.5)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)

  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true)
        setError(false)
        const base64 = await api.file.readBinary(path)
        if (!base64) {
          setError(true)
          return
        }
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const loadingTask = pdfjsLib.getDocument({ data: bytes })
        const doc = await loadingTask.promise
        setPdfDoc(doc)
        setTotalPages(doc.numPages)
        setCurrentPage(1)
      } catch (e) {
        console.error('Failed to load PDF:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadPdf()
  }, [path])

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return
    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
      const page = await pdfDoc.getPage(currentPage)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.height = viewport.height
      canvas.width = viewport.width
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
      })
      renderTaskRef.current = renderTask
      await renderTask.promise
      renderTaskRef.current = null
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') {
        console.error('Failed to render page:', e)
      }
    }
  }, [pdfDoc, currentPage, scale])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
    }
  }, [])

  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const zoomIn = () => setScale(s => Math.min(4, s + 0.25))
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.25))
  const fitWidth = () => setScale(1.5)

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 border-b border-border bg-surface/50">
        <Button variant="ghost" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="h-7 px-2">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs text-text-muted min-w-[80px] text-center">
          {currentPage} / {totalPages}
        </span>
        <Button variant="ghost" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="h-7 px-2">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="sm" onClick={zoomOut} className="h-7 px-2">
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs text-text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={zoomIn} className="h-7 px-2">
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={fitWidth} className="h-7 px-2">
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-surface/20">
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>
    </div>
  )
}

// ===== Word (.docx) 预览组件 =====

const DOCX_STYLES = `
  .docx-preview h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  .docx-preview h2 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.6rem; color: var(--text-primary); }
  .docx-preview h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; color: var(--text-primary); }
  .docx-preview h4 { font-size: 1.1rem; font-weight: 600; margin: 0.8rem 0 0.4rem; color: var(--text-primary); }
  .docx-preview p { margin: 0.5rem 0; line-height: 1.7; color: var(--text-secondary); }
  .docx-preview ul, .docx-preview ol { margin: 0.5rem 0; padding-left: 1.5rem; color: var(--text-secondary); }
  .docx-preview ul { list-style-type: disc; }
  .docx-preview ol { list-style-type: decimal; }
  .docx-preview li { margin: 0.25rem 0; line-height: 1.6; }
  .docx-preview table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  .docx-preview td, .docx-preview th { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
  .docx-preview th { background: var(--surface); font-weight: 600; color: var(--text-primary); }
  .docx-preview td { color: var(--text-secondary); }
  .docx-preview tr:hover td { background: var(--surface-hover); }
  .docx-preview img { max-width: 100%; height: auto; border-radius: 0.375rem; margin: 0.5rem 0; }
  .docx-preview a { color: var(--accent); text-decoration: underline; }
  .docx-preview blockquote { border-left: 4px solid var(--accent); padding: 0.5rem 1rem; margin: 0.75rem 0; background: var(--surface); color: var(--text-muted); border-radius: 0 0.375rem 0.375rem 0; }
  .docx-preview strong, .docx-preview b { font-weight: 600; color: var(--text-primary); }
  .docx-preview em, .docx-preview i { font-style: italic; }
  .docx-preview hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
`

interface DocxPreviewProps {
  path: string
}

export function DocxPreview({ path }: DocxPreviewProps) {
  const language = useStore(s => s.language)
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const loadDocx = async () => {
      try {
        setLoading(true)
        setError(false)
        const base64 = await api.file.readBinary(path)
        if (!base64) {
          setError(true)
          return
        }
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer })
        setHtml(result.value)
      } catch (e) {
        console.error('Failed to load DOCX:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadDocx()
  }, [path])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <style>{DOCX_STYLES}</style>
      <div
        className="docx-preview max-w-3xl mx-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

// ===== .doc 文件不支持提示 =====

interface DocPreviewProps {
  path: string
}

export function DocPreview({ path }: DocPreviewProps) {
  const language = useStore(s => s.language)
  const ext = path.split('.').pop()?.toLowerCase() || ''

  const handleOpenExternal = useCallback(() => {
    ;(window.electronAPI as any).openPath?.(path) ||
      api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
  }, [path])

  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="text-center p-8 max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
          <FileSpreadsheet className="w-8 h-8 text-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-text-primary mb-2">
          {language === 'zh' ? '暂不支持 .doc 格式预览' : '.doc format preview not supported'}
        </h3>
        <p className="text-sm text-text-muted mb-6">
          {language === 'zh'
            ? '旧版 .doc 格式暂不支持在线预览，建议将文件另存为 .docx 格式后重试，或使用系统默认程序打开。'
            : 'The legacy .doc format is not supported for preview. Please save the file as .docx format and try again, or open with the system default application.'}
        </p>
        <Button variant="secondary" onClick={handleOpenExternal} className="gap-2">
          {language === 'zh' ? '用默认程序打开' : 'Open with Default App'}
        </Button>
      </div>
    </div>
  )
}

// ===== Excel (.xlsx) 预览组件 =====

interface XlsxPreviewProps {
  path: string
}

export function XlsxPreview({ path }: XlsxPreviewProps) {
  const language = useStore(s => s.language)
  const [sheets, setSheets] = useState<{ name: string; data: string[][] }[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const loadXlsx = async () => {
      try {
        setLoading(true)
        setError(false)
        const base64 = await api.file.readBinary(path)
        if (!base64) {
          setError(true)
          return
        }
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const workbook = XLSX.read(bytes, { type: 'array' })
        const sheetData = workbook.SheetNames.map(name => {
          const worksheet = workbook.Sheets[name]
          const json: string[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
          return { name, data: json }
        })
        setSheets(sheetData)
        setActiveSheet(0)
      } catch (e) {
        console.error('Failed to load XLSX:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadXlsx()
  }, [path])

  const currentSheet = sheets[activeSheet]

  const maxCols = useMemo(() => {
    if (!currentSheet) return 0
    return Math.max(...currentSheet.data.map(row => row.length), 0)
  }, [currentSheet])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {sheets.length > 1 && (
        <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border bg-surface/50 overflow-x-auto">
          <FileSpreadsheet className="w-4 h-4 text-accent mr-1 flex-shrink-0" />
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(idx)}
              className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                idx === activeSheet
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-4">
        {currentSheet && currentSheet.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="border-collapse min-w-full text-sm">
              <tbody>
                {currentSheet.data.map((row, rowIdx) => (
                  <tr key={rowIdx} className={rowIdx === 0 ? 'bg-surface/50' : ''}>
                    <td className="border border-border/50 px-2 py-1 text-text-muted text-xs text-center w-10 bg-surface/30 select-none">
                      {rowIdx + 1}
                    </td>
                    {Array.from({ length: maxCols }).map((_, colIdx) => {
                      const cell = row[colIdx]
                      return (
                        <td
                          key={colIdx}
                          className={`border border-border/50 px-3 py-1.5 max-w-[300px] truncate ${
                            rowIdx === 0
                              ? 'font-semibold text-text-primary bg-surface/30'
                              : 'text-text-secondary'
                          }`}
                          title={cell !== undefined && cell !== '' ? String(cell) : undefined}
                        >
                          {cell !== undefined && cell !== '' ? String(cell) : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {language === 'zh' ? '空工作表' : 'Empty sheet'}
          </div>
        )}
      </div>
    </div>
  )
}
