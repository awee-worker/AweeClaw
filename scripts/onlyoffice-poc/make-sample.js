/**
 * 生成 PoC 样例 xlsx：覆盖列宽差异、合并单元格、背景色、特殊符号等场景
 * 运行：node make-sample.js   （从 aweeclaw-client 目录，复用其 exceljs）
 */
const ExcelJS = require('exceljs')

const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('任务算法')

// 不同列宽 —— 验证是否错位
ws.columns = [
  { header: '编号', key: 'id', width: 10 },
  { header: '任务名称', key: 'name', width: 28 },
  { header: '优先级', key: 'prio', width: 14 },
  { header: '状态 · 说明', key: 'note', width: 24 },
]

const rows = [
  { id: 1, name: '算法设计', prio: '高', note: '· 步骤一\n· 步骤二' },
  { id: 2, name: '并行任务A / 并行任务B', prio: '中', note: '• 子项 1\n• 子项 2' },
  { id: 3, name: '—— 特殊字符 ——', prio: '低', note: '→ ➜ ☑ ✗ ✓' },
  { id: 4, name: '公式与求和', prio: '高', note: '' },
]
rows.forEach((r) => ws.addRow(r))

ws.getCell('D4').value = { formula: 'SUM(A2:A3)', result: 5 }
ws.getCell('D4').numFmt = '0'

// 背景色与加粗表头
ws.getRow(1).eachCell((c) => {
  c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
  c.alignment = { vertical: 'middle' }
})

// 合并单元格演示
ws.mergeCells('A6:C6')
const merged = ws.getCell('A6')
merged.value = '合并单元格 · 任务总览'
merged.font = { bold: true, size: 13 }
merged.alignment = { vertical: 'middle', horizontal: 'center' }

ws.getCell('A7').value = '日期'
ws.getCell('B7').value = new Date(2026, 8, 8)
ws.getCell('B7').numFmt = 'yyyy-mm-dd'
ws.getCell('C7').value = '¥1,234.50'
ws.getCell('C7').numFmt = '"¥"#,##0.00'

wb.xlsx
  .writeFile(__dirname + '/sample.xlsx')
  .then(() => console.log('已生成: sample.xlsx'))
  .catch((e) => { console.error(e); process.exit(1) })
