/**
 * 工具执行模块
 * 
 * 职责：
 * - 工具审批流程
 * - 智能并行执行
 * - 文件快照保存（用于撤销）
 * - 工具结果截断（防止单轮对话过长）
 * - 发布事件到 EventBus
 */

import pLimit from 'p-limit'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { toolManager } from '../toolkit/providers'
import { notifyWorkspaceTreeChange } from '../toolkit/workspaceTreeNotifier'
import { getToolApprovalType, isFileEditTool, isWriteTool, needsFileSnapshot } from '@configuration/toolDefinitions'
import { pathStartsWith, joinPath, normalizePath } from '@shared/toolkit/pathHelper'
import { buildToolPathPolicy } from '../toolkit/toolPathPolicy'
import { getTrustedAppDataRoots } from '../toolkit/trustedPathRegistry'
import { buildApprovalEntry, recordApproval } from '@intelligence/decision/approvalLedger'
import { recordApproval as recordSessionApproval } from '@intelligence/decision/eval/sessionTrajectory'
import { decideApprovalGateByMode, isIrreversibleTool, shouldEscalateForUntrusted } from '@intelligence/decision/approvalEscalation'
import type { ApprovalGate } from '@intelligence/decision/approvalEscalation'
import { collectUntrustedSignal, rememberUntrustedSignal } from '../runtime/untrustedContextTracker'
import type { UntrustedContextSignal, UntrustedSourceSummary } from '@intelligence/types/trustTypes'
import { dispatchCompanionState } from '@/renderer/components/vrm-companion/companionStateDispatcher'
import { useStore } from '@store'
import { EventBus } from './EventDispatcher'
import { truncateToolResult } from '@utils/partialJson'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { agentHarness } from '../harness'
import type { Span } from '../harness/observability/Trace'
import type { ToolCall } from '@intelligence/providerTypes'
import type { ToolExecutionContext, AgentToolExecutionResult } from '@intelligence/providerTypes'
import { useAgentStore } from '../state/IntelligenceStore'
import { buildExecutionBatches } from './executionPlanner'
import { streamingEditService } from '../runtime/streamingEditor'
import { resolveStreamingEditFilePath } from '../runtime/editPreviewStreamer'
import * as perfTrace from '@intelligence/diagnostics/perfTraceReporter'
import { PERF_TRACE_COUNTERS } from '@shared/protocols/perfTraceProtocol'

// ===== 审批服务 =====

class ToolApprovalCoordinator {
  private pendingResolves = new Map<string, (approved: boolean) => void>()
  private queue: Array<{ id: string; resolve: (approved: boolean) => void }> = []

  async waitForApproval(requestId?: string): Promise<boolean> {
    const id = requestId || crypto.randomUUID()
    return new Promise((resolve) => {
      this.pendingResolves.set(id, resolve)
      this.queue.push({ id, resolve })
    })
  }

  approve(requestId?: string): void {
    if (requestId) {
      const resolve = this.pendingResolves.get(requestId)
      logger.agent.info(`[ApprovalService] approve(${requestId}): found=${!!resolve}, queueSize=${this.queue.length}, pendingIds=[${Array.from(this.pendingResolves.keys()).join(',')}]`)
      if (resolve) {
        resolve(true)
        this.pendingResolves.delete(requestId)
        this.queue = this.queue.filter(item => item.id !== requestId)
      } else {
        // 精确匹配失败，尝试前缀匹配（处理 requestId 可能不完整的情况）
        const matchedKey = Array.from(this.pendingResolves.keys()).find(key => key.startsWith(requestId) || requestId.startsWith(key))
        if (matchedKey) {
          logger.agent.info(`[ApprovalService] approve: prefix matched ${requestId} -> ${matchedKey}`)
          this.pendingResolves.get(matchedKey)?.(true)
          this.pendingResolves.delete(matchedKey)
          this.queue = this.queue.filter(item => item.id !== matchedKey)
        } else if (this.queue.length > 0) {
          // 前缀匹配也失败，处理队列中的第一个
          const first = this.queue.shift()!
          logger.agent.info(`[ApprovalService] approve: no match for ${requestId}, resolving first in queue: ${first.id}`)
          this.pendingResolves.get(first.id)?.(true)
          this.pendingResolves.delete(first.id)
        } else {
          logger.agent.warn(`[ApprovalService] approve(${requestId}): no match found and queue is empty`)
        }
      }
    } else if (this.queue.length > 0) {
      const first = this.queue.shift()!
      logger.agent.info(`[ApprovalService] approve() (no id): resolving first in queue: ${first.id}`)
      this.pendingResolves.get(first.id)?.(true)
      this.pendingResolves.delete(first.id)
    } else {
      logger.agent.warn('[ApprovalService] approve() called but no pending requests')
    }
  }

  reject(requestId?: string): void {
    if (requestId) {
      const resolve = this.pendingResolves.get(requestId)
      logger.agent.info(`[ApprovalService] reject(${requestId}): found=${!!resolve}, queueSize=${this.queue.length}, pendingIds=[${Array.from(this.pendingResolves.keys()).join(',')}]`)
      if (resolve) {
        resolve(false)
        this.pendingResolves.delete(requestId)
        this.queue = this.queue.filter(item => item.id !== requestId)
      } else {
        // 精确匹配失败，尝试前缀匹配
        const matchedKey = Array.from(this.pendingResolves.keys()).find(key => key.startsWith(requestId) || requestId.startsWith(key))
        if (matchedKey) {
          logger.agent.info(`[ApprovalService] reject: prefix matched ${requestId} -> ${matchedKey}`)
          this.pendingResolves.get(matchedKey)?.(false)
          this.pendingResolves.delete(matchedKey)
          this.queue = this.queue.filter(item => item.id !== matchedKey)
        } else {
          // 精确与前缀匹配都失败：说明该 requestId 已过期，或不属于当前待批项。
          // 此前会兜底拒绝队列里的第一项，等于用一个无关请求把另一个待批工具一起否掉，
          // 用户看到的是「没点拒绝却有一个工具被拒」。这里只记录，不做任何裁决。
          logger.agent.warn(`[ApprovalService] reject(${requestId}): no matching pending request, ignored`)
        }
      }
    } else if (this.queue.length > 0) {
      const first = this.queue.shift()!
      logger.agent.info(`[ApprovalService] reject() (no id): resolving first in queue: ${first.id}`)
      this.pendingResolves.get(first.id)?.(false)
      this.pendingResolves.delete(first.id)
    } else {
      logger.agent.warn('[ApprovalService] reject() called but no pending requests')
    }
  }

