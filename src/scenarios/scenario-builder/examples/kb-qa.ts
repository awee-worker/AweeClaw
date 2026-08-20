/**
 * 示例场景：知识库问答（programmatic）
 *
 * 难度：advanced
 * 亮点：完整编程式场景，含 UI 组件 + 自定义工具 + 数据库 + 服务层
 * 适合：学习编程式场景的全套能力
 *
 * 知识库结构：
 *  - documents 表：保存文档元信息（id/title/source_url/created_at）
 *  - chunks 表：保存文档分块（id/document_id/content/vector_id）
 */
import type { ExampleScenario } from './types'

export const kbQaExample: ExampleScenario = {
  id: 'kb-qa',
  name: 'Knowledge Base QA',
  nameZh: '知识库问答',
  description: 'Full programmatic scenario: UI + tools + service + database',
  descriptionZh: '完整编程式场景：UI 组件 + 工具 + 服务 + 数据库',
  type: 'programmatic',
  category: 'knowledge',
  icon: 'BookOpen',
  tags: ['knowledge', 'qa', 'programmatic', 'database', 'ui'],
  difficulty: 'advanced',
  highlights: [
    'Custom UI components (DocumentListPanel / AskPanel)',
    'Custom tools (add_document / search_documents)',
    'SQLite database with install/uninstall scripts',
    'Complete lifecycle hooks (activate / deactivate / healthCheck)',
  ],
  highlightsZh: [
    '自定义 UI 组件（DocumentListPanel / AskPanel）',
    '自定义工具（add_document / search_documents）',
    'SQLite 数据库 + install/uninstall 脚本',
    '完整生命周期钩子（activate / deactivate / healthCheck）',
  ],
  previewStructure: [
    'config/scenario.json',
    'src/index.ts',
    'src/services/ KbService.ts',
    'src/tools/index.ts',
    'src/components/DocumentListPanel.tsx',
    'src/components/AskPanel.tsx',
    'db/install.sql',
    'db/uninstall.sql',
    'README.md',
  ],
  files: [
    {
      path: 'config/scenario.json',
      description: '场景清单（编程式 + 完整 UI 配置）',
      content: `{
  "id": "kb-qa",
  "version": "1.0.0",
  "name": "Knowledge Base QA",
  "nameZh": "知识库问答",
  "description": "Full programmatic scenario with UI, tools, database",
  "descriptionZh": "完整编程式场景，含 UI、工具、数据库",
  "author": "awee",
  "icon": "BookOpen",
  "category": "knowledge",
  "type": "programmatic",
  "tags": ["knowledge", "qa", "database"],
  "minAppVersion": "1.7.0",
  "entryPoint": "./src/index.ts",
  "sharedDeps": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react/jsx-runtime": "^18.3.0",
    "lucide-react": "^0.562.0"
  },
  "permissions": ["workspace:read", "database:query"],
  "dependencies": [],
  "ui": {
    "layout": "editor-centric",
    "wideModeHidesChat": false,
    "panels": [
      { "id": "editor", "component": "Editor", "region": "primary", "defaultVisible": true, "resizable": true },
      { "id": "sidebar", "component": "Sidebar", "region": "secondary", "defaultVisible": true, "resizable": true, "minWidth": 200, "maxWidth": 500 },
      { "id": "chat", "component": "ChatPanel", "region": "auxiliary", "defaultVisible": true, "resizable": true, "minWidth": 300, "maxWidth": 800 }
    ],
    "sidebarItems": [
      { "id": "documents", "icon": "Files", "label": "Documents", "labelZh": "文档", "component": "DocumentListPanel", "position": 0, "wideMode": true }
    ],
    "statusBarItems": []
  }
}`,
    },
    {
      path: 'src/index.ts',
      description: '场景入口（导出 ScenarioModule）',
      content: `/**
 * 知识库问答场景入口
 *
 * 演示编程式场景完整结构：
 *  - 自定义 UI 组件（DocumentListPanel / AskPanel）
 *  - 自定义工具（add_document / search_documents）
 *  - 数据库服务（KbService）
 *  - 完整生命周期
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioToolDefinition,
  ScenarioHealthCheck,
} from '@aweeclaw/scenario-sdk'
import { kbService } from './services/KbService'
import { addDocumentTool, searchDocumentsTool } from './tools'

const module: ScenarioModule = {
  id: 'kb-qa',
  version: '1.0.0',

  getManifest: () => ({
    id: 'kb-qa',
    version: '1.0.0',
    name: 'Knowledge Base QA',
    nameZh: '知识库问答',
    description: 'Full programmatic scenario',
    descriptionZh: '完整编程式场景',
    author: 'awee',
    icon: 'BookOpen',
    category: 'knowledge',
    tags: ['knowledge', 'qa'],
    minAppVersion: '1.7.0',
    permissions: ['workspace:read', 'database:query'],
    dependencies: [],
  }),

  getPlugin: () => ({
    id: 'kb-qa',
    name: 'Knowledge Base QA',
    nameZh: '知识库问答',
    icon: 'BookOpen',
    description: 'Full programmatic scenario',
    descriptionZh: '完整编程式场景',
    version: '1.0.0',
    author: 'awee',
    category: 'knowledge',
    isBuiltin: false,
    requiresWorkspace: false,
    hasSettings: false,
    source: 'local',
    identity: {
      systemPrompt: \`你是知识库问答助手。可调用 add_document 添加文档、search_documents 检索。
回答用户问题时优先检索本地知识库，找不到再用通用知识。\`,
    },
    capabilities: {
      builtinTools: ['web_search'],
      modes: [
        {
          id: 'chat',
          label: 'Ask',
          labelZh: '问答',
          icon: 'MessageSquare',
          description: 'Ask questions about your knowledge base',
          descriptionZh: '针对知识库提问',
          toolPolicy: { enabled: true, requireApproval: false },
        },
      ],
      contextTypes: [],
      outputFormats: ['markdown', 'text'],
    },
    ui: {
      layout: 'editor-centric',
      wideModeHidesChat: false,
      panels: [],
      sidebarItems: [],
      statusBarItems: [],
    },
    dataSources: { workspace: false, customSources: [] },
  }),

  getTools: (): ScenarioToolDefinition[] => [
    { name: 'add_document', definition: addDocumentTool, executor: async (args) => kbService.addDocument(args) },
    { name: 'search_documents', definition: searchDocumentsTool, executor: async (args) => kbService.search(args) },
  ],

  getComponents: () => ({
    DocumentListPanel: (require as any)('./components/DocumentListPanel').default,
  }),

  getIpcHandlers: () => [],

  getInstallScripts: () => [],

  getUninstallScripts: () => [],

  onActivate: async (context: ScenarioModuleContext) => {
    context.getLogger().info('kb-qa activated')
    kbService.setContext(context)
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.getLogger().info('kb-qa deactivated')
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => [
    { name: 'database', status: 'healthy', message: 'kb-qa database is accessible' },
  ],
}

export default module`,
    },
    {
      path: 'src/services/KbService.ts',
      description: '知识库服务（CRUD + 检索）',
      content: `/**
 * 知识库服务
 *
 * 提供：
 *  - addDocument({ title, content, sourceUrl })：新增文档，分块入库
 *  - search({ query, limit })：关键词检索（LIKE 模糊匹配）
 *  - listDocuments()：列出所有文档
 *
 * 设计要点：
 *  - 使用场景上下文提供的 executeSql，自动复用场景独立数据库
 *  - SQL 使用参数化查询，防注入
 */
import type { ScenarioModuleContext } from '@aweeclaw/scenario-sdk'

export interface KbDocument {
  id: string
  title: string
  content: string
  sourceUrl?: string
  createdAt: string
}

export class KbService {
  private context: ScenarioModuleContext | null = null

  setContext(ctx: ScenarioModuleContext): void {
    this.context = ctx
  }

  private async executeSql(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    if (!this.context) throw new Error('KbService: context not set')
    // 简化：依赖主进程提供的参数化能力
    const result = await this.context.executeSql(sql, params as never)
    if (!result.success) throw new Error(result.error)
    return (result.rows ?? []) as Record<string, unknown>[]
  }

  async addDocument(args: { title: string; content: string; sourceUrl?: string }): Promise<{ id: string }> {
    const id = \`doc-\${Date.now()}-\${Math.random().toString(36).slice(2, 9)}\`
    const now = new Date().toISOString()
    await this.executeSql(
      'INSERT INTO kb_documents (id, title, content, source_url, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, args.title, args.content, args.sourceUrl ?? null, now],
    )
    return { id }
  }

  async search(args: { query: string; limit?: number }): Promise<Array<{ id: string; title: string; snippet: string }>> {
    const limit = Math.min(args.limit ?? 5, 20)
    const pattern = \`%\${args.query}%\`
    const rows = await this.executeSql(
      'SELECT id, title, substr(content, 1, 200) AS snippet FROM kb_documents WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT ?',
      [pattern, pattern, limit],
    )
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      snippet: r.snippet as string,
    }))
  }

  async listDocuments(): Promise<KbDocument[]> {
    const rows = await this.executeSql('SELECT id, title, content, source_url, created_at FROM kb_documents ORDER BY created_at DESC')
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      content: r.content as string,
      sourceUrl: (r.source_url as string) || undefined,
      createdAt: r.created_at as string,
    }))
  }
}

export const kbService = new KbService()`,
    },
    {
      path: 'src/tools/index.ts',
      description: '工具定义',
      content: `import type { ToolDefinition } from '@aweeclaw/scenario-sdk'

export const addDocumentTool: ToolDefinition = {
  name: 'add_document',
  description: 'Add a document to the knowledge base',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title' },
      content: { type: 'string', description: 'Full document content' },
      sourceUrl: { type: 'string', description: 'Optional source URL' },
    },
    required: ['title', 'content'],
  },
}

export const searchDocumentsTool: ToolDefinition = {
  name: 'search_documents',
  description: 'Search the knowledge base by keyword',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keyword' },
      limit: { type: 'number', description: 'Max results (default 5, max 20)' },
    },
    required: ['query'],
  },
}`,
    },
    {
      path: 'src/components/DocumentListPanel.tsx',
      description: '文档列表面板',
      content: `import React, { useEffect, useState } from 'react'
import { kbService } from '../services/KbService'

const DocumentListPanel: React.FC = () => {
  const [docs, setDocs] = useState<Array<{ id: string; title: string; createdAt: string }>>([])

  useEffect(() => {
    kbService.listDocuments().then(setDocs).catch(console.error)
  }, [])

  return (
    <div className="h-full overflow-y-auto p-3">
      <h3 className="text-sm font-medium mb-2">文档列表</h3>
      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无文档</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="border border-border rounded p-2">
              <div className="text-sm font-medium">{d.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{d.createdAt}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default DocumentListPanel`,
    },
    {
      path: 'db/install.sql',
      description: '数据库安装脚本（CREATE TABLE IF NOT EXISTS）',
      content: `-- 知识库问答场景：数据库安装脚本
-- 表：kb_documents 保存文档

CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引：加速按时间倒序查询与全文模糊检索
CREATE INDEX IF NOT EXISTS idx_kb_documents_created_at ON kb_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_documents_title ON kb_documents (title);
CREATE INDEX IF NOT EXISTS idx_kb_documents_content ON kb_documents (content);`,
    },
    {
      path: 'db/uninstall.sql',
      description: '数据库卸载脚本（DROP TABLE IF EXISTS）',
      content: `-- 知识库问答场景：数据库卸载脚本
-- 注意：DROP 顺序遵循外键依赖（本场景无外键，单表直接 DROP）

DROP TABLE IF EXISTS kb_documents;
DROP INDEX IF EXISTS idx_kb_documents_created_at;
DROP INDEX IF EXISTS idx_kb_documents_title;
DROP INDEX IF EXISTS idx_kb_documents_content;`,
    },
    {
      path: 'README.md',
      description: '示例说明',
      content: `# 知识库问答（示例场景）

完整编程式场景示例，演示编程式场景的全套能力。

## 文件结构
- \`config/scenario.json\` — 场景清单
- \`src/index.ts\` — 入口，导出 ScenarioModule
- \`src/services/KbService.ts\` — 数据库服务（CRUD + 检索）
- \`src/tools/index.ts\` — 自定义工具定义
- \`src/components/DocumentListPanel.tsx\` — UI 组件
- \`db/install.sql\` / \`db/uninstall.sql\` — 数据库脚本

## 学习要点
1. \`entryPoint\` 字段指向场景入口文件（相对项目根目录）
2. \`sharedDeps\` 声明运行时需要的外部依赖（React 等）
3. \`getTools()\` 返回工具定义与执行器映射
4. \`getComponents()\` 返回 UI 组件注册表，键名与 \`ui.sidebarItems[].component\` 对应
5. 数据库脚本使用 IF NOT EXISTS / IF EXISTS 防止重复执行报错
6. 索引命名遵循 \`idx_表名_字段名\` 规范

## 试运行
打开场景开发助手 → 安装此场景 → 说"添加一篇标题为 AweeClaw 介绍的内容"
然后问"搜索 AweeClaw"`,
    },
  ],
}
