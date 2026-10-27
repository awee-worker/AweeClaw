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
import { peekAgent } from '@intelligence/engine/agentAccessor'
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

/**
 * 空闲后的收尾确认窗口
 *
 * 多轮工具调用之间会短暂回到 idle（上一批跑完、下一批还没发出），见到 idle
 * 就立刻报完成会让面板在中途就跳到「已生成」。等这么一小段再认，期间又忙起来
 * 就撤掉待定的收尾。
 */
const FINISH_SETTLE_MS = 1200

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
 * 这张卡片会不会被抛到场景面板上
 *
 * 「等用户回答」与「把卡片交给面板」必须同一个口径。只要两者不一致，就会有一类
 * 卡片既被算作等待、又不被转发：面板停在运行中，却没有任何可点的入口，用户看到
 * 的就是「一直显示正在生成，结束不了」。续做卡片属于主会话语义，本就不搬，
 * 所以它不算等待 —— 面板该按完成收尾。
 */
function isForwardableInteractive(interactive: AssistantInteractive): boolean {
  if (interactive.selectedIds?.length) return false
  if (interactive.kind === 'continue_task') return false
  return Boolean(interactive.question && interactive.options?.length)
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
    return isForwardableInteractive(interactive)
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
    /** 消息真正开始发送前 subscribe 回调不判定结束：abort 残留时 streamState 可能
     *  短暂经过 tool_running，若此时误设 started=true，abort 完成后立刻 stopTracking('done') */
    sending: boolean
    lastTool?: string
    /** 已抛给面板的提问指纹：同一条消息重复广播会让面板闪一下再重置 */
    interactiveKey?: string
    unsubscribe?: () => void
    timer?: ReturnType<typeof setTimeout>
    /** 空闲后的收尾待定：期间又忙起来就取消，避免多轮工具之间被误判成结束 */
    idleTimer?: ReturnType<typeof setTimeout>
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
      if (run.idleTimer) clearTimeout(run.idleTimer)
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
     * 释放上一轮残留的执行占用
     *
     * 场景工作线程是串行的执行载体。一次生成挂死（模型无响应、流始终没收到完成
     * 信号）之后，Agent 内部 runningTasks 上的执行锁不会自己消失，下一次 send
     * 会直接被 "Thread ... is already running" 挡下 —— 面板提示「可以再点一次
     * 生成」，点了却只拿到这句报错，重来一次的路被彻底堵死。
     *
     * 面板在运行期间是禁用生成按钮的，能走到这里的「还在跑」只可能是上一轮没人
     * 收尾的残留，因此新请求进来时先中止它，等锁真正释放再发。
     *
     * 判定只能以执行锁为准，不能拿流式状态替代：abort 在 runningTasks 里找不到
     * 目标线程时会兜底中止全部运行中任务，误判会把用户主对话那边正在跑的请求
     * 一起打断。
     */
    async function releaseStaleRun(threadId: string): Promise<void> {
      if (!peekAgent()?.isRunning(threadId)) return

      logger.system.warn(
        `[PluginHostBridge] 线程存在未收尾的上一轮运行，先中止再重发: thread=${threadId}`,
      )
      abortThread(threadId)

      // 中止是异步收尾：锁在 send 的 finally 里释放，这里轮询到真正空闲为止
      const MAX_WAIT_ATTEMPTS = 20 // 150ms × 20 ≈ 3s
      for (let attempt = 0; attempt < MAX_WAIT_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        if (!peekAgent()?.isRunning(threadId)) return
      }
      logger.system.warn(
        `[PluginHostBridge] 等待执行锁释放超时，仍尝试发送: thread=${threadId}`,
      )
    }

    /**
     * 取消待定的收尾
     *
     * 多轮工具调用之间存在很短的 idle 空档（上一批工具跑完、下一批还没发出）。
     * 一旦又忙起来就说明没结束，待定的收尾必须撤掉。
     */
    function cancelFinish(run: NonNullable<typeof runRef.current>): void {
      if (run.idleTimer) {
        clearTimeout(run.idleTimer)
        run.idleTimer = undefined
      }
    }

    /**
     * 安排一次收尾
     *
     * 不能见到 idle 就直接报完成：先等一小段确认，期间没有再忙起来才认。
     * 这一等待同时兜住「最后一次状态变化发生在 sending 仍为 true 时」的情形 ——
     * 那一帧不判定结束，之后若再无状态更新，就不会有任何回调来收尾，面板会一直转圈。
     */
    function scheduleFinish(
      run: NonNullable<typeof runRef.current>,
      phase: string,
    ): void {
      if (run.idleTimer) return
      run.idleTimer = setTimeout(() => {
        run.idleTimer = undefined
        if (runRef.current !== run) return
        const current = useAgentStore.getState().threads[run.threadId]?.streamState
        const currentPhase = current?.phase ?? 'idle'
        // 确认窗口内又跑起来了：交给订阅回调继续跟
        if (currentPhase !== 'idle' && currentPhase !== 'error') return
        stopTracking(currentPhase === 'error' ? 'error' : 'done')
      }, FINISH_SETTLE_MS)
    }

    /**
     * 投递结束后主动核对一次状态
     *
     * sendToThread 返回时本轮可能已经跑完（状态早就落到 idle），此后不会再有
     * setState 触发订阅回调。这里补一次同步核对，否则收尾判定永远不会被触发。
     */
    function nudgeFinish(run: NonNullable<typeof runRef.current>): void {
      if (runRef.current !== run) return
      const streamState = useAgentStore.getState().threads[run.threadId]?.streamState
      const phase = streamState?.phase ?? 'idle'
      const busy = phase === 'streaming' || phase === 'tool_running' || phase === 'tool_pending'
      if (!busy && run.started) scheduleFinish(run, phase)
    }

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

       const run: NonNullable<typeof runRef.current> = { pluginKey, threadId, started: false, sending: true }
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
          // sending=true 表示消息还在投递中（abort 残留 / sendToThread 尚未开始流式），
          // 此时 idle 不代表完成：不判定结束，避免误广播 done 让面板闪一下「已生成」
          if (run.started && !run.sending) scheduleFinish(run, phase)
          return
        }

        // 又忙起来了：撤掉待定的收尾，继续跟这一轮
        cancelFinish(run)

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
         void (async () => {
           // 提问那一轮结束后线程通常已经空闲，但模型若在收尾阶段挂住，锁会一直留着；
           // 与首次生成同一条处理：先清残留再续发，否则用户的回答会被静默丢弃
           const run = runRef.current
           await releaseStaleRun(threadId)
           await sendToThread(content, threadId, {
             silent: true,
             chatMode: 'agent',
             // 沿用本次生成选的模型：微调是同一件事的延续
             llmOverride: lastModelByPluginRef.current.get(detail.pluginKey),
           })
            if (run && runRef.current === run) {
             run.sending = false
             // 本轮可能在返回前就跑完了：此后不会有状态更新来触发回调，必须主动核对
             nudgeFinish(run)
           }
         })().catch((err: unknown) => {
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
        // 上一轮可能挂死（模型无响应 / 未收到完成信号），执行锁还留在 Agent 里。
        // 先把它收掉，否则这次发送会立刻被 "Thread already running" 挡回来。
        await releaseStaleRun(threadId)
        // 固定 agent 档：场景面板没有输入区，currentMode 可能停在 chat，
        // 那样拿到的工具集不足以完成一次生成（建画板、写节点都要工具）
        await sendToThread(detail.text, threadId, {
          chatMode: 'agent',
          llmOverride: detail.model,
        })
        // 投递完成：subscribe 回调从现在开始判定结束，否则 idle 会被误读为「已完成」
        if (runRef.current === run) {
          run.sending = false
          // 同上：跑完得早时没有后续状态变化，补一次主动核对
          nudgeFinish(run)
        }
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
        if (!isForwardableInteractive(interactive)) return

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
