/**
 * 挂载任务服务回归测试
 *
 * 覆盖「会话被停止 → 挂载任务执行情况 → 一键续跑 → 任务结束后清除挂载」链路，重点保证：
 * 1. 模型整理出的未完成步骤与会话待办清单合并去重，既不重复也不遗漏
 * 2. 整理失败时不留下空挂载，调用方能如实提示用户
 * 3. 执行情况只在用户点过「继续执行」后交给模型，避免干扰该会话里的无关问答
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MountedTaskInfo } from '@intelligence/providerTypes'

/** 记录派发到 window 的自定义事件，用于断言续跑消息已发出 */
const dispatchedEvents: Array<{ type: string; detail: any }> = []

/** store 与通知链路在模块顶层会触碰 window/document，这里补最小桩 */
function patchGlobals() {
  const g = globalThis as any
  if (typeof g.window === 'undefined') g.window = g

  const w = g.window as any
  w.addEventListener = vi.fn()
  w.removeEventListener = vi.fn()
  w.dispatchEvent = (event: any) => {
    dispatchedEvents.push({ type: event?.type, detail: event?.detail })
    return true
  }

  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class CustomEvent {
      type: string
      detail: any
      constructor(type: string, init?: { detail?: any }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  }

  if (typeof g.document === 'undefined') {
    g.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
      hidden: false,
    }
  }
}

const mocks = vi.hoisted(() => {
  const storeState: any = {
    threads: {} as Record<string, any>,
    currentThreadId: null as string | null,
    setMountedTask: vi.fn((task: any, threadId: string) => {
      const thread = storeState.threads[threadId]
      if (thread) thread.mountedTask = task ?? undefined
    }),
    markMountedTaskResumed: vi.fn((threadId: string) => {
      const task = storeState.threads[threadId]?.mountedTask
      if (task) {
        task.resumedAt = Date.now()
        storeState.threads[threadId].mountedTaskResuming = true
      }
    }),
    setMountedTaskResuming: vi.fn((resuming: boolean, threadId: string) => {
      const thread = storeState.threads[threadId]
      if (thread) thread.mountedTaskResuming = resuming ? true : undefined
    }),
  }

  return {
    storeState,
    toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    confirm: vi.fn(),
    generateSummary: vi.fn(),
  }
})

vi.mock('@intelligence/state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => mocks.storeState },
}))

vi.mock('@store', () => ({
  useStore: { getState: () => ({ language: 'zh' }) },
}))

vi.mock('@components/foundation/NotificationProvider', () => ({ toast: mocks.toast }))
vi.mock('@components/foundation/DecisionOverlay', () => ({ globalDecide: mocks.confirm }))
vi.mock('@intelligence/capabilities/context/summaryEngine', () => ({
  generateSummary: mocks.generateSummary,
}))

const USER_MESSAGE = { id: 'u1', role: 'user', content: '帮我实现登录功能', timestamp: 1 }

/** 写入一个空闲状态的会话，避免服务里的空闲等待轮询空转 */
function setThread(threadId: string, overrides: Record<string, unknown> = {}) {
  mocks.storeState.threads[threadId] = {
    id: threadId,
    messages: [USER_MESSAGE],
    streamState: { phase: 'idle' },
    ...overrides,
  }
  return mocks.storeState.threads[threadId]
}

function summaryResult(overrides: Record<string, unknown> = {}) {
  return {
    objective: '实现登录功能',
    summary: '已完成登录表单与接口对接',
    completedSteps: ['搭建登录页'],
    pendingSteps: ['接入验证码'],
    source: 'llm' as const,
    ...overrides,
  }
}

function mountedTask(overrides: Partial<MountedTaskInfo> = {}): MountedTaskInfo {
  return {
    mountedAt: 1_710_000_000_000,
    objective: '实现登录功能',
    pendingSteps: ['接入验证码'],
    summary: '## 任务目标\n实现登录功能',
    source: 'llm',
    ...overrides,
  }
}

beforeEach(() => {
  patchGlobals()
  // 清掉上一个用例留下的调用记录，避免断言被历史调用污染
  vi.clearAllMocks()
  dispatchedEvents.length = 0
  mocks.storeState.threads = {}
  mocks.storeState.currentThreadId = null
  mocks.generateSummary.mockReset()
  mocks.generateSummary.mockResolvedValue(summaryResult())
  mocks.confirm.mockReset()
  mocks.confirm.mockResolvedValue(true)
})

