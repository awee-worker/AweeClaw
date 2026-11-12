/**
 * 待办中心「采集 / 收敛」逻辑回归测试
 *
 * 覆盖两类已修复的缺陷：
 * 1. 会话里已做完的任务（verifying / completed）被当成待办采集进待办中心，
 *    表现为 AI 执行完成后清单里又多出刚做完的任务；
 * 2. 正常收尾后，措辞有出入的已完成任务因标题全等比对失败而残留为待办。
 *
 * 被测函数直接读取两个 zustand 单例，因此这里用模块替身把它们替换成
 * 可断言的普通对象，匹配算法（continuationItems）保持真实实现。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface FakeTodo {
  content: string
  status: string
  activeForm: string
}

interface FakeHubItem {
  id: string
  title: string
  status: string
  sourceType: string
  sourceId?: string
}

const agentState: { threads: Record<string, { id: string; todos?: FakeTodo[] }> } = {
  threads: {},
}

const hubState = {
  items: [] as FakeHubItem[],
  add: vi.fn(),
  complete: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}

vi.mock('@intelligence/state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => agentState },
}))

vi.mock('@intelligence/providerTypes', () => ({
  getThreadDisplayTitle: () => '测试会话',
}))

vi.mock('@store', () => ({
  // 未配置模型：reconcileThreadTodos 只保留确定性结果，不触发 AI 协调
  useStore: { getState: () => ({ llmConfig: null }) },
}))

vi.mock('../../../adapters/electronBridge', () => ({
  api: { llm: { generateObject: vi.fn() }, file: {} },
}))

vi.mock('@toolkit/LogEngine', () => ({
  logger: { agent: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}))

vi.mock('@renderer/plugins/pluginDrawerStore', () => ({
  openBuiltinPanel: vi.fn(),
}))

vi.mock('@renderer/utils/chatOverlays', () => ({
  closeOverlaysForChat: vi.fn(),
}))

vi.mock('../todoHubStore', () => ({
  useTodoHubStore: { getState: () => hubState },
}))

import {
  collectFromThread,
  reconcileThreadTodos,
  settleConversationTodos,
} from '../todoHubActions'

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

function setThread(id: string, todos?: FakeTodo[]): void {
  agentState.threads[id] = { id, todos }
}

function todo(content: string, status: FakeTodo['status']): FakeTodo {
  return { content, status, activeForm: content }
}

function hubItem(partial: Partial<FakeHubItem> & Pick<FakeHubItem, 'id' | 'title'>): FakeHubItem {
  return { status: 'pending', sourceType: 'conversation', ...partial }
}

function addedTitles(): string[] {
  return hubState.add.mock.calls.map((c: unknown[]) => (c[0] as { title: string }).title)
}

function completedIds(): unknown[] {
  return hubState.complete.mock.calls.map((c: unknown[]) => c[0])
}

beforeEach(() => {
  agentState.threads = {}
  hubState.items = []
  vi.clearAllMocks()
})

/* ------------------------------------------------------------------ */
/* collectFromThread · 采集范围                                        */
/* ------------------------------------------------------------------ */

