/**
 * 子代理回传契约验收
 *
 * 验收目标：结论超限能被压缩并标注，证据引用只取定位信息不取原文。
 */

import { describe, expect, it } from 'vitest'
import {
  buildSubAgentResult,
  collectEvidence,
  renderSubAgentResult,
  SUB_AGENT_RESULT_TOKEN_LIMIT,
} from '../AgentIRChannel'

describe('buildSubAgentResult', () => {
  it('未超限时结论原样保留', () => {
    const result = buildSubAgentResult({
      conclusion: '已完成接口实现',
      evidence: [{ kind: 'file', ref: 'src/api/routes.ts' }],
      steps: 6,
      toolsUsed: ['read_file', 'edit_file'],
    })

    expect(result.conclusion).toBe('已完成接口实现')
    expect(result.truncated).toBe(false)
    expect(result.summary.steps).toBe(6)
    expect(result.summary.toolsUsed).toEqual(['read_file', 'edit_file'])
  })

  it('超过体积上限时压缩并标记截断', () => {
    const huge = '实现细节'.repeat(20_000)
    const result = buildSubAgentResult({
      conclusion: huge,
      tokenLimit: SUB_AGENT_RESULT_TOKEN_LIMIT,
    })

    expect(result.truncated).toBe(true)
    expect(result.conclusion.length).toBeLessThan(huge.length)
    expect(result.conclusion).toContain('已按回传上限压缩')
  })

  it('体积上限可配置，用于小规模场景', () => {
    const text = '一段中等长度的结论文本，用于验证阈值可调'
    expect(buildSubAgentResult({ conclusion: text, tokenLimit: 1000 }).truncated).toBe(false)
    expect(buildSubAgentResult({ conclusion: text, tokenLimit: 1 }).truncated).toBe(true)
  })

  it('证据引用条数有上限', () => {
    const evidence = Array.from({ length: 50 }, (_, i) => ({
      kind: 'file' as const,
      ref: `src/file-${i}.ts`,
    }))
    const result = buildSubAgentResult({ conclusion: 'x', evidence })

    expect(result.evidence.length).toBeLessThanOrEqual(20)
  })

  it('缺省字段有稳定兜底', () => {
    const result = buildSubAgentResult({ conclusion: '' })

    expect(result.truncated).toBe(false)
    expect(result.evidence).toEqual([])
    expect(result.summary).toEqual({ steps: 0, toolsUsed: [] })
  })
})

describe('collectEvidence', () => {
  it('从文件类工具参数抽取路径', () => {
    const evidence = collectEvidence([
      { toolName: 'read_file', args: { path: 'src/a.ts' } },
      { toolName: 'list_directory', args: { path: 'src/components' } },
    ])

    expect(evidence).toEqual([
      { kind: 'file', ref: 'src/a.ts' },
      { kind: 'file', ref: 'src/components' },
    ])
  })

  it('从 _meta.filePath 抽取编辑类工具的目标路径', () => {
    const evidence = collectEvidence([
      { toolName: 'edit_file', args: { _meta: { filePath: 'src/b.ts' } } },
    ])

    expect(evidence).toEqual([{ kind: 'file', ref: 'src/b.ts' }])
  })

  it('抽取 URL 与查询词', () => {
    const evidence = collectEvidence([
      { toolName: 'read_url', args: { url: 'https://example.com/a' } },
      { toolName: 'search_files', args: { pattern: 'buildTrustBoundary' } },
    ])

    expect(evidence).toEqual([
      { kind: 'url', ref: 'https://example.com/a' },
      { kind: 'query', ref: 'buildTrustBoundary' },
    ])
  })

  it('同一目标重复出现时只保留一条', () => {
    const evidence = collectEvidence([
      { toolName: 'read_file', args: { path: 'src/a.ts' } },
      { toolName: 'read_file', args: { path: 'src/a.ts' } },
      { toolName: 'edit_file', args: { path: 'src/a.ts' } },
    ])

    expect(evidence).toHaveLength(1)
  })

  it('无定位信息的工具不产出证据', () => {
    const evidence = collectEvidence([
      { toolName: 'run_command', args: { command: 'ls' } },
      { toolName: 'unknown_tool', args: {} },
    ])

    expect(evidence).toEqual([])
  })

  it('不把工具输出内容当作证据', () => {
    const evidence = collectEvidence([
      { toolName: 'read_file', args: { path: 'src/a.ts', content: '源码原文不应进入证据' } },
    ])

    expect(evidence).toEqual([{ kind: 'file', ref: 'src/a.ts' }])
  })
})

describe('renderSubAgentResult', () => {
  it('渲染结论与证据引用', () => {
    const text = renderSubAgentResult(
      buildSubAgentResult({
        conclusion: '已定位到注入点',
        evidence: [
          { kind: 'file', ref: 'src/a.ts' },
          { kind: 'url', ref: 'https://example.com' },
        ],
        steps: 3,
        toolsUsed: ['search_files'],
      }),
    )

    expect(text).toContain('已定位到注入点')
    expect(text).toContain('[file] src/a.ts')
    expect(text).toContain('[url] https://example.com')
    expect(text).not.toContain('已按回传上限压缩')
  })

  it('截断时给出明确提示', () => {
    const text = renderSubAgentResult(
      buildSubAgentResult({ conclusion: '内容'.repeat(10_000), tokenLimit: 10 }),
    )

    expect(text).toContain('已压缩为结论与引用')
  })

  it('无证据时不渲染空区块', () => {
    const text = renderSubAgentResult(buildSubAgentResult({ conclusion: '完成' }))

    expect(text).toBe('完成')
  })
})
