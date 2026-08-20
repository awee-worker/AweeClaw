/**
 * 场景开发助手（scenario-builder）场景配置
 *
 * 内置场景，帮助用户开发自己的 AweeClaw 场景。
 * 集成 aweeclaw-docs 知识库，支持项目管理、调试、安装、发布。
 */
import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'
import { SCENARIO_DEV_KNOWLEDGE } from './prompts-knowledge'
import { SCENARIO_BUILDER_WELCOME_SUGGESTIONS, SCENARIO_BUILDER_WELCOME_TITLE } from './welcome'
import { buildScenarioBuilderDynamicContext } from './dynamicContext'

const SCENARIO_BUILDER_DESCRIPTION = 'focused on developing AweeClaw scenarios — project scaffolding, configuration editing, debugging, local installation, and marketplace publishing'

const SCENARIO_BUILDER_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Scenario Builder', SCENARIO_BUILDER_DESCRIPTION) + `

## 场景开发助手专属能力

你当前处于**场景开发助手**模式，专门帮助用户开发 AweeClaw 场景。你的核心能力：

- **项目管理**：创建、打开、管理场景项目（在工作区目录）
- **配置编辑**：编写 scenario.json、提示词文件、数据库脚本
- **实时调试**：校验配置、构建项目、热重载预览
- **本地安装**：将构建好的场景安装到客户端测试
- **发布市场**：将完成的场景发布到开发者中心

**关键原则**：
1. 你必须严格遵循下方的「场景开发知识库」来生成代码和配置
2. 生成的 scenario.json 必须符合规范，字段完整
3. 生成的提示词必须包含角色、能力、行为准则
4. 生成的工具必须符合 ScenarioToolDefinition 结构
5. 优先使用内置工具（create_scenario_project、validate_scenario、build_scenario 等）

**文件写入规则（必须严格遵守）**：
- **禁止使用内置 edit_file / write_file / replace_file_content 编辑场景项目文件**
  原因：内置文件工具受工作区限制，无法访问场景项目目录，且不会触发用户审批
- **必须使用 write_scenario_file 写入场景项目文件**
  原因：write_scenario_file 是场景专用工具，通过 IPC 直接写入场景项目目录，
  且会触发用户审批（接受/拒绝）流程，确保用户对文件变更有完全控制权
- **读取场景项目文件**：使用 read_scenario_file 读取场景项目内的文件
- **流程**：read_scenario_file 读取 → 生成新内容 → write_scenario_file 写入（用户审批后生效）

---

${SCENARIO_DEV_KNOWLEDGE}`,

  securityRules: `## Security Rules

### 场景开发安全
- 生成的场景代码不得包含恶意逻辑（后门、数据外传、未授权访问）
- 不得在场景中硬编码 API Key、Token 等敏感信息
- 数据库脚本必须使用参数化查询，防止 SQL 注入
- 场景权限声明必须最小化，只声明必要的权限
- 提示词中不得包含绕过安全审查的指令
- 生命周期脚本不得执行危险系统操作（删除文件、修改系统配置等）

### 代码安全
- 所有用户输入必须经过校验和转义
- 文件操作必须限制在工作区范围内
- 网络请求必须使用 HTTPS
- 不得生成可被利用的漏洞代码（XSS、CSRF、注入等）`,

  conventions: `## Code Conventions

### 场景命名
- scenarioId：小写字母+数字+连字符（如 my-legal-advisor）
- version：语义化版本（MAJOR.MINOR.PATCH）
- 文件名：kebab-case

### 配置规范
- scenario.json 必须包含 id、version、name、nameZh、type
- 提示词文件使用 Markdown 格式
- SQL 脚本必须包含 IF NOT EXISTS 防止重复创建
- 索引必须命名（idx_表名_字段名）

### 代码风格
- TypeScript 严格模式
- 函数命名：camelCase
- 类型命名：PascalCase
- 常量命名：UPPER_SNAKE_CASE
- 注释使用中文，代码使用英文标识符

