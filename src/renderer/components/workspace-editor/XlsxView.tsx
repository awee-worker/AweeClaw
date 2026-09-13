import React, { useState, useEffect, useRef, useCallback } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================================================
// Excel (.xlsx / .xls) 高保真可编辑视图
//
// 设计说明（相对旧实现的三个修复点）：
//  1. 图片：旧逻辑尝试读取 exceljs 私有 _images 并把图片塞进单个单元格（overflow hidden
//     会被裁剪、锚点字段名也不对），导致图片不显示。这里改用官方 worksheet.getImages()，
//     按 EMU 换算像素，在工作表内容上叠加一层「图片浮层」，与原文件位置一致。
//  2. 编辑：不再提供「查看 / 编辑表格」两套模式，打开即就地编辑 —— 双击单元格输入，
//     Enter/失焦提交并自动保存（防抖 600ms）。自动保存基于内存中的 exceljs 工作簿
//     增量写回单元格值，因此样式、列宽、行高、合并、图片都原样保留在文件里。
//  3. 样式：单元格字体颜色、背景色、边框、对齐等由 exceljs 解析直接还原到网格；
//     不再经由 x-data-spreadsheet 二次导入丢样式。
// ============================================================================

interface XlsxCellData {
  value: string
  style: React.CSSProperties
  border: React.CSSProperties
  isMerged: boolean
  mergeSpan?: { colSpan: number; rowSpan: number }
  /** 原值是否为数字：编辑提交时若输入仍是数字则继续按数字写入 */
  numeric?: boolean
}

interface SheetImageInfo {
  id: number
  src: string
  /** 相对内容区左上角的像素坐标（内容区含 48px 行号列） */
  x: number
  y: number
  width: number
  height: number
}

interface XlsxSheetData {
  name: string
  rows: Array<{
    cells: XlsxCellData[]
    height?: number
  }>
  /** 像素列宽（索引列宽 48px 不计入，从 A 列开始） */
  columnWidths: number[]
  /** 每行像素高（含默认值） */
  rowHeights: number[]
  mergeMap: Map<string, { colSpan: number; rowSpan: number }>
  images: SheetImageInfo[]
}

// ---------------------------------------------------------------------------
// 颜色 / 边框 / 样式辅助（与旧实现一致，仅内部使用）
// ---------------------------------------------------------------------------

/** ARGB 颜色对象转 CSS 颜色字符串 */
function argbToCss(color?: { argb?: string; theme?: number; indexed?: number }): string | undefined {
  if (!color) return undefined
  if (color.argb) {
    const argb = color.argb
    if (argb.length === 8) return `#${argb.slice(2).toLowerCase()}`
    if (argb.length === 6) return `#${argb.toLowerCase()}`
  }
  return undefined
}

/** 边框样式映射 */
function borderStyleToCss(style?: string): string | undefined {
  if (!style) return undefined
  const map: Record<string, string> = {
    thin: '1px solid', medium: '2px solid', thick: '3px solid',
    dotted: '1px dotted', dashed: '1px dashed', double: '3px double',
    hair: '1px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed',
    mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed',
  }
  return map[style]
}

/** 将 exceljs 单元格样式转为 CSS 样式对象 */
function buildCellStyle(cell: any): React.CSSProperties {
  const style: React.CSSProperties = {}
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
  if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern === 'solid') {
    const bgColor = argbToCss(cell.fill.fgColor) || argbToCss(cell.fill.bgColor)
    if (bgColor) style.backgroundColor = bgColor
  }
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
      const deg = align.textRotation <= 90 ? align.textRotation : 90 - align.textRotation
      style.transform = `rotate(${-deg}deg)`
      style.transformOrigin = 'center'
    }
  }
  return style
}

