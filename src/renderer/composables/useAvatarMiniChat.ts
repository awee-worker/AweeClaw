/**
 * useAvatarMiniChat - 悬浮头像迷你聊天的完整对话 hook（带工具调用）
 *
 * 与普通聊天窗口功能完全一致（工具调用、命令执行等），只是窗口更小。
 *
 * 架构：
 * - 自己实现工具循环（不使用 runVoiceToolLoop，因为它是为语音设计的）
 * - 每轮 LLM 迭代创建独立的 assistant 消息（与主窗口体验一致）
 *   - 第一轮：LLM 可能返回"好的，我来帮你创建文件" + tool_calls → 显示文字 + 工具调用状态
 *   - 工具执行后：LLM 基于工具结果继续生成 → 新的 assistant 消息显示最终回复
 * - 流式文本只累积当前轮次的内容（不会跨轮次追加）
 * - 工具执行走 executeVoiceToolCall（复用 voiceToolLoop 的工具执行逻辑）
 *
 * 与 runVoiceToolLoop 的关键区别：
 * - runVoiceToolLoop：所有迭代的文本通过同一个 onTextChunk 回调累积，适合 TTS（只朗读最终文本）
 * - useAvatarMiniChat：每轮迭代的文本写入独立的 assistant 消息，适合文本 UI 展示
 *
 * 消息类型：
 * - MiniChatMessage 支持工具调用状态（toolCalls 数组）
 * - 用户消息可携带附件（多模态）
 * - assistant 消息流式更新 content + toolCalls
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { api } from '@renderer/adapters/electronBridge'
import {
  callLLMWithTools,
  executeMiniChatToolCall,
  ensureVoiceToolsInitialized,
  type VoiceToolCallRecord,
} from '@intelligence/voice/voiceToolLoop'
import {
  miniChatApprovalService,
  type PendingApprovalToolCall,
  type AuthorizationMode,
} from '@intelligence/voice/miniChatApprovalService'
import { toolManager } from '@intelligence/toolkit'
import { buildAgentSystemPrompt } from '@intelligence/prompt-engine/PromptComposer'
import { compressImageFromBase64 } from '@intelligence/utils/imageCompressor'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
import { BRAND } from '@shared/brand'
import type { MainConversationSnapshot, VoiceContextPayload } from '../types/electronBridge'
import type { LLMConfig, LLMMessage, MessageContentPart } from '@shared/protocols/modelProtocol'

// ============================================
// 类型定义
// ============================================

export type ChatRole = 'user' | 'assistant'

/** 迷你聊天附件 */
export interface ChatAttachment {
  id: string
  file: File
  previewUrl?: string
  base64?: string
  isImage: boolean
  mediaType: string
  name: string
}

/** 工具调用状态（UI 展示用） */
export interface MiniChatToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'completed' | 'failed'
  result?: string
}

export interface MiniChatMessage {
  id: string
  role: ChatRole
  content: string
  /** 推理内容（思考模型的 reasoning_content，与普通聊天窗口一致） */
  reasoning?: string
  attachments?: ChatAttachment[]
  streaming?: boolean
  timestamp: number
  error?: string
  toolCalls?: MiniChatToolCall[]
}

/** 当前活动状态（AI 正在执行的操作） */
export interface MiniChatActivity {
  text: string
  toolName?: string
}

export interface UseAvatarMiniChatOptions {
  voiceContext: VoiceContextPayload | null
  /** 主窗口当前对话快照（首次发送时作为 LLM 初始历史，使迷你聊天延续主窗口上下文） */
  mainConversation?: MainConversationSnapshot | null
  onConversationComplete?: (
    userText: string,
    aiText: string,
    toolCallRecords?: VoiceToolCallRecord[],
  ) => void
  onError?: (msg: string) => void
}

export interface UseAvatarMiniChatResult {
  messages: MiniChatMessage[]
  streaming: boolean
  activity: MiniChatActivity | null
  /** 当前待审批的工具调用列表（UI 渲染审批卡片） */
  pendingApproval: PendingApprovalToolCall[]
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  abort: () => void
  clear: () => void
  /** 批准所有待审批工具 */
  approveAll: () => void
  /** 拒绝所有待审批工具 */
  rejectAll: () => void
  /** 批准指定工具调用 */
  approveTool: (toolCallId: string, requestId: string) => void
  /** 拒绝指定工具调用 */
  rejectTool: (toolCallId: string, requestId: string) => void
}

