import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import mammoth from 'mammoth/mammoth.browser.min.js'
import JSZip from 'jszip'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Loader2, FileSpreadsheet, Presentation } from 'lucide-react'
import { ActionButton } from '@components/ui'
import { useStore } from '@store'
import {t, type Language} from '@renderer/i18n'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'

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
        logger.ui.error('Failed to load PDF:', e)
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
        logger.ui.error('Failed to render page:', e)
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
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background-editor">
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
        logger.ui.error('Failed to load DOCX:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadDocx()
  }, [path])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background-editor p-6">
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
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || !text) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
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
    <div className="h-full overflow-auto bg-background-editor p-6">
      <style>{DOCX_STYLES}</style>
      <div className="docx-preview max-w-3xl mx-auto">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  )
}

// ===== Excel (.xlsx / .xls) 预览组件 =====
// .xlsx (OOXML) 使用 exceljs 读取单元格样式（字体颜色、背景色、边框、对齐、合并单元格、列宽、行高）
// .xls (BIFF8 旧版二进制) 使用 SheetJS 解析（exceljs 不支持 .xls），尽力提取样式
// Sheet Tab 放置在底部，符合 Excel 习惯

interface XlsxPreviewProps {
  path: string
}

/** ARGB 颜色对象转 CSS 颜色字符串 */
function argbToCss(color?: { argb?: string; theme?: number; indexed?: number }): string | undefined {
  if (!color) return undefined
  // 优先使用 argb（最常见）
  if (color.argb) {
    const argb = color.argb
    // ARGB 格式：FFRRGGBB（前2位 alpha，后6位 RGB）
    if (argb.length === 8) {
      return `#${argb.slice(2).toLowerCase()}`
    }
    // 兼容 RGB 格式
    if (argb.length === 6) {
      return `#${argb.toLowerCase()}`
    }
  }
  // theme 颜色（主题色）无法精确映射，使用透明返回 undefined 让 CSS fallback
  // indexed 颜色（索引色）同理
  return undefined
}

/** 边框样式映射 */
function borderStyleToCss(style?: string): string | undefined {
  if (!style) return undefined
  const map: Record<string, string> = {
    thin: '1px solid',
    medium: '2px solid',
    thick: '3px solid',
    dotted: '1px dotted',
    dashed: '1px dashed',
    double: '3px double',
    hair: '1px solid',
    mediumDashed: '2px dashed',
    mediumDashDot: '2px dashed',
    mediumDashDotDot: '2px dashed',
    slantDashDot: '2px dashed',
  }
  return map[style]
}

/** 将 exceljs 单元格样式转为 CSS 样式对象 */
function buildCellStyle(cell: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  // 字体
  if (cell.font) {
    const font = cell.font
    if (font.bold) style.fontWeight = 'bold'
    if (font.italic) style.fontStyle = 'italic'
    if (font.underline) style.textDecoration = 'underline'
    if (font.strike) style.textDecoration = (style.textDecoration as string || '') + ' line-through'
    if (font.size) style.fontSize = `${font.size}px`
    if (font.name) style.fontFamily = font.name
    const fontColor = argbToCss(font.color)
    if (fontColor) style.color = fontColor
  }
  // 填充（背景色）：仅处理 pattern 类型
  if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern === 'solid') {
    const bgColor = argbToCss(cell.fill.fgColor) || argbToCss(cell.fill.bgColor)
    if (bgColor) style.backgroundColor = bgColor
  }
  // 对齐
  if (cell.alignment) {
    const align = cell.alignment
    if (align.horizontal) {
      const hMap: Record<string, React.CSSProperties['textAlign']> = {
        left: 'left', center: 'center', right: 'right',
        fill: 'left', justify: 'justify', centerContinuous: 'center', distributed: 'justify',
      }
      if (hMap[align.horizontal]) style.textAlign = hMap[align.horizontal]
    }
    if (align.vertical) {
      const vMap: Record<string, React.CSSProperties['verticalAlign']> = {
        top: 'top', middle: 'middle', bottom: 'bottom',
        distributed: 'middle', justify: 'middle',
      }
      if (vMap[align.vertical]) style.verticalAlign = vMap[align.vertical]
    }
    if (align.wrapText) style.whiteSpace = 'normal'
    if (align.textRotation) {
      // Excel 文本旋转：0-90 表示逆时针 0-90 度；91-180 表示顺时针
      const deg = align.textRotation <= 90 ? align.textRotation : 90 - align.textRotation
      style.transform = `rotate(${-deg}deg)`
      style.transformOrigin = 'center'
    }
  }
  return style
}

