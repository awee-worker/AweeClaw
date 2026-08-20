/**
 * 声明式带工具模板
 *
 * 声明式场景 + 自定义工具（脚本工具）。
 * 演示如何通过 scripts.scriptTools 在沙箱中执行自定义工具，
 * 适合需要扩展能力但不写 TypeScript 代码的场景。
 */
import type { ScenarioTemplate } from './types'

export const declarativeWithToolsTemplate: ScenarioTemplate = {
  id: 'declarative-with-tools',
  name: 'Declarative with Tools',
  nameZh: '声明式带工具',
  description: 'Declarative scenario with custom script tools',
  descriptionZh: '声明式场景 + 自定义脚本工具，沙箱执行 JS，无需 TypeScript 编译',
  type: 'declarative',
  category: 'advanced',
  icon: 'Wrench',
  tags: ['chat', 'tools', 'script', 'advanced'],
  scenarioConfigOverride: {
    icon: 'Wrench',
    capabilities: {
      builtinTools: ['web_search', 'ask_user', 'remember', 'read_file', 'write_file'],
      modes: [
        {
          id: 'chat',
          label: 'Quick',
          labelZh: '快速',
          icon: 'Zap',
          description: 'Quick mode',
          descriptionZh: '快速模式',
          toolPolicy: { enabled: true, requireApproval: false },
        },
        {
          id: 'agent',
          label: 'Agent',
          labelZh: '代理',
          icon: 'Brain',
          description: 'Autonomous agent mode',
          descriptionZh: '自主代理模式',
          toolPolicy: { enabled: true, requireApproval: true },
        },
      ],
      contextTypes: [
        { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
        { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
      ],
      outputFormats: ['text', 'markdown', 'json'],
    },
    ui: {
      layout: 'chat-centric',
      panels: [],
      sidebarItems: [
        { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
        { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
      ],
      statusBarItems: [],
    },
    scripts: {
      onActivateFile: 'scripts/onActivate.js',
      onDeactivateFile: 'scripts/onDeactivate.js',
      tools: [
        {
          name: 'query_data',
          scriptFile: 'scripts/tools/queryData.js',
          description: 'Query data from the scenario database',
          descriptionZh: '从场景数据库查询数据',
        },
        {
          name: 'save_record',
          scriptFile: 'scripts/tools/saveRecord.js',
          description: 'Save a record to the scenario database',
          descriptionZh: '保存记录到场景数据库',
        },
      ],
    },
    database: {
      installScriptFiles: ['db/install.sql'],
      uninstallScriptFiles: ['db/uninstall.sql'],
    },
  },
  // 覆盖默认 system.md，引导 AI 使用自定义工具
  overrideFiles: {
    'prompts/system.md': `# {{name}} 系统提示词

你是 **{{name}}** 场景的 AI 助手，具备数据查询与持久化能力。

## 核心职责
- {{description}}
- 通过 query_data 工具查询场景数据库
- 通过 save_record 工具持久化用户数据
- 提供准确、专业、有上下文的服务

## 工具使用
- **query_data**：查询场景数据库（参数：sql - SQL 查询语句）
- **save_record**：保存记录到场景数据库（参数：table - 表名，data - JSON 数据）
- **web_search**：搜索网络信息
- **ask_user**：向用户提问

## 行为准则
- 数据查询前先确认查询意图
- 保存数据前向用户确认
- 使用结构化格式输出
- 错误时明确说明原因并提供修复建议
`,
  },
  // 额外文件：脚本工具实现
  extraFiles: {
    'scripts/tools/queryData.js': `// 查询场景数据库工具
// 沙箱执行，可访问 context.db / context.logger

function queryData(args) {
  const { sql } = args;
  if (!sql) {
    return { success: false, error: 'sql is required' };
  }
  try {
    const result = context.db.querySql(sql);
    context.logger.info('[queryData] rows:', result.data?.length || 0);
    return {
      success: true,
      data: result.data || [],
      count: result.data?.length || 0,
    };
  } catch (err) {
    context.logger.error('[queryData] failed:', err.message);
    return { success: false, error: err.message };
  }
}

queryData(args);
`,
    'scripts/tools/saveRecord.js': `// 保存记录到场景数据库
// 沙箱执行，可访问 context.db / context.logger

function saveRecord(args) {
  const { table, data } = args;
  if (!table) {
    return { success: false, error: 'table is required' };
  }
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'data must be an object' };
  }

  // 生成 ID 与时间戳
  const id = '{{scenarioId}}-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const now = new Date().toISOString();
  const dataJson = JSON.stringify(data);

  try {
    // 使用参数化查询防止 SQL 注入（沙箱内自动转义）
    const sql = "INSERT INTO " + table + " (id, data, created_at, updated_at) VALUES ('" + id + "', '" + dataJson.replace(/'/g, "''") + "', '" + now + "', '" + now + "')";
    context.db.querySql(sql);
    context.logger.info('[saveRecord] saved to ' + table + ': ' + id);
    return { success: true, id, table };
  } catch (err) {
    context.logger.error('[saveRecord] failed:', err.message);
    return { success: false, error: err.message };
  }
}

saveRecord(args);
`,
  },
  variables: [
    {
      key: 'name',
      label: '场景显示名',
      labelEn: 'Display Name',
      defaultValue: 'Data Assistant',
      required: true,
      placeholder: '数据助手',
    },
    {
      key: 'description',
      label: '场景描述',
      labelEn: 'Description',
      defaultValue: '具备数据查询与持久化能力的助手',
      required: false,
      placeholder: '说明这个场景能做什么',
    },
  ],
  previewStructure: [
    'config/scenario.json',
    'prompts/system.md',
    'scripts/tools/queryData.js',
    'scripts/tools/saveRecord.js',
    'scripts/onActivate.js',
    'db/install.sql',
    'assets/',
  ],
}
