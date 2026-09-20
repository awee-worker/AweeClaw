/**
 * 挂载任务续跑上下文注入测试
 *
 * 挂载本身只是会话上的一枚书签：只有用户点过「继续执行任务」（写入 resumedAt）
 * 才把执行情况注入模型上下文。否则用户在该会话里问无关问题时，会被一份
 * 陈旧的任务快照干扰，也会白白多花一份 token。
 */

import { describe, it, expect } from 'vitest'
import type { ChatMessage, MountedTaskInfo } from '@intelligence/providerTypes'

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

const HISTORY = [
  { id: 'u1', role: 'user', content: '帮我实现登录功能', timestamp: 1 },
] as unknown as ChatMessage[]

function mountedTask(overrides: Partial<MountedTaskInfo> = {}): MountedTaskInfo {
  return {
    mountedAt: 1_710_000_000_000,
    objective: '实现登录功能',
    pendingSteps: ['接入验证码'],
    summary: '## 任务目标\n实现登录功能\n\n## 未完成步骤\n- 接入验证码',
    source: 'llm',
    resumedAt: 1_710_000_001_000,
    ...overrides,
  }
}

async function assembleWith(task: MountedTaskInfo) {
  patchGlobals()
  const { MessageAssembler } = await import('../MessageBuilder')
  const assembler = new MessageAssembler()

  const userContent = assembler.assembleUserMessage('继续', '')
  const result = assembler.assemble(HISTORY, userContent, 'SYSTEM', 0, { mountedTask: task })

  return result.messages.map(message => String(message.content ?? '')).join('\n')
}

describe('挂载任务续跑上下文', () => {
  it('已续跑时把执行情况注入模型上下文', async () => {
    const joined = await assembleWith(mountedTask())

    expect(joined).toContain('Resumed Task')
    expect(joined).toContain('接入验证码')
    expect(joined).toContain('do not redo completed work')
  })

  it('未续跑的挂载不注入上下文', async () => {
    const joined = await assembleWith(mountedTask({ resumedAt: undefined }))

    expect(joined).not.toContain('Resumed Task')
    expect(joined).not.toContain('接入验证码')
  })

  it('没有剩余步骤时提示核对结果并收尾', async () => {
    const joined = await assembleWith(mountedTask({ pendingSteps: [] }))

    expect(joined).toContain('Resumed Task')
    expect(joined).toContain('wrap up')
  })
})