  approveAll(): void {
    for (const item of this.queue) {
      this.pendingResolves.get(item.id)?.(true)
      this.pendingResolves.delete(item.id)
    }
    this.queue = []
  }

  rejectAll(): void {
    for (const item of this.queue) {
      this.pendingResolves.get(item.id)?.(false)
      this.pendingResolves.delete(item.id)
    }
    this.queue = []
  }

  async waitForBatchApproval(
    toolCallIds: string[],
    requestId?: string
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()
    const promises = toolCallIds.map(tcId =>
      this.waitForApproval(`${requestId}_${tcId}`).then(approved => {
        results.set(tcId, approved)
      })
    )
    await Promise.all(promises)
    return results
  }

  get pendingCount(): number {
    return this.queue.length
  }
}

export const approvalService = new ToolApprovalCoordinator()

// ===== 文件快照 =====

/** 单个文件快照的体积上限（字符）：超过则跳过撤销点，避免快照把内存顶满 */
const MAX_SNAPSHOT_FILE_CHARS = 2_000_000

/**
 * 在工具执行前保存文件快照到检查点
 * 用于支持撤销功能
 */
async function captureFileSnapshots(
  toolCalls: ToolCall[],
  context: ToolExecutionContext
): Promise<void> {
  // Checkpoint 操作是全局的，不需要 threadStore
  const store = useAgentStore.getState()
  const { workspacePath } = context

  // 找出所有需要保存快照的工具（包括删除操作）
  const snapshotTools = toolCalls.filter(tc => needsFileSnapshot(tc.name))
  if (snapshotTools.length === 0) return

  // 并行读取所有文件的当前内容
  const snapshotPromises = snapshotTools.map(async (tc) => {
    const path = tc.arguments?.path as string
    if (!path) return null

    const fullPath = workspacePath && !pathStartsWith(path, workspacePath)
      ? joinPath(workspacePath, path)
      : path

    try {
      const content = await api.file.read(fullPath)
      // 超大文件不建撤销点：快照会常驻检查点，大文件反复编辑会把内存顶满。
      // 返回 null 即跳过该文件（由上层 if (snapshot) 过滤），
      // 不能记成 content:null——那会被当成「新建文件」，撤销时误删原文件。
      if (typeof content === 'string' && content.length > MAX_SNAPSHOT_FILE_CHARS) {
        logger.agent.warn(`[Tools] Skip undo snapshot for large file (${content.length} chars): ${fullPath}`)
        return null
      }
      return { filePath: fullPath, content }
    } catch {
      // 文件不存在，content 为 null（新建文件）
      return { filePath: fullPath, content: null }
    }
  })

  const snapshots = await Promise.all(snapshotPromises)

  // 保存到检查点
  for (const snapshot of snapshots) {
    if (snapshot) {
      if (context.checkpointId) {
        store.addSnapshotToCheckpoint(context.checkpointId, snapshot.filePath, snapshot.content)
      }
    }
  }
}

interface ToolInvocationIdentity {
  threadId?: string
  assistantId?: string
  requestId?: string
  toolCallId?: string
}

function composeToolInvocationIdentity(
  toolCall: ToolCall,
  context: ToolExecutionContext
): ToolInvocationIdentity {
  return {
    threadId: context.threadId ?? undefined,
    assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    requestId: context.requestId,
    toolCallId: context.toolCallId ?? toolCall.id,
  }
}

function publishToolLifecycleEvent(
  event:
    | ({ type: 'tool:pending'; id: string; name: string; args: Record<string, unknown> } & ToolInvocationIdentity)
    | ({ type: 'tool:running'; id: string } & ToolInvocationIdentity)
    | ({ type: 'tool:completed'; id: string; result: string; meta?: Record<string, unknown> } & ToolInvocationIdentity)
    | ({ type: 'tool:error'; id: string; error: string } & ToolInvocationIdentity)
    | ({ type: 'tool:rejected'; id: string } & ToolInvocationIdentity)
): void {
  EventBus.emit(event)
}

function buildDependencyFailureResult(
  toolCall: ToolCall,
  reason: string
): AgentToolExecutionResult {
  return {
    toolCall,
    result: {
      content: reason,
      meta: {
        outcome: 'dependency_failed',
        skippedDueToDependency: true,
      },
    },
  }
}

function indicatesDependencyFailure(content: string): boolean {
  return content.startsWith('Skipped: dependency') || content.startsWith('Error: dependency')
}


/**
 * 媒体文件扩展名正则（图片 + 视频）
 *
 * 用于从 generate_image / generate_video 工具结果中提取本地文件路径。
 * 图片：png/jpg/jpeg/webp/gif/bmp
 * 视频：mp4/webm/mov/mkv/avi/m4v
 */
const MEDIA_EXT_PATTERN = 'png|jpg|jpeg|webp|gif|bmp|mp4|webm|mov|mkv|avi|m4v'

/**
 * 从 generate_image / generate_video 工具结果中提取媒体文件本地路径
 *
 * MCP 工具返回的 content 经 convertMcpContent 处理后是多行文本拼接：
 *   行1: {"success":true,"output_path":"/abs/path/to/video.mp4","path":"...","meta":{...}}
 *   行2: ✅ Video generated by <provider> in <ms>ms: /abs/path/to/video.mp4
 *
 * 提取策略（按优先级）：
 * 1. 逐行尝试 JSON.parse，命中后取 output_path / path 字段
 * 2. 整体 JSON.parse（兼容单行 JSON 场景）
 * 3. 正则兜底：匹配绝对路径风格的媒体路径（以 / 开头，避免误匹配 JSON key）
 */
