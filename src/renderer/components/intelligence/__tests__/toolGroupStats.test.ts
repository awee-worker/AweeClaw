/**
 * 工具分组状态统计回归测试
 *
 * 覆盖批量执行场景下组头文案的正确性：组状态取最高优先级（失败盖过完成），
 * 但组头必须按状态分别给出数量，不能让「失败 (4)」把 3 个已完成的工具也算成失败。
 */

import { describe, it, expect } from 'vitest'
import {
  buildStatusBreakdown,
  countToolStatuses,
  listPresentStatuses,
  type ToolGroupStatus,
} from '../toolGroupStats'

const LABELS: Record<ToolGroupStatus, string> = {
  pending: '进行中',
  awaiting: '待批准',
  error: '失败',
  success: '已完成',
}

function tools(...statuses: Array<'pending' | 'running' | 'awaiting' | 'success' | 'error' | 'rejected'>) {
  return statuses.map((status, index) => ({ id: `t${index}`, status }))
}

describe('工具分组状态计数', () => {
  it('running 计入进行中、rejected 计入失败', () => {
    const counts = countToolStatuses(tools('running', 'pending', 'rejected', 'error', 'awaiting', 'success'))

    expect(counts).toEqual({ pending: 2, awaiting: 1, error: 2, success: 1 })
  })

  it('缺失状态的历史数据归入已完成（与分组归属保持一致）', () => {
    const counts = countToolStatuses([{ id: 'legacy' } as never])

    expect(counts.success).toBe(1)
  })

  it('空分组不产生任何状态项', () => {
    expect(listPresentStatuses(countToolStatuses([]))).toEqual([])
  })
})

describe('工具组头状态明细', () => {
  it('1 个失败 + 3 个完成 → 逐项列出而非显示失败 (4)', () => {
    const counts = countToolStatuses(tools('error', 'success', 'success', 'success'))

    expect(buildStatusBreakdown(counts, LABELS)).toBe('失败 (1)，已完成 (3)')
  })

  it('进行中 + 已完成混合 → 明细同时给出进度构成', () => {
    const counts = countToolStatuses(tools('running', 'success', 'success'))

    expect(buildStatusBreakdown(counts, LABELS)).toBe('进行中 (1)，已完成 (2)')
  })

  it('单一状态 → 返回 null，调用方沿用「状态名 (总数)」写法', () => {
    expect(buildStatusBreakdown(countToolStatuses(tools('error', 'rejected')), LABELS)).toBeNull()
    expect(buildStatusBreakdown(countToolStatuses(tools('success', 'success')), LABELS)).toBeNull()
  })

  it('明细按「进行中 → 待批准 → 失败 → 已完成」固定顺序拼接', () => {
    const counts = countToolStatuses(tools('success', 'awaiting', 'error', 'running'))

    expect(buildStatusBreakdown(counts, LABELS)).toBe('进行中 (1)，待批准 (1)，失败 (1)，已完成 (1)')
  })
})
