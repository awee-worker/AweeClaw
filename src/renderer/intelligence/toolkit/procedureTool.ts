/**
 * 宏工具（程序性流程回放）
 *
 * 把已固化的工具序列注册成可调用的工具。模型命中同类任务时直接调用，
 * 不再逐步推理——这是程序性技能从「提示级」走向「执行级」的落点。
 *
 * 安全边界（与方案的验收要求一一对应）：
 * - 宏工具本身按 write 审批一次，用户批准即批准整条序列；
 *   回放内部子工具时 skipMainApproval，避免同一条流程反复弹确认。
 * - 任一步失败立即中断，并把本次结果记为模板失败，模板随即退回提示级。
 * - 用户中止穿透到子步骤，中止不计为失败（不是流程本身的问题）。
 * - 每步仍是普通工具调用，检查点与回滚机制照常生效。
 */

import { logger } from '@toolkit/LogEngine'
import { toolRegistry } from './toolRegistry'
import { toolManager } from './providers'
import {
  proceduralSkillLearner,
  PROCEDURE_TOOL_PREFIX,
  type ProceduralTemplate,
} from '../runtime/proceduralSkillLearner'
import type { ToolExecutor } from '@intelligence/providerTypes'

/** 当前已注册的宏工具名，用于重新同步时先卸载 */
const registeredTools = new Set<string>()

type ProcedureStep = ProceduralTemplate['toolSequence'][number]

/**
 * 按模板的参数槽位组装单步参数
 *
 * 固定槽位用模板中保存的值；动态槽位取调用方传入的同名参数。
 * 缺失的动态参数不补空值——交给下游工具自己报参数错误，
 * 避免构造出一个看似合法、实际语义错误的调用。
 */
function buildStepArgs(step: ProcedureStep, provided: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [key, slot] of Object.entries(step.params)) {
    if (slot.type === 'fixed') {
      args[key] = slot.value
      continue
    }
    if (slot.placeholder && provided[slot.placeholder] !== undefined) {
      args[key] = provided[slot.placeholder]
    }
  }
  return args
}

/** 为一个模板构造回放执行器 */
function createExecutor(template: ProceduralTemplate): ToolExecutor {
  return async (args, context) => {
    const provided = (args || {}) as Record<string, unknown>
    const stepLogs: string[] = []
    const total = template.toolSequence.length

    for (let i = 0; i < total; i++) {
      const step = template.toolSequence[i]

      // 中止信号必须逐步检查：否则用户点了停止，回放还会安静地跑完剩余步骤
      if (context.abortSignal?.aborted) {
        logger.agent.info(`[ProcedureTool] Aborted at step ${i + 1}/${total}`)
        return {
          success: false,
          result: stepLogs.join('\n'),
          error: 'Procedure aborted by user before completion.',
          callFailed: true,
        }
      }

      const stepArgs = buildStepArgs(step, provided)
      let result
      try {
        result = await toolManager.execute(step.toolName, stepArgs, {
          ...context,
          skipMainApproval: true,
        })
      } catch (err) {
        await proceduralSkillLearner.recordTemplateExecution(template.id, false)
        return {
          success: false,
          result: stepLogs.join('\n'),
          error: `Step ${i + 1}/${total} (${step.toolName}) threw: ${err instanceof Error ? err.message : String(err)}. Procedure stopped — fall back to normal step-by-step execution.`,
          callFailed: true,
        }
      }

      const failed = result.callFailed ?? !result.success
      if (failed) {
        await proceduralSkillLearner.recordTemplateExecution(template.id, false)
        return {
          success: false,
          result: stepLogs.join('\n'),
          error: `Step ${i + 1}/${total} (${step.toolName}) failed: ${result.error || 'unknown error'}. Procedure stopped — fall back to normal step-by-step execution.`,
          callFailed: true,
        }
      }

      stepLogs.push(`[${i + 1}/${total}] ${step.toolName}: ${result.result || 'ok'}`)
    }

    await proceduralSkillLearner.recordTemplateExecution(template.id, true)
    return {
      success: true,
      result: `Procedure completed (${total} steps):\n${stepLogs.join('\n')}`,
    }
  }
}

/**
 * 同步宏工具注册表
 *
 * 幂等：新增可执行模板、刷新已注册的、卸载不再满足条件的。
 * 调用时机为任务结束（模板统计已更新）与技能变更通知。
 */
export async function syncProcedureTools(): Promise<void> {
  try {
    const templates = await proceduralSkillLearner.getInvocableTemplates()

    const wanted = new Map<string, ProceduralTemplate>()
    for (const template of templates) {
      wanted.set(proceduralSkillLearner.buildToolName(template.id), template)
    }

    // 卸载已失效的（连续失败、被停用、或模板被淘汰）
    for (const name of Array.from(registeredTools)) {
      if (!wanted.has(name)) {
        toolRegistry.unregisterScenarioTool(name)
        registeredTools.delete(name)
        logger.agent.info(`[ProcedureTool] Unregistered: ${name}`)
      }
    }

    // 注册或刷新
    for (const [name, template] of wanted) {
      const definition = proceduralSkillLearner.toToolDefinition(template)
      if (!definition) continue
      // override=true：模板的工具序列可能随成功执行被更新，执行器需替换为新闭包
      // exposeToModel=true：宏工具名运行时才出现，不在静态白名单内，需显式放行
      toolRegistry.registerScenarioTool(name, definition, createExecutor(template), {
        override: true,
        exposeToModel: true,
      })
      registeredTools.add(name)
    }

    if (wanted.size > 0) {
      logger.agent.info(`[ProcedureTool] Synced ${wanted.size} procedure tool(s)`)
    }
  } catch (err) {
    logger.agent.warn('[ProcedureTool] Sync failed:', err)
  }
}

/** 判断工具名是否属于宏工具 */
export function isProcedureTool(name: string): boolean {
  return name.startsWith(PROCEDURE_TOOL_PREFIX)
}