function extractMediaPathFromResult(content: string): string | null {
  if (!content || typeof content !== 'string') return null

  const mediaExtRegex = new RegExp(`\\.(${MEDIA_EXT_PATTERN})$`, 'i')

  // 策略1：逐行尝试 JSON.parse（MCP 多行 content 场景）
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        const p = parsed.output_path || parsed.path || parsed.localPath || parsed.file_path
        if (typeof p === 'string' && mediaExtRegex.test(p)) {
          return p
        }
      }
    } catch {
      // 该行非 JSON，继续尝试下一行
    }
  }

  // 策略2：整体 JSON.parse（兼容单行 JSON 场景）
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') {
      const p = parsed.output_path || parsed.path || parsed.localPath || parsed.file_path
      if (typeof p === 'string' && mediaExtRegex.test(p)) {
        return p
      }
    }
  } catch {
    // 非纯 JSON，继续正则兜底
  }

  // 策略3：正则兜底 — 匹配绝对路径风格的媒体路径
  // 优先匹配以 / 或盘符开头的路径（避免误匹配 JSON 中的 key 名）
  const absRegex = new RegExp(`(?:^|[\\s'"(])(/[^\\s"'<>]+\\.(?:${MEDIA_EXT_PATTERN}))`, 'i')
  const absMatch = content.match(absRegex)
  if (absMatch) return absMatch[1]

  // Windows 盘符路径兜底（如 C:\path\to\video.mp4）
  const winRegex = new RegExp(`(?:^|[\\s'"(])([A-Za-z]:\\\\[^\\s"'<>]+\\.(?:${MEDIA_EXT_PATTERN}))`, 'i')
  const winMatch = content.match(winRegex)
  if (winMatch) return winMatch[1]

  // 最终兜底：匹配任意媒体路径（可能包含引号，需清理）
  const anyRegex = new RegExp(`([^\\s"'<>]+\\.(?:${MEDIA_EXT_PATTERN}))`, 'i')
  const anyMatch = content.match(anyRegex)
  if (anyMatch) return anyMatch[1]

  return null
}

/**
 * 文档类产出扩展名
 *
 * MCP 文档工具（Word / Excel / PPT / PDF 生成等）在自己的进程里写文件，
 * 不经过内置写入通道，需要按扩展名从工具参数与结果文本里还原产出路径。
 */
const DOCUMENT_EXT_PATTERN = 'docx|doc|xlsx|xls|pptx|ppt|pdf|rtf|odt|ods|odp|csv|md|txt|html|zip'

/** MCP 工具参数中可能承载产出文件路径的字段名 */
const PRODUCED_PATH_ARG_KEYS = [
  'filename', 'file_path', 'filepath', 'output_path', 'output_file',
  'document_path', 'output_filename', 'target_path', 'path',
]

/** 是否为 MCP 工具（命名格式 mcp_<serverId>__<toolName>） */
function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp_')
}

/** 把候选路径展开成可校验的绝对路径（相对路径按工作区解析） */
function expandPathCandidates(candidate: string, workspacePath: string | null): string[] {
  const isAbsolute = candidate.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(candidate)
    || candidate.startsWith('\\\\')
  if (isAbsolute) return [candidate]
  return workspacePath ? [joinPath(workspacePath, candidate)] : []
}

/**
 * 解析 MCP 工具落盘的产出文件
 *
 * MCP 工具在独立进程里写文件，既不会发 file:written，也不会触发工作区刷新，
 * 表现为「AI 生成的文件不出现在文件树和产物栏」。这里按两类线索还原产出路径：
 *   1. 工具参数中显式给出的文件名 / 输出路径（MCP 文档工具的主要线索）
 *   2. 结果文本中的绝对路径（Unix 或 Windows 盘符风格）
 * 只认可磁盘上真实存在的文件，避免把普通字符串参数误判为产物。
 */
async function resolveProducedFilePath(
  content: string,
  args: Record<string, unknown> | undefined,
  workspacePath: string | null,
): Promise<string | null> {
  const docExtRegex = new RegExp(`\\.(${DOCUMENT_EXT_PATTERN})$`, 'i')
  const candidates: string[] = []

  const collectFromObject = (source: Record<string, unknown>) => {
    for (const key of PRODUCED_PATH_ARG_KEYS) {
      const value = source[key]
      if (typeof value === 'string' && docExtRegex.test(value.trim())) {
        candidates.push(value.trim())
      }
    }
  }

  if (args) collectFromObject(args)

  // MCP 结果常是 JSON 文本（可能多行拼接），逐行与整体各解析一次
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') collectFromObject(parsed as Record<string, unknown>)
    } catch {
      // 该行不是完整 JSON，交给下面的正则兜底
    }
  }
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') collectFromObject(parsed as Record<string, unknown>)
  } catch {
    // 整体不是 JSON
  }

  // 结果文本兜底：匹配绝对路径风格的文档路径
  const absPathRegex = new RegExp(
    `(?:^|[\\s'"(\`])((?:/|[A-Za-z]:[\\\\/])[^\\s"'\`<>]+\\.(?:${DOCUMENT_EXT_PATTERN}))`,
    'gi',
  )
  for (const match of content.matchAll(absPathRegex)) {
    if (match[1]) candidates.push(match[1])
  }

  for (const candidate of candidates) {
    for (const resolved of expandPathCandidates(candidate, workspacePath)) {
      try {
        if (await api.file.exists(resolved)) return resolved
      } catch {
        // 路径非法或不可访问，继续尝试下一个候选
      }
    }
  }

  return null
}

/**
 * 审批判定所需的最小工具信息（结构化类型，兼容 ToolCall / CollectedToolCall 等）
 */
export interface ApprovalGateToolInfo {
  name: string
  arguments?: Record<string, unknown>
}

/**
 * 放行方式判定（三态）
 *
 * 基于 TOOL_CONFIGS 中的 approvalType 配置和用户的 autoApprove / authorizationMode 设置
 *
 * 优先级：authorizationMode > freeModeEnabled > autoApprove
 * - authorizationMode 有值时由 approvalEscalation.decideApprovalGateByMode 统一判定
 *   （手动审批 / 自动审批 / 完全访问三套规则集中在那里，避免各入口各写一份）
 * - authorizationMode 为 undefined（旧版本未设置）时回退到 autoApprove/freeModeEnabled 逻辑
 *
 * 三态的意义：'block' 是执行前必须等用户放行，'review' 是直接执行、改动事后由变更条裁决。
 * 只有能提供事后复核入口的链路（主会话的输入框上方变更条）才应区分两者；
 * 其余调用方用 requiresApprovalGate 收敛成二值即可。
 *
 * 例外：删除文件一类不可逆操作在两条链路上都强制确认（完全访问除外）。
 * 「自动审批」「自由模式」「自动批准危险操作」选择的都是少问日常操作，
 * 不包含让不可逆操作静默执行的授权。
 *
 * @param workspacePath 当前工作区路径；手动审批模式下用于判定「外部内容」
 */
