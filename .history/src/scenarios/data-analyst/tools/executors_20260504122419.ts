/**
 * 数据分析师场景 - 工具执行器
 *
 * 实现 sql_query、data_transform、csv_analyze、chart_generate、statistical_test、rest_api
 * 等数据分析工具的实际执行逻辑。
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { ToolExecutionResult, ToolExecutionContext } from '@/shared/types'
import type {
  DatabaseConnectionConfig,
  RestApiConfig,
  CsvImportConfig,
  SqlQueryResult,
} from '../types'

const DATA_TOOL_TIMEOUT = 120000

function dataError(message: string): ToolExecutionResult {
  return { success: false, result: '', error: message }
}

function dataSuccess(result: string, meta?: Record<string, unknown>): ToolExecutionResult {
  return { success: true, result, meta }
}

async function sqlQuery(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const query = args.query as string
  const connectionId = args.connection_id as string | undefined
  const limit = (args.limit as number) || 100

  if (!query?.trim()) return dataError('SQL query is required')

  try {
    const result = await api.data.executeQuery({
      query: query.trim(),
      connectionId: connectionId || 'default',
      limit,
    }) as SqlQueryResult

    if (!result.success) {
      return dataError(result.error || 'Query execution failed')
    }

    const header = result.columns?.join(' | ') || ''
    const separator = result.columns?.map(() => '---').join(' | ') || ''
    const rows = result.rows?.slice(0, limit).map(row =>
      result.columns!.map(col => String(row[col] ?? 'NULL')).join(' | ')
    ).join('\n') || ''

    const output = [
      `**Query executed** (${result.executionTime?.toFixed(0) || '?'}ms, ${result.rowCount} rows)`,
      '',
      header,
      separator,
      rows,
    ].join('\n')

    return dataSuccess(output, {
      chart: { type: 'table' as const, data: result.rows, columns: result.columns },
    })
  } catch (err) {
    return dataError(`SQL execution error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function dataTransform(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const operation = args.operation as string
  const source = args.source as string
  const config = args.config as Record<string, unknown>
  const output = args.output as string | undefined

  if (!operation || !source) return dataError('operation and source are required')

  try {
    const result = await api.data.transform({
      operation,
      source,
      config,
      output,
    }) as { success: boolean; data?: unknown; error?: string; rowCount?: number }

    if (!result.success) {
      return dataError(result.error || 'Transform failed')
    }

    return dataSuccess(
      `Transform "${operation}" completed successfully. ${result.rowCount ? `${result.rowCount} rows affected.` : ''}`,
      { transformedData: result.data }
    )
  } catch (err) {
    return dataError(`Transform error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function csvAnalyze(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const path = args.path as string
  const analysisType = args.analysis_type as string
  const sampleSize = (args.sample_size as number) || 20

  if (!path) return dataError('File path is required')
  if (!analysisType) return dataError('analysis_type is required')

  try {
    const result = await api.data.analyzeCsv({
      path,
      analysisType,
      sampleSize,
    }) as {
      success: boolean
      data?: Record<string, unknown>
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'CSV analysis failed')
    }

    const data = result.data || {}

    switch (analysisType) {
      case 'schema': {
        const cols = (data.columns as Array<{ name: string; type: string; nullable: boolean }>) || []
        const lines = [
          `**Schema Detection** for \`${path}\``,
          '',
          '| Column | Type | Nullable |',
          '| --- | --- | --- |',
          ...cols.map(c => `| ${c.name} | ${c.type} | ${c.nullable ? '✓' : '✗'} |`),
          '',
          `Total: ${cols.length} columns, ${data.totalRows || '?'} rows`,
        ]
        return dataSuccess(lines.join('\n'), data)
      }
      case 'stats': {
        const stats = (data.statistics as Record<string, Record<string, unknown>>) || {}
        const lines = [
          `**Statistical Summary** for \`${path}\``,
          '',
        ]
        for (const [col, s] of Object.entries(stats)) {
          lines.push(`**${col}**: mean=${s.mean ?? '-'}, std=${s.std ?? '-'}, min=${s.min ?? '-'}, max=${s.max ?? '-'}`)
        }
        return dataSuccess(lines.join('\n'), data)
      }
      case 'quality': {
        const issues = (data.issues as Array<{ column: string; type: string; count: number; percent: number }>) || []
        const lines = [
          `**Data Quality Report** for \`${path}\``,
          '',
          `Overall score: ${data.score || 'N/A'}/100`,
          '',
        ]
        if (issues.length === 0) {
          lines.push('No quality issues detected ✓')
        } else {
          lines.push('| Column | Issue | Count | % |')
          lines.push('| --- | --- | --- | --- |')
          for (const i of issues) {
            lines.push(`| ${i.column} | ${i.type} | ${i.count} | ${i.percent.toFixed(1)}% |`)
          }
        }
        return dataSuccess(lines.join('\n'), data)
      }
      case 'preview': {
        const rows = (data.rows as Record<string, unknown>[]) || []
        const columns = (data.columns as string[]) || []
        const lines = [
          `**Preview** (first ${sampleSize} rows) of \`${path}\``,
          '',
          columns.join(' | '),
          columns.map(() => '---').join(' | '),
          ...rows.map(r => columns.map(c => String(r[c] ?? '')).join(' | ')),
        ]
        return dataSuccess(lines.join('\n'), data)
      }
      default:
        return dataSuccess(JSON.stringify(data, null, 2), data)
    }
  } catch (err) {
    return dataError(`CSV analysis error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function chartGenerate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const chartType = args.chart_type as string
  const data = args.data as Record<string, unknown>
  const title = args.title as string | undefined
  const xLabel = args.x_label as string | undefined
  const yLabel = args.y_label as string | undefined
  const format = (args.format as string) || 'html'

  if (!chartType || !data) return dataError('chart_type and data are required')

  try {
    const result = await api.data.generateChart({
      chartType,
      data,
      title,
      xLabel,
      yLabel,
      format,
    }) as {
      success: boolean
      html?: string
      path?: string
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'Chart generation failed')
    }

    return dataSuccess(
      `Chart "${title || chartType}" generated successfully.`,
      {
        chart: {
          type: chartType,
          html: result.html,
          path: result.path,
        },
      }
    )
  } catch (err) {
    return dataError(`Chart generation error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function statisticalTest(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const testType = args.test_type as string
  const data = args.data as Record<string, unknown>
  const alpha = (args.alpha as number) || 0.05
  const hypothesis = args.hypothesis as string | undefined

  if (!testType || !data) return dataError('test_type and data are required')

  try {
    const result = await api.data.statisticalTest({
      testType,
      data,
      alpha,
      hypothesis,
    }) as {
      success: boolean
      result?: {
        statistic: number
        pValue: number
        significant: boolean
        conclusion: string
      }
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'Statistical test failed')
    }

    const r = result.result!
    const lines = [
      `**${testType.replace(/_/g, ' ').toUpperCase()}**`,
      '',
      hypothesis ? `H₀: ${hypothesis}` : '',
      `Test statistic: ${r.statistic.toFixed(4)}`,
      `P-value: ${r.pValue.toFixed(6)}`,
      `Significance level (α): ${alpha}`,
      `Result: ${r.significant ? '✗ Reject H₀ (statistically significant)' : '✓ Fail to reject H₀ (not significant)'}`,
      '',
      `**Conclusion**: ${r.conclusion}`,
    ].filter(Boolean)

    return dataSuccess(lines.join('\n'), { testResult: r })
  } catch (err) {
    return dataError(`Statistical test error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function restApi(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const url = args.url as string
  const method = (args.method as string) || 'GET'
  const headers = args.headers as Record<string, string> | undefined
  const body = args.body as string | undefined
  const authType = (args.auth_type as string) || 'none'
  const authToken = args.auth_token as string | undefined
  const authHeaderName = args.auth_header_name as string | undefined

  if (!url) return dataError('URL is required')

  try {
    const result = await api.data.restApiCall({
      url,
      method,
      headers: headers || {},
      body,
      authType,
      authToken,
      authHeaderName,
    }) as {
      success: boolean
      status?: number
      data?: unknown
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || `HTTP ${result.status}: Request failed`)
    }

    const content = typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data, null, 2)

    return dataSuccess(
      `**${method} ${url}** → ${result.status}\n\n${content.slice(0, 10000)}`,
      { responseData: result.data, status: result.status }
    )
  } catch (err) {
    return dataError(`REST API error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const dataAnalystExecutors = {
  sql_query: sqlQuery,
  data_transform: dataTransform,
  csv_analyze: csvAnalyze,
  chart_generate: chartGenerate,
  statistical_test: statisticalTest,
  rest_api: restApi,
}
