/**
 * 语音对话 LLM 工具调用循环
 *
 * 让语音对话具备与普通文字对话完全相同的 AI 能力：
 * - 支持工具调用（文件读写、终端、搜索等内置工具）
 * - 支持插件（MCP 工具等）
 * - 工具执行结果自动反馈到 LLM 继续生成
 * - 危险工具需要用户在设置中开启自动批准才能在语音模式中执行
 *
 * 架构说明：
 * - 云端模式和本地模式都走客户端主进程的 api.llm.send()
 * - 云端模式 LLM 配置中包含 cloudMode=true/serverUrl/accessToken，
 *   主进程会自动路由到后端 LLM 代理（支持工具调用）
 * - 本地模式 LLM 配置中包含 apiKey/baseUrl，直连用户配置的模型
 *
 * 参考：AgentSubLoop.ts 的工具调用模式
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import {
  toolManager,
  initializeToolProviders,
  setToolLoadingContext,
  initializeTools,
} from '@intelligence/toolkit'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getActiveCustomAgent, getAgentToolLoadingFields } from '@renderer-configuration/customAgentTools'
import { isExternalAgentToolsExposed } from '@intelligence/toolkit/externalAgentToolsGate'
import { isSceneToolsIntentFromMessages } from '@intelligence/utils/sceneToolsIntent'
import { useStore } from '@store'
import { getToolApprovalType, getToolDisplayName } from '@configuration/toolDefinitions'
import { requiresApprovalGate } from '@intelligence/engine/toolOrchestrator'
import { truncateToolResult } from '@utils/partialJson'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { miniChatApprovalService, type AuthorizationMode } from './miniChatApprovalService'
import type {
  LLMConfig,
  LLMMessage,
  ToolDefinition,
  ToolExecutionContext,
} from '@intelligence/providerTypes'

/** 默认最大工具调用迭代次数 */
const DEFAULT_MAX_ITERATIONS = 10
/** 单次 LLM 请求超时（ms） */
const VOICE_LLM_TIMEOUT = 60000

/**
 * 工具名称 → 中文动作描述映射
 *
 * 当 LLM 发起 tool_calls 但没有附带文字时（DeepSeek 等模型常见行为），
 * 使用此映射生成默认预告，让用户知道 AI 正在做什么。
 */
const TOOL_ACTION_DESCRIPTIONS: Record<string, string> = {
  // 写操作
  write_file: '正在创建文件',
  edit_file: '正在编辑文件',
  replace_file_content: '正在修改文件内容',
  create_file_or_folder: '正在创建文件',
  delete_file_or_folder: '正在删除文件',
  run_command: '正在执行命令',
  // 读操作
  read_file: '正在读取文件',
  read_multiple_files: '正在读取文件',
  list_directory: '正在查看目录',
  get_dir_tree: '正在查看目录结构',
  get_file_info: '正在获取文件信息',
  // 搜索操作
  search_files: '正在搜索文件',
  grep_search: '正在搜索内容',
  codebase_search: '正在搜索代码',
  find_references: '正在查找引用',
  go_to_definition: '正在查找定义',
  get_hover_info: '正在获取信息',
  get_document_symbols: '正在分析文档',
}

/**
 * 根据工具名称生成默认预告文字
 *
 * 1. 精确匹配 TOOL_ACTION_DESCRIPTIONS
 * 2. 模糊匹配（包含关键词）
 * 3. 兜底返回通用预告
 */
function generateDefaultAnnouncement(toolNames: string[]): string {
  const descriptions = toolNames.map(name => {
    // 精确匹配
    if (TOOL_ACTION_DESCRIPTIONS[name]) {
      return TOOL_ACTION_DESCRIPTIONS[name]
    }
    // 模糊匹配
    const lower = name.toLowerCase()
    if (lower.includes('write') || lower.includes('create')) return '正在创建文件'
    if (lower.includes('edit') || lower.includes('update')) return '正在编辑文件'
    if (lower.includes('read') || lower.includes('get')) return '正在读取信息'
    if (lower.includes('search') || lower.includes('find') || lower.includes('grep')) return '正在搜索'
    if (lower.includes('run') || lower.includes('execute') || lower.includes('command') || lower.includes('terminal')) return '正在执行命令'
    if (lower.includes('delete') || lower.includes('remove')) return '正在删除文件'
    if (lower.includes('list') || lower.includes('tree')) return '正在查看目录'
    // 兜底
    return '正在为您处理'
  })

  // 去重
  const unique = [...new Set(descriptions)]
  if (unique.length === 1) {
    return `好的，${unique[0]}`
  }
  return `好的，我正在处理：${unique.join('、')}`
}