describe('collectFromThread · 采集范围', () => {
  it('只采集 pending / in_progress，跳过 verifying 与 completed', () => {
    setThread('t1', [
      todo('未开始的任务', 'pending'),
      todo('正在做的任务', 'in_progress'),
      todo('等待验证的任务', 'verifying'),
      todo('已完成的任务', 'completed'),
    ])

    collectFromThread('t1')

    expect(addedTitles()).toEqual(['未开始的任务', '正在做的任务'])
  })

  it('采集条目带会话来源与去重键', () => {
    setThread('t2', [todo('导出结果包', 'pending')])

    collectFromThread('t2')

    expect(hubState.add).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '导出结果包',
        status: 'pending',
        sourceType: 'conversation',
        sourceId: 't2',
        dedupeKey: 'conv:t2:导出结果包',
      }),
    )
  })

  it('会话不存在时不产生任何采集', () => {
    collectFromThread('missing')

    expect(hubState.add).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* settleConversationTodos · 正常收尾后的收敛                          */
/* ------------------------------------------------------------------ */

describe('settleConversationTodos · 正常收尾后的收敛', () => {
  it('清单全部完成时，收尾该会话来源的待办（不依赖标题一致）', () => {
    setThread('t3', [todo('编写登录页表单组件', 'completed'), todo('导出结果包', 'completed')])
    hubState.items = [
      hubItem({ id: 'h1', title: '完成登录页表单组件', sourceId: 't3' }),
      hubItem({ id: 'h2', title: '导出结果包', sourceId: 't3' }),
    ]

    settleConversationTodos('t3')

    expect(completedIds()).toEqual(['h1', 'h2'])
  })

  it('清单仍有未完成项时不收尾', () => {
    setThread('t4', [todo('编写登录页', 'completed'), todo('补充测试', 'pending')])
    hubState.items = [hubItem({ id: 'h3', title: '编写登录页', sourceId: 't4' })]

    settleConversationTodos('t4')

    expect(hubState.complete).not.toHaveBeenCalled()
  })

  it('清单为空时不收尾（清空清单无法判断是做完还是放弃）', () => {
    setThread('t5', [])
    hubState.items = [hubItem({ id: 'h4', title: '某个任务', sourceId: 't5' })]

    settleConversationTodos('t5')

    expect(hubState.complete).not.toHaveBeenCalled()
  })

  it('执行中的条目交给结束原因收敛，此处不处理', () => {
    setThread('t6', [todo('编写登录页', 'completed')])
    hubState.items = [
      hubItem({ id: 'h5', title: '编写登录页', sourceId: 't6', status: 'executing' }),
    ]

    settleConversationTodos('t6')

    expect(hubState.complete).not.toHaveBeenCalled()
  })

  it('不触碰其它来源与其它会话的条目', () => {
    setThread('t7', [todo('编写登录页', 'completed')])
    hubState.items = [
      hubItem({ id: 'h6', title: '编写登录页', sourceId: 't7', sourceType: 'manual' }),
      hubItem({ id: 'h7', title: '编写登录页', sourceId: 'other-thread' }),
      hubItem({ id: 'h8', title: '编写登录页', sourceId: 't7' }),
    ]

    settleConversationTodos('t7')

    expect(completedIds()).toEqual(['h8'])
  })

  it('会话不存在时安全返回', () => {
    settleConversationTodos('missing')

    expect(hubState.complete).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* reconcileThreadTodos · 已完成项的确定性同步                         */
/* ------------------------------------------------------------------ */

describe('reconcileThreadTodos · 已完成项确定性同步', () => {
  it('标点有差异时仍判定为同一任务', async () => {
    setThread('r1', [todo('编写登录页表单组件。', 'completed')])
    hubState.items = [hubItem({ id: 'x1', title: '编写登录页表单组件', sourceId: 'r1' })]
    const before = hubState.items.length

    await reconcileThreadTodos('r1')

    expect(completedIds()).toEqual(['x1'])
    expect(hubState.items.length).toBe(before)
  })

  it('一方被另一方包含时视为同一任务', async () => {
    setThread('r2', [todo('完成登录页表单组件的编写', 'completed')])
    hubState.items = [hubItem({ id: 'x2', title: '登录页表单组件的编写', sourceId: 'r2' })]

    await reconcileThreadTodos('r2')

    expect(completedIds()).toEqual(['x2'])
  })

  it('会话里未完成的任务不得被收尾', async () => {
    setThread('r3', [todo('编写登录页表单组件', 'in_progress')])
    hubState.items = [hubItem({ id: 'x3', title: '编写登录页表单组件', sourceId: 'r3' })]

    await reconcileThreadTodos('r3')

    expect(hubState.complete).not.toHaveBeenCalled()
  })

  it('措辞完全不同且无包含关系时不做猜测', async () => {
    setThread('r4', [todo('补充接口文档', 'completed')])
    hubState.items = [hubItem({ id: 'x4', title: '修复登录页样式', sourceId: 'r4' })]

    await reconcileThreadTodos('r4')

    expect(hubState.complete).not.toHaveBeenCalled()
  })

  it('无关会话的条目不会被本会话收尾', async () => {
    setThread('r5', [todo('编写登录页表单组件', 'completed')])
    hubState.items = [hubItem({ id: 'x5', title: '编写登录页表单组件', sourceId: 'another' })]

    await reconcileThreadTodos('r5')

    expect(hubState.complete).not.toHaveBeenCalled()
  })
})