// ============================================
// 常量
// ============================================

/** 最大工具调用迭代次数 */
const MAX_ITERATIONS = 10

/** 生成唯一 id */
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 将附件 + 文本构建为 LLM 多模态 content
 *
 * 图片处理策略（与普通聊天窗口 useAttachmentManager.buildMessageContent 一致）：
 * - 使用 needsVisualAnalysis(text) 检测用户是否需要视觉分析
 * - 需要分析：压缩图片后正常发送 base64（cloudVisionMode 或本地视觉模型）
 * - 不需要分析：标记为 referenceOnly（MessageAdapter 转为文字提示），附带 localPath
 * - 本地直连模式 + 需要分析：标记为 referenceOnly，避免不支持 vision 的模型报 400 错误
 *
 * @param text 用户输入文本
 * @param attachments 附件列表
 * @param cloudVisionMode 是否云端视觉模式（llmConfig.cloudVisionMode）
 * @param savedImagePaths 已保存到工作区的图片路径列表（与图片附件一一对应）
 */
function buildMessageContent(
  text: string,
  attachments?: ChatAttachment[],
  cloudVisionMode?: boolean,
  savedImagePaths?: (string | undefined)[],
): string | MessageContentPart[] {
  if (!attachments || attachments.length === 0) return text

  // 检测用户是否需要视觉分析（与普通聊天窗口一致）
  const userWantsAnalysis = needsVisualAnalysis(text.trim())

  const parts: MessageContentPart[] = []
  if (text.trim()) parts.push({ type: 'text', text })

  let imageIndex = 0
  for (const att of attachments) {
    if (!att.base64) continue
    if (att.isImage) {
      const localPath = savedImagePaths?.[imageIndex]
      imageIndex++

      // 决定是否真正发送图片给模型分析
      // 1. 用户需要分析 + 云端视觉模式 → 正常发送
      // 2. 用户需要分析 + 本地直连 → 标记 referenceOnly（避免 400 错误）
      // 3. 用户不需要分析 → 标记 referenceOnly（仅作为上下文引用）
      const shouldAnalyze = userWantsAnalysis && cloudVisionMode

      if (shouldAnalyze) {
        // 正常发送 base64 图片，后端路由到视觉模型
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mediaType, data: att.base64 },
          localPath,
        })
      } else {
        // 标记为 referenceOnly，MessageAdapter 转为文字提示
        // 避免不支持 vision 的模型报 400 "unknown variant image_url" 错误
        parts.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mediaType, data: att.base64 },
          referenceOnly: true,
          localPath,
        })
      }
    } else {
      parts.push({ type: 'file', name: att.name, media_type: att.mediaType, data: att.base64 })
    }
  }

  if (parts.length === 0 && text.trim()) parts.push({ type: 'text', text })
  return parts.length > 0 ? parts : text
}

/**
 * 保存图片附件到工作区（与普通聊天窗口 useAttachmentManager 一致）
 *
 * 保存路径：{workspacePath}/{BRAND.dirName}/uploads/{timestamp}_{filename}
 * 保存失败不阻塞发送流程，仅记录日志。
 *
 * @param attachments 附件列表
 * @param workspacePath 工作区路径
 * @returns 已保存的图片路径列表（与图片附件一一对应，未保存的为 undefined）
 */