/** 构造边框 CSS 片段（返回完整的 border 字符串） */
function buildBorderString(cell: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!cell.border) return style
  const b = cell.border
  if (b.top && b.top.style) {
    const bs = borderStyleToCss(b.top.style)
    const color = argbToCss(b.top.color)
    if (bs) style.borderTop = `${bs} ${color || 'rgb(var(--border))'}`
  }
  if (b.bottom && b.bottom.style) {
    const bs = borderStyleToCss(b.bottom.style)
    const color = argbToCss(b.bottom.color)
    if (bs) style.borderBottom = `${bs} ${color || 'rgb(var(--border))'}`
  }
  if (b.left && b.left.style) {
    const bs = borderStyleToCss(b.left.style)
    const color = argbToCss(b.left.color)
    if (bs) style.borderLeft = `${bs} ${color || 'rgb(var(--border))'}`
  }
  if (b.right && b.right.style) {
    const bs = borderStyleToCss(b.right.style)
    const color = argbToCss(b.right.color)
    if (bs) style.borderRight = `${bs} ${color || 'rgb(var(--border))'}`
  }
  return style
}

/** 解析 exceljs worksheet 为可渲染的表格数据 */
interface ParsedSheet {
  name: string
  rows: Array<{
    cells: Array<{
      value: string
      style: React.CSSProperties
      border: React.CSSProperties
      isMerged: boolean
      mergeSpan?: { colSpan: number; rowSpan: number }
    }>
    height?: number
  }>
  columnWidths: number[]
  mergeMap: Map<string, { colSpan: number; rowSpan: number }>
}

function parseWorksheet(worksheet: any, sheetName: string): ParsedSheet {
  // 收集合并单元格信息：key 为 "row,col"，value 为 { colSpan, rowSpan }
  const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>()
  // exceljs 的 _merges 是以 top-left cell 为 key 的对象
  const merges = (worksheet as any)._merges || {}
  for (const key in merges) {
    const merge = merges[key]
    if (merge && merge.model) {
      const top = merge.model.top
      const left = merge.model.left
      const bottom = merge.model.bottom
      const right = merge.model.right
      const rowSpan = bottom - top + 1
      const colSpan = right - left + 1
      mergeMap.set(`${top},${left}`, { colSpan, rowSpan })
    }
  }

  // 被合并覆盖的单元格（非左上角）集合
  const mergedAway = new Set<string>()
  for (const [key, span] of mergeMap.entries()) {
    const [r, c] = key.split(',').map(Number)
    for (let i = r; i <= r + span.rowSpan - 1; i++) {
      for (let j = c; j <= c + span.colSpan - 1; j++) {
        if (i === r && j === c) continue
        mergedAway.add(`${i},${j}`)
      }
    }
  }

  // 列宽（pixel 估算：Excel width 单位约等于字符数）
  const columnWidths: number[] = []
  const columnCount = worksheet.columnCount || 0
  for (let i = 1; i <= columnCount; i++) {
    const col = worksheet.getColumn(i)
    // Excel 列宽 → px 估算：width * 7 + 5
    const width = col.width ? Math.round(col.width * 7 + 5) : 80
    columnWidths.push(Math.min(Math.max(width, 40), 400))
  }

  // 行数据
  const rows: ParsedSheet['rows'] = []
  const rowCount = worksheet.rowCount || 0
  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r)
    const cells: ParsedSheet['rows'][0]['cells'] = []
    const cellCount = columnCount || (row.cellCount || 0)
    for (let c = 1; c <= cellCount; c++) {
      const cell = row.getCell(c)
      // 值转换：支持字符串、数字、日期、布尔、公式结果
      let value = ''
      if (cell.value !== null && cell.value !== undefined) {
        if (cell.value instanceof Date) {
          value = cell.value.toLocaleString()
        } else if (typeof cell.value === 'object') {
          // 公式单元格：{ formula, result }
          if ('result' in cell.value) {
            value = String(cell.value.result ?? '')
          } else if ('richText' in cell.value) {
            // 富文本：拼接所有 run 的 text
            value = (cell.value.richText || []).map((rt: any) => rt.text || '').join('')
          } else if ('text' in cell.value) {
            value = String(cell.value.text)
          } else if ('hyperlink' in cell.value && 'text' in cell.value) {
            value = String(cell.value.text)
          } else {
            value = String(cell.value)
          }
        } else {
          value = String(cell.value)
        }
      }

      const mergeKey = `${r},${c}`
      const isMergedAway = mergedAway.has(mergeKey)
      const mergeSpan = mergeMap.get(mergeKey)

      cells.push({
        value,
        style: buildCellStyle(cell),
        border: buildBorderString(cell),
        isMerged: isMergedAway,
        mergeSpan: mergeSpan,
      })
    }
    // 行高（point → px：* 1.333）
    const height = row.height ? Math.round(row.height * 1.333) : undefined
    rows.push({ cells, height })
  }

  return { name: sheetName, rows, columnWidths, mergeMap }
}

