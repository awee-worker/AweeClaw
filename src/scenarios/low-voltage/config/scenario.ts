/**
 * 低电压治理场景配置
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/types/scenario'

const LOW_VOLTAGE_IDENTITY: ScenarioIdentity = {
  systemPrompt: `You are an AI assistant integrated into **AweeClaw**, currently in **Low Voltage Treatment** scenario, created by **awee** (微信: awee_worker, Email: awee.worker@qq.com).

### About AweeClaw
- **Name**: AweeClaw - Connect AI to Your World
- **Author**: awee (微信: awee_worker)
- **Current Scenario**: Low Voltage Treatment — 低电压治理

### Core Responsibilities
你是一个专业的低电压治理助手，具备以下核心能力：

1. **低电压用户管理**
   - 查询、新增、修改、删除低电压用户信息
   - 按台区、状态、电压等级等条件筛选用户
   - 统计低电压用户分布和趋势

2. **台区管理**
   - 查询、新增、修改台区信息
   - 台区负载率分析
   - 台区低电压用户统计

3. **治理记录管理**
   - 创建治理工单
   - 跟踪治理进度
   - 评估治理效果（治理前后电压对比）

4. **电压监测数据分析**
   - 查询监测数据
   - 电压趋势分析
   - 异常检测与预警

### Database Access
你可以通过 sql_query 工具直接查询场景专属数据库。数据库包含以下表：
- lv_users: 低电压用户表
- lv_districts: 台区表
- lv_treatment_records: 治理记录表
- lv_monitor_data: 电压监测数据表

### Important Rules
- 所有数据操作都通过 SQL 工具执行，不要猜测数据
- 修改数据前先确认用户意图
- 提供数据分析时，给出清晰的可视化建议
- 使用中文与用户交流`,

  securityRules: `## Security Rules
- 执行 DELETE/UPDATE 操作前必须确认用户意图
- 不允许执行 DROP TABLE 等破坏性操作（除非卸载场景）
- 敏感数据（用户电话等）脱敏展示
- 数据库查询结果超过 1000 行时自动分页`,

  conventions: `## Conventions
- 日期格式: YYYY-MM-DD
- 电压单位: 伏特 (V)
- 低电压判定标准: 电压 < 198V（单相）或 < 342V（三相）
- 台区编码格式: 遵循供电企业编码规范`,

  workflow: `## Workflow
1. 理解用户的数据需求
2. 构建 SQL 查询
3. 执行查询并分析结果
4. 以表格/图表形式展示
5. 给出专业建议`,

  outputFormat: `## Output Format
- 数据查询结果以 Markdown 表格展示
- 统计数据配合图表展示
- 治理建议以结构化列表呈现`,

  toolGuidelines: `## Tool Guidelines
- 使用 sql_query 查询场景数据库
- 使用 chart_generate 生成可视化图表
- 使用 data_transform 进行数据转换`,
}

const LOW_VOLTAGE_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['code'],
  modes: [
    {
      id: 'chat',
      label: 'Chat',
      labelZh: '对话',
      icon: 'MessageSquare',
      description: 'Quick Q&A about low voltage treatment',
      descriptionZh: '低电压治理快速问答',
      toolPolicy: { enabled: false },
    },
    {
      id: 'agent',
      label: 'Agent',
      labelZh: '智能体',
      icon: 'Sparkles',
      description: 'Autonomous data analysis and management',
      descriptionZh: '自主数据分析和管理',
      toolPolicy: { enabled: true, requireApproval: false },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Database', label: 'Database', labelZh: '数据库', priority: 2 },
  ],
  outputFormats: ['markdown', 'table', 'chart', 'text'],
}

const LOW_VOLTAGE_UI: ScenarioUI = {
  layout: 'editor-centric',
  panels: [
    { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
    { id: 'data-panel', component: 'DataPanel', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 600 },
  ],
  sidebarItems: [
    { id: 'users', icon: 'Users', label: 'LV Users', labelZh: '低电压用户', component: 'LvUsersView', position: 0 },
    { id: 'districts', icon: 'MapPin', label: 'Districts', labelZh: '台区管理', component: 'LvDistrictsView', position: 1 },
    { id: 'treatment', icon: 'Wrench', label: 'Treatment', labelZh: '治理记录', component: 'LvTreatmentView', position: 2 },
    { id: 'monitor', icon: 'Activity', label: 'Monitor', labelZh: '电压监测', component: 'LvMonitorView', position: 3 },
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 4 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 5 },
  ],
  statusBarItems: [
    { id: 'db-status', component: 'DbStatusIndicator', position: 'left', order: 0 },
  ],
  welcomeComponent: 'LowVoltageWelcomePage',
}

const LOW_VOLTAGE_DATA_SOURCES: ScenarioDataSources = {
  workspace: false,
  customSources: [
    {
      id: 'scenario-db',
      type: 'database',
      label: 'Scenario Database',
      labelZh: '场景数据库',
      config: { driver: 'sqlite', managed: true },
    },
  ],
}

export const lowVoltageScenario: ScenarioPlugin = {
  id: 'low-voltage',
  name: 'Low Voltage Treatment',
  nameZh: '低电压治理',
  icon: 'Zap',
  description: 'Low voltage user management, district management, and treatment tracking',
  descriptionZh: '低电压用户管理、台区管理和治理跟踪',
  version: '1.0.0',
  author: 'awee',
  category: 'energy',
  tags: ['low-voltage', 'power-grid', 'energy', 'treatment', 'monitoring'],
  source: 'local',
  hasSettings: true,
  requiresWorkspace: false,

  identity: LOW_VOLTAGE_IDENTITY,
  capabilities: LOW_VOLTAGE_CAPABILITIES,
  ui: LOW_VOLTAGE_UI,
  dataSources: LOW_VOLTAGE_DATA_SOURCES,
}
