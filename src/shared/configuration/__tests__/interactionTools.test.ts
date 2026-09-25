/**
 * 内置工具全量放行守卫
 *
 * 需求：快速（chat）/ 思考（agent）/ 专家（plan）三种模式，以及所有场景，
 * 都能使用全部内置工具。模式与场景只做「追加」，不再裁剪内置工具。
 *
 * 历史事故：选择「智能体」模式后 AI 提示「我需要用 ask_user 工具，但它不在我的
 * 工具列表里」—— 根因就是当时按模式/场景裁剪内置工具。
 */
import { describe, it, expect } from 'vitest'
import {
  GIT_READ_TOOL_NAMES,
  GIT_TOOL_NAMES,
  GIT_WRITE_TOOL_NAMES,
  getToolsForContext,
} from '@configuration/toolCategoryDefs'

/** 各模式 / 场景下都应可用的代表性内置工具（跨文件、终端、代码、网络、交互、规划） */
const CORE_SAMPLE = [
  // 文件读写
  'read_file', 'write_file', 'edit_file', 'list_directory', 'search_files',
  'create_file_or_folder', 'delete_file_or_folder',
  // 终端
  'run_command', 'read_terminal_output', 'send_terminal_input', 'stop_terminal',
  // 代码智能
  'codebase_search', 'get_lint_errors', 'find_references', 'go_to_definition',
  'get_hover_info', 'get_document_symbols',
  // 网络
  'web_search', 'read_url', 'image_search', 'video_search',
  // 文档与交互
  'extract_document', 'ask_user', 'remember', 'knowledge_search',
  'companion_control', 'open_preview', 'inspect_preview',
  // 任务与规划（此前仅专家模式可用）
  'todo_write', 'schedule', 'apply_skill',
  'create_task_plan', 'update_task_plan', 'start_task_execution',
  'add_node', 'add_edge',
  // 角色专属（此前仅 uiux-designer 角色可用）
  'uiux_search', 'uiux_recommend',
]

describe('内置工具全量放行', () => {
  it('三种模式都可使用全部内置工具', () => {
    for (const mode of ['chat', 'agent', 'plan'] as const) {
      const tools = getToolsForContext({ mode })
      for (const name of CORE_SAMPLE) {
        expect(tools, `${mode} 模式缺少 ${name}`).toContain(name)
      }
    }
  })

  it('三种模式的内置工具集完全一致（差异只在审批策略）', () => {
    // 在默认上下文（未授权 git、无场景）下三模式工具集逐个相同
    const agent = getToolsForContext({ mode: 'agent' }).sort()
    expect(getToolsForContext({ mode: 'chat' }).sort()).toEqual(agent)
    expect(getToolsForContext({ mode: 'plan' }).sort()).toEqual(agent)
  })

  it('场景声明工具包 / 直接声明工具都不减少内置工具', () => {
    const baseline = getToolsForContext({ mode: 'agent' })
    const variants: Array<Parameters<typeof getToolsForContext>[0]> = [
      { mode: 'agent', scenarioToolPacks: ['code'] },
      { mode: 'agent', scenarioToolPacks: ['data'] },
      { mode: 'agent', scenarioToolPacks: ['media'] },
      { mode: 'agent', scenarioTools: ['read_file'] },
      { mode: 'chat', scenarioToolPacks: ['office'] },
      { mode: 'plan', scenarioToolPacks: ['web'] },
    ]

    for (const ctx of variants) {
      const tools = new Set(getToolsForContext(ctx))
      const missing = baseline.filter((t) => !tools.has(t))
      expect(
        missing,
        `${JSON.stringify(ctx)} 下丢失内置工具：${missing.join(', ')}`,
      ).toEqual([])
    }
  })

  it('自定义智能体白名单不限制内置工具', () => {
    const tools = getToolsForContext({ mode: 'agent', agentBuiltinTools: ['read_file'] })
    for (const name of CORE_SAMPLE) {
      expect(tools, `智能体白名单下缺少 ${name}`).toContain(name)
    }
  })

  it('git 工具仍按需暴露，且快速模式不暴露写入类工具', () => {
    // 未授权：三种模式都不下发任何 git_*
    for (const mode of ['chat', 'agent', 'plan'] as const) {
      const tools = getToolsForContext({ mode })
      expect(GIT_TOOL_NAMES.filter((n) => tools.includes(n))).toEqual([])
    }

    // 用户指令授权后：只读工具三种模式一致下发
    for (const mode of ['chat', 'agent', 'plan'] as const) {
      const granted = getToolsForContext({ mode, gitToolsEnabled: true })
      for (const name of GIT_READ_TOOL_NAMES) {
        expect(granted, `${mode} 模式授权后缺少 ${name}`).toContain(name)
      }
    }

    // 写入类工具仅 agent / plan —— 快速模式是免审批通道，授权后也不给写仓库能力
    const chatGranted = getToolsForContext({ mode: 'chat', gitToolsEnabled: true })
    for (const name of GIT_WRITE_TOOL_NAMES) {
      expect(chatGranted, `chat 模式不应下发 ${name}`).not.toContain(name)
    }
  })
})

