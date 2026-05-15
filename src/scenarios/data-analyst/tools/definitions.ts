/**
 * 数据分析师场景 - 工具定义
 *
 * 定义 sql_query、data_transform、csv_analyze、chart_generate、statistical_test、rest_api
 * 等工具的名称、描述、参数 schema。
 */

import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import type { ToolDefinition } from '@protocols'
import { dataAnalystExecutors } from './toolExecutors'

const SQL_QUERY: ToolDefinition = {
  name: 'sql_query',
  description: 'Execute a read-only SQL query (SELECT) against a connected database. Destructive operations (DROP, INSERT, UPDATE, DELETE, ALTER, etc.) are blocked for safety. Results are returned as formatted tables with execution time.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The SQL SELECT query to execute. Only read-only queries are allowed.' },
      connection_id: { type: 'string', description: 'The database connection ID to use. Use "default" for the primary connection.' },
      limit: { type: 'number', description: 'Maximum number of rows to return (default: 100, max: 10000)' },
    },
    required: ['query'],
  },
}

const DATA_TRANSFORM: ToolDefinition = {
  name: 'data_transform',
  description: 'Transform CSV data by applying operations: filter (with eq/neq/gt/lt/contains/in operators), sort, aggregate (sum/avg/count/min/max/stddev), pivot (wide table), merge (join two CSVs), reshape (wide↔long). Results are saved to a new file.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'The transformation operation to apply', enum: ['filter', 'sort', 'aggregate', 'pivot', 'merge', 'reshape'] },
      source: { type: 'string', description: 'Source CSV file path' },
      config: { type: 'object', description: 'Operation-specific configuration. Filter: {column, operator, value}. Sort: {column, order}. Aggregate: {groupBy, metric, column}. Pivot: {rowField, colField, valueField, aggFunc}. Merge: {secondSource, joinType, leftKey, rightKey}. Reshape: {direction, idVars, valueVars}.', properties: {} },
      output: { type: 'string', description: 'Output file path (optional, defaults to source_transformed.csv)' },
    },
    required: ['operation', 'source', 'config'],
  },
}

const CSV_ANALYZE: ToolDefinition = {
  name: 'csv_analyze',
  description: 'Analyze CSV files with various analysis types. Supports files up to 512MB. Schema detection identifies column types. Stats computes mean/median/std/IQR. Quality reports missing values, outliers, and duplicates with a 0-100 score.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the CSV file to analyze (max 512MB)' },
      analysis_type: { type: 'string', description: 'Type of analysis to perform', enum: ['schema', 'stats', 'quality', 'preview', 'sample'] },
      sample_size: { type: 'number', description: 'Number of rows to sample for preview/analysis (default: 20)' },
    },
    required: ['path', 'analysis_type'],
  },
}

const CHART_GENERATE: ToolDefinition = {
  name: 'chart_generate',
  description: 'Generate interactive charts and visualizations. Supports bar, line, pie, scatter, area, heatmap, and other chart types via ECharts.',
  parameters: {
    type: 'object',
    properties: {
      chart_type: { type: 'string', description: 'Type of chart to generate', enum: ['bar', 'line', 'pie', 'scatter', 'area', 'heatmap', 'radar', 'treemap', 'boxplot', 'histogram'] },
      data: { type: 'object', description: 'Chart data as an array of objects or structured data', properties: {} },
      title: { type: 'string', description: 'Chart title' },
      x_label: { type: 'string', description: 'X-axis label' },
      y_label: { type: 'string', description: 'Y-axis label' },
      format: { type: 'string', description: 'Output format (default: html)', enum: ['html', 'png', 'svg'] },
    },
    required: ['chart_type', 'data'],
  },
}

const STATISTICAL_TEST: ToolDefinition = {
  name: 'statistical_test',
  description: 'Perform statistical hypothesis tests: t_test (one-sample t-test), correlation (Pearson r), chi_square (goodness-of-fit), anova (one-way F-test), mann_whitney (non-parametric U-test), ks_test (two-sample Kolmogorov-Smirnov). Returns test statistic, p-value, and conclusion.',
  parameters: {
    type: 'object',
    properties: {
      test_type: { type: 'string', description: 'Type of statistical test', enum: ['t_test', 'correlation', 'chi_square', 'anova', 'mann_whitney', 'ks_test'] },
      data: { type: 'object', description: 'Test data as arrays of numbers keyed by variable name. t_test needs 1 array, correlation/anova/mann_whitney/ks_test need 2+ arrays, chi_square needs 1 array of observed values.', properties: {} },
      alpha: { type: 'number', description: 'Significance level (default: 0.05)' },
      hypothesis: { type: 'string', description: 'Null hypothesis description' },
    },
    required: ['test_type', 'data'],
  },
}

