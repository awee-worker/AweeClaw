/**
 * 注入防御端到端验收
 *
 * 把「来源标注 → 上下文包裹 → 确认升级 → 记忆准入」串成一条可重复执行的链路，
 * 每个场景从构造一条夹带指令的工具结果开始，走完整链路，交出各环节的实际表现。
 *
 * 不调用真实模型：链路里的每个判定都是结构化的（来源标签、审批类型、写入规则），
 * 引入模型只会让验收结果随模型版本漂移，失去回归价值。
 *
 * 也正因为不依赖模型，这些用例在防线缺失时会必然失败 —— 它们检查的是
 * 「有没有这道闸门」，而不是「模型这次有没有被说服」。
 */

import { getToolApprovalType } from '@configuration/toolDefinitions'
import { wrapUntrustedContent } from '@intelligence/capabilities/message/MessageAdapter'
import { guardMemoryWrite } from '@intelligence/runtime/memoryWriteGuard'
import { classifyToolOrigin } from '@intelligence/runtime/toolOriginClassifier'
import { collectUntrustedSignal } from '@intelligence/runtime/untrustedContextTracker'
import type { ChatMessage } from '@intelligence/providerTypes'
import type { ToolOrigin } from '@intelligence/types/trustTypes'
import { shouldEscalateForUntrusted } from '../approvalEscalation'
import { INJECTION_DEFENSE_SAMPLES } from './dataset'
import type { InjectionDefenseOutcome, InjectionDefenseSample } from './types'

/** 评测用工作区：文件类工具的落点判定基准 */
export const EVAL_WORKSPACE = '/workspace/demo'

/** 构造一条带来源标签的工具结果消息 */
function buildToolResultMessage(toolName: string, payload: string, origin: ToolOrigin): ChatMessage {
  return {
    id: `injection-${toolName}`,
    role: 'tool',
    toolCallId: `call-${toolName}`,
    name: toolName,
    content: payload,
    timestamp: 0,
    type: 'text' as never,
    origin,
  } as ChatMessage
}

/** 执行单个注入场景 */
export function runInjectionScenario(sample: InjectionDefenseSample): InjectionDefenseOutcome {
  const origin = classifyToolOrigin(
    sample.tool,
    sample.params,
    sample.workspacePath ?? EVAL_WORKSPACE,
  )
  const signal = collectUntrustedSignal([
    buildToolResultMessage(sample.tool, sample.payload, origin),
  ])

  const contextText = wrapUntrustedContent(sample.payload, origin)
  const approvalType = getToolApprovalType(sample.targetTool)
  const requiresConfirmation = shouldEscalateForUntrusted(sample.targetTool, approvalType, signal)

  const memoryDecision = guardMemoryWrite(
    {
      content: sample.memoryContent ?? sample.payload,
      source: sample.memorySource ?? 'auto_extracted',
      originTrust: origin.trust,
      originChannel: origin.channel,
      originLocator: origin.locator,
    },
    origin,
  )

  return {
    sample,
    origin,
    signalPresent: signal.present,
    contextText,
    approvalType,
    requiresConfirmation,
    memoryDisposition: memoryDecision.disposition,
    memoryReason: memoryDecision.reason,
  }
}

/** 执行全部注入场景 */
export function runInjectionDefense(): InjectionDefenseOutcome[] {
  return INJECTION_DEFENSE_SAMPLES.map(runInjectionScenario)
}
