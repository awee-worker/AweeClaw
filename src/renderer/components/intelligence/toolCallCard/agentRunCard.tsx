/**
 * 外部智能体进度卡片（聊天内嵌）
 *
 * 为 external_agent_delegate 工具调用渲染实时进度：
 * - 运行中：阶段指示（启动/思考/工具调用/写文件/测试/完成）+ 工具调用列表 + Agent 叙述尾部 + 中止按钮
 * - 结束后：成功/失败徽章 + 会话 ID（可复制，供 resume_session 续接）+ 最终输出
 *
 * requestId 来源（useAgentRunRequestId）：
 * 1) arguments._meta.requestId（工具执行完成后由 toolOrchestrator 合并）
 * 2) 运行中经 agentRunBus 按 toolCallId / agent+task 实时匹配
 */
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Bot, Check, Copy, Loader2, Square, Wrench } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import type { ToolCall } from '@intelligence/providerTypes'
import {
  EXTERNAL_AGENT_DEFS,
  type AgentStreamEvent,
  type ExternalAgentId,
} from '@shared/externalAgents'
import { useAgentRunRequestId } from '@intelligence/toolkit/agentRunBus'
import { CommandOutputContainer } from './CommandOutputContainer'
import { asString, previewSlice, type ToolArgs } from './helpers'

/** 阶段 → 双语标签 */
function stageLabel(stage: string, isZh: boolean): string {
  const map: Record<string, [string, string]> = {
    spawning: ['启动中…', 'Spawning…'],
    thinking: ['思考中…', 'Thinking…'],
    tool_call: ['调用工具中…', 'Calling tools…'],
    writing: ['写入文件中…', 'Writing files…'],
    running_test: ['运行测试中…', 'Running tests…'],
    done: ['已完成', 'Done'],
  }
  const entry = map[stage] || [isZh ? '运行中…' : 'Running…', isZh ? '运行中…' : 'Running…']
  return isZh ? entry[0] : entry[1]
}

interface AgentProgressProps {
  toolCall: ToolCall
  args: ToolArgs
  isRunning: boolean
  language: Language
}

