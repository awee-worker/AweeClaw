/**
 * 摘要提取验收
 *
 * 验收目标：折叠成摘要后，用户纠正过的方向与已修好的错误仍能被带下去，
 * 且不把普通消息误判成纠正或修复。
 */

import { describe, expect, it } from 'vitest'
import { extractDecisionPoints, extractErrorsAndFixes } from '../summaryExtraction'

function user(text: string) {
  return { role: 'user' as const, content: text }
}

function assistant(text: string, toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = []) {
  return {
    role: 'assistant' as const,
    content: text,
    toolCalls: toolCalls.map((tc, i) => ({
      id: `tc-${i}`,
      name: tc.name,
      arguments: tc.args ?? {},
    })),
  }
}

function tool(name: string, content: string) {
  return { role: 'tool' as const, name, toolCallId: 'tc-0', content }
}

describe('extractDecisionPoints', () => {
  it('识别用户纠正并记录所在轮次', () => {
    const messages = [
      user('帮我实现登录'),
      assistant('已完成，使用了 JWT'),
      user('不对，应该用 session'),
    ]

    const points = extractDecisionPoints(messages as never)

    expect(points).toHaveLength(1)
    expect(points[0].type).toBe('user_correction')
    expect(points[0].turnIndex).toBe(2)
    expect(points[0].description).toContain('应该用 session')
  })

  it('普通用户消息不误判为纠正', () => {
    const messages = [user('帮我实现登录'), user('再加一个退出按钮')]

    expect(extractDecisionPoints(messages as never)).toHaveLength(0)
  })

  it('文件写操作被记为对应类型的决策点', () => {
    const messages = [
      user('改一下配置'),
      assistant('好的', [
        { name: 'write_file', args: { path: 'src/config.ts' } },
        { name: 'edit_file', args: { path: 'src/app.ts' } },
      ]),
    ]

    const points = extractDecisionPoints(messages as never)

    expect(points.map(p => p.type)).toEqual(['file_create', 'file_modify'])
    expect(points[0].files).toEqual(['src/config.ts'])
    expect(points[1].description).toContain('src/app.ts')
  })

  it('只读工具与其它工具不产生决策点', () => {
    const messages = [
      user('看看这个文件'),
      assistant('好', [{ name: 'read_file', args: { path: 'a.ts' } }]),
      assistant('查一下', [{ name: 'web_search', args: {} }]),
    ]

    expect(extractDecisionPoints(messages as never)).toHaveLength(0)
  })

  it('超出上限时保留最近的条目', () => {
    const messages = [
      user('第一轮'),
      assistant('', [{ name: 'write_file', args: { path: 'a1.ts' } }]),
      user('第二轮'),
      assistant('', [{ name: 'write_file', args: { path: 'a2.ts' } }]),
      user('第三轮'),
      assistant('', [{ name: 'write_file', args: { path: 'a3.ts' } }]),
    ]

    const points = extractDecisionPoints(messages as never, 2)

    expect(points).toHaveLength(2)
    expect(points.map(p => p.files[0])).toEqual(['a2.ts', 'a3.ts'])
  })

  it('空历史不产生条目', () => {
    expect(extractDecisionPoints([])).toHaveLength(0)
  })
})

describe('extractErrorsAndFixes', () => {
  it('工具报错后同一工具的再次调用被记为修复', () => {
    const messages = [
      user('跑一下构建'),
      assistant('', [{ name: 'run_command', args: { command: 'npm build' } }]),
      tool('run_command', 'Error: Cannot find module "foo"'),
      assistant('我修一下依赖', [{ name: 'run_command', args: { command: 'npm i foo' } }]),
    ]

    const pairs = extractErrorsAndFixes(messages as never)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].error).toContain('Cannot find module')
    expect(pairs[0].fix).toContain('npm i foo')
  })

  it('未被修复的错误不进入结果', () => {
    const messages = [
      user('跑一下构建'),
      assistant('', [{ name: 'run_command', args: { command: 'npm build' } }]),
      tool('run_command', 'Error: build failed'),
    ]

    expect(extractErrorsAndFixes(messages as never)).toHaveLength(0)
  })

  it('成功结果不产生错误条目', () => {
    const messages = [
      user('跑一下构建'),
      assistant('', [{ name: 'run_command', args: { command: 'npm build' } }]),
      tool('run_command', 'Build succeeded'),
      assistant('', [{ name: 'run_command', args: { command: 'npm build' } }]),
    ]

    expect(extractErrorsAndFixes(messages as never)).toHaveLength(0)
  })

  it('不同工具的调用不会被误配为修复', () => {
    const messages = [
      user('读一下'),
      assistant('', [{ name: 'read_file', args: { path: 'a.ts' } }]),
      tool('read_file', 'Error: file not found'),
      assistant('换个方式', [{ name: 'run_command', args: { command: 'ls' } }]),
    ]

    expect(extractErrorsAndFixes(messages as never)).toHaveLength(0)
  })

  it('中文错误信息同样被识别', () => {
    const messages = [
      user('部署一下'),
      assistant('', [{ name: 'run_command', args: { command: 'deploy' } }]),
      tool('run_command', '执行失败：权限不足'),
      assistant('提权重试', [{ name: 'run_command', args: { command: 'sudo deploy' } }]),
    ]

    const pairs = extractErrorsAndFixes(messages as never)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].error).toContain('执行失败')
  })
})
