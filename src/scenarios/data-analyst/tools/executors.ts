/**
 * 数据分析师场景 - 工具执行器
 *
 * 实现 sql_query、data_transform、csv_analyze、chart_generate、statistical_test、rest_api
 * 等数据分析工具的实际执行逻辑。
 *
 * 增强内容：
 * - SQL查询安全限制（仅允许SELECT）
 * - 完整统计检验（t_test/correlation/chi_square/anova/mann_whitney/ks_test）
 * - 完整数据转换（filter/sort/aggregate/pivot/merge/reshape）
 * - SSRF防护反馈
 * - 大文件保护反馈
 */

import { api } from '@services/electronBridge'
import type { ToolExecutionResult, ToolExecutionContext } from '../../../scenario-system/providerTypes'
import type {
  SqlQueryResult,
} from '../providerTypes'

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

    try {
      await api.data.saveQuery({
        query: query.trim(),
        connectionId: connectionId || 'default',
        executionTime: result.executionTime,
        rowCount: result.rowCount,
        success: true,
      })
    } catch {}

    return dataSuccess(output, {
      chart: { type: 'table' as const, data: result.rows, columns: result.columns },
    })
  } catch (err) {
    try {
      await api.data.saveQuery({
        query: query.trim(),
        connectionId: connectionId || 'default',
        success: false,
      })
    } catch {}
    return dataError(`SQL execution error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function dataTransform(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const operation = args.operation as string
  const source = args.source as string
  const config = args.config as Record<string, unknown>
  const output = args.output as string | undefined

  if (!operation || !source) return dataError('operation and source are required')

  const operationDescriptions: Record<string, string> = {
    filter: 'Filter rows',
    sort: 'Sort data',
    aggregate: 'Aggregate data',
    pivot: 'Pivot (wide table)',
    merge: 'Merge/Join datasets',
    reshape: 'Reshape data',
  }

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

    const desc = operationDescriptions[operation] || operation
    return dataSuccess(
      `**${desc}** completed successfully. ${result.rowCount ? `${result.rowCount} rows in result.` : ''} Output saved to ${output || source.replace(/(\.\w+)$/, '_transformed$1')}`,
      { transformedData: result.data, rowCount: result.rowCount }
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
          if (s.type === 'number') {
            lines.push(`**${col}** (numeric): min=${s.min ?? '-'}, Q1=${s.q1 ?? '-'}, median=${s.median ?? '-'}, mean=${s.mean ?? '-'}, Q3=${s.q3 ?? '-'}, max=${s.max ?? '-'}, stdDev=${s.stdDev ?? '-'}`)
          } else {
            const topVals = Array.isArray(s.topValues) ? s.topValues.join(', ') : '-'
            lines.push(`**${col}** (${s.type}): unique=${s.uniqueCount ?? '-'}, top: ${topVals}`)
          }
        }
        return dataSuccess(lines.join('\n'), data)
      }
      case 'quality': {
        const issues = (data.issues as Array<{ column: string; type: string; count: number; percent: number }>) || []
        const lines = [
          `**Data Quality Report** for \`${path}\``,
          '',
          `Overall score: **${data.score || 'N/A'}/100**`,
          '',
        ]
        if (issues.length === 0) {
          lines.push('✅ No quality issues detected')
        } else {
          lines.push('| Column | Issue Type | Count | % |')
          lines.push('| --- | --- | --- | --- |')
          for (const i of issues) {
            lines.push(`| ${i.column} | ${i.type} | ${i.count} | ${i.percent.toFixed(1)}% |`)
          }
        }
        return dataSuccess(lines.join('\n'), data)
      }
      case 'preview':
      case 'sample': {
        const rows = (data.rows as Record<string, unknown>[]) || []
        const columns = (data.columns as string[]) || []
        const lines = [
          `**${analysisType === 'preview' ? 'Preview' : 'Sample'}** (first ${sampleSize} rows) of \`${path}\``,
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
      `**Chart "${title || chartType}"** generated successfully. Type: ${chartType}.`,
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

  const testDescriptions: Record<string, string> = {
    t_test: 'One-Sample t-Test',
    correlation: "Pearson's Correlation",
    chi_square: 'Chi-Square Goodness-of-Fit',
    anova: 'One-Way ANOVA (F-Test)',
    mann_whitney: 'Mann-Whitney U Test',
    ks_test: 'Kolmogorov-Smirnov Test',
  }

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
    const testName = testDescriptions[testType] || testType
    const lines = [
      `**${testName}**`,
      '',
      hypothesis ? `H₀: ${hypothesis}` : '',
      `Test statistic: ${r.statistic.toFixed(4)}`,
      `P-value: ${r.pValue < 0.001 ? r.pValue.toExponential(4) : r.pValue.toFixed(6)}`,
      `Significance level (α): ${alpha}`,
      `Result: ${r.significant ? '❌ Reject H₀ (statistically significant)' : '✅ Fail to reject H₀ (not significant)'}`,
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

async function edaAuto(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const path = args.path as string
  const targetColumns = args.target_columns as string[] | undefined
  const sampleSize = (args.sample_size as number) || 10000

  if (!path) return dataError('File path is required')

  try {
    const result = await api.data.eda({
      path,
      targetColumns,
      sampleSize,
    }) as {
      success: boolean
      data?: Record<string, unknown>
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'EDA analysis failed')
    }

    const data = result.data || {}
    const overview = data.overview as { totalRows: number; totalColumns: number; targetColumns: string[] } | undefined
    const colProfiles = data.columns as Record<string, Record<string, unknown>> | undefined
    const correlations = data.correlations as Array<{ x: string; y: string; r: number }> | undefined
    const recommendations = data.recommendations as string[] | undefined

    const lines: string[] = [
      `**Automated EDA Report** for \`${path}\``,
      '',
      `📊 **Overview**: ${overview?.totalRows ?? '?'} rows × ${overview?.totalColumns ?? '?'} columns`,
      `Analyzed columns: ${overview?.targetColumns?.join(', ') ?? 'all'}`,
      '',
    ]

    if (colProfiles) {
      lines.push('### Column Profiles')
      lines.push('')
      lines.push('| Column | Type | Missing | Key Stats |')
      lines.push('| --- | --- | --- | --- |')
      for (const [col, profile] of Object.entries(colProfiles)) {
        const missing = `${profile.missingCount ?? 0} (${(profile.missingPercent as number)?.toFixed(1) ?? 0}%)`
        let stats = ''
        if (profile.type === 'number') {
          stats = `min=${profile.min ?? '-'}, mean=${profile.mean ?? '-'}, max=${profile.max ?? '-'}, stdDev=${profile.stdDev ?? '-'}`
        } else {
          const topVals = Array.isArray(profile.topValues)
            ? (profile.topValues as Array<{ value: string; count: number }>).slice(0, 3).map(v => `${v.value}(${v.count})`).join(', ')
            : '-'
          stats = `unique=${profile.uniqueCount ?? '-'}, top: ${topVals}`
        }
        lines.push(`| ${col} | ${profile.type} | ${missing} | ${stats} |`)
      }
      lines.push('')
    }

    if (correlations && correlations.length > 0) {
      lines.push('### Correlation Matrix (Pearson r)')
      lines.push('')
      const strongCorr = correlations.filter(c => Math.abs(c.r) > 0.5)
      if (strongCorr.length > 0) {
        lines.push('| Variable X | Variable Y | Correlation | Strength |')
        lines.push('| --- | --- | --- | --- |')
        for (const c of strongCorr) {
          const strength = Math.abs(c.r) > 0.8 ? '🔴 Strong' : Math.abs(c.r) > 0.6 ? '🟡 Moderate' : '🟢 Weak'
          lines.push(`| ${c.x} | ${c.y} | ${c.r.toFixed(3)} | ${strength} |`)
        }
      } else {
        lines.push('No significant correlations (|r| > 0.5) detected.')
      }
      lines.push('')
    }

    if (recommendations && recommendations.length > 0) {
      lines.push('### 💡 Recommendations')
      lines.push('')
      for (const rec of recommendations) {
        lines.push(`- ${rec}`)
      }
      lines.push('')
    }

    return dataSuccess(lines.join('\n'), data)
  } catch (err) {
    return dataError(`EDA analysis error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function dataClean(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const source = args.source as string
  const operations = args.operations as Array<{ type: string; config: Record<string, unknown> }>
  const output = args.output as string | undefined

  if (!source) return dataError('Source file path is required')
  if (!operations?.length) return dataError('At least one cleaning operation is required')

  try {
    const result = await api.data.cleanData({
      source,
      operations,
      output,
    }) as {
      success: boolean
      data?: Record<string, unknown>
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'Data cleaning failed')
    }

    const data = result.data || {}
    const lines = [
      `**Data Cleaning Pipeline** completed for \`${source}\``,
      '',
      `- Original rows: ${data.originalRows ?? '?'}`,
      `- Result rows: ${data.resultRows ?? '?'}`,
      `- Rows affected: ${((data.originalRows as number) ?? 0) - ((data.resultRows as number) ?? 0)}`,
      `- Output: \`${data.outputPath ?? output ?? 'source_cleaned.csv'}\``,
      '',
      '### Operations Applied',
      '',
    ]

    const appliedOps = data.operationsApplied as string[] | undefined
    if (appliedOps?.length) {
      for (const op of appliedOps) {
        lines.push(`1. ✅ ${op}`)
      }
    } else {
      lines.push('No operations were applied.')
    }

    return dataSuccess(lines.join('\n'), data)
  } catch (err) {
    return dataError(`Data cleaning error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function schemaBrowse(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const connectionId = args.connection_id as string
  const filter = args.filter as string | undefined

  if (!connectionId) return dataError('connection_id is required')

  try {
    const result = await api.data.browseSchema({
      connectionId,
      filter,
    }) as {
      success: boolean
      data?: Record<string, unknown>
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'Schema browsing failed')
    }

    const data = result.data || {}
    const tables = data.tables as Array<{
      name: string
      columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; defaultValue?: string }>
    }> | undefined
    const totalTables = data.totalTables as number | undefined

    const lines = [
      `**Database Schema** for connection \`${connectionId}\`${filter ? ` (filter: "${filter}")` : ''}`,
      '',
      `Total tables: ${totalTables ?? tables?.length ?? 0}`,
      '',
    ]

    if (tables?.length) {
      for (const table of tables) {
        lines.push(`### 📋 ${table.name}`)
        lines.push('')
        lines.push('| Column | Type | Nullable | Primary Key | Default |')
        lines.push('| --- | --- | --- | --- | --- |')
        for (const col of table.columns) {
          lines.push(`| ${col.name} | ${col.type} | ${col.nullable ? '✓' : '✗'} | ${col.primaryKey ? '🔑' : ''} | ${col.defaultValue ?? '-'} |`)
        }
        lines.push('')
      }
    } else {
      lines.push('No tables found matching the criteria.')
    }

    return dataSuccess(lines.join('\n'), data)
  } catch (err) {
    return dataError(`Schema browsing error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function queryHistory(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const limit = (args.limit as number) || 20
  const connectionId = args.connection_id as string | undefined

  try {
    const result = await api.data.getQueryHistory({
      limit,
      connectionId,
    }) as {
      success: boolean
      data?: Array<Record<string, unknown>>
    }

    const history = result.data || []

    if (history.length === 0) {
      return dataSuccess('**Query History** is empty. No queries have been executed yet.', { history: [] })
    }

    const lines = [
      `**Query History** (${history.length} entries${connectionId ? `, filtered by: ${connectionId}` : ''})`,
      '',
      '| # | Query | Connection | Time | Rows | Status | Timestamp |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    ]

    history.forEach((entry, idx) => {
      const query = String(entry.query ?? '').length > 60
        ? String(entry.query).slice(0, 57) + '...'
        : String(entry.query ?? '')
      const escapedQuery = query.replace(/\|/g, '\\|')
      const execTime = entry.executionTime != null ? `${entry.executionTime}ms` : '-'
      const rowCount = entry.rowCount != null ? String(entry.rowCount) : '-'
      const status = entry.success ? '✅' : '❌'
      const timestamp = entry.timestamp ? new Date(entry.timestamp as number).toLocaleString() : '-'
      lines.push(`| ${idx + 1} | ${escapedQuery} | ${entry.connectionId ?? '-'} | ${execTime} | ${rowCount} | ${status} | ${timestamp} |`)
    })

    return dataSuccess(lines.join('\n'), { history })
  } catch (err) {
    return dataError(`Query history error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function exportReport(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  const title = args.title as string
  const sections = args.sections as Array<{ type: string; title: string; content: string }>
  const format = args.format as string
  const outputPath = args.output_path as string | undefined

  if (!title) return dataError('Report title is required')
  if (!sections?.length) return dataError('At least one report section is required')
  if (!format) return dataError('Export format is required (markdown or html)')

  try {
    const result = await api.data.exportReport({
      title,
      sections,
      format,
      outputPath,
    }) as {
      success: boolean
      data?: Record<string, unknown>
      error?: string
    }

    if (!result.success) {
      return dataError(result.error || 'Report export failed')
    }

    const data = result.data || {}
    const lines = [
      `**Report Exported Successfully**`,
      '',
      `- Title: ${title}`,
      `- Format: ${format.toUpperCase()}`,
      `- Sections: ${sections.length}`,
      `- Output: \`${data.path ?? 'N/A'}\``,
      `- Size: ${data.size ? `${(data.size as number / 1024).toFixed(1)}KB` : 'N/A'}`,
    ]

    return dataSuccess(lines.join('\n'), data)
  } catch (err) {
    return dataError(`Report export error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function autoInsight(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  try {
    const path = args.path as string
    const targetColumns = (args.target_columns as string[]) || []
    const maxInsights = (args.max_insights as number) || 10

    const edaResult = await api.data.eda({ path, targetColumns, sampleSize: 10000 })
    if (!edaResult.success || !edaResult.data) {
      return dataError(`Auto-insight failed: ${edaResult.error || 'EDA analysis returned no data'}`)
    }

    const eda = edaResult.data as Record<string, unknown>
    const insights: Array<{ severity: string; category: string; title: string; detail: string; recommendation: string }> = []

    const columns = (eda.columns as Array<Record<string, unknown>>) || []
    for (const col of columns) {
      const colName = col.name as string
      const colType = col.type as string
      const nullPct = (col.nullPercent as number) || 0
      const uniquePct = (col.uniquePercent as number) || 0

      if (nullPct > 30) {
        insights.push({
          severity: 'high',
          category: 'data_quality',
          title: `High Missing Rate: ${colName}`,
          detail: `${colName} has ${nullPct.toFixed(1)}% missing values, which may bias analysis results.`,
          recommendation: `Consider imputation (mean/median for numeric, mode for categorical) or excluding this column from critical analyses.`,
        })
      }

      if (colType === 'number') {
        const stats = col.stats as Record<string, number> | undefined
        if (stats) {
          const skewness = stats.skewness || 0
          if (Math.abs(skewness) > 2) {
            insights.push({
              severity: 'medium',
              category: 'distribution',
              title: `High Skewness: ${colName}`,
              detail: `${colName} has skewness ${skewness.toFixed(2)}, indicating a highly asymmetric distribution.`,
              recommendation: `Consider log or Box-Cox transformation before using in parametric tests or linear models.`,
            })
          }

          const outlierPct = stats.outlierPercent || 0
          if (outlierPct > 5) {
            insights.push({
              severity: 'medium',
              category: 'anomaly',
              title: `Significant Outliers: ${colName}`,
              detail: `${colName} has ${outlierPct.toFixed(1)}% outliers beyond 1.5×IQR, which may distort averages.`,
              recommendation: `Investigate outliers for data entry errors. Consider robust statistics (median, IQR) or Winsorization.`,
            })
          }

          const cv = stats.mean ? stats.stddev / stats.mean : 0
          if (cv > 1.5) {
            insights.push({
              severity: 'low',
              category: 'distribution',
              title: `High Variability: ${colName}`,
              detail: `${colName} has coefficient of variation ${cv.toFixed(2)}, indicating extreme spread relative to the mean.`,
              recommendation: `Segment analysis by relevant groups to reduce within-group variance.`,
            })
          }
        }
      }

      if (colType === 'string' && uniquePct > 95) {
        insights.push({
          severity: 'low',
          category: 'data_quality',
          title: `Near-Unique Column: ${colName}`,
          detail: `${colName} has ${uniquePct.toFixed(1)}% unique values, likely an ID or free-text field.`,
          recommendation: `This column may not be useful for aggregation. Consider excluding from grouping operations.`,
        })
      }
    }

    const correlations = (eda.correlations as Array<{ col1: string; col2: string; r: number }>) || []
    for (const corr of correlations) {
      if (Math.abs(corr.r) > 0.8) {
        insights.push({
          severity: 'medium',
          category: 'correlation',
          title: `Strong Correlation: ${corr.col1} ↔ ${corr.col2}`,
          detail: `Pearson r = ${corr.r.toFixed(3)} between ${corr.col1} and ${corr.col2}. Potential multicollinearity risk.`,
          recommendation: `Avoid using both in regression models simultaneously. Consider PCA or dropping one variable.`,
        })
      } else if (Math.abs(corr.r) > 0.5 && Math.abs(corr.r) <= 0.8) {
        insights.push({
          severity: 'low',
          category: 'correlation',
          title: `Moderate Correlation: ${corr.col1} ↔ ${corr.col2}`,
          detail: `Pearson r = ${corr.r.toFixed(3)}. These variables share a meaningful linear relationship.`,
          recommendation: `Explore this relationship with scatter plots and consider it in predictive modeling.`,
        })
      }
    }

    insights.sort((a, b) => {
      const sev: Record<string, number> = { high: 0, medium: 1, low: 2 }
      return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2)
    })

    const topInsights = insights.slice(0, maxInsights)

    const lines = [
      `## 🔍 Auto-Insight Report`,
      '',
      `**Data Source**: ${path}`,
      `**Total Insights Found**: ${insights.length} (showing top ${topInsights.length})`,
      '',
    ]

    for (let i = 0; i < topInsights.length; i++) {
      const ins = topInsights[i]
      const icon = ins.severity === 'high' ? '🔴' : ins.severity === 'medium' ? '🟡' : '🟢'
      lines.push(`### ${icon} Insight #${i + 1}: ${ins.title}`)
      lines.push(`- **Category**: ${ins.category}`)
      lines.push(`- **Detail**: ${ins.detail}`)
      lines.push(`- **Recommendation**: ${ins.recommendation}`)
      lines.push('')
    }

    if (insights.length === 0) {
      lines.push('No significant insights detected. The data appears well-structured with no major anomalies.')
    }

    return dataSuccess(lines.join('\n'), { totalInsights: insights.length, insights: topInsights })
  } catch (err) {
    return dataError(`Auto-insight error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function analysisTemplate(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  try {
    const template = args.template as string
    const path = args.path as string
    const config = (args.config as Record<string, string>) || {}

    const csvResult = await api.data.analyzeCsv({ path, analysisType: 'stats', sampleSize: 10000 })
    if (!csvResult.success || !csvResult.data) {
      return dataError(`Template analysis failed: cannot read data from ${path}`)
    }

    const stats = (csvResult.data as Record<string, unknown>).statistics as Record<string, Record<string, unknown>>
    if (!stats) {
      return dataError('Template analysis failed: no statistics available')
    }

    const lines = [`## 📊 ${template.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Report`, '']

    switch (template) {
      case 'sales_analysis': {
        const revenueCol = config.revenue_col || Object.keys(stats).find(k => /revenue|sales|amount|total|price/i.test(k))
        const dateCol = config.date_col || Object.keys(stats).find(k => /date|time|period/i.test(k))
        const productCol = config.product_col || Object.keys(stats).find(k => /product|item|sku|category/i.test(k))

        lines.push('### Revenue Overview')
        if (revenueCol && stats[revenueCol]) {
          const rs = stats[revenueCol]
          lines.push(`- **Revenue Column**: ${revenueCol}`)
          lines.push(`- **Total**: ${((rs.sum as number) || 0).toLocaleString()}`)
          lines.push(`- **Average**: ${((rs.mean as number) || 0).toFixed(2)}`)
          lines.push(`- **Median**: ${((rs.median as number) || 0).toFixed(2)}`)
          lines.push(`- **Std Dev**: ${((rs.stddev as number) || 0).toFixed(2)}`)
        } else {
          lines.push('- ⚠️ No revenue column detected. Specify revenue_col in config.')
        }

        lines.push('')
        lines.push('### Temporal Analysis')
        if (dateCol) {
          lines.push(`- **Date Column**: ${dateCol}`)
          lines.push('- Use `sql_query` or `data_transform` with groupBy by date for trend analysis')
        } else {
          lines.push('- ⚠️ No date column detected. Specify date_col in config.')
        }

        lines.push('')
        lines.push('### Product Analysis')
        if (productCol) {
          lines.push(`- **Product Column**: ${productCol}`)
          lines.push('- Use `data_transform` aggregate with groupBy on product column for top products')
        } else {
          lines.push('- ⚠️ No product column detected. Specify product_col in config.')
        }

        lines.push('')
        lines.push('### Recommended Next Steps')
        lines.push('1. Run `data_transform` with aggregate to compute revenue by product/date')
        lines.push('2. Run `chart_generate` with line chart for revenue trends')
        lines.push('3. Run `statistical_test` with correlation to find revenue drivers')
        break
      }

      case 'churn_analysis': {
        const statusCol = config.status_col || Object.keys(stats).find(k => /status|churn|retained|active/i.test(k))
        const customerCol = config.customer_col || Object.keys(stats).find(k => /customer|user|client|account/i.test(k))

        lines.push('### Churn Overview')
        if (statusCol) {
          lines.push(`- **Status Column**: ${statusCol}`)
          const cs = stats[statusCol]
          if (cs.topValues) {
            lines.push(`- **Distribution**: ${(cs.topValues as string[]).join(', ')}`)
          }
          lines.push('- Use `data_transform` with aggregate to compute churn rate by period')
        } else {
          lines.push('- ⚠️ No status/churn column detected. Specify status_col in config.')
        }

        lines.push('')
        lines.push('### Customer Segments')
        if (customerCol) {
          lines.push(`- **Customer Column**: ${customerCol}`)
          lines.push('- Use `data_transform` with aggregate to identify at-risk segments')
        }

        lines.push('')
        lines.push('### Recommended Next Steps')
        lines.push('1. Compute churn rate: `data_transform` aggregate groupBy period')
        lines.push('2. Identify risk factors: `statistical_test` correlation between features and churn')
        lines.push('3. Segment analysis: `data_transform` aggregate groupBy customer segments')
        break
      }

      case 'a_b_test': {
        const groupCol = config.group_col || Object.keys(stats).find(k => /group|variant|treatment|arm/i.test(k))
        const metricCol = config.metric_col || Object.keys(stats).find(k => {
          const s = stats[k]
          return s.type === 'number' && !/id|index/i.test(k)
        })

        lines.push('### A/B Test Analysis')
        if (groupCol && metricCol) {
          lines.push(`- **Group Column**: ${groupCol}`)
          lines.push(`- **Metric Column**: ${metricCol}`)
          const ms = stats[metricCol]
          lines.push(`- **Overall Mean**: ${((ms.mean as number) || 0).toFixed(4)}`)
          lines.push(`- **Overall Std Dev**: ${((ms.stddev as number) || 0).toFixed(4)}`)
          lines.push('')
          lines.push('### Next Steps')
          lines.push('1. Run `sql_query` to compute mean by group')
          lines.push('2. Run `statistical_test` t_test to check significance')
          lines.push('3. Run `chart_generate` boxplot to visualize group distributions')
        } else {
          lines.push('- ⚠️ Could not auto-detect group/metric columns. Specify group_col and metric_col in config.')
        }
        break
      }

      case 'cohort_analysis': {
        const dateCol = config.date_col || Object.keys(stats).find(k => /date|time|period/i.test(k))
        const customerCol = config.customer_col || Object.keys(stats).find(k => /customer|user|client/i.test(k))

        lines.push('### Cohort Analysis')
        if (dateCol && customerCol) {
          lines.push(`- **Date Column**: ${dateCol}`)
          lines.push(`- **Customer Column**: ${customerCol}`)
          lines.push('')
          lines.push('### Next Steps')
          lines.push('1. Run `sql_query` to create cohort groups by first activity date')
          lines.push('2. Run `data_transform` aggregate to compute retention by cohort')
          lines.push('3. Run `chart_generate` heatmap to visualize retention matrix')
        } else {
          lines.push('- ⚠️ Could not auto-detect date/customer columns. Specify date_col and customer_col in config.')
        }
        break
      }

      default:
        lines.push(`Unknown template: ${template}`)
    }

    return dataSuccess(lines.join('\n'), { template, path })
  } catch (err) {
    return dataError(`Analysis template error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function predictAnalysis(args: Record<string, unknown>, _ctx: ToolExecutionContext): Promise<ToolExecutionResult> {
  try {
    const path = args.path as string
    const dateColumn = args.date_column as string
    const valueColumn = args.value_column as string
    const method = args.method as string
    const forecastPeriods = (args.forecast_periods as number) || 5

    const csvResult = await api.data.analyzeCsv({ path, analysisType: 'sample', sampleSize: 10000 })
    if (!csvResult.success || !csvResult.data) {
      return dataError(`Prediction failed: cannot read data from ${path}`)
    }

    const data = csvResult.data as { columns: string[]; rows: Record<string, string>[] }
    if (!data.columns.includes(dateColumn) || !data.columns.includes(valueColumn)) {
      return dataError(`Prediction failed: columns "${dateColumn}" or "${valueColumn}" not found. Available: ${data.columns.join(', ')}`)
    }

    const values = data.rows
      .map(r => parseFloat(r[valueColumn]))
      .filter(v => !isNaN(v))

    if (values.length < 5) {
      return dataError(`Prediction failed: need at least 5 data points, got ${values.length}`)
    }

    const n = values.length
    const forecasts: number[] = []
    const lowerBound: number[] = []
    const upperBound: number[] = []
    let methodDesc = ''

    switch (method) {
      case 'moving_average': {
        const window = Math.min(Math.max(3, Math.floor(n / 5)), n - 1)
        methodDesc = `Moving Average (window=${window})`
        const lastWindow = values.slice(-window)
        const ma = lastWindow.reduce((a, b) => a + b, 0) / window
        const residuals = values.slice(window).map((v, i) => v - (values.slice(i, i + window).reduce((a, b) => a + b, 0) / window))
        const se = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length)
        for (let i = 0; i < forecastPeriods; i++) {
          forecasts.push(ma)
          lowerBound.push(ma - 1.96 * se * Math.sqrt(i + 1))
          upperBound.push(ma + 1.96 * se * Math.sqrt(i + 1))
        }
        break
      }

      case 'linear_regression': {
        methodDesc = 'Linear Regression'
        const xMean = (n - 1) / 2
        const yMean = values.reduce((a, b) => a + b, 0) / n
        let ssXY = 0, ssXX = 0
        for (let i = 0; i < n; i++) {
          ssXY += (i - xMean) * (values[i] - yMean)
          ssXX += (i - xMean) ** 2
        }
        const slope = ssXX > 0 ? ssXY / ssXX : 0
        const intercept = yMean - slope * xMean
        const residuals = values.map((v, i) => v - (intercept + slope * i))
        const se = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (n - 2))
        const trendDir = slope > 0 ? '📈 Upward' : slope < 0 ? '📉 Downward' : '➡️ Flat'
        for (let i = 0; i < forecastPeriods; i++) {
          const pred = intercept + slope * (n + i)
          forecasts.push(pred)
          lowerBound.push(pred - 1.96 * se * Math.sqrt(1 + 1 / n + ((n + i - xMean) ** 2) / ssXX))
          upperBound.push(pred + 1.96 * se * Math.sqrt(1 + 1 / n + ((n + i - xMean) ** 2) / ssXX))
        }
        methodDesc += ` | Trend: ${trendDir} | Slope: ${slope.toFixed(4)} | Intercept: ${intercept.toFixed(4)}`
        break
      }

      case 'exponential_smoothing': {
        const alpha = 0.3
        methodDesc = `Exponential Smoothing (α=${alpha})`
        let s = values[0]
        for (let i = 1; i < n; i++) {
          s = alpha * values[i] + (1 - alpha) * s
        }
        const residuals = values.map((v, i) => {
          let smooth = values[0]
          for (let j = 1; j <= i; j++) smooth = alpha * values[j] + (1 - alpha) * smooth
          return v - smooth
        })
        const se = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n)
        for (let i = 0; i < forecastPeriods; i++) {
          forecasts.push(s)
          lowerBound.push(s - 1.96 * se * Math.sqrt(i + 1))
          upperBound.push(s + 1.96 * se * Math.sqrt(i + 1))
        }
        break
      }

      default:
        return dataError(`Unknown prediction method: ${method}. Supported: moving_average, linear_regression, exponential_smoothing`)
    }

    const lines = [
      `## 📈 Predictive Analysis Report`,
      '',
      `**Data Source**: ${path}`,
      `**Target Column**: ${valueColumn}`,
      `**Time Column**: ${dateColumn}`,
      `**Method**: ${methodDesc}`,
      `**Historical Data Points**: ${n}`,
      `**Forecast Periods**: ${forecastPeriods}`,
      '',
      `### Historical Summary`,
      `- **Last Value**: ${values[n - 1].toFixed(2)}`,
      `- **Mean**: ${(values.reduce((a, b) => a + b, 0) / n).toFixed(2)}`,
      `- **Min**: ${Math.min(...values).toFixed(2)}`,
      `- **Max**: ${Math.max(...values).toFixed(2)}`,
      '',
      `### Forecast Results`,
      '',
      `| Period | Predicted | 95% CI Lower | 95% CI Upper |`,
      `|--------|-----------|-------------|-------------|`,
    ]

    for (let i = 0; i < forecastPeriods; i++) {
      lines.push(`| ${i + 1} | ${forecasts[i].toFixed(2)} | ${lowerBound[i].toFixed(2)} | ${upperBound[i].toFixed(2)} |`)
    }

    lines.push('')
    lines.push('### Recommendations')
    if (method === 'linear_regression') {
      lines.push('- Linear regression assumes a constant trend. Check residuals for patterns.')
      lines.push('- If the trend is non-linear, consider exponential smoothing or polynomial regression.')
    } else if (method === 'moving_average') {
      lines.push('- Moving average is best for stable data without strong trends.')
      lines.push('- For trending data, use linear regression or exponential smoothing.')
    } else {
      lines.push('- Exponential smoothing adapts to recent changes. Higher α = more responsive.')
      lines.push('- For seasonal data, consider Holt-Winters method (not yet implemented).')
    }
    lines.push('- Use `chart_generate` with line chart to visualize the forecast alongside historical data.')

    return dataSuccess(lines.join('\n'), {
      method,
      forecasts,
      lowerBound,
      upperBound,
      historicalCount: n,
    })
  } catch (err) {
    return dataError(`Prediction error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const dataAnalystExecutors = {
  sql_query: sqlQuery,
  data_transform: dataTransform,
  csv_analyze: csvAnalyze,
  chart_generate: chartGenerate,
  statistical_test: statisticalTest,
  rest_api: restApi,
  eda_auto: edaAuto,
  data_clean: dataClean,
  schema_browse: schemaBrowse,
  query_history: queryHistory,
  export_report: exportReport,
  auto_insight: autoInsight,
  analysis_template: analysisTemplate,
  predict_analysis: predictAnalysis,
}
