/**
 * 审批门禁判定
 *
 * 一处集中定义「哪些操作要用户确认」，三种授权方式对应三套规则：
 *
 * - every-step（手动审批）：删除文件、危险命令、外部内容（工作区与授权目录之外的路径）
 *   在执行前拦下等用户放行；创建与修改文件不走这一步 —— 改动落到审批条上，由用户
 *   在输入框上方决定保留还是撤销，AI 不因逐次确认中断（见 ApprovalGate 的 review）。
 *   只创建目录也不在此列 —— 它不产生文件内容变更，逐次确认只有打扰没有收益
 *   （见 isDirectoryCreation）
 * - dangerous-only（自动审批）：危险操作与危险命令需要确认，其余免确认
 * - never（完全访问）：全部免确认（主进程安全底线仍独立生效）
 *
 * 另外单独处理一种情形：外部内容（网页抓取、外部服务、渠道消息、外部智能体产出）
 * 进入上下文后，模型可能被其中的表述带出高权限动作。这类升级只在手动审批模式下
 * 叠加 —— 自动审批模式已经由用户显式选择「只问危险操作」，再叠加等于架空这次选择。
 *
 * 升级只覆盖高权限操作：写文件、执行命令、删除、对外发送。
 * 读取与交互类不升级 —— 把每一次读取都拦下来只会让确认变成噪音，
 * 反而降低用户对确认的敏感度，那些真正危险的确认也就不再被当回事。
 *
 * 与上述可调项不同，删除文件一类不可逆操作是硬约束：手动审批与自动审批下都必须
 * 过确认，且不依赖 category / approvalType 的间接推导（见 isIrreversibleTool）。
 * 判定放在三种授权方式分支之前，回退路径（旧配置的自由模式、自动批准危险操作）
 * 同样受它约束 —— 用户选自动审批是为了省掉日常确认，不是为了放弃不可逆操作的
 * 决策权。
 */

import { getToolApprovalType, isWriteTool } from '@configuration/toolDefinitions'
import { PATH_ARG_KEYS, isDirectoryTargetPath } from '@shared/toolkit/pathHelper'
import type { AuthorizationMode } from '@shared/configuration/configTypes'
import type { UntrustedContextSignal } from '@intelligence/types/trustTypes'
import { accessesOutsideScope } from '@intelligence/runtime/toolOriginClassifier'
import { needsCommandApproval } from './commandRisk'

/** 这些审批类型本身就代表有副作用且不可逆的操作 */
const HIGH_IMPACT_APPROVAL_TYPES = new Set(['terminal', 'dangerous'])

/** 对外发送类工具：不在写入类目录里，但同样会把内容送出去 */
const EGRESS_TOOLS = new Set(['send_file_to_channel'])

/**
 * 不可逆操作：删除文件或目录
 *
 * 这些操作没有撤销通道（回收站不在链路上），误删之后只能靠用户自己的备份，
 * 因此不参与「减少打扰」的任何权衡。
 */
const IRREVERSIBLE_TOOLS = new Set(['delete_file_or_folder'])

/**
 * 删除文件 / 目录语义的工具名模式
 *
 * MCP 与场景工具不在 TOOL_CONFIGS 中注册，getToolApprovalType 对它们返回 'none'，
 * 于是「删除文件」这类操作能一路穿过审批门禁 —— 而这正是最不该被放过的一类。
 * 此处按名字里的删除动词识别，动词后可以带文件系统对象词（delete_file、remove_folder），
 * 也可以单独出现（unlink、rmdir）。覆盖 mcp_filesystem__delete_file、
 * mcp_*__delete_directory、*_remove_file 等写法。
 *
 * 刻意只收窄到文件系统级删除：删除动词后跟的是别的对象时（delete_worksheet、
 * delete_paragraph、delete_entities）不命中 —— 它们是常规数据或内容编辑动作，
 * 纳入只会让确认变成噪音。
 */
const IRREVERSIBLE_TOOL_PATTERN =
  /(?:^|[_-])(?:delete|remove|unlink|rmdir)(?:(?:[_-]?(?:file|files|folder|folders|dir|dirs|directory|directories|path|paths))|$)/i

/**
 * 判断工具是否为不可逆操作
 *
 * MCP 工具名形如 mcp_<serverId>__<toolName>，用 __ 之后的部分做语义匹配，
 * 避免 serverId 里的词（如 mcp-remove-files）本身参与判定。
 */
