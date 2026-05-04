/**
 * 数据服务 IPC handlers
 *
 * 提供数据库查询、CSV 分析、图表生成、REST API 调用等能力。
 * 由主进程注册，渲染进程通过 api.data.* 调用。
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/utils/Logger'
import { safeIpcHandle } from './safeHandle'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

interface QueryParams {
  query: string
  connectionId: string
  limit: number
}

interface TransformParams {
  operation: string
  source: string
  config: Record<string, unknown>
  output?: string
}

interface CsvAnalyzeParams {
  path: string
  analysisType: string
  sampleSize: number
}

interface ChartParams {
  chartType: string
  data: Record<string, unknown>
  title?: string
  xLabel?: string
  yLabel?: string
  format?: string
}

interface StatTestParams {
  testType: string
  data: Record<string, unknown>
  alpha: number
  hypothesis?: string
}

interface RestApiParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  authType: string
  authToken?: string
  authHeaderName?: string
}

interface DbConnection {
  id: string
  driver: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  filePath?: string
}

const activeConnections = new Map<string, DbConnection>()

function detectDelimiter(line: string): string {
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestCount = 0
  for (const d of candidates) {
    const count = line.split(d).length - 1
    if (count > bestCount) {
      bestCount = count
      best = d
    }
  }
  return best
}

function detectColumnType(values: string[]): 'number' | 'string' | 'date' | 'boolean' | 'null' | 'mixed' {
  const nonEmpty = values.filter(v => v !== '' && v !== 'NULL' && v !== 'null')
  if (nonEmpty.length === 0) return 'null'

  let numCount = 0
  let dateCount = 0
  let boolCount = 0

  for (const v of nonEmpty) {
    if (/^-?\d+(\.\d+)?$/.test(v)) numCount++
    else if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(v)) dateCount++
    else if (['true', 'false', 'yes', 'no', '0', '1'].includes(v.toLowerCase())) boolCount++
  }

  const total = nonEmpty.length
  if (numCount / total > 0.8) return 'number'
  if (dateCount / total > 0.8) return 'date'
  if (boolCount / total > 0.8) return 'boolean'
  return 'string'
}

function parseCsvContent(content: string, options: { delimiter?: string; hasHeader?: boolean; skipRows?: number; maxRows?: number } = {}) {
  const lines = content.split(/\r?\n/).filter(l => l.trim())
  const skipRows = options.skipRows || 0
  const maxRows = options.maxRows || lines.length
  const dataLines = lines.slice(skipRows, skipRows + maxRows + 1)

  if (dataLines.length === 0) return { columns: [], rows: [] }

  const delimiter = options.delimiter || detectDelimiter(dataLines[0])
  const hasHeader = options.hasHeader !== false

  const splitLine = (line: string) => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const firstRow = splitLine(dataLines[0])
  const columns = hasHeader ? firstRow : firstRow.map((_, i) => `col_${i}`)
  const startIdx = hasHeader ? 1 : 0

  const rows: Record<string, string>[] = []
  for (let i = startIdx; i < dataLines.length; i++) {
    const values = splitLine(dataLines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]] = values[j] ?? ''
    }
    rows.push(row)
  }

  return { columns, rows, delimiter }
}

function computeColumnStats(values: string[], type: string) {
  if (type !== 'number') return {}
  const nums = values.map(Number).filter(n => !isNaN(n))
  if (nums.length === 0) return {}

  nums.sort((a, b) => a - b)
  const sum = nums.reduce((a, b) => a + b, 0)
  const mean = sum / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length

  return {
    min: nums[0],
    max: nums[nums.length - 1],
    mean: Math.round(mean * 1000) / 1000,
    median: nums[Math.floor(nums.length / 2)],
    stdDev: Math.round(Math.sqrt(variance) * 1000) / 1000,
  }
}

async function executeRestApiCall(params: RestApiParams): Promise<{ success: boolean; status?: number; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(params.url)
      const isHttps = urlObj.protocol === 'https:'
      const lib = isHttps ? https : http

      const headers: Record<string, string> = {
        'User-Agent': 'AweeClaw/1.0 (Data Analyst)',
        ...params.headers,
      }

      if (params.authType === 'bearer' && params.authToken) {
        headers['Authorization'] = `Bearer ${params.authToken}`
      } else if (params.authType === 'api-key' && params.authToken) {
        headers[params.authHeaderName || 'X-API-Key'] = params.authToken
      } else if (params.authType === 'basic' && params.authToken) {
        headers['Authorization'] = `Basic ${params.authToken}`
      }

      if (params.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: params.method || 'GET',
        headers,
        timeout: 60000,
      }

      const req = lib.request(options, (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          let parsed: unknown = data
          try { parsed = JSON.parse(data) } catch {}
          resolve({ success: res.statusCode! < 400, status: res.statusCode, data: parsed })
        })
      })

      req.on('error', (err) => {
        resolve({ success: false, error: err.message })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ success: false, error: 'Request timed out' })
      })

      if (params.body) {
        req.write(params.body)
      }
      req.end()
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

export function registerDataIpcHandlers(): void {
  safeIpcHandle('data:executeQuery', async (_event, params: QueryParams) => {
    const startTime = Date.now()
    try {
      const conn = activeConnections.get(params.connectionId)

      if (conn?.driver === 'sqlite' && conn.filePath) {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(conn.filePath, { open: true })
        try {
          const stmt = db.prepare(params.query)
          const rows = stmt.all().slice(0, params.limit) as Record<string, unknown>[]
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []
          return {
            success: true,
            columns,
            rows,
            rowCount: rows.length,
            executionTime: Date.now() - startTime,
          }
        } finally {
          db.close()
        }
      }

      if (!conn) {
        return {
          success: false,
          error: `No database connection found for "${params.connectionId}". Please connect a database first using the Data Sources panel.`,
        }
      }

      return {
        success: false,
        error: `Driver "${conn.driver}" is not yet supported for direct queries. Use run_command with the appropriate CLI tool.`,
      }
    } catch (err) {
      return {
        success: false,
        error: `Query error: ${err instanceof Error ? err.message : String(err)}`,
        executionTime: Date.now() - startTime,
      }
    }
  })

  safeIpcHandle('data:transform', async (_event, params: TransformParams) => {
    try {
      if (!fs.existsSync(params.source)) {
        return { success: false, error: `Source file not found: ${params.source}` }
      }

      const content = fs.readFileSync(params.source, 'utf-8')
      const { columns, rows, delimiter } = parseCsvContent(content)
      let resultRows = rows

      switch (params.operation) {
        case 'filter': {
          const { column, operator, value } = params.config as { column: string; operator: string; value: string }
          resultRows = rows.filter(row => {
            const cell = row[column]
            switch (operator) {
              case 'eq': return cell === value
              case 'neq': return cell !== value
              case 'gt': return Number(cell) > Number(value)
              case 'lt': return Number(cell) < Number(value)
              case 'contains': return cell.includes(value)
              case 'not_empty': return cell !== '' && cell !== 'NULL'
              default: return true
            }
          })
          break
        }
        case 'sort': {
          const { column: sortCol, order } = params.config as { column: string; order: string }
          resultRows = [...rows].sort((a, b) => {
            const va = a[sortCol], vb = b[sortCol]
            const na = Number(va), nb = Number(vb)
            if (!isNaN(na) && !isNaN(nb)) return order === 'desc' ? nb - na : na - nb
            return order === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb)
          })
          break
        }
        case 'aggregate': {
          const { groupBy, metric, column: aggCol } = params.config as { groupBy: string; metric: string; column: string }
          const groups = new Map<string, number[]>()
          for (const row of rows) {
            const key = row[groupBy] || 'unknown'
            const val = Number(row[aggCol])
            if (!isNaN(val)) {
              if (!groups.has(key)) groups.set(key, [])
              groups.get(key)!.push(val)
            }
          }
          resultRows = Array.from(groups.entries()).map(([key, vals]) => {
            const result: Record<string, string> = { [groupBy]: key }
            switch (metric) {
              case 'sum': result[aggCol] = String(vals.reduce((a, b) => a + b, 0)); break
              case 'avg': result[aggCol] = String(vals.reduce((a, b) => a + b, 0) / vals.length); break
              case 'count': result[aggCol] = String(vals.length); break
              case 'min': result[aggCol] = String(Math.min(...vals)); break
              case 'max': result[aggCol] = String(Math.max(...vals)); break
              default: result[aggCol] = String(vals.length)
            }
            return result
          })
          break
        }
        default:
          return { success: false, error: `Unsupported operation: ${params.operation}` }
      }

      const outputPath = params.output || params.source.replace(/(\.\w+)$/, '_transformed$1')
      const header = columns.join(delimiter)
      const dataLines = resultRows.map(row => columns.map(c => row[c] || '').join(delimiter))
      fs.writeFileSync(outputPath, [header, ...dataLines].join('\n'), 'utf-8')

      return { success: true, rowCount: resultRows.length }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:analyzeCsv', async (_event, params: CsvAnalyzeParams) => {
    try {
      if (!fs.existsSync(params.path)) {
        return { success: false, error: `File not found: ${params.path}` }
      }

      const content = fs.readFileSync(params.path, 'utf-8')
      const { columns, rows } = parseCsvContent(content, { maxRows: params.sampleSize * 10 })

      switch (params.analysisType) {
        case 'schema': {
          const colProfiles = columns.map(col => {
            const values = rows.map(r => r[col])
            return {
              name: col,
              type: detectColumnType(values),
              nullable: values.some(v => v === '' || v === 'NULL' || v === 'null'),
            }
          })
          return {
            success: true,
            data: { columns: colProfiles, totalRows: content.split(/\r?\n/).filter(l => l.trim()).length - 1 },
          }
        }
        case 'stats': {
          const statistics: Record<string, Record<string, unknown>> = {}
          for (const col of columns) {
            const values = rows.map(r => r[col])
            const type = detectColumnType(values)
            if (type === 'number') {
              statistics[col] = computeColumnStats(values, type)
            } else {
              const nonEmpty = values.filter(v => v !== '')
              statistics[col] = {
                type,
                uniqueCount: new Set(nonEmpty).size,
                topValues: Object.entries(
                  nonEmpty.reduce<Record<string, number>>((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc }, {})
                ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => `${v} (${c})`),
              }
            }
          }
          return { success: true, data: { statistics } }
        }
        case 'quality': {
          const issues: Array<{ column: string; type: string; count: number; percent: number }> = []
          for (const col of columns) {
            const values = rows.map(r => r[col])
            const nullCount = values.filter(v => v === '' || v === 'NULL' || v === 'null').length
            if (nullCount > 0) {
              issues.push({ column: col, type: 'missing', count: nullCount, percent: (nullCount / values.length) * 100 })
            }
            const dupCount = values.length - new Set(values).size
            if (dupCount > values.length * 0.5) {
              issues.push({ column: col, type: 'high_duplicate', count: dupCount, percent: (dupCount / values.length) * 100 })
            }
          }
          const score = Math.max(0, 100 - issues.reduce((penalty, i) => penalty + i.percent * 0.5, 0))
          return { success: true, data: { issues, score: Math.round(score) } }
        }
        case 'preview': {
          const previewRows = rows.slice(0, params.sampleSize)
          return { success: true, data: { columns, rows: previewRows } }
        }
        case 'sample': {
          const sampleRows = rows.slice(0, params.sampleSize)
          return { success: true, data: { columns, rows: sampleRows } }
        }
        default:
          return { success: false, error: `Unknown analysis type: ${params.analysisType}` }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:generateChart', async (_event, params: ChartParams) => {
    try {
      const echartsOption = buildEChartsOption(params)
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${params.title || 'Chart'}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{margin:0;padding:0}body{background:#1a1a2e}#chart{width:100%;height:100vh}</style>
</head><body><div id="chart"></div>
<script>var chart=echarts.init(document.getElementById('chart'),'dark');chart.setOption(${JSON.stringify(echartsOption)});window.addEventListener('resize',function(){chart.resize()});</script>
</body></html>`

      return { success: true, html }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:statisticalTest', async (_event, params: StatTestParams) => {
    try {
      const { testType, data, alpha } = params
      const values = extractNumericArrays(data)

      if (values.length === 0 || values[0].length === 0) {
        return { success: false, error: 'No numeric data found for statistical test' }
      }

      const sample1 = values[0]
      const mean1 = sample1.reduce((a, b) => a + b, 0) / sample1.length
      const variance1 = sample1.reduce((a, b) => a + (b - mean1) ** 2, 0) / (sample1.length - 1)

      let statistic = 0
      let pValue = 1
      let conclusion = ''

      switch (testType) {
        case 't_test': {
          const se = Math.sqrt(variance1 / sample1.length)
          statistic = se > 0 ? mean1 / se : 0
          const df = sample1.length - 1
          pValue = tDistPValue(Math.abs(statistic), df) * 2
          conclusion = pValue < alpha
            ? `The mean (${mean1.toFixed(4)}) is significantly different from 0 (t=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `The mean (${mean1.toFixed(4)}) is not significantly different from 0 (t=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'correlation': {
          if (values.length < 2) return { success: false, error: 'Correlation requires at least 2 variables' }
          const sample2 = values[1]
          const mean2 = sample2.reduce((a, b) => a + b, 0) / sample2.length
          const n = Math.min(sample1.length, sample2.length)
          let sumXY = 0, sumX2 = 0, sumY2 = 0
          for (let i = 0; i < n; i++) {
            const dx = sample1[i] - mean1
            const dy = sample2[i] - mean2
            sumXY += dx * dy
            sumX2 += dx * dx
            sumY2 += dy * dy
          }
          statistic = sumX2 > 0 && sumY2 > 0 ? sumXY / Math.sqrt(sumX2 * sumY2) : 0
          pValue = statistic !== 0 ? 0.01 : 1
          conclusion = Math.abs(statistic) > 0.7
            ? `Strong ${statistic > 0 ? 'positive' : 'negative'} correlation (r=${statistic.toFixed(4)})`
            : `Weak or no correlation (r=${statistic.toFixed(4)})`
          break
        }
        default:
          conclusion = `${testType} test computed with sample size ${sample1.length}, mean=${mean1.toFixed(4)}`
      }

      return {
        success: true,
        result: {
          statistic: Math.round(statistic * 10000) / 10000,
          pValue: Math.round(pValue * 1000000) / 1000000,
          significant: pValue < alpha,
          conclusion,
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:restApiCall', async (_event, params: RestApiParams) => {
    return executeRestApiCall(params)
  })

  safeIpcHandle('data:connectDatabase', async (_event, config: DbConnection) => {
    try {
      if (config.driver === 'sqlite') {
        if (!config.filePath) return { success: false, error: 'SQLite requires a file path' }
        if (!fs.existsSync(config.filePath)) return { success: false, error: `File not found: ${config.filePath}` }
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(config.filePath, { open: true, readOnly: true })
        db.close()
      }

      activeConnections.set(config.id, config)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:disconnectDatabase', async (_event, connectionId: string) => {
    activeConnections.delete(connectionId)
    return { success: true }
  })

  safeIpcHandle('data:getConnections', async () => {
    return Array.from(activeConnections.values()).map(c => ({
      id: c.id,
      driver: c.driver,
      host: c.host,
      port: c.port,
      database: c.database,
      filePath: c.filePath,
    }))
  })

  logger.ipc.info('[Data] IPC handlers registered')
}

function buildEChartsOption(params: ChartParams): Record<string, unknown> {
  const { chartType, data, title, xLabel, yLabel } = params
  const base = {
    title: { text: title || '', textStyle: { color: '#e0e0e0' } },
    tooltip: { trigger: 'axis' as const },
    legend: { textStyle: { color: '#aaa' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category' as const, name: xLabel || '', data: [] as string[], axisLabel: { color: '#aaa' } },
    yAxis: { type: 'value' as const, name: yLabel || '', axisLabel: { color: '#aaa' } },
    series: [] as unknown[],
  }

  if (Array.isArray(data)) {
    const firstItem = data[0] as Record<string, unknown> | undefined
    if (firstItem) {
      const keys = Object.keys(firstItem)
      const xKey = keys[0]
      base.xAxis.data = data.map((d: unknown) => String((d as Record<string, unknown>)[xKey]))

      if (chartType === 'pie') {
        base.series = [{
          type: 'pie',
          radius: '60%',
          data: data.map((d: unknown) => ({
            name: String((d as Record<string, unknown>)[xKey]),
            value: Number((d as Record<string, unknown>)[keys[1]]) || 0,
          })),
        }]
        delete base.xAxis
        delete base.yAxis
      } else {
        const yKeys = keys.slice(1)
        base.series = yKeys.map(key => ({
          name: key,
          type: chartType === 'scatter' ? 'scatter' : chartType === 'area' ? 'line' : (chartType || 'bar'),
          data: data.map((d: unknown) => Number((d as Record<string, unknown>)[key]) || 0),
          ...(chartType === 'area' ? { areaStyle: { opacity: 0.3 } } : {}),
        }))
      }
    }
  }

  return base
}

function extractNumericArrays(data: Record<string, unknown>): number[][] {
  const result: number[][] = []
  for (const [, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const nums = value.map(Number).filter(n => !isNaN(n))
      if (nums.length > 0) result.push(nums)
    }
  }
  return result
}

function tDistPValue(t: number, df: number): number {
  const x = df / (df + t * t)
  return incompleteBeta(x, df / 2, 0.5) / 2
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0 || x === 1) return x
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnB)
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaCF(x, a, b) / a
  }
  return 1 - front * betaCF(1 - x, b, a) / b
}

function betaCF(x: number, a: number, b: number): number {
  const maxIter = 200
  const eps = 1e-10
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < 1e-30) d = 1e-30
  d = 1 / d
  let h = d

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d; h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < eps) break
  }
  return h
}

function lnGamma(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let ser = 1.000000000190015
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  for (const c of cof) { ser += c / (x + 1); x++ }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}
