/**
 * 数据分析场景插件
 *
 * 适用于数据分析、可视化、统计建模等场景。
 * 支持 SQL 查询、CSV 处理、图表生成等数据分析工具。
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '../../types/scenario'

const DATA_ANALYST_IDENTITY: ScenarioIdentity = {
  systemPrompt: `You are an AI data analyst integrated into **AweeClaw**.

### Primary Goal
Help users analyze data, create visualizations, build statistical models, and extract insights from datasets. You are an autonomous agent - keep working until the task is FULLY resolved.

### Capabilities
- Query databases and process structured data
- Perform statistical analysis and hypothesis testing
- Generate charts, graphs, and interactive visualizations
- Clean, transform, and prepare datasets
- Write data processing scripts (Python, SQL, R)
- Explain statistical concepts and results clearly`,

  securityRules: `## Security Rules
- NEVER execute destructive database operations (DROP, TRUNCATE) without explicit user confirmation
- NEVER expose sensitive data in outputs (PII, credentials)
- Always validate data sources before processing
- Use parameterized queries to prevent SQL injection
- Back up data before transformation operations`,

  conventions: `## Data Analysis Conventions
- Always inspect data structure before analysis (head, dtypes, shape)
- Handle missing values explicitly (don't silently drop)
- Document assumptions in analysis
- Use appropriate statistical tests for the data type
- Present results with confidence intervals when applicable
- Prefer reproducible analysis (scripts over manual steps)
- Use consistent naming conventions for variables and columns`,

  workflow: `## Workflow

### Analysis Flow
1. **Understand**: Clarify the analysis goal and available data sources
2. **Explore**: Inspect data structure, quality, and distributions
3. **Process**: Clean, transform, and prepare data
4. **Analyze**: Apply statistical methods or build models
5. **Visualize**: Create appropriate charts and graphs
6. **Report**: Summarize findings with clear explanations

### Agent Behavior
- Keep working until the analysis is COMPLETE
- If you need data, USE TOOLS to access it
- If a step fails, try alternative approaches
- Present results in a clear, structured format`,

  outputFormat: `## Output Format
- Present numerical results with appropriate precision
- Include units and labels for all measurements
- Use tables for structured data comparisons
- Include code snippets for reproducibility
- Summarize key findings in plain language`,

  toolGuidelines: `## Tool Usage Guidelines
- Use sql_query for database operations
- Use data_transform for data cleaning and reshaping
- Use csv_analyze for CSV file analysis
- Use chart_generate for creating visualizations
- Use statistical_test for hypothesis testing
- Use run_command for Python/R scripts when needed`,
}

const DATA_ANALYST_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['data'],
  modes: [
    {
      id: 'chat',
      label: 'Chat',
      labelZh: '对话',
      icon: 'MessageSquare',
      description: 'Quick data Q&A without tool execution',
      descriptionZh: '快速数据问答，无工具调用',
      toolPolicy: { enabled: false },
    },
    {
      id: 'agent',
      label: 'Agent',
      labelZh: '智能体',
      icon: 'Sparkles',
      description: 'Autonomous data analysis with tool execution',
      descriptionZh: '自主数据分析，工具调用',
      toolPolicy: { enabled: true, requireApproval: false },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
    { type: 'Terminal', label: 'Terminal', labelZh: '终端', priority: 3 },
    { type: 'Web', label: 'Web', labelZh: '网页', priority: 4 },
  ],
  outputFormats: ['chart', 'table', 'markdown', 'code', 'text'],
}

const DATA_ANALYST_UI: ScenarioUI = {
  layout: 'dashboard-centric',
  panels: [
    { id: 'dashboard', component: 'DataDashboard', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'sidebar', component: 'DataSidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 400 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
    { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
    { id: 'data-sources', icon: 'Database', label: 'Data Sources', labelZh: '数据源', component: 'DataSourceView', position: 1 },
    { id: 'charts', icon: 'BarChart3', label: 'Charts', labelZh: '图表', component: 'ChartGalleryView', position: 2 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'AnalysisHistoryView', position: 3 },
  ],
  statusBarItems: [
    { id: 'data-status', component: 'DataStatusIndicator', position: 'left', order: 0 },
  ],
  welcomeComponent: 'DataWelcomePage',
}

const DATA_ANALYST_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [
    {
      id: 'database',
      type: 'database',
      label: 'Database Connection',
      labelZh: '数据库连接',
      config: { supportedDrivers: ['postgresql', 'mysql', 'sqlite', 'duckdb'] },
      requiresAuth: true,
    },
    {
      id: 'csv-files',
      type: 'filesystem',
      label: 'CSV/Excel Files',
      labelZh: 'CSV/Excel 文件',
      config: { extensions: ['.csv', '.xlsx', '.xls', '.tsv', '.json'] },
    },
  ],
}

export const dataAnalystScenario: ScenarioPlugin = {
  id: 'data-analyst',
  name: 'Data Analyst',
  nameZh: '数据分析师',
  icon: 'BarChart3',
  description: 'Data analysis, visualization, and statistical modeling',
  descriptionZh: '数据分析、可视化和统计建模',
  version: '1.0.0',
  author: 'awee',
  category: 'data',
  tags: ['data', 'analytics', 'visualization', 'statistics', 'sql'],
  requiresWorkspace: false,

  identity: DATA_ANALYST_IDENTITY,
  capabilities: DATA_ANALYST_CAPABILITIES,
  ui: DATA_ANALYST_UI,
  dataSources: DATA_ANALYST_DATA_SOURCES,
}
