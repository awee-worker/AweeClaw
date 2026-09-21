import { describe, it, expect } from 'vitest'
import { GIT_TOOL_NAMES, getToolsForContext } from '@configuration/toolCategoryDefs'

const gitToolsIn = (tools: string[]) => tools.filter((tool) => GIT_TOOL_NAMES.includes(tool))

describe('Git 工具按需暴露', () => {
  it('默认（用户未提出 Git 操作）不下发任何 git_* 工具', () => {
    expect(gitToolsIn(getToolsForContext({ mode: 'agent' }))).toEqual([])
    expect(gitToolsIn(getToolsForContext({ mode: 'chat' }))).toEqual([])
    expect(gitToolsIn(getToolsForContext({ mode: 'plan' }))).toEqual([])
  })

  it('场景声明 code 工具包时同样不绕过门控', () => {
    const tools = getToolsForContext({ mode: 'agent', scenarioToolPacks: ['code'] })
    expect(tools).toContain('read_file')
    expect(gitToolsIn(tools)).toEqual([])
  })

  it('自定义智能体白名单也不绕过门控', () => {
    const tools = getToolsForContext({
      mode: 'agent',
      agentBuiltinTools: ['read_file', 'git_status', 'git_commit'],
    })
    expect(tools).toContain('read_file')
    expect(gitToolsIn(tools)).toEqual([])
  })

  it('用户提出 Git 操作后下发只读与写入工具', () => {
    const tools = getToolsForContext({ mode: 'agent', gitToolsEnabled: true })
    for (const name of GIT_TOOL_NAMES) {
      expect(tools, name).toContain(name)
    }
  })

  it('chat 模式即使放行也不暴露写入类工具', () => {
    const tools = getToolsForContext({ mode: 'chat', gitToolsEnabled: true })
    expect(tools).toContain('git_status')
    expect(tools).toContain('git_diff')
    expect(tools).not.toContain('git_commit')
    expect(tools).not.toContain('git_branch')
    expect(tools).not.toContain('git_sync')
  })

  it('门控只作用于 git_*，不影响其他工具', () => {
    const tools = getToolsForContext({ mode: 'agent' })
    expect(tools).toContain('read_file')
    expect(tools).toContain('run_command')
    expect(tools).toContain('edit_file')
  })
})
