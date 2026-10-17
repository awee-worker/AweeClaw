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
export type DocParserKind = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'ppt' | 'saveXlsx'

/** 单次解析请求 */
export interface DocParserRequest {
  id: number
  kind: DocParserKind
  filePath: string
  /** saveXlsx 专用：渲染层传来的工作表数据（含可选 _rawBase64 原始文件） */
  sheetData?: any
}

/** 单次解析响应 */
export type DocParserResponse =
  | { id: number; ok: true; text?: string; bufferBase64?: string }
  | { id: number; ok: false; error: string }

/** 从 PDF 提取文本 */
export async function parsePdf(filePath: string): Promise<string> {
  const pdfParse = await import('pdf-parse')
  const fs = await import('fs')
  const dataBuffer = await fs.promises.readFile(filePath)
  const data = await (pdfParse as any).default(dataBuffer)
  return data.text
}

/** 从 Word .docx 提取文本 */
export async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

/** 从 Word .doc 提取文本 */
export async function parseDoc(filePath: string): Promise<string> {
  const WordExtractor = (await import('word-extractor')).default
  const extractor = new WordExtractor()
  const extracted = await extractor.extract(filePath)
  return extracted.getBody()
}

/** 从 Excel 提取文本（每个工作表输出 CSV 并带工作表名标题） */
export async function parseXlsx(filePath: string): Promise<string> {
  const XLSX = await import('xlsx')
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
  const officeParser = (await import('officeparser')).default
  const text = await officeParser.parseOffice(filePath)
  return typeof text === 'string' ? text : (text as any)?.toText?.() || String(text)
}

/**
 * 将工作表数据序列化为 xlsx Buffer
 *
 * 逻辑与原 file:saveXlsx 内联实现保持一致（加载原始 base64 / 写单元格 /
 * 恢复行高列宽 / 合并单元格），仅将 exceljs 计算部分移出主进程。
 */
export async function serializeXlsx(sheetData: any): Promise<Buffer> {
  const ExcelJS = await import('exceljs')
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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { id: req.id, ok: false, error: message }
  }
}
