import { describe, it, expect } from 'vitest'
import { partitionEntriesForSync, describeSyncBlock } from './syncGuard'

describe('partitionEntriesForSync', () => {
  it('普通记忆进入同步集合', () => {
    const { syncable, blocked } = partitionEntriesForSync([
      { id: 'a', content: '项目周会在周二上午', summary: '周会安排' },
    ])
    expect(syncable.map((e) => e.id)).toEqual(['a'])
    expect(blocked).toHaveLength(0)
  })

  it('正文命中的记忆被拦截并给出原因', () => {
    const { syncable, blocked, reasons } = partitionEntriesForSync([
      { id: 'a', content: '正常内容' },
      { id: 'b', content: '他的手机号是 13812345678' },
    ])
    expect(syncable.map((e) => e.id)).toEqual(['a'])
    expect(blocked.map((e) => e.id)).toEqual(['b'])
    expect(reasons).toHaveProperty('b')
  })

  it('摘要命中同样拦截', () => {
    const { blocked, reasons } = partitionEntriesForSync([
      { id: 'c', content: '无异常正文', summary: '身份证 11010119900307651X' },
    ])
    expect(blocked.map((e) => e.id)).toEqual(['c'])
    expect(reasons.c).toContain('摘要')
  })

  it('带敏感标签的记忆被拦截', () => {
    const { blocked } = partitionEntriesForSync([
      { id: 'd', content: '看起来普通的内容', tags: '["敏感"]' },
    ])
    expect(blocked.map((e) => e.id)).toEqual(['d'])
  })

  it('整批敏感时不产出可同步条目', () => {
    const { syncable, blocked } = partitionEntriesForSync([
      { id: 'e', content: 'api_key = sk-secret' },
    ])
    expect(syncable).toHaveLength(0)
    expect(blocked).toHaveLength(1)
  })
})

describe('describeSyncBlock', () => {
  it('可外发返回 null', () => {
    expect(describeSyncBlock({ id: 'a', content: '普通内容' })).toBeNull()
  })

  it('命中敏感时返回可读原因', () => {
    expect(describeSyncBlock({ id: 'a', content: '邮箱 user@example.com' })).toContain('邮箱')
  })
})
