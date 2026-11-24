/**
 * 相邻同文件写入合并的单元测试
 *
 * 覆盖三条主路径：连续同文件写入折叠成一组、语义或路径变化立刻断组、
 * 以及不可合并的条目（待批准 / 失败 / 取不到路径）不吞掉任何一张卡片。
 */
import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@intelligence/providerTypes'
import { groupAdjacentFileTools, resolveMergedBaseOldContent } from '../toolCallCard/fileToolMerge'

/** 构造一条工具调用 */
function tool(
  id: string,
  name: string,
  path: string,
  status: ToolCall['status'] = 'success',
  extra: Record<string, unknown> = {},
): ToolCall {
  return {
    id,
    name,
    arguments: { path, ...extra },
    status,
  }
}

const noneAwaiting = () => false

describe('groupAdjacentFileTools', () => {
  it('把连续写同一文件的调用折成一组，代表取最后一条', () => {
    const groups = groupAdjacentFileTools(
      [
        tool('a', 'write_file', 'src/index.js'),
        tool('b', 'write_file', 'src/index.js'),
        tool('c', 'write_file', 'src/index.js'),
      ],
      noneAwaiting,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].lead.id).toBe('c')
    expect(groups[0].merged.map((item) => item.id)).toEqual(['a', 'b'])
    // key 取组内第一条：合并期间代表会变，key 必须恒定
    expect(groups[0].key).toBe('a')
  })

  it('路径规范化后可视为同一文件', () => {
    const groups = groupAdjacentFileTools(
      [tool('a', 'write_file', './src/index.js'), tool('b', 'write_file', 'src\\index.js')],
      noneAwaiting,
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].merged).toHaveLength(1)
  })

  it('不同文件之间不合并', () => {
    const groups = groupAdjacentFileTools(
      [tool('a', 'write_file', 'src/a.js'), tool('b', 'write_file', 'src/b.js')],
      noneAwaiting,
    )

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.merged.length)).toEqual([0, 0])
  })

  it('编辑与创建语义不同，不合并', () => {
    const groups = groupAdjacentFileTools(
      [tool('a', 'write_file', 'src/index.js'), tool('b', 'edit_file', 'src/index.js')],
      noneAwaiting,
    )

    expect(groups).toHaveLength(2)
  })

  it('中间夹了别的工具就断组', () => {
    const groups = groupAdjacentFileTools(
      [
        tool('a', 'write_file', 'src/index.js'),
        tool('b', 'read_file', 'src/index.js'),
        tool('c', 'write_file', 'src/index.js'),
      ],
      noneAwaiting,
    )

    expect(groups).toHaveLength(3)
  })

  it('等待批准与失败的调用永远单独成组', () => {
    const awaiting = (tc: ToolCall) => tc.id === 'b'
    const groups = groupAdjacentFileTools(
      [
        tool('a', 'write_file', 'src/index.js'),
        tool('b', 'write_file', 'src/index.js', 'awaiting'),
        tool('c', 'write_file', 'src/index.js'),
        tool('d', 'write_file', 'src/index.js', 'error'),
      ],
      awaiting,
    )

    expect(groups.map((group) => group.lead.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(groups.every((group) => group.merged.length === 0)).toBe(true)
  })

  it('取不到路径的写入不参与合并', () => {
    const groups = groupAdjacentFileTools(
      [tool('a', 'write_file', ''), tool('b', 'write_file', '')],
      noneAwaiting,
    )

    expect(groups).toHaveLength(2)
  })
})

describe('resolveMergedBaseOldContent', () => {
  it('取组内最早一条的 oldContent 作为起点', () => {
    const base = resolveMergedBaseOldContent([
      tool('a', 'write_file', 'src/index.js', 'success', { _meta: { oldContent: 'line1' } }),
      tool('b', 'write_file', 'src/index.js', 'success', { _meta: { oldContent: 'line1\nline2' } }),
    ])

    expect(base).toBe('line1')
  })

  it('没有折叠成员时返回 null，调用方沿用卡片自身内容', () => {
    expect(resolveMergedBaseOldContent([])).toBeNull()
    expect(resolveMergedBaseOldContent(undefined)).toBeNull()
  })

  it('新建文件取不到旧内容时返回空串（整段都是新增）', () => {
    expect(resolveMergedBaseOldContent([tool('a', 'write_file', 'src/index.js')])).toBe('')
  })
})