### 提示词编写
- 明确角色定位和能力边界
- 包含行为准则和安全规则
- 提供工作流程指导
- 使用结构化格式（标题、列表）`,

  workflow: `## Workflow

### 场景开发标准流程
1. **需求分析**：明确场景目标、用户群体、核心功能
2. **项目创建**：使用 create_scenario_project 工具创建项目
3. **配置编写**：编写 scenario.json 和提示词文件
4. **工具开发**：如需自定义工具，编写工具定义和执行器
5. **数据库设计**：编写 install.sql 和 uninstall.sql
6. **本地调试**：使用 validate_scenario 校验配置
7. **构建打包**：使用 build_scenario 构建项目
8. **本地安装**：使用 install_scenario 安装到客户端测试
9. **发布市场**：使用 publish_scenario 发布到开发者中心

### AI 行为准则
- 你是自主 Agent，持续工作直到任务完成
- 需要信息时使用工具获取，不要询问用户已知的信息
- 生成代码后主动校验和构建
- 遇到错误时分析原因并提供修复方案
- 完成任务后简要总结`,

  outputFormat: `## Output Format

### 生成场景配置时
- 提供完整的 scenario.json
- 同时提供提示词文件内容
- 说明各字段的作用

### 生成工具代码时
- 提供完整的工具定义（name + definition + executor）
- 包含参数校验和错误处理
- 提供使用示例

### 调试构建时
- 显示构建命令和输出
- 如有错误，提供修复建议
- 成功后提示下一步操作`,

  toolGuidelines: `## Scenario Builder Tool Guidelines

### 项目管理工具
- **list_scenario_projects**：列出所有场景项目
- **create_scenario_project**：创建新场景项目（在工作区目录）
- **get_scenario_project**：获取项目详情
- **update_scenario_project**：更新项目配置
- **delete_scenario_project**：删除项目

### 开发辅助工具
- **get_scenario_templates**：获取场景模板列表
- **read_scenario_file**：读取场景项目文件
- **write_scenario_file**：写入场景项目文件
- **get_scenario_knowledge**：获取场景开发知识库

### 构建调试工具
- **validate_scenario**：校验场景配置
- **build_scenario**：构建场景项目
- **get_build_logs**：获取构建日志

### 安装发布工具
- **install_scenario**：本地安装场景
- **publish_scenario**：发布到市场
- **get_publish_history**：获取发布历史

