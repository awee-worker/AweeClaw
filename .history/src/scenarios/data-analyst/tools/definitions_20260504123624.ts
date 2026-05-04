/**
 * 数据分析师场景 - 工具定义
 *
 * 定义 sql_query、data_transform、csv_analyze、chart_generate、statistical_test、rest_api
 * 等工具的名称、描述、参数 schema。
 */

import type { ScenarioToolDefinition } from '../../types'
import type { ToolDefinition } from '@shared/types'
import { dataAnalystExecutors } from './executors'

const SQL_QUERY: ToolDefinition = {
  name: 'sql_query',
  description: 'Execute a SQL query against a connected database. Supports SELECT, INSERT, UPDATE, DELETE and DDL statements. Results are returned as formatted tables.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The SQL query to execute' },
      connection_id: { type: 'string', description: 'The database connection ID to use. Use "default" for the primary connection.' },
      limit: { type: 'number', description: 'Maximum number of rows to return (default: 100)' },
    },
    required: ['query'],
  },
}

const DATA_TRANSFORM: ToolDefinition = {
  name: 'data_transform',
  description: 'Transform data by applying operations like filter, sort, aggregate, pivot, or merge. Input can be a file path or inline data reference.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'The transformation operation to apply', enum: ['filter', 'sort', 'aggregate', 'pivot', 'merge', 'reshape'] },
      source: { type: 'string', description: 'Source data file path or reference' },
      config: { type: 'object', description: 'Operation-specific configuration (e.g., {column: "age", operator: "gt", value: "18"} for filter)', properties: {} },
      output: { type: 'string', description: 'Output file path (optional, defaults to source_transformed.ext)' },
    },
    required: ['operation', 'source', 'config'],
  },
}

const CSV_ANALYZE: ToolDefinition = {
  name: 'csv_analyze',
  description: 'Analyze CSV/Excel files with various analysis types: schema detection, statistical summary, data quality assessment, or data preview.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the CSV/Excel file to analyze' },
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
  description: 'Perform statistical hypothesis tests including t-test, correlation analysis, chi-square test, and ANOVA.',
  parameters: {
    type: 'object',
    properties: {
      test_type: { type: 'string', description: 'Type of statistical test to perform', enum: ['t_test', 'correlation', 'chi_square', 'anova', 'mann_whitney', 'ks_test'] },
      data: { type: 'object', description: 'Test data as arrays of numbers keyed by variable name', properties: {} },
      alpha: { type: 'number', description: 'Significance level (default: 0.05)' },
      hypothesis: { type: 'string', description: 'Null hypothesis description' },
    },
    required: ['test_type', 'data'],
  },
}

const REST_API: ToolDefinition = {
  name: 'rest_api',
  description: 'Make HTTP REST API requests to fetch data from external services. Supports GET, POST, PUT, DELETE methods with various authentication types.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to request' },
      method: { type: 'string', description: 'HTTP method (default: GET)', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
      headers: { type: 'object', description: 'Request headers as key-value pairs', properties: {} },
      body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      auth_type: { type: 'string', description: 'Authentication type (default: none)', enum: ['none', 'bearer', 'api-key', 'basic', 'oauth2'] },
      auth_token: { type: 'string', description: 'Authentication token or credentials' },
      auth_header_name: { type: 'string', description: 'Header name for API key authentication (default: X-API-Key)' },
    },
    required: ['url'],
  },
}

const DATA_ANALYST_TOOLS: ScenarioToolDefinition[] = [
  { name: 'sql_query', definition: SQL_QUERY, executor: dataAnalystExecutors.sql_query },
  { name: 'data_transform', definition: DATA_TRANSFORM, executor: dataAnalystExecutors.data_transform },
  { name: 'csv_analyze', definition: CSV_ANALYZE, executor: dataAnalystExecutors.csv_analyze },
  { name: 'chart_generate', definition: CHART_GENERATE, executor: dataAnalystExecutors.chart_generate },
  { name: 'statistical_test', definition: STATISTICAL_TEST, executor: dataAnalystExecutors.statistical_test },
  { name: 'rest_api', definition: REST_API, executor: dataAnalystExecutors.rest_api },
]

export default DATA_ANALYST_TOOLS
