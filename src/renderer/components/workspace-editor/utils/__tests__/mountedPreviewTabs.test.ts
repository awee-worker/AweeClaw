/**
 * 预览 Tab 常驻挂载收敛：选择逻辑测试
 *
 * 核心约束：
 * 1. 未超上限时原样返回（引用不变，避免每次渲染都判定为列表变化）
 * 2. 超上限时只保留 maxMounted 个
 * 3. 当前激活的 Tab 一定入选，且不重复
 * 4. 其余名额按 lastAccessed 从新到旧补齐
 * 5. 无激活项（切到非预览 Tab）时按纯最近使用取舍
 * 6. 上限非正时不挂载任何 Tab
 */

import { describe, it, expect } from 'vitest'
import { selectMountedPreviewTabs, type MountablePreviewTab } from '../mountedPreviewTabs'

function tabs(...entries: Array<[string, number]>): MountablePreviewTab[] {
    return entries.map(([path, lastAccessed]) => ({ path, lastAccessed }))
}

describe('selectMountedPreviewTabs', () => {
    it('未超上限时原样返回（保持引用）', () => {
        const list = tabs(['a', 1], ['b', 2])
        expect(selectMountedPreviewTabs(list, 'b', 6)).toBe(list)
    })

    it('超上限时只保留 maxMounted 个，并包含激活项', () => {
        const list = tabs(['a', 1], ['b', 2], ['c', 3], ['d', 4])
        const mounted = selectMountedPreviewTabs(list, 'a', 3)

        expect(mounted).toHaveLength(3)
        expect(mounted.map((tab) => tab.path)).toContain('a')
    })

    it('激活项排在最前且不重复', () => {
        const list = tabs(['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5])
        const mounted = selectMountedPreviewTabs(list, 'b', 3)

        expect(mounted[0].path).toBe('b')
        expect(mounted.map((tab) => tab.path)).toEqual(['b', 'e', 'd'])
    })

    it('其余名额按 lastAccessed 从新到旧补齐', () => {
        const list = tabs(['a', 10], ['b', 40], ['c', 30], ['d', 20], ['e', 5])
        // 激活 d 后，剩余名额 2 个应取最近使用的 b(40)、c(30)
        const mounted = selectMountedPreviewTabs(list, 'd', 3)

        expect(mounted.map((tab) => tab.path)).toEqual(['d', 'b', 'c'])
    })

    it('无激活项时按纯最近使用取舍', () => {
        const list = tabs(['a', 10], ['b', 40], ['c', 30])
        const mounted = selectMountedPreviewTabs(list, null, 2)

        expect(mounted.map((tab) => tab.path)).toEqual(['b', 'c'])
    })

    it('激活路径不在预览集合内时按纯最近使用取舍', () => {
        const list = tabs(['a', 10], ['b', 40], ['c', 30])
        const mounted = selectMountedPreviewTabs(list, 'file.ts', 2)

        expect(mounted.map((tab) => tab.path)).toEqual(['b', 'c'])
    })

    it('上限非正时不挂载任何 Tab', () => {
        const list = tabs(['a', 1], ['b', 2])
        expect(selectMountedPreviewTabs(list, 'a', 0)).toEqual([])
    })
})