### 工作流
1. list_scenario_projects → create_scenario_project（如需新建）
2. write_scenario_file（编写配置和代码）
3. validate_scenario → build_scenario
4. install_scenario（本地测试）
5. publish_scenario（发布市场）`,
}

const SCENARIO_BUILDER_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['code', 'filesystem'],
  modes: [
    {
      id: 'chat',
      label: 'Quick',
      labelZh: '快速',
      icon: 'Zap',
      description: 'Quick scenario creation and editing',
      descriptionZh: '快速创建和编辑场景',
      toolPolicy: { enabled: true, requireApproval: false },
    },
    {
      id: 'agent',
      label: 'Build',
      labelZh: '构建',
      icon: 'Hammer',
      description: 'Full scenario development with build and publish',
      descriptionZh: '完整场景开发、构建和发布',
      toolPolicy: { enabled: true, requireApproval: true },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
    { type: 'CodeSelection', label: 'Code Selection', labelZh: '代码选择', priority: 3 },
    { type: 'Project', label: 'Project', labelZh: '项目', priority: 4 },
    { type: 'Codebase', label: 'Codebase', labelZh: '代码库', priority: 5 },
    { type: 'Terminal', label: 'Terminal', labelZh: '终端', priority: 6 },
  ],
  outputFormats: ['code', 'markdown', 'diff', 'text', 'json'],
}

const SCENARIO_BUILDER_UI: ScenarioUI = {
  layout: 'editor-centric',
  wideModeHidesChat: false,
  panels: [
    { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 170, maxWidth: 600 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
    { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false },
  ],
  sidebarItems: [
    // ===== 全局入口（与具体项目无关）=====
    { id: 'explorer', icon: 'FolderTree', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'projects', icon: 'FolderKanban', label: 'Projects', labelZh: '场景项目', component: 'ProjectListPanel', position: 1, wideMode: true },
    { id: 'templates', icon: 'LayoutTemplate', label: 'Templates', labelZh: '模板', component: 'TemplateListPanel', position: 2, wideMode: true, hideChat: true },
    { id: 'docs', icon: 'BookOpen', label: 'Docs', labelZh: '文档', component: 'DocsBrowserPanel', position: 3, wideMode: true, hideChat: true },
    // 构建面板是多项目总览（横向对比所有项目构建状态 + 批量操作），保留为全局入口
    { id: 'build', icon: 'Hammer', label: 'Build', labelZh: '构建', component: 'BuildPanel', position: 4, wideMode: true, hideChat: true },
    { id: 'settings', icon: 'Settings', label: 'Settings', labelZh: '设置', component: 'BuilderSettingsPanel', position: 5, wideMode: true, hideChat: true },

    // ===== 项目工作区（聚合单项目操作，不在侧边栏显示）=====
    // 单项目操作（配置/提示词/工具/脚本/数据库/校验/预览/安装/发布）已收拢进 ProjectWorkspacePanel 的 Tab，
    // 由项目列表卡片的"打开工作区"按钮激活（setActiveSidePanel('project-workspace')）。
    // hidden=true：注册到 PanelRegistry 但不在 NavigationRail 显示。
    // hideChat=true：进入工作区时默认隐藏聊天（用户需要 AI 辅助时可手动打开）。
    {
      id: 'project-workspace',
      icon: 'FolderOpen',
      label: 'Project Workspace',
      labelZh: '项目工作区',
      component: 'ProjectWorkspacePanel',
      position: 6,
      wideMode: true,
      hideEditor: true,
      hideChat: true,
      hidden: true,
    },
  ],
  statusBarItems: [
    { id: 'builder-project', component: 'BuilderStatusBar', position: 'left', order: 0 },
    { id: 'builder-status', component: 'BuilderStatusIndicator', position: 'left', order: 1 },
  ],
  welcomeComponent: 'BuilderWelcomePage',
  welcomeSuggestions: SCENARIO_BUILDER_WELCOME_SUGGESTIONS,
  welcomeTitle: SCENARIO_BUILDER_WELCOME_TITLE,
}

const SCENARIO_BUILDER_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [
    {
      id: 'scenario-knowledge',
      type: 'knowledge-base',
      label: 'Scenario Dev Knowledge',
      labelZh: '场景开发知识库',
      config: { source: 'builtin' },
    },
  ],
}

export const scenarioBuilderScenario: ScenarioPlugin = {
  id: 'scenario-builder',
  name: 'Scenario Builder',
  nameZh: '场景开发助手',
  icon: 'Wrench',
  description: 'Develop your own AweeClaw scenarios — create, debug, install, and publish',
  descriptionZh: '开发你自己的 AweeClaw 场景 — 创建、调试、安装、发布',
  version: '0.1.0',
  author: 'awee',
  category: 'development',
  tags: ['scenario', 'builder', 'developer', 'scaffold', 'publish'],
  isBuiltin: true,
  requiresWorkspace: true,
  hasSettings: true,
  settingsComponent: 'BuilderSettingsPanel',
  source: 'builtin',

  identity: SCENARIO_BUILDER_IDENTITY,
  capabilities: SCENARIO_BUILDER_CAPABILITIES,
  ui: SCENARIO_BUILDER_UI,
  dataSources: SCENARIO_BUILDER_DATA_SOURCES,

  /**
   * 动态上下文提供器：每次构建系统提示词时调用，
   * 将"当前选中项目"的关键信息（id / localPath / type / version / status）注入 AI 上下文。
   * 让 AI 无需先调用 list_scenario_projects 即可开展后续工作。
   */
  getDynamicContext: buildScenarioBuilderDynamicContext,
}

export default scenarioBuilderScenario
