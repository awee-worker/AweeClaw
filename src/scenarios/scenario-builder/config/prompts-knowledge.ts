/**
 * 场景开发知识库
 *
 * 内置 aweeclaw-docs 核心知识，让 AI 了解如何开发 AweeClaw 场景。
 * 涵盖：场景类型、清单配置、提示词、工具、数据库、生命周期、UI、构建发布。
 *
 * 知识来源：aweeclaw-docs/guide/* 与 aweeclaw-docs/sdk/*
 */

/**
 * 场景开发完整知识库（注入系统提示词）
 *
 * 设计原则：
 * - 结构化分章节，便于 AI 检索
 * - 包含完整代码示例，可直接生成可用代码
 * - 覆盖声明式与编程式两种场景类型
 */
export const SCENARIO_DEV_KNOWLEDGE = `# AweeClaw 场景开发知识库

你正在协助用户开发 AweeClaw 场景。以下是完整的场景开发规范，你必须严格遵循。

## 一、场景类型

AweeClaw 支持两种场景类型：

### 1. 声明式场景（declarative）
- 通过 JSON 配置文件（scenario.json）定义
- 无需编写代码，适合对话助手、提示词模板
- 支持自定义工具（通过 executor 映射内置工具）
- 支持生命周期脚本（JavaScript 沙箱）

### 2. 编程式场景（programmatic）
- 使用 TypeScript 编写，实现 ScenarioModule 接口
- 提供完整编程能力，可自定义 UI 组件
- 适合复杂业务场景，需要数据库、自定义工具、UI 面板

## 二、项目结构

### 声明式场景结构
\`\`\`
my-scenario/
├── scenario.json           # 主配置文件（必填）
├── package.json            # 元信息
├── prompts/                # 提示词文件
│   ├── system.md           # 系统提示词
│   ├── security.md         # 安全规则
│   ├── conventions.md      # 编码规范
│   └── workflow.md         # 工作流
├── scripts/                # 生命周期脚本（可选）
│   ├── onActivate.js
│   ├── onDeactivate.js
│   └── onHealthCheck.js
├── db/                     # 数据库脚本（可选）
│   ├── install.sql
│   └── uninstall.sql
└── assets/                 # 静态资源
\`\`\`

### 编程式场景结构
\`\`\`
my-scenario/
├── scenario.json           # 场景清单
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # 入口（必填，默认导出 ScenarioModule）
│   ├── tools/              # 工具定义
│   ├── components/          # React 组件
│   ├── services/           # 业务服务
│   ├── hooks/
│   └── utils/
├── prompts/
│   └── system.md
└── assets/
\`\`\`

## 三、scenario.json 完整配置

\`\`\`json
{
  "id": "my-scenario",
  "version": "1.0.0",
  "name": "My Scenario",
  "nameZh": "我的场景",
  "description": "Description",
  "descriptionZh": "描述",
  "author": "developer",
  "icon": "Package",
  "category": "development",
  "tags": ["demo"],
  "type": "declarative",
  "permissions": ["workspace:read", "web:search"],
  "minAppVersion": "1.0.0",
  "dependencies": [
    { "scenarioId": "base-utils", "version": ">=1.0.0" }
  ],
  "identity": {
    "systemPrompt": "你是一个专业的助手。",
    "systemPromptFile": "prompts/system.md",
    "securityRules": "不要执行危险操作。",
    "securityRulesFile": "prompts/security.md",
    "conventions": "使用专业语言。",
    "conventionsFile": "prompts/conventions.md",
    "workflow": "1. 分析需求\\n2. 执行任务",
    "workflowFile": "prompts/workflow.md"
  },
  "capabilities": {
    "builtinTools": ["web_search", "ask_user", "read_file", "write_file", "remember"],
    "customTools": [
      {
        "name": "search_database",
        "description": "搜索数据库",
        "parameters": {
          "query": { "type": "string", "description": "关键词", "required": true }
        },
        "executor": "web_search",
        "template": "site:example.com {query}"
      }
    ]
  },
  "ui": {
    "layout": "chat-centric",
    "panels": [],
    "sidebarItems": [
      { "id": "explorer", "icon": "Files", "label": "Files", "labelZh": "文件", "component": "ExplorerView", "position": 0 }
    ],
    "statusBarItems": [],
    "welcomeMessage": "你好！",
    "welcomeMessageZh": "你好！"
  },
  "database": {
    "installScript": "CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);",
    "installScriptFiles": ["db/install.sql"],
    "uninstallScript": "DROP TABLE IF EXISTS items;",
    "uninstallScriptFiles": ["db/uninstall.sql"]
  },
  "scripts": {
    "onActivateFile": "scripts/onActivate.js",
    "onDeactivateFile": "scripts/onDeactivate.js",
    "onHealthCheckFile": "scripts/onHealthCheck.js"
  }
}
\`\`\`

### 字段说明
| 字段 | 必填 | 说明 |
|------|------|------|
| id | 是 | 场景唯一标识，小写字母+数字+连字符 |
| version | 是 | 语义化版本号（如 1.0.0） |
| name / nameZh | 是 | 英文/中文名称 |
| type | 是 | "declarative" 或 "programmatic" |
| identity | 是 | 提示词配置 |
| capabilities | 是 | 工具能力声明 |
| ui | 是 | UI 布局配置 |
| permissions | 否 | 权限列表 |
| minAppVersion | 否 | 最低客户端版本 |
| dependencies | 否 | 场景依赖 |
| database | 否 | 数据库脚本 |
| scripts | 否 | 生命周期脚本 |

## 四、提示词编写

提示词文件使用 Markdown 格式，支持 YAML frontmatter。

### system.md 示例
\`\`\`markdown
---
version: "1.0"
temperature: 0.7
max_tokens: 4096
---

# 角色定义
你是一位专业的助手。

# 核心能力
1. 分析用户需求
2. 提供专业建议
3. 执行相关任务

# 行为准则
- 使用简洁清晰的语言
- 不确定时诚实告知
- 优先使用工具获取最新信息
\`\`\`

### 提示词四要素
1. **systemPrompt**：定义 AI 角色、能力、行为
2. **securityRules**：安全边界，禁止危险行为
3. **conventions**：回复格式、语言风格
4. **workflow**：任务处理步骤

## 五、ScenarioModule 接口（编程式）

\`\`\`typescript
import type { ScenarioModule, ScenarioModuleContext } from '@aweeclaw/scenario-sdk'

export default {
  id: 'my-scenario',
  version: '1.0.0',

  getManifest: () => ({
    id: 'my-scenario',
    version: '1.0.0',
    name: 'My Scenario',
    nameZh: '我的场景',
    description: 'A powerful scenario',
    descriptionZh: '强大的场景',
    author: 'developer',
    icon: 'Package',
    category: 'development',
    tags: ['demo'],
    minAppVersion: '1.0.0',
    permissions: ['workspace:read'],
    dependencies: [],
  }),

  getPlugin: () => ({
    id: 'my-scenario',
    name: 'My Scenario',
    nameZh: '我的场景',
    icon: 'Package',
    description: 'A powerful scenario',
    descriptionZh: '强大的场景',
    version: '1.0.0',
    author: 'developer',
    category: 'development',
    tags: ['demo'],
    identity: {
      systemPrompt: '你是一个专业的助手。',
      securityRules: '不要执行危险操作。',
      conventions: '使用 TypeScript 最佳实践。',
      workflow: '1. 分析需求 2. 设计方案 3. 实现代码 4. 测试验证',
    },
    capabilities: {
      toolPacks: ['code'],
      modes: [
        { id: 'chat', label: 'Chat', labelZh: '对话', icon: 'Zap', description: '标准对话', descriptionZh: '标准对话', toolPolicy: { enabled: true } },
      ],
      contextTypes: [],
      outputFormats: ['text', 'markdown'],
    },
    ui: { layout: 'chat-centric', panels: [], sidebarItems: [], statusBarItems: [] },
    dataSources: { workspace: false },
  }),

  getTools: () => [{
    name: 'greet',
    definition: {
      name: 'greet',
      description: '打招呼',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '用户名' } },
        required: ['name'],
      },
    },
    executor: async (args) => ({ success: true, result: \`你好，\${args.name}！\` }),
  }],

  getInstallScripts: () => [{
    id: 'create-table',
    sql: 'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);',
  }],

  onActivate: async (context) => {
    context.getLogger().info('场景已激活')
  },

  onHealthCheck: async () => [
    { name: 'database', status: 'healthy', message: 'OK' },
  ],
} satisfies ScenarioModule
\`\`\`

## 六、ScenarioModuleContext API

场景激活时获得的上下文对象，提供以下能力：

| 方法 | 说明 |
|------|------|
| registerTools(tools) | 注册场景工具 |
| unregisterTools(names) | 注销工具 |
| registerIpcHandlers(handlers) | 注册 IPC 处理器 |
| unregisterIpcHandlers(channels) | 注销 IPC |
| publishData(type, payload) | 发布数据总线消息 |
| subscribeData(type, handler) | 订阅消息 |
| setSharedData(key, value) | 设置共享数据 |
| getSharedData(key) | 读取共享数据 |
| getLogger() | 获取日志器 |
| executeSql(sql) | 执行 SQL（场景独立 SQLite） |
| getDatabasePath() | 获取数据库路径 |
| workspacePath | 工作区路径 |

## 七、自定义工具开发

### 工具定义结构
\`\`\`typescript
interface ScenarioToolDefinition {
  name: string           // 工具名称，snake_case
  definition: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'object' | 'array'
        description: string
        enum?: string[]
      }>
      required?: string[]
    }
  }
  executor: (args, context) => Promise<{
    success: boolean
    result?: string
    error?: string
  }>
}
\`\`\`

### 工具示例
\`\`\`typescript
{
  name: 'query_database',
  definition: {
    name: 'query_database',
    description: '查询场景数据库',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL 查询语句' },
      },
      required: ['sql'],
    },
  },
  executor: async (args, context) => {
    const rows = await context.executeSql(args.sql)
    return { success: true, result: JSON.stringify(rows) }
  },
}
\`\`\`

## 八、数据库脚本

场景拥有独立的 SQLite 数据库。通过 install/uninstall 脚本初始化。

### install.sql 示例
\`\`\`sql
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT DEFAULT 'active',
  created_at  TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
\`\`\`

### 在服务中执行 SQL
\`\`\`typescript
const result = await context.executeSql(\`
  INSERT INTO items (id, name) VALUES ('\${id}', '\${name}')
\`)
\`\`\`

注意：SQL 参数需手动转义，使用 escapeValue 防止注入。

## 九、UI 布局配置

### 布局类型
- chat-centric：以对话为中心
- editor-centric：以编辑器为中心（IDE 风格）
- dashboard-centric：仪表盘风格
- split-centric：分屏布局
- minimal：极简模式
- fullscreen-chat：全屏对话

### 面板区域
- primary：主区域
- secondary：次区域（侧边栏）
- auxiliary：辅助区域
- floating：浮动面板

### 侧边栏项
\`\`\`typescript
sidebarItems: [
  { id: 'explorer', icon: 'FolderTree', label: 'Files', labelZh: '文件', component: 'ExplorerView', position: 0 },
  { id: 'search', icon: 'Search', label: 'Search', labelZh: '搜索', component: 'SearchView', position: 1 },
]
\`\`\`

图标使用 lucide-react 图标名（如 FolderTree、Search、Settings、Package、Rocket）。

## 十、生命周期

场景生命周期事件：
1. **onInstall**：安装时执行，初始化数据库
2. **onActivate**：激活时执行，注册工具、IPC、服务
3. **onDeactivate**：停用时执行，清理资源
4. **onUninstall**：卸载时执行，清理数据库
5. **onHealthCheck**：健康检查，返回状态报告

## 十一、构建与发布

### 内嵌工具链（无需外部 CLI）

场景开发助手已内置完整工具链，所有操作通过客户端 UI 或 IPC 完成，**不再依赖 aweeclaw-scenario-cli 命令行**：

| 操作 | 触发方式 | 说明 |
| --- | --- | --- |
| 新建项目 | 项目面板 → 新建项目 | 自动生成项目骨架（scenario.json/prompts/database） |
| 校验 | 构建面板 → 校验 | 主进程内嵌校验器检查配置完整性 |
| 构建 | 构建面板 → 构建 | 编程式场景用 esbuild 打包；声明式直接复制 |
| 打包 | 构建面板 → 打包 | 生成 .aweeclawpkg 分发包 |
| 试运行 | 调试面板 → 试运行 | 临时加载到客户端，无需正式安装 |
| 安装 | 安装面板 → 安装 | 将打包产物安装到本地场景目录 |
| 卸载 | 安装面板 → 卸载 | 删除场景目录并执行 uninstall.sql |
| 登录 | 发布面板 → 检查登录 | 通过开发者中心账号体系登录 |
| 发布 | 发布面板 → 发布 | 上传 .aweeclawpkg 到开发者中心市场 |

### 构建产物
构建后生成 dist/ 目录，包含：
- scenario.json（清单）
- 编译后的 JS（编程式）
- 资源文件
- package.json

### 本地安装
将 dist/ 目录安装到客户端本地场景目录，可直接使用。

### 发布流程
1. 构建并校验通过
2. 登录开发者中心（获取 token）
3. 打包上传
4. 审核通过后发布到市场

## 十二、最佳实践

1. **命名规范**：scenarioId 使用小写字母+连字符（如 my-legal-advisor）
2. **版本管理**：遵循语义化版本（MAJOR.MINOR.PATCH）
3. **权限最小化**：只声明必要的权限
4. **提示词清晰**：明确角色、能力、边界
5. **错误处理**：工具执行需捕获异常，返回结构化错误
6. **数据库隔离**：每个场景独立数据库，不共享数据
7. **UI 自适应**：支持 PC 和移动端
8. **国际化**：提供中英文配置
9. **安全规则**：禁止危险操作，保护用户隐私
10. **依赖声明**：明确声明场景间依赖关系

## 十三、场景开发流程

1. **需求分析**：明确场景目标、用户群体、核心功能
2. **选择类型**：简单场景用声明式，复杂场景用编程式
3. **新建项目**：在场景开发助手中"新建项目"，自动生成骨架
4. **编写配置**：scenario.json + 提示词文件
5. **开发工具**：自定义工具（如需要）
6. **开发 UI**：自定义组件（编程式）
7. **数据库设计**：install.sql + uninstall.sql
8. **试运行**：使用调试面板的"试运行"临时加载
9. **校验配置**：构建面板 → 校验，确保配置正确
10. **构建打包**：构建面板 → 构建 → 打包
11. **本地安装**：安装面板安装到客户端测试
12. **发布市场**：发布面板登录后上传

## 十四、常见问题

### Q: 声明式和编程式如何选择？
A: 简单对话场景用声明式；需要自定义 UI、复杂数据库操作、IPC 通信的场景用编程式。

### Q: 如何调试场景？
A: 使用调试面板的"试运行"功能临时加载场景，或安装到客户端本地场景目录后直接使用。

### Q: 场景如何访问文件系统？
A: 声明 permissions 中的 filesystem:read/filesystem:write 权限，使用内置工具 read_file/write_file。

### Q: 场景间如何通信？
A: 使用数据总线 publishData/subscribeData，或共享数据空间 setSharedData/getSharedData。

### Q: 如何处理场景依赖？
A: 在 dependencies 中声明依赖的场景 ID 和版本，加载器会按顺序激活。
`

/**
 * 场景开发快速参考（精简版，用于工具描述）
 */
export const SCENARIO_DEV_QUICK_REF = `AweeClaw 场景开发快速参考：
- 类型：declarative（JSON 配置）/ programmatic（TypeScript）
- 必备文件：scenario.json（清单）、prompts/system.md（提示词）
- 编程式入口：src/index.ts 默认导出 ScenarioModule
- 清单字段：id, version, name, nameZh, type, identity, capabilities, ui
- 提示词四要素：systemPrompt, securityRules, conventions, workflow
- 工具结构：name + definition(JSON Schema) + executor(async function)
- 数据库：独立 SQLite，通过 install.sql 初始化
- 工具链（内嵌，无需 CLI）：新建项目 / 校验 / 构建 / 打包 / 试运行 / 安装 / 卸载 / 登录 / 发布
- UI 布局：chat-centric / editor-centric / dashboard-centric
- 图标：lucide-react 图标名`