// ===== SheetJS (.xls 旧版 BIFF 格式) 解析支持 =====
// exceljs 仅支持 .xlsx (OOXML)，无法解析 .xls (BIFF8 二进制)。
// 使用 SheetJS (xlsx) 解析 .xls，复用 ParsedSheet 结构与渲染逻辑。
// SheetJS 社区版对 .xls 样式读取有限，尽力提取字体/填充/对齐/边框，缺失则使用默认样式。

/** SheetJS 颜色对象转 CSS 颜色字符串（颜色格式为 { rgb: 'RRGGBB' }，无 alpha） */
function sheetJsColorToCss(color?: { rgb?: string; theme?: number; indexed?: number }): string | undefined {
  if (!color) return undefined
  // SheetJS 颜色通常为 RRGGBB（6 位），排除纯黑默认色以免覆盖主题文字色
  if (color.rgb && color.rgb.length === 6 && color.rgb.toUpperCase() !== '000000') {
    return `#${color.rgb.toLowerCase()}`
  }
  // theme / indexed 颜色无法精确映射，返回 undefined 让 CSS fallback
  return undefined
}

/** SheetJS 单元格样式对象 → CSS 样式（字体、填充、对齐） */
function buildSheetJsCellStyle(s?: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!s) return style
  // 字体
  if (s.font) {
    const font = s.font
    if (font.bold) style.fontWeight = 'bold'
    if (font.italic) style.fontStyle = 'italic'
    if (font.underline) style.textDecoration = 'underline'
    if (font.strike) style.textDecoration = (style.textDecoration as string || '') + ' line-through'
    if (font.sz) style.fontSize = `${font.sz}px`
    if (font.name) style.fontFamily = font.name
    const fontColor = sheetJsColorToCss(font.color)
    if (fontColor) style.color = fontColor
  }
  // 填充（背景色）：仅处理 solid 类型
  if (s.fill && s.fill.patternType === 'solid') {
    const bgColor = sheetJsColorToCss(s.fill.fgColor) || sheetJsColorToCss(s.fill.bgColor)
    if (bgColor) style.backgroundColor = bgColor
  }
  // 对齐
  if (s.alignment) {
    const align = s.alignment
    if (align.horizontal) {
      const hMap: Record<string, React.CSSProperties['textAlign']> = {
        left: 'left', center: 'center', right: 'right',
        fill: 'left', justify: 'justify', centerContinuous: 'center', distributed: 'justify',
      }
      if (hMap[align.horizontal]) style.textAlign = hMap[align.horizontal]
    }
    if (align.vertical) {
      const vMap: Record<string, React.CSSProperties['verticalAlign']> = {
        top: 'top', center: 'middle', bottom: 'bottom',
        distributed: 'middle', justify: 'middle',
      }
      if (vMap[align.vertical]) style.verticalAlign = vMap[align.vertical]
    }
    if (align.wrapText) style.whiteSpace = 'normal'
    if (align.textRotation) {
      // Excel 文本旋转：0-90 表示逆时针 0-90 度；91-180 表示顺时针
      const deg = align.textRotation <= 90 ? align.textRotation : 90 - align.textRotation
      style.transform = `rotate(${-deg}deg)`
      style.transformOrigin = 'center'
    }
  }
  return style
}

