/**
 * close_preview 工具的定义守卫
 *
 * 背景：AI 打开预览后想收起标签页时，曾经只能回一句「内置浏览器没有关闭接口，
 * 请你手动点 ×」——把机械操作推回给用户。这里固定住三件事：
 * - 工具定义存在，且与 open_preview 同属交互能力组（同一场景开启时一起可用）
 * - 三种模式都会下发它，不会出现「能开不能关」
 * - 参数只暴露 session_id / url / all，不引入多余的定位方式
 */

import { describe, it, expect } from 'vitest'
import { TOOL_CONFIGS } from '../toolDefinitions'
import { getToolsForContext } from '../toolCategoryDefs'

describe('close_preview 工具', () => {
  it('工具定义存在且属于交互能力组', () => {
    const config = TOOL_CONFIGS.close_preview
    expect(config).toBeTruthy()
    expect(config.name).toBe('close_preview')
    expect(config.category).toBe(TOOL_CONFIGS.open_preview.category)
  })

  it('关闭预览不需要审批，也不依赖工作空间', () => {
    const config = TOOL_CONFIGS.close_preview
    expect(config.approvalType).toBe('none')
    expect(config.requiresWorkspace).toBe(false)
    expect(config.enabled).toBe(true)
  })

  it('支持按会话、按地址片段、以及全部关闭三种定位方式', () => {
    const params = TOOL_CONFIGS.close_preview.parameters || {}
    expect(Object.keys(params).sort()).toEqual(['all', 'session_id', 'url'])
    expect(params.all.type).toBe('boolean')
  })

  it('三种模式都会下发（能打开就一定能关闭）', () => {
    for (const mode of ['chat', 'agent', 'expert'] as const) {
      expect(getToolsForContext({ mode }), `${mode} 模式缺少 close_preview`).toContain(
        'close_preview',
      )
    }
  })

  it('工具说明明确禁止让用户手点关闭', () => {
    const definition = JSON.stringify(TOOL_CONFIGS.close_preview)
    expect(definition).toContain('close_preview')
    // 关键引导：AI 应当自己关，而不是把操作推回用户
    expect(definition).toContain('×')
  })
})