describe('执行情况整理', () => {
  it('会话不存在时不产生挂载', async () => {
    const { buildMountedTask } = await import('../mountedTaskService')

    expect(await buildMountedTask('missing')).toBeNull()
    expect(mocks.generateSummary).not.toHaveBeenCalled()
  })

  it('会话没有消息时不产生挂载', async () => {
    setThread('t1', { messages: [] })
    const { buildMountedTask } = await import('../mountedTaskService')

    expect(await buildMountedTask('t1')).toBeNull()
    expect(mocks.generateSummary).not.toHaveBeenCalled()
  })

  it('模型整理出的未完成步骤与待办清单合并去重', async () => {
    setThread('t1', {
      todos: [
        { content: '接入验证码', status: 'pending', activeForm: '正在接入验证码' },
        { content: '补单元测试', status: 'pending', activeForm: '正在补单元测试' },
        { content: '搭建登录页', status: 'completed', activeForm: '正在搭建登录页' },
      ],
    })
    mocks.generateSummary.mockResolvedValue(summaryResult({ pendingSteps: ['接入验证码'] }))

    const { buildMountedTask } = await import('../mountedTaskService')
    const mounted = await buildMountedTask('t1')

    // 「接入验证码」同时出现在模型结果与待办清单里，只保留一条
    expect(mounted?.pendingSteps).toEqual(['接入验证码', '补单元测试'])
    expect(mounted?.source).toBe('llm')
    expect(mounted?.summary).toContain('## 任务目标')
    expect(mounted?.summary).toContain('## 未完成步骤')
  })

  it('执行中的待办使用进行时文案描述', async () => {
    setThread('t1', {
      todos: [{ content: '接入验证码', status: 'in_progress', activeForm: '正在接入验证码' }],
    })
    mocks.generateSummary.mockResolvedValue(summaryResult({ pendingSteps: [] }))

    const { buildMountedTask } = await import('../mountedTaskService')
    const mounted = await buildMountedTask('t1')

    expect(mounted?.pendingSteps).toEqual(['正在接入验证码'])
  })

  it('整理异常时不产生半成品挂载', async () => {
    setThread('t1')
    mocks.generateSummary.mockRejectedValue(new Error('model unavailable'))

    const { buildMountedTask } = await import('../mountedTaskService')

    expect(await buildMountedTask('t1')).toBeNull()
  })
})

describe('挂载与取消挂载', () => {
  it('挂载后写入会话状态', async () => {
    setThread('t1')
    const { mountThreadTask } = await import('../mountedTaskService')

    const mounted = await mountThreadTask('t1')

    expect(mounted).not.toBeNull()
    expect(mocks.storeState.setMountedTask).toHaveBeenCalledWith(mounted, 't1')
    expect(mocks.storeState.threads.t1.mountedTask).toEqual(mounted)
  })

  it('整理失败时不写入会话状态', async () => {
    setThread('t1', { messages: [] })
    const { mountThreadTask } = await import('../mountedTaskService')

    expect(await mountThreadTask('t1')).toBeNull()
    expect(mocks.storeState.setMountedTask).not.toHaveBeenCalled()
  })

  it('取消挂载后会话不再保留挂载', async () => {
    setThread('t1', { mountedTask: mountedTask() })
    const { unmountThreadTask } = await import('../mountedTaskService')

    unmountThreadTask('t1')

    expect(mocks.storeState.threads.t1.mountedTask).toBeUndefined()
  })

  it('本就没有挂载时不重复写入', async () => {
    setThread('t1')
    const { unmountThreadTask } = await import('../mountedTaskService')

    unmountThreadTask('t1')

    expect(mocks.storeState.setMountedTask).not.toHaveBeenCalled()
  })
})