export function resolveApprovalGate(
  toolCall: ApprovalGateToolInfo,
  chatMode?: string,
  untrustedContext?: UntrustedContextSignal,
  workspacePath?: string | null,
): ApprovalGate {
  // chat 模式（纯对话无工具副作用）始终不拦截，与授权方式正交
  if (chatMode === 'chat') return 'none'

  const toolName = toolCall.name
  const approvalType = getToolApprovalType(toolName)

  const mainStore = useStore.getState()
  const authMode = mainStore.authorizationMode

  // 授权方式已设置：交给统一判定
  if (authMode !== undefined) {
    // 「外部内容」以用户的实际授权范围为准：工作区 + 安全设置里的允许目录
    // + 项目执行窗口的项目目录 + 可信应用数据目录
    const policy = buildToolPathPolicy({
      allowedToolPaths: mainStore.allowedToolPaths,
      securitySettings: mainStore.securitySettings,
      trustedAppDataRoots: getTrustedAppDataRoots(),
    })
    return decideApprovalGateByMode(toolName, toolCall.arguments, authMode, {
      workspacePath,
      authorizedRoots: policy.extraAllowedRoots,
      allowOutsideWorkspace: policy.allowOutsideWorkspace,
      untrustedContext,
    })
  }

  // ===== 兼容性回退：authorizationMode 未设置（旧版本升级），使用原有 autoApprove/freeModeEnabled 逻辑 =====
  // 不可逆操作不参与这段回退：自由模式与「自动批准危险操作」表达的是少问日常操作，
  // 不包括让删除文件静默执行。判定与主链路同源（isIrreversibleTool）
  if (isIrreversibleTool(toolName)) return 'block'

  let requiresBySetting: boolean
  if (approvalType === 'none') requiresBySetting = false
  // 自由模式：自动批准所有工具调用，无需用户确认
  else if (mainStore.freeModeEnabled) requiresBySetting = false
  else if (approvalType === 'terminal' && mainStore.autoApprove?.terminal) requiresBySetting = false
  else if (approvalType === 'dangerous' && mainStore.autoApprove?.dangerous) requiresBySetting = false
  else requiresBySetting = true

  if (requiresBySetting) return 'block'

  // 免确认的操作若本轮消费过外部内容，再要一次确认 —— 切断「外部内容 → 高权限动作」的收益链。
  // 判定口径限本轮：历史轮次的外部内容不该让此后的每一轮都多一次确认。
  //
  // 例外：创建 / 修改文件不在这一段升级里。这条回退链路的语义由 autoApprove 与自由模式
  // 决定，写文件本身就属免确认（approvalType 为 none）；而 authorizationMode 未显式设置时，
  // 界面上展示的默认授权方式正是「自动审批」。此时再叠一次确认，用户看到的是
  // 「自动审批」却要为每次写文件点确认，界面承诺与实际行为不符。
  // 命令执行、对外发送与不可逆操作仍照旧升级。
  if (isWriteTool(toolName)) return 'none'

  return shouldEscalateForUntrusted(toolName, approvalType, untrustedContext, authMode)
    ? 'block'
    : 'none'
}

/**
 * 是否需要用户确认（二值）
 *
 * 供只有「执行 / 不执行」两种结论的链路使用（子 Agent、语音助手、渠道消息等）：
 * 它们没有事后复核入口，把 'review' 一并视为需要确认 —— 直接放行等于让文件改动
 * 静默落盘。
 */
export function requiresApprovalGate(
  toolCall: ApprovalGateToolInfo,
  chatMode?: string,
  untrustedContext?: UntrustedContextSignal,
  workspacePath?: string | null,
): boolean {
  return resolveApprovalGate(toolCall, chatMode, untrustedContext, workspacePath) !== 'none'
}

interface ApprovalCohort {
  key: string
  toolCalls: ToolCall[]
}