/** 构造边框 CSS 片段 */
function buildBorderString(cell: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!cell.border) return style
  const b = cell.border
  const edge = (bs?: string, color?: any, side?: 'Top' | 'Bottom' | 'Left' | 'Right') => {
    if (!bs) return
    const cssColor = argbToCss(color)
    ;(style as any)[`border${side}`] = `${bs} ${cssColor || 'rgb(var(--border))'}`
  }
  if (b.top && b.top.style) edge(borderStyleToCss(b.top.style), b.top.color, 'Top')
  if (b.bottom && b.bottom.style) edge(borderStyleToCss(b.bottom.style), b.bottom.color, 'Bottom')
  if (b.left && b.left.style) edge(borderStyleToCss(b.left.style), b.left.color, 'Left')
  if (b.right && b.right.style) edge(borderStyleToCss(b.right.style), b.right.color, 'Right')
  return style
}

/** 单元格值 → 展示文本 */
function cellToDisplayText(cell: any): { text: string; numeric: boolean } {
  let numeric = false
  if (cell.value === null || cell.value === undefined) return { text: '', numeric }
  if (cell.value instanceof Date) return { text: cell.value.toLocaleString(), numeric: false }
  if (typeof cell.value === 'object') {
    const v: any = cell.value
    if ('result' in v) {
      const r = v.result
      if (typeof r === 'number') return { text: String(r), numeric: true }
      return { text: String(r ?? ''), numeric: false }
    }
    if ('richText' in v) {
      return { text: (v.richText || []).map((rt: any) => rt.text || '').join(''), numeric: false }
    }
    if ('text' in v) return { text: String(v.text), numeric: false }
    if ('hyperlink' in v && 'text' in v) return { text: String(v.text), numeric: false }
    return { text: String(cell.value), numeric: false }
  }
  if (typeof cell.value === 'number') return { text: String(cell.value), numeric: true }
  return { text: String(cell.value), numeric: false }
}

/** Uint8Array / Buffer → base64 */
function u8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(bin)
}

/** EMU → CSS px（Excel 图片尺寸/偏移均为 EMU，1px = 9525 EMU） */
const EMU2PX = 9525

/** SheetJS 单元格样式 → CSS（.xls 尽力还原） */
function buildSheetJsStyle(s?: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!s) return style
  if (s.font) {
    const font = s.font
    if (font.bold) style.fontWeight = 'bold'
    if (font.italic) style.fontStyle = 'italic'
    if (font.underline) style.textDecoration = 'underline'
    if (font.sz) style.fontSize = `${font.sz}px`
    if (font.name) style.fontFamily = font.name
    const fc = font.color?.rgb
    if (fc && fc.length === 6 && fc.toUpperCase() !== '000000') style.color = `#${fc.toLowerCase()}`
  }
  if (s.fill && s.fill.patternType === 'solid') {
    const bg = s.fill.fgColor?.rgb || s.fill.bgColor?.rgb
    if (bg && bg.length === 6 && bg.toUpperCase() !== '000000') style.backgroundColor = `#${bg.toLowerCase()}`
  }
  if (s.alignment) {
    const a = s.alignment
    if (a.horizontal) {
      const hm: Record<string, React.CSSProperties['textAlign']> = { left: 'left', center: 'center', right: 'right', fill: 'left', justify: 'justify', centerContinuous: 'center', distributed: 'justify' }
      if (hm[a.horizontal]) style.textAlign = hm[a.horizontal]
    }
    if (a.vertical) {
      const vm: Record<string, React.CSSProperties['verticalAlign']> = { top: 'top', center: 'middle', bottom: 'bottom', distributed: 'middle', justify: 'middle' }
      if (vm[a.vertical]) style.verticalAlign = vm[a.vertical]
    }
    if (a.wrapText) style.whiteSpace = 'normal'
  }
  return style
}

/** SheetJS 单元格边框 → CSS */
function buildSheetJsBorder(s?: any): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!s || !s.border) return style
  const put = (side: 'Top' | 'Bottom' | 'Left' | 'Right', part: any) => {
    if (!part || !part.style) return
    const bs = borderStyleToCss(part.style)
    if (!bs) return
    const c = part.color?.rgb
    const color = c && c.length === 6 && c.toUpperCase() !== '000000' ? `#${c.toLowerCase()}` : 'rgb(var(--border))'
    ;(style as any)[`border${side}`] = `${bs} ${color}`
  }
  put('Top', s.border.top)
  put('Bottom', s.border.bottom)
  put('Left', s.border.left)
  put('Right', s.border.right)
  return style
}