/** LLM 返回的工具调用（已解析参数） */
export interface CollectedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface VoiceToolLoopOptions {
  /** LLM 配置（云端模式含 cloudMode/serverUrl/accessToken，本地模式含 apiKey/baseUrl） */
  config: LLMConfig
  /** 对话消息（会被本函数 mutate：追加 assistant/tool 消息） */
  messages: LLMMessage[]
  /** 系统提示词 */
  systemPrompt: string
  /** 工作区路径（工具执行上下文） */
  workspacePath: string | null
  /** 最大迭代次数 */
  maxIterations?: number
  /** 流式文本回调（每收到一个 text chunk 触发） */
  onTextChunk?: (text: string) => void
  /**
   * 工具调用前的语音预告回调
   *
   * 触发时机：LLM 返回了工具调用，且同时返回了文字内容（如"好的，我现在开始为您创建网站"）。
   * 外部可以立即 TTS 播放这段文字，让用户知道 AI 打算做什么，
   * 而不必等到所有工具执行完毕。
   *
   * @param text LLM 在工具调用前生成的文字（已去除空内容）
   * @param toolNames 即将执行的工具名称列表
   */
  onToolAnnouncement?: (text: string, toolNames: string[]) => void
  /**
   * 单个工具开始执行回调
   * @param toolName 工具名称
   * @param args 工具参数（可用于 UI 展示）
   */
  onToolStart?: (toolName: string, args: Record<string, unknown>) => void
  /**
   * 单个工具执行完成回调
   * @param toolName 工具名称
   * @param success 是否成功
   * @param output 工具输出摘要
   */
  onToolComplete?: (toolName: string, success: boolean, output: string) => void
  /** 中断信号 */
  abortSignal?: AbortSignal
}

/** 工具调用记录（用于保存到聊天历史，像普通对话一样显示工具调用过程） */
export interface VoiceToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  success: boolean
  resultSummary: string
}

export interface VoiceToolLoopResult {
  /** 最终文本内容（最后一次 LLM 回复，用于最终 TTS） */
  content: string
  /** 所有 iteration 的文字拼接（用于历史保存，包含预告 + 最终总结） */
  allContent: string
  /** 工具调用前的预告文字（第一次有文字+工具调用的 iteration 的 content） */
  announcementText: string
  /** 总工具调用次数 */
  toolCallsCount: number
  /** 工具调用记录（用于保存到聊天历史） */
  toolCallRecords: VoiceToolCallRecord[]
  /** 错误信息（如果有） */
  error?: string
}

/** 工具初始化标志（与 AgentSubLoop 隔离，避免互相影响） */
let voiceToolsInitialized = false

/**
 * 确保工具系统已初始化
 *
 * 加载内置工具 + 插件工具，与普通对话使用相同的工具集
 */
export async function ensureVoiceToolsInitialized(): Promise<void> {
  if (voiceToolsInitialized) return

  logger.agent.info('[VoiceToolLoop] Initializing tools for voice mode...')

  try {
    initializeToolProviders()
    // 确保场景工具 AI 桥接已注册（幂等注册，语音路径同样需要 scene_tools_* 可见）
    await import('@/renderer/components/scene-tools/agentBridge').then(({ registerSceneToolsAgent }) => registerSceneToolsAgent())
    await initializeTools()
    voiceToolsInitialized = true

    const toolCount = toolManager.getAllToolDefinitions().length
    logger.agent.info(`[VoiceToolLoop] Tools initialized: ${toolCount} tools available`)
  } catch (err) {
    logger.agent.error('[VoiceToolLoop] Failed to initialize tools:', err)
    // 不 throw，允许在无工具模式下继续（LLM 仍可正常对话）
    voiceToolsInitialized = true
  }
}

/**
 * 每次执行时刷新工具加载上下文（场景/智能体可能在会话间切换）
 * 确保语音路径始终使用最新的智能体工具白名单
 */
