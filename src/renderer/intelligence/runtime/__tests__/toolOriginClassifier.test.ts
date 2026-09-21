/**
 * 工具结果来源分类与不可信信号汇总测试
 *
 * 覆盖的核心约定：
 * 1. 六类通道的判定（本地文件 / 本地执行 / 网络 / 外部服务 / 渠道 / 外部智能体）
 * 2. 文件类工具按路径落点区分：相对路径按工作区根解析，缺路径参数时按工作区根处理，
 *    只有工作区外或连工作区都没有时才取不可信
 * 3. 未登记的工具一律取不可信 —— 漏防的代价高于多一次确认
 * 4. 信号汇总的去重、截断，以及「只统计本轮」的口径
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { classifyToolOrigin } from '../toolOriginClassifier'
import { collectUntrustedSignal } from '../untrustedContextTracker'
import { __setTrustedAppDataRoots } from '@intelligence/toolkit/trustedPathRegistry'
import type { ToolOrigin } from '@intelligence/types/trustTypes'
import type { ChatMessage } from '@intelligence/providerTypes'

const WORKSPACE = '/Users/me/project'
const APP_DATA = '/Users/me/Library/Application Support/AweeClaw'

beforeEach(() => {
  __setTrustedAppDataRoots([APP_DATA])
})

describe('classifyToolOrigin —— 通道判定', () => {
  it('网络检索类归为 web 且不可信', () => {
    const origin = classifyToolOrigin('web_search', { query: 'x' }, WORKSPACE)
    expect(origin.channel).toBe('web')
    expect(origin.trust).toBe('untrusted')
  })

  it('read_url 记录来源 URL 作为定位', () => {
    const origin = classifyToolOrigin('read_url', { url: 'https://example.com/a' }, WORKSPACE)
    expect(origin.trust).toBe('untrusted')
    expect(origin.locator).toBe('https://example.com/a')
  })

  it('MCP 工具归为外部服务且不可信', () => {
    const origin = classifyToolOrigin('mcp_github__create_issue', {}, WORKSPACE)
    expect(origin.channel).toBe('external_service')
    expect(origin.trust).toBe('untrusted')
  })

  it('外部智能体工具归为 agent 且不可信', () => {
    const origin = classifyToolOrigin('external_agent_delegate', {}, WORKSPACE)
    expect(origin.channel).toBe('agent')
    expect(origin.trust).toBe('untrusted')
  })

  it('渠道工具归为渠道消息且不可信', () => {
    const origin = classifyToolOrigin('send_file_to_channel', {}, WORKSPACE)
    expect(origin.channel).toBe('channel_message')
    expect(origin.trust).toBe('untrusted')
  })

  it('本地执行类可信', () => {
    const tools = ['run_command', 'codebase_search', 'get_lint_errors', 'git_status', 'ocr_extract']
    for (const tool of tools) {
      expect(classifyToolOrigin(tool, {}, WORKSPACE).trust).toBe('trusted')
    }
  })

  it('本地数据与编排类可信', () => {
    const tools = ['todo_write', 'remember', 'knowledge_search', 'ask_user', 'calculator']
    for (const tool of tools) {
      expect(classifyToolOrigin(tool, {}, WORKSPACE).trust).toBe('trusted')
    }
  })

  it('场景工具归为本地可信', () => {
    expect(classifyToolOrigin('scene_tools_read', {}, WORKSPACE).trust).toBe('trusted')
  })

  it('未登记的工具一律不可信', () => {
    expect(classifyToolOrigin('brand_new_tool', {}, WORKSPACE).trust).toBe('untrusted')
  })

  it('空工具名不可信', () => {
    expect(classifyToolOrigin('', {}, WORKSPACE).trust).toBe('untrusted')
  })
})

describe('classifyToolOrigin —— 文件类按落点区分', () => {
  it('工作区内文件可信', () => {
    const origin = classifyToolOrigin('read_file', { path: `${WORKSPACE}/src/a.ts` }, WORKSPACE)
    expect(origin.channel).toBe('local_fs')
    expect(origin.trust).toBe('trusted')
  })

  it('工作区根目录本身可信', () => {
    expect(classifyToolOrigin('list_directory', { path: WORKSPACE }, WORKSPACE).trust).toBe('trusted')
  })

  it('客户端数据目录可信（插件与技能安装位置在工作区之外）', () => {
    const origin = classifyToolOrigin('read_file', { path: `${APP_DATA}/skills/x/SKILL.md` }, WORKSPACE)
    expect(origin.trust).toBe('trusted')
  })

  it('工作区外文件不可信', () => {
    const origin = classifyToolOrigin('read_file', { path: '/tmp/downloaded.md' }, WORKSPACE)
    expect(origin.trust).toBe('untrusted')
    expect(origin.locator).toBe('/tmp/downloaded.md')
  })

  it('前缀相似但不属于工作区的路径不可信', () => {
    const origin = classifyToolOrigin('read_file', { path: `${WORKSPACE}-backup/a.ts` }, WORKSPACE)
    expect(origin.trust).toBe('untrusted')
  })

  it('相对路径按工作区根解析，落在区内则可信', () => {
    expect(classifyToolOrigin('read_file', { path: 'src/a.ts' }, WORKSPACE).trust).toBe('trusted')
    expect(classifyToolOrigin('search_files', { path: './src' }, WORKSPACE).trust).toBe('trusted')
  })

  it('相对路径逃逸出工作区时不可信', () => {
    expect(classifyToolOrigin('read_file', { path: '../outside/a.ts' }, WORKSPACE).trust).toBe('untrusted')
  })

  it('file_path / filePath 与 path 同等识别', () => {
    const snake = classifyToolOrigin('read_file', { file_path: `${WORKSPACE}/a.ts` }, WORKSPACE)
    expect(snake.trust).toBe('trusted')
    expect(snake.locator).toBe(`${WORKSPACE}/a.ts`)

    expect(classifyToolOrigin('read_file', { filePath: `${WORKSPACE}/b.ts` }, WORKSPACE).trust).toBe('trusted')
  })

  it('工作区外落点仍不可信（file_path 亦然）', () => {
    const origin = classifyToolOrigin('read_file', { file_path: '/tmp/downloaded.md' }, WORKSPACE)
    expect(origin.channel).toBe('local_fs')
    expect(origin.trust).toBe('untrusted')
    expect(origin.locator).toBe('/tmp/downloaded.md')
  })

  it('缺路径参数时按工具默认落点判定：有工作区即在工作区内，无需工作区才不可信', () => {
    // search_files 只给 pattern 时默认检索工作区
    expect(classifyToolOrigin('search_files', { pattern: 'foo' }, WORKSPACE).trust).toBe('trusted')
    expect(classifyToolOrigin('read_file', {}, WORKSPACE).trust).toBe('trusted')
    expect(classifyToolOrigin('search_files', { pattern: 'foo' }, null).trust).toBe('untrusted')
  })

  it('多路径中任一落在工作区外即不可信', () => {
    const origin = classifyToolOrigin(
      'read_multiple_files',
      { paths: [`${WORKSPACE}/a.ts`, '/tmp/b.ts'] },
      WORKSPACE,
    )
    expect(origin.trust).toBe('untrusted')
  })

  it('_meta.filePath 可作为路径来源', () => {
    const origin = classifyToolOrigin('edit_file', { _meta: { filePath: `${WORKSPACE}/a.ts` } }, WORKSPACE)
    expect(origin.trust).toBe('trusted')
  })

  it('未传工作区时无法判定为可信', () => {
    const origin = classifyToolOrigin('read_file', { path: `${WORKSPACE}/a.ts` }, null)
    expect(origin.trust).toBe('untrusted')
  })
})

describe('classifyToolOrigin —— 执行基准目录与授权目录', () => {
  const PROJECT_DIR = '/Volumes/Data/projects/site'

  it('相对路径按执行基准目录解析：落在项目目录内则可信', () => {
    const origin = classifyToolOrigin(
      'write_file',
      { path: 'index.html' },
      WORKSPACE,
      { executionRoot: PROJECT_DIR },
    )
    expect(origin.trust).toBe('trusted')
    expect(origin.locator).toBe('index.html')
  })

  it('授权目录内的绝对路径可信（项目执行窗口的项目目录）', () => {
    const origin = classifyToolOrigin(
      'write_file',
      { path: `${PROJECT_DIR}/css/style.css` },
      WORKSPACE,
      { authorizedRoots: [PROJECT_DIR] },
    )
    expect(origin.trust).toBe('trusted')
  })

  it('执行基准目录与授权目录都缺失时，项目目录内的绝对路径仍判不可信', () => {
    const origin = classifyToolOrigin(
      'write_file',
      { path: `${PROJECT_DIR}/index.html` },
      WORKSPACE,
    )
    expect(origin.trust).toBe('untrusted')
  })

  it('授权目录之外的路径仍不可信', () => {
    const origin = classifyToolOrigin(
      'write_file',
      { path: '/tmp/elsewhere/index.html' },
      WORKSPACE,
      { authorizedRoots: [PROJECT_DIR] },
    )
    expect(origin.trust).toBe('untrusted')
  })

  it('无路径参数时以执行基准目录作为可信依据', () => {
    expect(
      classifyToolOrigin('search_files', { pattern: 'foo' }, null, {
        executionRoot: PROJECT_DIR,
      }).trust,
    ).toBe('trusted')
  })
})

describe('collectUntrustedSignal', () => {
  function makeToolResult(name: string, origin: ToolOrigin): ChatMessage {
    return {
      id: `m-${name}-${origin.locator ?? ''}`,
      role: 'tool',
      toolCallId: `c-${name}`,
      name,
      content: '...',
      timestamp: 0,
      type: 'text' as never,
      origin,
    } as ChatMessage
  }

  const trustedOrigin: ToolOrigin = {
    toolName: 'read_file',
    channel: 'local_fs',
    trust: 'trusted',
  }

  it('无消息时为空信号', () => {
    expect(collectUntrustedSignal([]).present).toBe(false)
    expect(collectUntrustedSignal(undefined).present).toBe(false)
  })

  it('全部可信时不产生信号', () => {
    const messages = [makeToolResult('read_file', trustedOrigin)]
    expect(collectUntrustedSignal(messages).present).toBe(false)
  })

  it('存在不可信结果时给出信号与来源', () => {
    const messages = [
      makeToolResult('read_file', trustedOrigin),
      makeToolResult('web_search', {
        toolName: 'web_search',
        channel: 'web',
        trust: 'untrusted',
        locator: 'https://a.com',
      }),
    ]

    const signal = collectUntrustedSignal(messages)
    expect(signal.present).toBe(true)
    expect(signal.sources).toHaveLength(1)
    expect(signal.sources[0].channel).toBe('web')
    expect(signal.sources[0].locator).toBe('https://a.com')
  })

  it('同一来源重复出现时去重', () => {
    const origin: ToolOrigin = {
      toolName: 'web_search',
      channel: 'web',
      trust: 'untrusted',
      locator: 'https://a.com',
    }
    const messages = [makeToolResult('web_search', origin), makeToolResult('web_search', origin)]
    expect(collectUntrustedSignal(messages).sources).toHaveLength(1)
  })

  it('限定本轮时忽略上一轮的外部内容', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: '看一下这个网页',
        timestamp: 0,
        type: 'text' as never,
      } as ChatMessage,
      makeToolResult('web_search', {
        toolName: 'web_search',
        channel: 'web',
        trust: 'untrusted',
        locator: 'https://a.com',
      }),
      {
        id: 'u2',
        role: 'user',
        content: '继续改代码',
        timestamp: 1,
        type: 'text' as never,
      } as ChatMessage,
      makeToolResult('read_file', trustedOrigin),
    ]

    expect(collectUntrustedSignal(messages).present).toBe(true)
    expect(collectUntrustedSignal(messages, { currentTurnOnly: true }).present).toBe(false)
  })

  it('限定本轮时保留本轮已消费的外部内容', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0, type: 'text' as never } as ChatMessage,
      makeToolResult('web_search', {
        toolName: 'web_search',
        channel: 'web',
        trust: 'untrusted',
        locator: 'https://a.com',
      }),
    ]

    const signal = collectUntrustedSignal(messages, { currentTurnOnly: true })
    expect(signal.present).toBe(true)
    expect(signal.sources[0].locator).toBe('https://a.com')
  })

  it('来源条数截断到 5 条', () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      makeToolResult('web_search', {
        toolName: 'web_search',
        channel: 'web',
        trust: 'untrusted',
        locator: `https://a.com/${i}`,
      }),
    )
    expect(collectUntrustedSignal(messages).sources).toHaveLength(5)
  })
})