export function isIrreversibleTool(toolName: string): boolean {
  if (!toolName) return false
  if (IRREVERSIBLE_TOOLS.has(toolName)) return true

  const separatorIndex = toolName.lastIndexOf('__')
  const effectiveName = separatorIndex >= 0 ? toolName.slice(separatorIndex + 2) : toolName
  return IRREVERSIBLE_TOOL_PATTERN.test(effectiveName)
}

/** 判断单个工具是否属高权限操作 */
export function isHighImpactTool(toolName: string, approvalType: string): boolean {
  if (isWriteTool(toolName)) return true
  if (HIGH_IMPACT_APPROVAL_TYPES.has(approvalType)) return true
  if (EGRESS_TOOLS.has(toolName)) return true
  return false
}

/** 从工具参数中取单值路径，键名顺序与执行层的参数归一化同源 */
function resolveToolTargetPath(args?: Record<string, unknown>): string {
  if (!args) return ''
  for (const key of PATH_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

/**
 * 判断这次调用是否只创建目录
 *
 * 建目录只在文件系统里落一个空目录，不产生任何文件内容变更：手动审批下逐次确认它
 * 只有打扰没有收益（用户在文件管理器里新建文件夹也不会问自己一次）。判定与执行层
 * 同源（isDirectoryTargetPath），避免「执行按目录处理、审批按写文件拦截」的错位。
 */
export function isDirectoryCreation(toolName: string, args?: Record<string, unknown>): boolean {
  if (toolName !== 'create_file_or_folder') return false
  return isDirectoryTargetPath(resolveToolTargetPath(args), args?.content)
}

/**
 * 判断是否因外部内容而需要升级确认
 *
 * 只在操作本来就会免确认执行时才有意义：升级的作用是把「静默执行」抬到「问一次」，
 * 而不是给已经要确认的操作再加一道。授权方式若已给出确认（或已明确免确认），
 * 调用方不应再走这里 —— 见 requiresApprovalGate 的组合顺序。
 *
 * @param toolName          工具名
 * @param approvalType      工具审批类型（来自 TOOL_CONFIGS）
 * @param untrustedContext  本轮上下文的不可信内容信号
 * @param authorizationMode 用户选择的授权方式；完全访问是对「不需要确认」的显式选择，
 *                          不能再叠加升级，否则等于架空这次选择
 */
export function shouldEscalateForUntrusted(
  toolName: string,
  approvalType: string,
  untrustedContext?: UntrustedContextSignal,
  authorizationMode?: AuthorizationMode,
): boolean {
  if (authorizationMode === 'never') return false
  if (!untrustedContext?.present) return false
  return isHighImpactTool(toolName, approvalType)
}

/**
 * 该调用是否是一条危险命令
 *
 * 判定与主进程命令沙箱同源（commandRisk）：命中危险模式的命令本就会被硬拦截，
 * 弹确认是为了让用户看见并有机会拒绝；命中灰区规则的命令会被正常执行，
 * 所以更需要在执行前问一次。
 *
 * 普通命令（ls、npm test 之类）不问 —— 每次都问会让确认失去意义。
 */
export function isRiskyCommand(
  toolName: string,
  args?: Record<string, unknown>,
): boolean {
  if (toolName !== 'run_command') return false
  const command = args?.command
  return typeof command === 'string' && needsCommandApproval(command)
}

/** 判定所需的上下文 */
export interface ApprovalModeContext {
  /** 当前工作区路径，用于识别「外部内容」（工作区与授权目录之外的路径） */
  workspacePath?: string | null
  /**
   * 用户授权在工作区外访问的目录
   *
   * 来自「设置 → 安全设置」的允许目录与项目执行窗口的项目目录。
   * 这些位置属于用户已明确授权访问的范围，不算「外部内容」。
   */
  authorizedRoots?: readonly string[]
  /** 是否跳过工作区边界（用户关闭严格工作区模式时，区外访问已在设置层授权） */
  allowOutsideWorkspace?: boolean
  /** 本轮上下文的不可信来源信号 */
  untrustedContext?: UntrustedContextSignal
}

/**
 * 审批门禁的三种结论
 *
 * - none：直接执行，无需用户介入
 * - block：执行前必须等用户放行（不可逆操作、危险命令、外部内容驱动的写入）
 * - review：直接执行；改动登记为待确认变更，由输入框上方的变更条决定保留还是撤销。
 *   写入文件属这一类：文件改动有快照可回滚，代价是「先落盘、后裁决」——
 *   换取的是 AI 不被逐次确认打断，用户也不必在每一步先做决定再看结果
 */
export type ApprovalGate = 'none' | 'block' | 'review'

/**
 * 按授权方式判定单个工具调用的放行方式
 *
 * 只处理授权方式已设置的情形；未设置（旧版本升级上来的用户）时由调用方
 * 走各自的历史回退逻辑，避免把两套语义混在一起。
 *
 * @param toolName          工具名
 * @param args              工具调用参数
 * @param authorizationMode 授权方式
 * @param context           工作区路径与本轮不可信来源信号
 */
function evaluateApprovalGate(
  toolName: string,
  args: Record<string, unknown> | undefined,
  authorizationMode: AuthorizationMode,
  context?: ApprovalModeContext,
): ApprovalGate {
  // 完全访问：对「不需要确认」的显式选择，任何操作都不再打扰
  if (authorizationMode === 'never') return 'none'

  // 删除文件一类不可逆操作：手动审批与自动审批下都必须事前确认。
  // 前置在这里而不是依赖下面的 category / approvalType 推导，是因为 MCP 与场景工具
  // 没有审批类型注册（getToolApprovalType 返回 'none'），只靠推导会让「删除文件」
  // 在自动审批模式下静默通过。
  if (isIrreversibleTool(toolName)) return 'block'

  const approvalType = getToolApprovalType(toolName)

  if (authorizationMode === 'every-step') {
    // 破坏性工具（如删除文件）
    if (approvalType === 'dangerous') return 'block'
    // 危险命令
    if (isRiskyCommand(toolName, args)) return 'block'
    // 外部内容：工作区与授权目录之外的路径。
    // 用户关闭严格工作区模式时区外访问已在设置层授权，不再重复确认
    if (!context?.allowOutsideWorkspace &&
      accessesOutsideScope(toolName, args, context?.workspacePath, context?.authorizedRoots)) {
      return 'block'
    }
    // 只创建目录：不产生文件内容变更，免确认（区外落点已在上面拦下）
    if (isDirectoryCreation(toolName, args)) return 'none'
    // 创建 / 修改文件：直接执行，改动交给输入框上方的变更条裁决
    if (isWriteTool(toolName)) {
      // 例外：本轮消费过外部内容时仍要事前确认。这种写入的内容可能来自被投喂的
      // 外部文本，落盘后再让用户「撤销」等于让他先接受既成事实，
      // 与切断「外部内容 → 高权限动作」收益链的目的相悖。
      if (context?.untrustedContext?.present) return 'block'
      return 'review'
    }
    // 本轮消费过外部内容时，高权限操作再要一次确认，切断「外部内容 → 高权限动作」的收益链
    return shouldEscalateForUntrusted(
      toolName,
      approvalType,
      context?.untrustedContext,
      authorizationMode,
    )
      ? 'block'
      : 'none'
  }

  if (authorizationMode === 'dangerous-only') {
    if (approvalType === 'dangerous') return 'block'
    return isRiskyCommand(toolName, args) ? 'block' : 'none'
  }

  // 未知模式兜底：需确认（更安全）
  return 'block'
}

/**
 * 放行方式判定（三态），供能区分「事前阻塞」与「事后复核」的调用方使用
 */
export function decideApprovalGateByMode(
  toolName: string,
  args: Record<string, unknown> | undefined,
  authorizationMode: AuthorizationMode,
  context?: ApprovalModeContext,
): ApprovalGate {
  return evaluateApprovalGate(toolName, args, authorizationMode, context)
}

/**
 * 是否需要用户确认（二值），供没有事后复核入口的调用方使用
 *
 * 语音助手、子 Agent 等链路只拿到「执行 / 不执行」两种结论，它们把 review 视为
 * 需要确认：这些入口没有变更条，直接放行等于让文件改动静默落盘。
 */
export function decideApprovalByMode(
  toolName: string,
  args: Record<string, unknown> | undefined,
  authorizationMode: AuthorizationMode,
  context?: ApprovalModeContext,
): boolean {
  return evaluateApprovalGate(toolName, args, authorizationMode, context) !== 'none'
}