function AgentRunProgressInner({ toolCall, args, isRunning, language }: AgentProgressProps) {
  const isZh = language === 'zh'
  const agent = asString(args.agent)
  const task = asString(args.task)
  const meta = args._meta as Record<string, unknown> | undefined
  const metaRequestId = typeof meta?.requestId === 'string' ? meta.requestId : ''
  const session = typeof meta?.session === 'string' ? meta.session : ''

  // 解析当前运行绑定的 requestId（运行中经总线匹配，结束后取 _meta）
  const requestId = useAgentRunRequestId(toolCall.id, metaRequestId, agent, task)

  // ── 流式进度状态 ──
  const [stage, setStage] = useState('spawning')
  const [tools, setTools] = useState<string[]>([])
  const [textTail, setTextTail] = useState('')
  const [streamError, setStreamError] = useState('')
  const [finalStatus, setFinalStatus] = useState<'done' | 'error' | 'aborted' | null>(null)
  const [abortedByUser, setAbortedByUser] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [sessionCopied, setSessionCopied] = useState(false)

  // 订阅主进程推流频道（仅运行中）
  useEffect(() => {
    if (!requestId || !isRunning) return
    let disposed = false
    const off = window.electronAPI.externalAgent.onStream(requestId, (payload) => {
      if (disposed) return
      const evt = payload.event as AgentStreamEvent
      switch (evt.type) {
        case 'status':
          setStage(evt.stage)
          break
        case 'tool':
          setTools((prev) => [...prev.slice(-23), evt.name])
          setStage('tool_call')
          break
        case 'text':
          setTextTail((prev) => (prev + evt.content).slice(-1500))
          break
        case 'error':
          setStreamError(evt.message)
          break
        case 'done':
          setFinalStatus(evt.result.status === 'done' || evt.result.status === 'error' ? evt.result.status : 'aborted')
          if (!evt.result.success) setStreamError(evt.result.error || '')
          break
      }
    })
    return () => {
      disposed = true
      off()
    }
  }, [requestId, isRunning])

  const handleAbort = useCallback(async () => {
    if (!requestId || aborting) return
    setAborting(true)
    try {
      await window.electronAPI.externalAgent.abort(requestId)
      setAbortedByUser(true)
    } catch {
      /* 中止失败不打断卡片 */
    } finally {
      setAborting(false)
    }
  }, [requestId, aborting])

  const handleCopySession = useCallback(async () => {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session)
      setSessionCopied(true)
      setTimeout(() => setSessionCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }, [session])

  const def = EXTERNAL_AGENT_DEFS[agent as ExternalAgentId]
  const displayName = def?.displayName || agent || 'External Agent'
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''
  const showError = streamError || (toolCall.status === 'error' ? asString(toolCall.error) || '' : '')
  const isSuccess = toolCall.status === 'success'

  return (
    <div className="p-2 space-y-2">
      {/* 头部：Agent 名 + 阶段 + 工具数 + 中止按钮 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Bot className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-[12px] font-medium text-text-primary">{displayName}</span>

        {(isRunning || !finalStatus) && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {stageLabel(stage, isZh)}
          </span>
        )}
        {tools.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted">
            <Wrench className="w-2.5 h-2.5" />
            {tools.length}
          </span>
        )}
        {isRunning && requestId && !abortedByUser && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void handleAbort()
            }}
            disabled={aborting}
            className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-status-error/10 text-status-error hover:bg-status-error/20 disabled:opacity-50 transition-colors"
          >
            <Square className="w-2.5 h-2.5" />
            {isZh ? '中止' : 'Abort'}
          </button>
        )}
      </div>

      {/* 任务描述 */}
      {task && (
        <p className="text-[12px] text-text-muted/90 break-all leading-relaxed">
          {previewSlice(task, 200)}
        </p>
      )}

      {/* 最近工具调用 */}
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tools.slice(-8).map((name, i) => (
            <span
              key={`${i}-${name}`}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted font-mono"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Agent 叙述输出（运行中尾部 / 结束后完整） */}
      {(textTail || stringResult) && (
        <CommandOutputContainer maxHeightPx={240}>
          <div className="text-[12px] text-text-muted/90 whitespace-pre-wrap break-all p-2 font-mono">
            {stringResult ? previewSlice(stringResult, 8000) : textTail}
          </div>
        </CommandOutputContainer>
      )}

      {/* 错误信息 */}
      {showError && !isSuccess && (
        <div className="px-2 py-1.5 bg-status-error/10 rounded-md text-[11px] text-status-error/90 break-all font-mono">
          {previewSlice(showError, 500)}
        </div>
      )}

      {/* 结束状态行：成功 / 失败 / 中止 + 会话 ID（可复制，供 resume） */}
      {(finalStatus || toolCall.status === 'success' || toolCall.status === 'error') && (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          {abortedByUser || finalStatus === 'aborted' ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
              <Square className="w-2.5 h-2.5" />
              {isZh ? '已中止' : 'Aborted'}
            </span>
          ) : isSuccess ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-status-success/15 text-status-success font-medium">
              <Check className="w-2.5 h-2.5" />
              {isZh ? '执行成功' : 'Succeeded'}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-status-error/15 text-status-error font-medium">
              <Loader2 className="w-2.5 h-2.5" style={{ animation: 'none' }} />
              {isZh ? '执行失败' : 'Failed'}
            </span>
          )}
          {session && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void handleCopySession()
              }}
              title={isZh ? '点击复制会话 ID（用于继续上次任务）' : 'Copy session id (for resume)'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted hover:text-text-primary font-mono transition-colors"
            >
              {sessionCopied ? (
                <Check className="w-2.5 h-2.5 text-status-success" />
              ) : (
                <Copy className="w-2.5 h-2.5" />
              )}
              {previewSlice(session, 16)}
            </button>
          )}
        </div>
      )}

      {/* 未绑定 requestId 的兜底提示 */}
      {isRunning && !requestId && (
        <p className="text-[11px] text-text-muted/70 italic">
          {isZh ? '正在启动外部智能体…' : 'Starting external agent…'}
        </p>
      )}
    </div>
  )
}

/** 预览渲染器入口（注册进 previewRegistry） */
export function renderExternalAgent(ctx: {
  toolCall: ToolCall
  args: ToolArgs
  isRunning: boolean
  language: Language
}): ReactNode {
  const { toolCall, args, isRunning, language } = ctx
  if (!asString(args.agent) && !asString(args.task)) return null
  return <AgentRunProgress toolCall={toolCall} args={args} isRunning={isRunning} language={language} />
}

const AgentRunProgress = memo(AgentRunProgressInner)
export default AgentRunProgress
