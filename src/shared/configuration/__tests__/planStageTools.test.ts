/**
 * 计划阶段工具收窄守卫
 *
 * 需求：任务计划模式（taskPlanMode）或 plan 的 planning 阶段下，模型只能看到
 * 「建计划 + 只读探索」两类工具，写文件 / 跑命令 / 改环境一律不下发。
 *
 * 历史事故：任务计划模式只改了提示词文案，getToolsForContext 并未消费 planPhase，
 * 工具集仍是全量，模型直接动手干活，create_task_plan 形同可选步骤。
 */
import { describe, it, expect } from 'vitest'
import {
  PLAN_STAGE_TOOLS,
  getToolsForContext,
  isPlanStageContext,
} from '@configuration/toolCategoryDefs'

/** 计划阶段必须保留的工具：建计划 + 只读取证 */
const REQUIRED_IN_PLAN_STAGE = [
  'create_task_plan', 'update_task_plan', 'ask_user',
  'read_file', 'list_directory', 'search_files', 'extract_document',
  'web_search', 'read_url', 'knowledge_search',
]

/** 计划阶段必须剔除的工具：写文件 / 终端 / 代码改动 / 计划执行控制 */
const FORBIDDEN_IN_PLAN_STAGE = [
  'write_file', 'edit_file', 'create_file_or_folder', 'delete_file_or_folder',
  'run_command', 'read_terminal_output', 'send_terminal_input', 'stop_terminal',
  'start_task_execution',
]

describe('计划阶段工具收窄', () => {
  it('taskPlanMode 打开时只下发计划与只读工具', () => {
    const tools = getToolsForContext({ mode: 'expert', taskPlanMode: true })

    for (const name of REQUIRED_IN_PLAN_STAGE) {
      expect(tools, `计划阶段缺少 ${name}`).toContain(name)
    }
    for (const name of FORBIDDEN_IN_PLAN_STAGE) {
      expect(tools, `计划阶段不应下发 ${name}`).not.toContain(name)
    }
  })

  it('planPhase=planning 与 taskPlanMode 等价', () => {
    const byPhase = getToolsForContext({ mode: 'expert', planPhase: 'planning' }).sort()
    const byMode = getToolsForContext({ mode: 'expert', taskPlanMode: true }).sort()
    expect(byPhase).toEqual(byMode)
  })

  it('执行阶段与默认上下文不受影响（仍是全量内置工具）', () => {
    const baseline = getToolsForContext({ mode: 'expert' })
    const executing = getToolsForContext({ mode: 'expert', planPhase: 'executing' })

    expect(executing.sort()).toEqual(baseline.sort())
    expect(executing).toContain('write_file')
    expect(executing).toContain('run_command')
  })

  it('场景与角色追加来源无法把执行类工具加回计划阶段', () => {
    const tools = getToolsForContext({
      mode: 'expert',
      taskPlanMode: true,
      scenarioToolPacks: ['code', 'data', 'office'],
      scenarioTools: ['run_command'],
    })

    for (const name of FORBIDDEN_IN_PLAN_STAGE) {
      expect(tools, `计划阶段不应下发 ${name}`).not.toContain(name)
    }
    expect(tools).toContain('create_task_plan')
  })

  it('计划进入执行阶段后不再收窄：会话级开关留着也不挡写类工具', () => {
    const tools = getToolsForContext({ mode: 'expert', taskPlanMode: true, planPhase: 'executing' })

    expect(tools).toContain('write_file')
    expect(tools).toContain('run_command')
    expect(tools).toContain('start_task_execution')
  })

  it('不存在计划上下文时按全量工具处理', () => {
    // 没有活动计划 → planPhase 不下发；此前默认成 planning 会静默锁死专家档
    expect(isPlanStageContext({})).toBe(false)
    expect(isPlanStageContext({ planPhase: undefined, taskPlanMode: false })).toBe(false)
    expect(isPlanStageContext({ planPhase: 'executing' })).toBe(false)
    expect(isPlanStageContext({ planPhase: 'planning' })).toBe(true)
    expect(isPlanStageContext({ taskPlanMode: true })).toBe(true)
  })

  it('白名单只含计划与只读能力', () => {
    expect(PLAN_STAGE_TOOLS).toContain('create_task_plan')
    expect(PLAN_STAGE_TOOLS).not.toContain('write_file')
    expect(PLAN_STAGE_TOOLS).not.toContain('run_command')
    expect(PLAN_STAGE_TOOLS).not.toContain('start_task_execution')
  })
})