function refreshVoiceToolLoadingContext(sceneToolsEnabled = false): void {
  const activeScenarioId = useStore.getState().activeScenarioId
  const activeScenario = scenarioRegistry.getActive()
  const scenarioToolPacks = activeScenario?.capabilities?.toolPacks
  const scenarioTools = activeScenario?.capabilities?.tools || []

  // 自定义智能体工具白名单：激活了智能体时限制其可用工具
  const activeAgent = getActiveCustomAgent()
  const agentToolFields = getAgentToolLoadingFields(activeAgent)

  setToolLoadingContext({
    mode: 'agent',
    templateId: useStore.getState().promptTemplateId,
    scenarioId: activeScenarioId,
    scenarioToolPacks,
    scenarioTools,
    // 场景工具按需暴露（致命问题 #4）：语音对话同样仅在场景数据意图时可见
    sceneToolsEnabled,
    externalAgentEnabled: isExternalAgentToolsExposed(),
    ...agentToolFields,
  })
}

/**
 * 调用 LLM 的可选参数
 */
export interface CallLLMOptions {
  /** 单次 LLM 请求超时（ms），默认 60000（语音模式），文字聊天可传 0 表示不限制 */
  timeout?: number
  /** 中断信号，触发时通知主进程取消请求 */
  abortSignal?: AbortSignal
  /** 推理内容流式回调（思考模型如 DeepSeek-R1 的 reasoning_content） */
  onReasoningChunk?: (text: string) => void
}

/**
 * 调用 LLM 的返回结果
 */
export interface CallLLMResult {
  /** 文本内容 */
  content: string
  /** 推理内容（思考模型的 reasoning_content，用于显示 AI 的思考过程） */
  reasoning: string
  /** 工具调用列表 */
  toolCalls: CollectedToolCall[]
  /** 错误信息（如果有） */
  error?: string
}

/**
 * 调用 LLM（带工具支持）
 *
 * 流式收集文本、推理内容和工具调用，返回完整结果
 *
 * 导出供 useAvatarMiniChat 复用（迷你聊天窗需要自己控制工具循环，
 * 为每轮迭代创建独立的 assistant 消息，与主窗口体验一致）
 *
 * @param options.timeout 单次请求超时（ms），传 0 表示不限制（文字聊天场景）
 * @param options.abortSignal 中断信号，触发时调用 api.llm.abort() 通知主进程取消
 * @param options.onReasoningChunk 推理内容流式回调（思考模型的思考过程）
 */
