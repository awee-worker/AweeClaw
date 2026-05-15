/**
 * 数据服务 IPC handlers（增强版）
 *
 * 提供数据库查询、CSV 分析、图表生成、REST API 调用等能力。
 * 由主进程注册，渲染进程通过 api.data.* 调用。
 *
 * 增强内容：
 * - P0-2: SQL注入防护（危险语句拦截+参数化查询）
 * - P0-3: 补全统计检验（chi_square/anova/mann_whitney/ks_test）
 * - P0-4: 补全data_transform操作（pivot/merge/reshape）
 * - P0-5: 完善图表生成（heatmap/radar/treemap/boxplot/histogram）
 * - P0-6: CSV大文件保护（大小限制+流式行数限制）
 * - P0-7: REST API SSRF防护（内网IP过滤+协议限制）
 * - P0-8: 数据库凭证安全（密码不返回渲染进程）
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from './ipcGuard'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'

const MAX_CSV_FILE_SIZE = 512 * 1024 * 1024
const MAX_CSV_ROWS = 500000
const MAX_QUERY_ROWS = 10000
const REST_API_TIMEOUT = 30000

let echartsSourceCache: string | null = null

function getEchartsSource(): string {
  if (echartsSourceCache) return echartsSourceCache
  try {
    const echartsPath = path.join(__dirname, '../../node_modules/echarts/dist/echarts.min.js')
    if (fs.existsSync(echartsPath)) {
      echartsSourceCache = fs.readFileSync(echartsPath, 'utf-8')
      return echartsSourceCache!
    }
  } catch {}
  try {
    const altPath = require.resolve('echarts/dist/echarts.min.js')
    echartsSourceCache = fs.readFileSync(altPath, 'utf-8')
    return echartsSourceCache!
  } catch {}
  logger.ipc.warn('[Data] ECharts local file not found, falling back to CDN')
  return ''
}

class DataCache {
  private cache = new Map<string, { data: unknown; timestamp: number }>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  private makeKey(prefix: string, ...parts: string[]): string {
    return `${prefix}:${parts.join('|')}`
  }

  get(prefix: string, ...parts: string[]): unknown | undefined {
    const key = this.makeKey(prefix, ...parts)
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data
  }

  set(prefix: string, data: unknown, ...parts: string[]): void {
    const key = this.makeKey(prefix, ...parts)
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, { data, timestamp: Date.now() })
  }

  invalidate(prefix: string, ...parts: string[]): void {
    if (parts.length === 0) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${prefix}:`)) this.cache.delete(key)
      }
    } else {
      const key = this.makeKey(prefix, ...parts)
      this.cache.delete(key)
    }
  }

  clear(): void {
    this.cache.clear()
  }
}

const dataCache = new DataCache()

const BLOCKED_SQL_PATTERNS = [
  /\bDROP\s+/i,
  /\bTRUNCATE\s+/i,
  /\bALTER\s+/i,
  /\bCREATE\s+/i,
  /\bATTACH\s+/i,
  /\bDETACH\s+/i,
  /\bREPLACE\s+INTO\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bxp_/i,
  /\bexec\s*\(/i,
  /\bchar\s*\(/i,
  /\b0x[0-9a-f]+\b/i,
]

const PRIVATE_IP_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '100.64.0.0', end: '100.127.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.0.0.0', end: '192.0.0.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '198.18.0.0', end: '198.19.255.255' },
  { start: '224.0.0.0', end: '239.255.255.255' },
  { start: '240.0.0.0', end: '255.255.255.255' },
]

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

function isDangerousSql(sql: string): string | null {
  const trimmed = sql.trim()
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Blocked: SQL contains potentially destructive operation (${pattern.source}). Only SELECT queries are allowed for safety.`
    }
  }
  return null
}

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') return true
  if (/^\[/.test(hostname)) return true
  const ipMatch = /^(\d+\.\d+\.\d+\.\d+)$/.exec(hostname)
  if (!ipMatch) return false
  const ipLong = ipToLong(ipMatch[1])
  return PRIVATE_IP_RANGES.some(range => {
    const start = ipToLong(range.start)
    const end = ipToLong(range.end)
    return ipLong >= start && ipLong <= end
  })
}

function validateRestApiUrl(urlStr: string): string | null {
  try {
    const urlObj = new URL(urlStr)
    if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
      return `Blocked: Only HTTP/HTTPS protocols are allowed, got "${urlObj.protocol}"`
    }
    if (isPrivateIp(urlObj.hostname)) {
      return `Blocked: Requests to private/internal IP addresses (${urlObj.hostname}) are not allowed`
    }
    return null
  } catch {
    return `Invalid URL: ${urlStr}`
  }
}

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
  const maxRows = Math.min(options.maxRows || lines.length, MAX_CSV_ROWS)
  const dataLines = lines.slice(skipRows, skipRows + maxRows + 1)

  if (dataLines.length === 0) return { columns: [] as string[], rows: [] as Record<string, string>[], delimiter: ',' }

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
  const q1Idx = Math.floor(nums.length * 0.25)
  const q3Idx = Math.floor(nums.length * 0.75)

  return {
    min: nums[0],
    max: nums[nums.length - 1],
    mean: Math.round(mean * 1000) / 1000,
    median: nums[Math.floor(nums.length / 2)],
    stdDev: Math.round(Math.sqrt(variance) * 1000) / 1000,
    q1: nums[q1Idx],
    q3: nums[q3Idx],
    iqr: nums[q3Idx] - nums[q1Idx],
  }
}

function readCsvSafely(filePath: string, _maxRows?: number): { content: string; truncated: boolean } {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_CSV_FILE_SIZE) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum allowed size is ${MAX_CSV_FILE_SIZE / 1024 / 1024}MB.`)
  }
  const content = fs.readFileSync(filePath, 'utf-8')
  return { content, truncated: false }
}

async function executeRestApiCall(params: RestApiParams): Promise<{ success: boolean; status?: number; data?: unknown; error?: string }> {
  const urlError = validateRestApiUrl(params.url)
  if (urlError) return { success: false, error: urlError }

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
        timeout: REST_API_TIMEOUT,
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

function lnGamma(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let ser = 1.000000000190015
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let xx = x
  for (const c of cof) { ser += c / (xx + 1); xx++ }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
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

function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0 || x === 1) return x
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b)
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnB)
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaCF(x, a, b) / a
  }
  return 1 - front * betaCF(1 - x, b, a) / b
}

function tDistPValue(t: number, df: number): number {
  const x = df / (df + t * t)
  return incompleteBeta(x, df / 2, 0.5) / 2
}

function normalCDF(x: number): number {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x) / Math.sqrt(2)
  const t = 1.0 / (1.0 + p * absX)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)
  return 0.5 * (1.0 + sign * y)
}

function chiSquareCDF(x: number, df: number): number {
  if (x <= 0) return 0
  return incompleteBeta(x / (x + df), df / 2, 0.5)
}

function fDistPValue(f: number, df1: number, df2: number): number {
  if (f <= 0) return 1
  const x = df2 / (df2 + df1 * f)
  return incompleteBeta(x, df2 / 2, df1 / 2)
}

function rankData(data: number[]): number[] {
  const indexed = data.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => a.v - b.v)
  const ranks = new Array(data.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++
    const avgRank = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank
    i = j
  }
  return ranks
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

function buildEChartsOption(params: ChartParams): Record<string, unknown> {
  const { chartType, data, title, xLabel, yLabel } = params
  const darkTheme = {
    title: { text: title || '', textStyle: { color: '#e0e0e0' } },
    tooltip: {},
    legend: { textStyle: { color: '#aaa' } },
  }

  if (!Array.isArray(data) || data.length === 0) {
    if (data && typeof data === 'object' && (data.series || data.xAxis || data.yAxis)) {
      return { ...darkTheme, ...data }
    }
    return { ...darkTheme, series: [] }
  }

  const firstItem = data[0] as Record<string, unknown> | undefined
  if (!firstItem) return { ...darkTheme, series: [] }

  const keys = Object.keys(firstItem)

  switch (chartType) {
    case 'pie': {
      const nameKey = keys[0]
      const valueKey = keys[1]
      return {
        ...darkTheme,
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie',
          radius: '60%',
          data: data.map((d: unknown) => ({
            name: String((d as Record<string, unknown>)[nameKey]),
            value: Number((d as Record<string, unknown>)[valueKey]) || 0,
          })),
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
          label: { color: '#ccc' },
        }],
      }
    }
    case 'heatmap': {
      const xKey = keys[0]
      const yKey = keys[1]
      const valKey = keys[2]
      const xValues = [...new Set(data.map((d: unknown) => String((d as Record<string, unknown>)[xKey])))]
      const yValues = [...new Set(data.map((d: unknown) => String((d as Record<string, unknown>)[yKey])))]
      const heatData = data.map((d: unknown) => {
        const item = d as Record<string, unknown>
        return [xValues.indexOf(String(item[xKey])), yValues.indexOf(String(item[yKey])), Number(item[valKey]) || 0]
      })
      return {
        ...darkTheme,
        tooltip: { position: 'top' },
        grid: { left: '15%', right: '10%', bottom: '15%', top: '10%' },
        xAxis: { type: 'category', data: xValues, splitArea: { show: true }, axisLabel: { color: '#aaa' } },
        yAxis: { type: 'category', data: yValues, splitArea: { show: true }, axisLabel: { color: '#aaa' } },
        visualMap: { min: 0, max: Math.max(...heatData.map(d => d[2] as number), 1), calculable: true, orient: 'horizontal', left: 'center', bottom: '0%', textStyle: { color: '#aaa' } },
        series: [{ type: 'heatmap', data: heatData, label: { show: true, color: '#ccc' }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } } }],
      }
    }
    case 'radar': {
      const indicatorKey = keys[0]
      const indicators = data.map((d: unknown) => String((d as Record<string, unknown>)[indicatorKey]))
      const valueKeys = keys.slice(1)
      const maxValues = valueKeys.map(vk => Math.max(...data.map((d: unknown) => Number((d as Record<string, unknown>)[vk]) || 0)) * 1.2 || 1)
      return {
        ...darkTheme,
        radar: {
          indicator: indicators.map((ind, i) => ({ name: ind, max: maxValues[i] })),
          axisName: { color: '#aaa' },
          splitArea: { areaStyle: { color: ['rgba(255,255,255,0.05)', 'rgba(255,255,255,0.1)'] } },
        },
        series: [{
          type: 'radar',
          data: valueKeys.map(vk => ({
            name: vk,
            value: data.map((d: unknown) => Number((d as Record<string, unknown>)[vk]) || 0),
          })),
        }],
      }
    }
    case 'treemap': {
      const nameKey = keys[0]
      const valueKey = keys[1]
      return {
        ...darkTheme,
        tooltip: { formatter: '{b}: {c}' },
        series: [{
          type: 'treemap',
          data: data.map((d: unknown) => ({
            name: String((d as Record<string, unknown>)[nameKey]),
            value: Number((d as Record<string, unknown>)[valueKey]) || 0,
          })),
          label: { color: '#ccc' },
          itemStyle: { borderColor: '#333' },
        }],
      }
    }
    case 'boxplot': {
      const groupKey = keys[0]
      const valKey = keys[1]
      const groups = new Map<string, number[]>()
      for (const d of data) {
        const item = d as Record<string, unknown>
        const g = String(item[groupKey])
        const v = Number(item[valKey])
        if (!isNaN(v)) {
          if (!groups.has(g)) groups.set(g, [])
          groups.get(g)!.push(v)
        }
      }
      const boxData: number[][] = []
      const categories: string[] = []
      for (const [g, vals] of groups) {
        vals.sort((a, b) => a - b)
        const q1 = vals[Math.floor(vals.length * 0.25)]
        const q2 = vals[Math.floor(vals.length * 0.5)]
        const q3 = vals[Math.floor(vals.length * 0.75)]
        const iqr = q3 - q1
        const lower = Math.max(vals[0], q1 - 1.5 * iqr)
        const upper = Math.min(vals[vals.length - 1], q3 + 1.5 * iqr)
        boxData.push([lower, q1, q2, q3, upper])
        categories.push(g)
      }
      return {
        ...darkTheme,
        tooltip: { trigger: 'item' },
        grid: { left: '10%', right: '10%', bottom: '15%' },
        xAxis: { type: 'category', data: categories, axisLabel: { color: '#aaa' } },
        yAxis: { type: 'value', name: yLabel || '', axisLabel: { color: '#aaa' } },
        series: [{ type: 'boxplot', data: boxData }],
      }
    }
    case 'histogram': {
      const valKey = keys[0]
      const values = data.map((d: unknown) => Number((d as Record<string, unknown>)[valKey])).filter(n => !isNaN(n))
      if (values.length === 0) return { ...darkTheme, series: [] }
      const min = Math.min(...values)
      const max = Math.max(...values)
      const binCount = Math.min(Math.max(Math.ceil(Math.sqrt(values.length)), 5), 30)
      const binWidth = (max - min) / binCount || 1
      const bins = new Array(binCount).fill(0)
      const labels: string[] = []
      for (let i = 0; i < binCount; i++) {
        labels.push((min + i * binWidth).toFixed(1))
      }
      for (const v of values) {
        const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1)
        bins[idx]++
      }
      return {
        ...darkTheme,
        tooltip: { trigger: 'axis' },
        grid: { left: '10%', right: '10%', bottom: '15%' },
        xAxis: { type: 'category', data: labels, name: xLabel || valKey, axisLabel: { color: '#aaa', rotate: 45 } },
        yAxis: { type: 'value', name: yLabel || 'Frequency', axisLabel: { color: '#aaa' } },
        series: [{ type: 'bar', data: bins, barWidth: '90%', itemStyle: { color: '#5470c6' } }],
      }
    }
    default: {
      const xKey = keys[0]
      const yKeys = keys.slice(1)
      const xData = data.map((d: unknown) => String((d as Record<string, unknown>)[xKey]))
      const seriesType = chartType === 'area' ? 'line' : (chartType || 'bar')
      return {
        ...darkTheme,
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', name: xLabel || '', data: xData, axisLabel: { color: '#aaa' } },
        yAxis: { type: 'value', name: yLabel || '', axisLabel: { color: '#aaa' } },
        series: yKeys.map(key => ({
          name: key,
          type: seriesType,
          data: data.map((d: unknown) => Number((d as Record<string, unknown>)[key]) || 0),
          ...(chartType === 'area' ? { areaStyle: { opacity: 0.3 } } : {}),
          ...(chartType === 'scatter' ? { symbolSize: 8 } : {}),
        })),
      }
    }
  }
}

export function registerDataIpcHandlers(): void {
  safeIpcHandle('data:executeQuery', async (_event, params: QueryParams) => {
    const startTime = Date.now()
    try {
      const sqlDanger = isDangerousSql(params.query)
      if (sqlDanger) {
        return { success: false, error: sqlDanger, executionTime: Date.now() - startTime }
      }

      const isSelect = /^\s*SELECT\b/i.test(params.query)
      if (isSelect) {
        const cached = dataCache.get('query', params.connectionId, params.query, String(params.limit)) as
          | { success: boolean; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executionTime: number; fromCache?: boolean }
          | undefined
        if (cached) {
          return { ...cached, fromCache: true, executionTime: Date.now() - startTime }
        }
      }

      const conn = activeConnections.get(params.connectionId)

      if (conn?.driver === 'sqlite' && conn.filePath) {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(conn.filePath, { open: true })
        try {
          const stmt = db.prepare(params.query)
          const rows = stmt.all().slice(0, Math.min(params.limit, MAX_QUERY_ROWS)) as Record<string, unknown>[]
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []
          const result = {
            success: true,
            columns,
            rows,
            rowCount: rows.length,
            executionTime: Date.now() - startTime,
          }
          if (isSelect) {
            dataCache.set('query', result, params.connectionId, params.query, String(params.limit))
          }
          return result
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

      const { content } = readCsvSafely(params.source)
      const { columns, rows, delimiter } = parseCsvContent(content)
      let resultRows = rows
      let resultColumns = columns

      switch (params.operation) {
        case 'filter': {
          const { column, operator, value } = params.config as { column: string; operator: string; value: string }
          if (!columns.includes(column)) return { success: false, error: `Column "${column}" not found. Available: ${columns.join(', ')}` }
          resultRows = rows.filter(row => {
            const cell = row[column]
            switch (operator) {
              case 'eq': return cell === value
              case 'neq': return cell !== value
              case 'gt': return Number(cell) > Number(value)
              case 'gte': return Number(cell) >= Number(value)
              case 'lt': return Number(cell) < Number(value)
              case 'lte': return Number(cell) <= Number(value)
              case 'contains': return cell.includes(value)
              case 'not_contains': return !cell.includes(value)
              case 'starts_with': return cell.startsWith(value)
              case 'ends_with': return cell.endsWith(value)
              case 'not_empty': return cell !== '' && cell !== 'NULL'
              case 'is_empty': return cell === '' || cell === 'NULL'
              case 'in': return value.split(',').map(v => v.trim()).includes(cell)
              default: return true
            }
          })
          break
        }
        case 'sort': {
          const { column: sortCol, order } = params.config as { column: string; order: string }
          if (!columns.includes(sortCol)) return { success: false, error: `Column "${sortCol}" not found. Available: ${columns.join(', ')}` }
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
          if (!columns.includes(groupBy)) return { success: false, error: `Group-by column "${groupBy}" not found` }
          if (!columns.includes(aggCol)) return { success: false, error: `Aggregate column "${aggCol}" not found` }
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
              case 'stddev': {
                const m = vals.reduce((a, b) => a + b, 0) / vals.length
                const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length
                result[aggCol] = String(Math.sqrt(v))
                break
              }
              default: result[aggCol] = String(vals.length)
            }
            return result
          })
          break
        }
        case 'pivot': {
          const { rowField, colField, valueField, aggFunc } = params.config as { rowField: string; colField: string; valueField: string; aggFunc?: string }
          if (!columns.includes(rowField) || !columns.includes(colField) || !columns.includes(valueField)) {
            return { success: false, error: 'One or more pivot fields not found in source columns' }
          }
          const rowValues = [...new Set(rows.map(r => r[rowField]))]
          const colValues = [...new Set(rows.map(r => r[colField]))]
          const pivotMap = new Map<string, number[]>()
          for (const row of rows) {
            const key = `${row[rowField]}|||${row[colField]}`
            const val = Number(row[valueField])
            if (!isNaN(val)) {
              if (!pivotMap.has(key)) pivotMap.set(key, [])
              pivotMap.get(key)!.push(val)
            }
          }
          const fn = aggFunc || 'sum'
          const agg = (vals: number[]): string => {
            if (vals.length === 0) return '0'
            switch (fn) {
              case 'sum': return String(vals.reduce((a, b) => a + b, 0))
              case 'avg': return String(vals.reduce((a, b) => a + b, 0) / vals.length)
              case 'count': return String(vals.length)
              case 'max': return String(Math.max(...vals))
              case 'min': return String(Math.min(...vals))
              default: return String(vals.reduce((a, b) => a + b, 0))
            }
          }
          resultColumns = [rowField, ...colValues]
          resultRows = rowValues.map(rv => {
            const row: Record<string, string> = { [rowField]: rv }
            for (const cv of colValues) {
              const key = `${rv}|||${cv}`
              row[cv] = agg(pivotMap.get(key) || [])
            }
            return row
          })
          break
        }
        case 'merge': {
          const { secondSource, joinType, leftKey, rightKey } = params.config as { secondSource: string; joinType: string; leftKey: string; rightKey: string }
          if (!fs.existsSync(secondSource)) return { success: false, error: `Second source file not found: ${secondSource}` }
          const { content: content2 } = readCsvSafely(secondSource)
          const { columns: columns2, rows: rows2 } = parseCsvContent(content2)
          const rightMap = new Map<string, Record<string, string>>()
          for (const row of rows2) {
            rightMap.set(row[rightKey], row)
          }
          const mergedColumns = [...columns, ...columns2.filter(c => c !== rightKey)]
          resultColumns = mergedColumns
          resultRows = []
          for (const leftRow of rows) {
            const key = leftRow[leftKey]
            const rightRow = rightMap.get(key)
            if (rightRow) {
              const merged: Record<string, string> = { ...leftRow }
              for (const c of columns2) {
                if (c !== rightKey) merged[c] = rightRow[c]
              }
              resultRows.push(merged)
            } else if (joinType === 'left' || joinType === 'full') {
              const merged: Record<string, string> = { ...leftRow }
              for (const c of columns2) {
                if (c !== rightKey) merged[c] = ''
              }
              resultRows.push(merged)
            }
          }
          if (joinType === 'right' || joinType === 'full') {
            const leftKeys = new Set(rows.map(r => r[leftKey]))
            for (const rightRow of rows2) {
              if (!leftKeys.has(rightRow[rightKey])) {
                const merged: Record<string, string> = {}
                for (const c of columns) merged[c] = c === leftKey ? rightRow[rightKey] : ''
                for (const c of columns2) {
                  if (c !== rightKey) merged[c] = rightRow[c]
                }
                resultRows.push(merged)
              }
            }
          }
          break
        }
        case 'reshape': {
          const { direction, idVars, valueVars } = params.config as { direction: string; idVars: string[]; valueVars: string[] }
          if (direction === 'wide_to_long') {
            if (!idVars?.length || !valueVars?.length) return { success: false, error: 'idVars and valueVars are required for wide_to_long reshape' }
            resultColumns = [...idVars, 'variable', 'value']
            resultRows = []
            for (const row of rows) {
              for (const vv of valueVars) {
                const newRow: Record<string, string> = {}
                for (const iv of idVars) newRow[iv] = row[iv]
                newRow.variable = vv
                newRow.value = row[vv] || ''
                resultRows.push(newRow)
              }
            }
          } else if (direction === 'long_to_wide') {
            if (!idVars?.length) return { success: false, error: 'idVars are required for long_to_wide reshape' }
            const varCol = (params.config as { variableCol: string }).variableCol || 'variable'
            const valCol = (params.config as { valueCol: string }).valueCol || 'value'
            const uniqueVars = [...new Set(rows.map(r => r[varCol]))]
            const groupMap = new Map<string, Record<string, string>>()
            for (const row of rows) {
              const groupKey = idVars.map(iv => row[iv]).join('|||')
              if (!groupMap.has(groupKey)) {
                const base: Record<string, string> = {}
                for (const iv of idVars) base[iv] = row[iv]
                groupMap.set(groupKey, base)
              }
              groupMap.get(groupKey)![row[varCol]] = row[valCol]
            }
            resultColumns = [...idVars, ...uniqueVars]
            resultRows = Array.from(groupMap.values())
          } else {
            return { success: false, error: `Unknown reshape direction: ${direction}. Use "wide_to_long" or "long_to_wide".` }
          }
          break
        }
        default:
          return { success: false, error: `Unsupported operation: ${params.operation}. Supported: filter, sort, aggregate, pivot, merge, reshape` }
      }

      const outputPath = params.output || params.source.replace(/(\.\w+)$/, '_transformed$1')
      const header = resultColumns.join(delimiter)
      const dataLines = resultRows.map(row => resultColumns.map(c => row[c] || '').join(delimiter))
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

      const cachedEntry = dataCache.get('csv', params.path, params.analysisType, String(params.sampleSize))
      if (cachedEntry) return { ...(cachedEntry as Record<string, unknown>), fromCache: true }

      const { content } = readCsvSafely(params.path)
      const { columns, rows } = parseCsvContent(content, { maxRows: params.sampleSize * 10 })

      const cacheAndReturn = (r: Record<string, unknown>) => {
        if (r.success) dataCache.set('csv', r, params.path, params.analysisType, String(params.sampleSize))
        return r
      }

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
          return cacheAndReturn({
            success: true,
            data: { columns: colProfiles, totalRows: content.split(/\r?\n/).filter(l => l.trim()).length - 1 },
          })
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
          return cacheAndReturn({ success: true, data: { statistics } })
        }
        case 'quality': {
          const issues: Array<{ column: string; type: string; count: number; percent: number }> = []
          for (const col of columns) {
            const values = rows.map(r => r[col])
            const nullCount = values.filter(v => v === '' || v === 'NULL' || v === 'null').length
            if (nullCount > 0) {
              issues.push({ column: col, type: 'missing', count: nullCount, percent: (nullCount / values.length) * 100 })
            }
            const nonEmpty = values.filter(v => v !== '')
            const dupCount = nonEmpty.length - new Set(nonEmpty).size
            if (dupCount > nonEmpty.length * 0.5) {
              issues.push({ column: col, type: 'high_duplicate', count: dupCount, percent: (dupCount / values.length) * 100 })
            }
            if (detectColumnType(values) === 'number') {
              const nums = values.map(Number).filter(n => !isNaN(n))
              if (nums.length > 0) {
                const sorted = [...nums].sort((a, b) => a - b)
                const q1 = sorted[Math.floor(sorted.length * 0.25)]
                const q3 = sorted[Math.floor(sorted.length * 0.75)]
                const iqr = q3 - q1
                const outlierCount = nums.filter(n => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length
                if (outlierCount > 0) {
                  issues.push({ column: col, type: 'outlier', count: outlierCount, percent: (outlierCount / nums.length) * 100 })
                }
              }
            }
          }
          const score = Math.max(0, 100 - issues.reduce((penalty, i) => penalty + i.percent * 0.5, 0))
          return cacheAndReturn({ success: true, data: { issues, score: Math.round(score) } })
        }
        case 'preview': {
          const previewRows = rows.slice(0, params.sampleSize)
          return cacheAndReturn({ success: true, data: { columns, rows: previewRows } })
        }
        case 'sample': {
          const sampleRows = rows.slice(0, params.sampleSize)
          return cacheAndReturn({ success: true, data: { columns, rows: sampleRows } })
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
      const localEcharts = getEchartsSource()
      const echartsScript = localEcharts
        ? `<script>${localEcharts}</script>`
        : `<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>`
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${params.title || 'Chart'}</title>
${echartsScript}
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
      const n1 = sample1.length
      const mean1 = sample1.reduce((a, b) => a + b, 0) / n1
      const variance1 = n1 > 1 ? sample1.reduce((a, b) => a + (b - mean1) ** 2, 0) / (n1 - 1) : 0

      let statistic = 0
      let pValue = 1
      let conclusion = ''

      switch (testType) {
        case 't_test': {
          const se = Math.sqrt(variance1 / n1)
          if (se === 0) {
            return { success: true, result: { statistic: 0, pValue: 1, significant: false, conclusion: 'All values are identical, t-test is undefined' } }
          }
          statistic = mean1 / se
          const df = n1 - 1
          pValue = tDistPValue(Math.abs(statistic), df) * 2
          conclusion = pValue < alpha
            ? `The mean (${mean1.toFixed(4)}) is significantly different from 0 (t(${df})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `The mean (${mean1.toFixed(4)}) is not significantly different from 0 (t(${df})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'correlation': {
          if (values.length < 2 || values[1].length < 2) return { success: false, error: 'Correlation requires at least 2 variables with data' }
          const sample2 = values[1]
          const mean2 = sample2.reduce((a, b) => a + b, 0) / sample2.length
          const n = Math.min(n1, sample2.length)
          let sumXY = 0, sumX2 = 0, sumY2 = 0
          for (let i = 0; i < n; i++) {
            const dx = sample1[i] - mean1
            const dy = sample2[i] - mean2
            sumXY += dx * dy
            sumX2 += dx * dx
            sumY2 += dy * dy
          }
          statistic = sumX2 > 0 && sumY2 > 0 ? sumXY / Math.sqrt(sumX2 * sumY2) : 0
          const tStat = statistic !== 0 ? statistic * Math.sqrt((n - 2) / (1 - statistic * statistic)) : 0
          pValue = n > 2 ? tDistPValue(Math.abs(tStat), n - 2) * 2 : (statistic !== 0 ? 0.01 : 1)
          const strength = Math.abs(statistic) > 0.7 ? 'Strong' : Math.abs(statistic) > 0.4 ? 'Moderate' : 'Weak'
          const direction = statistic > 0 ? 'positive' : 'negative'
          conclusion = `${strength} ${direction} correlation (r=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'chi_square': {
          const observed = sample1.slice(0, Math.min(sample1.length, 100))
          const freq = new Map<number, number>()
          for (const v of observed) freq.set(v, (freq.get(v) || 0) + 1)
          const categories = Array.from(freq.values())
          const total = categories.reduce((a, b) => a + b, 0)
          const expected = total / categories.length
          if (expected === 0) return { success: false, error: 'Chi-square test requires non-zero expected frequencies' }
          statistic = categories.reduce((sum, obs) => sum + (obs - expected) ** 2 / expected, 0)
          const df = categories.length - 1
          pValue = 1 - chiSquareCDF(statistic, df)
          conclusion = pValue < alpha
            ? `Significant association found (χ²(${df})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `No significant association (χ²(${df})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'anova': {
          if (values.length < 2) return { success: false, error: 'ANOVA requires at least 2 groups' }
          const groupMeans = values.map(g => g.reduce((a, b) => a + b, 0) / g.length)
          const grandMean = values.flat().reduce((a, b) => a + b, 0) / values.flat().length
          const totalN = values.reduce((sum, g) => sum + g.length, 0)
          const k = values.length
          const ssBetween = values.reduce((sum, g, i) => sum + g.length * (groupMeans[i] - grandMean) ** 2, 0)
          const ssWithin = values.reduce((sum, g, i) => sum + g.reduce((s, v) => s + (v - groupMeans[i]) ** 2, 0), 0)
          const dfBetween = k - 1
          const dfWithin = totalN - k
          if (dfWithin <= 0) return { success: false, error: 'Not enough data for ANOVA (need more observations per group)' }
          const msBetween = ssBetween / dfBetween
          const msWithin = ssWithin / dfWithin
          statistic = msWithin > 0 ? msBetween / msWithin : 0
          pValue = fDistPValue(statistic, dfBetween, dfWithin)
          conclusion = pValue < alpha
            ? `Significant difference between groups (F(${dfBetween},${dfWithin})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `No significant difference between groups (F(${dfBetween},${dfWithin})=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'mann_whitney': {
          if (values.length < 2 || values[1].length === 0) return { success: false, error: 'Mann-Whitney U test requires 2 independent samples' }
          const sample2 = values[1]
          const n2 = sample2.length
          const allValues = [...sample1, ...sample2]
          const ranks = rankData(allValues)
          const r1 = ranks.slice(0, n1).reduce((a, b) => a + b, 0)
          const u1 = n1 * n2 + n1 * (n1 + 1) / 2 - r1
          const u2 = n1 * n2 - u1
          statistic = Math.min(u1, u2)
          const mu = n1 * n2 / 2
          const sigma = Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
          const z = sigma > 0 ? (statistic - mu) / sigma : 0
          pValue = 2 * (1 - normalCDF(Math.abs(z)))
          conclusion = pValue < alpha
            ? `Significant difference in distributions (U=${statistic.toFixed(4)}, z=${z.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `No significant difference in distributions (U=${statistic.toFixed(4)}, z=${z.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        case 'ks_test': {
          if (values.length < 2 || values[1].length === 0) return { success: false, error: 'KS test requires 2 samples' }
          const sorted1 = [...sample1].sort((a, b) => a - b)
          const sorted2 = [...values[1]].sort((a, b) => a - b)
          const n2 = sorted2.length
          let maxD = 0
          let i = 0, j = 0
          while (i < n1 && j < n2) {
            const d = Math.abs(i / n1 - j / n2)
            if (d > maxD) maxD = d
            if (sorted1[i] < sorted2[j]) i++
            else j++
          }
          maxD = Math.max(maxD, Math.abs(1 - j / n2), Math.abs(i / n1 - 1))
          statistic = maxD
          const en = Math.sqrt(n1 * n2 / (n1 + n2))
          const lambda = (en + 0.12 + 0.11 / en) * maxD
          pValue = lambda > 0 ? 2 * Math.exp(-2 * lambda * lambda) : 1
          pValue = Math.min(pValue, 1)
          conclusion = pValue < alpha
            ? `Distributions are significantly different (D=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
            : `Distributions are not significantly different (D=${statistic.toFixed(4)}, p=${pValue.toFixed(6)})`
          break
        }
        default:
          return { success: false, error: `Unknown test type: ${testType}. Supported: t_test, correlation, chi_square, anova, mann_whitney, ks_test` }
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
    dataCache.invalidate('query', connectionId)
    return { success: true }
  })

  safeIpcHandle('data:clearCache', async () => {
    dataCache.clear()
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

  safeIpcHandle('data:eda', async (_event, params: { path: string; targetColumns?: string[]; sampleSize?: number }) => {
    try {
      if (!fs.existsSync(params.path)) return { success: false, error: `File not found: ${params.path}` }
      const { content } = readCsvSafely(params.path)
      const { columns, rows } = parseCsvContent(content, { maxRows: params.sampleSize || 10000 })
      const targetCols = params.targetColumns?.length ? params.targetColumns : columns

      const edaResults: Record<string, unknown> = {
        overview: {
          totalRows: rows.length,
          totalColumns: columns.length,
          targetColumns: targetCols,
        },
        columns: {},
        correlations: [] as Array<{ x: string; y: string; r: number }>,
        recommendations: [] as string[],
      }

      const numericCols: string[] = []
      const numericData: Map<string, number[]> = new Map()

      for (const col of targetCols) {
        if (!columns.includes(col)) continue
        const values = rows.map(r => r[col])
        const type = detectColumnType(values)
        const colProfile: Record<string, unknown> = { name: col, type }

        const missingCount = values.filter(v => v === '' || v === 'NULL' || v === 'null').length
        colProfile.missingCount = missingCount
        colProfile.missingPercent = (missingCount / values.length) * 100

        if (type === 'number') {
          const stats = computeColumnStats(values, type)
          Object.assign(colProfile, stats)
          numericCols.push(col)
          numericData.set(col, values.map(Number).filter(n => !isNaN(n)))
        } else {
          const nonEmpty = values.filter(v => v !== '')
          const freq: Record<string, number> = {}
          for (const v of nonEmpty) freq[v] = (freq[v] || 0) + 1
          const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
          colProfile.uniqueCount = sorted.length
          colProfile.topValues = sorted.slice(0, 5).map(([v, c]) => ({ value: v, count: c }))
          colProfile.mode = sorted[0]?.[0]
        }

        (edaResults.columns as Record<string, unknown>)[col] = colProfile
      }

      if (numericCols.length >= 2) {
        const correlations: Array<{ x: string; y: string; r: number }> = []
        for (let i = 0; i < numericCols.length; i++) {
          for (let j = i + 1; j < numericCols.length; j++) {
            const x = numericData.get(numericCols[i])!
            const y = numericData.get(numericCols[j])!
            const n = Math.min(x.length, y.length)
            if (n < 3) continue
            const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n
            const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n
            let sxy = 0, sxx = 0, syy = 0
            for (let k = 0; k < n; k++) {
              const dx = x[k] - mx, dy = y[k] - my
              sxy += dx * dy; sxx += dx * dx; syy += dy * dy
            }
            const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0
            correlations.push({ x: numericCols[i], y: numericCols[j], r: Math.round(r * 1000) / 1000 })
          }
        }
        edaResults.correlations = correlations
      }

      const recs = edaResults.recommendations as string[]
      const colProfiles = edaResults.columns as Record<string, Record<string, unknown>>
      for (const col of targetCols) {
        const p = colProfiles[col]
        if (!p) continue
        if ((p.missingPercent as number) > 20) recs.push(`Column "${col}" has ${(p.missingPercent as number).toFixed(1)}% missing values — consider imputation or removal`)
        if (p.type === 'number' && (p.stdDev as number) === 0) recs.push(`Column "${col}" has zero variance — consider removing (constant value)`)
        if (p.type === 'string' && (p.uniqueCount as number) === rows.length) recs.push(`Column "${col}" has all unique values — likely an ID column, consider excluding from analysis`)
      }
      const strongCorr = (edaResults.correlations as Array<{ x: string; y: string; r: number }>).filter(c => Math.abs(c.r) > 0.8)
      if (strongCorr.length > 0) {
        recs.push(`Strong correlations detected: ${strongCorr.map(c => `${c.x}↔${c.y} (r=${c.r})`).join(', ')} — consider checking for multicollinearity`)
      }

      return { success: true, data: edaResults }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:cleanData', async (_event, params: {
    source: string
    operations: Array<{ type: string; config: Record<string, unknown> }>
    output?: string
  }) => {
    try {
      if (!fs.existsSync(params.source)) return { success: false, error: `Source file not found: ${params.source}` }
      const { content } = readCsvSafely(params.source)
      const { columns, rows, delimiter } = parseCsvContent(content)
      let currentRows = rows
      let currentColumns = columns
      const appliedOps: string[] = []

      for (const op of params.operations) {
        switch (op.type) {
          case 'drop_null': {
            const threshold = (op.config.threshold as number) || 1
            currentRows = currentRows.filter(row => {
              const nullCount = currentColumns.filter(c => row[c] === '' || row[c] === 'NULL' || row[c] === 'null').length
              return nullCount < threshold * currentColumns.length
            })
            appliedOps.push(`drop_null(threshold=${threshold})`)
            break
          }
          case 'fill_null': {
            const { strategy, column: fillCol, value } = op.config as { strategy: string; column?: string; value?: string }
            const targetCols = fillCol ? [fillCol] : currentColumns
            for (const col of targetCols) {
              const values = currentRows.map(r => r[col]).filter(v => v !== '' && v !== 'NULL')
              let fillValue = ''
              if (strategy === 'mean') {
                const nums = values.map(Number).filter(n => !isNaN(n))
                fillValue = nums.length > 0 ? String(nums.reduce((a, b) => a + b, 0) / nums.length) : '0'
              } else if (strategy === 'median') {
                const nums = values.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
                fillValue = nums.length > 0 ? String(nums[Math.floor(nums.length / 2)]) : '0'
              } else if (strategy === 'mode') {
                const freq: Record<string, number> = {}
                for (const v of values) freq[v] = (freq[v] || 0) + 1
                fillValue = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
              } else if (strategy === 'constant') {
                fillValue = String(value ?? '0')
              } else if (strategy === 'forward_fill') {
                for (const row of currentRows) {
                  if (row[col] === '' || row[col] === 'NULL') row[col] = fillValue
                  else fillValue = row[col]
                }
                continue
              }
              for (const row of currentRows) {
                if (row[col] === '' || row[col] === 'NULL' || row[col] === 'null') row[col] = fillValue
              }
            }
            appliedOps.push(`fill_null(strategy=${strategy})`)
            break
          }
          case 'remove_duplicates': {
            const subset = (op.config.columns as string[]) || currentColumns
            const seen = new Set<string>()
            currentRows = currentRows.filter(row => {
              const key = subset.map(c => row[c]).join('|||')
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            appliedOps.push(`remove_duplicates(columns=${subset.join(',')})`)
            break
          }
          case 'remove_outliers': {
            const { column: outlierCol, method: _method } = op.config as { column: string; method?: string }
            if (!currentColumns.includes(outlierCol)) break
            const nums = currentRows.map(r => Number(r[outlierCol])).filter(n => !isNaN(n))
            if (nums.length < 4) break
            const sorted = [...nums].sort((a, b) => a - b)
            const q1 = sorted[Math.floor(sorted.length * 0.25)]
            const q3 = sorted[Math.floor(sorted.length * 0.75)]
            const iqr = q3 - q1
            const lower = q1 - 1.5 * iqr
            const upper = q3 + 1.5 * iqr
            const before = currentRows.length
            currentRows = currentRows.filter(r => {
              const v = Number(r[outlierCol])
              return isNaN(v) || (v >= lower && v <= upper)
            })
            appliedOps.push(`remove_outliers(column=${outlierCol}, removed=${before - currentRows.length})`)
            break
          }
          case 'rename_column': {
            const { oldName, newName } = op.config as { oldName: string; newName: string }
            if (!currentColumns.includes(oldName)) break
            currentColumns = currentColumns.map(c => c === oldName ? newName : c)
            for (const row of currentRows) {
              row[newName] = row[oldName]
              delete row[oldName]
            }
            appliedOps.push(`rename_column(${oldName}→${newName})`)
            break
          }
          case 'drop_column': {
            const dropCols = (op.config.columns as string[]) || []
            for (const dc of dropCols) {
              for (const row of currentRows) delete row[dc]
            }
            currentColumns = currentColumns.filter(c => !dropCols.includes(c))
            appliedOps.push(`drop_column(${dropCols.join(',')})`)
            break
          }
          case 'change_type': {
            const { column: typeCol, targetType } = op.config as { column: string; targetType: string }
            if (!currentColumns.includes(typeCol)) break
            for (const row of currentRows) {
              const v = row[typeCol]
              if (targetType === 'number') {
                const n = Number(v)
                row[typeCol] = isNaN(n) ? '0' : String(n)
              } else if (targetType === 'string') {
                row[typeCol] = String(v)
              }
            }
            appliedOps.push(`change_type(${typeCol}→${targetType})`)
            break
          }
          default:
            return { success: false, error: `Unknown cleaning operation: ${op.type}` }
        }
      }

      const outputPath = params.output || params.source.replace(/(\.\w+)$/, '_cleaned$1')
      const header = currentColumns.join(delimiter)
      const dataLines = currentRows.map(row => currentColumns.map(c => row[c] || '').join(delimiter))
      fs.writeFileSync(outputPath, [header, ...dataLines].join('\n'), 'utf-8')

      return {
        success: true,
        data: {
          originalRows: rows.length,
          resultRows: currentRows.length,
          operationsApplied: appliedOps,
          outputPath,
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('data:browseSchema', async (_event, params: { connectionId: string; filter?: string }) => {
    try {
      const conn = activeConnections.get(params.connectionId)
      if (!conn) return { success: false, error: `No connection found for "${params.connectionId}"` }

      if (conn.driver === 'sqlite' && conn.filePath) {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(conn.filePath, { open: true, readOnly: true })
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
          const filter = params.filter?.toLowerCase()
          const filtered = filter ? tables.filter(t => t.name.toLowerCase().includes(filter)) : tables

          const schema: Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; defaultValue?: string }> }> = []
          for (const table of filtered) {
            const tableInfo = db.prepare(`PRAGMA table_info("${table.name}")`).all() as Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>
            schema.push({
              name: table.name,
              columns: tableInfo.map(col => ({
                name: col.name,
                type: col.type,
                nullable: col.notnull === 0,
                primaryKey: col.pk > 0,
                defaultValue: col.dflt_value ?? undefined,
              })),
            })
          }
          return { success: true, data: { tables: schema, totalTables: tables.length } }
        } finally {
          db.close()
        }
      }

      return { success: false, error: `Schema browsing not supported for driver "${conn.driver}"` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  const queryHistory: Array<{ id: string; query: string; connectionId: string; timestamp: number; executionTime?: number; rowCount?: number; success: boolean }> = []
  let historyIdCounter = 0

  safeIpcHandle('data:saveQuery', async (_event, params: { query: string; connectionId: string; executionTime?: number; rowCount?: number; success: boolean }) => {
    queryHistory.unshift({
      id: `qh_${++historyIdCounter}`,
      query: params.query,
      connectionId: params.connectionId,
      timestamp: Date.now(),
      executionTime: params.executionTime,
      rowCount: params.rowCount,
      success: params.success,
    })
    if (queryHistory.length > 200) queryHistory.length = 200
    return { success: true }
  })

  safeIpcHandle('data:getQueryHistory', async (_event, params?: { limit?: number; connectionId?: string }) => {
    let results = params?.connectionId
      ? queryHistory.filter(q => q.connectionId === params.connectionId)
      : queryHistory
    if (params?.limit) results = results.slice(0, params.limit)
    return { success: true, data: results }
  })

  safeIpcHandle('data:exportReport', async (_event, params: {
    title: string
    sections: Array<{ type: string; title: string; content: string }>
    format: string
    outputPath?: string
  }) => {
    try {
      const { title, sections, format, outputPath } = params
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

      if (format === 'markdown' || format === 'md') {
        const lines = [`# ${title}`, '', `*Generated: ${new Date().toLocaleString()}*`, '']
        for (const section of sections) {
          lines.push(`## ${section.title}`, '')
          if (section.type === 'chart' && section.content) {
            lines.push(section.content)
          } else {
            lines.push(section.content)
          }
          lines.push('')
        }
        const md = lines.join('\n')
        const outPath = outputPath || `./report_${timestamp}.md`
        fs.writeFileSync(outPath, md, 'utf-8')
        return { success: true, data: { path: outPath, size: md.length } }
      }

      if (format === 'html') {
        const htmlSections = sections.map(s => {
          if (s.type === 'chart' && s.content?.startsWith('<!DOCTYPE') || s.content?.startsWith('<html')) {
            return `<section><h2>${s.title}</h2><div class="chart-container">${s.content}</div></section>`
          }
          return `<section><h2>${s.title}</h2><div class="content">${s.content.replace(/\n/g, '<br>')}</div></section>`
        }).join('\n')

        const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:960px;margin:0 auto;padding:20px;color:#333}h1{border-bottom:2px solid #5470c6;padding-bottom:10px}h2{color:#5470c6;margin-top:30px}section{margin:20px 0;padding:15px;background:#f9f9f9;border-radius:8px}.chart-container{width:100%;min-height:400px}.content{line-height:1.6}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#5470c6;color:white}</style>
</head><body><h1>${title}</h1><p><em>Generated: ${new Date().toLocaleString()}</em></p>${htmlSections}</body></html>`
        const outPath = outputPath || `./report_${timestamp}.html`
        fs.writeFileSync(outPath, html, 'utf-8')
        return { success: true, data: { path: outPath, size: html.length } }
      }

      return { success: false, error: `Unsupported export format: ${format}. Use "markdown" or "html".` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.ipc.info('[Data] IPC handlers registered')
}
