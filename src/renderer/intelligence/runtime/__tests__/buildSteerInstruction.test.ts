import { describe, it, expect } from 'vitest'
import { buildSteerInstruction } from '../deviceTaskControl'

describe('buildSteerInstruction', () => {
  it('空输入返回空串，不产生空指令块', () => {
    expect(buildSteerInstruction([])).toBe('')
    expect(buildSteerInstruction(['   ', ''])).toBe('')
  })

  it('中文下声明优先级高于原计划，并要求先确认再执行', () => {
    const text = buildSteerInstruction(['别改样式了，先修登录'])
    expect(text).toContain('用户在你执行期间补充的说明')
    expect(text).toContain('1. 别改样式了，先修登录')
    expect(text).toContain('优先级高于你之前声明的计划')
    expect(text).toContain('先用一句话说明')
    expect(text).toContain('不要等到回复末尾')
  })

  it('英文下输出英文模板，不掺杂中文', () => {
    const text = buildSteerInstruction(['stop refactoring, fix the login bug'], 'en')
    expect(text).toContain('Steering message from the user')
    expect(text).toContain('1. stop refactoring, fix the login bug')
    expect(text).toContain('higher priority than the plan you stated earlier')
    expect(text).not.toMatch(/[\u4e00-\u9fa5]/)
  })

  it('多条插话按顺序编号，合并成同一段指令', () => {
    const text = buildSteerInstruction(['第一条', '第二条'])
    expect(text).toContain('1. 第一条')
    expect(text).toContain('2. 第二条')
  })
})
