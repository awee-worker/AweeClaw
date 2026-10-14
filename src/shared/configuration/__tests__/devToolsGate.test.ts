import { describe, it, expect } from 'vitest'
import {
  DEV_ONLY_TOOL_NAMES,
  GIT_TOOL_NAMES,
  getToolsForContext,
} from '@configuration/toolCategoryDefs'

const devOnlyIn = (tools: string[]) => tools.filter((tool) => DEV_ONLY_TOOL_NAMES.includes(tool))
const gitIn = (tools: string[]) => tools.filter((tool) => GIT_TOOL_NAMES.includes(tool))

describe('dev 独有开发类工具场景门控', () => {
  it('非 dev 场景不下发 LSP 代码智能与 codebase_search', () => {
    for (const sceneMode of ['work', 'life', 'study'] as const) {
      const tools = getToolsForContext({ mode: 'agent', sceneMode })
      expect(devOnlyIn(tools), `场景 ${sceneMode} 不应下发 dev 独有工具`).toEqual([])
    }
  })

  it('非 dev 场景同样不下发 git_*（即便用户当轮提出了 Git 操作）', () => {
    for (const sceneMode of ['work', 'life', 'study'] as const) {
      const tools = getToolsForContext({ mode: 'agent', sceneMode, gitToolsEnabled: true })
      expect(gitIn(tools), `场景 ${sceneMode} 不应下发 git_*`).toEqual([])
    }
  })

  it('dev 场景全量下发：git_* 随意图授权放行，LSP 工具始终可见', () => {
    const tools = getToolsForContext({ mode: 'agent', sceneMode: 'dev', gitToolsEnabled: true })
    for (const name of DEV_ONLY_TOOL_NAMES) {
      expect(tools, `dev 场景缺少 ${name}`).toContain(name)
    }
    for (const name of GIT_TOOL_NAMES) {
      expect(tools, `dev 场景缺少 ${name}`).toContain(name)
    }
  })

  it('dev 场景下 git_* 仍受意图门控约束（未授权不下发）', () => {
    const tools = getToolsForContext({ mode: 'agent', sceneMode: 'dev' })
    expect(gitIn(tools)).toEqual([])
    for (const name of DEV_ONLY_TOOL_NAMES) {
      expect(tools).toContain(name)
    }
  })

  it('sceneMode 未传时 fail-open，保持既有全量行为', () => {
    const tools = getToolsForContext({ mode: 'agent' })
    for (const name of DEV_ONLY_TOOL_NAMES) {
      expect(tools).toContain(name)
    }
  })

  it('基础工具在所有场景均可用', () => {
    const baseTools = ['read_file', 'edit_file', 'write_file', 'list_directory', 'search_files', 'run_command', 'web_search']
    for (const sceneMode of ['work', 'life', 'study', 'dev'] as const) {
      const tools = getToolsForContext({ mode: 'agent', sceneMode })
      for (const name of baseTools) {
        expect(tools, `场景 ${sceneMode} 缺少基础工具 ${name}`).toContain(name)
      }
    }
  })

  it('场景声明 toolPacks 时仍可显式加回 dev 独有工具（追加语义）', () => {
    const tools = getToolsForContext({ mode: 'agent', sceneMode: 'work', scenarioToolPacks: ['code'] })
    // code 工具包声明了这些工具，追加来源允许加回
    expect(tools).toContain('codebase_search')
    expect(devOnlyIn(tools).length).toBeGreaterThan(0)
    // git_* 即便在追加包里也由场景门控约束（非 dev 不下发）
    expect(gitIn(tools)).toEqual([])
  })
})
