/**
 * 外部智能体 API（Claude Code / Codex / Cursor 子进程桥接）
 *
 * 覆盖 IPC 频道：
 * - external-agent:preflight  可用性检测
 * - external-agent:start      启动运行（非阻塞）
 * - external-agent:wait       等待结束
 * - external-agent:abort      中止
 * - external-agent:status     状态查询
 * - external-agent:getConfig  读取配置
 * - external-agent:saveConfig 保存配置
 *
 * 事件：external-agent:stream:{requestId}（动态频道，渲染进程按 requestId 订阅）
 */
import { invoke, dynamicChannel } from '../ipcHelpers'
import type {
  ExternalAgentId,
  ExternalAgentRunRequest,
  ExternalAgentRunResult,
  ExternalAgentConfig,
  AgentPreflightResult,
  AgentStreamEvent,
  RecentAgentRun,
} from '../../../shared/externalAgents'

export function createExternalAgentApi() {
  return {
    // ── 可用性检测 ──
    /** 检测外部 Agent CLI 是否可用（快速，不启动长任务） */
    preflight: (agent: ExternalAgentId) =>
      invoke<AgentPreflightResult>('external-agent:preflight')(agent),

    // ── 运行控制 ──
    /** 启动一次运行（立即返回 requestId，进度经 onStream 推送） */
    start: (request: ExternalAgentRunRequest) =>
      invoke<{ requestId: string; ok: boolean; error?: string }>('external-agent:start')(request),

    /** 等待运行结束（阻塞至 done/error/aborted 或超时） */
    wait: (requestId: string, timeoutMs?: number) =>
      invoke<ExternalAgentRunResult>('external-agent:wait')(requestId, timeoutMs),

    /** 中止运行 */
    abort: (requestId: string) =>
      invoke<{ aborted: boolean }>('external-agent:abort')(requestId),

    /** 查询状态 */
    status: (requestId: string) =>
      invoke<{ status: 'running' | 'done' | 'error' | 'aborted' | 'unknown'; result: ExternalAgentRunResult | null }>(
        'external-agent:status',
      )(requestId),

    // ── 配置 ──
    /** 读取外部 Agent 配置 */
    getConfig: () =>
      invoke<ExternalAgentConfig>('external-agent:getConfig')(),

    /** 保存外部 Agent 配置（增量 patch） */
    saveConfig: (patch: Partial<ExternalAgentConfig>) =>
      invoke<{ success: boolean; config: ExternalAgentConfig }>('external-agent:saveConfig')(patch),

    // ── 最近运行记录（继续上次任务）──
    /** 列出最近运行记录（新→旧，最多 10 条） */
    recent: () =>
      invoke<RecentAgentRun[]>('external-agent:recent')(),

    /** 清空最近运行记录 */
    clearRecent: () =>
      invoke<{ success: boolean }>('external-agent:clearRecent')(),
    // ── 流式事件（动态频道）──
    /** 订阅指定 requestId 的流式事件，返回取消订阅函数 */
    onStream: dynamicChannel<{ requestId: string; event: AgentStreamEvent }>('external-agent:stream:'),
  }
}
