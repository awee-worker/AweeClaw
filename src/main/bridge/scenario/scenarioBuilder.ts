/**
 * 场景开发助手（scenario-builder）主进程 IPC 桥接
 *
 * 提供场景开发助手所需的主进程能力：
 * - scenario-builder:createProjectFiles — 在文件系统创建项目骨架
 * - scenario-builder:readFile / writeFile — 项目文件读写
 * - scenario-builder:validate / build / pack — 校验/构建/打包（内嵌，不依赖外部 CLI）
 * - scenario-builder:tryRunStart / tryRunStop — 试运行调试预览
 * - scenario:uninstall — 卸载已安装场景
 * - developer:checkAuth / publishScenario — 开发者中心认证与发布
 *
 * 设计要点：
 * - 全部能力内嵌实现，**不依赖 aweeclaw-scenario-cli 外部二进制**
 * - 复用 scenario-system/cli 中已有的 validateScenarioPackage / packScenario / publishScenario
 * - 文件操作严格限定在 workspacePath 与项目 localPath 范围内，防止越权
 */

import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import {
  validateScenarioPackage,
  packScenario,
  type PackResult,
} from '../../../scenario-system/cli'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'

// ==========================================
// 常量
// ==========================================

const SCENARIOS_DIR_NAME = 'scenarios'

// ==========================================
// 辅助函数
// ==========================================

function getScenariosDir(): string {
  return path.join(app.getPath('userData'), SCENARIOS_DIR_NAME)
}

function getScenarioDir(scenarioId: string): string {
  return path.join(getScenariosDir(), scenarioId)
}

/**
 * 路径安全校验：禁止路径穿越（..）和绝对路径逃逸
 */
function safeJoinPath(base: string, target: string): string {
  if (!target || typeof target !== 'string') {
    throw new Error('Invalid path: target is empty')
  }
  if (path.isAbsolute(target)) {
    throw new Error(`Invalid path: absolute path not allowed: ${target}`)
  }
  const joined = path.resolve(base, target)
  if (!joined.startsWith(path.resolve(base) + path.sep) && joined !== path.resolve(base)) {
    throw new Error(`Path escape detected: ${target}`)
  }
  return joined
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) return defaultValue
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return defaultValue
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ==========================================
// 项目骨架生成
// ==========================================

interface CreateProjectFilesParams {
  localPath: string
  scenarioId: string
  name: string
  nameZh: string
  description?: string
  descriptionZh?: string
  author?: string
  version?: string
  category?: string
  type: 'declarative' | 'programmatic'
}

/**
 * 构建声明式场景配置（DeclarativeScenarioConfig）
 * 包含完整的 identity（多提示词文件）、capabilities、ui、database、scripts 配置
 */
