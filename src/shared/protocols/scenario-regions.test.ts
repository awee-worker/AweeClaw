import { describe, it, expect } from 'vitest'
import {
  SHELL_SLOTS,
  buildDefaultShellRegions,
  validateRegionTree,
  type RegionNode,
  type RegionSplitNode,
  type RegionSlotNode,
} from './scenario-regions'

/** 按层级包裹，用于构造深度用例 */
function nest(inner: RegionNode, levels: number): RegionNode {
  let node = inner
  for (let i = 0; i < levels; i += 1) {
    node = { type: 'split', dir: 'col', children: [node] }
  }
  return node
}

/**
 * 一棵满足保留集的最小 full 树。
 *
 * 保留集三项齐全，另带一个场景自有 panel 作为面板入口——否则 rail 缺省时
 * 会被判为「用户被关在空窗口里」。
 */
function fullTree(extra: RegionNode[] = []): RegionNode {
  return {
    type: 'split',
    dir: 'row',
    className: 'flex h-full w-full',
    children: [
      { type: 'part', id: 'scene-switcher' },
      { type: 'part', id: 'drag-region', className: 'flex-1' },
      { type: 'part', id: 'window-controls' },
      { type: 'panel', id: 'studio' },
      ...extra,
    ],
  }
}

const FULL_CTX = { shellMode: 'full' as const, regionsSchemaVersion: 2 }

/** 按槽位名取出节点，方便断言结构 */
function findBySlot(node: RegionNode, slot: string): RegionSlotNode | null {
  if (node.type === 'slot') return node.slot === slot ? node : null
  if (node.type !== 'split') return null
  for (const child of node.children) {
    const hit = findBySlot(child, slot)
    if (hit) return hit
  }
  return null
}

/** 收集树上全部槽位名（含隐藏节点），用于校验无遗漏、无重复 */
function collectSlots(node: RegionNode, out: string[] = []): string[] {
  if (node.type === 'slot') {
    out.push(node.slot)
    return out
  }
  if (node.type === 'split') {
    node.children.forEach((c) => collectSlots(c, out))
  }
  return out
}

describe('buildDefaultShellRegions', () => {
  it('生成的结构层级与改造前的外壳 JSX 一致', () => {
    const root = buildDefaultShellRegions({ showActivityBar: true }) as RegionSplitNode

    expect(root.type).toBe('split')
    expect(root.dir).toBe('row')
    expect(root.children).toHaveLength(2)

    // 第一层：导航栏 + 主列
    expect(root.children[0]).toMatchObject({ type: 'slot', slot: 'rail' })

    // 第二层：主列纵向排布 标题栏 / 中间行
    const column = root.children[1] as RegionSplitNode
    expect(column.dir).toBe('col')
    expect(column.children.map((c) => (c as RegionSlotNode).slot ?? c.type)).toEqual([
      'titlebar',
      expect.anything(),
    ])

    // 第三层：中间行横向排布 侧边栏 / 主内容区
    const middleRow = column.children[1] as RegionSplitNode
    expect(middleRow.dir).toBe('row')
    expect(middleRow.children.map((c) => (c as RegionSlotNode).slot)).toEqual(['sidebar', 'main'])
  })

  it('四个外壳槽位各出现一次', () => {
    const root = buildDefaultShellRegions({ showActivityBar: true })
    const slots = collectSlots(root)

    expect(slots).toHaveLength(4)
    expect(new Set(slots).size).toBe(4)
    expect(slots).toEqual(['rail', 'titlebar', 'sidebar', 'main'])
  })

  it('导航栏按开关隐藏，但不从树上移除', () => {
    const root = buildDefaultShellRegions({ showActivityBar: false })

    expect(findBySlot(root, 'rail')?.visible).toBe(false)
    // 结构保持不变，仅可见性变化：槽位数量仍为 4
    expect(collectSlots(root)).toHaveLength(4)
  })

  it('淡入淡出类名拼进根容器，且不留多余空白', () => {
    const animating = buildDefaultShellRegions({
      showActivityBar: true,
      animateClass: 'opacity-0',
    }) as RegionSplitNode
    expect(animating.className).toBe(
      'flex h-full w-full overflow-hidden transition-opacity duration-300 opacity-0',
    )

    const idle = buildDefaultShellRegions({ showActivityBar: true }) as RegionSplitNode
    expect(idle.className).toBe(
      'flex h-full w-full overflow-hidden transition-opacity duration-300',
    )
  })
})


