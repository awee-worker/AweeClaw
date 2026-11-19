/**
 * 场景工具「待办清单」执行态回归测试
 *
 * 覆盖两类会让条目永远停在「AI 执行中」的缺陷：
 * 1. AI 通过 scene_tools_update 把待办改成执行中时不记执行会话，会话结束后
 *    收敛逻辑匹配不上该条目；
 * 2. 收敛只认「执行会话完全相同」的条目，没有会话记录的历史数据永远不会被处理。
 *
 * 被测函数直接读取 zustand 单例，这里用模块替身替换成可断言的普通对象。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface FakeWorkTodo {
  id: string
  text: string
  status: 'pending' | 'executing' | 'done'
  priority: 'high' | 'medium' | 'low'
  createdAt: number
  executingThreadId?: string
  executedAt?: number
}

const todoState = {
  items: [] as FakeWorkTodo[],
  update: vi.fn(),
}

const agentState: { currentThreadId?: string | null; threads: Record<string, unknown> } = {
  threads: {},
}

vi.mock('@intelligence/state/IntelligenceStore', () => ({
  useAgentStore: { getState: () => agentState },
}))

vi.mock('@renderer/utils/chatOverlays', () => ({
  closeOverlaysForChat: vi.fn(),
}))

vi.mock('../../stores', () => ({
  useTodoStore: { getState: () => todoState },
}))

import { executeWorkTodo, resolveThreadWorkTodos, stampWorkTodoExecution } from '../workTodoExec'

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

function workTodo(partial: Partial<FakeWorkTodo> & Pick<FakeWorkTodo, 'id'>): FakeWorkTodo {
  return {
    text: partial.id,
    status: 'pending',
    priority: 'medium',
    createdAt: 1,
    ...partial,
  }
}

/** 最小工具上下文：被测函数只关心 threadId，其余字段按签名推断补齐 */
type ToolCtx = NonNullable<Parameters<typeof stampWorkTodoExecution>[2]>

function ctx(threadId: string | null): ToolCtx {
  return { workspacePath: null, threadId }
}

function updates(): Array<{ id: string; patch: Partial<FakeWorkTodo> }> {
  return todoState.update.mock.calls.map((c: unknown[]) => ({
    id: c[0] as string,
    patch: c[1] as Partial<FakeWorkTodo>,
  }))
}

beforeEach(() => {
  todoState.items = []
  todoState.update.mockClear()
  agentState.currentThreadId = null
  agentState.threads = {}
})

/* ------------------------------------------------------------------ */
/* stampWorkTodoExecution · 写入执行态时补会话记录                      */
/* ------------------------------------------------------------------ */

describe('stampWorkTodoExecution · 写入执行态时补会话记录', () => {
  it('AI 把待办改成执行中时记下执行所在会话', () => {
    const patch = stampWorkTodoExecution('work-todo', { status: 'executing' }, ctx('t1'))

    expect(patch).toEqual({ status: 'executing', executingThreadId: 't1' })
  })

  it('工具上下文没有会话时回落到当前会话', () => {
    agentState.currentThreadId = 't2'

    const patch = stampWorkTodoExecution('work-todo', { status: 'executing' }, ctx(null))

    expect(patch.executingThreadId).toBe('t2')
  })

  it('退出执行态时清掉会话记录', () => {
    const patch = stampWorkTodoExecution('work-todo', { status: 'done' }, ctx('t1'))

    expect(patch).toEqual({ status: 'done', executingThreadId: undefined })
  })

  it('不改动状态时原样返回，不干扰其它字段', () => {
    const original = { dueDate: '2026-12-01' }

    expect(stampWorkTodoExecution('work-todo', original, ctx('t1'))).toBe(original)
  })

  it('其它工具（非 work-todo）的写入不受影响', () => {
    const original = { status: 'executing' }

    expect(stampWorkTodoExecution('work-meeting', original, ctx('t1'))).toBe(original)
  })
})

/* ------------------------------------------------------------------ */
/* resolveThreadWorkTodos · 会话结束时的收敛                            */
/* ------------------------------------------------------------------ */

describe('resolveThreadWorkTodos · 会话结束时的收敛', () => {
  it('本会话发起的执行中条目：正常收尾标记完成', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing', executingThreadId: 't1' })]

    resolveThreadWorkTodos('t1', true)

    expect(updates()).toEqual([
      { id: 'a', patch: { status: 'done', executedAt: expect.any(Number), executingThreadId: undefined } },
    ])
  })

  it('本会话发起的执行中条目：中途停止退回待办', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing', executingThreadId: 't1' })]

    resolveThreadWorkTodos('t1', false)

    expect(updates()).toEqual([
      { id: 'a', patch: { status: 'pending', executedAt: undefined, executingThreadId: undefined } },
    ])
  })

  it('别的会话正在执行的条目不受影响', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing', executingThreadId: 't2' })]

    resolveThreadWorkTodos('t1', true)

    expect(updates()).toEqual([])
  })

  it('没有执行会话记录的条目退回待办，不冒充已完成', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing' })]

    resolveThreadWorkTodos('t1', true)

    expect(updates()).toEqual([{ id: 'a', patch: { status: 'pending', executingThreadId: undefined } }])
  })

  it('没有执行会话记录且本轮未收尾时同样退回待办', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing' })]

    resolveThreadWorkTodos('t1', false)

    expect(updates()).toEqual([{ id: 'a', patch: { status: 'pending', executingThreadId: undefined } }])
  })

  it('未执行中的条目一概不处理', () => {
    todoState.items = [
      workTodo({ id: 'a', status: 'pending' }),
      workTodo({ id: 'b', status: 'done', executingThreadId: 't1' }),
    ]

    resolveThreadWorkTodos('t1', true)

    expect(updates()).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* executeWorkTodo · 重复触发防护                                       */
/* ------------------------------------------------------------------ */

describe('executeWorkTodo · 重复触发防护', () => {
  it('已经执行中的任务不再二次下发', () => {
    todoState.items = [workTodo({ id: 'a', status: 'executing', executingThreadId: 't9' })]
    agentState.currentThreadId = 't1'
    agentState.threads = { t1: {}, t9: {} }

    executeWorkTodo(todoState.items[0])

    expect(todoState.update).not.toHaveBeenCalled()
  })

  it('待办状态的任务正常下发，并记下执行所在会话', () => {
    todoState.items = [workTodo({ id: 'b', status: 'pending' })]
    agentState.currentThreadId = 't1'
    agentState.threads = { t1: {} }

    executeWorkTodo(todoState.items[0])

    expect(updates()).toEqual([{ id: 'b', patch: { status: 'executing', executingThreadId: 't1' } }])
  })
})