// ---------------------------------------------------------------------------
// 解析：exceljs workbook → XlsxSheetData
// ---------------------------------------------------------------------------

function parseWorksheet(worksheet: any, workbook: any): XlsxSheetData {
  const name = worksheet.name

  // 合并单元格
  const mergeMap = new Map<string, { colSpan: number; rowSpan: number }>()
  try {
    const merges = (worksheet as any)._merges || {}
    for (const key in merges) {
      const merge = merges[key]
      if (merge && merge.model) {
        const { top, left, bottom, right } = merge.model
        const rowSpan = bottom - top + 1
        const colSpan = right - left + 1
        mergeMap.set(`${top},${left}`, { colSpan, rowSpan })
      }
    }
  } catch {
    // 合并解析失败不阻断
  }
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

  // 列宽（px 估算：width * 7 + 5）
  const columnWidths: number[] = []
  const columnCount = worksheet.columnCount || 0
  for (let i = 1; i <= columnCount; i++) {
    const col = worksheet.getColumn(i)
    const width = col?.width ? Math.round(col.width * 7 + 5) : 80
    columnWidths.push(Math.min(Math.max(width, 40), 400))
  }

  // 行 + 行高
  const rows: XlsxSheetData['rows'] = []
  const rowHeights: number[] = []
  const rowCount = worksheet.rowCount || 0
  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r)
    const height = row.height ? Math.round(row.height * 1.333) : undefined
    rowHeights.push(height ?? 36)
    const cells: XlsxCellData[] = []
    const cellCount = columnCount || row.cellCount || 0
    for (let c = 1; c <= cellCount; c++) {
      const cell = row.getCell(c)
      const { text, numeric } = (() => {
        try { return cellToDisplayText(cell) } catch { return { text: '', numeric: false } }
      })()
      const mergeKey = `${r},${c}`
      cells.push({
        value: text,
        numeric,
        style: (() => { try { return buildCellStyle(cell) } catch { return {} } })(),
        border: (() => { try { return buildBorderString(cell) } catch { return {} } })(),
        isMerged: mergedAway.has(mergeKey),
        mergeSpan: mergeMap.get(mergeKey),
      })
    }
    rows.push({ cells, height })
  }

  // 图片：官方 getImages() + workbook.media 二进制，按 EMU 换算为浮层像素坐标
  const images: SheetImageInfo[] = []
  try {
    const list: any[] = (worksheet.getImages?.() as any[]) || []
    const mediaList: any[] = (workbook as any)?.media || (workbook as any)?.model?.media || []
    list.forEach((im, idx) => {
      const range = im?.range
      if (!range) return
      const tl: any = range.tl?.model || { nativeCol: 0, nativeRow: 0, nativeColOff: 0, nativeRowOff: 0 }
      const media = mediaList[im.imageId]
      const buf: any = media?.buffer ?? media?.value
      if (!buf) return
      let bytes: Uint8Array
      try {
        bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer)
      } catch { return }
      const ext: any = range.ext
      let widthPx = ext?.cx ? Math.round(ext.cx / EMU2PX) : 0
      let heightPx = ext?.cy ? Math.round(ext.cy / EMU2PX) : 0
      if (widthPx <= 0) widthPx = 120
      if (heightPx <= 0) heightPx = 80

      const colStartPx = columnWidths
        .slice(0, Math.max(0, tl.nativeCol))
        .reduce((s, w) => s + w, 48)
      const rowStartPx = rowHeights
        .slice(0, Math.max(0, tl.nativeRow))
        .reduce((s, h) => s + h, 0)
      images.push({
        id: idx,
        src: `data:image/${String(media?.extension || 'png').toLowerCase().replace(/^\./, '')};base64,${u8ToBase64(bytes)}`,
        x: colStartPx + (tl.nativeColOff || 0) / EMU2PX,
        y: rowStartPx + (tl.nativeRowOff || 0) / EMU2PX,
        width: Math.max(24, widthPx),
        height: Math.max(16, heightPx),
      })
    })
  } catch (e) {
    logger.ui.warn('xlsx image parse failed:', e)
  }

  return { name, rows, columnWidths, rowHeights, mergeMap, images }
}

