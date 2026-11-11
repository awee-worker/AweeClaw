import { describe, it, expect } from 'vitest'
import {
  normalizeContinuationItem,
  isSameContinuationItem,
  filterCompletedContinuationItems,
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
