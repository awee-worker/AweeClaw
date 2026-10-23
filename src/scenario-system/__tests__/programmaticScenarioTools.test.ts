import { describe, it, expect } from 'vitest'
import { ProgrammaticScenarioModule } from '../core/ProgrammaticScenarioModule'
import { getToolsForContext } from '@configuration/toolCategoryDefs'
import type { ScenarioToolDefinition } from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'

const CONFIG = {
  id: 'proto-studio',
  version: '1.0.0',
  name: 'Proto Studio',
  nameZh: 'UI 原型工坊',
  entryPoint: 'dist/index.js',
}

function makeTool(name: string): ScenarioToolDefinition {
  return {
    name,
    definition: { name, description: name, parameters: { type: 'object', properties: {} } },
    executor: async () => ({ success: true, result: '' }),
  }
}

/** moduleExports 由 loadModule 注入，测试里直接放置等价的 bundle 导出 */
function createModule(options: {
  tools?: ScenarioToolDefinition[]
  plugin?: Partial<ScenarioPlugin>
  toolsThrows?: boolean
}): ProgrammaticScenarioModule {
  const module = new ProgrammaticScenarioModule(CONFIG)
  ;(module as unknown as { moduleExports: unknown }).moduleExports = {
    getPlugin: () => options.plugin ?? {},
    getTools: () => {
      if (options.toolsThrows) throw new Error('bundle not ready')
      return options.tools ?? []
    },
  }
  return module
}

describe('编程式场景：工具名回流到 capabilities.tools', () => {
  it('getTools() 注册的工具名会进入 capabilities.tools', () => {
    const module = createModule({
      tools: [makeTool('proto_get_canvas'), makeTool('proto_generate_page')],
    })

    expect(module.getPlugin().capabilities.tools).toEqual([
      'proto_get_canvas',
      'proto_generate_page',
    ])
  })

  it('bundle 显式声明的工具名与注册的工具名合并去重', () => {
    const module = createModule({
      tools: [makeTool('proto_get_canvas'), makeTool('proto_apply_patch')],
      plugin: { capabilities: { tools: ['proto_get_canvas', 'proto_audit_accessibility'] } as never },
    })

    const tools = module.getPlugin().capabilities.tools ?? []
    expect(tools).toContain('proto_get_canvas')
    expect(tools).toContain('proto_apply_patch')
    expect(tools).toContain('proto_audit_accessibility')
    expect(tools.filter(name => name === 'proto_get_canvas')).toHaveLength(1)
  })

  it('getTools() 抛错时不阻断插件配置加载，保留已声明的工具名', () => {
    const module = createModule({
      toolsThrows: true,
      plugin: { capabilities: { tools: ['proto_get_canvas'] } as never },
    })

    expect(module.getPlugin().capabilities.tools).toEqual(['proto_get_canvas'])
  })

  it('没有工具时 capabilities.tools 为 undefined，不产生空数组', () => {
    const module = createModule({ tools: [] })

    expect(module.getPlugin().capabilities.tools).toBeUndefined()
  })

  it('端到端：会话边界的 proto_* 白名单能命中场景工具', () => {
    const module = createModule({
      tools: [makeTool('proto_get_canvas'), makeTool('proto_generate_page')],
      plugin: {
        capabilities: { toolPacks: ['proto'] } as never,
        sessionScope: { boundary: '只画原型', allowedTools: ['proto_*', 'read_file'] },
      },
    })

    const plugin = module.getPlugin()
    const tools = getToolsForContext({
      mode: 'agent',
      scenarioToolPacks: plugin.capabilities.toolPacks,
      scenarioTools: plugin.capabilities.tools ?? [],
      sessionScope: plugin.sessionScope,
    })

    expect(tools).toContain('proto_get_canvas')
    expect(tools).toContain('proto_generate_page')
    expect(tools).not.toContain('run_command')
  })
})
