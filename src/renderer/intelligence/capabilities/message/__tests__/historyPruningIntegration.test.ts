/**
 * 主链路历史裁剪接入测试
 *
 * 裁剪会改变模型可见的历史，因此必须验证两件事：
 * 1. 默认关闭时不改变任何行为（与接入前一致）
 * 2. 开启后确实裁掉无关回合，且承载用户约定的回执不被丢弃
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { ChatMessage } from '@intelligence/providerTypes'

/** store 与类型链路在模块顶层会触碰 window/document，这里补最小桩 */
function patchGlobals() {
  const g = globalThis as any
  if (typeof g.window === 'undefined') g.window = g

  const w = g.window as any
  w.addEventListener = w.addEventListener || (() => {})
  w.removeEventListener = w.removeEventListener || (() => {})
  w.dispatchEvent = w.dispatchEvent || (() => true)

  if (typeof g.document === 'undefined') {
    g.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
      hidden: false,
    }
  }
}

/** 用户约束：承载不可再生信息，任何情况下都不应被裁掉 */
const CONSTRAINT = '我需要在导出时带上表头'

const NOISE_PAIRS = 8

function buildHistory(): ChatMessage[] {
  const history: ChatMessage[] = []
  for (let k = 0; k < NOISE_PAIRS; k++) {
    history.push({
      id: `noise-user-${k}`,
      role: 'user',
      content: `今天午饭吃了面（闲聊 ${k + 1}）`,
      timestamp: k,
    } as unknown as ChatMessage)
    history.push({
      id: `noise-assistant-${k}`,
      role: 'assistant',
      content: `好的，关于这个问题的回答如下：……（闲聊回合 ${k + 1}）`,
      timestamp: k,
    } as unknown as ChatMessage)
  }
  // 约定回合：用户确立了导出约束，助手以「已记录」回执确认
  history.push({ id: 'keep-user', role: 'user', content: CONSTRAINT, timestamp: 100 } as unknown as ChatMessage)
  history.push({
    id: 'keep-assistant',
    role: 'assistant',
    content: `已记录：${CONSTRAINT}`,
    timestamp: 101,
  } as unknown as ChatMessage)
  return history
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

async function assembleWithPruning(enabled: boolean): Promise<string> {
  patchGlobals()
  const { MessageAssembler } = await import('../MessageBuilder')
  const { setMainChainPruningEnabled } = await import('@intelligence/capabilities/context/contextPruner')

  setMainChainPruningEnabled(enabled)
  const assembler = new MessageAssembler()
  const userContent = assembler.assembleUserMessage('继续往下做', '')
  const result = assembler.assemble(buildHistory(), userContent, 'SYSTEM', 0)

  return result.messages.map((message) => String(message.content ?? '')).join('\n')
}

afterEach(async () => {
  const { setMainChainPruningEnabled } = await import('@intelligence/capabilities/context/contextPruner')
  setMainChainPruningEnabled(false)
})

describe('主链路历史裁剪', () => {
  it('默认关闭：历史原样进入模型上下文', async () => {
    const joined = await assembleWithPruning(false)

    expect(countOccurrences(joined, '闲聊回合')).toBe(NOISE_PAIRS)
    expect(joined).toContain(CONSTRAINT)
  })

  it('开启后：无关回合被裁剪，且约定回执保留', async () => {
    const joined = await assembleWithPruning(true)

    // 无关回合减少
    expect(countOccurrences(joined, '闲聊回合')).toBeLessThan(NOISE_PAIRS)
    // 用户约束与其回执仍在
    expect(joined).toContain(`已记录：${CONSTRAINT}`)
    expect(joined).toContain('继续往下做')
  })
})
