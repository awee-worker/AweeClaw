/**
 * PluginHostBridge — 插件 UI 与客户端内部能力的桥接器
 *
 * 职责：
 * 监听插件通过 PluginHostApi 派发的 window CustomEvent，将其转译为
 * 客户端内部 API 调用。本组件是插件与客户端解耦的关键边界——
 * 插件只依赖 host API（不 import 客户端内部模块），实际能力由本组件代理。
 *
 * 当前桥接能力：
 * - sendChatMessage：插件请求向当前会话发送消息 → 调用 useAgentActions().sendMessage
 *
 * 本组件不渲染任何 UI，仅在挂载时注册监听、卸载时清理。
 * 必须挂载在 React 树内（需要访问 useAgentActions 依赖的 store）。
 *
 * @module renderer/plugins/PluginHostBridge
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAgentCommands, useThreadMessenger } from '@hooks/useAgent'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { buildEnabledLocalModels } from '@components/conversation/availableModels'
import {
  PLUGIN_CHAT_ABORT_EVENT,
  PLUGIN_CHAT_ANSWER_EVENT,
  PLUGIN_CHAT_INTERACTIVE_EVENT,
  PLUGIN_CHAT_SEND_EVENT,
  PLUGIN_CHAT_STATE_EVENT,
  PLUGIN_CLOSE_DRAWER_EVENT,
  PLUGIN_CONTEXT_NOTE_EVENT,
  PLUGIN_MODELS_EVENT,
  PLUGIN_MODELS_REQUEST_EVENT,
  type PluginChatAbortDetail,
  type PluginChatAnswerDetail,
  type PluginChatInteractiveDetail,
  type PluginChatModelRef,
  type PluginChatPhase,
  type PluginChatSendDetail,
  type PluginChatStateDetail,
  type PluginContextNoteDetail,
  type PluginModelsDetail,
} from './PluginHostApi'
import { BROWSER_AI_EDIT_EVENT } from '@components/workspace-editor/browser/aiEditPrompt'
import { closePluginDrawer } from './pluginDrawerStore'
import { setPluginNotice } from './pluginNoticeStore'

/** window 上标记 bridge 就绪的全局字段名 */
const READY_FLAG = '__AWEECLAW_PLUGIN_HOST_READY__'

/** 设备联动 AI 任务事件名（来自 authSlice 的 onAiTask/onRunScenario） */
const DEVICE_LINK_AI_TASK_EVENT = 'aweeclaw:device-link:ai-task'

/** 补报结果正文上限（只做留痕，避免撑大事件 payload） */
const REPORT_OUTPUT_LIMIT = 4000

/** 取指定线程（缺省当前线程）最后一条助手消息的纯文本 */
function collectLastAssistantReply(threadId?: string | null): string {
  try {
    const state = useAgentStore.getState()
    const targetId = threadId ?? state.currentThreadId
    const thread = targetId
      ? state.threads[targetId]
      : state.getCurrentThread?.()
    if (!thread) return ''
    const last = [...thread.messages].reverse().find((m) => m.role === 'assistant')
    if (!last) return ''
    // content 是常规文本；分片消息只在 parts 里，两种都要读，否则取到空串
    const direct = typeof last.content === 'string' ? last.content.trim() : ''
    if (direct) return direct
    const parts = (last as { parts?: Array<{ type: string; text?: string }> }).parts || []
    return parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}

/**
 * 线程里是否有等待用户回答的提问
 *
 * ask_user 会结束当前轮次（工具返回 waitingForUser，主循环据此收尾），看起来
 * 与「跑完了」无法区分。这里补一次判断：还有问题没答，就不是完成而是等待。
 */
function hasPendingInteractive(threadId: string): boolean {
  const messages = useAgentStore.getState().threads[threadId]?.messages
  if (!messages?.length) return false
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') break
    const interactive = (message as { interactive?: AssistantInteractive }).interactive
    if (!interactive) break
    if (interactive.selectedIds?.length) return false
    return Boolean(interactive.question && interactive.options?.length)
  }
  return false
}

