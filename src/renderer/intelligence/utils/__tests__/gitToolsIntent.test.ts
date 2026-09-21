import { describe, it, expect } from 'vitest'
import { isGitToolsIntent, isGitToolsIntentFromMessages } from '@intelligence/utils/gitToolsIntent'

describe('isGitToolsIntent', () => {
  it('明确的版本控制指令判定为真', () => {
    const cases = [
      '帮我提交一下最近的改动，写清楚提交说明',
      '看一下当前分支和主分支的差异',
      '帮我新建一个分支修这个缺陷',
      '合并的时候有冲突了，帮我解决一下',
      '查一下这个文件最近是谁改的',
      '把远端的改动拉下来',
      '这个改动想先撤回来，恢复到上一次提交',
      '把最近的改动 stash 一下',
      '给我打个审计封存标签',
    ]
    for (const text of cases) {
      expect(isGitToolsIntent(text), text).toBe(true)
    }
  })

  it('普通开发请求不触发 Git 工具', () => {
    const cases = [
      '帮我重构一下这个模块，把状态管理和副作用拆开',
      '给这个列表加上虚拟滚动',
      '把两个表格合并成一份汇总',
      '同步一下会议时间',
      '统计一下这个月的支出',
      '把这段回调改写成 async/await',
    ]
    for (const text of cases) {
      expect(isGitToolsIntent(text), text).toBe(false)
    }
  })

  it('表单 / 订单类「提交」不算版本控制操作', () => {
    expect(isGitToolsIntent('把这个表单提交逻辑改一下')).toBe(false)
    expect(isGitToolsIntent('提交订单后要跳转到支付页')).toBe(false)
  })

  it('短衔接语沿用上一轮的 Git 判定结论', () => {
    expect(isGitToolsIntent('好的', ['帮我提交代码'])).toBe(true)
    expect(isGitToolsIntent('继续', ['把远端的改动拉下来'])).toBe(true)
    expect(isGitToolsIntent('好的', ['帮我重构这个模块'])).toBe(false)
  })

  it('缺少历史时短衔接语不触发', () => {
    expect(isGitToolsIntent('好的')).toBe(false)
    expect(isGitToolsIntent('')).toBe(false)
    expect(isGitToolsIntent(null)).toBe(false)
  })
})

describe('isGitToolsIntentFromMessages', () => {
  it('从最后一条用户消息判定', () => {
    expect(
      isGitToolsIntentFromMessages([
        { role: 'user', content: '帮我看看这个 bug' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '看一下当前分支' },
      ]),
    ).toBe(true)
  })

  it('确认回合沿用上一轮的 Git 结论', () => {
    expect(
      isGitToolsIntentFromMessages([
        { role: 'user', content: '帮我提交代码' },
        { role: 'assistant', content: '确定要提交吗？' },
        { role: 'user', content: '好的' },
      ]),
    ).toBe(true)
  })

  it('空消息序列与纯非 Git 对话判定为假', () => {
    expect(isGitToolsIntentFromMessages([])).toBe(false)
    expect(isGitToolsIntentFromMessages(undefined)).toBe(false)
    expect(
      isGitToolsIntentFromMessages([
        { role: 'user', content: [{ type: 'text', text: '帮我写一个周报' }] },
      ]),
    ).toBe(false)
  })

  it('多模态文本片段同样参与判定', () => {
    expect(
      isGitToolsIntentFromMessages([
        { role: 'user', content: [{ type: 'text', text: '把开发分支合并到主干' }] },
      ]),
    ).toBe(true)
  })
})