describe('续跑', () => {
  it('有剩余步骤时提示剩余数量且不要重复已完成的工作', async () => {
    const { buildResumePrompt, MOUNTED_TASK_RESUME_MESSAGE } = await import('../mountedTaskService')

    const prompt = buildResumePrompt(mountedTask({ pendingSteps: ['a', 'b'] }))

    expect(prompt).toContain(MOUNTED_TASK_RESUME_MESSAGE)
    expect(prompt).toContain('2')
    expect(prompt).toContain('不要重复')
  })

  it('没有剩余步骤时提示确认收尾', async () => {
    const { buildResumePrompt } = await import('../mountedTaskService')

    const prompt = buildResumePrompt(mountedTask({ pendingSteps: [] }))

    expect(prompt).toContain('请确认收尾')
    expect(prompt).not.toMatch(/剩余 \d+ 个步骤/)
  })

  it('续跑先记录续跑时间再派发静默消息', async () => {
    setThread('t1', { mountedTask: mountedTask() })
    const { resumeMountedTask } = await import('../mountedTaskService')

    expect(resumeMountedTask('t1')).toBe(true)

    expect(mocks.storeState.threads.t1.mountedTask.resumedAt).toBeGreaterThan(0)
    // 续跑标记置位：底部任务栏在执行期间收起，避免和流式进度重复占位
    expect(mocks.storeState.threads.t1.mountedTaskResuming).toBe(true)
    expect(dispatchedEvents).toHaveLength(1)
    expect(dispatchedEvents[0].type).toBe('chat-send-message')
    expect(dispatchedEvents[0].detail.threadId).toBe('t1')
    // silent 保证续跑指令不显示成用户气泡，但仍进入模型上下文
    expect(dispatchedEvents[0].detail.silent).toBe(true)
  })

  it('没有挂载时续跑不派发任何消息', async () => {
    setThread('t1')
    const { resumeMountedTask } = await import('../mountedTaskService')

    expect(resumeMountedTask('t1')).toBe(false)
    expect(dispatchedEvents).toHaveLength(0)
  })
})

describe('续跑结束后的挂载收尾', () => {
  it('仅挂载未续跑时保留，不因其它问答结束而丢失', async () => {
    setThread('t1', { mountedTask: mountedTask() })
    const { settleMountedTaskResume } = await import('../mountedTaskService')

    settleMountedTaskResume('t1', 'complete')

    expect(mocks.storeState.threads.t1.mountedTask).toBeDefined()
  })

  it('已续跑的任务正常结束后自动卸下并提示', async () => {
    setThread('t1', { mountedTask: mountedTask({ resumedAt: 1_710_000_001_000 }) })
    const { settleMountedTaskResume } = await import('../mountedTaskService')

    settleMountedTaskResume('t1', 'complete')

    expect(mocks.storeState.threads.t1.mountedTask).toBeUndefined()
    expect(mocks.toast.success).toHaveBeenCalled()
  })

  it('工具主动结束循环同样视为跑完，不把挂载留在界面上', async () => {
    setThread('t1', { mountedTask: mountedTask({ resumedAt: 1_710_000_001_000 }) })
    const { settleMountedTaskResume } = await import('../mountedTaskService')

    settleMountedTaskResume('t1', 'tool_requested_stop')

    expect(mocks.storeState.threads.t1.mountedTask).toBeUndefined()
  })

  it('中途被停止时保留挂载，用户可以再续跑', async () => {
    setThread('t1', { mountedTask: mountedTask({ resumedAt: 1_710_000_001_000 }) })
    const { settleMountedTaskResume } = await import('../mountedTaskService')

    settleMountedTaskResume('t1', 'aborted')

    expect(mocks.storeState.threads.t1.mountedTask).toBeDefined()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('续跑结束后复位续跑标记，任务栏重新可见', async () => {
    setThread('t1', {
      mountedTask: mountedTask({ resumedAt: 1_710_000_001_000 }),
      mountedTaskResuming: true,
    })
    const { settleMountedTaskResume } = await import('../mountedTaskService')

    settleMountedTaskResume('t1', 'error')

    expect(mocks.storeState.setMountedTaskResuming).toHaveBeenCalledWith(false, 't1')
    expect(mocks.storeState.threads.t1.mountedTaskResuming).toBeUndefined()
  })
})

describe('会话停止后的挂载', () => {
  it('整理成功时写入挂载并给出提示', async () => {
    setThread('t1')
    const { mountThreadTaskWithFeedback } = await import('../mountedTaskService')

    const mounted = await mountThreadTaskWithFeedback('t1')

    expect(mounted).toBe(true)
    expect(mocks.storeState.threads.t1.mountedTask).toBeDefined()
    expect(mocks.toast.success).toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('整理失败时明确告知挂载未完成', async () => {
    // 空会话无法整理出执行情况，挂载应判定为失败而非静默跳过
    setThread('t1', { messages: [] })
    const { mountThreadTaskWithFeedback } = await import('../mountedTaskService')

    const mounted = await mountThreadTaskWithFeedback('t1')

    expect(mounted).toBe(false)
    expect(mocks.toast.error).toHaveBeenCalled()
    expect(mocks.storeState.threads.t1.mountedTask).toBeUndefined()
  })
})