const REST_API: ToolDefinition = {
  name: 'rest_api',
  description: 'Make HTTP REST API requests to fetch data from external services. Only HTTP/HTTPS protocols allowed. Requests to private/internal IP addresses are blocked (SSRF protection). Supports GET, POST, PUT, DELETE methods with bearer, API-key, or basic auth.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The HTTPS/HTTP URL to request (private IPs blocked)' },
      method: { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      headers: { type: 'object', description: 'Request headers as key-value pairs', properties: {} },
      body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      auth_type: { type: 'string', description: 'Authentication type (default: none)', enum: ['none', 'bearer', 'api-key', 'basic'] },
      auth_token: { type: 'string', description: 'Authentication token or credentials' },
      auth_header_name: { type: 'string', description: 'Header name for API key authentication (default: X-API-Key)' },
    },
    required: ['url'],
  },
}

const EDA_AUTO: ToolDefinition = {
  name: 'eda_auto',
  description: 'Automated Exploratory Data Analysis. Performs comprehensive profiling of a CSV file: schema detection, statistical summaries, missing value analysis, correlation matrix, outlier detection, and generates actionable recommendations.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the CSV file to profile' },
      target_columns: { type: 'array', items: { type: 'string' }, description: 'Specific columns to analyze (optional, defaults to all columns)' },
      sample_size: { type: 'number', description: 'Max rows to sample for analysis (default: 10000)' },
    },
    required: ['path'],
  },
}

const DATA_CLEAN: ToolDefinition = {
  name: 'data_clean',
  description: 'Clean and preprocess CSV data using a pipeline of operations. Supports: drop_null (remove rows with missing values), fill_null (impute with mean/median/mode/constant/forward_fill), remove_duplicates, remove_outliers (IQR method), rename_column, drop_column, change_type. Multiple operations can be chained.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source CSV file path' },
      operations: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, config: { type: 'object' } } }, description: 'Array of cleaning operations to apply in order. Each operation: {type: "drop_null|fill_null|remove_duplicates|remove_outliers|rename_column|drop_column|change_type", config: {...}}' },
      output: { type: 'string', description: 'Output file path (optional, defaults to source_cleaned.csv)' },
    },
    required: ['source', 'operations'],
  },
}

const SCHEMA_BROWSE: ToolDefinition = {
  name: 'schema_browse',
  description: 'Browse the schema of a connected database. Lists all tables with their columns, data types, nullability, primary keys, and default values. Supports filtering tables by name pattern.',
  parameters: {
    type: 'object',
    properties: {
      connection_id: { type: 'string', description: 'The database connection ID to browse' },
      filter: { type: 'string', description: 'Optional table name filter (case-insensitive substring match)' },
    },
    required: ['connection_id'],
  },
}

const QUERY_HISTORY: ToolDefinition = {
  name: 'query_history',
  description: 'View SQL query execution history. Shows previously executed queries with timestamps, execution times, row counts, and success status. Useful for reviewing and reusing past queries.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximum number of history entries to return (default: 20)' },
      connection_id: { type: 'string', description: 'Filter by connection ID (optional)' },
    },
    required: [],
  },
}

const EXPORT_REPORT: ToolDefinition = {
  name: 'export_report',
  description: 'Export an analysis report to Markdown or HTML format. Combines multiple sections (text, charts, tables) into a formatted document. Supports embedding chart HTML and markdown content.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Report title' },
      sections: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', description: 'Section type: text, chart, table' }, title: { type: 'string' }, content: { type: 'string' } } }, description: 'Report sections. Each section: {type: "text|chart|table", title: "...", content: "markdown or HTML"}' },
      format: { type: 'string', description: 'Export format', enum: ['markdown', 'html'] },
      output_path: { type: 'string', description: 'Output file path (optional)' },
    },
    required: ['title', 'sections', 'format'],
  },
}

