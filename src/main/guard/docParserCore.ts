/**
 * 文档解析核心 — 纯解析实现（无安全校验、无日志副作用）
 *
 * 职责：只做「文件路径 → 文本/Buffer」的解析计算，供两处复用：
 * 1. docParser.worker（utilityProcess 子进程，生产路径）
 * 2. 主进程内联回退（子进程不可用时降级，行为与子进程一致）
 *
 * 设计约束：
 * - 不 import 任何 Electron / IPC / 安全策略代码，保证可在子进程 bundle 中独立运行
 * - 第三方解析库全部动态 import，主进程引用本模块时不增加启动内存
 */

/** 解析任务类型 */
export type DocParserKind = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'ppt' | 'saveXlsx' | 'pdfPages'

/** PDF 页面渲染结果（供本地 OCR 兜底使用） */
export interface PdfPageImage {
  /** 页码，从 1 开始 */
  pageNumber: number
  /** PNG 图片的 base64（不含 data URL 前缀） */
  base64: string
  width: number
  height: number
}

/** 单次解析请求 */
export interface DocParserRequest {
  id: number
  kind: DocParserKind
  filePath: string
  /** saveXlsx 专用：渲染层传来的工作表数据（含可选 _rawBase64 原始文件） */
  sheetData?: any
  /** pdfPages 专用：页面渲染参数 */
  renderOptions?: RenderPdfPagesOptions
}

/** 单次解析响应 */
export type DocParserResponse =
  | { id: number; ok: true; text?: string; bufferBase64?: string; pageImages?: PdfPageImage[] }
  | { id: number; ok: false; error: string }

/**
 * 提取 PDF 文本
 *
 * pdf-parse v2 起不再提供 default(buffer) 形式的函数入口，改为 PDFParse 类；
 * 这里同时兼容两个大版本，避免依赖升级后解析直接失效。
 */
export async function parsePdf(filePath: string): Promise<string> {
  const mod: any = await import('pdf-parse')
  const fs = await import('fs')
  const buffer = await fs.promises.readFile(filePath)

  // v1：default 即 (buffer) => Promise<{ text }>
  if (typeof mod.default === 'function') {
    const data = await mod.default(buffer)
    return data?.text ?? ''
  }

  // v2+：new PDFParse({ data }).getText() → { text, pages, total }
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse
  if (typeof PDFParse !== 'function') {
    throw new Error('pdf-parse 无可用解析入口（既非 v1 函数，也无 PDFParse 类）')
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    // pageJoiner 默认会插入 "-- N of M --" 页标记，会污染给模型的内容，改为空行分隔
    const result = await parser.getText({ pageJoiner: '\n\n' })
    return result?.text ?? ''
  } finally {
    // 释放 pdfjs worker / 文档句柄，避免子进程长驻时累积内存
    await Promise.resolve(parser.destroy?.()).catch(() => undefined)
  }
}

/** PDF 页面渲染参数 */
export interface RenderPdfPagesOptions {
  /** 最多渲染多少页（从第 1 页起），默认 20 */
  maxPages?: number
  /** 渲染缩放倍数，默认 2（文字足够清晰且体积可控） */
  scale?: number
}

/**
 * 将 PDF 页面渲染为 PNG 图片，供本地 OCR 使用
 *
 * 仅在文本提取为空（扫描版 / 图片型 PDF）时调用，正常文本型 PDF 不需要走这条路。
 * 渲染在主进程或解析子进程中完成，OCR 本身由调用方在主进程执行。
 */
export async function renderPdfPages(
  filePath: string,
  options: RenderPdfPagesOptions = {},
): Promise<PdfPageImage[]> {
  const mod: any = await import('pdf-parse')
  const PDFParse = mod?.PDFParse ?? mod?.default?.PDFParse
  if (typeof PDFParse !== 'function') {
    throw new Error('pdf-parse 无可用 PDFParse 类，无法渲染页面')
  }

  const fs = await import('fs')
  const buffer = await fs.promises.readFile(filePath)
  const parser = new PDFParse({ data: new Uint8Array(buffer) })

  try {
    const result = await parser.getScreenshot({
      first: Math.max(1, options.maxPages ?? 20),
      scale: options.scale ?? 2,
      imageBuffer: true,
    })

    const pages: PdfPageImage[] = []
    for (const page of result?.pages ?? []) {
      if (!page?.data) continue
      pages.push({
        pageNumber: page.pageNumber,
        base64: Buffer.from(page.data).toString('base64'),
        width: page.width,
        height: page.height,
      })
    }
    return pages
  } finally {
    await Promise.resolve(parser.destroy?.()).catch(() => undefined)
  }
}

/** 从 Word .docx 提取文本 */
export async function parseDocx(filePath: string): Promise<string> {
  const mod: any = await import('mammoth')
  // CJS 包在动态 import 下可能只挂 default，两种形态都接受
  const mammoth = typeof mod?.extractRawText === 'function' ? mod : (mod?.default ?? mod)
  const result = await mammoth.extractRawText({ path: filePath })
  return result?.value ?? ''
}

/** 从 Word .doc 提取文本 */
export async function parseDoc(filePath: string): Promise<string> {
  const mod: any = await import('word-extractor')
  const Ctor = mod?.default?.default ?? mod?.default ?? mod
  const extractor = new Ctor()
  const extracted = await extractor.extract(filePath)
  return extracted.getBody()
}