/**
 * SheetJS 只读解析：.xls 的原生路径；.xlsx 在 exceljs 解析失败时的兼容降级。
 * 单元格/合并/列宽/行高/样式尽力还原；不含图片；不保留原文件结构，无法原样写回 → 只读。
 */
async function parseSheetsWithSheetJS(bytes: Uint8Array): Promise<XlsxSheetData[]> {
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true, cellDates: true })
  return wb.SheetNames.map((n: string) => {
    const ws = wb.Sheets[n]
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const cw: number[] = (ws['!cols'] || []).map((m: any) => {
      let w = 80
      if (m) {
        if (m.wpx) w = Math.round(m.wpx)
        else if (m.wch) w = Math.round(m.wch * 7 + 5)
      }
      return Math.min(Math.max(w, 40), 400)
    })
    const mm = new Map<string, { colSpan: number; rowSpan: number }>()
    const away = new Set<string>()
    ;(ws['!merges'] || []).forEach((m: any) => {
      const top = m.s.r + 1; const left = m.s.c + 1; const bottom = m.e.r + 1; const right = m.e.c + 1
      const rowSpan = bottom - top + 1; const colSpan = right - left + 1
      mm.set(`${top},${left}`, { colSpan, rowSpan })
      for (let i = top; i <= bottom; i++) for (let j = left; j <= right; j++) {
        if (i !== top || j !== left) away.add(`${i},${j}`)
      }
    })
    const rows: XlsxSheetData['rows'] = []
    const rowHeights: number[] = []
    const rm = ws['!rows'] || []
    const rowTotal = range.e.r - range.s.r + 1
    const colTotal = Math.max(1, range.e.c - range.s.c + 1)
    for (let r = 1; r <= rowTotal; r++) {
      const rh = rm[r - 1]
      const height = rh?.hpx ? Math.round(rh.hpx) : rh?.hpt ? Math.round(rh.hpt * 1.333) : undefined
      rowHeights.push(height ?? DEFAULT_ROW_PX)
      const cells: XlsxCellData[] = []
      for (let c = 1; c <= colTotal; c++) {
        const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })
        const cell = ws[addr]
        let value = ''
        let numeric = false
        if (cell) {
          if (cell.w !== undefined && cell.w !== null) value = String(cell.w)
          else if (cell.v !== undefined && cell.v !== null) value = String(cell.v)
          numeric = typeof cell?.v === 'number'
        }
        const key = `${r},${c}`
        cells.push({
          value, numeric,
          style: buildSheetJsStyle(cell?.s),
          border: buildSheetJsBorder(cell?.s),
          isMerged: away.has(key),
          mergeSpan: mm.get(key),
        })
      }
      rows.push({ cells, height })
    }
    return { name: n, rows, columnWidths: cw, rowHeights, mergeMap: mm, images: [] }
  })
}

// ---------------------------------------------------------------------------
// 视图组件：打开即编辑，双击单元格修改，自动保存
// ---------------------------------------------------------------------------

interface XlsxViewProps { path: string }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface EditingState { r: number; c: number; text: string }

const ROW_NUM_COL_W = 48
const DEFAULT_ROW_PX = 36