async function saveImagesToWorkspace(
  attachments: ChatAttachment[],
  workspacePath: string | null,
): Promise<(string | undefined)[]> {
  if (!workspacePath) return attachments.map(() => undefined)

  const uploadDir = `${workspacePath}/${BRAND.dirName}/uploads`
  try {
    const dirCreated = await api.file.ensureDir(uploadDir)
    if (!dirCreated) {
      logger.system.warn('[AvatarMiniChat] Failed to create upload directory:', uploadDir)
      return attachments.map(() => undefined)
    }
  } catch (err) {
    logger.system.error('[AvatarMiniChat] Failed to create upload directory:', err)
    return attachments.map(() => undefined)
  }

  const savedPaths: (string | undefined)[] = []
  for (const att of attachments) {
    if (!att.isImage || !att.base64) {
      savedPaths.push(undefined)
      continue
    }
    const timestamp = Date.now()
    const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${uploadDir}/${timestamp}_${safeName}`
    try {
      const saved = await api.file.writeBinary(filePath, att.base64)
      if (saved) {
        savedPaths.push(filePath)
      } else {
        logger.system.warn('[AvatarMiniChat] Failed to save uploaded image:', filePath)
        savedPaths.push(undefined)
      }
    } catch (err) {
      logger.system.error('[AvatarMiniChat] Failed to save uploaded image:', err)
      savedPaths.push(undefined)
    }
  }

  return savedPaths
}

// ============================================
// 主 hook
// ============================================

export function useAvatarMiniChat(
  options: UseAvatarMiniChatOptions,
): UseAvatarMiniChatResult {
  const { voiceContext, mainConversation, onConversationComplete, onError } = options

  const [messages, setMessages] = useState<MiniChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [activity, setActivity] = useState<MiniChatActivity | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalToolCall[]>([])

  // LLM 消息历史（整个对话的累积，包含所有轮次的 user/assistant/tool 消息）
  const llmMessagesRef = useRef<LLMMessage[]>([])
  // AbortController
  const abortControllerRef = useRef<AbortController | null>(null)
  // 当前用户消息原文（用于完成回调）
  const currentUserTextRef = useRef<string>('')
  // 所有轮次的文本拼接（用于完成回调保存历史）
  const allContentRef = useRef<string>('')
  // 所有工具调用记录（用于完成回调保存历史）
  const toolCallRecordsRef = useRef<VoiceToolCallRecord[]>([])
  // streaming ref（避免闭包旧值）
  const streamingRef = useRef(false)
  streamingRef.current = streaming

  // 订阅审批服务状态变更（与普通聊天窗口的 streamState.pendingApprovalToolCalls 一致）
  useEffect(() => {
    const unsubscribe = miniChatApprovalService.subscribe((pending) => {
      setPendingApproval(pending)
    })
    return () => {
      unsubscribe()
      // 组件卸载时清理所有待审批，避免 Promise 永远挂起
      miniChatApprovalService.clear()
    }
  }, [])

  // 卸载时清理
  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  /** 发送一条用户消息并流式获取 AI 回复（带工具调用循环） */
  const send = useCallback(
    async (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim()
      const hasAttachments = attachments && attachments.length > 0
      if (!trimmed && !hasAttachments) return
      if (streamingRef.current) return

      const llmConfig = voiceContext?.llmConfig as LLMConfig | null
      if (!llmConfig) {
        const msg = 'LLM 配置缺失，无法发送消息'
        logger.system.warn('[AvatarMiniChat] No LLM config')
        onError?.(msg)
        return
      }

      // 等待附件 base64 读取完成
      if (hasAttachments) {
        const pending = attachments!.filter((a) => !a.base64)
        if (pending.length > 0) {
          await Promise.race([
            Promise.all(
              pending.map(
                (a) =>
                  new Promise<void>((resolve) => {
                    const check = () => {
                      if (a.base64) resolve()
                      else setTimeout(check, 100)
                    }
                    check()
                  }),
              ),
            ),
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
          ])
        }
      }

      // 图片压缩（与普通聊天窗口一致，减少 token 消耗和请求体积）
      // 压缩失败时回退到原图（不影响发送流程）
      if (hasAttachments) {
        const compressedAttachments = await Promise.all(
          attachments!.map(async (att) => {
            if (!att.isImage || !att.base64) return att
            try {
              const compressed = await compressImageFromBase64(att.base64, att.mediaType, { quality: 0.8 })
              return {
                ...att,
                base64: compressed.base64,
                mediaType: compressed.mimeType,
              }
            } catch (err) {
              logger.system.warn('[AvatarMiniChat] Image compression failed, using original:', err)
              return att
            }
          }),
        )
        attachments = compressedAttachments
      }

      // 保存图片到工作区（与普通聊天窗口 useAttachmentManager 一致）
      // 保存路径：{workspacePath}/{BRAND.dirName}/uploads/{timestamp}_{filename}
      // 保存失败不阻塞发送流程
      let savedImagePaths: (string | undefined)[] | undefined
      if (hasAttachments) {
        const imageAttachments = attachments!.filter((a) => a.isImage)
        if (imageAttachments.length > 0) {
          savedImagePaths = await saveImagesToWorkspace(
            imageAttachments,
            voiceContext?.workspacePath || null,
          )
        }
      }

      // 构建用户消息
      const userMsg: MiniChatMessage = {
        id: genId('u'),
        role: 'user',
        content: trimmed,
        attachments: hasAttachments ? attachments : undefined,
        timestamp: Date.now(),
      }

      currentUserTextRef.current = trimmed || (hasAttachments ? '[附件]' : '')
      allContentRef.current = ''
      toolCallRecordsRef.current = []

      // 构建当前用户消息的 LLM content
      // 与普通聊天窗口一致：使用 needsVisualAnalysis 检测是否需要视觉分析
      const cloudVisionMode = !!(llmConfig as { cloudVisionMode?: boolean })?.cloudVisionMode
      const currentUserContent = buildMessageContent(trimmed, attachments, cloudVisionMode, savedImagePaths)

      // 首次发送时注入主窗口对话历史：迷你会话延续主窗口上下文（clear 后重新注入最新快照）
      if (llmMessagesRef.current.length === 0 && mainConversation?.messages?.length) {
        const mainHistory: LLMMessage[] = mainConversation.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
        if (mainHistory.length > 0) {
          llmMessagesRef.current.push(...mainHistory)
          logger.system.info(
            `[AvatarMiniChat] Injected ${mainHistory.length} main conversation messages as context`,
          )
        }
      }

      llmMessagesRef.current.push({ role: 'user', content: currentUserContent })

      // 本地直连模式下发送图片：提示用户当前模型可能不支持图片识别
      const hasImage = attachments?.some((a) => a.isImage)
      if (hasImage && !cloudVisionMode) {
        logger.system.warn('[AvatarMiniChat] 当前模型可能不支持图片识别（本地直连模式），图片已转为引用模式')
        // 在用户消息后追加系统提示（不阻止发送，AI 会基于文字描述回复）
        onError?.('当前模型可能不支持图片识别，图片已转为引用模式。如需 AI 分析图片内容，请切换到支持视觉的模型或使用云端视觉模式。')
      }

      setMessages((prev) => [...prev, userMsg])
      setStreaming(true)
      setActivity({ text: '思考中...' })

      // 系统提示词：复用普通聊天的 buildAgentSystemPrompt，确保能力完全一致
      // （集成项目规则、记忆、知识库、技能、项目摘要、场景上下文等）
      const { prompt: systemPrompt } = await buildAgentSystemPrompt(
        'agent',
        voiceContext?.workspacePath || null,
        { userMessage: trimmed },
      )

      // 创建 AbortController
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // 确保工具系统已初始化
      await ensureVoiceToolsInitialized()
      const tools = toolManager.getAllToolDefinitions()

      try {
        // ============================================================
        // 工具调用循环：每轮迭代创建独立的 assistant 消息
        // ============================================================
        let iteration = 0
        let lastError: string | undefined

        while (iteration < MAX_ITERATIONS) {
          if (abortController.signal.aborted) {
            lastError = 'Aborted'
            break
          }

          iteration++
          const requestId = `mini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

          logger.system.info(`[AvatarMiniChat] Iteration ${iteration}, messages=${llmMessagesRef.current.length}, tools=${tools.length}`)

          // 为本轮迭代创建 assistant 消息
          const assistantId = genId('a')
          const assistantMsg: MiniChatMessage = {
            id: assistantId,
            role: 'assistant',
            content: '',
            streaming: true,
            timestamp: Date.now(),
          }
          setMessages((prev) => [...prev, assistantMsg])

          // 当前轮次的流式文本累积（每轮重置）
          let iterationContent = ''
          // 当前轮次的推理内容累积（每轮重置，与普通聊天窗口一致）
          let iterationReasoning = ''

          // 获取授权方式（传给工具审批门禁检查）
          const authorizationMode = voiceContext?.authorizationMode as AuthorizationMode | undefined

          // 调用 LLM（带工具支持）
          // timeout: 0 表示不限制超时（文字聊天允许长回复）
          // abortSignal: 传入 abort 信号，用户点击停止时能立即取消主进程请求
          // onReasoningChunk: 推理内容流式回调（思考模型如 DeepSeek-R1 的思考过程）
          const result = await callLLMWithTools(
            llmConfig,
            llmMessagesRef.current,
            tools,
            systemPrompt,
            requestId,
            // onTextChunk：流式文本回调
            (chunk: string) => {
              iterationContent += chunk
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: iterationContent } : m,
                ),
              )
            },
            {
              timeout: 0,
              abortSignal: abortController.signal,
              // 推理内容流式回调：与普通聊天窗口一致，实时显示 AI 的思考过程
              onReasoningChunk: (chunk: string) => {
                iterationReasoning += chunk
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, reasoning: iterationReasoning } : m,
                  ),
                )
              },
            },
          )

          // LLM 返回错误
          if (result.error) {
            logger.system.warn(`[AvatarMiniChat] LLM error on iteration ${iteration}: ${result.error}`)
            lastError = result.error
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, error: result.error }
                  : m,
              ),
            )
            break
          }

          // 更新最终推理内容（done 事件可能携带完整 reasoning）
          if (result.reasoning && result.reasoning.length > iterationReasoning.length) {
            iterationReasoning = result.reasoning
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, reasoning: iterationReasoning } : m,
              ),
            )
          }

          // 累积本轮文本到 allContent
          if (result.content.trim()) {
            allContentRef.current = allContentRef.current
              ? allContentRef.current + '\n' + result.content
              : result.content
          }

          // 没有工具调用 → 循环结束，本轮 assistant 消息就是最终回复
          if (result.toolCalls.length === 0) {
            logger.system.info(`[AvatarMiniChat] Loop complete after ${iteration} iterations`)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m,
              ),
            )
            break
          }

          // ============================================================
          // 有工具调用：更新 assistant 消息（添加工具调用状态），执行工具
          // ============================================================

          // 1. 把 LLM 返回的工具调用状态添加到 assistant 消息
          const toolCallStates: MiniChatToolCall[] = result.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            status: 'running' as const,
          }))

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, streaming: false, toolCalls: toolCallStates }
                : m,
            ),
          )

          // 2. 构建 assistant 消息（含 tool_calls + reasoning）追加到 LLM 消息历史
          // 与 AgentSubLoop 一致：思考模型的 reasoning_content 也需要传回给 LLM
          const assistantLlmMsg: LLMMessage = {
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          }
          if (result.reasoning) {
            ;(assistantLlmMsg as LLMMessage & { reasoning_content?: string }).reasoning_content = result.reasoning
          }
          llmMessagesRef.current.push(assistantLlmMsg)

          logger.system.info(
            `[AvatarMiniChat] Executing ${result.toolCalls.length} tool calls: ${result.toolCalls.map((tc) => tc.name).join(', ')}`,
          )

          // 3. 并行执行工具调用（传入 authorizationMode 用于审批门禁检查）
          setActivity({
            text: `正在执行 ${result.toolCalls.map((tc) => tc.name).join(', ')}`,
            toolName: result.toolCalls[0]?.name,
          })

          const toolPromises = result.toolCalls.map((tc) =>
            executeMiniChatToolCall(tc, voiceContext?.workspacePath || null, requestId, authorizationMode),
          )
          const toolResults = await Promise.all(toolPromises)

          // 4. 逐个更新工具调用状态 + 收集记录
          result.toolCalls.forEach((tc, idx) => {
            const toolResult = toolResults[idx]
            const success = !toolResult.content.startsWith('错误:')
            const outputSummary = toolResult.content.slice(0, 200)

            // 记录工具调用（用于保存到聊天历史）
            toolCallRecordsRef.current.push({
              id: tc.id,
              name: tc.name,
              args: tc.arguments,
              success,
              resultSummary: outputSummary,
            })

            // 更新 UI 中的工具调用状态
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId || !m.toolCalls) return m
                return {
                  ...m,
                  toolCalls: m.toolCalls.map((tcs) =>
                    tcs.id === tc.id
                      ? {
                          ...tcs,
                          status: success ? ('completed' as const) : ('failed' as const),
                          result: outputSummary,
                        }
                      : tcs,
                  ),
                }
              }),
            )
          })

          // 5. 更新活动状态
          setActivity({
            text: `已完成工具执行，继续思考...`,
          })

          // 6. 将工具结果添加到 LLM 消息历史
          for (const toolResult of toolResults) {
            llmMessagesRef.current.push(toolResult)
          }

          // 继续下一轮 LLM 调用（工具结果已反馈，LLM 将基于结果生成回复）
        }

        // ============================================================
        // 循环结束（正常完成 / 达到最大迭代 / 错误 / 中止）
        // ============================================================
        setStreaming(false)
        setActivity(null)

        if (abortController.signal.aborted) {
          logger.system.info('[AvatarMiniChat] Aborted by user')
          return
        }

        if (iteration >= MAX_ITERATIONS && !lastError) {
          lastError = `达到最大迭代次数 (${MAX_ITERATIONS})`
          logger.system.warn(`[AvatarMiniChat] ${lastError}`)
        }

        // 完成回调（保存到聊天历史）
        if (allContentRef.current && !lastError) {
          onConversationComplete?.(
            currentUserTextRef.current,
            allContentRef.current,
            toolCallRecordsRef.current.length > 0 ? toolCallRecordsRef.current : undefined,
          )
        }

        if (lastError) {
          onError?.(lastError)
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.system.error('[AvatarMiniChat] Tool loop failed:', err)
        setStreaming(false)
        setActivity(null)
        onError?.(errMsg)
      } finally {
        abortControllerRef.current = null
      }
    },
    [voiceContext, onConversationComplete, onError],
  )

  /** 中止当前生成 */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      // 直接通知主进程取消 LLM 请求（双保险：abort 信号 + 直接调用）
      try { api.llm.abort() } catch { /* noop */ }
      // 清理所有待审批工具（拒绝，避免 Promise 永远挂起）
      miniChatApprovalService.clear()
      setStreaming(false)
      setActivity(null)

      // 标记所有 streaming 的 assistant 消息为已完成
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming
            ? { ...m, streaming: false, content: m.content || '（已停止）' }
            : m,
        ),
      )
    }
  }, [])

  /** 清空消息列表 */
  const clear = useCallback(() => {
    if (streamingRef.current) {
      abortControllerRef.current?.abort()
      try { api.llm.abort() } catch { /* noop */ }
    }
    // 清理所有待审批工具（拒绝，避免 Promise 永远挂起）
    miniChatApprovalService.clear()
    llmMessagesRef.current = []
    setMessages([])
    setStreaming(false)
    setActivity(null)
    currentUserTextRef.current = ''
    allContentRef.current = ''
    toolCallRecordsRef.current = []
  }, [])

  /** 批准所有待审批工具 */
  const approveAll = useCallback(() => {
    miniChatApprovalService.approveAll()
  }, [])

  /** 拒绝所有待审批工具 */
  const rejectAll = useCallback(() => {
    miniChatApprovalService.rejectAll()
  }, [])

  /** 批准指定工具调用 */
  const approveTool = useCallback((toolCallId: string, requestId: string) => {
    miniChatApprovalService.approve(toolCallId, requestId)
  }, [])

  /** 拒绝指定工具调用 */
  const rejectTool = useCallback((toolCallId: string, requestId: string) => {
    miniChatApprovalService.reject(toolCallId, requestId)
  }, [])

  return {
    messages,
    streaming,
    activity,
    pendingApproval,
    send,
    abort,
    clear,
    approveAll,
    rejectAll,
    approveTool,
    rejectTool,
  }
}

// ============================================
// 附件辅助函数
// ============================================

/** 读取文件为 base64 附件 */
export function readFileAsAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      const isImage = file.type.startsWith('image/')
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined

      resolve({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl,
        base64,
        isImage,
        mediaType: file.type || 'application/octet-stream',
        name: file.name,
      })
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
