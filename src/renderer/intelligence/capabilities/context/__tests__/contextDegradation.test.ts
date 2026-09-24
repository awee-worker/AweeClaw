/**
 * 压缩链路降级验收
 *
 * 验收目标：摘要能力不可用时，上下文仍能推进，且被移出的内容可回溯、不重复消费模型调用。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = {
  userDataPath: '/tmp/aweeclaw-userdata' as string | null,
  existingFiles: new Set<string>(),
  written: [] as Array<{ path: string; content: string }>,
  writeThrows: false,
}

vi.mock('../../../../adapters/electronBridge', () => ({
  api: {
    settings: {
      getUserDataPath: async () => mockState.userDataPath,
    },
    file: {
      ensureDir: async () => {},
      exists: async (path: string) => mockState.existingFiles.has(path),
      write: async (path: string, content: string) => {
        if (mockState.writeThrows) throw new Error('disk full')
        mockState.written.push({ path, content })
      },
    },
  },
}))

import { rawArchiveMessages } from '../rawArchive'
import {
  MAX_SUMMARY_FAILURES_BEFORE_RAW_ARCHIVE,
  getSummaryFailureCount,
  noteSummaryFailure,
  resetSummaryFailure,
  shouldFallbackToRawArchive,
} from '../compressionDegradation'

function userMessage(text: string, timestamp?: number) {
  return { role: 'user' as const, content: text, timestamp }
}

function assistantMessage(text: string, tools: string[] = []) {
  return {
    role: 'assistant' as const,
    content: text,
    toolCalls: tools.map((name, i) => ({ id: `tc-${i}`, name, arguments: {} })),
  }
}

function toolMessage(name: string, content: string) {
  return { role: 'tool' as const, name, toolCallId: 'tc-0', content }
}

describe('摘要失败降级判定', () => {
  beforeEach(() => {
    resetSummaryFailure()
  })

  it('连续失败未达阈值时不降级', () => {
    for (let i = 0; i < MAX_SUMMARY_FAILURES_BEFORE_RAW_ARCHIVE - 1; i++) {
      noteSummaryFailure()
    }

    expect(shouldFallbackToRawArchive()).toBe(false)
  })

  it('连续失败达到阈值时触发降级', () => {
    for (let i = 0; i < MAX_SUMMARY_FAILURES_BEFORE_RAW_ARCHIVE; i++) {
      noteSummaryFailure()
    }

    expect(shouldFallbackToRawArchive()).toBe(true)
  })

  it('重置后回到非降级状态并清零计数', () => {
    noteSummaryFailure()
    noteSummaryFailure()
    noteSummaryFailure()
    expect(shouldFallbackToRawArchive()).toBe(true)

    resetSummaryFailure()

    expect(shouldFallbackToRawArchive()).toBe(false)
    expect(getSummaryFailureCount()).toBe(0)
  })
})

describe('rawArchiveMessages', () => {
  beforeEach(() => {
    mockState.userDataPath = '/tmp/aweeclaw-userdata'
    mockState.existingFiles = new Set()
    mockState.written = []
    mockState.writeThrows = false
  })

  it('空消息数组不产生归档', async () => {
    const result = await rawArchiveMessages('s1', [], 'test')

    expect(result.archivedCount).toBe(0)
    expect(result.filePath).toBeNull()
    expect(mockState.written).toHaveLength(0)
  })

  it('归档内容包含头部信息与全部消息', async () => {
    const messages = [
      userMessage('帮我重构这个模块', 1_700_000_000_000),
      assistantMessage('好的，我先看一下现有实现', ['read_file']),
      toolMessage('read_file', 'export function foo() {}'),
    ]

    const result = await rawArchiveMessages('session-a', messages as never, '摘要连续失败')

    expect(result.archivedCount).toBe(3)
    expect(result.skipped).toBe(false)
    expect(result.filePath).toBe('/tmp/aweeclaw-userdata/context-archive/session-a-0.md')

    const content = mockState.written[0].content
    expect(content).toContain('消息数：3')
    expect(content).toContain('归档原因：摘要连续失败')
    expect(content).toContain('帮我重构这个模块')
    expect(content).toContain('[tools: read_file]')
    expect(content).toContain('TOOL(read_file): export function foo() {}')
  })

  it('工具调用被标注，便于回溯当时执行了什么', async () => {
    const messages = [assistantMessage('执行中', ['write_file', 'run_command'])]

    await rawArchiveMessages('s2', messages as never, 'test')

    expect(mockState.written[0].content).toContain('[tools: write_file, run_command]')
  })

  it('文件已存在时跳过写入，避免重试产生重复归档', async () => {
    mockState.existingFiles.add('/tmp/aweeclaw-userdata/context-archive/session-b-0.md')

    const result = await rawArchiveMessages('session-b', [userMessage('hi')] as never, 'test')

    expect(result.skipped).toBe(true)
    expect(result.archivedCount).toBe(1)
    expect(mockState.written).toHaveLength(0)
  })

  it('批次起始索引进入文件名，不同批次互不覆盖', async () => {
    await rawArchiveMessages('session-c', [userMessage('hi')] as never, 'test', 42)

    expect(mockState.written[0].path).toBe(
      '/tmp/aweeclaw-userdata/context-archive/session-c-42.md'
    )
  })

  it('会话 ID 中的路径分隔符被替换，不产生越权路径', async () => {
    await rawArchiveMessages('../../etc/passwd', [userMessage('hi')] as never, 'test')

    const writtenPath = mockState.written[0].path
    expect(writtenPath).toBe('/tmp/aweeclaw-userdata/context-archive/______etc_passwd-0.md')
    expect(writtenPath.startsWith('/tmp/aweeclaw-userdata/context-archive/')).toBe(true)
  })

  it('用户数据目录不可用时返回空结果且不抛异常', async () => {
    mockState.userDataPath = null

    const result = await rawArchiveMessages('s3', [userMessage('hi')] as never, 'test')

    expect(result.filePath).toBeNull()
    expect(result.archivedCount).toBe(0)
  })

  it('写入失败时不抛异常，主循环可继续', async () => {
    mockState.writeThrows = true

    const result = await rawArchiveMessages('s4', [userMessage('hi')] as never, 'test')

    expect(result.filePath).toBeNull()
    expect(result.archivedCount).toBe(0)
  })
})
