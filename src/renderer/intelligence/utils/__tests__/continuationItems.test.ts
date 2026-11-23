import { describe, it, expect } from 'vitest'
import {
  normalizeContinuationItem,
  isSameContinuationItem,
  dedupeContinuationItems,
  filterCompletedContinuationItems,
  pickUncompletedTodos,
} from '../continuationItems'

describe('normalizeContinuationItem', () => {
  it('抹平空白、大小写与中英文标点', () => {
    expect(normalizeContinuationItem('  编写登录页表单组件  ')).toBe('编写登录页表单组件')
    expect(normalizeContinuationItem('Fix the Login Page.')).toBe('fixtheloginpage')
    expect(normalizeContinuationItem('对接 /api/login，并处理错误态')).toBe('对接apilogin并处理错误态')
  })

  it('保留中英文字符本身，不做同义改写', () => {
    expect(normalizeContinuationItem('补充单元测试')).toBe('补充单元测试')
    expect(normalizeContinuationItem('补充单元测试')).not.toBe(normalizeContinuationItem('补充集成测试'))
  })
})

describe('isSameContinuationItem', () => {
  it('归一化后相等即同一项', () => {
    expect(isSameContinuationItem('编写登录页表单组件', '编写登录页表单组件。')).toBe(true)
  })

  it('一方是另一方子串时视为同一项', () => {
    expect(isSameContinuationItem('编写登录页表单', '编写登录页表单组件')).toBe(true)
  })

  it('短前缀不参与包含判定（阈值 6，保守优先避免误删未完成项）', () => {
    expect(isSameContinuationItem('编写登录页', '编写登录页表单组件')).toBe(false)
  })

  it('过短的子串不参与包含判定，避免吞掉不相干条目', () => {
    expect(isSameContinuationItem('测试', '测试登录页表单校验')).toBe(false)
  })

  it('空值判定为不同项', () => {
    expect(isSameContinuationItem('', '')).toBe(false)
    expect(isSameContinuationItem('', '编写登录页')).toBe(false)
  })
})

describe('filterCompletedContinuationItems', () => {
  const todos = [
    { content: '生成 B 相用户的对比报表', status: 'completed' },
    { content: '编写登录页表单组件', status: 'in_progress' },
    { content: '导出结果包', status: 'completed' },
    { content: '补充表单校验的单元测试', status: 'pending' },
  ]

  it('剔除已完成的条目，保留未完成的条目', () => {
    expect(
      filterCompletedContinuationItems(
        [
          '生成 B 相用户的对比报表',
          '编写登录页表单组件',
          '导出结果包',
          '补充表单校验的单元测试',
        ],
        todos,
      ),
    ).toEqual(['编写登录页表单组件', '补充表单校验的单元测试'])
  })

  it('文案有空白/标点差异时仍能识别为已完成', () => {
    expect(
      filterCompletedContinuationItems(['生成 B 相用户的对比报表。', ' 导出结果包 '], todos),
    ).toEqual([])
  })

  it('全部条目均已完成时返回空数组（调用方据此不生成卡片）', () => {
    expect(filterCompletedContinuationItems(['生成 B 相用户的对比报表', '导出结果包'], todos)).toEqual(
      [],
    )
  })

  it('待办清单为空时原样保留（模型没建清单，无从判断）', () => {
    expect(filterCompletedContinuationItems(['编写登录页', '导出结果包'], [])).toEqual([
      '编写登录页',
      '导出结果包',
    ])
  })

  it('待办里没有任何已完成项时原样保留', () => {
    expect(
      filterCompletedContinuationItems(['编写登录页表单组件'], [
        { content: '编写登录页表单组件', status: 'in_progress' },
      ]),
    ).toEqual(['编写登录页表单组件'])
  })

  it('清单中未出现在待办里的事项不会被误删', () => {
    expect(filterCompletedContinuationItems(['补充文档说明'], todos)).toEqual(['补充文档说明'])
  })
})

describe('dedupeContinuationItems', () => {
  it('归一化后重复的条目只保留首次出现的那条', () => {
    expect(
      dedupeContinuationItems(['导出结果包', ' 导出结果包 ', '导出结果包。', '生成对比报表']),
    ).toEqual(['导出结果包', '生成对比报表'])
  })

  it('丢弃空白条目', () => {
    expect(dedupeContinuationItems(['', '   ', '导出结果包'])).toEqual(['导出结果包'])
  })

  it('大小写与标点不同视为同一条', () => {
    expect(dedupeContinuationItems(['Fix the login page', 'fix the login page.'])).toEqual([
      'Fix the login page',
    ])
  })
})

describe('pickUncompletedTodos', () => {
  it('剔除已完成的待办', () => {
    expect(
      pickUncompletedTodos([
        { content: '生成对比报表', status: 'completed', activeForm: '生成对比报表' },
        { content: '编写登录页', status: 'in_progress', activeForm: '正在编写登录页' },
        { content: '补充单元测试', status: 'pending', activeForm: '补充单元测试' },
      ]).map(t => t.content),
    ).toEqual(['编写登录页', '补充单元测试'])
  })

  it('同一件事同时存在已完成与未完成副本时，按已完成处理', () => {
    expect(
      pickUncompletedTodos([
        { content: '导出结果包', status: 'completed', activeForm: '导出结果包' },
        { content: ' 导出结果包。', status: 'pending', activeForm: '导出结果包' },
        { content: '补充说明文档', status: 'pending', activeForm: '补充说明文档' },
      ]).map(t => t.content),
    ).toEqual(['补充说明文档'])
  })

  it('内容完全重复的未完成条目只保留一条', () => {
    expect(
      pickUncompletedTodos([
        { content: '补充单元测试', status: 'pending', activeForm: '补充单元测试' },
        { content: '补充单元测试。', status: 'pending', activeForm: '补充单元测试' },
      ]).length,
    ).toBe(1)
  })

  it('verifying 属于未完成，需要保留', () => {
    expect(
      pickUncompletedTodos([
        { content: '编写登录页', status: 'verifying', activeForm: '验证登录页' },
      ]).map(t => t.content),
    ).toEqual(['编写登录页'])
  })

  it('全部已完成时返回空数组（调用方据此不显示续做栏）', () => {
    expect(
      pickUncompletedTodos([
        { content: '导出结果包', status: 'completed', activeForm: '导出结果包' },
      ]),
    ).toEqual([])
  })

  it('空内容条目不参与展示', () => {
    expect(
      pickUncompletedTodos([
        { content: '   ', status: 'pending', activeForm: '空' },
        { content: '导出结果包', status: 'pending', activeForm: '导出结果包' },
      ]).map(t => t.content),
    ).toEqual(['导出结果包'])
  })

  it('措辞明显不同的未完成条目不会被误删', () => {
    expect(
      pickUncompletedTodos([
        { content: '编写登录页', status: 'completed', activeForm: '编写登录页' },
        { content: '编写登录页样式', status: 'pending', activeForm: '编写登录页样式' },
      ]).map(t => t.content),
    ).toEqual(['编写登录页样式'])
  })

  it('按 labelOf 指定的字段做比对', () => {
    const items = [
      { title: '导出结果包', status: 'completed' },
      { title: ' 导出结果包。', status: 'pending' },
    ]
    expect(pickUncompletedTodos(items, t => t.title)).toEqual([])
  })
})
