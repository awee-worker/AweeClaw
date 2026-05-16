/**
 * 场景扩展开发模板
 *
 * 复制此目录作为新场景的起点：
 * cp -r src/scenarios/_template src/scenarios/your-scenario-id
 *
 * 然后修改以下文件：
 * 1. index.ts              - 场景入口，实现 ScenarioModule 接口
 * 2. config/scenario.ts    - 场景插件配置（身份、能力、UI、数据源）
 * 3. components/           - 场景特有 UI 组件（sidebar 面板等）
 * 4. db/scripts.ts         - 数据库安装/卸载脚本（如需数据库）
 * 5. tools/                - 工具定义和执行器（可选）
 * 6. services/             - 场景特有服务（可选）
 * 7. types/                - 场景特有类型（可选）
 *
 * 架构说明：
 * - src/scenario-system/   核心架构（加载器、数据总线、数据库管理等）
 * - src/scenarios/         具体场景目录（每个场景一个独立文件夹）
 * - 场景的所有文件（组件、工具、类型等）都应放在自己的文件夹内
 * - 新增场景只需在 src/scenarios/ 下创建目录，系统会自动发现
 *
 * 数据库生命周期（可选）：
 * - 如果场景需要数据库，实现 getInstallScripts() 和 getUninstallScripts()
 * - 注册场景时自动创建数据库并执行安装脚本
 * - 卸载场景时自动执行卸载脚本并删除数据库文件
 * - 数据库路径: {userDataPath}/scenario-data/{scenarioId}/{scenarioId}.db
 * - 在生命周期钩子中通过 context.executeSql(sql) 操作数据库
 */

import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { TEMPLATE_WELCOME_SUGGESTIONS, TEMPLATE_WELCOME_TITLE } from './config/welcome'

const SCENARIO_ID = 'template'
const SCENARIO_VERSION = '0.1.0'

const TEMPLATE_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Template Scenario',
  nameZh: '模板场景',
  description: 'A template scenario for development reference',
  descriptionZh: '用于开发参考的模板场景',
  author: 'awee',
  icon: 'Sparkles',
  category: 'custom',
  tags: ['template', 'example'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: [
    'filesystem:read',
    'filesystem:write',
  ],
}

const TEMPLATE_PLUGIN: ScenarioPlugin = {
  id: SCENARIO_ID,
  name: 'Template Scenario',
  nameZh: '模板场景',
  icon: 'Sparkles',
  description: 'A template scenario for development reference',
  descriptionZh: '用于开发参考的模板场景',
  version: SCENARIO_VERSION,
  author: 'awee',
  category: 'custom',
  tags: ['template', 'example'],

  identity: {
    systemPrompt: 'You are a template scenario assistant.',
    securityRules: '## Security Rules\n- Follow general security best practices',
    conventions: '## Conventions\n- Follow project conventions',
    workflow: '## Workflow\n1. Understand the task\n2. Execute\n3. Verify',
  },

  capabilities: {
    toolPacks: [],
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
    ],
    outputFormats: ['text', 'markdown'],
  },

  ui: {
    layout: 'chat-centric',
    panels: [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true },
    ],
    sidebarItems: [],
    statusBarItems: [],
    welcomeSuggestions: TEMPLATE_WELCOME_SUGGESTIONS,
    welcomeTitle: TEMPLATE_WELCOME_TITLE,
  },

  dataSources: {
    workspace: false,
  },
}

// ============================================
// 数据库脚本（可选）
// 如果场景需要数据库，取消下方注释并编写建表/删表 SQL
// 同时在 ScenarioModule 中实现 getInstallScripts / getUninstallScripts
// ============================================

// const INSTALL_SCRIPTS: ScenarioDbScript[] = [
//   {
//     id: 'create-example-table',
//     description: '创建示例表',
//     sql: `
//       CREATE TABLE IF NOT EXISTS example (
//         id         INTEGER PRIMARY KEY AUTOINCREMENT,
//         name       TEXT    NOT NULL,
//         status     TEXT    DEFAULT 'active',
//         created_at TEXT    DEFAULT (datetime('now', 'localtime')),
//         updated_at TEXT    DEFAULT (datetime('now', 'localtime'))
//       );
//       CREATE INDEX IF NOT EXISTS idx_example_status ON example(status);
//     `,
//   },
// ]
//
// const UNINSTALL_SCRIPTS: ScenarioDbScript[] = [
//   {
//     id: 'drop-example-table',
//     description: '删除示例表',
//     sql: 'DROP TABLE IF EXISTS example',
//   },
// ]

const templateModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => TEMPLATE_MANIFEST,

  getPlugin: () => TEMPLATE_PLUGIN,

  // getTools: () => [],

  // getComponents: () => ({}),

  // getInstallScripts: () => INSTALL_SCRIPTS,

  // getUninstallScripts: () => UNINSTALL_SCRIPTS,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing scenario: ${context.scenarioId} v${context.version}`)
    // 数据库表由 getInstallScripts() 返回的 SQL 脚本自动创建
    // 如需额外安装逻辑（如导入初始数据），可在此处执行：
    // await context.executeSql("INSERT INTO example (name) VALUES ('init')")
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Activating scenario: ${context.scenarioId} v${context.version}`)

    // 如需检查数据库状态：
    // const dbPath = await context.getDatabasePath()
    // health.reportCheck('database', 'healthy', `Database ready at ${dbPath}`)

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Deactivating scenario: ${context.scenarioId}`)

    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Uninstalling scenario: ${context.scenarioId}`)
    // 数据库表由 getUninstallScripts() 返回的 SQL 脚本自动删除
    // 如需额外清理逻辑，可在此处执行
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    // 如需检查数据库健康状态：
    // const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    // const result = await scenarioDatabaseManager.executeSql(SCENARIO_ID, 'SELECT COUNT(*) as count FROM example')
    // return [{ name: 'database', status: result.success ? 'healthy' : 'unhealthy', message: result.success ? `OK` : result.error }]

    return [
      { name: 'basic', status: 'healthy', message: 'Template scenario is running' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => {
    return []
  },
}

export default templateModule
