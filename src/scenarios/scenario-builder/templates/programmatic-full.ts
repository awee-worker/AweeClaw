/**
 * 编程式完整模板
 *
 * 完整编程式场景：TypeScript 入口 + UI 组件 + 工具 + 服务 + 数据库。
 * 演示编程式场景的全套能力，适合开发需要自定义界面与数据持久化的复杂场景。
 */
import type { ScenarioTemplate } from './types'

export const programmaticFullTemplate: ScenarioTemplate = {
  id: 'programmatic-full',
  name: 'Programmatic Full',
  nameZh: '编程式完整',
  description: 'Full programmatic scenario with UI, tools, services, database',
  descriptionZh: '完整编程式场景，含 UI 组件、工具、服务、数据库，演示全套能力',
  type: 'programmatic',
  category: 'advanced',
  icon: 'LayoutDashboard',
  tags: ['code', 'typescript', 'ui', 'tools', 'database', 'advanced'],
  scenarioConfigOverride: {
    icon: 'LayoutDashboard',
    permissions: ['workspace:read', 'workspace:write', 'web:search', 'database:query'],
    sharedDeps: {
      react: '^18.3.0',
      'react-dom': '^18.3.0',
      'react/jsx-runtime': '^18.3.0',
      zustand: '^5.0.0',
      'lucide-react': '^0.562.0',
    },
  },
  // 覆盖默认 src/index.ts，提供完整实现
  overrideFiles: {
    'src/index.ts': `/**
 * {{name}} 场景入口（完整编程式场景）
 *
 * 演示编程式场景的全套能力：
 * - 自定义 UI 组件（DashboardPanel、SettingsPanel）
 * - 自定义工具（manage_records）
 * - 数据库服务（ExampleService）
 * - 完整生命周期
 */
import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioToolDefinition,
  ScenarioHealthCheck,
} from '@aweeclaw/scenario-sdk'
import { exampleService } from './services/ExampleService'

export default {
  id: '{{scenarioId}}',
  version: '{{version}}',

  getManifest() {
    return {
      id: '{{scenarioId}}',
      version: '{{version}}',
      name: '{{name}}',
      nameZh: '{{name}}',
      description: {{descriptionJson}},
      descriptionZh: {{descriptionJson}},
      author: '{{author}}',
      icon: 'LayoutDashboard',
      category: 'custom',
      tags: ['full', 'example'],
      minAppVersion: '1.0.0',
      permissions: ['workspace:read', 'workspace:write', 'web:search', 'database:query'],
      dependencies: [],
    }
  },

  getPlugin() {
    return {
      id: '{{scenarioId}}',
      name: '{{name}}',
      nameZh: '{{name}}',
      icon: 'LayoutDashboard',
      description: {{descriptionJson}},
      descriptionZh: {{descriptionJson}},
      version: '{{version}}',
      author: '{{author}}',
      category: 'custom',
      tags: ['full', 'example'],
      identity: {
        systemPromptFile: 'prompts/system.md',
      },
      capabilities: {
        toolPacks: ['code'],
        modes: [
          {
            id: 'chat',
            label: 'Chat',
            labelZh: '对话',
            icon: 'MessageSquare',
            description: 'Standard chat mode',
            descriptionZh: '标准对话模式',
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
        layout: 'editor-centric',
        wideModeHidesChat: false,
        panels: [
          { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
          { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 170, maxWidth: 600 },
          { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
        ],
        sidebarItems: [
          { id: 'dashboard', icon: 'LayoutDashboard', label: 'Dashboard', labelZh: '仪表盘', component: 'DashboardPanel', position: 0, wideMode: true },
          { id: 'settings', icon: 'Settings', label: 'Settings', labelZh: '设置', component: 'SettingsPanel', position: 1, wideMode: true },
        ],
        statusBarItems: [],
      },
      dataSources: { workspace: true },
    }
  },

  getTools(): ScenarioToolDefinition[] {
    return [
      {
        name: 'manage_records',
        definition: {
          name: 'manage_records',
          description: 'Manage records in the scenario database (list/create/update/delete)',
          descriptionZh: '管理场景数据库中的记录（列表/创建/更新/删除）',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'create', 'update', 'delete'],
                description: 'Action to perform',
                descriptionZh: '执行的操作',
              },
              id: { type: 'string', description: 'Record ID (for update/delete)' },
              data: { type: 'object', description: 'Record data (for create/update)' },
            },
            required: ['action'],
          },
        },
        executor: async (args) => {
          const action = args.action as string
          try {
            switch (action) {
              case 'list':
                return { success: true, data: await exampleService.listRecords() }
              case 'create':
                return { success: true, data: await exampleService.createRecord(args.data as Record<string, unknown>) }
              case 'update':
                return { success: true, data: await exampleService.updateRecord(args.id as string, args.data as Record<string, unknown>) }
              case 'delete':
                return { success: true, data: await exampleService.deleteRecord(args.id as string) }
              default:
                return { success: false, error: 'Unknown action: ' + action }
            }
          } catch (err) {
            return { success: false, error: (err as Error).message }
          }
        },
      },
    ]
  },

  getComponents() {
    return {
      DashboardPanel: DashboardPanel,
      SettingsPanel: SettingsPanel,
    }
  },

  async onActivate(context: ScenarioModuleContext) {
    context.logger.info('[{{scenarioId}}] 场景已激活')
    exampleService.setContext(context)
  },

  async onDeactivate(context: ScenarioModuleContext) {
    context.logger.info('[{{scenarioId}}] 场景已停用')
    exampleService.clearContext()
  },

  async onHealthCheck(): Promise<ScenarioHealthCheck[]> {
    return [
      { name: 'database', status: 'healthy', message: 'Database accessible' },
      { name: 'module', status: 'healthy', message: 'Module ready' },
    ]
  },
} satisfies ScenarioModule

// UI 组件需要在文件顶部 import（避免运行时循环依赖）
// 此处由模板生成时通过 extraFiles 提供
import DashboardPanel from './components/DashboardPanel'
import SettingsPanel from './components/SettingsPanel'
`,
  },
  // 额外文件：UI 组件 + 服务
  extraFiles: {
    'src/components/DashboardPanel.tsx': `/**
 * {{name}} 仪表盘组件
 */
import { useState, useEffect } from 'react'
import { exampleService } from '../services/ExampleService'

interface Record {
  id: string
  data: Record<string, unknown>
  created_at: string
}

export default function DashboardPanel() {
  const [records, setRecords] = useState<Record[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const result = await exampleService.listRecords()
        setRecords(result)
      } catch (err) {
        console.error('Failed to load records:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="p-4 text-sm text-muted-foreground">加载中...</div>

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">仪表盘</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">共 {records.length} 条记录</p>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {records.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground">暂无记录</div>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.id} className="rounded border border-border p-2 text-xs">
                <div className="font-mono text-muted-foreground">{r.id}</div>
                <pre className="mt-1 text-xs whitespace-pre-wrap">{JSON.stringify(r.data, null, 2)}</pre>
                <div className="mt-1 text-xs text-muted-foreground">{r.created_at}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
`,
    'src/components/SettingsPanel.tsx': `/**
 * {{name}} 设置组件
 */
import { useState } from 'react'

export default function SettingsPanel() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [pageSize, setPageSize] = useState(20)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">设置</h2>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">自动刷新</div>
            <div className="text-xs text-muted-foreground">数据变更时自动刷新列表</div>
          </div>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-accent' : 'bg-muted'}
            style={{ width: 40, height: 20, borderRadius: 10 }}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">每页数量</div>
            <div className="text-xs text-muted-foreground">列表分页大小</div>
          </div>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </div>
      </div>
    </div>
  )
}
`,
    'src/services/ExampleService.ts': `/**
 * {{name}} 示例数据库服务
 */
import type { ScenarioModuleContext } from '@aweeclaw/scenario-sdk'

export class ExampleService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  clearContext(): void {
    this.context = null
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('ExampleService: context not set')
    }
    return this.context
  }

  async listRecords(): Promise<Array<{ id: string; data: Record<string, unknown>; created_at: string }>> {
    const ctx = this.getContext()
    const result = await ctx.executeSql('SELECT id, data, created_at FROM records ORDER BY created_at DESC LIMIT 100')
    if (!result.success) {
      throw new Error('listRecords failed: ' + result.error)
    }
    return (result.rows || []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      data: typeof row.data === 'string' ? JSON.parse(row.data as string) : row.data as Record<string, unknown>,
      created_at: row.created_at as string,
    }))
  }

  async createRecord(data: Record<string, unknown>): Promise<{ id: string }> {
    const ctx = this.getContext()
    const id = 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const now = new Date().toISOString()
    const dataJson = JSON.stringify(data)
    const result = await ctx.executeSql(
      'INSERT INTO records (id, data, created_at, updated_at) VALUES (' +
      this.escape(id) + ', ' + this.escape(dataJson) + ', ' + this.escape(now) + ', ' + this.escape(now) + ')'
    )
    if (!result.success) {
      throw new Error('createRecord failed: ' + result.error)
    }
    return { id }
  }

  async updateRecord(id: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const ctx = this.getContext()
    const now = new Date().toISOString()
    const dataJson = JSON.stringify(data)
    const result = await ctx.executeSql(
      'UPDATE records SET data = ' + this.escape(dataJson) + ', updated_at = ' + this.escape(now) + ' WHERE id = ' + this.escape(id)
    )
    if (!result.success) {
      throw new Error('updateRecord failed: ' + result.error)
    }
    return { id }
  }

  async deleteRecord(id: string): Promise<{ id: string }> {
    const ctx = this.getContext()
    const result = await ctx.executeSql('DELETE FROM records WHERE id = ' + this.escape(id))
    if (!result.success) {
      throw new Error('deleteRecord failed: ' + result.error)
    }
    return { id }
  }

  private escape(val: string): string {
    return "'" + String(val).replace(/'/g, "''") + "'"
  }
}

export const exampleService = new ExampleService()
`,
  },
  variables: [
    {
      key: 'name',
      label: '场景显示名',
      labelEn: 'Display Name',
      defaultValue: 'Full Scenario',
      required: true,
      placeholder: '完整场景',
    },
    {
      key: 'description',
      label: '场景描述',
      labelEn: 'Description',
      defaultValue: '具备 UI、工具、数据库的完整编程式场景',
      required: false,
      placeholder: '说明这个场景能做什么',
    },
  ],
  previewStructure: [
    'config/scenario.json',
    'package.json',
    'tsconfig.json',
    'src/index.ts',
    'src/components/DashboardPanel.tsx',
    'src/components/SettingsPanel.tsx',
    'src/services/ExampleService.ts',
    'prompts/system.md',
    'db/install.sql',
    'assets/',
  ],
}