function buildDeclarativeScenarioConfig(p: CreateProjectFilesParams): DeclarativeScenarioConfig {
  return {
    id: p.scenarioId,
    name: p.name,
    nameZh: p.nameZh,
    version: p.version || '1.0.0',
    author: p.author || 'developer',
    category: (p.category as DeclarativeScenarioConfig['category']) || 'custom',
    icon: 'Package',
    description: p.description || `Custom scenario: ${p.name}`,
    descriptionZh: p.descriptionZh || `自定义场景：${p.nameZh}`,
    packageType: 'declarative',
    identity: {
      systemPromptFile: 'prompts/system.md',
      securityRulesFile: 'prompts/security.md',
      conventionsFile: 'prompts/conventions.md',
      workflowFile: 'prompts/workflow.md',
    },
    capabilities: {
      builtinTools: ['read_file', 'write_file', 'run_command', 'web_search'],
      modes: [
        {
          id: 'chat',
          label: 'Quick',
          labelZh: '快速',
          icon: 'Zap',
          description: 'Quick mode for most situations',
          descriptionZh: '适用于大部分场景的快速模式',
          toolPolicy: { enabled: true, requireApproval: false },
        },
        {
          id: 'agent',
          label: 'Think',
          labelZh: '思考',
          icon: 'Brain',
          description: 'Think mode for harder problems',
          descriptionZh: '适用于复杂问题的思考模式',
          toolPolicy: { enabled: true, requireApproval: true },
        },
      ],
      contextTypes: [
        { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
        { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
      ],
      outputFormats: ['text', 'markdown'],
    },
    ui: {
      layout: 'chat-centric',
      panels: ['chat'],
      sidebarItems: [
        { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
        { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
      ],
    },
    database: {
      installScriptFiles: ['db/install.sql'],
      uninstallScriptFiles: ['db/uninstall.sql'],
    },
    scripts: {
      onActivateFile: 'scripts/onActivate.js',
      onDeactivateFile: 'scripts/onDeactivate.js',
      onHealthCheckFile: 'scripts/onHealthCheck.js',
    },
  } as DeclarativeScenarioConfig
}

/**
 * 构建编程式场景配置（ProgrammaticScenarioConfig）
 * 编程式场景的 manifest/plugin/tools 由 src/index.ts 在运行时导出，
 * scenario.json 仅承载元数据 + entryPoint + sharedDeps
 */
function buildProgrammaticScenarioConfig(p: CreateProjectFilesParams): Record<string, unknown> {
  return {
    id: p.scenarioId,
    name: p.name,
    nameZh: p.nameZh,
    version: p.version || '1.0.0',
    author: p.author || 'developer',
    category: p.category || 'custom',
    icon: 'Package',
    description: p.description || `Programmatic scenario: ${p.name}`,
    descriptionZh: p.descriptionZh || `编程式场景：${p.nameZh}`,
    packageType: 'programmatic',
    // 编译产物入口（build 命令将 src/index.ts 编译为 dist/index.js）
    entryPoint: 'dist/index.js',
    // 共享依赖由客户端注入，不打包进场景
    sharedDeps: {
      react: '^18.3.0',
      'react-dom': '^18.3.0',
      'react/jsx-runtime': '^18.3.0',
      zustand: '^5.0.0',
      'lucide-react': '^0.562.0',
    },
    permissions: ['workspace:read', 'workspace:write', 'web:search'],
    minAppVersion: '1.0.0',
  }
}

/**
 * 在文件系统创建项目骨架，按类型分发到不同的脚手架实现
 */
function createProjectScaffold(params: CreateProjectFilesParams): void {
  const { localPath } = params
  ensureDir(localPath)

  if (params.type === 'programmatic') {
    createProgrammaticScaffold(params)
  } else {
    createDeclarativeScaffold(params)
  }
}

/**
 * 声明式场景脚手架
 *
 * 目录结构（参照 aweeclaw-docs/guide/declarative.md）：
 * my-scenario/
 * ├── config/scenario.json     场景配置清单（identity/capabilities/ui/database/scripts）
 * ├── prompts/                 提示词文件（system/security/conventions/workflow）
 * ├── scripts/                 生命周期脚本（.js，沙箱执行）
 * │   ├── onActivate.js
 * │   ├── onDeactivate.js
 * │   └── onHealthCheck.js
 * ├── db/                      数据库脚本
 * │   ├── install.sql
 * │   └── uninstall.sql
 * ├── assets/                  静态资源
 * ├── README.md
 * └── .gitignore
 */
function createDeclarativeScaffold(params: CreateProjectFilesParams): void {
  const { localPath } = params
  const displayName = params.nameZh || params.name

  // 1. config/scenario.json
  const configDir = path.join(localPath, 'config')
  ensureDir(configDir)
  const config = buildDeclarativeScenarioConfig(params)
  writeJsonFile(path.join(configDir, 'scenario.json'), config)

  // 2. prompts/ — 完整四件套（system/security/conventions/workflow）
  const promptsDir = path.join(localPath, 'prompts')
  ensureDir(promptsDir)

  fs.writeFileSync(
    path.join(promptsDir, 'system.md'),
    [
      `# ${displayName} 系统提示词`,
      '',
      `你是 **${displayName}** 场景的 AI 助手。`,
      '',
      '## 核心职责',
      `- ${params.descriptionZh || params.description || '帮助用户完成任务'}`,
      '- 提供专业、准确、高效的服务',
      '',
      '## 行为准则',
      '- 遵循场景配置的工作流程',
      '- 主动澄清不明确的需求',
      '- 遵守安全规则，不执行危险操作',
      '',
      '## 输出规范',
      '- 使用结构化格式（标题、列表）',
      '- 复杂内容使用表格或代码块',
      '- 保持简洁，避免冗余',
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(promptsDir, 'security.md'),
    [
      `# ${displayName} 安全规则`,
      '',
      '## 禁止行为',
      '- 不得执行任何破坏性操作（删除文件、修改系统配置等）',
      '- 不得访问或泄露用户隐私数据',
      '- 不得绕过权限校验或越权操作',
      '- 不得执行未经用户确认的高风险命令',
      '',
      '## 数据保护',
      '- 敏感信息（密码、token、密钥）不得明文输出',
      '- 用户数据仅用于当前会话，不得持久化到日志',
      '',
      '## 操作边界',
      '- 仅操作当前工作区范围内的文件',
      '- 网络请求仅限于场景配置允许的域名',
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(promptsDir, 'conventions.md'),
    [
      `# ${displayName} 编码规范`,
      '',
      '## 回复格式',
      '- 使用 Markdown 格式输出',
      '- 代码块标注语言类型',
      '- 长内容使用分节标题',
      '',
      '## 语言风格',
      '- 中文场景使用简体中文',
      '- 技术术语保留英文原文',
      '- 避免口语化，保持专业',
      '',
      '## 错误处理',
      '- 操作失败时明确说明原因',
      '- 提供可操作的修复建议',
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(promptsDir, 'workflow.md'),
    [
      `# ${displayName} 工作流`,
      '',
      '## 标准处理流程',
      '1. **理解需求**：分析用户输入，明确任务目标',
      '2. **制定方案**：拆解任务步骤，预估所需工具',
      '3. **执行操作**：按步骤调用工具，逐步完成',
      '4. **验证结果**：检查执行结果，确保符合预期',
      '5. **反馈总结**：汇报执行情况，提供后续建议',
      '',
      '## 异常处理',
      '- 工具调用失败时，先分析错误再重试或调整方案',
      '- 遇到不确定的需求时，主动向用户确认',
      '- 复杂任务分阶段执行，每阶段确认后再继续',
      '',
    ].join('\n'),
    'utf-8',
  )

  // 3. scripts/ — 生命周期脚本（.js，沙箱执行）
  const scriptsDir = path.join(localPath, 'scripts')
  ensureDir(scriptsDir)

  fs.writeFileSync(
    path.join(scriptsDir, 'onActivate.js'),
    [
      `// ${params.scenarioId} 场景激活脚本`,
      '// 运行时机：场景被用户启用时执行一次',
      '// 可访问沙箱 API：context, db, logger',
      '',
      "function onActivate(context) {",
      "  context.logger.info('场景已激活');",
      '',
      '  // 初始化数据库（如需）',
      "  const result = context.db.querySql('SELECT count(*) as cnt FROM sqlite_master WHERE type=\"table\"');",
      "  context.logger.info('当前表数量: ' + result.data[0].cnt);",
      '',
      "  // 发布就绪事件",
      "  context.publishData('scenario:ready', { scenarioId: '" + params.scenarioId + "' });",
      "  return { status: 'ok' };",
      '}',
      '',
      'onActivate(context);',
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(scriptsDir, 'onDeactivate.js'),
    [
      `// ${params.scenarioId} 场景停用脚本`,
      '// 运行时机：场景被用户禁用时执行一次',
      '// 用于清理运行时状态、关闭连接等',
      '',
      "function onDeactivate(context) {",
      "  context.logger.info('场景已停用');",
      "  return { status: 'ok' };",
      '}',
      '',
      'onDeactivate(context);',
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(scriptsDir, 'onHealthCheck.js'),
    [
      `// ${params.scenarioId} 场景健康检查脚本`,
      '// 运行时机：客户端定期调用，返回健康状态',
      '// 返回值：[{ name, status, message }]，status: healthy|degraded|unhealthy',
      '',
      "function onHealthCheck(context) {",
      '  return [',
      "    { name: 'database', status: 'healthy', message: 'OK' },",
      "    { name: 'module', status: 'healthy', message: 'OK' },",
      '  ];',
      '}',
      '',
      'onHealthCheck(context);',
      '',
    ].join('\n'),
    'utf-8',
  )

  // 4. db/ — 安装/卸载 SQL 脚本
  const dbDir = path.join(localPath, 'db')
  ensureDir(dbDir)
  const tableId = params.scenarioId.replace(/-/g, '_')

  fs.writeFileSync(
    path.join(dbDir, 'install.sql'),
    [
      `-- ${params.scenarioId} 场景安装脚本`,
      '-- 执行时机：场景首次激活时',
      '-- 注意：使用 IF NOT EXISTS 保证可重复执行',
      '',
      `CREATE TABLE IF NOT EXISTS ${tableId}_data (`,
      "  id TEXT PRIMARY KEY,",
      "  data TEXT NOT NULL,",
      "  created_at TEXT NOT NULL DEFAULT (datetime('now')),",
      "  updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
      ');',
      '',
      `CREATE INDEX IF NOT EXISTS idx_${tableId}_data_created ON ${tableId}_data(created_at);`,
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(dbDir, 'uninstall.sql'),
    [
      `-- ${params.scenarioId} 场景卸载脚本`,
      '-- 执行时机：场景卸载时',
      '-- 注意：仅在确认不再需要数据时才卸载场景',
      '',
      `DROP TABLE IF EXISTS ${tableId}_data;`,
      '',
    ].join('\n'),
    'utf-8',
  )

  // 5. assets/ — 静态资源目录
  const assetsDir = path.join(localPath, 'assets')
  ensureDir(assetsDir)
  fs.writeFileSync(path.join(assetsDir, '.gitkeep'), '', 'utf-8')

  // 6. README.md
  writeDeclarativeReadme(params, localPath)

  // 7. .gitignore
  fs.writeFileSync(
    path.join(localPath, '.gitignore'),
    ['dist/', 'node_modules/', '*.log', '.DS_Store', ''].join('\n'),
    'utf-8',
  )
}

/**
 * 编程式场景脚手架
 *
 * 目录结构（参照 aweeclaw-docs/guide/programmatic.md）：
 * my-scenario/
 * ├── config/scenario.json     场景元数据 + entryPoint + sharedDeps
 * ├── package.json             依赖管理（@aweeclaw/scenario-sdk）
 * ├── tsconfig.json            TypeScript 配置
 * ├── src/
 * │   ├── index.ts             入口文件（默认导出 ScenarioModule）
 * │   ├── tools/               工具定义
 * │   │   ├── index.ts
 * │   │   └── example-tool.ts
 * │   ├── components/          React 组件（自定义 UI 面板）
 * │   ├── hooks/               自定义 Hooks
 * │   └── utils/               工具函数
 * ├── prompts/
 * │   └── system.md            系统提示词（编程式场景通常仅此一个）
 * ├── assets/                  静态资源
 * ├── README.md
 * └── .gitignore
 */
function createProgrammaticScaffold(params: CreateProjectFilesParams): void {
  const { localPath } = params
  const displayName = params.nameZh || params.name
  const scenarioId = params.scenarioId

  // 1. config/scenario.json（编程式配置：元数据 + entryPoint + sharedDeps）
  const configDir = path.join(localPath, 'config')
  ensureDir(configDir)
  const config = buildProgrammaticScenarioConfig(params)
  writeJsonFile(path.join(configDir, 'scenario.json'), config)

  // 2. package.json — 依赖管理
  writeJsonFile(path.join(localPath, 'package.json'), {
    name: scenarioId,
    version: params.version || '1.0.0',
    description: params.description || `Programmatic scenario: ${params.name}`,
    main: 'dist/index.js',
    scripts: {
      build: 'tsc && esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js',
      dev: 'tsc --watch',
      clean: 'rm -rf dist',
    },
    dependencies: {
      '@aweeclaw/scenario-sdk': '^1.0.0',
    },
    devDependencies: {
      typescript: '^5.4.0',
      esbuild: '^0.21.0',
      '@types/node': '^20.0.0',
      '@types/react': '^18.3.0',
      '@types/react-dom': '^18.3.0',
    },
    aweeclaw: {
      type: 'programmatic',
      sharedDeps: config.sharedDeps,
    },
  })

  // 3. tsconfig.json — TypeScript 配置
  writeJsonFile(path.join(localPath, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: false,
      outDir: './dist',
      rootDir: './src',
      types: ['node'],
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  })

  // 4. src/ — TypeScript 源码
  const srcDir = path.join(localPath, 'src')
  ensureDir(srcDir)

  // 4.1 src/index.ts — 入口文件，导出 ScenarioModule
  fs.writeFileSync(
    path.join(srcDir, 'index.ts'),
    [
      `/**`,
      ` * ${displayName} 场景入口`,
      ` *`,
      ` * 编程式场景通过默认导出 ScenarioModule 对象定义：`,
      ` * - getManifest(): 返回场景元数据`,
      ` * - getPlugin(): 返回插件配置（identity/capabilities/ui）`,
      ` * - getTools(): 返回自定义工具定义`,
      ` * - getComponents(): 返回 React 组件注册表`,
      ` * - onActivate/onDeactivate/onHealthCheck: 生命周期钩子`,
      ` */`,
      `import type {`,
      `  ScenarioModule,`,
      `  ScenarioModuleContext,`,
      `  ScenarioToolDefinition,`,
      `  ScenarioHealthCheck,`,
      `} from '@aweeclaw/scenario-sdk'`,
      `import { exampleTool } from './tools/example-tool'`,
      '',
      `export default {`,
      `  id: '${scenarioId}',`,
      `  version: '${params.version || '1.0.0'}',`,
      '',
      `  // ========== 清单 ==========`,
      `  getManifest() {`,
      `    return {`,
      `      id: '${scenarioId}',`,
      `      version: '${params.version || '1.0.0'}',`,
      `      name: '${params.name}',`,
      `      nameZh: '${params.nameZh}',`,
      `      description: ${JSON.stringify(params.description || `Programmatic scenario: ${params.name}`)},`,
      `      descriptionZh: ${JSON.stringify(params.descriptionZh || `编程式场景：${params.nameZh}`)},`,
      `      author: ${JSON.stringify(params.author || 'developer')},`,
      `      icon: 'Package',`,
      `      category: ${JSON.stringify(params.category || 'custom')},`,
      `      tags: [],`,
      `      minAppVersion: '1.0.0',`,
      `      permissions: ['workspace:read', 'workspace:write', 'web:search'],`,
      `      dependencies: [],`,
      `    }`,
      `  },`,
      '',
      `  // ========== 插件定义 ==========`,
      `  getPlugin() {`,
      `    return {`,
      `      id: '${scenarioId}',`,
      `      name: '${params.name}',`,
      `      nameZh: '${params.nameZh}',`,
      `      icon: 'Package',`,
      `      description: ${JSON.stringify(params.description || `Programmatic scenario: ${params.name}`)},`,
      `      descriptionZh: ${JSON.stringify(params.descriptionZh || `编程式场景：${params.nameZh}`)},`,
      `      version: '${params.version || '1.0.0'}',`,
      `      author: ${JSON.stringify(params.author || 'developer')},`,
      `      category: ${JSON.stringify(params.category || 'custom')},`,
      `      tags: [],`,
      '',
      `      identity: {`,
      `        systemPromptFile: 'prompts/system.md',`,
      `      },`,
      '',
      `      capabilities: {`,
      `        toolPacks: [],`,
      `        modes: [`,
      `          {`,
      `            id: 'chat',`,
      `            name: 'Chat',`,
      `            nameZh: '对话',`,
      `            description: 'Standard chat mode',`,
      `            descriptionZh: '标准对话模式',`,
      `          },`,
      `          {`,
      `            id: 'agent',`,
      `            name: 'Agent',`,
      `            nameZh: '代理',`,
      `            description: 'Autonomous agent mode',`,
      `            descriptionZh: '自主代理模式',`,
      `          },`,
      `        ],`,
      `        contextTypes: [`,
      `          { type: 'file', name: 'File', nameZh: '文件', description: 'File context' },`,
      `        ],`,
      `        outputFormats: ['text', 'markdown', 'code'],`,
      `      },`,
      '',
      `      ui: {`,
      `        layout: 'chat-centric',`,
      `        panels: [],`,
      `        sidebarItems: [],`,
      `        statusBarItems: [],`,
      `      },`,
      '',
      `      dataSources: {`,
      `        workspace: true,`,
      `        knowledgeBase: false,`,
      `        externalApi: false,`,
      `      },`,
      `    }`,
      `  },`,
      '',
      `  // ========== 工具定义 ==========`,
      `  getTools(): ScenarioToolDefinition[] {`,
      `    return [exampleTool]`,
      `  },`,
      '',
      `  // ========== 组件注册（可选） ==========`,
      `  // getComponents() {`,
      `  //   return { DashboardPanel, SettingsPanel }`,
      `  // },`,
      '',
      `  // ========== 生命周期 ==========`,
      `  async onActivate(context: ScenarioModuleContext) {`,
      `    context.logger.info('[${scenarioId}] 场景已激活')`,
      `  },`,
      '',
      `  async onDeactivate(context: ScenarioModuleContext) {`,
      `    context.logger.info('[${scenarioId}] 场景已停用')`,
      `  },`,
      '',
      `  async onHealthCheck(): Promise<ScenarioHealthCheck[]> {`,
      `    return [{ name: 'module', status: 'healthy', message: 'OK' }]`,
      `  },`,
      `} satisfies ScenarioModule`,
      '',
    ].join('\n'),
    'utf-8',
  )

  // 4.2 src/tools/ — 工具定义
  const toolsDir = path.join(srcDir, 'tools')
  ensureDir(toolsDir)

  fs.writeFileSync(
    path.join(toolsDir, 'index.ts'),
    [
      `export { exampleTool } from './example-tool'`,
      '',
    ].join('\n'),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(toolsDir, 'example-tool.ts'),
    [
      `import type { ScenarioToolDefinition } from '@aweeclaw/scenario-sdk'`,
      '',
      `/**`,
      ` * 示例工具：${displayName} 场景的自定义工具`,
      ` * 可作为开发新工具的模板`,
      ` */`,
      `export const exampleTool: ScenarioToolDefinition = {`,
      `  name: 'example_tool',`,
      `  definition: {`,
      `    name: 'example_tool',`,
      `    description: 'An example tool that echoes the input',`,
      `    descriptionZh: '示例工具：回显输入内容',`,
      `    parameters: {`,
      `      type: 'object',`,
      `      properties: {`,
      `        message: {`,
      `          type: 'string',`,
      `          description: 'Message to echo',`,
      `          descriptionZh: '要回显的消息',`,
      `        },`,
      `      },`,
      `      required: ['message'],`,
      `    },`,
      `  },`,
      `  executor: async (args) => {`,
      `    const { message } = args as { message: string }`,
      `    return {`,
      `      success: true,`,
      `      data: { echoed: message, timestamp: Date.now() },`,
      `    }`,
      `  },`,
      `}`,
      '',
    ].join('\n'),
    'utf-8',
  )

  // 4.3 src/components/ — React 组件目录（占位）
  const componentsDir = path.join(srcDir, 'components')
  ensureDir(componentsDir)
  fs.writeFileSync(
    path.join(componentsDir, '.gitkeep'),
    '# 在此目录放置自定义 React 组件\n# 在 src/index.ts 的 getComponents() 中注册后可被 UI 系统加载\n',
    'utf-8',
  )

  // 4.4 src/hooks/ — 自定义 Hooks 目录（占位）
  const hooksDir = path.join(srcDir, 'hooks')
  ensureDir(hooksDir)
  fs.writeFileSync(path.join(hooksDir, '.gitkeep'), '', 'utf-8')

  // 4.5 src/utils/ — 工具函数
  const utilsDir = path.join(srcDir, 'utils')
  ensureDir(utilsDir)
  fs.writeFileSync(
    path.join(utilsDir, 'helpers.ts'),
    [
      `/**`,
      ` * ${displayName} 场景通用工具函数`,
      ` */`,
      '',
      `/**`,
      ` * 生成唯一 ID`,
      ` */`,
      `export function generateId(prefix = ''): string {`,
      `  return \`\${prefix}\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 8)}\``,
      `}`,
      '',
      `/**`,
      ` * 延时`,
      ` */`,
      `export function delay(ms: number): Promise<void> {`,
      `  return new Promise(resolve => setTimeout(resolve, ms))`,
      `}`,
      '',
    ].join('\n'),
    'utf-8',
  )

  // 5. prompts/system.md — 编程式场景通常仅需一个系统提示词
  const promptsDir = path.join(localPath, 'prompts')
  ensureDir(promptsDir)
  fs.writeFileSync(
    path.join(promptsDir, 'system.md'),
    [
      `# ${displayName} 系统提示词`,
      '',
      `你是 **${displayName}** 场景的 AI 助手（编程式场景）。`,
      '',
      '## 核心职责',
      `- ${params.descriptionZh || params.description || '通过自定义工具和组件帮助用户完成任务'}`,
      '- 调用场景注册的自定义工具执行业务逻辑',
      '- 与场景 UI 组件协作，提供丰富的交互体验',
      '',
      '## 工具使用',
      '- 优先调用场景提供的自定义工具（如 example_tool）',
      '- 工具调用失败时分析错误原因并提供修复建议',
      '- 复杂任务拆解为多个工具调用逐步完成',
      '',
      '## 行为准则',
      '- 遵循场景配置的工作流程',
      '- 主动澄清不明确的需求',
      '- 遵守安全规则，不执行危险操作',
      '',
    ].join('\n'),
    'utf-8',
  )

  // 6. assets/ — 静态资源目录
  const assetsDir = path.join(localPath, 'assets')
  ensureDir(assetsDir)
  fs.writeFileSync(path.join(assetsDir, '.gitkeep'), '', 'utf-8')

  // 7. README.md
  writeProgrammaticReadme(params, localPath)

  // 8. .gitignore
  fs.writeFileSync(
    path.join(localPath, '.gitignore'),
    [
      'dist/',
      'node_modules/',
      '*.log',
      '.DS_Store',
      '*.tsbuildinfo',
      '',
    ].join('\n'),
    'utf-8',
  )
}

/**
 * 写入声明式场景的 README
 */
function writeDeclarativeReadme(params: CreateProjectFilesParams, localPath: string): void {
  const displayName = params.nameZh || params.name
  fs.writeFileSync(
    path.join(localPath, 'README.md'),
    [
      `# ${displayName}`,
      '',
      `> ${params.descriptionZh || params.description || ''}`,
      '',
      '## 场景信息',
      `- 场景 ID: \`${params.scenarioId}\``,
      `- 版本: \`${params.version || '1.0.0'}\``,
      `- 作者: \`${params.author || 'developer'}\``,
      `- 类型: \`declarative\` (声明式)`,
      '',
      '## 目录结构',
      '```',
      `${params.scenarioId}/`,
      '├── config/',
      '│   └── scenario.json     # 场景配置清单（identity/capabilities/ui/database/scripts）',
      '├── prompts/              # 提示词文件',
      '│   ├── system.md         # 系统提示词',
      '│   ├── security.md       # 安全规则',
      '│   ├── conventions.md    # 编码规范',
      '│   └── workflow.md       # 工作流',
      '├── scripts/              # 生命周期脚本（.js，沙箱执行）',
      '│   ├── onActivate.js     # 激活时执行',
      '│   ├── onDeactivate.js   # 停用时执行',
      '│   └── onHealthCheck.js  # 健康检查',
      '├── db/                   # 数据库脚本',
      '│   ├── install.sql       # 安装时执行',
      '│   └── uninstall.sql     # 卸载时执行',
      '├── assets/               # 静态资源',
      '├── README.md',
      '└── .gitignore',
      '```',
      '',
      '## 开发流程',
      '1. 编辑 `config/scenario.json` 配置场景元数据和能力',
      '2. 编写 `prompts/*.md` 定义 AI 角色、安全规则、规范、工作流',
      '3. 编写 `scripts/*.js` 实现生命周期钩子（可选）',
      '4. 编写 `db/install.sql` 设计数据库表（可选）',
      '5. 使用场景开发助手的 **构建/校验** 功能测试',
      '6. 通过 **安装** 功能部署到本地客户端测试',
      '7. 通过 **发布** 功能上传到开发者中心',
      '',
      '## 文档参考',
      '- [声明式场景详解](https://docs.aweeclaw.com/guide/declarative)',
      '- [清单配置参考](https://docs.aweeclaw.com/guide/manifest)',
      '- [提示词配置](https://docs.aweeclaw.com/guide/prompts)',
      '',
    ].join('\n'),
    'utf-8',
  )
}

/**
 * 写入编程式场景的 README
 */
function writeProgrammaticReadme(params: CreateProjectFilesParams, localPath: string): void {
  const displayName = params.nameZh || params.name
  fs.writeFileSync(
    path.join(localPath, 'README.md'),
    [
      `# ${displayName}`,
      '',
      `> ${params.descriptionZh || params.description || ''}`,
      '',
      '## 场景信息',
      `- 场景 ID: \`${params.scenarioId}\``,
      `- 版本: \`${params.version || '1.0.0'}\``,
      `- 作者: \`${params.author || 'developer'}\``,
      `- 类型: \`programmatic\` (编程式)`,
      '',
      '## 目录结构',
      '```',
      `${params.scenarioId}/`,
      '├── config/',
      '│   └── scenario.json     # 场景元数据 + entryPoint + sharedDeps',
      '├── package.json          # 依赖管理（@aweeclaw/scenario-sdk）',
      '├── tsconfig.json         # TypeScript 配置',
      '├── src/                  # TypeScript 源码',
      '│   ├── index.ts          # 入口文件（默认导出 ScenarioModule）',
      '│   ├── tools/            # 自定义工具',
      '│   │   ├── index.ts',
      '│   │   └── example-tool.ts',
      '│   ├── components/       # React 组件（自定义 UI 面板）',
      '│   ├── hooks/            # 自定义 Hooks',
      '│   └── utils/            # 工具函数',
      '├── prompts/',
      '│   └── system.md         # 系统提示词',
      '├── assets/               # 静态资源',
      '├── README.md',
      '└── .gitignore',
      '```',
      '',
      '## 开发流程',
      '1. 执行 `npm install` 安装依赖',
      '2. 编辑 `src/index.ts` 实现 ScenarioModule 接口',
      '3. 在 `src/tools/` 添加自定义工具',
      '4. 在 `src/components/` 编写 React 组件并在 `getComponents()` 注册',
      '5. 编辑 `prompts/system.md` 定义 AI 角色',
      '6. 使用场景开发助手的 **构建** 功能编译 TypeScript',
      '7. 使用 **校验** 功能检查场景包结构',
      '8. 通过 **安装** 功能部署到本地客户端测试',
      '9. 通过 **发布** 功能上传到开发者中心',
      '',
      '## 构建命令',
      '```bash',
      '# 编译 TypeScript + esbuild bundle',
      'npm run build',
      '',
      '# 监听模式',
      'npm run dev',
      '```',
      '',
      '## 共享依赖',
      '以下依赖由客户端注入，无需打包进场景：',
      '- react ^18.3.0',
      '- react-dom ^18.3.0',
      '- zustand ^5.0.0',
      '- lucide-react ^0.562.0',
      '',
      '## 文档参考',
      '- [编程式场景详解](https://docs.aweeclaw.com/guide/programmatic)',
      '- [模块接口](https://docs.aweeclaw.com/guide/module-interface)',
      '- [UI 组件开发](https://docs.aweeclaw.com/guide/ui-components)',
      '- [共享依赖机制](https://docs.aweeclaw.com/guide/shared-deps)',
      '',
    ].join('\n'),
    'utf-8',
  )
}

// ==========================================
// 文件读写
// ==========================================

interface ReadFileParams {
  projectPath: string
  relativePath: string
}

interface WriteFileParams {
  projectPath: string
  relativePath: string
  content: string
  createDirs?: boolean
}

// ==========================================
// 内嵌构建/打包
// ==========================================

interface ValidateParams {
  projectPath: string
}

interface PackParams {
  projectPath: string
  outputPath?: string
}

interface BuildParams {
  projectPath: string
}

/**
 * 递归读取目录下所有文件，返回相对路径 → 内容的映射
 */
function readProjectFiles(projectPath: string, maxFileSize = 1024 * 1024): Record<string, string> {
  const files: Record<string, string> = {}
  if (!fs.existsSync(projectPath)) return files

  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

      // 跳过 dist/、node_modules/、.git/
      if (entry.isDirectory()) {
        if (['dist', 'node_modules', '.git'].includes(entry.name)) continue
        walk(fullPath, relPath)
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath)
        if (stat.size > maxFileSize) {
          logger.system.warn(`[ScenarioBuilder] Skipping large file: ${relPath} (${stat.size} bytes)`)
          continue
        }
        try {
          files[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch (e) {
          logger.system.warn(`[ScenarioBuilder] Failed to read file ${relPath}:`, e)
        }
      }
    }
  }
  walk(projectPath, '')
  return files
}

/**
 * 读取 config/scenario.json
 */
function readScenarioConfig(projectPath: string): DeclarativeScenarioConfig {
  const configPath = path.join(projectPath, 'config', 'scenario.json')
  if (!fs.existsSync(configPath)) {
    throw new Error('config/scenario.json not found in project directory')
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DeclarativeScenarioConfig
}

/**
 * 内嵌打包：使用 scenario-system/cli 的 packScenario，输出 .aweeclawpkg 文件
 */
function doPack(projectPath: string, outputPath?: string): {
  success: boolean
  packagePath?: string
  size?: number
  hash?: string
  error?: string
} {
  try {
    const config = readScenarioConfig(projectPath)
    const files = readProjectFiles(projectPath)
    const result: PackResult = packScenario(config, files)
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Pack failed' }
    }

    // 输出到文件
    const pkgDir = path.join(projectPath, 'dist')
    ensureDir(pkgDir)
    const fileName = `${config.id}-${config.version}.aweeclawpkg`
    const finalPath = outputPath || path.join(pkgDir, fileName)
    ensureDir(path.dirname(finalPath))

    // 解码 base64 写入（避免大字符串通过 IPC 损耗）
    const buffer = Buffer.from(result.data, 'base64')
    fs.writeFileSync(finalPath, buffer)

    logger.agent.info(`[ScenarioBuilder] Packed scenario "${config.id}" → ${finalPath} (${result.size} bytes)`)

    return {
      success: true,
      packagePath: finalPath,
      size: result.size,
      hash: result.hash,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 内嵌构建：
 * - 声明式场景：校验 + 生成 dist/（拷贝全部源文件 + 编译 scripts/*.ts）
 * - 编程式场景：校验 + 生成 dist/（仅拷贝运行时所需文件 + esbuild bundle src/index.ts）
 */
async function doBuild(projectPath: string): Promise<{
  success: boolean
  output: string
  error?: string
}> {
  const output: string[] = []
  try {
    // 1. 校验
    const config = readScenarioConfig(projectPath)
    const files = readProjectFiles(projectPath)
    const validation = validateScenarioPackage(config, files)
    output.push(`[validate] ${validation.valid ? 'PASSED' : 'FAILED'}`)
    if (validation.errors.length > 0) {
      validation.errors.forEach(e => output.push(`  ERROR: ${e.path}: ${e.message}`))
      return { success: false, output: output.join('\n') }
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => output.push(`  WARN:  ${w.path}: ${w.message}`))
    }

    // 2. 生成 dist/
    const distDir = path.join(projectPath, 'dist')
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true })
    }
    ensureDir(distDir)

    // 3. 判断场景类型（programmatic 通过 packageType 或 entryPoint 识别）
    const configAny = config as unknown as Record<string, unknown>
    const isProgrammatic =
      configAny.packageType === 'programmatic' || typeof configAny.entryPoint === 'string'

    if (isProgrammatic) {
      // 编程式场景：仅拷贝运行时所需文件（不含 src/、tsconfig.json、package.json 等）
      const runtimePrefixes = ['config/', 'prompts/', 'assets/', 'db/']
      let copiedCount = 0
      for (const [relPath, content] of Object.entries(files)) {
        if (!runtimePrefixes.some(p => relPath.startsWith(p))) continue
        const destPath = path.join(distDir, relPath)
        ensureDir(path.dirname(destPath))
        fs.writeFileSync(destPath, content, 'utf-8')
        copiedCount++
      }
      output.push(`[build] Copied ${copiedCount} runtime files to dist/`)

      // 4. 编程式场景：esbuild bundle src/index.ts → dist/index.js
      const entrySource = path.join(projectPath, 'src', 'index.ts')
      const entryOutput = path.join(distDir, 'index.js')
      if (!fs.existsSync(entrySource)) {
        output.push('  ERROR: src/index.ts not found (programmatic scenario requires entry file)')
        return { success: false, output: output.join('\n'), error: 'Entry file src/index.ts not found' }
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const esbuild = require('esbuild')
        await esbuild.build({
          entryPoints: [entrySource],
          outfile: entryOutput,
          bundle: true,
          platform: 'node',
          format: 'esm',
          target: 'node16',
          sourcemap: false,
          logLevel: 'silent',
          // 共享依赖由客户端运行时注入，构建时标记为 external
          external: ['react', 'react-dom', 'react/jsx-runtime', 'zustand', 'lucide-react'],
        })
        output.push('  [esbuild] bundled src/index.ts → index.js')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        output.push(`  ERROR: esbuild bundle failed: ${msg}`)
        return { success: false, output: output.join('\n'), error: `esbuild bundle failed: ${msg}` }
      }
    } else {
      // 声明式场景：拷贝全部源文件到 dist/（保留目录结构）
      for (const [relPath, content] of Object.entries(files)) {
        const destPath = path.join(distDir, relPath)
        ensureDir(path.dirname(destPath))
        fs.writeFileSync(destPath, content, 'utf-8')
      }
      output.push(`[build] Copied ${Object.keys(files).length} files to dist/`)

      // 4. 声明式场景：如存在 scripts/*.ts 生命周期脚本，尝试 esbuild 编译
      if (config.scripts?.onActivateFile || config.scripts?.onDeactivateFile || config.scripts?.tools?.length) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const esbuild = require('esbuild')
          const scriptFiles = new Set<string>()
          if (config.scripts?.onActivateFile) scriptFiles.add(config.scripts.onActivateFile)
          if (config.scripts?.onDeactivateFile) scriptFiles.add(config.scripts.onDeactivateFile)
          config.scripts?.tools?.forEach(t => scriptFiles.add(t.scriptFile))

          for (const scriptFile of scriptFiles) {
            const srcPath = path.join(projectPath, scriptFile)
            if (!fs.existsSync(srcPath)) {
              output.push(`  WARN: script not found: ${scriptFile}`)
              continue
            }
            const destPath = path.join(distDir, scriptFile.replace(/\.ts$/, '.js'))
            ensureDir(path.dirname(destPath))
            await esbuild.build({
              entryPoints: [srcPath],
              outfile: destPath,
              bundle: true,
              platform: 'node',
              format: 'cjs',
              target: 'node16',
              sourcemap: false,
              logLevel: 'silent',
            })
            output.push(`  [esbuild] bundled ${scriptFile} → ${scriptFile.replace(/\.ts$/, '.js')}`)
          }
        } catch (e) {
          output.push(`  WARN: esbuild not available, scripts copied as-is: ${e instanceof Error ? e.message : ''}`)
        }
      }
    }

    output.push('[build] SUCCESS')
    return { success: true, output: output.join('\n') }
  } catch (err) {
    output.push(`[build] FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, output: output.join('\n'), error: err instanceof Error ? err.message : String(err) }
  }
}

// ==========================================
// 试运行（P3）
// ==========================================

/** 试运行场景注册表：scenarioId → projectPath */
const tryRunRegistry = new Map<string, string>()

function startTryRun(projectPath: string): { success: boolean; scenarioId?: string; error?: string } {
  try {
    const config = readScenarioConfig(projectPath)
    const scenarioId = config.id

    // 标记为试运行（场景加载器会优先检查此注册表）
    tryRunRegistry.set(scenarioId, projectPath)

    // 通过 webContents 通知渲染进程刷新场景列表
    // 实际加载由渲染进程的 ScenarioLoader 完成
    return { success: true, scenarioId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function stopTryRun(scenarioId: string): { success: boolean } {
  tryRunRegistry.delete(scenarioId)
  return { success: true }
}

function isTryRunning(scenarioId: string): boolean {
  return tryRunRegistry.has(scenarioId)
}

function getTryRunPath(scenarioId: string): string | null {
  return tryRunRegistry.get(scenarioId) || null
}

// ==========================================
// 开发者中心认证与发布
// ==========================================

interface DeveloperAuthInfo {
  loggedIn: boolean
  developerName?: string
  token?: string
}

interface PublishParams {
  scenarioId: string
  version: string
  name: string
  nameZh: string
  type: string
  category: string
  permissions?: string[]
  changelog?: string
  packagePath: string
  backendUrl?: string
}

/**
 * 读取开发者认证信息（存储于 userData/developer-auth.json）
 */
function readDeveloperAuth(): DeveloperAuthInfo {
  const authPath = path.join(app.getPath('userData'), 'developer-auth.json')
  return readJsonFile<DeveloperAuthInfo>(authPath, { loggedIn: false })
}

/**
 * 主进程使用 Electron net 发起 multipart/form-data 文件上传
 */
async function uploadScenarioPackage(
  getMainWindow: () => BrowserWindow | null,
  params: PublishParams,
  token: string,
): Promise<{ success: boolean; marketplaceId?: string; downloadUrl?: string; error?: string }> {
  const { net } = require('electron')
  const backendUrl = params.backendUrl || 'https://developer.aweeclaw.com'
  const url = `${backendUrl}/api/v1/marketplace/developer/${params.scenarioId}/upload-package`

  if (!fs.existsSync(params.packagePath)) {
    return { success: false, error: `Package file not found: ${params.packagePath}` }
  }

  const fileBuffer = fs.readFileSync(params.packagePath)
  const fileName = path.basename(params.packagePath)
  const boundary = `----AweeClawFormBoundary${Date.now().toString(16)}`

  // 构造 multipart/form-data body
  const parts: Buffer[] = []

  // metadata 字段
  const metadata = {
    id: params.scenarioId,
    version: params.version,
    name: params.name,
    nameZh: params.nameZh,
    type: params.type,
    category: params.category,
    permissions: params.permissions || [],
    changelog: params.changelog || `Release ${params.version}`,
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    ),
  )

  // 文件字段
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  return new Promise(resolve => {
    const request = net.request({
      url,
      method: 'POST',
    })
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
    request.setHeader('Authorization', `Bearer ${token}`)
    request.setHeader('Content-Length', String(body.length))

    let data = ''
    request.on('response', (response: Electron.IncomingMessage) => {
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      response.on('end', () => {
        const ok = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300
        if (!ok) {
          resolve({ success: false, error: `HTTP ${response.statusCode}: ${data.slice(0, 500)}` })
          return
        }
        try {
          const parsed = JSON.parse(data)
          resolve({
            success: true,
            marketplaceId: parsed.id || parsed.scenarioId,
            downloadUrl: parsed.downloadUrl,
          })
        } catch {
          resolve({ success: true })
        }
      })
      response.on('error', (err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
    request.on('error', (err: Error) => {
      resolve({ success: false, error: err.message })
    })
    request.write(body)
    request.end()

    // 通知主窗口（用于 UI 显示上传进度）
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('scenario-builder:publishProgress', {
        scenarioId: params.scenarioId,
        phase: 'uploading',
        bytesTotal: body.length,
      })
    }
  })
}

// ==========================================
// IPC Handler 注册
// ==========================================

export function registerScenarioBuilderIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // ─── 项目骨架创建 ─────────────────────────────────────
  safeIpcHandle('scenario-builder:createProjectFiles', async (_event, params: CreateProjectFilesParams) => {
    try {
      if (!params.localPath || !params.scenarioId || !params.name) {
        return { success: false, error: 'Missing required fields: localPath, scenarioId, name' }
      }
      if (fs.existsSync(params.localPath) && fs.readdirSync(params.localPath).length > 0) {
        return { success: false, error: `Directory not empty: ${params.localPath}` }
      }
      createProjectScaffold(params)
      logger.agent.info(`[ScenarioBuilder] Created project scaffold at ${params.localPath}`)
      return { success: true, localPath: params.localPath }
    } catch (err) {
      logger.agent.error('[ScenarioBuilder] createProjectFiles failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 文件读取 ───────────────────────────────────────
  safeIpcHandle('scenario-builder:readFile', async (_event, params: ReadFileParams) => {
    try {
      const fullPath = safeJoinPath(params.projectPath, params.relativePath)
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${params.relativePath}`, content: '' }
      }
      const stat = fs.statSync(fullPath)
      if (stat.size > 5 * 1024 * 1024) {
        return { success: false, error: 'File too large (max 5MB)', content: '' }
      }
      const content = fs.readFileSync(fullPath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), content: '' }
    }
  })

  // ─── 文件写入 ───────────────────────────────────────
  safeIpcHandle('scenario-builder:writeFile', async (_event, params: WriteFileParams) => {
    try {
      const fullPath = safeJoinPath(params.projectPath, params.relativePath)
      if (params.createDirs !== false) {
        ensureDir(path.dirname(fullPath))
      }
      fs.writeFileSync(fullPath, params.content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 校验 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:validate', async (_event, params: ValidateParams) => {
    try {
      const config = readScenarioConfig(params.projectPath)
      const files = readProjectFiles(params.projectPath)
      const result = validateScenarioPackage(config, files)
      return {
        success: true,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        structure: result.structure,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 构建 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:build', async (_event, params: BuildParams) => {
    const result = await doBuild(params.projectPath)
    return result
  })

  // ─── 打包 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:pack', async (_event, params: PackParams) => {
    return doPack(params.projectPath, params.outputPath)
  })

  // ─── 试运行 ─────────────────────────────────────────
  safeIpcHandle('scenario-builder:tryRunStart', async (_event, params: { projectPath: string }) => {
    return startTryRun(params.projectPath)
  })
  safeIpcHandle('scenario-builder:tryRunStop', async (_event, params: { scenarioId: string }) => {
    return stopTryRun(params.scenarioId)
  })
  safeIpcHandle('scenario-builder:tryRunStatus', async (_event, params: { scenarioId: string }) => {
    return { running: isTryRunning(params.scenarioId), projectPath: getTryRunPath(params.scenarioId) }
  })

  // ─── 卸载 ──────────────────────────────────────────
  safeIpcHandle('scenario:uninstall', async (_event, scenarioId: string) => {
    try {
      const scenarioDir = getScenarioDir(scenarioId)
      if (!fs.existsSync(scenarioDir)) {
        return { success: false, error: `Scenario not installed: ${scenarioId}` }
      }
      // 尝试执行卸载 SQL 脚本
      try {
        const config = readScenarioConfig(scenarioDir)
        if (config.database?.uninstallScripts && config.database.uninstallScripts.length > 0) {
          logger.agent.info(`[ScenarioUninstall] Running ${config.database.uninstallScripts.length} uninstall scripts for "${scenarioId}"`)
          // 实际 SQL 执行通过 scenario-db:drop IPC 完成（由渲染进程触发）
        }
      } catch {
        // 配置读取失败不阻塞卸载
      }
      fs.rmSync(scenarioDir, { recursive: true, force: true })
      logger.agent.info(`[ScenarioUninstall] Removed scenario "${scenarioId}" from ${scenarioDir}`)
      return { success: true }
    } catch (err) {
      logger.agent.error(`[ScenarioUninstall] Failed for "${scenarioId}":`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 开发者中心认证 ─────────────────────────────────
  safeIpcHandle('developer:checkAuth', async () => {
    const auth = readDeveloperAuth()
    return {
      loggedIn: auth.loggedIn,
      developerName: auth.developerName,
    }
  })

  safeIpcHandle('developer:logout', async () => {
    const authPath = path.join(app.getPath('userData'), 'developer-auth.json')
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath)
    }
    return { success: true }
  })

  safeIpcHandle('developer:saveAuth', async (_event, auth: DeveloperAuthInfo) => {
    try {
      writeJsonFile(path.join(app.getPath('userData'), 'developer-auth.json'), auth)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 发布到开发者中心 ────────────────────────────────
  safeIpcHandle('developer:publishScenario', async (_event, params: PublishParams) => {
    try {
      const auth = readDeveloperAuth()
      if (!auth.loggedIn || !auth.token) {
        return { success: false, error: 'Not logged in to developer center' }
      }

      const result = await uploadScenarioPackage(getMainWindow, params, auth.token)
      return result
    } catch (err) {
      logger.agent.error('[ScenarioBuilder] publishScenario failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/**
 * 导出试运行注册表查询（供场景加载器调用）
 * 当渲染进程尝试加载场景时，先查询此注册表，若有则从项目目录加载
 */
export function getTryRunProjectPath(scenarioId: string): string | null {
  return tryRunRegistry.get(scenarioId) || null
}
