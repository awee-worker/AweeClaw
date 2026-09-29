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
  groupToolsByStatus,
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

describe('工具分组顺序', () => {
  /** 展平后的 id / status 序列，用于断言卡片顺序就是调用顺序 */
  function flattenIdOf(grouped: Array<{ tools: Array<{ id: string }> }>) {
    return grouped.flatMap(group => group.tools.map(tc => tc.id))
  }
  function flattenStatusOf(grouped: Array<{ tools: Array<{ status?: string }> }>) {
    return grouped.flatMap(group => group.tools.map(tc => tc.status))
  }

  it('已完成与待批准混合时仍为单组且保持调用顺序', () => {
    // 回归场景：先读文件（已执行完）→ 紧接着写文件（拦下等待确认），
    // 两者之间没有可见文本，会并进同一个工具组。
    // 早期实现按状态拆分，把待批准的工具提到已完成之前，用户批准后整组又挪回
    // 调用顺序 —— 卡片先上后下地跳一次，也就是用户看到的会话内容跳动。
    const grouped = groupToolsByStatus(tools('success', 'awaiting'))

    expect(grouped).toHaveLength(1)
    expect(flattenIdOf(grouped)).toEqual(['t0', 't1'])
    expect(flattenStatusOf(grouped)).toEqual(['success', 'awaiting'])
  })

  it('无论状态如何组合都不拆分分组、不打乱顺序', () => {
    const grouped = groupToolsByStatus(
      tools('awaiting', 'success', 'error', 'running', 'rejected', 'awaiting'),
    )

    expect(grouped).toHaveLength(1)
    expect(flattenIdOf(grouped)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5'])
  })

  it('组状态取最高优先级：进行中 > 待批准 > 失败 > 已完成', () => {
    expect(groupToolsByStatus(tools('success', 'awaiting'))[0].status).toBe('awaiting')
    expect(groupToolsByStatus(tools('success', 'error', 'awaiting'))[0].status).toBe('awaiting')
    expect(groupToolsByStatus(tools('success', 'error'))[0].status).toBe('error')
    expect(groupToolsByStatus(tools('success', 'success'))[0].status).toBe('success')
    expect(groupToolsByStatus([])[0].status).toBe('success')
  })
})