export function callLLMWithTools(
  config: LLMConfig,
  messages: LLMMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  requestId: string,
  onTextChunk?: (text: string) => void,
  options?: CallLLMOptions,
): Promise<CallLLMResult> {
  const timeoutMs = options?.timeout ?? VOICE_LLM_TIMEOUT
  const abortSignal = options?.abortSignal
  const onReasoningChunk = options?.onReasoningChunk

  return new Promise((resolve) => {
    let fullContent = ''
    let fullReasoning = ''
    const toolCalls: CollectedToolCall[] = []
    const streamingToolCalls = new Map<string, { id: string; name: string; argsString: string }>()
    let settled = false
    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      unsubStream()
      unsubError()
      unsubDone()
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
    }

    const doResolve = (error?: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ content: fullContent, reasoning: fullReasoning, toolCalls, error })
    }

    /** abort 信号回调：通知主进程取消 + resolve */
    const onAbort = () => {
      if (settled) return
      try { api.llm.abort(requestId) } catch { /* noop */ }
      doResolve('Aborted')
    }

    // 订阅流式响应
    const unsubStream = api.llm.onStream(requestId, (data) => {
      switch (data.type) {
        case 'text':
          if (data.content) {
            fullContent += data.content
            onTextChunk?.(data.content)
          }
          break

        case 'reasoning':
          // 思考模型的推理内容（如 DeepSeek-R1 的 reasoning_content）
          // 与普通聊天窗口一致，支持显示 AI 的思考过程
          if (data.content) {
            fullReasoning += data.content
            onReasoningChunk?.(data.content)
          }
          break

        case 'tool_call_start': {
          const toolId = data.id || ''
          const toolName = data.name || ''
          if (toolId) {
            streamingToolCalls.set(toolId, { id: toolId, name: toolName, argsString: '' })
          }
          break
        }

        case 'tool_call_delta': {
          const tcId = data.id
          if (tcId) {
            const tc = streamingToolCalls.get(tcId)
            if (tc && data.argumentsDelta) {
              tc.argsString += data.argumentsDelta
            }
            if (tc && data.name && data.name !== tc.name) {
              tc.name = data.name
            }
          }
          break
        }

        case 'tool_call_delta_end': {
          const tcId = data.id
          if (tcId) {
            const tc = streamingToolCalls.get(tcId)
            if (tc) {
              const args = parseToolArgs(tc.argsString)
              upsertToolCall(toolCalls, tc.id, tc.name, args)
              streamingToolCalls.delete(tcId)
            }
          }
          break
        }

        case 'tool_call_available': {
          const tcId = data.id || ''
          const toolName = data.name || ''
          const args = (data.arguments || {}) as Record<string, unknown>
          if (tcId) streamingToolCalls.delete(tcId)
          upsertToolCall(toolCalls, tcId, toolName, args)
          break
        }
      }
    })

    const unsubError = api.llm.onError(requestId, (err) => {
      if (settled) return
      doResolve(err.message || 'LLM error')
    })

    const unsubDone = api.llm.onDone(requestId, (data) => {
      if (settled) return
      // done 事件可能携带完整的 reasoning（部分模型在 done 时才返回完整推理内容）
      if (typeof data?.reasoning === 'string' && data.reasoning.length >= fullReasoning.length) {
        fullReasoning = data.reasoning
      }
      doResolve()
    })

    // 注册 abort 信号监听
    if (abortSignal) {
      if (abortSignal.aborted) {
        // 已中止，直接返回
        doResolve('Aborted')
        return
      }
      abortSignal.addEventListener('abort', onAbort)
    }

    // 构建发送参数
    const sendParams: Record<string, unknown> = {
      config,
      messages,
      systemPrompt,
      requestId,
    }
    if (tools.length > 0) {
      sendParams.tools = tools
    }

    api.llm.send(sendParams as any).catch((err) => {
      if (settled) return
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.agent.error(`[VoiceToolLoop] api.llm.send failed: ${errMsg}`)
      doResolve(errMsg)
    })

    // 超时保护（timeoutMs <= 0 表示不限制，适用于文字聊天长回复场景）
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return
        doResolve('LLM 请求超时')
      }, timeoutMs)
    }
  })
}

/**
 * 执行单个工具调用
 *
 * 语音模式下的审批策略：
 * - none / interaction 类型：直接执行
 * - terminal / dangerous 类型：检查 autoApprove 设置
 *   - 已开启自动批准 → 执行
 *   - 未开启 → 跳过并返回提示消息（不在语音模式中弹审批框）
 */
