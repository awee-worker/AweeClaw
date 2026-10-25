import { describe, expect, it } from 'vitest'
import {
  buildMemoryRelations,
  compareText,
  effectiveGrams,
} from '../../../src/renderer/intelligence/runtime/knowledgeService/memoryRelationBuilder'

const DAY = 24 * 60 * 60 * 1000
const base = 1_700_000_000_000

describe('记忆关联：只给内容真正相关的记忆建边', () => {
  it('同域 + 时间邻近但内容无关，不建边', () => {
    const relations = buildMemoryRelations(
      {
        id: 'a',
        content: '用户的月度报表一律用横版 A4 纸张打印',
        tags: ['domain:work'],
        createdAt: base,
      },
      [
        {
          id: 'b',
          content: '项目部署脚本放在 scripts 目录下执行',
          tags: ['domain:work'],
          createdAt: base + 60_000,
        },
      ],
    )
    expect(relations).toHaveLength(0)
  })

  it('内容高度相似，建 similar 边', () => {
    const relations = buildMemoryRelations(
      {
        id: 'a',
        content: '导出结果页的数据表缺少 sheet，需要补齐标准输出基准表',
        tags: ['domain:work'],
        createdAt: base,
      },
      [
        {
          id: 'b',
          content: '导出结果页的数据表缺少 sheet，需要补齐标准输出基准表',
          tags: ['domain:work'],
          createdAt: base + 1000,
        },
      ],
    )
    expect(relations).toHaveLength(1)
    expect(relations[0].relationType).toBe('similar')
  })

  it('只有套话重合时相似度为 0', () => {
    const detail = compareText(
      '我们需要可以使用的功能',
      '我们应该可以实现的方案',
    )
    expect(detail.similarity).toBe(0)
    expect(detail.sharedGrams).toBe(0)
  })

  it('时序关联最多一条', () => {
    const relations = buildMemoryRelations(
      {
        id: 'a',
        content: '单线图连接线起点必须在接入点上，不能悬空',
        tags: ['domain:work'],
        createdAt: base,
      },
      [
        {
          id: 'b',
          content: '单线图连接线起点要落在接入点上',
          tags: ['domain:work'],
          createdAt: base + 1000,
        },
        {
          id: 'c',
          content: '单线图的连接线起点位置需要再确认',
          tags: ['domain:work'],
          createdAt: base + 2000,
        },
      ],
      { maxRelations: 5 },
    )
    expect(relations.filter(r => r.relationType === 'temporal').length).toBeLessThanOrEqual(1)
  })

  it('跨域内容无关时不建边', () => {
    const relations = buildMemoryRelations(
      { id: 'a', content: '天气转凉记得加衣服', tags: ['domain:life'], createdAt: base },
      [{ id: 'b', content: '发票要按季度归档', tags: ['domain:work'], createdAt: base }],
    )
    expect(relations).toHaveLength(0)
  })
})

describe('effectiveGrams 过滤高频套话', () => {
  it('剔除「我们」「可以」「需要」等搭配', () => {
    const grams = effectiveGrams('我们可以需要的功能')
    expect(grams.has('我们')).toBe(false)
    expect(grams.has('可以')).toBe(false)
    expect(grams.has('需要')).toBe(false)
    expect(grams.has('功能')).toBe(false)
  })
})

describe('24 小时窗口外不建 temporal', () => {
  it('超过一天即使同域且相关也不建 temporal', () => {
    const relations = buildMemoryRelations(
      { id: 'a', content: '杆塔命名要沿用源台区拓扑的名称', tags: ['domain:work'], createdAt: base },
      [{ id: 'b', content: '杆塔名称必须沿用源台区拓扑', tags: ['domain:work'], createdAt: base + 3 * DAY }],
    )
    expect(relations.every(r => r.relationType !== 'temporal')).toBe(true)
  })
})
