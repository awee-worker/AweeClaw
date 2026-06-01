import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth/mammoth.browser.min.js'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Loader2, FileSpreadsheet, Presentation } from 'lucide-react'
import { ActionButton } from '../ui'
import { useStore } from '@store'
import {t, type Language} from '@renderer/i18n'
import { api } from '../../adapters/electronBridge'

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
        <ActionButton variant="ghost" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="h-7 px-2">
          <ChevronLeft className="w-4 h-4" />
        </ActionButton>
        <span className="text-xs text-text-muted min-w-[80px] text-center">
          {currentPage} / {totalPages}
        </span>
        <ActionButton variant="ghost" size="sm" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="h-7 px-2">
          <ChevronRight className="w-4 h-4" />
        </ActionButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ActionButton variant="ghost" size="sm" onClick={zoomOut} className="h-7 px-2">
          <ZoomOut className="w-4 h-4" />
        </ActionButton>
        <span className="text-xs text-text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
        <ActionButton variant="ghost" size="sm" onClick={zoomIn} className="h-7 px-2">
          <ZoomIn className="w-4 h-4" />
        </ActionButton>
        <ActionButton variant="ghost" size="sm" onClick={fitWidth} className="h-7 px-2">
          <Maximize2 className="w-3.5 h-3.5" />
        </ActionButton>
      </div>
      <div className="flex-1 overflow-auto flex justify-center p-4 bg-surface/20">
        <canvas ref={canvasRef} className="shadow-lg" />
      </div>
    </div>
  )
}

// ===== Word (.docx) 预览组件 =====

