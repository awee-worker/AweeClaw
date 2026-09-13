/**
 * 场景生成向导服务（WizardService）
 *
 * 根据用户的自然语言需求生成完整、可运行的场景骨架：
 *  - 根据目标（goal）+ 目标用户（targetUsers）拼装定制化系统提示词
 *  - 根据 useTools/useDatabase/useUi 选项决定文件清单
 *  - 一次性写入所有文件（复用 scenarioBuilderCloneExample IPC）
 *
 * 与 createProject / createProjectFromTemplate 的区别：
 *  - createProject：只创建最简骨架，配置和提示词要用户自己填
 *  - createProjectFromTemplate：从已有模板克隆固定结构
 *  - WizardService：根据自然语言意图动态生成定制化内容
 *
 * 数据流：
 *   generateScenario(params) → 生成文件清单 → projectService.registerClonedProject 注册 DB
 *   → scenarioBuilderCloneExample IPC 写入文件 → 返回结果
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'

// ==========================================
// 类型定义
// ==========================================

export interface WizardParams {
  /** 项目名（必填） */
  name: string
  /** 场景 ID（必填，小写字母+数字+连字符） */
  scenarioId: string
  /** 场景类型（declarative / programmatic，默认 declarative） */
  type?: 'declarative' | 'programmatic'
  /** 版本号（默认 1.0.0） */
  version?: string
  /** 项目描述（必填） */
  description: string
  /** 目标：场景应该帮用户做什么（必填，自然语言） */
  goal: string
  /** 目标用户：场景面向的用户群体（可选） */
  targetUsers?: string
  /** 作者（可选，默认 developer） */
  author?: string
  /** 分类（可选，默认 general） */
  category?: string
  /** 是否需要自定义工具（默认 false） */
  useTools?: boolean
  /** 是否需要数据库（默认 false） */
  useDatabase?: boolean
  /** 是否需要 UI 组件（仅 programmatic 有效，默认 false） */
  useUi?: boolean
  /** 启用的内置工具列表（默认 ['web_search']） */
  builtinTools?: string[]
}

export interface WizardResult {
  success: boolean
  projectId?: string
  localPath?: string
  /** 生成的文件相对路径列表 */
  files?: string[]
  /** 给 AI 的下一步建议 */
  nextSteps?: string[]
  error?: string
}

interface GeneratedFile {
  path: string
  content: string
}

// ==========================================
// 服务实现
// ==========================================

