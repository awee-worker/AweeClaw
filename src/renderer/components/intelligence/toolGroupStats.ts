/**
 * 工具调用分组统计
 *
 * 背景：批量执行时所有工具同属一个分组，组状态只取最高优先级（进行中 > 失败 > 已完成）。
 * 若组头只显示「失败 (4)」，而实际上组内只有 1 个工具失败、另外 3 个已完成，
 * 用户会误判整批都失败了。因此这里按状态分别计数，由组头在状态混合时逐项列出，
 * 例如「失败 (1)，已完成 (3)」。
 */

import type { ToolStatus } from '@intelligence/providerTypes'

/** 工具状态分组 */
export type ToolGroupStatus = 'pending' | 'awaiting' | 'success' | 'error'

/** 组头展示顺序：进行中 → 待批准 → 失败 → 已完成 */
export const GROUP_STATUS_ORDER: readonly ToolGroupStatus[] = [
  'pending',
  'awaiting',
  'error',
  'success',
]

/** 组内各状态的实际数量 */
export interface ToolStatusCounts {
  pending: number
  awaiting: number
  success: number
  error: number
}

/**
 * 按状态统计工具数量
 *
 * 归属规则与分组逻辑保持一致：running 计入进行中，rejected 计入失败，
 * 其它未知状态归入已完成。
 *
 * @param tools 工具调用列表（只依赖 status 字段）
 * @returns 各状态数量
 */
export function countToolStatuses(
  tools: readonly { status?: ToolStatus }[],
): ToolStatusCounts {
  const counts: ToolStatusCounts = { pending: 0, awaiting: 0, success: 0, error: 0 }

  for (const tool of tools) {
    const status = tool.status
    if (status === 'pending' || status === 'running') {
      counts.pending += 1
    } else if (status === 'awaiting') {
      counts.awaiting += 1
    } else if (status === 'error' || status === 'rejected') {
      counts.error += 1
    } else {
      counts.success += 1
    }
  }

  return counts
}

/** 组内出现过的状态项（按展示顺序，带数量） */
export function listPresentStatuses(
  counts: ToolStatusCounts,
): Array<{ status: ToolGroupStatus; count: number }> {
  return GROUP_STATUS_ORDER
    .filter(status => counts[status] > 0)
    .map(status => ({ status, count: counts[status] }))
}

/**
 * 构造组头的状态明细文本
 *
 * 仅当组内混有两种以上状态时返回明细（如「失败 (1)，已完成 (3)」）；
 * 单一状态返回 null，调用方沿用「状态名 (总数)」的简洁写法。
 *
 * @param counts 各状态数量
 * @param labels 各状态显示名
 * @returns 明细文本或 null
 */
export function buildStatusBreakdown(
  counts: ToolStatusCounts,
  labels: Record<ToolGroupStatus, string>,
): string | null {
  const present = listPresentStatuses(counts)
  if (present.length < 2) return null

  return present
    .map(({ status, count }) => `${labels[status]} (${count})`)
    .join('，')
}

/**
 * 把工具调用切成状态分组
 *
 * 恒为单一组，且组内顺序就是调用原始顺序：状态只决定组头的图标与文案，
 * 不参与排序。
 *
 * 早期实现在组内出现待批准工具时按状态拆分（待批准在前、已完成在后）。
 * 但一个工具组里经常同时有已经跑完的工具和刚拦下等待确认的工具 —— 先读文件、
 * 紧接着写文件，两步之间没有可见文本就会并进同一组 —— 新卡片一进来就被插到
 * 已完成卡片之前，用户批准后整组又挪回调用顺序，卡片先上后下地跳一次。
 * 按状态排序带来的收益远小于这次位移，因此取消拆分。
 *
 * 只读取 status 字段，入参用泛型让调用方原样取回自己的元素类型：
 * 渲染层传 ToolCall，测试可以传更轻的对象。
 *
 * @param tools 工具调用列表
 * @returns 分组列表（恒为单组，图标与配色由调用方按 status 附加）
 */
export function groupToolsByStatus<T extends { status?: ToolStatus }>(
  tools: T[],
): Array<{ status: ToolGroupStatus; tools: T[] }> {
  const counts = countToolStatuses(tools)

  // 组状态取组内最高优先级：进行中 > 待批准 > 失败 > 已完成
  let status: ToolGroupStatus = 'success'
  if (counts.pending > 0) {
    status = 'pending'
  } else if (counts.awaiting > 0) {
    status = 'awaiting'
  } else if (counts.error > 0) {
    status = 'error'
  }

  return [{ status, tools }]
}
