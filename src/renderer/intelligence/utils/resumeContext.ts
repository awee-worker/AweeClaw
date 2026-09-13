/**
 * 断点续接工具（致命问题 #1）
 *
 * 场景：AI 执行多步任务时会话被停止/失败/达到工具调用上限，用户随后发送
 * “继续 / 接着做”等短消息，AI 却不知道要续接什么。
 *
 * 原因：被中断的最后一轮通常只剩 assistant 的 tool_calls（没有文本内容），
 * 在消息序列化时（MessageAdapter 只保留有 tool result 的 tool_calls）会被整体
 * 丢弃，导致 LLM 看不到“刚才进行到哪一步”。
 *
 * 方案：在 Agent.send 组装新消息前，若检测到线程存在未完成（被中断）的
 * 工具调用且用户消息为续接类请求，自动在用户消息前附加一段「断点续接说明」，
 * 明确告知上次请求内容与中断位置，让 AI 直接续接而不是从头再来。
 */

import type { ChatThread, AssistantMessage, ToolCallPart } from '@intelligence/providerTypes'

/** 未完成工具调用状态（无对应 tool result，中断残留） */
const UNFINISHED_TOOL_STATUSES = new Set(['pending', 'running', 'awaiting', 'error'])

/** 提取消息纯文本（兼容 string 与 content part 数组） */
function messageToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: string; text?: string } => !!p && typeof p === 'object' && (p as { type?: string }).type === 'text')
      .map(p => p.text || '')
      .join('')
  }
  return ''
}

/**
 * 是否属于续接/短衔接类请求。
 * 仅纯短消息触发；长任务描述（如任务执行器静默注入“继续执行项目 X 的任务 Y…”）
 * 不触发，避免把旧任务的断点信息错误附加到新任务上。
 */
function looksLikeResume(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true // 空内容（如 silent 注入）也补上续接说明
  const bare = trimmed.replace(/[\s，。！？!?,.:：;；、~～]+/g, '')
  // 纯短消息（用户口头衔接语，通常不超过 12 个有效字符）
  if (bare.length <= 12) return true
  return false
}

interface InterruptedCallInfo {
  names: string[]
  lastUserRequest: string
  lastAssistantText: string
}

/** 扫描线程，找出上次被中断的执行痕迹 */
function findInterruptedState(thread: ChatThread | undefined): InterruptedCallInfo | null {
  if (!thread || !thread.messages || thread.messages.length === 0) return null

  // 最后一条 assistant 消息
  let lastAssistant: AssistantMessage | null = null
  let lastUserRequest = ''

  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const msg = thread.messages[i]
    if (msg.role === 'assistant' && !lastAssistant) {
      lastAssistant = msg as AssistantMessage
    } else if (msg.role === 'user' && !lastUserRequest) {
      lastUserRequest = messageToText(msg.content).trim()
    }
    if (lastAssistant && lastUserRequest) break
  }

  if (!lastAssistant) return null

  // 提取 tool calls（toolCalls 字段或 parts）
  const toolCalls = lastAssistant.toolCalls?.length
    ? lastAssistant.toolCalls
    : (lastAssistant.parts || [])
        .filter((p): p is ToolCallPart => p.type === 'tool_call')
        .map(p => p.toolCall)

  const interrupted = toolCalls.filter(tc => UNFINISHED_TOOL_STATUSES.has(tc.status || ''))

  if (interrupted.length === 0) return null

  return {
    names: interrupted.slice(0, 5).map(tc => tc.name),
    lastUserRequest: lastUserRequest.slice(0, 300),
    lastAssistantText: messageToText(lastAssistant.content).trim().slice(-500),
  }
}

/**
 * 构造断点续接说明文本；无需续接时返回 null
 *
 * @param thread       当前会话线程（可为 undefined——新会话无需续接）
 * @param incomingText 用户这次发送的消息文本
 */
export function buildResumeNotice(thread: ChatThread | undefined, incomingText: string): string | null {
  if (!looksLikeResume(incomingText)) return null

  const state = findInterruptedState(thread)
  if (!state) return null

  const lines: string[] = [
    '## 断点续接（自动附加）',
    '上一条请求的执行在调用工具时被中断（会话停止），尚未完成。请直接续接该任务，不要重新开始或询问用户是否要重做：',
  ]
  if (state.lastUserRequest) {
    lines.push(`上一条请求：${state.lastUserRequest}`)
  }
  if (state.names.length > 0) {
    lines.push(`中断于工具调用：${state.names.join('、')}（该次调用未产生结果）`)
  }
  if (state.lastAssistantText) {
    lines.push(`上次进展片段：${state.lastAssistantText.length > 300 ? `${state.lastAssistantText.slice(-300)}…` : state.lastAssistantText}`)
  }
  lines.push('请基于上述背景继续完成剩余工作。')

  return lines.join('\n')
}
