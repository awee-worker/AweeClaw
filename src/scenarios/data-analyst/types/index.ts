/**
 * 数据分析师场景类型定义
 */

export type DatabaseDriver = 'sqlite' | 'postgresql' | 'mysql' | 'duckdb'

export type ApiAuthType = 'none' | 'bearer' | 'api-key' | 'basic' | 'oauth2'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface DatabaseConnectionConfig {
  id: string
  name: string
  driver: DatabaseDriver
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  filePath?: string
  status: 'connected' | 'disconnected' | 'error'
  lastError?: string
}

export interface RestApiConfig {
  id: string
  name: string
  url: string
  method: HttpMethod
  authType: ApiAuthType
  authToken?: string
  authHeaderName?: string
  headers?: Record<string, string>
  body?: string
  contentType?: string
  status: 'connected' | 'disconnected' | 'error'
  lastError?: string
}

export interface CsvImportConfig {
  filePath: string
  encoding?: string
  delimiter?: string
  hasHeader?: boolean
  skipRows?: number
  maxRows?: number
}

export interface DataProfile {
  totalRows: number
  totalColumns: number
  columns: ColumnProfile[]
  memoryUsage?: string
}

export interface ColumnProfile {
  name: string
  type: 'number' | 'string' | 'date' | 'boolean' | 'null' | 'mixed'
  nullCount: number
  nullPercent: number
  uniqueCount: number
  sample: unknown[]
  stats?: {
    min?: number
    max?: number
    mean?: number
    median?: number
    stdDev?: number
  }
}

export interface ChartSpec {
  chartType: string
  title?: string
  data: unknown
  xField?: string
  yField?: string
  xLabel?: string
  yLabel?: string
  colorField?: string
  options?: Record<string, unknown>
}

export interface SqlQueryResult {
  success: boolean
  columns?: string[]
  rows?: Record<string, unknown>[]
  rowCount?: number
  error?: string
  executionTime?: number
}
