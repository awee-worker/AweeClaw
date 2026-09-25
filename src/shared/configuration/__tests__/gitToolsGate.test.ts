import { describe, it, expect } from 'vitest'
import {
  GIT_READ_TOOL_NAMES,
  GIT_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  getToolsForContext,
} from '@configuration/toolCategoryDefs'

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

  it('授权后三种模式都下发只读工具', () => {
    for (const mode of ['chat', 'agent', 'plan'] as const) {
      const tools = getToolsForContext({ mode, gitToolsEnabled: true })
      for (const name of GIT_READ_TOOL_NAMES) {
        expect(tools, `${mode} 模式缺少 ${name}`).toContain(name)
      }
    }
  })

  it('授权后写入类工具仅下发给 agent / plan，快速模式不暴露', () => {
    // 唯一一处按模式裁剪：chat 为免审批通道，授权后也不给写仓库能力
    const chat = getToolsForContext({ mode: 'chat', gitToolsEnabled: true })
    for (const name of GIT_WRITE_TOOL_NAMES) {
      expect(chat, `chat 模式不应下发 ${name}`).not.toContain(name)
    }

    for (const mode of ['agent', 'plan'] as const) {
      const tools = getToolsForContext({ mode, gitToolsEnabled: true })
      for (const name of GIT_WRITE_TOOL_NAMES) {
        expect(tools, `${mode} 模式缺少 ${name}`).toContain(name)
      }
    }
  })

  it('门控只作用于 git_*，不影响其他工具', () => {
    const tools = getToolsForContext({ mode: 'agent' })
    expect(tools).toContain('read_file')
    expect(tools).toContain('run_command')
    expect(tools).toContain('edit_file')
  })
})