describe('validateRegionTree', () => {
  it('默认区域树通过校验', () => {
    const result = validateRegionTree(
      buildDefaultShellRegions({ showActivityBar: true }),
    )
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('重复引用同一槽位会被拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'slot', slot: 'main' },
        { type: 'slot', slot: 'main' },
      ],
    }
    const result = validateRegionTree(root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('槽位 "main" 被重复引用')
  })

  it('ratio 长度与子节点数量不一致会被拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      ratio: [1, 2],
      children: [{ type: 'slot', slot: 'sidebar' }],
    }
    const result = validateRegionTree(root)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('ratio 长度 2 与子节点数量 1 不一致')
  })

  it('面板节点缺少 id 会被拒绝', () => {
    const result = validateRegionTree({ type: 'panel', id: '' })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('面板节点缺少 id')
  })

  it('嵌套过深会被拒绝', () => {
    let node: RegionNode = { type: 'slot', slot: 'main' }
    for (let i = 0; i < 10; i += 1) {
      node = { type: 'split', dir: 'col', children: [node] }
    }
    const result = validateRegionTree(node)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('嵌套深度超过')
  })

  it('限定可用槽位后，越界槽位会被拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'slot', slot: 'sidebar' },
        { type: 'slot', slot: 'chat' },
      ],
    }

    // 不限定范围时合法
    expect(validateRegionTree(root).ok).toBe(true)

    // 外壳层不允许引用 chat：它的内容归主内容区所有，放在外壳树里只会渲染成空白
    const result = validateRegionTree(root, SHELL_SLOTS)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('槽位 "chat" 不属于当前层')
  })

  it('外壳层四个槽位全部在允许范围内', () => {
    const root = buildDefaultShellRegions({ showActivityBar: true })
    expect(validateRegionTree(root, SHELL_SLOTS).ok).toBe(true)
  })

  it('沙箱节点缺少 src 会被拒绝', () => {
    const result = validateRegionTree({ type: 'sandbox', id: 'sb', src: '' })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('沙箱节点缺少 src')
  })

  it('沙箱节点缺少 id 会被拒绝', () => {
    const result = validateRegionTree({ type: 'sandbox', id: '', src: 'https://example.com' })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('沙箱节点缺少 id')
  })

  it('插件场景下（禁止任何槽位）面板与沙箱仍然合法', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'panel', id: 'demo:list' },
        { type: 'sandbox', id: 'sb', src: 'plugin-bundle://localhost/a.html' },
      ],
    }
    expect(validateRegionTree(root, []).ok).toBe(true)
  })
})

describe('validateRegionTree - part 节点', () => {
  it('v1 树里出现 part 会被拒绝', () => {
    const root: RegionNode = { type: 'part', id: 'scene-switcher' }
    const result = validateRegionTree(root, { shellMode: 'regions' })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('regionsSchemaVersion 2')
  })

  it('v1 树里出现 spacer 会被拒绝', () => {
    const result = validateRegionTree({ type: 'spacer' }, { regionsSchemaVersion: 1 })
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('regionsSchemaVersion 2')
  })

  it('v2 树里 part 与 spacer 均合法，且任何档位都可用', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'part', id: 'sidebar-toggle' },
        { type: 'spacer' },
        { type: 'part', id: 'quota', props: { placement: 'compact' } },
      ],
    }
    expect(validateRegionTree(root, { regionsSchemaVersion: 2 }).ok).toBe(true)
    expect(validateRegionTree(root, { shellMode: 'regions', regionsSchemaVersion: 2 }).ok).toBe(
      true,
    )
  })

  it('未知 part id 只告警，不拒整树', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'part', id: 'scene-switcher' },
        // 场景 SDK 比客户端新：客户端不认识这个部件
        { type: 'part', id: 'future-widget' } as unknown as RegionNode,
      ],
    }
    const result = validateRegionTree(root, { regionsSchemaVersion: 2 })
    expect(result.ok).toBe(true)
    expect(result.warnings[0]).toContain('future-widget')
  })

  it('同一部件重复引用会被拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'part', id: 'quota' },
        { type: 'part', id: 'quota' },
      ],
    }
    const result = validateRegionTree(root, { regionsSchemaVersion: 2 })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('部件 "quota" 被重复引用'))).toBe(true)
  })
})

describe('validateRegionTree - full 档位保留集', () => {
  it('保留件齐全时通过', () => {
    expect(validateRegionTree(fullTree(), FULL_CTX).ok).toBe(true)
  })

  it('缺少保留件时整树拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'part', id: 'scene-switcher' },
        { type: 'part', id: 'drag-region' },
        { type: 'panel', id: 'studio' },
      ],
    }
    const result = validateRegionTree(root, FULL_CTX)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('缺少保留部件 "window-controls"'))).toBe(true)
  })

  it('rail 缺省但有面板入口时通过', () => {
    expect(validateRegionTree(fullTree(), FULL_CTX).ok).toBe(true)
  })

  it('rail 缺省且无任何入口时被拒绝', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'part', id: 'scene-switcher' },
        { type: 'part', id: 'drag-region' },
        { type: 'part', id: 'window-controls' },
      ],
    }
    const result = validateRegionTree(root, FULL_CTX)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('没有任何可达的面板入口'))).toBe(true)
  })

  it('regions 档位不做保留集校验', () => {
    const root: RegionNode = {
      type: 'split',
      dir: 'row',
      children: [
        { type: 'slot', slot: 'sidebar' },
        { type: 'slot', slot: 'main' },
      ],
    }
    expect(
      validateRegionTree(root, { allowedSlots: SHELL_SLOTS, shellMode: 'regions' }).ok,
    ).toBe(true)
  })

  it('full 档位允许 10 层嵌套', () => {
    const deep = fullTree([nest({ type: 'part', id: 'chat' }, 9)])
    expect(validateRegionTree(deep, FULL_CTX).ok).toBe(true)
  })

  it('full 档位超过 12 层被拒绝', () => {
    const deep = fullTree([nest({ type: 'part', id: 'chat' }, 12)])
    const result = validateRegionTree(deep, FULL_CTX)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('嵌套深度超过 12 层'))).toBe(true)
  })
})