/** 助手消息上的选项卡片数据（由 ask_user / 表单类工具写入） */
interface AssistantInteractive {
  kind?: string
  question?: string
  options?: Array<{ id: string; label: string; description?: string }>
  multiSelect?: boolean
  allowCustom?: boolean
  selectedIds?: string[]
}

/** 从任务输出中提取工作空间文件路径，作为产物上报（最多 10 条） */
function extractArtifactPaths(text: string): Array<{ type: string; title: string; path: string }> {
  const matches = text.match(/[\w./\\-]+\.\w{1,5}\b/g) || []
  const seen = new Set<string>()
  const out: Array<{ type: string; title: string; path: string }> = []
  for (const m of matches) {
    if (seen.has(m) || out.length >= 10) continue
    seen.add(m)
    out.push({ type: 'file', title: m.split(/[\\/]/).pop() || m, path: m })
  }
  return out
}

export function PluginHostBridge() {
  const { sendMessage } = useAgentCommands()
  /**
   * 定向发送：插件发起的运行落在各自的工作线程里
   *
   * 用 sendMessage 会写进 currentThreadId，也就是用户正在看的那个会话 —— 面板
   * 里点一次「生成」，主对话就会多出一段与画布无关的对话。sendToThread 只把
   * 消息投递到目标线程，主聊天线程与它的界面都不动。
   */
  const { sendToThread, abortThread } = useThreadMessenger()

  /**
   * 当前由插件发起、还没结束的那次运行。
   *
   * 插件面板只要知道「在跑什么 / 跑完了」，不需要整段对话，所以这里把一次运行
   * 压缩成阶段事件往外发。同一时刻只跟踪最后一次插件发起的运行：插件面板是
   * 串行的，后发起的请求本就该覆盖前一个的状态显示。
   */
  const runRef = useRef<{
    pluginKey: string
    /** 本次运行所在线程：状态订阅与结果读取都指向它，而不是主聊天线程 */
    threadId: string
    started: boolean
    lastTool?: string
    /** 已抛给面板的提问指纹：同一条消息重复广播会让面板闪一下再重置 */
    interactiveKey?: string
    unsubscribe?: () => void
    timer?: ReturnType<typeof setTimeout>
  } | null>(null)

  /**
   * 场景工作线程映射：`插件::工作单元` → 线程 ID
   *
   * 一个工作单元（如一个原型项目）复用同一条线程，多轮调整能带上上一轮结果；
   * 换项目就是换线程，避免两个项目的上下文互相污染。只存在内存：这类线程是
   * 执行载体，重启后没必要续上。
   */
  const workThreadsRef = useRef(new Map<string, string>())

  /**
   * 每个插件最近一次运行所在的线程
   *
   * ask_user 结束后那一轮就收尾了（runRef 清空），用户再点选项时已经没有「当前
   * 运行」可依。回答仍要落到原线程，否则会把选择发进用户的主会话，或者干脆丢掉。
   */
  const lastThreadByPluginRef = useRef(new Map<string, string>())

  /**
   * 每个插件最近一次运行用的模型
   *
   * 追问 / 微调是同一件事的后续，模型要跟着一起延续：用户选了强模型画首页，
   * 回答完 ask_user 却回落成默认模型，第二段版面质量会明显对不上。
   */
  const lastModelByPluginRef = useRef(new Map<string, PluginChatModelRef>())

  const emitChatState = useCallback((detail: PluginChatStateDetail) => {
    try {
      window.dispatchEvent(
        new CustomEvent<PluginChatStateDetail>(PLUGIN_CHAT_STATE_EVENT, { detail }),
      )
    } catch (err) {
      logger.system.warn('[PluginHostBridge] emit plugin chat state failed:', err)
    }
  }, [])

  /**
   * 把「AI 在等用户选择」抛给插件面板
   *
   * 场景工作线程的对话不渲染在聊天面板里，ask_user 的选项卡片也就没有落点；
   * 面板接住这个事件后在自己身边画一组选项，用户点完再回传 answer 事件。
   */
  const emitInteractive = useCallback((detail: PluginChatInteractiveDetail) => {
    try {
      window.dispatchEvent(
        new CustomEvent<PluginChatInteractiveDetail>(PLUGIN_CHAT_INTERACTIVE_EVENT, { detail }),
      )
    } catch (err) {
      logger.system.warn('[PluginHostBridge] emit plugin chat interactive failed:', err)
    }
  }, [])

  /**
   * 广播可用模型清单
   *
   * 数据源与聊天输入框的模型选择器同源（buildEnabledLocalModels），插件里能选到的
   * 模型与主界面完全一致。清单每次请求都重算，而不是缓存第一次的结果。
   */
  const emitModels = useCallback(() => {
    try {
      const store = useStore.getState()
      const models = buildEnabledLocalModels(store.providerConfigs, store.llmConfig.apiKey).map(
        (item) => ({
          providerId: item.providerId,
          id: item.id,
          name: item.name,
          providerName: item.providerName,
        }),
      )
      const detail: PluginModelsDetail = {
        models,
        current: { provider: store.llmConfig.provider, model: store.llmConfig.model },
      }
      window.dispatchEvent(new CustomEvent<PluginModelsDetail>(PLUGIN_MODELS_EVENT, { detail }))
    } catch (err) {
      logger.system.warn('[PluginHostBridge] emit plugin models failed:', err)
    }
  }, [])

  /** 结束跟踪并发最终状态；重复调用安全（runRef 已清空则直接返回） */
  const stopTracking = useCallback(
    (phase: PluginChatPhase, extra?: { error?: string }) => {
      const run = runRef.current
      if (!run) return
      runRef.current = null
      run.unsubscribe?.()
      if (run.timer) clearTimeout(run.timer)
      // 提问会把这一轮结束掉，但它不是「做完了」：面板要停在等用户回答的状态
      const waiting = phase === 'done' && hasPendingInteractive(run.threadId)
      emitChatState({
        pluginKey: run.pluginKey,
        phase: waiting ? 'running' : phase,
        statusText: waiting ? '等待你确认' : undefined,
        // 摘要取自本次运行的线程：主聊天线程此时可能是别的会话，读错会给出无关文案
        summary: phase === 'done' && !waiting
          ? collectLastAssistantReply(run.threadId).slice(0, 200)
          : undefined,
        error: extra?.error,
      })
    },
    [emitChatState],
  )

  useEffect(() => {
    /**
     * 开始跟踪一次运行
     *
     * 提问-回答是多轮的：ask_user 结束后本轮结束，用户点完选项再发一条新消息，
     * 这仍属于同一次「做原型」的过程。因此续发也要重新挂上跟踪，否则面板会
     * 一直停在上一轮的「已完成」，看不到后续进度。
     */
    function beginRun(pluginKey: string, threadId: string): NonNullable<typeof runRef.current> {
      // 上一个运行还没收尾就来了新请求：按已完成收尾，避免插件面板卡在旧状态
      if (runRef.current) stopTracking('done')

      const run: NonNullable<typeof runRef.current> = { pluginKey, threadId, started: false }
      runRef.current = run
      lastThreadByPluginRef.current.set(pluginKey, threadId)
      emitChatState({
        pluginKey,
        phase: 'running',
        statusText: '已提交，正在解析需求',
      })

      // 跟着本次运行所在线程的流式状态走：进入流式即视为开始，回到 idle 即视为结束
      run.unsubscribe = useAgentStore.subscribe((state) => {
        if (runRef.current !== run) return
        const thread = state.threads[run.threadId]
        const streamState = thread?.streamState
        const phase = streamState?.phase ?? 'idle'
        const busy =
          phase === 'streaming' || phase === 'tool_running' || phase === 'tool_pending'

        // 提问与运行阶段无关：模型可能在流式收尾后停下等选择，这一步必须每轮都查
        forwardInteractive(thread?.messages)

        if (!busy) {
          if (run.started) stopTracking(phase === 'error' ? 'error' : 'done')
          return
        }

        run.started = true
        const tool = streamState?.currentToolCall?.name
        if (tool && tool !== run.lastTool) {
          run.lastTool = tool
          emitChatState({
            pluginKey: run.pluginKey,
            phase: 'running',
            tool,
            statusText: streamState?.statusText,
          })
        }
      })

      // 消息发出却始终没进入流式（队列阻塞 / 模型无响应）：主动报错，别让面板一直转圈
      run.timer = setTimeout(() => {
        if (runRef.current === run && !run.started) {
          stopTracking('error', { error: 'AI 未开始响应' })
        }
      }, 60000)

      return run
    }

    /** 面板回传用户选择：写回消息并静默续发，链路与聊天面板的选项卡片一致 */
    const handleAnswer = (event: Event) => {
      const detail = (event as CustomEvent<PluginChatAnswerDetail>).detail
      if (!detail?.messageId || !detail.pluginKey) return

      // 提问那一轮结束时跟踪已经收尾，所以线程要从「该插件最近一次运行」取，
      // 不能只看 runRef：否则用户点选项时找不到目标线程，选择被静默丢弃。
      const threadId = runRef.current?.threadId ?? lastThreadByPluginRef.current.get(detail.pluginKey)
      if (!threadId) return

      const store = useAgentStore.getState()
      const thread = store.threads[threadId]
      const message = thread?.messages.find((m) => m.id === detail.messageId)
      const interactive = (message as { interactive?: AssistantInteractive } | undefined)?.interactive

      const labels = (interactive?.options ?? [])
        .filter((opt) => detail.selectedIds.includes(opt.id))
        .map((opt) => opt.label)
      // 与聊天面板保持一致：选项标签在前，「其他」自由输入跟在后面
      const content = [...labels, detail.customText].filter(Boolean).join(', ')
      if (!content) return

      store.updateMessage(
        detail.messageId,
        { interactive: { ...interactive, selectedIds: detail.selectedIds } } as never,
        threadId,
      )
      // 续发属于同一轮「做原型」的后续，重新挂上跟踪，面板才会显示新一轮进度
      beginRun(detail.pluginKey, threadId)

      // 提问收尾与用户点击之间存在极短的空窗，此时线程可能还挂在上一轮上：
      // 补一次重试，避免选择被「Thread already running」挡掉后无声消失
      const dispatch = (attempt: number): void => {
        void sendToThread(content, threadId, {
          silent: true,
          chatMode: 'agent',
          // 沿用本次生成选的模型：微调是同一件事的延续
          llmOverride: lastModelByPluginRef.current.get(detail.pluginKey),
        }).catch((err: unknown) => {
          if (attempt === 0) {
            setTimeout(() => dispatch(1), 800)
            return
          }
          logger.system.warn('[PluginHostBridge] scenario answer dispatch failed:', err)
        })
      }
      dispatch(0)
    }


    const handleChatSend = async (event: Event) => {
      const detail = (event as CustomEvent<PluginChatSendDetail>).detail
      if (!detail?.text) return

      let threadId: string
      try {
        threadId = resolveWorkThread(detail.pluginKey, detail.scenarioKey)
      } catch (err) {
        logger.system.error('[PluginHostBridge] create scenario work thread failed:', err)
        emitChatState({
          pluginKey: detail.pluginKey,
          phase: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }

      const run = beginRun(detail.pluginKey, threadId)
      // 记住这次选的模型：后续「继续微调」属于同一件事，不该中途换掉
      if (detail.model) lastModelByPluginRef.current.set(detail.pluginKey, detail.model)

      try {
        // 固定 agent 档：场景面板没有输入区，currentMode 可能停在 chat，
        // 那样拿到的工具集不足以完成一次生成（建画板、写节点都要工具）
        await sendToThread(detail.text, threadId, {
          chatMode: 'agent',
          llmOverride: detail.model,
        })
      } catch (err) {
        logger.system.error(
          `[PluginHostBridge] scenario run failed (plugin=${detail.pluginKey}, thread=${threadId}):`,
          err,
        )
        if (runRef.current === run) {
          stopTracking('error', { error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    /**
     * 取（或建）场景工作线程
     *
     * 线程创建为「不激活」：切换 currentThreadId 会让主聊天面板整个换成这条线程，
     * 那正是这次隔离要避免的。origin 标为非用户会话，会话列表与历史面板里都不会出现。
     */
    function resolveWorkThread(pluginKey: string, scenarioKey?: string): string {
      const mapKey = `${pluginKey}::${scenarioKey ?? ''}`
      const store = useAgentStore.getState()
      const existing = workThreadsRef.current.get(mapKey)
      if (existing && store.threads[existing]) return existing

      const threadId = store.createThread({ activate: false, origin: 'scenario-task' })
      store.renameThread(threadId, scenarioKey ? `${pluginKey} · ${scenarioKey}` : pluginKey)
      workThreadsRef.current.set(mapKey, threadId)
      return threadId
    }

    /** 扫描线程消息：出现未被回答的选项卡片就转给面板 */
    const forwardInteractive = (messages: Array<{ id: string; role: string }> | undefined) => {
      const run = runRef.current
      if (!run || !messages?.length) return

      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== 'assistant') break
        const interactive = (message as { interactive?: AssistantInteractive }).interactive
        if (!interactive) break
        // 已经选过的不再追问；续做卡片属于主会话语义，不往场景面板搬
        if (interactive.selectedIds?.length || interactive.kind === 'continue_task') return
        if (!interactive.question || !interactive.options?.length) return

        const key = `${message.id}:${interactive.question}`
        if (run.interactiveKey === key) return
        run.interactiveKey = key
        emitInteractive({
          pluginKey: run.pluginKey,
          messageId: message.id,
          question: interactive.question,
          options: interactive.options,
          multiSelect: interactive.multiSelect === true,
          allowCustom: interactive.allowCustom !== false,
        })
        return
      }
    }

    /** 面板取消本次运行 */

    const handleAbort = (event: Event) => {
      const detail = (event as CustomEvent<PluginChatAbortDetail>).detail
      const run = runRef.current
      if (!run) return
      if (detail?.pluginKey && detail.pluginKey !== run.pluginKey) return
      abortThread(run.threadId)
      stopTracking('error', { error: '已取消' })
    }


    /**
     * 处理设备联动 AI 任务请求（来自移动端远程触发）。
     *
     * RPC 通道只回了 queued，任务真正的完成结果与产物在此补报：
     * 按 requestId 上报 task-complete / task-error，后端任务中心据此归档。
     */
    const handleDeviceLinkAiTask = async (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; scenarioId?: string; requestId?: string }>).detail
      if (!detail?.text) return
      const { requestId } = detail
      try {
        await sendMessage(detail.text)
        logger.system.info('[PluginHostBridge] Device-link AI task completed, reporting result')
        if (requestId) {
          const reply = collectLastAssistantReply()
          api.deviceLink.reportEvent('task-complete', {
            requestId,
            success: true,
            result: reply.slice(0, REPORT_OUTPUT_LIMIT),
            summary: reply.slice(0, 120),
            artifacts: extractArtifactPaths(reply),
          })
        }
      } catch (err) {
        logger.system.error('[PluginHostBridge] Device-link AI task failed:', err)
        if (requestId) {
          api.deviceLink.reportEvent('task-error', {
            requestId,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    /**
     * 处理内置浏览器的「AI 修改」请求
     *
     * 提示词里已经带上了元素选择器与处理要求，这里只负责发出去——与插件发消息
     * 走同一条链路，AI 侧看到的是一条正常的用户消息，不引入旁路。
     */
    const handleBrowserAiEdit = async (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail
      if (!detail?.text) return
      try {
        await sendMessage(detail.text)
      } catch (err) {
        logger.system.error('[PluginHostBridge] browser ai-edit failed:', err)
      }
    }

    /** 处理插件请求关闭抽屉 */
    const handleCloseDrawer = () => {
      closePluginDrawer()
    }

    /**
     * 处理插件写回的操作结果。
     *
     * 两件事：写进会话上下文让 AI 知道（不触发对话），
     * 同时在输入框上方弹一条短提示，让用户看到操作确实生效了。
     */
    const handleContextNote = (event: Event) => {
      const detail = (event as CustomEvent<PluginContextNoteDetail>).detail
      if (!detail?.text || !detail.pluginKey) return
      try {
        // 短标签一并写进上下文项：消息气泡用它展示「这一次选了什么」，
        // 否则发出去的消息上只剩插件名，用户无从确认当时的选择
        useAgentStore
          .getState()
          .setPluginStateNote(
            detail.pluginKey,
            detail.text,
            detail.displayName,
            detail.label,
            // 带二级项标识时按标识归位，多个并列选择才能同时留在上下文里
            detail.selectionKey,
          )
        // 上下文用完整说明，界面用短标签；插件没给标签时退回完整说明
        setPluginNotice({ text: detail.label || detail.text, pluginKey: detail.pluginKey })
      } catch (err) {
        logger.system.error(
          `[PluginHostBridge] setContextNote failed (plugin=${detail.pluginKey}):`,
          err,
        )
      }
    }

    /** 插件要模型清单：实时重算，用户可能刚在设置里启用了新的服务商 */
    const handleModelsRequest = () => emitModels()

    window.addEventListener(PLUGIN_CHAT_SEND_EVENT, handleChatSend as EventListener)
    window.addEventListener(PLUGIN_CHAT_ANSWER_EVENT, handleAnswer as EventListener)
    window.addEventListener(PLUGIN_CHAT_ABORT_EVENT, handleAbort as EventListener)
    window.addEventListener(PLUGIN_CLOSE_DRAWER_EVENT, handleCloseDrawer as EventListener)
    window.addEventListener(PLUGIN_CONTEXT_NOTE_EVENT, handleContextNote as EventListener)
    window.addEventListener(DEVICE_LINK_AI_TASK_EVENT, handleDeviceLinkAiTask as EventListener)
    window.addEventListener(BROWSER_AI_EDIT_EVENT, handleBrowserAiEdit as EventListener)
    window.addEventListener(PLUGIN_MODELS_REQUEST_EVENT, handleModelsRequest as EventListener)
    // 标记 bridge 就绪，供 PluginHostApi 检测
    ;(window as unknown as Record<string, unknown>)[READY_FLAG] = true
    // 首次广播：插件面板若已挂载就能直接拿到清单；没拿到也会再发一次请求
    emitModels()

    return () => {
      window.removeEventListener(PLUGIN_CHAT_SEND_EVENT, handleChatSend as EventListener)
      window.removeEventListener(PLUGIN_CHAT_ANSWER_EVENT, handleAnswer as EventListener)
      window.removeEventListener(PLUGIN_CHAT_ABORT_EVENT, handleAbort as EventListener)
      window.removeEventListener(PLUGIN_CLOSE_DRAWER_EVENT, handleCloseDrawer as EventListener)
      window.removeEventListener(PLUGIN_CONTEXT_NOTE_EVENT, handleContextNote as EventListener)
      window.removeEventListener(DEVICE_LINK_AI_TASK_EVENT, handleDeviceLinkAiTask as EventListener)
      window.removeEventListener(BROWSER_AI_EDIT_EVENT, handleBrowserAiEdit as EventListener)
      window.removeEventListener(PLUGIN_MODELS_REQUEST_EVENT, handleModelsRequest as EventListener)
      // 卸载时把运行跟踪一并关掉，避免回调打到已卸载的组件上
      const run = runRef.current
      if (run) {
        run.unsubscribe?.()
        if (run.timer) clearTimeout(run.timer)
        runRef.current = null
      }
      delete (window as unknown as Record<string, unknown>)[READY_FLAG]
    }
  }, [sendMessage, sendToThread, abortThread, emitChatState, emitInteractive, emitModels, stopTracking])

  // 不渲染任何 UI，仅作为副作用容器
  return null
}
