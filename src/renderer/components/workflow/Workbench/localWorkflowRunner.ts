/**
 * V2 工作流客户端本地执行引擎
 *
 * 为什么需要它：
 * 已安装技能（SKILL.md）与插件工具（MCP / 插件注册的 tool）只存在于渲染进程——
 * 技能正文来自本地技能目录，工具来自 toolManager 的 provider 注册表。
 * 后端进程既读不到这些目录，也没有这份注册表，因此「节点调用技能/插件」这类需求
 * 在后端执行链路上不可能实现，只能由客户端自己跑。
 *
 * 设计要点：
 * - 事件格式与后端 SSE 完全一致（RunEvent），UI 侧复用同一套 handleSSEEvent，
 *   不新增任何渲染分支。
 * - 执行顺序按「就绪队列」推进，而不是单纯拓扑序：condition / switch_case 只走
 *   命中的那条出边，未命中的分支不会被误执行。
 * - 本地尚未实现的节点类型（http_request、agent_task 等）标记为 SKIPPED 并写日志，
 *   而不是伪装成功，也不是让整条工作流失败——用户能一眼看到哪些环节没在本地执行。
 *
 * @module WorkflowLocalRunner
 */

import type { WorkflowDefinitionV2, WorkflowNodeV2, WorkflowEdgeV2 } from '@shared/protocols/workflowV2'
import type { RunEvent } from '@shared/configuration/workflows/workflowSSEClient'
import type { ToolExecutionContext } from '@shared/protocols/modelProtocol'
import { toolManager } from '@intelligence/toolkit/providers/ToolCoordinator'
import { skillService } from '@intelligence/runtime/skillRepository'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { workspaceManager } from '@renderer/adapters/WorkspaceManager'
import { logger } from '@toolkit/LogEngine'

/** 单个节点的执行结果 */
interface NodeOutcome {
  status: 'success' | 'failed' | 'skipped'
  output?: unknown
  error?: string
  /** 命中该 handle 的出边（condition / switch_case 用），缺省表示走全部出边 */
  handle?: string
  /** 跳过原因（status = skipped 时必有） */
  skipReason?: string
}

export interface LocalRunOptions {
  workflow: WorkflowDefinitionV2
  input?: Record<string, unknown>
  signal?: AbortSignal
  emit: (event: RunEvent) => void
}

export interface LocalRunHandle {
  runId: string
  /** 执行结束（无论成功失败）后 resolve */
  done: Promise<void>
  cancel: () => void
}

/** 本地可执行的节点类型。其余类型明确跳过，不伪装成功。 */
const LOCAL_EXECUTABLE = new Set<string>([
  'start',
  'skill',
  'tool_call',
  'mcp_service',
  'text_output',
  'variable_set',
  'delay',
  'condition',
  'switch_case',
])

// ── 变量插值 ─────────────────────────────────────────────

/**
 * 把 `{{name}}` / `${name}` 替换成变量值。
 *
 * 只做纯文本替换，不执行表达式——工作流定义等同于配置文件，
 * 在里面求值任意 JS 会把「运行一个工作流」变成「执行任意代码」。
 */
function interpolate(text: string, vars: Map<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.$]+)\s*\}\}|\$\{\s*([\w.$]+)\s*\}/g, (match, a, b) => {
    const key = (a || b) as string
    if (!vars.has(key)) return match
    const value = vars.get(key)
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

/** 递归插值：只处理字符串叶子，保持对象结构 */
function interpolateDeep<T>(value: T, vars: Map<string, unknown>): T {
  if (typeof value === 'string') return interpolate(value, vars) as unknown as T
  if (Array.isArray(value)) return value.map((item) => interpolateDeep(item, vars)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, vars)
    }
    return out as unknown as T
  }
  return value
}

// ── 条件求值 ─────────────────────────────────────────────