function clusterApprovalCohorts(toolCalls: ToolCall[]): ApprovalCohort[] {
  if (toolCalls.length <= 1) {
    return [{ key: 'single', toolCalls }]
  }

  const groups = new Map<string, ToolCall[]>()

  for (const tc of toolCalls) {
    const approvalType = getToolApprovalType(tc.name)
    const groupKey = `${approvalType}:${tc.name}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, [])
    }
    groups.get(groupKey)!.push(tc)
  }

  return Array.from(groups.entries()).map(([key, toolCalls]) => ({ key, toolCalls }))
}

/**
 * 获取动态并发限制
 */
function resolveDynamicConcurrency(): number {
  const agentConfig = getAgentConfig()
  const { enabled, minConcurrency, maxConcurrency, cpuMultiplier } = agentConfig.dynamicConcurrency

  if (!enabled) {
    return 8  // 默认固定值
  }

  // 获取 CPU 核心数（浏览器环境）
  const cpuCores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4

  // 计算并发数：CPU 核心数 * 倍数
  const calculated = Math.floor(cpuCores * cpuMultiplier)

  // 限制在最小和最大值之间
  const concurrency = Math.max(minConcurrency, Math.min(maxConcurrency, calculated))

  logger.agent.info(`[Tools] Dynamic concurrency: ${concurrency} (CPU cores: ${cpuCores})`)

  return concurrency
}

/**
 * 分析工具依赖关系（支持显式声明）
 */
function resolveToolDependencyGraph(toolCalls: ToolCall[]): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>()
  const fileWriters = new Map<string, string>() // path -> toolCallId
  const agentConfig = getAgentConfig()
  const declaredDeps = agentConfig.toolDependencies || {}

  for (const tc of toolCalls) {
    deps.set(tc.id, new Set())

    // 1. 检查显式声明的依赖
    const declaredDep = declaredDeps[tc.name]
    if (declaredDep) {
      // 查找依赖的工具调用
      for (const depToolName of declaredDep.dependsOn) {
        const depToolCall = toolCalls.find(t => t.name === depToolName && t.id !== tc.id)
        if (depToolCall) {
          deps.get(tc.id)!.add(depToolCall.id)
          logger.agent.info(`[Tools] Explicit dependency: ${tc.name} depends on ${depToolName}`)
        }
      }
    }

    // 2. 隐式依赖：文件编辑依赖
    if (isFileEditTool(tc.name)) {
      const path = tc.arguments?.path as string
      if (path) {
        // 如果之前有工具写过这个文件，建立依赖
        const prevWriter = fileWriters.get(path)
        if (prevWriter) {
          deps.get(tc.id)!.add(prevWriter)
        }
        fileWriters.set(path, tc.id)
      }
    }
  }

  return deps
}

/**
 * 执行单个工具
 */
async function invokeToolInvocation(
  toolCall: ToolCall,
  context: ToolExecutionContext,
  store: import('../state/IntelligenceStore').ThreadBoundStore,
  abortSignal?: AbortSignal
): Promise<AgentToolExecutionResult> {
  const mainStore = useStore.getState()
  const { currentAssistantId, workspacePath } = context
  const identity = composeToolInvocationIdentity(toolCall, context)
  const startTime = Date.now()

  let toolSpan: Span | null = null
  if (agentHarness.isInitialized) {
    toolSpan = agentHarness.observability.startSpan(`tool.${toolCall.name}`, context.requestId, undefined, {
      toolName: toolCall.name,
      threadId: context.threadId,
    })
  }

  if (currentAssistantId) {
    store.finalizeTextBeforeToolCall(currentAssistantId)
    store.addToolCallPart(currentAssistantId, {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    })
    store.updateToolCall(currentAssistantId, toolCall.id, {
      status: 'running',
      streamingState: undefined,
      startTime: Date.now(),
    })
    store.clearToolStreamingPreview(toolCall.id)
    store.setStreamState({
      phase: 'tool_running',
      streamDetail: 'tool_executing',
      currentToolCall: toolCall,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: currentAssistantId,
    })
  }
  publishToolLifecycleEvent({ type: 'tool:running', id: toolCall.id, ...identity })

  mainStore.addToolCallLog({
    threadId: context.threadId ?? undefined,
    type: 'request',
    toolName: toolCall.name,
    data: toolCall.arguments,
  })

  const toolHandler = async (): Promise<AgentToolExecutionResult> => {
    try {
      const result = await toolManager.execute(
        toolCall.name,
        toolCall.arguments,
        {
          workspacePath: workspacePath ?? null,
          currentAssistantId: currentAssistantId ?? null,
          assistantId: currentAssistantId ?? null,
          threadId: context.threadId,
          requestId: context.requestId,
          toolCallId: toolCall.id,
          chatMode: context.chatMode,
          skipMainApproval: true,
          abortSignal,
        }
      )

      const duration = Date.now() - startTime

      // 「工具调用是否失败」独立于「业务结果是否成功」：
      // 命令/脚本已跑完但报错，属于业务失败，不算工具调用失败，
      // 界面与应用内事件都应显示「已执行」，避免把正常执行误报为失败。
      const callFailed = result.callFailed ?? !result.success

      const rawContent = callFailed
        ? `Error: ${result.error || 'Unknown error'}`
        : (result.result !== undefined && result.result !== null ? result.result : 'Success')

      const config = getAgentConfig()
      const content = truncateToolResult(rawContent, toolCall.name, config.maxToolResultChars)

      if (content.length < rawContent.length) {
        logger.agent.info(`[Tools] Truncated ${toolCall.name} result: ${rawContent.length} -> ${content.length} chars`)
      }

      mainStore.addToolCallLog({
        threadId: context.threadId ?? undefined,
        type: 'response',
        toolName: toolCall.name,
        data: content,
        duration,
        success: !callFailed,
        error: callFailed ? result.error : undefined,
      })

      const meta = result.meta || {}
      const richContent = result.richContent
      const previewPath = resolveStreamingEditFilePath(toolCall.arguments?.path, workspacePath)

      if (toolCall.name === 'edit_file' && previewPath) {
        if (result.success) {
          const finalContent = typeof meta.newContent === 'string' ? meta.newContent : undefined
          streamingEditService.completeEditByFilePath(previewPath, finalContent)
        } else {
          streamingEditService.cancelEditByFilePath(previewPath)
        }
      }

      if (currentAssistantId) {
        const updatedArguments = Object.keys(meta).length > 0
          ? { ...toolCall.arguments, _meta: meta }
          : toolCall.arguments

        const newStatus = callFailed ? 'error' : 'success'

        store.updateToolCall(currentAssistantId, toolCall.id, {
          status: newStatus,
          result: content,
          arguments: updatedArguments,
          richContent,
          streamingState: undefined,
          endTime: Date.now(),
          errorCode: callFailed ? result.outcome?.code : undefined,
        })

        // 必须带上调用参数：结果来源在写入时即固定，缺参数会让文件类工具无法判定路径落点，
        // 一律被标成不可信来源，进而把当轮所有写入类操作都拖进确认流程。
        // 同时带上本次执行的基准目录：项目执行窗口里它未必等于 store.workspacePath，
        // 判定用错基准会把落在项目目录里的文件判成「外部内容」
        store.addToolResult(
          toolCall.id,
          toolCall.name,
          content,
          callFailed ? 'tool_error' : 'success',
          toolCall.arguments,
          workspacePath,
        )
      }
      if (!callFailed) {
        publishToolLifecycleEvent({
          type: 'tool:completed',
          id: toolCall.id,
          result: content,
          meta,
          ...identity,
        })

        // generate_image / generate_video 工具成功后自动打开媒体预览（与 write_file 自动打开文件预览一致）
        // MCP 工具名格式为 mcp_<serverId>__generate_image / mcp_<serverId>__generate_video，用 endsWith 匹配
        const isImageTool = toolCall.name === 'generate_image' || toolCall.name.endsWith('__generate_image')
        const isVideoTool = toolCall.name === 'generate_video' || toolCall.name.endsWith('__generate_video')
        if (isImageTool || isVideoTool) {
          const mediaPath = extractMediaPathFromResult(content)
          if (mediaPath) {
            logger.agent.info(`[Tools] ${toolCall.name} auto-preview: path=${mediaPath}, workspace=${context.workspacePath || '(empty)'}`)
            EventBus.emit({
              type: 'file:writing',
              filePath: mediaPath,
              workspacePath: context.workspacePath || '',
            })
          } else {
            logger.agent.warn(`[Tools] ${toolCall.name} auto-preview: failed to extract media path from result (length=${content.length})`)
          }
        }

        // MCP 工具（Word / Excel 生成等）在自己的进程里写文件，不经过内置写入通道，
        // 因此既不会记录产物，也不会刷新工作区文件树。这里补上这条链路。
        if (isMcpTool(toolCall.name)) {
          const producedPath = await resolveProducedFilePath(
            content,
            toolCall.arguments as Record<string, unknown> | undefined,
            workspacePath,
          )
          if (producedPath) {
            logger.agent.info(`[Tools] ${toolCall.name} produced file: ${producedPath}`)
            const artifactStore = useStore.getState()
            const known = artifactStore.artifacts.some(
              item => normalizePath(item.path) === normalizePath(producedPath),
            )
            artifactStore.recordArtifact({
              path: producedPath,
              workspacePath: context.workspacePath || '',
              action: known ? 'edit' : 'create',
            })
            // 与内置写入保持一致：先发预览事件（是否打开受「实时预览」开关控制），再刷新文件树
            EventBus.emit({
              type: 'file:writing',
              filePath: producedPath,
              workspacePath: context.workspacePath || '',
            })
            notifyWorkspaceTreeChange({
              workspacePath: context.workspacePath || '',
              targetPath: producedPath,
              changeType: known ? 'modify' : 'create',
            })
          }
        }
      } else {
        publishToolLifecycleEvent({
          type: 'tool:error',
          id: toolCall.id,
          error: content,
          ...identity,
        })
      }

      if (toolSpan) {
        agentHarness.observability.endSpan(toolSpan, callFailed ? 'error' : 'ok')
      }

      return { toolCall, result: { content, meta, richContent, callFailed } }
    } catch (error) {
      if (toolSpan) {
        agentHarness.observability.endSpan(toolSpan, 'error')
        toolSpan = null
      }
      const duration = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.agent.error(`[Tools] Error in ${toolCall.name}:`, errorMsg)

      mainStore.addToolCallLog({
        threadId: context.threadId ?? undefined,
        type: 'response',
        toolName: toolCall.name,
        data: errorMsg,
        duration,
        success: false,
        error: errorMsg,
      })

      const previewPath = resolveStreamingEditFilePath(toolCall.arguments?.path, workspacePath)
      if (toolCall.name === 'edit_file' && previewPath) {
        streamingEditService.cancelEditByFilePath(previewPath)
      }

      if (currentAssistantId) {
        store.updateToolCall(currentAssistantId, toolCall.id, {
          status: 'error',
          result: errorMsg,
          streamingState: undefined,
          endTime: Date.now(),
          errorCode: 'EXECUTION_ERROR',
        })
        store.addToolResult(
          toolCall.id,
          toolCall.name,
          `Error: ${errorMsg}`,
          'tool_error',
          toolCall.arguments,
          workspacePath,
        )
      }
      publishToolLifecycleEvent({ type: 'tool:error', id: toolCall.id, error: errorMsg, ...identity })

      return { toolCall, result: { content: `Error: ${errorMsg}`, callFailed: true } }
    }
  }

  if (agentHarness.isInitialized) {
    let pipelineResult: AgentToolExecutionResult | null = null
    try {
      await agentHarness.toolPipeline.execute(
        { toolName: toolCall.name, args: toolCall.arguments, context },
        async () => {
          pipelineResult = await toolHandler()
          return {
            success: !(pipelineResult.result.callFailed ?? pipelineResult.result.content.startsWith('Error:')),
            result: pipelineResult.result.content,
            meta: pipelineResult.result.meta,
          }
        },
        { toolName: toolCall.name, threadId: context.threadId, requestId: context.requestId }
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'RateLimitError') {
        logger.agent.warn(`[Tools] Rate limited: ${toolCall.name}`)
        if (currentAssistantId) {
          store.updateToolCall(currentAssistantId, toolCall.id, {
            status: 'error',
            result: `Rate limited: ${error.message}`,
            streamingState: undefined,
            endTime: Date.now(),
          })
        }
        return { toolCall, result: { content: `Error: Rate limited - ${error.message}`, callFailed: true } }
      }
      if (!pipelineResult) {
        return { toolCall, result: { content: `Error: ${error instanceof Error ? error.message : String(error)}`, callFailed: true } }
      }
    }
    if (pipelineResult) return pipelineResult
  }

  return toolHandler()
}

/**
 * 执行工具列表（智能并行 + 逐个审批）
 * 
 * 审批策略：
 * - 不需要审批的工具：并行执行（带并发限制）
 * - 需要审批的工具：逐个审批，用户可以选择批准或拒绝每个工具
 * - 如果用户拒绝某个工具，该工具被跳过，继续执行其他工具
 */
async function orchestrateToolBatchInternal(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
  store: import('../state/IntelligenceStore').ThreadBoundStore,
  abortSignal?: AbortSignal
): Promise<{ results: AgentToolExecutionResult[]; userRejected: boolean }> {
  const results: AgentToolExecutionResult[] = []
  let userRejected = false

  if (toolCalls.length === 0) {
    return { results, userRejected }
  }

  // 分析依赖
  const deps = resolveToolDependencyGraph(toolCalls)
  const completed = new Set<string>()
  const rejected = new Set<string>()
  const failed = new Set<string>()
  const pending = new Set(toolCalls.map(tc => tc.id))

  // 分流：事前必须放行的（block）与可直接执行的
  // 单次遍历完成划分：判定要读 store 并对命令做模式匹配，
  // 两次 filter 会让每条工具调用被判定两遍
  // 本轮是否消费过外部内容：决定高权限操作是否需要额外确认。
  // 此处统一汇总一次，供本轮所有待批项共用。
  const agentStoreState = useAgentStore.getState()
  const untrustedContext = collectUntrustedSignal(
    agentStoreState.threads[agentStoreState.currentThreadId ?? '']?.messages,
    { currentTurnOnly: true },
  )
  // 暂存本轮信号：记忆写入等旁路动作拿不到消息数组，只能读这里
  rememberUntrustedSignal(untrustedContext)

  const approvalRequired: ToolCall[] = []
  const directExecution: ToolCall[] = []
  for (const tc of toolCalls) {
    const gate = resolveApprovalGate(tc, context.chatMode, untrustedContext, context.workspacePath)
    if (gate === 'block') approvalRequired.push(tc)
    else directExecution.push(tc)
  }

  // 在执行前保存文件快照
  // 快照仅用于「撤销」，失败不应阻断工具执行本身（否则编排会整体抛出、中断主循环）
  try {
    await captureFileSnapshots(toolCalls, context)
  } catch (snapshotError) {
    logger.agent.warn('[Tools] Failed to capture file snapshots, continuing without undo points:', snapshotError)
  }

  // 1. 先执行无需事前放行的工具：'none' 与 'review' 两类都在这里。
  //    'review' 的改动由变化条事后裁决，执行阶段与免确认工具同路。
  //    注意：即使无需审批，也必须尊重工具的 parallel 配置。
  //    例如 todo_write / create_task_plan 这类工具绝不能与 read/write 混在同一批并行。
  if (directExecution.length > 0) {
    store.setStreamState({
      phase: 'tool_running',
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })

    const concurrency = resolveDynamicConcurrency()
    const limit = pLimit(concurrency)

    // 记录当前并行批次；遇到非并行工具时会先 flush。

    // 用于记录无审批工具的执行 Promise，以支持依赖等待
    const inFlight: Promise<AgentToolExecutionResult>[] = []
    const directPromiseMap = new Map<string, Promise<AgentToolExecutionResult>>()

    for (const batch of buildExecutionBatches(directExecution)) {
      for (const tc of batch.toolCalls) {
      if (!batch.parallel && inFlight.length > 0) {
        await Promise.allSettled(inFlight)
        inFlight.length = 0
      }

      const promise = (async () => {
        // 等待被依赖的直接执行工具执行完毕
        const tcDeps = deps.get(tc.id) || new Set()
        const depPromises = Array.from(tcDeps)
          .map(depId => directPromiseMap.get(depId))
          .filter(Boolean) as Promise<AgentToolExecutionResult>[]

        if (depPromises.length > 0) {
          const depResults = await Promise.all(depPromises)
          const blocked = depResults.some(depResult => indicatesDependencyFailure(depResult.result.content) || rejected.has(depResult.toolCall.id) || failed.has(depResult.toolCall.id))
          if (blocked) {
            const skipped = buildDependencyFailureResult(tc, 'Skipped: dependency failed')
            if (context.currentAssistantId) {
              store.updateToolCall(context.currentAssistantId, tc.id, {
                status: 'error',
                result: skipped.result.content,
                streamingState: undefined,
                endTime: Date.now(),
              })
            }
            failed.add(tc.id)
            pending.delete(tc.id)
            results.push(skipped)
            publishToolLifecycleEvent({
              type: 'tool:error',
              id: tc.id,
              error: skipped.result.content,
              ...composeToolInvocationIdentity(tc, context),
            })
            return skipped
          }
        }

        const run = async () => {
          try {
            const result = await invokeToolInvocation(tc, context, store, abortSignal)
            results.push(result)
            pending.delete(result.toolCall.id)
            if (result.result.callFailed ?? result.result.content.startsWith('Error:')) {
              failed.add(result.toolCall.id)
            } else {
              completed.add(result.toolCall.id)
            }
            return result
          } catch (error) {
            logger.agent.error(`[Tools] Unexpected error in ${tc.name}:`, error)
            const errorMsg = error instanceof Error ? error.message : String(error)

            if (context.currentAssistantId) {
              store.updateToolCall(context.currentAssistantId, tc.id, {
                status: 'error',
                result: errorMsg,
                streamingState: undefined,
                endTime: Date.now(),
              })
            }

            failed.add(tc.id)
            pending.delete(tc.id)
            const errorResult = { toolCall: tc, result: { content: `Error: ${errorMsg}` } }
            results.push(errorResult)
            publishToolLifecycleEvent({
              type: 'tool:error',
              id: tc.id,
              error: errorMsg,
              ...composeToolInvocationIdentity(tc, context),
            })
            return errorResult
          }
        }

        return batch.parallel ? limit(run) : run()
      })()
      directPromiseMap.set(tc.id, promise)

      if (batch.parallel) {
        inFlight.push(promise)
      } else {
        await promise
      }
      }

      if (batch.parallel && inFlight.length > 0) {
        await Promise.allSettled(inFlight)
        inFlight.length = 0
      }
    }

    if (inFlight.length > 0) {
      await Promise.allSettled(inFlight)
    }
  }

  // 2. 分组批量处理需要审批的工具
  //    将同类型的工具合并为一组，一次性提交审批
  const approvalGroups = clusterApprovalCohorts(approvalRequired)

  for (const group of approvalGroups) {
    if (abortSignal?.aborted) break

    const groupToolCalls = group.toolCalls.filter(tc => {
      const tcDeps = deps.get(tc.id) || new Set()
      return Array.from(tcDeps).every(dep => completed.has(dep) && !rejected.has(dep) && !failed.has(dep))
    })

    const depFailedTools = group.toolCalls.filter(tc => !groupToolCalls.some(g => g.id === tc.id))
    for (const tc of depFailedTools) {
      const skipped = buildDependencyFailureResult(tc, 'Skipped: dependency not met')
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'error',
          result: skipped.result.content,
          streamingState: undefined,
          endTime: Date.now(),
        })
      }
      failed.add(tc.id)
      results.push(skipped)
      pending.delete(tc.id)
      publishToolLifecycleEvent({
        type: 'tool:error',
        id: tc.id,
        error: skipped.result.content,
        ...composeToolInvocationIdentity(tc, context),
      })
    }

    if (groupToolCalls.length === 0) continue

    for (const tc of groupToolCalls) {
      if (context.currentAssistantId) {
        store.addToolCallPart(context.currentAssistantId, {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })
        store.updateToolCall(context.currentAssistantId, tc.id, { status: 'awaiting' })
      }
      publishToolLifecycleEvent({
        type: 'tool:pending',
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
        ...composeToolInvocationIdentity(tc, context),
      })
    }

    const effectiveRequestId = context.requestId || ''
    // 审批前汇总一次外部内容来源：此时本轮已读到的外部结果都在消息里，
    // 确认卡片据此说明「这次操作为什么被拦下来」。
    // 口径与门禁一致（限本轮），否则卡片会列出与本次拦截无关的历史来源。
    const untrustedSources: UntrustedSourceSummary[] = collectUntrustedSignal(
      store.getMessages(),
      { currentTurnOnly: true },
    ).sources
    store.setStreamState({
      phase: 'tool_pending',
      streamDetail: 'tool_awaiting',
      currentToolCall: groupToolCalls[0],
      pendingApprovalToolCalls: groupToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: tc.status,
        requestId: effectiveRequestId,
        ...(untrustedSources.length > 0 ? { untrustedSources } : {}),
      })),
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })

    // 桌面伴侣状态表达：把「等待用户确认」映射成伴侣的提示动作。
    // 属旁路能力，不 await、失败也不影响审批流程。
    void dispatchCompanionState(
      'awaiting_approval',
      useStore.getState().language === 'en' ? 'en' : 'zh'
    )

    const approvalResults = await approvalService.waitForBatchApproval(
      groupToolCalls.map(tc => tc.id),
      context.requestId
    )

    const approvedTools = groupToolCalls.filter(tc => approvalResults.get(tc.id) !== false)
    const rejectedTools = groupToolCalls.filter(tc => approvalResults.get(tc.id) === false)

    // 审批结论落账：用户每次批准/拒绝都是对判定结果的真实标注，
    // 是后续校准置信度阈值与灰区规则的唯一事实来源。
    // 记账属旁路，失败不得影响工具执行本身。
    try {
      const authorizationMode = useStore.getState().authorizationMode
      for (const tc of groupToolCalls) {
        const decision = approvalResults.get(tc.id) === false ? 'rejected' : 'approved'
        recordApproval(
          buildApprovalEntry({
            toolCall: tc,
            requestId: effectiveRequestId,
            decision,
            authorizationMode,
            untrustedSources,
          }),
        )
        // 会话级计数：只有被拒才算人工介入 —— 批准是顺着 AI 走，未改变执行方向
        if (context.threadId) {
          recordSessionApproval(context.threadId, decision === 'rejected' ? 1 : 0)
        }
      }
    } catch (ledgerError) {
      logger.agent.warn('[Tools] 审批记账失败，跳过记录:', ledgerError)
    }

    for (const tc of rejectedTools) {
      userRejected = true
      rejected.add(tc.id)
      if (context.currentAssistantId) {
        store.updateToolCall(context.currentAssistantId, tc.id, {
          status: 'rejected',
          streamingState: undefined,
          endTime: Date.now(),
        })
      }
      publishToolLifecycleEvent({ type: 'tool:rejected', id: tc.id, ...composeToolInvocationIdentity(tc, context) })
      results.push({ toolCall: tc, result: { content: 'Rejected by user' } })
      pending.delete(tc.id)
    }

    if (approvedTools.length > 0) {
      // 审批通过、恢复执行：伴侣回到「思考」状态
      void dispatchCompanionState(
        'working',
        useStore.getState().language === 'en' ? 'en' : 'zh'
      )

      store.setStreamState({
        phase: 'tool_running',
        streamDetail: 'tool_executing',
        currentToolCall: approvedTools[0],
        pendingApprovalToolCalls: undefined,
        statusText: undefined,
        requestId: context.requestId,
        assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
      })

      for (const tc of approvedTools) {
        if (abortSignal?.aborted) break
        const result = await invokeToolInvocation(tc, context, store, abortSignal)
        results.push(result)
        pending.delete(tc.id)
        if (result.result.callFailed ?? result.result.content.startsWith('Error:')) {
          failed.add(tc.id)
        } else {
          completed.add(tc.id)
        }
      }
    }
  }

  // 确保所有工具状态已更新并重置流状态
  if (!abortSignal?.aborted) {
    // 重置流状态为 streaming（移除 tool_running 状态）
    store.setStreamState({
      phase: 'streaming',
      streamDetail: undefined,
      currentToolCall: undefined,
      statusText: undefined,
      requestId: context.requestId,
      assistantId: context.assistantId ?? context.currentAssistantId ?? undefined,
    })
  }

  return { results, userRejected }
}

/**
 * 执行工具列表（智能并行 + 逐个审批）
 *
 * 观测外壳：批次起止锚点与工具计数在这里打点，内部实现不感知性能追踪。
 * 「怎么执行」和「怎么观测」分开之后，替换内部实现不会丢掉时间轴上的
 * 批次区间，诊断代码也不会穿插进执行逻辑里。
 */
export async function orchestrateToolBatch(
  toolCalls: ToolCall[],
  context: ToolExecutionContext,
  store: import('../state/IntelligenceStore').ThreadBoundStore,
  abortSignal?: AbortSignal,
): Promise<{ results: AgentToolExecutionResult[]; userRejected: boolean }> {
  if (toolCalls.length === 0) {
    return { results: [], userRejected: false }
  }

  const startedAt = Date.now()

  perfTrace.bump(PERF_TRACE_COUNTERS.toolCalls, toolCalls.length)
  perfTrace.anchor('tool-batch', 'begin', {
    count: toolCalls.length,
    // 只保留前若干个工具名：锚点会逐行写入文件，把整批名字都塞进去会让文件迅速膨胀
    tools: toolCalls.slice(0, 12).map((tc) => tc.name),
  })

  try {
    const outcome = await orchestrateToolBatchInternal(toolCalls, context, store, abortSignal)
    perfTrace.anchor('tool-batch', 'end', {
      count: toolCalls.length,
      ms: Date.now() - startedAt,
      rejected: outcome.userRejected,
    })
    return outcome
  } catch (err) {
    // 抛出的批次同样要留下区间，否则时间轴上会多出一段无法解释的空档
    perfTrace.anchor('tool-batch', 'end', {
      count: toolCalls.length,
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/** @deprecated 请使用 orchestrateToolBatch */
export const executeTools = orchestrateToolBatch
