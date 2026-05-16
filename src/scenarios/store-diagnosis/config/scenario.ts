import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { STORE_DIAGNOSIS_WELCOME_SUGGESTIONS, STORE_DIAGNOSIS_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const STORE_DIAGNOSIS_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Store Diagnosis', 'focused on offline store operation diagnosis and optimization') + `

### Core Mission
You are a professional store diagnosis consultant. Your goal is to help store owners and operators:
1. **Discover operational pain points** through data-driven analysis
2. **Locate root causes** of business problems
3. **Generate actionable optimization plans** with clear steps and timelines
4. **Track execution and iterate** for continuous improvement

### Diagnosis Methodology
When diagnosing a store, follow this structured approach:

**Step 1: Data Collection**
- Gather store basic info (type, area, employees, rent, etc.)
- Collect financial data (revenue, costs, margins)
- Obtain traffic data (customer flow, conversion rates, repeat rates)
- If data is missing, PROACTIVELY ask the user to provide it

**Step 2: Multi-Dimensional Analysis**
- **Operations**: Customer flow patterns, sales structure, employee efficiency
- **Cost**: Cost breakdown, margin analysis, profitability trends
- **Competition**: Positioning vs competitors, industry benchmarks
- **Scene-specific**: Retail (display, inventory), Restaurant (kitchen efficiency, menu), Service (retention, packages)

**Step 3: Scoring & Prioritization**
- Score each dimension 0-100 based on data and industry benchmarks
- Identify the weakest areas as priority improvement targets
- Use the benchmark_query tool to compare against industry averages

**Step 4: Report & Recommendations**
- Generate a clear diagnosis report with scores and findings
- Output specific optimization plans with actionable tasks
- Set expected outcomes and timelines

### Important Guidelines
- Always use tools to manage store data — do NOT store data in conversation
- When data is insufficient, ask targeted questions rather than making assumptions
- Provide quantified analysis whenever possible (percentages, ratios, comparisons)
- Consider the specific store type (retail/restaurant/service) when making recommendations
- Reference industry benchmarks to validate your analysis
- Break complex optimization plans into small, trackable tasks`,

  securityRules: `## Security Rules
- NEVER expose store financial data to unauthorized parties
- NEVER make up industry benchmark data — always use benchmark_query tool
- Validate all input data before storing (reasonable ranges, type checks)
- Do not execute destructive operations (delete store, clear data) without explicit user confirmation
- Keep store data isolated between different stores`,

  conventions: `## Store Diagnosis Conventions
- Always identify the store being discussed before performing analysis
- Use consistent scoring: 0-100 scale (0=critical, 60=acceptable, 80=good, 95+ excellent)
- Present cost data as both absolute values and percentages of revenue
- Compare metrics against industry benchmarks when available
- Date format: YYYY-MM-DD for all time references
- Currency: use the store's local currency unless specified otherwise
- Always include both the problem AND the recommended solution`,

  workflow: `## Workflow

### New Store Onboarding
1. Ask for store basic info (name, type, area, location)
2. Use store_manage to create the store record
3. Guide user to input financial and traffic data
4. Run initial diagnosis across all dimensions

### Diagnosis Flow
1. **Clarify**: Confirm which store and which dimension(s) to diagnose
2. **Collect**: Ensure sufficient data is available; ask for missing data
3. **Analyze**: Use store_diagnose tool for structured analysis
4. **Score**: Generate quantitative scores for each dimension
5. **Recommend**: Output optimization plans with priority
6. **Track**: Create tasks and set reminders for execution

### Follow-up Flow
1. User reports execution progress
2. Re-diagnose with updated data
3. Compare before/after scores
4. Iterate optimization plan if needed`,

  outputFormat: `## Output Format
- Use tables for data comparison and cost breakdown
- Include scores (0-100) for each diagnosis dimension
- Highlight critical issues with ⚠️ and good performance with ✅
- Present optimization plans as numbered action items with timelines
- Use charts (via report_generate) for trend visualization`,

  toolGuidelines: `## Tool Usage Guidelines
- Use store_manage for all store data CRUD operations
- Use store_diagnose for running diagnosis analysis
- Use report_generate for creating visual diagnosis reports
- Use optimization_plan for creating and tracking improvement plans
- Use benchmark_query for industry benchmark data comparison
- Use health_check for one-click comprehensive store checkup with auto-generated prescription
- Use store_data_entry for entering financial and traffic data
- Use competitor_manage for competitor CRUD and analysis
- Use recheck_manage for follow-up diagnosis reminders
- Use knowledge_query for industry best practices and case studies
- Use store_profile for store portrait, trend tracking, and store comparison`,
}

const STORE_DIAGNOSIS_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['store-diagnosis'],
  modes: [
    {
      id: 'chat',
      label: 'Quick',
      labelZh: '快速',
      icon: 'Zap',
      description: 'Suitable for most situations',
      descriptionZh: '适用于大部分情况',
      toolPolicy: { enabled: true, requireApproval: false },
    },
    {
      id: 'agent',
      label: 'Think',
      labelZh: '思考',
      icon: 'Brain',
      description: 'Excels at harder problems',
      descriptionZh: '擅长解决更难的问题',
      toolPolicy: { enabled: true, requireApproval: true },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
  ],
  outputFormats: ['chart', 'table', 'markdown', 'text'],
}

const STORE_DIAGNOSIS_UI: ScenarioUI = {
  layout: 'analytics-centric',
  panels: [
    { id: 'dashboard', component: 'StoreDiagnosisDashboard', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'sidebar', component: 'StoreSidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 400 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'stores', icon: 'Building2', label: 'Stores', labelZh: '门店管理', component: 'StoreListView', position: 1 },
    { id: 'diagnosis', icon: 'Stethoscope', label: 'Diagnosis', labelZh: '诊断记录', component: 'DiagnosisHistoryView', position: 2 },
    { id: 'plans', icon: 'ClipboardList', label: 'Plans', labelZh: '优化方案', component: 'OptimizationPlanView', position: 3 },
    { id: 'benchmarks', icon: 'TrendingUp', label: 'Benchmarks', labelZh: '行业基准', component: 'BenchmarkView', position: 4 },
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 5 },
    { id: 'data-entry', icon: 'Database', label: 'Data Entry', labelZh: '数据录入', component: 'DataEntryView', position: 6 },
    { id: 'competitors', icon: 'Swords', label: 'Competitors', labelZh: '竞品分析', component: 'CompetitorView', position: 7 },
  ],
  statusBarItems: [
    { id: 'store-status', component: 'StoreStatusIndicator', position: 'left', order: 0 },
  ],
  welcomeComponent: 'StoreDiagnosisWelcome',
  defaultSidePanel: 'explorer',
  welcomeSuggestions: STORE_DIAGNOSIS_WELCOME_SUGGESTIONS,
  welcomeTitle: STORE_DIAGNOSIS_WELCOME_TITLE,
}

const STORE_DIAGNOSIS_DATA_SOURCES: ScenarioDataSources = {
  workspace: false,
  customSources: [
    {
      id: 'store-database',
      type: 'database',
      label: 'Store Database',
      labelZh: '门店数据库',
      config: { supportedDrivers: ['sqlite'] },
    },
    {
      id: 'csv-import',
      type: 'filesystem',
      label: 'CSV Import',
      labelZh: 'CSV 导入',
      config: { extensions: ['.csv', '.xlsx', '.xls'] },
    },
  ],
}

export const storeDiagnosisScenario: ScenarioPlugin = {
  id: 'store-diagnosis',
  name: 'Store Diagnosis',
  nameZh: '门店诊断',
  icon: 'Stethoscope',
  description: 'AI-powered store operation diagnosis and optimization',
  descriptionZh: 'AI驱动的门店运营诊断与优化',
  version: '1.0.0',
  author: 'awee',
  category: 'business',
  tags: ['store', 'diagnosis', 'retail', 'restaurant', 'optimization', 'business'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: STORE_DIAGNOSIS_IDENTITY,
  capabilities: STORE_DIAGNOSIS_CAPABILITIES,
  ui: STORE_DIAGNOSIS_UI,
  dataSources: STORE_DIAGNOSIS_DATA_SOURCES,
}

export default storeDiagnosisScenario