export class WizardService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('WizardService: context not set. Call setContext() first.')
    }
    return this.context
  }

  /**
   * 根据向导参数生成场景项目
   */
  async generateScenario(params: WizardParams): Promise<WizardResult> {
    const ctx = this.getContext()
    const log = ctx.getLogger()

    // 1. 参数校验
    const trimmedName = params.name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      return { success: false, error: '项目名称必须为 1-100 个字符' }
    }
    if (!params.scenarioId?.trim() || !/^[a-z][a-z0-9-]*$/.test(params.scenarioId)) {
      return { success: false, error: '场景 ID 必须为小写字母、数字、连字符，且以字母开头' }
    }
    if (!params.goal?.trim()) {
      return { success: false, error: '场景目标（goal）不能为空' }
    }
    if (!params.description?.trim()) {
      return { success: false, error: '场景描述（description）不能为空' }
    }

    const workspacePath = ctx.workspacePath
    if (!workspacePath) {
      return { success: false, error: '未打开工作区，无法生成场景' }
    }

    const type = params.type ?? 'declarative'
    const version = params.version?.trim() || '1.0.0'
    const author = params.author?.trim() || 'developer'
    const category = params.category?.trim() || 'general'
    const useTools = params.useTools === true
    const useDatabase = params.useDatabase === true
    const useUi = type === 'programmatic' && params.useUi === true
    const builtinTools = params.builtinTools && params.builtinTools.length > 0 ? params.builtinTools : ['web_search']
    const localPath = `${workspacePath}/scenarios/${params.scenarioId}`

    // 2. 生成所有文件
    const files: GeneratedFile[] = []
    files.push(this.generateScenarioJson(params, type, version, author, category, builtinTools, useUi))
    files.push(this.generateSystemPrompt(params, type, useTools, useDatabase))
    files.push(this.generateSecurityRules())
    files.push(this.generateConventions(params))
    files.push(this.generateWorkflow(params, type))

    if (useDatabase) {
      files.push(this.generateInstallSql(params))
      files.push(this.generateUninstallSql(params))
    }

    if (useTools) {
      files.push(this.generateToolsFile(params))
    }

    if (type === 'programmatic') {
      files.push(this.generateIndexTs(params, useTools, useDatabase, useUi))
    }

    if (useUi) {
      files.push(this.generateUiComponent(params))
    }

    files.push(this.generateReadme(params, files))

    // 3. 注册 DB（不创建 scaffold）
    const projectService = (await import('./ProjectService')).projectService
    const reg = await projectService.registerClonedProject({
      name: trimmedName,
      scenarioId: params.scenarioId,
      type,
      version,
      localPath,
      author,
    })
    if (!reg.success || !reg.project) {
      return { success: false, error: reg.error || 'DB 注册失败' }
    }
    const projectId = reg.project.id

    // 4. 写入文件（复用 cloneExample IPC）
    if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderCloneExample) {
      await projectService.purgeProject(projectId)
      return { success: false, error: 'Electron API not available' }
    }
    try {
      const result = await (window as any).electronAPI.scenarioBuilderCloneExample({
        targetPath: localPath,
        files,
      })
      if (!result?.success) {
        await projectService.purgeProject(projectId)
        return { success: false, error: result?.error || '文件写入失败' }
      }
      log.info(`[WizardService] Generated scenario "${params.scenarioId}" with ${files.length} files at ${localPath}`)
      return {
        success: true,
        projectId,
        localPath,
        files: files.map((f) => f.path),
        nextSteps: this.buildNextSteps(params, type, useTools, useDatabase, useUi),
      }
    } catch (err) {
      await projectService.purgeProject(projectId)
      return { success: false, error: (err as Error).message }
    }
  }

  // ==========================================
  // 文件生成器
  // ==========================================

  /** 生成 config/scenario.json */
  private generateScenarioJson(
    params: WizardParams,
    type: 'declarative' | 'programmatic',
    version: string,
    author: string,
    category: string,
    builtinTools: string[],
    useUi: boolean,
  ): GeneratedFile {
    const permissions: string[] = []
    if (params.useDatabase) permissions.push('database:query')
    if (useUi) permissions.push('workspace:read')

    const sidebarItems = useUi
      ? [
          {
            id: 'main',
            icon: 'LayoutDashboard',
            label: 'Main',
            labelZh: '主面板',
            component: 'MainPanel',
            position: 0,
            wideMode: true,
          },
        ]
      : [
          {
            id: 'explorer',
            icon: 'Files',
            label: 'Workspace',
            labelZh: '工作区',
            component: 'ExplorerView',
            position: 0,
          },
        ]

    const config = {
      id: params.scenarioId,
      version,
      name: params.name,
      nameZh: params.name,
      description: params.description,
      descriptionZh: params.description,
      author,
      icon: 'Package',
      category,
      type,
      tags: ['wizard-generated'],
      minAppVersion: '1.7.0',
      ...(type === 'programmatic'
        ? {
            entryPoint: './src/index.ts',
            sharedDeps: {
              react: '^18.3.0',
              'react-dom': '^18.3.0',
              'react/jsx-runtime': '^18.3.0',
              'lucide-react': '^0.562.0',
            },
          }
        : {}),
      permissions,
      dependencies: [],
      capabilities: {
        builtinTools,
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
        ],
        contextTypes: [{ type: 'File', label: 'File', labelZh: '文件', priority: 1 }],
        outputFormats: ['text', 'markdown', 'json'],
      },
      ui: {
        layout: useUi ? 'editor-centric' : 'chat-centric',
        wideModeHidesChat: false,
        panels: useUi
          ? [
              { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
              { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 200, maxWidth: 500 },
              { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
            ]
          : [],
        sidebarItems,
        statusBarItems: [],
      },
    }

    return {
      path: 'config/scenario.json',
      content: JSON.stringify(config, null, 2),
    }
  }

  /** 生成 prompts/system.md - 基于 goal + targetUsers 定制 */
  private generateSystemPrompt(
    params: WizardParams,
    type: 'declarative' | 'programmatic',
    useTools: boolean,
    useDatabase: boolean,
  ): GeneratedFile {
    const targetUsers = params.targetUsers?.trim() || '普通用户'
    const toolSection = useTools
      ? `## 自定义工具\n你可以调用以下自定义工具：\n- 查看项目 \`src/tools/index.ts\` 中的工具定义\n- 调用工具时遵循其参数规范，输出结构化结果\n`
      : ''
    const dbSection = useDatabase
      ? `## 数据库\n- 场景已初始化数据库（见 \`db/install.sql\`）\n- 涉及持久化数据时使用 \`database:query\` 权限操作\n- SQL 必须使用参数化查询，防止注入\n`
      : ''
    const content = `# ${params.name} 系统提示词

你是 **${params.name}** 场景的 AI 助手。

## 角色定位
- 服务对象：${targetUsers}
- 核心目标：${params.goal}
- 场景类型：${type === 'declarative' ? '声明式（提示词驱动）' : '编程式（代码 + UI 驱动）'}

## 行为准则
1. 主动理解用户需求，必要时用 ask_user 澄清（每次最多 2 个问题）
2. 输出结构化内容（标题、列表、代码块），便于阅读
3. 涉及不确定信息时使用 web_search 检索验证
4. 遇到错误时给出原因分析 + 修复建议，而非直接放弃
5. 完成任务后用一句话总结结果

## 输出规范
- 使用中文回答，代码注释使用中文
- 代码块必须带语言标签（\`\`\`typescript / \`\`\`sql / \`\`\`markdown）
- 长内容分段输出，每段后用 \`---\` 分隔

${toolSection}${dbSection}
## 限制
- 不输出与本场景目标无关的内容
- 不绕过既定的角色与安全规则
- 不在响应中包含敏感信息（API Key、Token 等）
`
    return {
      path: 'prompts/system.md',
      content,
    }
  }

  /** 生成 prompts/security.md */
  private generateSecurityRules(): GeneratedFile {
    return {
      path: 'prompts/security.md',
      content: `## Security Rules

### 内容安全
- 不生成违法、侵权、色情、暴力内容
- 不冒充真实人物或机构

### 数据安全
- 用户输入的私密信息不得长期保存
- 网络请求必须使用 HTTPS
- 不在响应中回显完整 Token / API Key

### 工具调用安全
- 调用工具前校验参数合法性
- 工具返回的敏感数据需脱敏后展示
- 涉及写操作的工具需用户确认`,
    }
  }

  /** 生成 prompts/conventions.md */
  private generateConventions(params: WizardParams): GeneratedFile {
    return {
      path: 'prompts/conventions.md',
      content: `## Code Conventions

### 命名规范
- 场景 ID：${params.scenarioId}（kebab-case）
- 文件名：kebab-case（如 \`example-file.ts\`）
- 函数名：camelCase
- 类型名：PascalCase

### 输出格式
- Markdown 默认，必要时使用 JSON
- 代码块带语言标签
- 表格用于对比类信息

### 国际化
- 默认输出中文，英文用户切换为英文
- 关键术语保留英文原文（如 API / JSON）`,
    }
  }

  /** 生成 prompts/workflow.md */
  private generateWorkflow(
    params: WizardParams,
    type: 'declarative' | 'programmatic',
  ): GeneratedFile {
    const typeSpecific = type === 'declarative'
      ? '声明式场景由系统提示词驱动，调整 prompts/system.md 即可改变行为。'
      : '编程式场景通过 src/index.ts 注册工具、UI、生命周期；修改后需重新构建。'
    return {
      path: 'prompts/workflow.md',
      content: `## Workflow

### 用户使用流程
1. 用户在聊天框输入请求
2. AI 解析需求，必要时调用工具获取信息
3. AI 输出结构化响应
4. 用户根据响应继续对话或结束

### 场景维护流程
1. 修改 \`prompts/system.md\` 调整 AI 行为
2. ${typeSpecific}
3. 修改 \`scenario.json\` 调整能力声明（工具/模式/UI）
4. 通过场景开发助手校验 → 构建 → 安装测试

### 场景目标
${params.goal}`,
    }
  }

  /** 生成 db/install.sql */
  private generateInstallSql(params: WizardParams): GeneratedFile {
    const tableName = this.tableNameFromScenarioId(params.scenarioId)
    return {
      path: 'db/install.sql',
      content: `-- ${params.name} 场景：数据库安装脚本
-- 表：${tableName} 保存场景的核心数据

CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：加速常用查询
CREATE INDEX IF NOT EXISTS idx_${tableName}_created_at ON ${tableName} (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_${tableName}_title ON ${tableName} (title);`,
    }
  }

  /** 生成 db/uninstall.sql */
  private generateUninstallSql(params: WizardParams): GeneratedFile {
    const tableName = this.tableNameFromScenarioId(params.scenarioId)
    return {
      path: 'db/uninstall.sql',
      content: `-- ${params.name} 场景：数据库卸载脚本

DROP TABLE IF EXISTS ${tableName};
DROP INDEX IF EXISTS idx_${tableName}_created_at;
DROP INDEX IF EXISTS idx_${tableName}_title;`,
    }
  }

  /** 生成 src/tools/index.ts（含示例 CRUD 工具） */
  private generateToolsFile(params: WizardParams): GeneratedFile {
    const tableName = this.tableNameFromScenarioId(params.scenarioId)
    return {
      path: 'src/tools/index.ts',
      content: `/**
 * ${params.name} 场景：自定义工具定义
 *
 * 工具命名规范：snake_case，动词在前
 */
import type { ToolDefinition } from '@aweeclaw/scenario-sdk'

/** 添加记录工具 */
export const addRecordTool: ToolDefinition = {
  name: 'add_record',
  description: 'Add a record to the ${tableName} table',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Record title' },
      content: { type: 'string', description: 'Record content' },
    },
    required: ['title', 'content'],
  },
}

/** 搜索记录工具 */
export const searchRecordsTool: ToolDefinition = {
  name: 'search_records',
  description: 'Search records by keyword',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keyword' },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['query'],
  },
}

export const allTools = [addRecordTool, searchRecordsTool]`,
    }
  }

  /** 生成 src/index.ts（编程式入口） */
  private generateIndexTs(
    params: WizardParams,
    useTools: boolean,
    useDatabase: boolean,
    useUi: boolean,
  ): GeneratedFile {
    const toolsImport = useTools
      ? `import { allTools } from './tools'`
      : ''
    const toolsGet = useTools
      ? `  getTools: () => allTools.map((def) => ({ name: def.name, definition: def, executor: async () => { throw new Error('Executor not implemented: ' + def.name) } })),`
      : '  getTools: () => [],'
    const componentsGet = useUi
      ? `  getComponents: () => ({\n    MainPanel: (require as any)('./components/MainPanel').default,\n  }),`
      : '  getComponents: () => ({}),'
    const dbScripts = useDatabase
      ? `  getInstallScripts: () => [],\n\n  getUninstallScripts: () => [],`
      : '  getInstallScripts: () => [],\n\n  getUninstallScripts: () => [],'

    return {
      path: 'src/index.ts',
      content: `/**
 * ${params.name} 场景入口（编程式）
 *
 * 由向导自动生成，包含基础生命周期与能力声明。
 * 后续按需扩充：UI 组件 / 工具执行器 / 数据库服务
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioHealthCheck,
} from '@aweeclaw/scenario-sdk'
${toolsImport}

const module: ScenarioModule = {
  id: '${params.scenarioId}',
  version: '${params.version || '1.0.0'}',

  getManifest: () => ({
    id: '${params.scenarioId}',
    version: '${params.version || '1.0.0'}',
    name: '${params.name}',
    nameZh: '${params.name}',
    description: '${params.description}',
    descriptionZh: '${params.description}',
    author: '${params.author || 'developer'}',
    icon: 'Package',
    category: 'custom',
    tags: ['wizard-generated'],
    minAppVersion: '1.7.0',
    permissions: ${JSON.stringify(useDatabase ? ['database:query'] : [])},
    dependencies: [],
  }),

  getPlugin: () => ({
    id: '${params.scenarioId}',
    name: '${params.name}',
    nameZh: '${params.name}',
    icon: 'Package',
    description: '${params.description}',
    descriptionZh: '${params.description}',
    version: '${params.version || '1.0.0'}',
    author: '${params.author || 'developer'}',
    category: 'custom',
    isBuiltin: false,
    requiresWorkspace: false,
    hasSettings: false,
    source: 'local',
    identity: { systemPrompt: '你是 ${params.name} 助手。${params.goal}' },
    capabilities: { builtinTools: [], modes: [], contextTypes: [], outputFormats: ['text'] },
    ui: { layout: 'chat-centric', wideModeHidesChat: false, panels: [], sidebarItems: [], statusBarItems: [] },
    dataSources: { workspace: false, customSources: [] },
  }),

${toolsGet}
${componentsGet}
${dbScripts}

  getIpcHandlers: () => [],

  onActivate: async (context: ScenarioModuleContext) => {
    context.getLogger().info('${params.scenarioId} activated')
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.getLogger().info('${params.scenarioId} deactivated')
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => [
    { name: 'module', status: 'healthy', message: '${params.scenarioId} ready' },
  ],
}

export default module`,
    }
  }

  /** 生成 src/components/MainPanel.tsx（UI 组件占位） */
  private generateUiComponent(params: WizardParams): GeneratedFile {
    return {
      path: 'src/components/MainPanel.tsx',
      content: `import React from 'react'

/**
 * ${params.name} 主面板
 *
 * 由向导自动生成，作为初始 UI 占位。
 * 后续根据 ${params.goal} 实现具体功能。
 */
const MainPanel: React.FC = () => {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h2 className="text-base font-medium mb-2">${params.name}</h2>
      <p className="text-sm text-muted-foreground">${params.description}</p>
      <p className="text-sm text-muted-foreground mt-2">在此处实现场景的 UI 功能。</p>
    </div>
  )
}

export default MainPanel`,
    }
  }

  /** 生成 README.md */
  private generateReadme(params: WizardParams, files: GeneratedFile[]): GeneratedFile {
    const fileList = files.map((f) => `- \`${f.path}\``).join('\n')
    return {
      path: 'README.md',
      content: `# ${params.name}

> 由场景开发助手的「生成向导」自动创建

## 场景目标
${params.goal}

## 目标用户
${params.targetUsers || '通用用户'}

## 文件清单
${fileList}

## 后续步骤
1. 编辑 \`prompts/system.md\` 调整 AI 行为
2. 编辑 \`config/scenario.json\` 调整能力声明
${params.useTools ? '3. 在 `src/tools/index.ts` 实现工具执行器（默认抛错，需补充）\n' : ''}${params.useDatabase ? `${params.useTools ? '4' : '3'}. 在 \`db/install.sql\` 按需扩展表结构\n` : ''}

## 试运行
打开场景开发助手 → 校验 → 构建 → 安装 → 在聊天中测试场景`,
    }
  }

  /** 给 AI 的下一步建议 */
  private buildNextSteps(
    params: WizardParams,
    _type: 'declarative' | 'programmatic',
    useTools: boolean,
    useDatabase: boolean,
    useUi: boolean,
  ): string[] {
    const steps: string[] = []
    steps.push(`已生成项目骨架（${params.scenarioId}），可在项目列表中查看`)
    steps.push(`查看 \`prompts/system.md\`，按需调整 AI 角色与行为`)
    steps.push(`查看 \`config/scenario.json\`，确认能力声明符合需求`)
    if (useTools) {
      steps.push(`实现 \`src/tools/index.ts\` 中的工具执行器（当前默认抛错）`)
    }
    if (useDatabase) {
      steps.push(`按需扩展 \`db/install.sql\` 表结构，添加业务字段`)
    }
    if (useUi) {
      steps.push(`在 \`src/components/MainPanel.tsx\` 实现具体 UI`)
    }
    steps.push(`使用 validate_scenario 校验 → build_scenario 构建 → install_scenario 安装测试`)
    return steps
  }

  /** scenarioId 转 snake_case 表名（去掉连字符，复数） */
  private tableNameFromScenarioId(scenarioId: string): string {
    const parts = scenarioId.split('-').filter(Boolean)
    if (parts.length === 0) return 'records'
    // 取最后一段作为表名基础
    const last = parts[parts.length - 1]
    return `${last}_records`
  }
}

export const wizardService = new WizardService()