const AUTO_INSIGHT: ToolDefinition = {
  name: 'auto_insight',
  description: 'Automatically discover insights from data including anomalies, trends, correlations, and distribution patterns. Generates human-readable insight cards with severity levels and actionable recommendations.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the CSV file or database connection ID prefixed with "db:"' },
      target_columns: { type: 'array', items: { type: 'string' }, description: 'Specific columns to focus on (optional, analyzes all numeric columns if omitted)' },
      max_insights: { type: 'number', description: 'Maximum number of insights to return (default: 10)' },
    },
    required: ['path'],
  },
}

const ANALYSIS_TEMPLATE: ToolDefinition = {
  name: 'analysis_template',
  description: 'Apply a pre-built analysis template to data. Templates include: sales_analysis (revenue trends, top products, customer segments), churn_analysis (retention rates, risk factors, at-risk segments), a_b_test (significance, effect size, confidence intervals), cohort_analysis (retention by cohort, lifecycle patterns).',
  parameters: {
    type: 'object',
    properties: {
      template: { type: 'string', description: 'Template name', enum: ['sales_analysis', 'churn_analysis', 'a_b_test', 'cohort_analysis'] },
      path: { type: 'string', description: 'Path to the CSV file' },
      config: { type: 'object', description: 'Template-specific column mapping. Sales: {date_col, revenue_col, product_col, customer_col}. Churn: {date_col, customer_col, status_col}. ABTest: {group_col, metric_col}. Cohort: {date_col, customer_col, event_col}.', properties: {} },
    },
    required: ['template', 'path'],
  },
}

const PREDICT_ANALYSIS: ToolDefinition = {
  name: 'predict_analysis',
  description: 'Perform simple predictive analysis using moving averages, linear regression, or exponential smoothing. Generates forecasts with confidence intervals. Best for time-series data with clear trends.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the CSV file' },
      date_column: { type: 'string', description: 'Column containing dates or sequential indices' },
      value_column: { type: 'string', description: 'Column containing the numeric values to predict' },
      method: { type: 'string', description: 'Forecasting method', enum: ['moving_average', 'linear_regression', 'exponential_smoothing'] },
      forecast_periods: { type: 'number', description: 'Number of future periods to forecast (default: 5)' },
    },
    required: ['path', 'date_column', 'value_column', 'method'],
  },
}

const DATA_ANALYST_TOOLS: ScenarioToolDefinition[] = [
  { name: 'sql_query', definition: SQL_QUERY, executor: dataAnalystExecutors.sql_query },
  { name: 'data_transform', definition: DATA_TRANSFORM, executor: dataAnalystExecutors.data_transform },
  { name: 'csv_analyze', definition: CSV_ANALYZE, executor: dataAnalystExecutors.csv_analyze },
  { name: 'chart_generate', definition: CHART_GENERATE, executor: dataAnalystExecutors.chart_generate },
  { name: 'statistical_test', definition: STATISTICAL_TEST, executor: dataAnalystExecutors.statistical_test },
  { name: 'rest_api', definition: REST_API, executor: dataAnalystExecutors.rest_api },
  { name: 'eda_auto', definition: EDA_AUTO, executor: dataAnalystExecutors.eda_auto },
  { name: 'data_clean', definition: DATA_CLEAN, executor: dataAnalystExecutors.data_clean },
  { name: 'schema_browse', definition: SCHEMA_BROWSE, executor: dataAnalystExecutors.schema_browse },
  { name: 'query_history', definition: QUERY_HISTORY, executor: dataAnalystExecutors.query_history },
  { name: 'export_report', definition: EXPORT_REPORT, executor: dataAnalystExecutors.export_report },
  { name: 'auto_insight', definition: AUTO_INSIGHT, executor: dataAnalystExecutors.auto_insight },
  { name: 'analysis_template', definition: ANALYSIS_TEMPLATE, executor: dataAnalystExecutors.analysis_template },
  { name: 'predict_analysis', definition: PREDICT_ANALYSIS, executor: dataAnalystExecutors.predict_analysis },
]

export default DATA_ANALYST_TOOLS
