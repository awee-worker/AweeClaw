import { describe, it, expect } from 'vitest'
import {
  applySessionScope,
  getToolsForContext,
  matchesToolPattern,
} from '@configuration/toolCategoryDefs'

describe('场景会话边界：工具名模式匹配', () => {
  it('精确名只匹配自身', () => {
    expect(matchesToolPattern('read_file', 'read_file')).toBe(true)
    expect(matchesToolPattern('read_file', 'read_multiple_files')).toBe(false)
  })

  it('星号结尾按前缀匹配', () => {
    expect(matchesToolPattern('proto_create_page', 'proto_*')).toBe(true)
    expect(matchesToolPattern('proto_create_page', 'prototype_*')).toBe(false)
  })

  it('空模式不匹配任何工具', () => {
    expect(matchesToolPattern('read_file', '   ')).toBe(false)
  })
})

describe('场景会话边界：工具集收窄', () => {
  const scope = {
    boundary: '只服务当前原型项目',
    allowedTools: ['proto_*', 'read_file'],
  }

  it('白名单生效：场景外工具全部挡掉', () => {
    const tools = getToolsForContext({ mode: 'agent', sessionScope: scope })

    expect(tools).toContain('read_file')
    expect(tools).not.toContain('run_command')
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('web_search')
  })

  it('交互与交付类工具始终保留，不必写进白名单', () => {
    const tools = getToolsForContext({ mode: 'agent', sessionScope: scope })

    expect(tools).toContain('ask_user')
    expect(tools).toContain('todo_write')
    expect(tools).toContain('open_preview')
  })

  it('场景自有工具需要自己写进白名单，否则同样被挡', () => {
    const withPack = getToolsForContext({
      mode: 'agent',
      scenarioTools: ['proto_create_page'],
      sessionScope: { boundary: 'x', allowedTools: ['read_file'] },
    })
    expect(withPack).not.toContain('proto_create_page')

    const withAllow = getToolsForContext({
      mode: 'agent',
      scenarioTools: ['proto_create_page'],
      sessionScope: scope,
    })
    expect(withAllow).toContain('proto_create_page')
  })

  it('黑名单在白名单之后生效，可以把顺手带进来的工具再挡掉', () => {
    const tools = getToolsForContext({
      mode: 'agent',
      sessionScope: {
        boundary: 'x',
        allowedTools: ['read_file', 'list_directory'],
        deniedTools: ['list_directory'],
      },
    })
    expect(tools).toContain('read_file')
    expect(tools).not.toContain('list_directory')
  })

  it('未声明边界时不做任何裁剪', () => {
    const tools = getToolsForContext({ mode: 'agent' })
    expect(tools).toContain('run_command')
    expect(tools).toContain('write_file')
  })

  it('applySessionScope 不修改入参集合', () => {
    const source = new Set(['proto_a', 'run_command'])
    const result = applySessionScope(source, scope)

    expect(source.has('run_command')).toBe(true)
    expect(result.has('run_command')).toBe(false)
  })
})