export function XlsxView({ path }: XlsxViewProps) {
  const [sheets, setSheets] = useState<XlsxSheetData[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isReadonly, setIsReadonly] = useState(true)
  /** exceljs 解析失败、降级为 SheetJS 只读预览时的提示（.xlsx / .xlsm 兼容模式） */
  const [fallbackNote, setFallbackNote] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // 列宽拖动（仅影响显示，不写回文件）
  const [colWidths, setColWidths] = useState<Record<number, number>>({})
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const dragStateRef = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null)
  const colWidthsRef = useRef<Record<number, number>>({})

  // 内存 exceljs 工作簿（仅 .xlsx 需要，用于增量保存以保留样式/图片/合并等）
  const workbookRef = useRef<any>(null)
  const dirtyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveNowRef = useRef<() => void>(() => {})

  const currentSheet = sheets[activeSheet]

  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  const colLabel = (idx: number): string => {
    let s = ''
    let n = idx
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 }
    return s
  }

  // ---- 加载 ----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSheets([])
    setActiveSheet(0)
    setEditing(null)
    setSaveState('idle')
    setSavedAt(null)
    setFallbackNote(null)
    dirtyRef.current = false
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null }

    const load = async () => {
      try {
        const base64 = await api.file.readBinary(path)
        if (!base64 || cancelled) return
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

        const ext = path.split('.').pop()?.toLowerCase() || ''
        let data: XlsxSheetData[] = []
        if (ext === 'xls') {
          // .xls（旧版 BIFF）：SheetJS 解析，样式尽力还原，只读（无法原样写回）
          setIsReadonly(true)
          workbookRef.current = null
          data = await parseSheetsWithSheetJS(bytes)
        } else {
          // .xlsx / .xlsm（OOXML）：优先 exceljs（可编辑、完整样式 + 图片）。
          // exceljs 解析失败时（如部分文件 drawing XML 用默认命名空间 <wsDr> 而非 xdr:wsDr，
          // exceljs 4.x reconcile 阶段会抛 "Cannot read properties of undefined (reading 'anchors')"）
          // 降级为 SheetJS 只读预览，保证用户至少能打开查看数据。
          const ExcelJS: any = await import('exceljs')
          let workbook: any = null
          try {
            workbook = new ExcelJS.Workbook()
            await workbook.xlsx.load(bytes.buffer as ArrayBuffer)
          } catch (e) {
            workbook = null
            logger.ui.warn('exceljs xlsx load failed, fallback to sheetjs read-only:', e)
          }
          if (workbook) {
            workbookRef.current = workbook
            setIsReadonly(false)
            data = workbook.worksheets.map((ws: any) => parseWorksheet(ws, workbook))
          } else {
            workbookRef.current = null
            setIsReadonly(true)
            data = await parseSheetsWithSheetJS(bytes)
            if (!cancelled) setFallbackNote('exceljs 无法解析该文件的绘图格式，已切换为只读预览（样式/图片可能降级显示）')
          }
        }
        if (!cancelled) setSheets(data)
      } catch (e) {
        logger.ui.error('Failed to load xlsx:', e)
        if (!cancelled) setError(`加载表格失败: ${(e as Error)?.message || '未知错误'}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [path])

  // ---- 自动保存 ----
  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const wb = workbookRef.current
    if (!wb || !dirtyRef.current) return
    dirtyRef.current = false
    setSaveState('saving')
    try {
      const out: any = await wb.xlsx.writeBuffer()
      const bytes = out instanceof Uint8Array
        ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
        : new Uint8Array(out as ArrayBuffer)
      const ok = await api.file.writeBinary(path, u8ToBase64(bytes))
      if (ok) { setSaveState('saved'); setSavedAt(new Date()) } else { setSaveState('error') }
    } catch (e) {
      logger.ui.error('Failed to auto-save xlsx:', e)
      setSaveState('error')
    }
  }, [path])
  saveNowRef.current = saveNow

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { saveNowRef.current() }, 600)
  }, [])

  // 卸载/切换文件时若有未保存改动立即保存，避免丢失
  useEffect(() => () => {
    if (dirtyRef.current) saveNowRef.current()
  }, [])

  /** 提交编辑：更新 UI 行数据 + exceljs 单元格值，触发防抖自动保存 */
  const commitEdit = useCallback((ed: EditingState) => {
    const si = activeSheet
    const { r, c } = ed
    const sheet = sheets[si]
    if (!sheet?.rows[r]) return
    const oldText = sheet.rows[r].cells[c]?.value ?? ''
    const text = ed.text
    setEditing(null)
    if (text === oldText) return

    setSheets(prev => prev.map((s, si2) => si2 !== si
      ? s
      : { ...s, rows: s.rows.map((row, ri) => ri !== r
        ? row
        : { ...row, cells: row.cells.map((cell, ci) => ci !== c ? cell : { ...cell, value: text }) }) }))

    const wb = workbookRef.current
    if (!wb) return
    try {
      const ws = wb.worksheets[si]
      const ec = ws.getRow(r + 1).getCell(c + 1)
      const orig = ec.value
      if (text.trim() === '') {
        ec.value = null
      } else if (typeof orig === 'number' && !Number.isNaN(Number(text))) {
        ec.value = Number(text)
      } else {
        ec.value = text
      }
      dirtyRef.current = true
      scheduleSave()
    } catch (e) {
      logger.ui.error('commit cell failed:', e)
    }
  }, [activeSheet, sheets, scheduleSave])

  /** 双击进入编辑 */
  const startEdit = useCallback((r: number, c: number) => {
    if (isReadonly) return
    const cell = sheets[activeSheet]?.rows[r]?.cells[c]
    if (!cell || cell.isMerged) return
    if (editing && (editing.r !== r || editing.c !== c)) commitEdit(editing)
    setEditing({ r, c, text: cell.value })
  }, [sheets, activeSheet, isReadonly, editing, commitEdit])

  const isEditingCell = (r: number, c: number) => editing?.r === r && editing?.c === c

  // ---- 列宽拖动 ----
  const handleResizeStart = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startWidth = colWidthsRef.current[colIdx] ?? currentSheet?.columnWidths[colIdx] ?? 80
    dragStateRef.current = { colIdx, startX: e.clientX, startWidth }
    setResizingCol(colIdx)
  }, [currentSheet])

  useEffect(() => {
    if (resizingCol === null) return
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds) return
      const delta = e.clientX - ds.startX
      if (Math.abs(delta) < 1) return
      setColWidths(prev => {
        const next = { ...prev }
        next[ds.colIdx] = Math.max(30, ds.startWidth + delta)
        return next
      })
    }
    const onUp = () => {
      dragStateRef.current = null
      setResizingCol(null)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [resizingCol])

  // ---- 渲染 ----
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    )
  }

  if (error || !currentSheet) {
    return (
      <div className="h-full flex items-center justify-center bg-background-editor">
        <div className="text-center p-8 text-sm text-text-muted">{error || '无法打开表格'}</div>
      </div>
    )
  }

  const effectiveWidths = currentSheet.columnWidths.map((w, i) => colWidths[i] ?? w)
  const gridTemplate = `${ROW_NUM_COL_W}px ${effectiveWidths.map(w => `${w}px`).join(' ')}`
  const totalColPx = ROW_NUM_COL_W + effectiveWidths.reduce((s, w) => s + w, 0)
  const totalRowPx = currentSheet.rowHeights.reduce((s, h) => s + h, 0)

  const saveHint = saveState === 'saving'
    ? '保存中…'
    : saveState === 'saved' && savedAt
      ? `已自动保存 ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : saveState === 'error'
        ? '自动保存失败，请检查文件是否被占用'
        : isReadonly
          ? (fallbackNote ? '只读预览 · 兼容模式' : '.xls 只读预览')
          : '双击单元格编辑，改动将自动保存'

  return (
    <div className="h-full flex flex-col bg-background-editor">
      {/* 顶栏：文件名 + 保存状态（无「编辑表格」按钮，默认即可编辑） */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/50">
        <FileSpreadsheet className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="text-xs text-text-muted whitespace-nowrap">{currentSheet.name}</span>
        <div className="flex-1" />
        <span className={`text-xs whitespace-nowrap flex-shrink-0 ${saveState === 'error' ? 'text-red-400' : saveState === 'saved' ? 'text-green-500/90' : 'text-text-muted/70'}`}>
          {saveHint}
        </span>
      </div>

      {fallbackNote && (
        <div className="flex-shrink-0 px-3 py-1.5 text-xs text-amber-500 bg-amber-500/10 border-b border-amber-500/20 leading-relaxed">
          {fallbackNote}
        </div>
      )}

      {/* 工作表滚动区（表头随横向内容滚动并 sticky 置顶） */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="relative" style={{ width: totalColPx, minHeight: totalRowPx }}>
          {/* 表头 */}
          <div
            className="grid sticky top-0 z-30 border-b border-border"
            style={{ gridTemplateColumns: gridTemplate, backgroundColor: 'rgb(var(--surface))' }}
          >
            <div className="flex items-center justify-center border-r border-border/50 px-2 py-1.5 text-text-muted text-xs select-none">#</div>
            {effectiveWidths.map((_width, colIdx) => (
              <div key={colIdx} className="relative flex items-center justify-center border-r border-border/50 px-2 py-1.5 text-center text-xs font-semibold text-text-primary select-none">
                <span>{colLabel(colIdx)}</span>
                <div
                  className="absolute right-0 top-0 bottom-0 -mr-1 w-2 cursor-col-resize z-10 flex justify-center transition-colors hover:bg-accent/30 active:bg-accent/50"
                  onMouseDown={(e) => handleResizeStart(colIdx, e)}
                >
                  <div className="w-px h-full bg-border/60" />
                </div>
              </div>
            ))}
          </div>

          {/* 数据行 */}
          {currentSheet.rows.map((row, rowIdx) => {
            const rh = row.height ?? DEFAULT_ROW_PX
            return (
              <div key={rowIdx} className="grid" style={{ height: rh, gridTemplateColumns: gridTemplate, alignContent: 'stretch' }}>
                <div className="flex items-center justify-center border-r border-b border-border/50 px-2 py-1 text-text-muted text-xs select-none bg-surface/30">
                  {rowIdx + 1}
                </div>
                {row.cells.map((cell, colIdx) => {
                  if (cell.isMerged) return null
                  const editActive = isEditingCell(rowIdx, colIdx)
                  const baseStyle: React.CSSProperties = {
                    padding: '6px 12px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    backgroundColor: 'rgb(var(--background-editor))',
                    color: 'rgb(var(--text-secondary))',
                    ...cell.style,
                    ...cell.border,
                  }
                  return (
                    <div
                      key={colIdx}
                      className="border-r border-b border-border/50 overflow-hidden flex items-center"
                      style={{
                        ...baseStyle,
                        gridColumnStart: colIdx + 2,
                        gridColumnEnd: cell.mergeSpan ? `span ${cell.mergeSpan.colSpan}` : undefined,
                      }}
                      onDoubleClick={() => startEdit(rowIdx, colIdx)}
                      title={editActive ? undefined : (cell.value || undefined)}
                    >
                      {editActive ? (
                        <input
                          autoFocus
                          value={editing?.text ?? cell.value}
                          onChange={(e) => setEditing({ r: rowIdx, c: colIdx, text: e.target.value })}
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={() => { if (editing) commitEdit(editing) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); if (editing) commitEdit(editing) }
                            else if (e.key === 'Escape') { setEditing(null) }
                          }}
                          className="w-full h-full outline-none bg-transparent px-2 text-xs"
                          style={{ color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', textAlign: 'inherit' }}
                        />
                      ) : (
                        cell.value
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* 图片浮层：按源文件锚点叠加在工作表上方（不影响单元格编辑） */}
          {currentSheet.images.length > 0 && (
            <div className="pointer-events-none absolute left-0 top-0 z-10" style={{ width: totalColPx, height: totalRowPx }}>
              {currentSheet.images.map(img => (
                <img
                  key={img.id}
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="absolute select-none"
                  style={{ left: img.x, top: img.y, width: img.width, height: img.height, objectFit: 'contain' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部 Sheet Tabs（符合 Excel 习惯） */}
      {sheets.length > 1 && (
        <div className="flex-shrink-0 flex items-stretch gap-0.5 px-3 pt-1 border-t border-border bg-surface/60 overflow-x-auto">
          {sheets.map((sheet, idx) => (
            <button
              key={sheet.name}
              onClick={() => { if (editing) commitEdit(editing); setActiveSheet(idx) }}
              className={`px-4 py-1.5 rounded-t-md text-xs font-medium whitespace-nowrap border border-b-0 transition-colors ${idx === activeSheet ? 'bg-background-editor text-accent border-border' : 'text-text-muted border-transparent hover:text-text-primary hover:bg-surface-hover/60'}`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 兼容旧引用名：工作区预览与文件面板均直接使用此视图
// （历史上有 XlsxPreview / XlsxEditor / XlsxFileView 三个入口，现已统一为一个）
export const XlsxFileView = XlsxView
export const XlsxEditor = XlsxView
export default XlsxView