const DOCX_STYLES = `
  .docx-preview h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; color: rgb(var(--text-primary)); border-bottom: 1px solid rgb(var(--border)); padding-bottom: 0.5rem; }
  .docx-preview h2 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.6rem; color: rgb(var(--text-primary)); }
  .docx-preview h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; color: rgb(var(--text-primary)); }
  .docx-preview h4 { font-size: 1.1rem; font-weight: 600; margin: 0.8rem 0 0.4rem; color: rgb(var(--text-primary)); }
  .docx-preview p { margin: 0.5rem 0; line-height: 1.7; color: rgb(var(--text-secondary)); }
  .docx-preview ul, .docx-preview ol { margin: 0.5rem 0; padding-left: 1.5rem; color: rgb(var(--text-secondary)); }
  .docx-preview ul { list-style-type: disc; }
  .docx-preview ol { list-style-type: decimal; }
  .docx-preview li { margin: 0.25rem 0; line-height: 1.6; }
  .docx-preview table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  .docx-preview td, .docx-preview th { border: 1px solid rgb(var(--border)); padding: 0.5rem 0.75rem; text-align: left; }
  .docx-preview th { background: rgb(var(--surface)); font-weight: 600; color: rgb(var(--text-primary)); }
  .docx-preview td { color: rgb(var(--text-secondary)); }
  .docx-preview tr:hover td { background: rgb(var(--surface-hover)); }
  .docx-preview img { max-width: 100%; height: auto; border-radius: 0.375rem; margin: 0.5rem 0; }
  .docx-preview a { color: rgb(var(--accent)); text-decoration: underline; }
  .docx-preview blockquote { border-left: 4px solid rgb(var(--accent)); padding: 0.5rem 1rem; margin: 0.75rem 0; background: rgb(var(--surface)); color: rgb(var(--text-muted)); border-radius: 0 0.375rem 0.375rem 0; }
  .docx-preview strong, .docx-preview b { font-weight: 600; color: rgb(var(--text-primary)); }
  .docx-preview em, .docx-preview i { font-style: italic; }
  .docx-preview hr { border: none; border-top: 1px solid rgb(var(--border)); margin: 1.5rem 0; }
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
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    api.file.extractDocText(path).then(result => {
      if (cancelled) return
      if (result) {
        setText(result)
      } else {
        setError(true)
      }
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError(true)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [path])

  const handleOpenExternal = useCallback(() => {
    ;(window.electronAPI as any).openPath?.(path) ||
      api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
  }, [path])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || !text) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
            <FileSpreadsheet className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {t('editor.cannotpreviewthisdocfile', language as Language)}
          </h3>
          <p className="text-sm text-text-muted mb-6">
            {t('editor.unabletoextracttextfrom', language as Language)}
          </p>
          <ActionButton variant="secondary" onClick={handleOpenExternal} className="gap-2">
            {t('editor.openwithdefaultapp', language as Language)}
          </ActionButton>
        </div>
      </div>
    )
  }

  const paragraphs = text.split(/\n/).filter(p => p.trim())

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <style>{DOCX_STYLES}</style>
      <div className="docx-preview max-w-3xl mx-auto">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
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
            {t('editor.emptysheet', language as Language)}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== PowerPoint (.pptx) 预览组件 =====

interface SlideData {
  slideNumber: number
  texts: string[]
}

function extractTextsFromSlideXml(xmlString: string): string[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')
  const texts: string[] = []

  const allText = doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't')
  for (let i = 0; i < allText.length; i++) {
    const text = allText[i].textContent?.trim()
    if (text) {
      texts.push(text)
    }
  }

  return texts
}

interface PptxPreviewProps {
  path: string
}

interface CsvPreviewProps {
  path: string
  content: string
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        cells.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  cells.push(current)
  return cells
}

function parseCsvContent(content: string, delimiter: string): string[][] {
  const lines = content.split(/\r?\n/)
  const rows: string[][] = []

  for (const line of lines) {
    if (line.trim() === '' && rows.length > 0) continue
    rows.push(parseCsvLine(line, delimiter))
  }

  return rows
}

function detectDelimiter(content: string): string {
  const firstLines = content.split(/\r?\n/).slice(0, 5).join('\n')
  const tabCount = (firstLines.match(/\t/g) || []).length
  const commaCount = (firstLines.match(/,/g) || []).length
  const semicolonCount = (firstLines.match(/;/g) || []).length

  if (tabCount > commaCount && tabCount > semicolonCount) return '\t'
  if (semicolonCount > commaCount) return ';'
  return ','
}

export function CsvPreview({ path, content }: CsvPreviewProps) {
  const language = useStore(s => s.language)
  const [viewMode, setViewMode] = useState<'table' | 'text'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  const [hasHeader, setHasHeader] = useState(true)

  const ext = path.split('.').pop()?.toLowerCase() || 'csv'
  const delimiter = ext === 'tsv' ? '\t' : detectDelimiter(content)

  const { headers, rows, filteredRows } = useMemo(() => {
    const allRows = parseCsvContent(content, delimiter)
    if (allRows.length === 0) return { headers: [], rows: [], filteredRows: [] }

    let hdrs: string[] = []
    let dataRows: string[][] = []

    if (hasHeader && allRows.length > 1) {
      hdrs = allRows[0]
      dataRows = allRows.slice(1)
    } else {
      const maxCols = Math.max(...allRows.map(r => r.length), 0)
      hdrs = Array.from({ length: maxCols }, (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''))
      dataRows = allRows
    }

    const maxCols = Math.max(...allRows.map(r => r.length), hdrs.length, 0)
    while (hdrs.length < maxCols) {
      hdrs.push(String.fromCharCode(65 + (hdrs.length % 26)) + (hdrs.length >= 26 ? Math.floor(hdrs.length / 26) : ''))
    }

    const filtered = searchQuery.trim()
      ? dataRows.filter(row => row.some(cell => cell.toLowerCase().includes(searchQuery.toLowerCase())))
      : dataRows

    return { headers: hdrs, rows: dataRows, filteredRows: filtered }
  }, [content, delimiter, hasHeader, searchQuery])

  const maxCols = Math.max(headers.length, ...filteredRows.map(r => r.length), 0)
  const totalRows = rows.length
  const totalCols = maxCols

  if (viewMode === 'text') {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/50">
          <FileSpreadsheet className="w-4 h-4 text-accent mr-1 flex-shrink-0" />
          <span className="text-xs text-text-muted">
            {ext.toUpperCase()} · {totalRows} × {totalCols}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setViewMode('table')}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
          >
            {t('editor.tableview', language as Language)}
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm text-text-secondary font-mono whitespace-pre">{content}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/50">
        <FileSpreadsheet className="w-4 h-4 text-accent mr-1 flex-shrink-0" />
        <span className="text-xs text-text-muted">
          {ext.toUpperCase()} · {totalRows} × {totalCols}
        </span>
        <div className="h-4 w-px bg-border mx-1" />
        <button
          onClick={() => setHasHeader(!hasHeader)}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${hasHeader ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
        >
          {t('editor.headerrow', language as Language)}
        </button>
        <div className="flex-1" />
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('editor.search', language as Language)}
            className="w-40 h-6 px-2 pr-6 text-xs rounded-md bg-surface/80 border border-border/50 text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => setViewMode('text')}
          className="px-2.5 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          {t('editor.textview', language as Language)}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {filteredRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="border-collapse min-w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="border border-border/50 px-2 py-1.5 text-text-muted text-xs text-center w-12 bg-surface/80 font-normal select-none">#</th>
                  {headers.map((header, colIdx) => (
                    <th
                      key={colIdx}
                      className="border border-border/50 px-3 py-1.5 text-left font-semibold text-text-primary bg-surface/80 whitespace-nowrap"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="border border-border/50 px-2 py-1 text-text-muted text-xs text-center bg-surface/20 select-none">
                      {rowIdx + 1}
                    </td>
                    {Array.from({ length: maxCols }).map((_, colIdx) => {
                      const cell = row[colIdx]
                      const cellStr = cell !== undefined && cell !== '' ? String(cell) : ''
                      const isMatch = searchQuery.trim() && cellStr.toLowerCase().includes(searchQuery.toLowerCase())
                      return (
                        <td
                          key={colIdx}
                          className={`border border-border/50 px-3 py-1.5 max-w-[300px] truncate text-text-secondary ${isMatch ? 'bg-accent/10' : ''}`}
                          title={cellStr || undefined}
                        >
                          {cellStr}
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
            {searchQuery
              ? (t('editor.nomatchingresults', language as Language))
              : (t('editor.emptyfile', language as Language))
            }
          </div>
        )}
      </div>
      {searchQuery && (
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-border bg-surface/30 text-xs text-text-muted">
          {t('editor.rows', language as Language, { length: filteredRows.length, totalRows: totalRows })
          }
        </div>
      )}
    </div>
  )
}

export function PptxPreview({ path }: PptxPreviewProps) {
  const language = useStore(s => s.language)
  const [slides, setSlides] = useState<SlideData[]>([])
  const [activeSlide, setActiveSlide] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    const loadPptx = async () => {
      try {
        const base64 = await api.file.readBinary(path)
        if (!base64 || cancelled) {
          if (!cancelled) setError(true)
          return
        }

        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const zip = await JSZip.loadAsync(bytes)

        const slideFiles: { name: string; num: number }[] = []
        zip.forEach((relativePath) => {
          const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/)
          if (match) {
            slideFiles.push({ name: relativePath, num: parseInt(match[1]) })
          }
        })

        slideFiles.sort((a, b) => a.num - b.num)

        const slideDataList: SlideData[] = []
        for (const sf of slideFiles) {
          const file = zip.file(sf.name)
          if (!file) continue
          const xmlContent = await file.async('string')
          const texts = extractTextsFromSlideXml(xmlContent)
          slideDataList.push({ slideNumber: sf.num, texts })
        }

        if (!cancelled) {
          setSlides(slideDataList)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    loadPptx()
    return () => { cancelled = true }
  }, [path])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8">
          <p className="text-text-muted">
            {t('editor.cannotpreviewthispptfile', language as Language)}
          </p>
        </div>
      </div>
    )
  }

  const currentSlide = slides[activeSlide]

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 shrink-0">
        <Presentation className="w-4 h-4 text-accent" />
        <span className="text-sm text-text-secondary">
          {t('editor.slide', language as Language, { p0: activeSlide + 1, length: slides.length })}
        </span>
        <div className="flex-1" />
        <ActionButton variant="ghost" size="sm" onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))} disabled={activeSlide === 0}>
          <ChevronLeft className="w-4 h-4" />
        </ActionButton>
        <ActionButton variant="ghost" size="sm" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))} disabled={activeSlide === slides.length - 1}>
          <ChevronRight className="w-4 h-4" />
        </ActionButton>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-border/50 bg-surface/30 p-8 min-h-[300px]">
            <div className="text-xs text-text-muted mb-4">
              {t('editor.page', language as Language, { slideNumber: currentSlide.slideNumber })}
            </div>
            {currentSlide.texts.length > 0 ? (
              <div className="space-y-3">
                {currentSlide.texts.map((text, i) => (
                  <p key={i} className={i === 0 ? 'text-xl font-semibold text-text-primary' : 'text-text-secondary'}>
                    {text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-text-muted text-sm">
                {t('editor.notextcontentonthis', language as Language)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== PowerPoint (.ppt) 预览组件 =====

interface PptPreviewProps {
  path: string
}

export function PptPreview({ path }: PptPreviewProps) {
  const language = useStore(s => s.language)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    api.file.extractPptText(path).then(result => {
      if (cancelled) return
      if (result) {
        setText(result)
      } else {
        setError(true)
      }
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setError(true)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [path])

  const handleOpenExternal = useCallback(() => {
    ;(window.electronAPI as any).openPath?.(path) ||
      api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
  }, [path])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || !text) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center p-8 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
            <Presentation className="w-8 h-8 text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {t('editor.cannotpreviewthispptfile2', language as Language)}
          </h3>
          <p className="text-sm text-text-muted mb-6">
            {t('editor.thelegacypptformatonly', language as Language)}
          </p>
          <ActionButton variant="secondary" onClick={handleOpenExternal} className="gap-2">
            {t('editor.openwithdefaultapp2', language as Language)}
          </ActionButton>
        </div>
      </div>
    )
  }

  const paragraphs = text.split(/\n/).filter(p => p.trim())

  return (
    <div className="h-full overflow-auto bg-background p-6">
      <style>{DOCX_STYLES}</style>
      <div className="docx-preview max-w-3xl mx-auto">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  )
}