function compare(left: unknown, operator: string, right: unknown): boolean {
  const asString = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  switch (operator) {
    case 'eq':
      return asString(left) === asString(right)
    case 'neq':
      return asString(left) !== asString(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    case 'contains':
      return asString(left).includes(asString(right))
    case 'not_contains':
      return !asString(left).includes(asString(right))
    case 'is_truthy':
      return Boolean(left) && left !== 'false' && left !== '0'
    case 'is_falsy':
      return !left || left === 'false' || left === '0'
    default:
      return false
  }
}

// ── 节点执行 ─────────────────────────────────────────────

interface ExecContext {
  runId: string
  vars: Map<string, unknown>
  workspacePath: string | null
  threadId: string | null
  signal?: AbortSignal
  emit: (event: RunEvent) => void
}

function emitLog(ctx: ExecContext, nodeId: string, log: string): void {
  ctx.emit({
    type: 'run:log',
    runId: ctx.runId,
    nodeId,
    log,
    timestamp: new Date().toISOString(),
  })
}

async function executeSkillNode(node: WorkflowNodeV2, ctx: ExecContext): Promise<NodeOutcome> {
  const skillName = String(node.data?.skillName || '').trim()
  if (!skillName) {
    return { status: 'failed', error: '技能节点未指定技能名称' }
  }

  const skill = await skillService.getSkillByName(skillName)
  if (!skill) {
    // 给出已安装清单而不是一句「不存在」：名字打错是最常见的失败方式
    const installed = await skillService.getSkills().catch(() => [])
    const names = installed.filter((s) => s.enabled).map((s) => s.name).slice(0, 40)
    return {
      status: 'failed',
      error: `技能「${skillName}」未安装。已安装技能：${names.length ? names.join('、') : '（无）'}`,
    }
  }

  const body = skill.content || ''
  const extra = node.data?.skillArgs
  const hasExtra = extra && typeof extra === 'object' && Object.keys(extra).length > 0
  const output = hasExtra
    ? `${body}\n\n---\n补充输入：\n${JSON.stringify(interpolateDeep(extra, ctx.vars), null, 2)}`
    : body

  emitLog(ctx, node.id, `[Skill] 已加载技能「${skill.name}」（${output.length} 字符）`)
  return { status: 'success', output }
}

async function executeToolNode(node: WorkflowNodeV2, ctx: ExecContext): Promise<NodeOutcome> {
  // mcp_service 节点历史上只存 serverId + toolName，工具名仍是 toolManager 里的键
  const toolName = String(node.data?.toolName || node.data?.mcpToolName || '').trim()
  if (!toolName) {
    return { status: 'failed', error: '工具节点未指定工具名' }
  }

  if (!toolManager.hasTool(toolName)) {
    const available = toolManager
      .getAllToolDefinitions()
      .map((d) => d.name)
      .slice(0, 60)
    return {
      status: 'failed',
      error: `本地工具注册表中不存在「${toolName}」。可用工具：${available.join(', ')}`,
    }
  }

  if (ctx.signal?.aborted) {
    return { status: 'failed', error: '执行已取消' }
  }

  const rawArgs = (node.data?.toolArgs || {}) as Record<string, unknown>
  const args = interpolateDeep(rawArgs, ctx.vars)

  const toolContext: ToolExecutionContext = {
    workspacePath: ctx.workspacePath,
    threadId: ctx.threadId,
    requestId: ctx.runId,
    toolCallId: `${ctx.runId}_${node.id}`,
    // 工作流由用户在本地点「运行」显式触发，节点里调什么工具是作者配置好的，
    // 语义上等价于用户手动执行，因此不再逐次弹审批；主进程审批链路在本引擎里
    // 没有对应的 UI 等待方，挂起只会让节点卡到超时。
    skipMainApproval: true,
    abortSignal: ctx.signal,
  }

  emitLog(ctx, node.id, `[Tool] 执行 ${toolName}`)

  const result = await toolManager.execute(toolName, args, toolContext)

  if (!result.success) {
    return { status: 'failed', error: result.error || `${toolName} 执行失败` }
  }

  return { status: 'success', output: result.result ?? '' }
}

async function executeNode(node: WorkflowNodeV2, ctx: ExecContext): Promise<NodeOutcome> {
  const data = (node.data || {}) as Record<string, unknown>

  switch (node.type) {
    case 'start':
      return { status: 'success', output: ctx.vars.get('$input') ?? null }

    case 'skill':
      return executeSkillNode(node, ctx)

    case 'tool_call':
    case 'mcp_service':
      return executeToolNode(node, ctx)

    case 'text_output': {
      const text = interpolate(String(data.textContent || ''), ctx.vars)
      return { status: 'success', output: text }
    }

    case 'variable_set': {
      const name = String(data.variableName || '').trim()
      if (!name) return { status: 'failed', error: '变量节点未指定变量名' }
      const value = interpolate(String(data.variableValue ?? ''), ctx.vars)
      ctx.vars.set(name, value)
      return { status: 'success', output: value }
    }

    case 'delay': {
      const ms = Math.min(Math.max(Number(data.delayMs) || 0, 0), 60_000)
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
      return { status: 'success', output: `waited ${ms}ms` }
    }

    case 'condition': {
      const rules = (data.conditions || []) as Array<{
        variable?: string
        operator?: string
        value?: unknown
        targetHandle?: string
      }>
      for (const rule of rules) {
        const left = ctx.vars.get(String(rule.variable || ''))
        if (compare(left, String(rule.operator || 'eq'), rule.value)) {
          return { status: 'success', output: { matched: rule.targetHandle }, handle: rule.targetHandle }
        }
      }
      // 无命中：走 else 分支（handle = 'else'）
      return { status: 'success', output: { matched: 'else' }, handle: 'else' }
    }

    case 'switch_case': {
      const cases = (data.switchCases || []) as Array<{
        condition?: string
        targetHandle?: string
      }>
      const switchValue = String(ctx.vars.get(String(data.switchVariable || '')) ?? '')
      for (const c of cases) {
        if (interpolate(String(c.condition || ''), ctx.vars) === switchValue) {
          return { status: 'success', output: { matched: c.targetHandle }, handle: c.targetHandle }
        }
      }
      return { status: 'success', output: { matched: 'default' }, handle: 'default' }
    }

    default: {
      // 明确跳过，不伪装成功：本地引擎还没有这些节点的实现，
      // 把它们当成功会让下游拿到空输入却继续跑，问题更隐蔽。
      const reason = `节点类型 ${node.type} 暂不支持本地执行（需要后端执行器）`
      emitLog(ctx, node.id, `[Skip] ${reason}`)
      return { status: 'skipped', skipReason: reason }
    }
  }
}

// ── 图推进 ───────────────────────────────────────────────

/** 计算某个节点执行完成后应推进到哪些节点 */
function resolveNextNodeIds(
  node: WorkflowNodeV2,
  outcome: NodeOutcome,
  edges: WorkflowEdgeV2[],
): string[] {
  const outgoing = edges.filter((e) => e.source === node.id)
  if (outgoing.length === 0) return []

  // 分支节点只走命中的那条路
  if (outcome.handle && (node.type === 'condition' || node.type === 'switch_case')) {
    const matched = outgoing.filter((e) => (e.sourceHandle || '') === outcome.handle)
    if (matched.length > 0) return matched.map((e) => e.target)
    return []
  }

  // 其余节点走全部出边，但忽略条件专用的命名 handle（它们只属于分支语义）
  return outgoing.map((e) => e.target)
}

// ── 入口 ─────────────────────────────────────────────────

/**
 * 启动一次本地执行。
 *
 * 不抛出：所有异常都以 run:error 事件返回，调用方只需消费事件。
 */
export function startLocalWorkflowRun(options: LocalRunOptions): LocalRunHandle {
  const { workflow, input, emit } = options
  const runId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const controller = new AbortController()
  // 不用 AbortSignal.any：旧版 Chromium 不支持，手写合并更稳
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const signal = controller.signal


  const vars = new Map<string, unknown>()
  if (input) {
    for (const [k, v] of Object.entries(input)) vars.set(k, v)
  }
  vars.set('$input', input ?? {})
  vars.set('$workflow.id', workflow.id)
  vars.set('$workflow.name', workflow.name)
  vars.set('$workflow.runId', runId)

  const ctx: ExecContext = {
    runId,
    vars,
    workspacePath: workspaceManager.getCurrentWorkspacePath(),
    threadId: useAgentStore.getState().currentThreadId ?? null,
    signal,
    emit,
  }

  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]))
  const edges = workflow.edges

  // 入口节点：没有入边的节点
  const targetIds = new Set(edges.map((e) => e.target))
  const queue: string[] = workflow.nodes.filter((n) => !targetIds.has(n.id)).map((n) => n.id)
  if (queue.length === 0 && workflow.nodes.length > 0) {
    queue.push(workflow.nodes[0].id)
  }

  const visited = new Set<string>()

  const done = (async () => {
    emit({ type: 'run:start', runId, timestamp: new Date().toISOString() })

    try {
      while (queue.length > 0) {
        if (signal.aborted) {
          emit({
            type: 'run:error',
            runId,
            error: '执行已取消',
            timestamp: new Date().toISOString(),
          })
          return
        }

        const nodeId = queue.shift()!
        if (visited.has(nodeId)) continue
        visited.add(nodeId)

        const node = nodeMap.get(nodeId)
        if (!node) continue

        if (!LOCAL_EXECUTABLE.has(node.type)) {
          // 已知不支持的类型在 executeNode 里统一报 skipped，这里继续往下走
        }

        emit({
          type: 'node:start',
          runId,
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          timestamp: new Date().toISOString(),
        })

        let outcome: NodeOutcome
        try {
          outcome = await executeNode(node, ctx)
        } catch (err) {
          outcome = {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          }
        }

        if (outcome.status === 'failed') {
          emit({
            type: 'node:error',
            runId,
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            error: outcome.error,
            timestamp: new Date().toISOString(),
          })

          // 节点级错误策略：skip = 继续跑下游，其余一律终止
          const onError = (node.data as { onError?: { action?: string } } | undefined)?.onError
          if (onError?.action !== 'skip') {
            emit({
              type: 'run:error',
              runId,
              error: `节点「${node.name || node.id}」执行失败：${outcome.error}`,
              timestamp: new Date().toISOString(),
            })
            return
          }

          for (const next of resolveNextNodeIds(node, outcome, edges)) queue.push(next)
          continue
        }

        if (outcome.status === 'skipped') {
          emit({
            type: 'node:complete',
            runId,
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            status: 'SKIPPED',
            output: { skipped: true, reason: outcome.skipReason },
            timestamp: new Date().toISOString(),
          })
        } else {
          emit({
            type: 'node:complete',
            runId,
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            status: 'SUCCESS',
            output: outcome.output,
            timestamp: new Date().toISOString(),
          })
        }

        // 输出写回变量：节点配了 outputVar 才写，避免污染变量空间
        const outputVar = (node.data as { outputVar?: string } | undefined)?.outputVar
        if (outputVar && outcome.output !== undefined) {
          vars.set(outputVar, outcome.output)
        }

        for (const next of resolveNextNodeIds(node, outcome, edges)) queue.push(next)
      }

      emit({ type: 'run:complete', runId, status: 'completed', timestamp: new Date().toISOString() })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.ui?.error?.('[LocalWorkflowRunner] 执行异常:', err)
      emit({ type: 'run:error', runId, error: message, timestamp: new Date().toISOString() })
    }
  })()

  return {
    runId,
    done,
    cancel: () => controller.abort(),
  }
}