/** SheetJS 单元格边框 → CSS border 片段（复用 borderStyleToCss 映射） */
function buildSheetJsBorderString(s?: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!s || !s.border) return style
  const b = s.border
  /** 转换单边边框为完整 CSS border 字符串 */
  const conv = (edge?: { style?: string; color?: { rgb?: string; theme?: number; indexed?: number } }): string | undefined => {
    if (!edge || !edge.style) return undefined
    const bs = borderStyleToCss(edge.style)
    if (!bs) return undefined
    const color = sheetJsColorToCss(edge.color)
    return `${bs} ${color || 'rgb(var(--border))'}`
  }
  const top = conv(b.top); if (top) style.borderTop = top
  const bottom = conv(b.bottom); if (bottom) style.borderBottom = bottom
  const left = conv(b.left); if (left) style.borderLeft = left
  const right = conv(b.right); if (right) style.borderRight = right
  return style
}

/**
 * 将 SheetJS worksheet 转为 ParsedSheet 结构。
 * SheetJS worksheet 是以单元格地址（如 "A1"）为 key 的对象，元数据通过 "!ref"/"!merges"/"!cols"/"!rows" 字段承载。
 */
function parseSheetJSWorksheet(XLSX: any, ws: any, sheetName: string): ParsedSheet {
  // 解析范围，无数据时退化为单格
  const ref = ws['!ref'] || 'A1'
  const range = XLSX.utils.decode_range(ref)
  const rowCount = range.e.r - range.s.r + 1
  const columnCount = range.e.c - range.s.c + 1

  // 合并单元格：收集左上角跨度 + 被覆盖单元格集合
  const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>()
  const mergedAway = new Set<string>()
  const merges = ws['!merges'] || []
  for (const m of merges) {
    // SheetJS 合并范围基于 0 起始索引，转换为 1 起始（与 exceljs 解析路径一致）
    const top = m.s.r + 1
    const left = m.s.c + 1
    const bottom = m.e.r + 1
    const right = m.e.c + 1
    const rowSpan = bottom - top + 1
    const colSpan = right - left + 1
    mergeMap.set(`${top},${left}`, { colSpan, rowSpan })
    for (let i = top; i <= bottom; i++) {
      for (let j = left; j <= right; j++) {
        if (i === top && j === left) continue
        mergedAway.add(`${i},${j}`)
      }
    }
  }

  // 列宽：优先 wpx(像素)，其次 wch(字符宽) 估算为像素
  const colsMeta = ws['!cols'] || []
  const columnWidths: number[] = []
  for (let i = 0; i < columnCount; i++) {
    const meta = colsMeta[i]
    let width = 80
    if (meta) {
      if (meta.wpx) width = Math.round(meta.wpx)
      else if (meta.width) width = Math.round(meta.width * 7 + 5)
      else if (meta.wch) width = Math.round(meta.wch * 7 + 5)
    }
    columnWidths.push(Math.min(Math.max(width, 40), 400))
  }

  // 行高元数据
  const rowsMeta = ws['!rows'] || []

  const rows: ParsedSheet['rows'] = []
  for (let r = 1; r <= rowCount; r++) {
    const cells: ParsedSheet['rows'][0]['cells'] = []
    for (let c = 1; c <= columnCount; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })
      const cell = ws[addr]
      // 值转换：优先用格式化文本 cell.w（符合 Excel 显示），其次原始值 cell.v
      let value = ''
      if (cell) {
        if (cell.w !== undefined && cell.w !== null) {
          value = String(cell.w)
        } else if (cell.v !== undefined && cell.v !== null) {
          value = cell.v instanceof Date ? cell.v.toLocaleString() : String(cell.v)
        }
      }

      const mergeKey = `${r},${c}`
      cells.push({
        value,
        style: buildSheetJsCellStyle(cell?.s),
        border: buildSheetJsBorderString(cell?.s),
        isMerged: mergedAway.has(mergeKey),
        mergeSpan: mergeMap.get(mergeKey),
      })
    }
    // 行高：优先 hpx(像素)，其次 hpt(磅) 转 px（* 1.333）
    const rowMeta = rowsMeta[r - 1]
    let height: number | undefined
    if (rowMeta) {
      if (rowMeta.hpx) height = Math.round(rowMeta.hpx)
      else if (rowMeta.hpt) height = Math.round(rowMeta.hpt * 1.333)
    }
    rows.push({ cells, height })
  }

  return { name: sheetName, rows, columnWidths, mergeMap }
}

