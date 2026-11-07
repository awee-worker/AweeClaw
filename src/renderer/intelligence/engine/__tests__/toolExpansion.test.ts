/**
 * 工具分层懒展开的守门测试
 *
 * 保护三条硬约束：
 * 1. 未展开只留入口；展开后全组可见；
 * 2. 顺序不变（只过滤，不重排）—— 否则 prompt cache 前缀每轮失效；
 * 3. 入口缺失或组太小 → 整组不收缩（宁多发，不藏错）。
 */
import { describe, it, expect } from 'vitest'
import { createToolExpansionState, MIN_GROUP_SIZE } from '../toolExpansion'

const gitTools = ['git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch']
const otherTools = ['read_file', 'write_file', 'run_command']

function defs(names: string[]) {
  return names.map((name) => ({ name, description: `${name} desc` }))
}

describe('createToolExpansionState', () => {
  it('未展开时组内只保留入口，非组内工具全保留', () => {
    const state = createToolExpansionState([...gitTools, ...otherTools])
    const filtered = state.filter(defs([...otherTools, ...gitTools]))
    const names = filtered.map((d) => d.name)

    expect(names).toContain('git_status')
    expect(names).not.toContain('git_commit')
    expect(names).toEqual(expect.arrayContaining(otherTools))
  })

  it('保持原顺序（前缀稳定）：过滤后的序号单调递增', () => {
    const all = [...otherTools, ...gitTools]
    const state = createToolExpansionState(all)
    const filteredNames = state.filter(defs(all)).map((d) => d.name)
    const originIndex = new Map(all.map((n, i) => [n, i]))

    const indexes = filteredNames.map((n) => originIndex.get(n)!)
    for (let i = 1; i < indexes.length; i += 1) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1])
    }
  })

  it('调用组内工具后展开，下一轮全组可见且顺序不变', () => {
    const all = [...otherTools, ...gitTools]
    const state = createToolExpansionState(all)

    state.noteCalls(['git_status'])
    const names = state.filter(defs(all)).map((d) => d.name)
    expect(names).toEqual(all)
  })

  it('入口工具缺失 → 该组不收缩', () => {
    const withoutEntry = gitTools.filter((n) => n !== 'git_status')
    const state = createToolExpansionState(withoutEntry)
    const names = state.filter(defs(withoutEntry)).map((d) => d.name)
    expect(names).toEqual(withoutEntry)
  })

  it('组内工具少于阈值 → 不收缩', () => {
    const tiny = ['git_status', 'git_diff']
    expect(MIN_GROUP_SIZE).toBeGreaterThan(tiny.length)
    const state = createToolExpansionState(tiny)
    expect(state.filter(defs(tiny)).map((d) => d.name)).toEqual(tiny)
  })

  it('入口工具说明里带「可解锁本组」提示，且不重复追加', () => {
    const state = createToolExpansionState(gitTools)
    const first = state.filter(defs(gitTools)).find((d) => d.name === 'git_status')!
    expect(first.description).toContain('下一轮可用')

    const twice = state.filter([first]).find((d) => d.name === 'git_status')!
    const occurrences = (twice.description || '').split('下一轮可用').length - 1
    expect(occurrences).toBe(1)
  })

  it('reset 后回到未展开状态', () => {
    const state = createToolExpansionState(gitTools)
    state.noteCalls(['git_log'])
    state.reset()
    expect(state.filter(defs(gitTools)).map((d) => d.name)).toEqual(['git_status'])
  })
})
