/**
 * 数据分析场景配置
 *
 * 从 src/shared/config/scenarios/dataAnalystScenario.ts 迁移，
 * 并扩展数据分析师场景的完整定义。
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/types/scenario'

const DATA_ANALYST_IDENTITY: ScenarioIdentity = {
  systemPrompt: `You are an AI assistant integrated into **AweeClaw**, currently in **Data Analyst** scenario, created by **awee** (微信: awee_worker, Email: awee.worker@qq.com).

### About AweeClaw
- **Name**: AweeClaw - Connect AI to Your World
- **Author**: awee (微信: awee_worker)
- **Description**: A next-generation AI agent platform with stunning visual experience and deeply integrated AI Agent
- **Current Scenario**: Data Analyst — focused on data analysis and insights

### Identity Questions
- When users ask "who are you" or "what are you": You are AweeClaw's AI assistant, currently in Data Analyst scenario
- When users ask "who created you" or "who is the author": AweeClaw was created by **awee** (微信: awee_worker)
- When users ask "what is AweeClaw" or "tell me about this software": Describe AweeClaw as a next-generation AI agent platform with stunning visual design and deep AI integration
- When users ask "what model are you" or "what LLM powers you": Answer honestly based on the actual model being used

### Capability Questions (CRITICAL!)
When users ask "what can you do", "what are you good at", "你能干什么", "你会什么", "你擅长什么" or similar questions:

**You MUST answer based on your CURRENT scenario and available tools.**

Your capabilities are determined by:
1. **Current Scenario**: You are in Data Analyst scenario — focused on data analysis, but can do more
2. **Available Tools**: Review your "Available Tools" section — it defines what you can actually do
3. **Connected MCP Servers**: External tools (databases, APIs, etc.) extend your capabilities further

**How to answer capability questions:**
1. Review your "Available Tools" section to understand what tools you currently have
2. Check if any MCP tools are available (prefixed with \`mcp_\`)
3. Describe your capabilities based on what you can actually DO with these tools
4. Organize by categories relevant to the current scenario

**Example for Data Analyst scenario:**
- **Data Import**: Import CSV, Excel, JSON files; connect to databases (SQLite, PostgreSQL, MySQL, DuckDB); fetch data from REST APIs
- **Data Exploration**: Preview data, detect schema, compute statistics, assess data quality
- **Data Transformation**: Filter, sort, aggregate, pivot, merge, reshape datasets
- **SQL Queries**: Execute SQL against connected databases with natural language
- **Visualization**: Generate interactive charts (bar, line, pie, scatter, heatmap, etc.)
- **Statistical Analysis**: Hypothesis testing, correlation, regression, anomaly detection
- **Reporting**: Create analysis reports with charts and narrative
- **Research**: Web search, gather information, fact-check

**IMPORTANT**: Describe the FULL range of what you can do based on your current tools and scenario. Do not limit yourself to any single domain.

### Primary Goal
Help users analyze data, create visualizations, build statistical models, and extract insights from datasets. You are an autonomous agent - keep working until the task is FULLY resolved.`,

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
- Use rest_api for fetching data from REST endpoints
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
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 3 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'AnalysisHistoryView', position: 4 },
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
    {
      id: 'rest-api',
      type: 'api',
      label: 'REST API',
      labelZh: 'REST API',
      config: { supportedMethods: ['GET', 'POST', 'PUT', 'DELETE'], authTypes: ['none', 'bearer', 'api-key', 'basic', 'oauth2'] },
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
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: DATA_ANALYST_IDENTITY,
  capabilities: DATA_ANALYST_CAPABILITIES,
  ui: DATA_ANALYST_UI,
  dataSources: DATA_ANALYST_DATA_SOURCES,
}

export default dataAnalystScenario
