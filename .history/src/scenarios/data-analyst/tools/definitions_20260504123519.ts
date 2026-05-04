/**
 * 数据分析师场景 - 工具定义
 *
 * 定义 sql_query、data_transform、csv_analyze、chart_generate、statistical_test、rest_api
 * 等工具的名称、描述、参数 schema。
 */

import type { ScenarioToolDefinition } from '../../types'
import { dataAnalystExecutors } from './executors'

const DATA_ANALYST_TOOLS: ScenarioToolDefinition[] = [
  {
    name: 'sql_query',
    description: 'Execute a SQL query against a connected database. Supports SELECT, INSERT, UPDATE, DELETE and DDL statements. Results are returned as formatted tables.',
    descriptionZh: '对已连接的数据库执行 SQL 查询。支持 SELECT、INSERT、UPDATE、DELETE 和 DDL 语句。结果以格式化表格返回。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The SQL query to execute',
          descriptionZh: '要执行的 SQL 查询语句',
        },
        connection_id: {
          type: 'string',
          description: 'The database connection ID to use. Use "default" for the primary connection.',
          descriptionZh: '要使用的数据库连接 ID。使用 "default" 表示主连接。',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (default: 100)',
          descriptionZh: '返回的最大行数（默认：100）',
        },
      },
      required: ['query'],
    },
    executor: dataAnalystExecutors.sql_query,
  },
  {
    name: 'data_transform',
    description: 'Transform data by applying operations like filter, sort, aggregate, pivot, or merge. Input can be a file path or inline data reference.',
    descriptionZh: '通过应用筛选、排序、聚合、透视或合并等操作来转换数据。输入可以是文件路径或内联数据引用。',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['filter', 'sort', 'aggregate', 'pivot', 'merge', 'reshape'],
          description: 'The transformation operation to apply',
          descriptionZh: '要应用的转换操作',
        },
        source: {
          type: 'string',
          description: 'Source data file path or reference',
          descriptionZh: '源数据文件路径或引用',
        },
        config: {
          type: 'object',
          description: 'Operation-specific configuration (e.g., {column: "age", operator: "gt", value: "18"} for filter)',
          descriptionZh: '操作特定配置（例如筛选：{column: "age", operator: "gt", value: "18"}）',
        },
        output: {
          type: 'string',
          description: 'Output file path (optional, defaults to source_transformed.ext)',
          descriptionZh: '输出文件路径（可选，默认为 source_transformed.ext）',
        },
      },
      required: ['operation', 'source', 'config'],
    },
    executor: dataAnalystExecutors.data_transform,
  },
  {
    name: 'csv_analyze',
    description: 'Analyze CSV/Excel files with various analysis types: schema detection, statistical summary, data quality assessment, or data preview.',
    descriptionZh: '使用多种分析类型分析 CSV/Excel 文件：模式检测、统计摘要、数据质量评估或数据预览。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the CSV/Excel file to analyze',
          descriptionZh: '要分析的 CSV/Excel 文件路径',
        },
        analysis_type: {
          type: 'string',
          enum: ['schema', 'stats', 'quality', 'preview', 'sample'],
          description: 'Type of analysis to perform',
          descriptionZh: '要执行的分析类型',
        },
        sample_size: {
          type: 'number',
          description: 'Number of rows to sample for preview/analysis (default: 20)',
          descriptionZh: '用于预览/分析的采样行数（默认：20）',
        },
      },
      required: ['path', 'analysis_type'],
    },
    executor: dataAnalystExecutors.csv_analyze,
  },
  {
    name: 'chart_generate',
    description: 'Generate interactive charts and visualizations. Supports bar, line, pie, scatter, area, heatmap, and other chart types via ECharts.',
    descriptionZh: '生成交互式图表和可视化。通过 ECharts 支持柱状图、折线图、饼图、散点图、面积图、热力图等图表类型。',
    parameters: {
      type: 'object',
      properties: {
        chart_type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter', 'area', 'heatmap', 'radar', 'treemap', 'boxplot', 'histogram'],
          description: 'Type of chart to generate',
          descriptionZh: '要生成的图表类型',
        },
        data: {
          type: 'object',
          description: 'Chart data as an array of objects or structured data',
          descriptionZh: '图表数据，对象数组或结构化数据',
        },
        title: {
          type: 'string',
          description: 'Chart title',
          descriptionZh: '图表标题',
        },
        x_label: {
          type: 'string',
          description: 'X-axis label',
          descriptionZh: 'X 轴标签',
        },
        y_label: {
          type: 'string',
          description: 'Y-axis label',
          descriptionZh: 'Y 轴标签',
        },
        format: {
          type: 'string',
          enum: ['html', 'png', 'svg'],
          description: 'Output format (default: html)',
          descriptionZh: '输出格式（默认：html）',
        },
      },
      required: ['chart_type', 'data'],
    },
    executor: dataAnalystExecutors.chart_generate,
  },
  {
    name: 'statistical_test',
    description: 'Perform statistical hypothesis tests including t-test, correlation analysis, chi-square test, and ANOVA.',
    descriptionZh: '执行统计假设检验，包括 t 检验、相关性分析、卡方检验和方差分析。',
    parameters: {
      type: 'object',
      properties: {
        test_type: {
          type: 'string',
          enum: ['t_test', 'correlation', 'chi_square', 'anova', 'mann_whitney', 'ks_test'],
          description: 'Type of statistical test to perform',
          descriptionZh: '要执行的统计检验类型',
        },
        data: {
          type: 'object',
          description: 'Test data as arrays of numbers keyed by variable name',
          descriptionZh: '检验数据，以变量名为键的数字数组',
        },
        alpha: {
          type: 'number',
          description: 'Significance level (default: 0.05)',
          descriptionZh: '显著性水平（默认：0.05）',
        },
        hypothesis: {
          type: 'string',
          description: 'Null hypothesis description',
          descriptionZh: '零假设描述',
        },
      },
      required: ['test_type', 'data'],
    },
    executor: dataAnalystExecutors.statistical_test,
  },
  {
    name: 'rest_api',
    description: 'Make HTTP REST API requests to fetch data from external services. Supports GET, POST, PUT, DELETE methods with various authentication types.',
    descriptionZh: '发起 HTTP REST API 请求从外部服务获取数据。支持 GET、POST、PUT、DELETE 方法及多种认证类型。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to request',
          descriptionZh: '请求的 URL',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          description: 'HTTP method (default: GET)',
          descriptionZh: 'HTTP 方法（默认：GET）',
        },
        headers: {
          type: 'object',
          description: 'Request headers as key-value pairs',
          descriptionZh: '请求头键值对',
        },
        body: {
          type: 'string',
          description: 'Request body (for POST/PUT/PATCH)',
          descriptionZh: '请求体（用于 POST/PUT/PATCH）',
        },
        auth_type: {
          type: 'string',
          enum: ['none', 'bearer', 'api-key', 'basic', 'oauth2'],
          description: 'Authentication type (default: none)',
          descriptionZh: '认证类型（默认：none）',
        },
        auth_token: {
          type: 'string',
          description: 'Authentication token or credentials',
          descriptionZh: '认证令牌或凭据',
        },
        auth_header_name: {
          type: 'string',
          description: 'Header name for API key authentication (default: X-API-Key)',
          descriptionZh: 'API Key 认证的头名称（默认：X-API-Key）',
        },
      },
      required: ['url'],
    },
    executor: dataAnalystExecutors.rest_api,
  },
]

export default DATA_ANALYST_TOOLS