/** 从 Excel 提取文本（每个工作表输出 CSV 并带工作表名标题） */
export async function parseXlsx(filePath: string): Promise<string> {
  const mod: any = await import('xlsx')
  const XLSX = typeof mod?.readFile === 'function' ? mod : (mod?.default ?? mod)
  const workbook = XLSX.readFile(filePath)
  const lines: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    lines.push(`## Sheet: ${sheetName}\n${csv}`)
  }
  return lines.join('\n\n')
}

/** 从 PowerPoint .ppt/.pptx 提取文本 */
export async function parsePpt(filePath: string): Promise<string> {
  const mod: any = await import('officeparser')

  // officeparser v6：命名导出 parseOffice，返回 AST，需要 toText() 转纯文本
  const parseOffice = mod?.parseOffice ?? mod?.default?.parseOffice
  if (typeof parseOffice === 'function') {
    const ast = await parseOffice(filePath)
    if (typeof ast === 'string') return ast
    if (typeof ast?.toText === 'function') return ast.toText()
    return ast?.content ?? ''
  }

  // officeparser v5 及更早：parseOfficeAsync 直接返回字符串
  const legacy = mod?.default ?? mod
  const parseLegacy = legacy?.parseOfficeAsync ?? legacy?.parseOffice
  if (typeof parseLegacy === 'function') {
    const text = await parseLegacy(filePath)
    return typeof text === 'string' ? text : (text?.toText?.() ?? '')
  }

  throw new Error('officeparser 无可用解析入口')
}

/**
 * 将工作表数据序列化为 xlsx Buffer
 *
 * 逻辑与原 file:saveXlsx 内联实现保持一致（加载原始 base64 / 写单元格 /
 * 恢复行高列宽 / 合并单元格），仅将 exceljs 计算部分移出主进程。
 */
export async function serializeXlsx(sheetData: any): Promise<Buffer> {
  const mod = await import('exceljs')
  // CJS 包在动态 import 下可能只挂 default，统一取到真正的模块对象
  const ExcelJS: typeof mod = ((mod as any).default ?? mod)
  const workbook = new ExcelJS.Workbook()

  if (sheetData._rawBase64) {
    const buffer = Buffer.from(sheetData._rawBase64, 'base64')
    // exceljs 类型定义中的 Buffer 为旧版无泛型接口，需显式断言（@types/node 22 泛型 Buffer 兼容）
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
    delete sheetData._rawBase64
  }

  for (const [sheetName, sheetInfo] of Object.entries(sheetData)) {
    if (sheetName === '_rawBase64' || typeof sheetInfo !== 'object') continue

    let worksheet = workbook.getWorksheet(sheetName)
    if (!worksheet) {
      worksheet = workbook.addWorksheet(sheetName)
    }

    const info = sheetInfo as { rows?: Array<{ values: Array<string | null>; height?: number }>; merges?: Array<{ top: number; left: number; colSpan: number; rowSpan: number }> }
    const rows = info?.rows
    if (!rows || !Array.isArray(rows)) continue

    // 恢复列宽
    try {
      const colInfo = (worksheet as any)._columns
      if (colInfo) {
        for (let i = 0; i < colInfo.length; i++) {
          const col = worksheet.getColumn(i + 1)
          if (col && colInfo[i]?.width) {
            col.width = colInfo[i].width
          }
        }
      }
    } catch {
      // 列宽恢复失败不影响数据写入
    }

    // 写入单元格值
    for (let r = 0; r < rows.length; r++) {
      const rowData = rows[r]
      const excelRow = worksheet.getRow(r + 1)
      if (rowData.height) {
        excelRow.height = rowData.height / 1.333 // px → point
      }
      const values = rowData.values
      if (Array.isArray(values)) {
        for (let c = 0; c < values.length; c++) {
          const cellValue = values[c]
          if (cellValue !== undefined && cellValue !== null) {
            excelRow.getCell(c + 1).value = cellValue
          }
        }
      }
    }

    // 恢复合并单元格
    const merges = info?.merges
    if (merges && Array.isArray(merges)) {
      for (const m of merges) {
        try {
          worksheet.mergeCells(m.top + 1, m.left + 1, m.top + m.rowSpan, m.left + m.colSpan)
        } catch {
          // 单合并操作失败不影响整体保存
        }
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer as unknown as Uint8Array)
}

/** 按任务类型分发执行 */
export async function runDocParserTask(req: DocParserRequest): Promise<DocParserResponse> {
  try {
    switch (req.kind) {
      case 'pdf':
        return { id: req.id, ok: true, text: await parsePdf(req.filePath) }
      case 'docx':
        return { id: req.id, ok: true, text: await parseDocx(req.filePath) }
      case 'doc':
        return { id: req.id, ok: true, text: await parseDoc(req.filePath) }
      case 'xlsx':
        return { id: req.id, ok: true, text: await parseXlsx(req.filePath) }
      case 'ppt':
        return { id: req.id, ok: true, text: await parsePpt(req.filePath) }
      case 'saveXlsx': {
        const buffer = await serializeXlsx(req.sheetData)
        return { id: req.id, ok: true, bufferBase64: buffer.toString('base64') }
      }
      case 'pdfPages': {
        const pageImages = await renderPdfPages(req.filePath, req.renderOptions)
        return { id: req.id, ok: true, pageImages }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { id: req.id, ok: false, error: message }
  }
}