export function XlsxPreview({ path }: XlsxPreviewProps) {
  const language = useStore(s => s.language)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
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

        // 按扩展名分流：.xls (BIFF8) 用 SheetJS 解析；.xlsx (OOXML) 用 exceljs 解析（支持完整样式）
        const ext = path.split('.').pop()?.toLowerCase() || ''
        let sheetData: ParsedSheet[]

        if (ext === 'xls') {
          // SheetJS 原生支持 .xls 旧版二进制格式；cellStyles 开启样式读取，cellDates 把日期转为 Date 对象
          const XLSX = await import('xlsx')
          const workbook = XLSX.read(bytes, { type: 'array', cellStyles: true, cellDates: true })
          sheetData = workbook.SheetNames.map((name: string) =>
            parseSheetJSWorksheet(XLSX, workbook.Sheets[name], name)
          )
        } else {
          // exceljs 读取 .xlsx，支持单元格样式（字体颜色、背景色、边框、对齐、合并、列宽、行高）
          const ExcelJS = await import('exceljs')
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(bytes.buffer as ArrayBuffer)
          sheetData = workbook.worksheets.map((ws: any) => parseWorksheet(ws, ws.name))
        }

        setSheets(sheetData)
        setActiveSheet(0)
      } catch (e) {
        logger.ui.error('Failed to load XLSX:', e)
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    loadXlsx()
  }, [path])

  const currentSheet = sheets[activeSheet]

  // 列字母（A, B, ..., Z, AA, AB, ...）用于表头
  const colLabel = (idx: number): string => {
    let s = ''
    let n = idx
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    }
    return s
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <div className="text-center p-8">
          <p className="text-text-muted">{t('filePreview.cannotOpenFile', language)}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <div className="flex-1 overflow-auto p-4">
        {currentSheet && currentSheet.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="border-collapse min-w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th
                    className="border border-border/50 px-2 py-1.5 text-text-muted text-xs text-center w-12 bg-surface/80 font-normal select-none"
                    style={{ minWidth: 48 }}
                  >
                    #
                  </th>
                  {currentSheet.columnWidths.map((width, colIdx) => (
                    <th
                      key={colIdx}
                      className="border border-border/50 px-2 py-1.5 text-center text-xs font-semibold text-text-primary bg-surface/80 select-none"
                      style={{ width, minWidth: width, maxWidth: width }}
                    >
                      {colLabel(colIdx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentSheet.rows.map((row, rowIdx) => (
                  <tr key={rowIdx} style={row.height ? { height: row.height } : undefined}>
                    <td
                      className="border border-border/50 px-2 py-1 text-text-muted text-xs text-center bg-surface/30 select-none"
                    >
                      {rowIdx + 1}
                    </td>
                    {row.cells.map((cell, colIdx) => {
                      // 被合并覆盖的单元格不渲染（由左上角单元格的 colSpan/rowSpan 覆盖）
                      if (cell.isMerged) {
                        return <td key={colIdx} className="border border-border/50" style={{ padding: 0 }} />
                      }
                      const baseStyle: React.CSSProperties = {
                        padding: '6px 12px',
                        maxWidth: currentSheet.columnWidths[colIdx] || 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        backgroundColor: 'rgb(var(--background-editor))',
                        color: 'rgb(var(--text-secondary))',
                        ...cell.style,
                        ...cell.border,
                      }
                      // 合并单元格：设置 colSpan / rowSpan
                      const spanProps = cell.mergeSpan
                        ? { colSpan: cell.mergeSpan.colSpan, rowSpan: cell.mergeSpan.rowSpan }
                        : {}
                      return (
                        <td
                          key={colIdx}
                          className="border border-border/50"
                          style={baseStyle}
                          title={cell.value || undefined}
                          {...spanProps}
                        >
                          {cell.value}
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
      {/* Sheet Tab：底部，符合 Excel 习惯 */}
      {sheets.length > 1 && (
        <div className="flex-shrink-0 flex items-center gap-1 px-3 py-2 border-t border-border bg-surface/50 overflow-x-auto">
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
      <div className="h-full flex flex-col bg-background-editor">
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
    <div className="h-full flex flex-col bg-background-editor">
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
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
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
    <div className="h-full flex flex-col bg-background-editor">
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
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || !text) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
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
    <div className="h-full overflow-auto bg-background-editor p-6">
      <style>{DOCX_STYLES}</style>
      <div className="docx-preview max-w-3xl mx-auto">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  )
}
