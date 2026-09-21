/**
 * 预览健康自检工具的注册一致性测试
 *
 * 新增工具最容易出的问题不是实现，而是「定义了却没被暴露出去」：
 * 工具定义、导出表、工具包三者必须同时命中有工具名，否则 AI 侧根本看不到它。
 * 这里把这条链路固定下来。
 */

import { describe, it, expect } from 'vitest'
import {
  TOOL_CONFIGS,
  TOOL_DEFINITIONS,
  TOOL_DISPLAY_NAMES,
  generateToolDefinition,
} from '../toolDefinitions'
import { toolPackRegistry } from '../toolPacks'

describe('inspect_preview 工具注册', () => {
  it('工具定义存在且字段完整', () => {
    const config = TOOL_CONFIGS.inspect_preview

    expect(config).toBeDefined()
    expect(config.name).toBe('inspect_preview')
    expect(config.displayName).toBeTruthy()
    expect(config.description).toContain('built-in browser')
    // 只读工具：不需要审批、不参与并行批处理
    expect(config.approvalType).toBe('none')
    expect(config.enabled).not.toBe(false)
  })

  it('与 open_preview 同属交互能力，便于被同一组场景启用', () => {
    expect(TOOL_CONFIGS.inspect_preview.category).toBe(TOOL_CONFIGS.open_preview.category)
  })

  it('声明了定位预览标签页所需的参数', () => {
    const params = TOOL_CONFIGS.inspect_preview.parameters ?? {}

    expect(params.session_id).toBeDefined()
    expect(params.url).toBeDefined()
    expect(params.include_network).toBeDefined()
  })

  it('已进入导出表（AI 侧据此生成 schema 与显示名）', () => {
    expect(TOOL_DEFINITIONS.inspect_preview).toBeDefined()
    expect(TOOL_DISPLAY_NAMES.inspect_preview).toBeTruthy()
  })

  it('能生成合法的工具 schema', () => {
    const definition = generateToolDefinition(TOOL_CONFIGS.inspect_preview)

    expect(definition).toBeTruthy()
    expect(JSON.stringify(definition)).toContain('inspect_preview')
  })

  it('已纳入代码工具包（场景声明 code 包时同样可用）', () => {
    expect(toolPackRegistry.resolveTools(['code'])).toContain('inspect_preview')
  })
})
