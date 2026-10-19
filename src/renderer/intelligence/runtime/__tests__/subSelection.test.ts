import { describe, expect, it } from 'vitest'
import {
  deriveSubSelection,
  mergeSubSelections,
  normalizeSubSelections,
} from '../subSelection'

describe('mergeSubSelections', () => {
  it('不同二级项并存，不互相覆盖', () => {
    const first = mergeSubSelections(undefined, [{ key: '生成方式', label: '生成方式：逐页生成' }])
    const second = mergeSubSelections(first, [{ key: '模板风格', label: '模板风格：商务浅色' }])
    expect(second.map(entry => entry.key)).toEqual(['生成方式', '模板风格'])
  })

  it('同一二级项后选覆盖先选', () => {
    const merged = mergeSubSelections(
      [{ key: '模板风格', label: '模板风格：商务浅色' }],
      [{ key: '模板风格', label: '模板风格：科技深色' }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].label).toBe('模板风格：科技深色')
  })

  it('没有 key 的条目视为整体替换', () => {
    const merged = mergeSubSelections(
      [{ key: '生成方式', label: '生成方式：逐页生成' }],
      [{ key: '', label: '整份生成' }],
    )
    expect(merged).toEqual([{ key: '', label: '整份生成' }])
  })

  it('空条目不会清掉已有选择', () => {
    const existing = [{ key: '生成方式', label: '生成方式：逐页生成' }]
    expect(mergeSubSelections(existing, [])).toBe(existing)
  })
})

describe('deriveSubSelection', () => {
  it('展示串列出全部选择，说明只收有正文的项', () => {
    const derived = deriveSubSelection([
      { key: '生成方式', label: '生成方式：逐页生成', note: '逐页生成，不要整份一次性输出' },
      { key: '模板风格', label: '模板风格：商务浅色' },
    ])
    expect(derived.subSelection).toBe('生成方式：逐页生成 · 模板风格：商务浅色')
    expect(derived.stateNote).toBe('逐页生成，不要整份一次性输出')
  })

  it('多条说明按行合并，谁都不会丢', () => {
    const derived = deriveSubSelection([
      { key: 'a', label: 'A：1', note: '约束一' },
      { key: 'b', label: 'B：2', note: '约束二' },
    ])
    expect(derived.stateNote).toBe('约束一\n\n约束二')
  })

  it('没有选择时不产出空字段', () => {
    expect(deriveSubSelection([])).toEqual({ subSelection: undefined, stateNote: undefined })
  })
})

describe('normalizeSubSelections', () => {
  it('结构化优先', () => {
    const entries = [{ key: 'k', label: 'K：v' }]
    expect(normalizeSubSelections({ subSelections: entries, subSelection: '别的' })).toBe(entries)
  })

  it('只有展示串时补成一条，并接管 stateNote 作为说明', () => {
    expect(normalizeSubSelections({ subSelection: '模板：商务浅色', stateNote: '用商务浅色模板' }))
      .toEqual([{ key: '', label: '模板：商务浅色', note: '用商务浅色模板' }])
  })

  it('只有说明时用它自身充当标签', () => {
    expect(normalizeSubSelections({ stateNote: '当前默认模板：科技深色' }))
      .toEqual([{ key: '', label: '当前默认模板：科技深色', note: '当前默认模板：科技深色' }])
  })

  it('什么都没有时返回空数组', () => {
    expect(normalizeSubSelections({})).toEqual([])
  })
})