export async function executeVoiceToolCall(
  toolCall: CollectedToolCall,
  workspacePath: string | null,
  requestId: string,
): Promise<{ role: 'tool'; content: string; tool_call_id: string; name: string }> {
  const context: ToolExecutionContext = {
    workspacePath,
    chatMode: 'agent',
    requestId,
    skipMainApproval: true,
  }

  // 检查是否需要审批（统一复用 requiresApprovalGate，确保授权方式选择对语音模式同样生效）
  const approvalType = getToolApprovalType(toolCall.name)
  if (approvalType === 'terminal' || approvalType === 'dangerous') {
    const needsApproval = requiresApprovalGate(toolCall, 'agent')
    if (needsApproval) {
      logger.agent.info(`[VoiceToolLoop] Tool ${toolCall.name} skipped (requires approval in voice mode)`)
      return {
        role: 'tool',
        content: '此操作需要用户确认，请在文字对话模式中执行，或在输入框下方切换为更宽松的授权方式。',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    }
  }

  return executeToolCallInternal(toolCall, context)
}

/**
 * 执行单个工具调用（迷你聊天模式）
 *
 * 与普通聊天窗口（AgentSubLoop）的审批流程完全一致：
 * - 检查 requiresApprovalGate（通过 miniChatApprovalService.checkApprovalNeeded）
 * - 需要审批时，通过 miniChatApprovalService 等待用户在迷你聊天窗口中批准/拒绝
 * - 用户批准 → 执行工具
 * - 用户拒绝 → 返回"用户拒绝了此操作"
 *
 * 与语音模式的区别：
 * - skipMainApproval: false → 走主窗口正常审批流程（与普通聊天窗口一致）
 * - 不跳过 terminal/dangerous 工具，由授权方式选择决定是否需要审批
 *
 * 迷你聊天窗口底部有授权方式选择栏，用户可选择：
 * - 每步确认（every-step）：危险操作弹审批框
 * - 仅危险操作（dangerous-only）：只有危险操作弹审批框
 * - 从不确认（never）：所有操作自动执行
 *
 * @param toolCall 工具调用信息
 * @param workspacePath 工作区路径
 * @param requestId 请求 ID
 * @param authorizationMode 授权方式（来自 voiceContext，传给审批门禁检查）
 */
export async function executeMiniChatToolCall(
  toolCall: CollectedToolCall,
  workspacePath: string | null,
  requestId: string,
  authorizationMode?: AuthorizationMode,
): Promise<{ role: 'tool'; content: string; tool_call_id: string; name: string }> {
  // 审批检查：与 AgentSubLoop.executeToolCall 逻辑一致
  // 仅 terminal / dangerous 类型需要事前审批；
  // interaction 类型采用事后确认模式（像 VSCode/Trae），工具直接执行
  const approvalType = getToolApprovalType(toolCall.name)
  if (approvalType === 'terminal' || approvalType === 'dangerous') {
    const needsApproval = miniChatApprovalService.checkApprovalNeeded(
      toolCall,
      authorizationMode,
      'agent',
    )

    if (needsApproval) {
      const toolDisplayName = getToolDisplayName(toolCall.name)
      logger.agent.info(
        `[MiniChatToolLoop] Tool needs approval: ${toolDisplayName} (${toolCall.name}, id=${toolCall.id}), ` +
          `requestId=${requestId}, authorizationMode=${authorizationMode}`,
      )

      // 等待用户在迷你聊天窗口中审批
      const approved = await miniChatApprovalService.waitForApproval(
        toolCall.id,
        requestId,
        {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      )

      if (!approved) {
        logger.agent.info(
          `[MiniChatToolLoop] Tool ${toolCall.name} rejected by user`,
        )
        return {
          role: 'tool',
          content: '用户拒绝了此操作',
          tool_call_id: toolCall.id,
          name: toolCall.name,
        }
      }

      logger.agent.info(
        `[MiniChatToolLoop] Tool ${toolCall.name} approved by user`,
      )
    }
  }

  const context: ToolExecutionContext = {
    workspacePath,
    chatMode: 'agent',
    requestId,
    skipMainApproval: false, // 走正常审批流程，与普通聊天窗口一致
  }

  return executeToolCallInternal(toolCall, context)
}

/**
 * 工具调用执行的内部实现（语音/迷你聊天共用）
 *
 * 与普通聊天窗口（toolOrchestrator.ts）一致：
 * - 工具结果使用 truncateToolResult 截断，防止过长的工具输出导致上下文溢出
 * - 截断配置来自 getAgentConfig().maxToolResultChars
 */
async function executeToolCallInternal(
  toolCall: CollectedToolCall,
  context: ToolExecutionContext,
): Promise<{ role: 'tool'; content: string; tool_call_id: string; name: string }> {
  try {
    const result = await toolManager.execute(toolCall.name, toolCall.arguments, context)

    if (result.success) {
      const rawOutput = typeof result.result === 'string' ? result.result : JSON.stringify(result.result)
      // 工具结果截断（与普通聊天窗口一致，防止过长输出导致 LLM 上下文溢出）
      const agentConfig = getAgentConfig()
      const output = truncateToolResult(rawOutput, toolCall.name, agentConfig.maxToolResultChars)

      if (output.length < rawOutput.length) {
        logger.agent.info(
          `[VoiceToolLoop] Truncated ${toolCall.name} result: ${rawOutput.length} -> ${output.length} chars`,
        )
      }

      logger.agent.info(`[VoiceToolLoop] Tool ${toolCall.name} executed successfully`)
      return {
        role: 'tool',
        content: output || '工具执行成功（无输出）',
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    } else {
      const errorOutput = result.error || '工具执行失败'
      logger.agent.warn(`[VoiceToolLoop] Tool ${toolCall.name} failed: ${errorOutput}`)
      return {
        role: 'tool',
        content: `错误: ${errorOutput}`,
        tool_call_id: toolCall.id,
        name: toolCall.name,
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.agent.error(`[VoiceToolLoop] Tool ${toolCall.name} exception: ${errorMsg}`)
    return {
      role: 'tool',
      content: `错误: ${errorMsg}`,
      tool_call_id: toolCall.id,
      name: toolCall.name,
    }
  }
}

/**
 * 语音对话 LLM 工具调用循环
 *
 * 流程：
 * 1. 调用 LLM（带工具定义）
 * 2. 如果 LLM 返回工具调用 → 执行工具 → 结果反馈到 LLM → 继续循环
 * 3. 如果 LLM 没有工具调用 → 返回最终文本（用于 TTS）
 * 4. 达到最大迭代次数 → 返回当前文本
 *
 * @param options 配置选项
 * @returns 最终文本内容和工具调用统计
 */
export async function runVoiceToolLoop(options: VoiceToolLoopOptions): Promise<VoiceToolLoopResult> {
  const {
    config,
    messages,
    systemPrompt,
    workspacePath,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    onTextChunk,
    onToolAnnouncement,
    onToolStart,
    onToolComplete,
    abortSignal,
  } = options

  // 确保工具系统已初始化（失败也不阻塞，只是没有工具可用）
  await ensureVoiceToolsInitialized()
  // 每次执行刷新工具加载上下文（智能体可能已切换）
  refreshVoiceToolLoadingContext(isSceneToolsIntentFromMessages(messages))

  // 获取可用工具列表（与普通对话完全相同）
  const tools = toolManager.getAllToolDefinitions()
  if (tools.length === 0) {
    logger.agent.warn('[VoiceToolLoop] No tools available, LLM will respond without tool support')
  } else {
    logger.agent.info(
      `[VoiceToolLoop] Available tools: ${tools.length} (${tools.slice(0, 5).map(t => t.name).join(', ')}${tools.length > 5 ? '...' : ''})`,
    )
  }

  let totalToolCallsCount = 0
  let iteration = 0
  let lastContent = ''
  /** 所有 iteration 的文字拼接（用于历史保存） */
  let allContent = ''
  /** 第一次预告的文字 */
  let announcementText = ''
  /** 所有工具调用记录 */
  const toolCallRecords: VoiceToolCallRecord[] = []

  while (iteration < maxIterations) {
    if (abortSignal?.aborted) {
      return { content: lastContent, allContent, announcementText, toolCallsCount: totalToolCallsCount, toolCallRecords, error: 'Aborted' }
    }

    iteration++
    const requestId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    logger.agent.info(
      `[VoiceToolLoop] Iteration ${iteration}, messages=${messages.length}, tools=${tools.length}`,
    )

    const result = await callLLMWithTools(
      config,
      messages,
      tools,
      systemPrompt,
      requestId,
      onTextChunk,
      { abortSignal },
    )

    if (result.error) {
      logger.agent.warn(`[VoiceToolLoop] LLM error on iteration ${iteration}: ${result.error}`)
      return {
        content: result.content || lastContent,
        allContent,
        announcementText,
        toolCallsCount: totalToolCallsCount,
        toolCallRecords,
        error: result.error,
      }
    }

    lastContent = result.content
    // 累积所有 iteration 的文字
    if (result.content.trim()) {
      allContent = allContent ? allContent + '\n' + result.content : result.content
    }

    // 没有工具调用 → 循环结束，返回最终文本
    if (result.toolCalls.length === 0) {
      logger.agent.info(`[VoiceToolLoop] Loop complete after ${iteration} iterations, tool calls: ${totalToolCallsCount}`)
      return { content: result.content, allContent, announcementText, toolCallsCount: totalToolCallsCount, toolCallRecords }
    }

    totalToolCallsCount += result.toolCalls.length

    // ============================================================
    // 工具调用前的语音预告
    // ============================================================
    // 当 LLM 返回工具调用时，立即触发 onToolAnnouncement 回调，
    // 让外部 TTS 播放预告文字，用户就能实时听到 AI 的意图。
    //
    // 关键：即使 LLM 没有附带文字（DeepSeek 等模型常见行为），
    // 也会根据工具名称生成默认预告（如"好的，正在创建文件"），
    // 确保用户在任何情况下都能听到 AI 的反馈。
    const llmText = result.content.trim()
    const toolNames = result.toolCalls.map(tc => tc.name)
    // 优先使用 LLM 附带的文字；如果没有，根据工具名生成默认预告
    const currentAnnouncementText = llmText || generateDefaultAnnouncement(toolNames)

    // 记录第一次预告的文字（用于避免最终 TTS 重复播放）
    if (currentAnnouncementText && !announcementText) {
      announcementText = currentAnnouncementText
    }

    if (onToolAnnouncement) {
      logger.agent.info(
        `[VoiceToolLoop] Tool announcement (iter ${iteration}): "${currentAnnouncementText.slice(0, 60)}..." → tools: ${toolNames.join(', ')} (llmText: ${llmText ? 'yes' : 'no, using default'})`,
      )
      try {
        onToolAnnouncement(currentAnnouncementText, toolNames)
      } catch (err) {
        logger.agent.warn('[VoiceToolLoop] onToolAnnouncement callback error:', err)
      }
    }

    // 构建 assistant 消息（包含 tool_calls + reasoning）
    // 与 AgentSubLoop 一致：思考模型的 reasoning_content 也需要传回给 LLM
    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    }
    if (result.reasoning) {
      ;(assistantMsg as LLMMessage & { reasoning_content?: string }).reasoning_content = result.reasoning
    }
    messages.push(assistantMsg)

    logger.agent.info(
      `[VoiceToolLoop] Executing ${result.toolCalls.length} tool calls: ${result.toolCalls.map(tc => tc.name).join(', ')}`,
    )

    // 逐个触发 onToolStart 回调（UI 可显示"正在执行 xxx"）
    for (const tc of result.toolCalls) {
      if (onToolStart) {
        try {
          onToolStart(tc.name, tc.arguments)
        } catch (err) {
          logger.agent.warn('[VoiceToolLoop] onToolStart callback error:', err)
        }
      }
    }

    // 并行执行工具调用
    const toolPromises = result.toolCalls.map(tc =>
      executeVoiceToolCall(tc, workspacePath, requestId),
    )
    const toolResults = await Promise.all(toolPromises)

    // 逐个触发 onToolComplete 回调，并收集工具调用记录
    result.toolCalls.forEach((tc, idx) => {
      const toolResult = toolResults[idx]
      const success = !toolResult.content.startsWith('错误:')
      const outputSummary = toolResult.content.slice(0, 200)

      // 记录工具调用（用于保存到聊天历史）
      toolCallRecords.push({
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
        success,
        resultSummary: outputSummary,
      })

      if (onToolComplete) {
        try {
          onToolComplete(tc.name, success, outputSummary)
        } catch (err) {
          logger.agent.warn('[VoiceToolLoop] onToolComplete callback error:', err)
        }
      }
    })

    // 将工具结果添加到消息历史
    for (const toolResult of toolResults) {
      messages.push(toolResult)
    }

    // 继续下一轮 LLM 调用（工具结果已反馈，LLM 将基于结果生成回复）
  }

  logger.agent.warn(`[VoiceToolLoop] Max iterations (${maxIterations}) reached`)
  return {
    content: lastContent,
    allContent,
    announcementText,
    toolCallsCount: totalToolCallsCount,
    toolCallRecords,
    error: `达到最大迭代次数 (${maxIterations})`,
  }
}

// ==================== 工具函数 ====================

/** 解析工具参数 JSON 字符串，失败时返回空对象 */
function parseToolArgs(argsString: string): Record<string, unknown> {
  if (!argsString) return {}
  try {
    return JSON.parse(argsString)
  } catch {
    return {}
  }
}

/** 更新或插入工具调用到列表（按 id 去重） */
function upsertToolCall(
  list: CollectedToolCall[],
  id: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const existingIdx = list.findIndex(t => t.id === id)
  const toolCall = { id, name, arguments: args }
  if (existingIdx === -1) {
    list.push(toolCall)
  } else {
    list[existingIdx] = toolCall
  }
}
