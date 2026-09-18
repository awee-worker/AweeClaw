/**
 * ProjectExecutionWindowApp — 项目执行窗口主组件（全屏三栏布局）
 *
 * 作为独立窗口（execution.html）的 React 根组件。
 *
 * 布局（全屏，1:2:4 比例，可拖拽调整）：
 * ┌──────────────────────────────────────────────────────────┐
 * │  ExecutionWindowTitleBar（项目名 + 最小化 + 关闭）          │
 * ├──────────┬────────────────────┬─────────────────────────┤
 * │  任务列表  │  AI 执行聊天窗口     │  AI 产物文件预览         │
 * │  (300px)  │  (550px)           │  (flex-1)               │
 * │  可拖拽←→│  可拖拽←→           │                         │
 * └──────────┴────────────────────┴─────────────────────────┘
 *
 * 聊天面板直接复用主窗口 ChatPanel 组件，确保功能和排版完全一致。
 *
 * 关键设计：
 * - 初始化时调用 restoreSession() 恢复 auth 状态（serverUrl + tokens）
 * - 激活 Tab 时设置 currentThreadId，ChatPanel 自动订阅对应线程
 * - 三栏可拖拽调整大小（左右两个分隔条）
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { motion } from 'framer-motion'
import { api } from '@renderer/adapters/electronBridge'
import { tasksApi, projectsApi } from '@renderer/adapters/taskProjectApi'
import { useStore } from '@renderer/state'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { setupAgentRuntime } from '@intelligence/engine'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import { registerSettingsSync } from '@renderer/adapters/appInitializer'
import { logger } from '@shared/toolkit/LogEngine'
import { ToastProvider, GlobalErrorHandler } from '@renderer/components/foundation'
import { GlobalDecisionOverlay } from '@renderer/components/foundation/DecisionOverlay'
import { ThemeManager } from '@renderer/components/workspace-editor/EditorThemeProvider'
import GlobalToastContainer from '@renderer/components/foundation/AppToastContainer'
import ChatPanel from '@renderer/components/intelligence/ChatPanel'
import { useThreadMessenger } from '@hooks/useAgent'
import { buildBatchNextTaskPrompt } from '@components/explorer/panels/projects/projectExecutionContext'
import type { TaskItem } from '@components/explorer/panels/tasks/types'
import { ExecutionWindowTitleBar } from './ExecutionWindowTitleBar'
import { ExecutionTabBar } from './ExecutionTabBar'
import { ExecutionTaskList } from './ExecutionTaskList'
import { ExecutionFileTree } from './ExecutionFileTree'
// 复用主窗口的编辑器组件（含标签页 + Monaco 编辑器 + 各类文件预览）
const Editor = React.lazy(() => import('@renderer/components/workspace-editor/WorkspaceEditor'))
import type { ExecutionTab } from './types'

// ============================================
// 常量
// ============================================

/** 任务列表面板最小宽度（px） */
const TASK_LIST_MIN_WIDTH = 220
/** 任务列表面板最大宽度（px） */
const TASK_LIST_MAX_WIDTH = 500
/** AI 聊天面板最小宽度（px） */
const CHAT_MIN_WIDTH = 400
/** AI 聊天面板最大宽度（px） */
const CHAT_MAX_WIDTH = 1000
/** 左侧文件树面板最小高度（px） */
const FILE_TREE_MIN_HEIGHT = 100
/** 左侧任务列表面板最小高度（px） */
const TASK_LIST_MIN_HEIGHT = 100

/** 动画持续时间（ms），与渲染层 transition 一致 */
const ANIM_DURATION = 250

// ============================================
// 类型定义
// ============================================

export interface ProjectExecutionWindowAppProps {
  /** React 挂载就绪回调（移除加载占位） */
  onReady?: () => void
}

// ============================================
// 主组件
// ============================================

export function ProjectExecutionWindowApp({ onReady }: ProjectExecutionWindowAppProps) {
  const [initialized, setInitialized] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  // Tab 列表（多项目执行）
  const [tabs, setTabs] = useState<ExecutionTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // ─── 线程消息发送（执行窗口自己负责发送任务消息给 AI）─────────
  const { sendToThread } = useThreadMessenger()

  // ─── 最小化/恢复动画状态 ─────────────────────────────────
  const [animState, setAnimState] = useState<'visible' | 'minimizing' | 'restoring'>('visible')
  const [avatarPos, setAvatarPos] = useState<{ x: number; y: number } | null>(null)

  // ─── 三栏面板宽度（拖拽调整）──────────────────────────────
  // 初始比例 1:2:4 → 300 / 550 / 剩余 ≈ 1:2:4
  const [taskListWidth, setTaskListWidth] = useState(300)
  const [chatWidth, setChatWidth] = useState(550)

  // ─── 左侧面板上下分栏高度（文件树 + 任务列表）──────────────
  // 默认 3:2（文件树占 60%，任务列表占 40%），用户手动拖拽后停止自动调整
  const leftPanelRef = useRef<HTMLDivElement | null>(null)
  /** 标记用户是否已手动拖拽过分隔线（拖拽后不再自动重算 3:2） */
  const userResizedVRef = useRef(false)
  const [fileTreeHeight, setFileTreeHeight] = useState(360)

  /** 上一次广播的执行状态签名，用于过滤无实质变化的重发 */
  const lastPushedStatusRef = useRef<string | null>(null)
  // 初始化 + 窗口尺寸变化时，若用户未手动拖拽过，保持文件树:任务列表 = 3:2
  // ⚠️ 依赖 initialized：组件未初始化时返回 null，leftPanelRef.current 为 null，
  //    ResizeObserver 无法绑定。必须等 initialized=true 后重新执行 effect。
  useEffect(() => {
    const syncRatioHeight = () => {
      if (userResizedVRef.current) return
      const el = leftPanelRef.current
      if (!el) return
      const total = el.clientHeight
      if (total <= 0) return
      // 文件树占 3/5（60%），任务列表占 2/5（40%）
      const treeHeight = Math.floor(total * 3 / 5)
      const target = Math.max(FILE_TREE_MIN_HEIGHT, treeHeight)
      setFileTreeHeight(target)
    }
    syncRatioHeight()
    window.addEventListener('resize', syncRatioHeight)
    // 用 ResizeObserver 监听左栏容器自身尺寸变化（如水平拖拽改宽度不影响，但布局重排可能影响高度）
    const ro = new ResizeObserver(syncRatioHeight)
    if (leftPanelRef.current) ro.observe(leftPanelRef.current)
    return () => {
      window.removeEventListener('resize', syncRatioHeight)
      ro.disconnect()
    }
  }, [initialized])

  // ─── 产物文件数量（统计用，预留后续角标显示）──────────────
  const [artifactCount, setArtifactCount] = useState(0)
  void artifactCount

  // ─── 项目目录路径（文件树的根目录）─────────────────────────
  // 优先使用创建项目时选择的目录（project.workspacePaths[0]），
  // 若项目未设置目录则回退到全局工作区 workspacePath。
  const [projectPath, setProjectPath] = useState<string | null>(null)

  // ─── 线程相位订阅（用于状态推送）─────────
  // 只取各 Tab 对应线程的流式相位：threads 对象在流式期间每批更新都会重建，
  // 直接订阅整个 threads 会让本组件（含文件树、任务列表、聊天面板）跟着整体重渲染。
  const tabPhases = useAgentStore(
    useShallow((s) => tabs.map((tab) => s.threads[tab.threadId]?.streamState?.phase ?? 'idle')),
  )

  // ─── 打开的文件列表（用于决定是否显示文件预览窗口）─────────
  // 无打开文件时隐藏中栏编辑器，聊天窗口占满空间
  const hasOpenFiles = useStore(s => s.openFiles.length > 0)

  // ─── 初始化：加载 settings + workspace + auth ───────────
  // ⚠️ 执行窗口入口已移除 React.StrictMode，避免双调用 effect。
  //    initStartedRef 作为额外防御，确保即使被双调用也只执行一次。
  const initStartedRef = useRef(false)

  useEffect(() => {
    // 防御性：防止重复初始化（StrictMode 或 React 18 并发模式）
    if (initStartedRef.current) {
      logger.system.info('[ExecutionWindow] Init already started, skipping duplicate')
      return
    }
    initStartedRef.current = true

    let cancelled = false

    async function init() {
      try {
        // 1. 加载 settings（含 llmConfig）
        await useStore.getState().load()
        logger.system.info('[ExecutionWindow] Settings loaded')

        // 2. 恢复 auth 会话（初始化 serverUrl + tokens）
        //    这一步至关重要：backendApi.ts 的 serverUrl 和 tokens 是模块级变量，
        //    主窗口登录时初始化，但执行窗口是独立进程需要自行恢复。
        //    若跳过此步，API 请求会发到空 URL，返回 HTML 而非 JSON。
        try {
          await useStore.getState().restoreSession()
          logger.system.info('[ExecutionWindow] Auth session restored')
        } catch (e) {
          logger.system.warn('[ExecutionWindow] Auth restore failed:', e)
        }

        // 2.5 确保云端模型选择完成（修复模型不持久化问题）
        //    restoreSession() 中 selectCloudModel() 是 fire-and-forget（不 await），
        //    可能在后台覆盖 load() 加载的模型选择，导致执行窗口显示错误模型。
        //    这里显式 await 一次 selectCloudModel，确保：
        //    1. 模型选择与持久化值一致（selectCloudModel 内部有保留逻辑）
        //    2. 云端字段（cloudMode/serverUrl/accessToken）被正确补充
        if (useStore.getState().cloudMode === 'cloud' && useStore.getState().isAuthenticated) {
          try {
            await useStore.getState().selectCloudModel()
            const { provider, model } = useStore.getState().llmConfig
            logger.system.info('[ExecutionWindow] Cloud model selection completed:', provider, '/', model)
          } catch (e) {
            logger.system.warn('[ExecutionWindow] Cloud model selection failed:', e)
          }
        }

        // 3. 恢复工作区（含 workspacePath）
        // ⚠️ 必须将返回的 workspace session 设置到 store 中（调用 setWorkspace），
        //    否则 workspacePath 为 null，工具调用会报 "Workspace is required for this tool"
        try {
          const workspaceConfig = await api.workspace.restore()
          if (workspaceConfig?.roots?.length) {
            // 将工作区配置设置到 store，更新 workspacePath
            useStore.getState().setWorkspace({
              configPath: workspaceConfig.configPath ?? null,
              roots: workspaceConfig.roots,
            })
            logger.system.info(
              '[ExecutionWindow] Workspace restored, workspacePath:',
              useStore.getState().workspacePath,
            )
          } else {
            logger.system.warn('[ExecutionWindow] Workspace restore returned empty roots')
          }
        } catch (e) {
          logger.system.warn('[ExecutionWindow] Workspace restore failed:', e)
        }

        // 4. 初始化 AgentRuntime（解耦循环依赖，Agent.send 内部依赖此 runtime）
        //    ⚠️ 主窗口在 appInitializer 中调用 setupAgentRuntime()，执行窗口是独立进程必须自行初始化
        //    否则 Agent.send 会抛 "Runtime not initialized" 错误
        try {
          setupAgentRuntime()
          logger.system.info('[ExecutionWindow] AgentRuntime initialized')
        } catch (e) {
          logger.system.warn('[ExecutionWindow] AgentRuntime initialization failed:', e)
        }

        // 4.5 注册设置同步监听
        //    主窗口修改模型（如 AIModelSelector 选模型）后通过 settings:changed 广播
        //    执行窗口必须监听并同步到本地 store，否则执行窗口的 ChatPanel 还用旧模型
        try {
          registerSettingsSync()
          logger.system.info('[ExecutionWindow] Settings sync registered')
        } catch (e) {
          logger.system.warn('[ExecutionWindow] Settings sync registration failed:', e)
        }

        // 5. 从 URL 参数读取初始项目/会话信息
        const params = new URLSearchParams(window.location.search)
        const projectId = params.get('projectId') || ''
        const projectName = params.get('projectName') || ''
        const sessionId = params.get('sessionId') || ''
        const threadId = params.get('threadId') || ''

        if (projectId) {
          // initialMessage 通过 IPC 从主进程获取（避免 URL 长度限制截断长 prompt）
          let initialMessage: string | undefined
          let silent = false
          let taskContext: ExecutionTab['taskContext'] = undefined
          // 如果主窗口传了 threadId，用它获取消息；否则用 sessionId 作为 key
          const messageKey = threadId || sessionId
          if (messageKey) {
            try {
              const msgData = await api.projectExecution.getInitialMessage(messageKey)
              if (msgData) {
                initialMessage = msgData.message
                silent = msgData.silent
                if (msgData.taskContext) {
                  taskContext = {
                    taskIds: msgData.taskContext.taskIds,
                    currentIndex: 0,
                    kind: msgData.taskContext.kind,
                  }
                }
                logger.system.info('[ExecutionWindow] Initial message retrieved via IPC, length:', initialMessage.length)
              }
            } catch (e) {
              logger.system.warn('[ExecutionWindow] Failed to get initial message via IPC:', e)
            }
          }

          // 如果主窗口没传 threadId（空字符串），执行窗口自己创建线程
          let effectiveThreadId = threadId
          if (!effectiveThreadId) {
            const { createThread, switchThread } = useAgentStore.getState()
            effectiveThreadId = createThread({ activate: true })
            switchThread(effectiveThreadId)
            logger.system.info('[ExecutionWindow] Created new thread:', effectiveThreadId)

            // 通过 IPC 回传 threadId 给主窗口（主窗口用它更新任务的 threadId）
            try {
              api.projectExecution.reportThreadId(sessionId, effectiveThreadId)
            } catch (e) {
              logger.system.warn('[ExecutionWindow] Failed to report threadId:', e)
            }
          } else {
            // 主窗口传了 threadId → 加载线程数据到 store + 切换
            try {
              const { ensureThreadLoaded, switchThread } = useAgentStore.getState()
              await ensureThreadLoaded(effectiveThreadId)
              switchThread(effectiveThreadId)
              logger.system.info('[ExecutionWindow] Thread loaded + set as current:', effectiveThreadId)
            } catch (e) {
              logger.system.warn('[ExecutionWindow] Thread load failed:', e)
            }
          }

          const initialTab: ExecutionTab = {
            id: sessionId || effectiveThreadId,
            projectId,
            projectName,
            sessionId,
            threadId: effectiveThreadId,
            initialMessage,
            silent,
            taskContext,
          }
          if (!cancelled) {
            setTabs([initialTab])
            setActiveTabId(initialTab.id)
          }
        }

        if (!cancelled) {
          setInitialized(true)
          onReady?.()
        }
      } catch (e) {
        logger.system.error('[ExecutionWindow] Init failed:', e)
        if (!cancelled) {
          setInitError(e instanceof Error ? e.message : String(e))
        }
      }
    }

    init()
    return () => { cancelled = true }
  }, [onReady])

  // ─── 初始化完成后发送初始任务消息 ────────────────────────
  // 主窗口只创建线程和构建消息，实际的 AI 执行由执行窗口完成。
  // 这样确保 store 状态在执行窗口进程中一致，ChatPanel 能实时显示流式输出。
  // ⚠️ 使用 threadId 作为去重键（而非 tab.id），因为同一个 Tab 可能切换到新线程
  //    （如用户在同一项目 Tab 中执行新任务），新线程需要重新发送消息。
  const sentMessagesRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!initialized || !activeTabId) return
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab?.initialMessage || !activeTab.threadId) return
    // 防止重复发送（React StrictMode 双调用 + 依赖变化）
    if (sentMessagesRef.current.has(activeTab.threadId)) return

    sentMessagesRef.current.add(activeTab.threadId)
    const { threadId, initialMessage, silent } = activeTab

    logger.system.info('[ExecutionWindow] Sending initial task message to thread:', threadId)
    sendToThread(initialMessage, threadId, { silent }).catch((e) => {
      logger.system.error('[ExecutionWindow] Failed to send initial message:', e)
    })
  }, [initialized, activeTabId, tabs, sendToThread])

  // ─── 任务完成监控：监听 EventBus loop:end 事件，可靠同步任务状态 ─
  //
  // ⚠️ 旧方案通过检测 streamState.phase 的 running → idle 转换来判断任务结束，
  //    但这依赖 React 渲染周期：某些模型响应极快（特别是无工具调用的纯文本响应），
  //    phase 从 idle → streaming → idle 的转换可能在同一同步执行栈中完成，
  //    React 来不及渲染中间状态，useEffect 只看到 idle → idle，导致任务状态不同步。
  //
  // 新方案使用 EventBus 的 'loop:end' 事件，它是同步事件发射器，不受 React 渲染周期影响，
  //    能 100% 可靠地捕获循环结束（无论模型响应快慢）。
  //
  // 根据 event.reason 精确判断任务状态：
  //   - 'complete' | 'tool_requested_stop' | 'max_iterations' → DONE，推进下一个
  //   - 'aborted' → CANCELED，不推进（用户主动停止）
  //   - 'error' | 'loop_detected' | 'no_messages' → 保持 IN_PROGRESS，不推进（任务失败）
  //   - 'waiting_for_user' | 'handoff_required' → 保持 IN_PROGRESS，不推进（等待用户输入）
  //
  // 用 ref 存储最新 tabs 引用，避免 EventBus 回调闭包陈旧问题
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const sendToThreadRef = useRef(sendToThread)
  sendToThreadRef.current = sendToThread
  // 记录已处理的 requestId，防止重复处理（EventBus 可能多次触发）
  const processedRequestIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!initialized) return

    const unsubscribe = EventBus.on('loop:end', (event) => {
      // 匹配对应的 tab
      const tab = tabsRef.current.find(t => t.threadId === event.threadId)
      if (!tab || !tab.taskContext) return

      // 防止重复处理同一个 requestId
      const requestKey = `${event.threadId}:${event.requestId ?? ''}`
      if (processedRequestIds.current.has(requestKey)) return
      processedRequestIds.current.add(requestKey)
      // 清理过期的 requestId（保持 Set 不过大）
      if (processedRequestIds.current.size > 100) {
        const entries = Array.from(processedRequestIds.current)
        processedRequestIds.current = new Set(entries.slice(-50))
      }

      const currentTaskId = tab.taskContext.taskIds[tab.taskContext.currentIndex]
      if (!currentTaskId) return

      const reason = event.reason
      logger.system.info('[ExecutionWindow] loop:end received, reason:', reason, 'taskId:', currentTaskId)

      // 根据结束原因判断任务状态
      const isSuccess = reason === 'complete' || reason === 'tool_requested_stop' || reason === 'max_iterations'
      const isAborted = reason === 'aborted'
      // error/loop_detected/no_messages/waiting_for_user/handoff_required → 保持 IN_PROGRESS

      if (isSuccess) {
        // 正常完成：标记为 DONE
        logger.system.info('[ExecutionWindow] Task completed, marking as DONE:', currentTaskId)
        tasksApi.update(currentTaskId, { status: 'DONE' }).catch((e) => {
          logger.system.warn('[ExecutionWindow] Failed to update task status to DONE:', e)
        })
      } else if (isAborted) {
        // 用户中止：标记为 CANCELED
        logger.system.info('[ExecutionWindow] Task aborted by user, marking as CANCELED:', currentTaskId)
        tasksApi.update(currentTaskId, { status: 'CANCELED' }).catch((e) => {
          logger.system.warn('[ExecutionWindow] Failed to update task status to CANCELED:', e)
        })
      } else {
        // 其他情况（error/waiting_for_user 等）：保持 IN_PROGRESS，不标记
        logger.system.info('[ExecutionWindow] Task not completed (reason:', reason, '), keeping IN_PROGRESS:', currentTaskId)
        return // 不推进下一个任务
      }

      // 批量模式：成功完成时推进下一个任务
      if (isSuccess) {
        const ctx = tab.taskContext
        const nextIndex = ctx.currentIndex + 1
        if (ctx.kind === 'batch' && nextIndex < ctx.taskIds.length) {
          const nextTaskId = ctx.taskIds[nextIndex]
          const totalTasks = ctx.taskIds.length
          const projectId = tab.projectId
          const threadId = tab.threadId
          const tabId = tab.id

          logger.system.info('[ExecutionWindow] Advancing to next task:', nextIndex + 1, '/', totalTasks)

          // 更新 taskContext.currentIndex
          setTabs((prev) => prev.map((t) =>
            t.id === tabId
              ? { ...t, taskContext: { ...t.taskContext!, currentIndex: nextIndex } }
              : t,
          ))

          // 异步获取下一个任务详情 + 构建 prompt + 发送
          ;(async () => {
            try {
              const result = await tasksApi.list({ projectId, limit: 200 })
              const allTasks: TaskItem[] = result.items || []
              const nextTask = allTasks.find((t) => t.id === nextTaskId)
              if (!nextTask) {
                logger.system.warn('[ExecutionWindow] Next task not found:', nextTaskId)
                return
              }

              // 标记新任务为 IN_PROGRESS
              await tasksApi.update(nextTaskId, { status: 'IN_PROGRESS' }).catch(() => {})

              // 前序已完成任务
              const previousTaskIds = ctx.taskIds.slice(0, nextIndex)
              const previousTasks = previousTaskIds
                .map((id: string) => allTasks.find((t) => t.id === id))
                .filter((t): t is NonNullable<typeof t> => !!t)

              const prompt = buildBatchNextTaskPrompt(nextTask, nextIndex, totalTasks, true, previousTasks)
              logger.system.info('[ExecutionWindow] Sending next task prompt, length:', prompt.length)
              sendToThreadRef.current(prompt, threadId, { silent: true }).catch((e) => {
                logger.system.error('[ExecutionWindow] Failed to send next task:', e)
              })
            } catch (e) {
              logger.system.error('[ExecutionWindow] Failed to advance to next task:', e)
            }
          })()
        } else {
          logger.system.info('[ExecutionWindow] All tasks completed for tab:', tab.id)
        }
      }
      // isAborted 时不推进后续任务
    })

    return unsubscribe
  }, [initialized])

  // ─── 订阅 IPC 事件：新增 Tab ────────────────────────────

  useEffect(() => {
    const unsub = api.projectExecution.onNewTab(async (params) => {
      // 通过 IPC 获取初始任务消息（避免 URL 长度限制）
      // ⚠️ key 使用 threadId || sessionId，与主进程 open() 存储时一致
      let initialMessage: string | undefined
      let silent = false
      let taskContext: ExecutionTab['taskContext'] = undefined
      const messageKey = params.threadId || params.sessionId
      try {
        const msgData = await api.projectExecution.getInitialMessage(messageKey)
        if (msgData) {
          initialMessage = msgData.message
          silent = msgData.silent
          if (msgData.taskContext) {
            taskContext = {
              taskIds: msgData.taskContext.taskIds,
              currentIndex: 0,
              kind: msgData.taskContext.kind,
            }
          }
          logger.system.info('[ExecutionWindow] New tab: initial message retrieved, length:', initialMessage.length)
        }
      } catch (e) {
        logger.system.warn('[ExecutionWindow] New tab: failed to get initial message:', e)
      }

      // 如果主窗口没传 threadId（空字符串），执行窗口自己创建线程
      let effectiveThreadId = params.threadId
      if (!effectiveThreadId) {
        const { createThread } = useAgentStore.getState()
        effectiveThreadId = createThread({ activate: true })
        logger.system.info('[ExecutionWindow] New tab: created new thread:', effectiveThreadId)

        // 通过 IPC 回传 threadId 给主窗口
        try {
          api.projectExecution.reportThreadId(params.sessionId, effectiveThreadId)
        } catch (e) {
          logger.system.warn('[ExecutionWindow] New tab: failed to report threadId:', e)
        }
      } else {
        // 主窗口传了 threadId → 加载线程数据到 store
        try {
          const { ensureThreadLoaded, switchThread } = useAgentStore.getState()
          await ensureThreadLoaded(effectiveThreadId)
          switchThread(effectiveThreadId)
        } catch (e) {
          logger.system.warn('[ExecutionWindow] New tab: thread load failed:', e)
        }
      }

      setTabs((prev) => {
        // 已存在同 projectId 的 Tab → 更新 threadId 并激活
        const existing = prev.find((t) => t.projectId === params.projectId)
        if (existing) {
          setActiveTabId(existing.id)
          // 更新已有 Tab 的 threadId 和 initialMessage
          return prev.map((t) =>
            t.id === existing.id
              ? { ...t, threadId: effectiveThreadId, initialMessage, silent, taskContext }
              : t,
          )
        }
        // 新增 Tab
        const newTab: ExecutionTab = {
          id: params.sessionId || effectiveThreadId,
          projectId: params.projectId,
          projectName: params.projectName,
          sessionId: params.sessionId,
          threadId: effectiveThreadId,
          initialMessage,
          silent,
          taskContext,
        }
        setActiveTabId(newTab.id)
        return [...prev, newTab]
      })
    })
    return unsub
  }, [])

  // ─── 激活 Tab 变化时：设置 currentThreadId ──────────────
  // ChatPanel 通过 useAgentViewState() 读取 currentThreadId，
  // 需要同步设置才能正确订阅对应线程的消息流。
  useEffect(() => {
    if (!activeTabId) return
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (activeTab?.threadId) {
      const { switchThread } = useAgentStore.getState()
      switchThread(activeTab.threadId)
    }
    // 切换 Tab 时重置产物数量（新 Tab 的 ExecutionFilePreview 会重新推送）
    setArtifactCount(0)
  }, [activeTabId, tabs])

  // ─── 获取项目目录路径（文件树根目录 + 工具放行路径）──────────
  // 优先从项目详情的 workspacePaths[0] 获取（创建项目时选择的目录），
  // 若项目未设置目录则回退到全局工作区 workspacePath。
  // 同时将该目录写入 store.allowedToolPaths，允许 AI 工具读写项目目录
  // （当项目目录不在工作区内时，避免 "Path is outside workspace" 错误）。
  useEffect(() => {
    if (!activeTabId) return
    const activeTab = tabs.find((t) => t.id === activeTabId)
    if (!activeTab?.projectId) return

    let cancelled = false
    ;(async () => {
      try {
        const project = await projectsApi.getById(activeTab.projectId)
        if (cancelled) return
        const projectDir = project.workspacePaths?.[0]
        const effectiveDir = projectDir || useStore.getState().workspacePath
        setProjectPath(effectiveDir)
        // 写入 store.allowedToolPaths，放行 AI 工具对该目录的读写
        useStore.getState().setAllowedToolPaths(effectiveDir ? [effectiveDir] : [])
        logger.system.info('[ExecutionWindow] Project directory:', effectiveDir)
      } catch (e) {
        if (cancelled) return
        logger.system.warn('[ExecutionWindow] Failed to load project directory:', e)
        // 加载失败也回退到全局工作区，保证文件树可用
        const fallback = useStore.getState().workspacePath
        setProjectPath(fallback)
        useStore.getState().setAllowedToolPaths(fallback ? [fallback] : [])
      }
    })()

    return () => { cancelled = true }
  }, [activeTabId, tabs])

  // ─── 最小化/恢复动画 IPC 监听 ──────────────────────────────

  useEffect(() => {
    const unsub = api.projectExecution.onStartMinimizeAnimation(async () => {
      try {
        const result = await api.projectExecution.getAvatarPosition()
        if (result.success && result.data) {
          setAvatarPos(result.data)
        }
      } catch (e) {
        logger.system.warn('[ExecutionWindow] Get avatar position failed:', e)
      }
      setAnimState('minimizing')
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = api.projectExecution.onStartRestoreAnimation(async () => {
      try {
        const result = await api.projectExecution.getAvatarPosition()
        if (result.success && result.data) {
          setAvatarPos(result.data)
        }
      } catch (e) {
        logger.system.warn('[ExecutionWindow] Get avatar position failed:', e)
      }
      setAnimState('restoring')
      setTimeout(() => setAnimState('visible'), ANIM_DURATION)
    })
    return unsub
  }, [])

  // ─── 推送执行状态到主进程 ─────────────────────────────────

  useEffect(() => {
    if (!initialized || tabs.length === 0) return

    const sessions = tabs.map((tab, index) => {
      const phase = tabPhases[index] ?? 'idle'
      const isRunning = phase === 'streaming' || phase === 'tool_running' || phase === 'tool_pending'

      return {
        id: tab.id,
        projectName: tab.projectName,
        status: isRunning ? 'running' as const : 'completed' as const,
        kind: 'task' as const,
      }
    })

    const runningCount = sessions.filter((s) => s.status === 'running').length

    const payload = {
      activeCount: runningCount,
      runningCount,
      queuedCount: 0,
      sessions,
    }

    // 状态摘要未变化时不广播：流式期间本组件不会因内容变化重渲染，
    // 但仍需拦住 Tab 列表变化带来的重复推送，避免主窗口与悬浮球无谓重渲染。
    const signature = JSON.stringify(payload)
    if (lastPushedStatusRef.current === signature) return
    lastPushedStatusRef.current = signature

    api.projectExecution.pushStatus(payload)
  }, [initialized, tabs, tabPhases])

  // ─── Tab 操作 ────────────────────────────────────────────

  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const handleTabClose = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId)
      if (activeTabId === tabId) {
        setActiveTabId(next[0]?.id ?? null)
      }
      // 无 Tab 剩余 → 关闭窗口
      if (next.length === 0) {
        api.projectExecution.close()
      }
      return next
    })
  }, [activeTabId])

  // ─── 任务列表点击：切换到该任务的执行线程 ──────────────────
  const handleTaskSelect = useCallback((task: { threadId: string | null; id: string }) => {
    if (!task.threadId || !activeTabId) return

    // 更新当前 Tab 的 threadId（切换到该任务的线程）
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, threadId: task.threadId! } : t,
      ),
    )

    // 加载线程消息历史 + 设置为当前线程
    const { switchThread } = useAgentStore.getState()
    switchThread(task.threadId)
  }, [activeTabId])

  // ─── 重新执行任务：重置状态 + 创建新线程执行 ──────────────
  // 用户点击已完成/已取消任务的"重新执行"按钮时：
  // 1. 重置任务状态为 TODO，清除旧 threadId
  // 2. 创建新线程，构建任务 prompt 并发送
  // 3. 更新当前 Tab 的 threadId 和 taskContext
  const handleReExecuteTask = useCallback(async (task: TaskItem) => {
    if (!activeTabId) return
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return

    try {
      // 1. 重置任务状态为 TODO，清除旧 threadId
      await tasksApi.update(task.id, { status: 'TODO', threadId: null })
      logger.system.info('[ExecutionWindow] Task reset for re-execution:', task.id)

      // 2. 创建新线程
      const { createThread, switchThread } = useAgentStore.getState()
      const newThreadId = createThread({ activate: true })
      switchThread(newThreadId)

      // 3. 更新任务 threadId 到后端
      try {
        await tasksApi.update(task.id, { status: 'IN_PROGRESS', threadId: newThreadId })
      } catch (e) {
        logger.system.warn('[ExecutionWindow] Failed to update task threadId:', e)
      }

      // 4. 更新当前 Tab 的 threadId 和 taskContext
      setTabs((prev) => prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              threadId: newThreadId,
              taskContext: {
                taskIds: [task.id],
                currentIndex: 0,
                kind: 'task',
              },
            }
          : t,
      ))

      // 5. 构建任务 prompt 并发送
      //    使用 buildBatchNextTaskPrompt（不需要 ProjectContext，适用于执行窗口）
      //    taskIndex=0, totalTasks=1 表示单任务执行
      const prompt = buildBatchNextTaskPrompt(task, 0, 1, true, [])
      logger.system.info('[ExecutionWindow] Re-execution prompt built, length:', prompt.length)

      sendToThread(prompt, newThreadId, { silent: true }).catch((e) => {
        logger.system.error('[ExecutionWindow] Failed to send re-execution prompt:', e)
      })
    } catch (e) {
      logger.system.error('[ExecutionWindow] Re-execution failed:', e)
    }
  }, [activeTabId, tabs, sendToThread])

  // ─── 文件树点击：用主窗口编辑器打开文件 ──────────────────────
  // 复用主窗口的 openFile action：读取文件内容 → 写入 store.openFiles → Editor 自动渲染
  // 与主窗口文件树点击行为完全一致（支持代码编辑、Markdown/图片/PDF/Word/PPT/Excel 预览）
  const handleFileSelect = useCallback(async (filePath: string) => {
    try {
      // 判断文件类型：图片/二进制无需读取内容
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)
      const isBinary = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(ext)
      if (isImage || isBinary) {
        useStore.getState().openFile(filePath, '')
        useStore.getState().setActiveFile(filePath)
        return
      }
      const content = await api.file.read(filePath)
      if (content !== null) {
        useStore.getState().openFile(filePath, content)
        useStore.getState().setActiveFile(filePath)
      } else {
        logger.system.warn('[ExecutionWindow] File read returned null:', filePath)
      }
    } catch (e) {
      logger.system.error('[ExecutionWindow] Failed to open file:', e)
    }
  }, [])

  // ─── 面板拖拽调整大小 ────────────────────────────────────

  const dragSessionRef = useRef<{
    originX: number
    baseWidth: number
    target: 'taskList' | 'chat'
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const startDrag = useCallback(
    (e: React.MouseEvent, target: 'taskList' | 'chat') => {
      e.preventDefault()
      const baseWidth = target === 'taskList' ? taskListWidth : chatWidth
      dragSessionRef.current = { originX: e.clientX, baseWidth, target }
      setIsDragging(true)
      document.body.style.cursor = 'col-resize'
    },
    [taskListWidth, chatWidth],
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const session = dragSessionRef.current
      if (!session) return

      const delta = e.clientX - session.originX

      if (session.target === 'taskList') {
        // 左栏在左侧：向右拖（delta>0）→ 左栏变宽
        const raw = session.baseWidth + delta
        const clamped = Math.min(TASK_LIST_MAX_WIDTH, Math.max(TASK_LIST_MIN_WIDTH, raw))
        setTaskListWidth(clamped)
      } else {
        // 聊天在右侧：向右拖（delta>0）→ 聊天变窄（delta 取反）
        const raw = session.baseWidth - delta
        const clamped = Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, raw))
        setChatWidth(clamped)
      }
    }

    const handleMouseUp = () => {
      dragSessionRef.current = null
      setIsDragging(false)
      document.body.style.cursor = 'default'
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    // 全屏遮罩，阻止文本选中和 iframe 拦截事件
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize'
    document.body.appendChild(overlay)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      overlay.remove()
    }
  }, [isDragging])

  // ─── 左侧面板垂直拖拽（文件树 | 任务列表）─────────────────
  const vDragSessionRef = useRef<{ originY: number; baseHeight: number } | null>(null)
  const [isVDragging, setIsVDragging] = useState(false)

  const startVDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // 用户手动拖拽后，停止自动 1:1 调整
    userResizedVRef.current = true
    vDragSessionRef.current = { originY: e.clientY, baseHeight: fileTreeHeight }
    setIsVDragging(true)
    document.body.style.cursor = 'row-resize'
  }, [fileTreeHeight])

  useEffect(() => {
    if (!isVDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const session = vDragSessionRef.current
      if (!session) return
      const delta = e.clientY - session.originY
      // 文件树高度 = 基础高度 + 鼠标向下移动量
      const raw = session.baseHeight + delta
      // 左侧面板总高度需要动态获取（无法直接知道，用窗口高度估算）
      const maxHeight = window.innerHeight - TASK_LIST_MIN_HEIGHT - 100 // 减去标题栏等固定高度
      const clamped = Math.min(maxHeight, Math.max(FILE_TREE_MIN_HEIGHT, raw))
      setFileTreeHeight(clamped)
    }

    const handleMouseUp = () => {
      vDragSessionRef.current = null
      setIsVDragging(false)
      document.body.style.cursor = 'default'
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:row-resize'
    document.body.appendChild(overlay)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      overlay.remove()
    }
  }, [isVDragging])

  // ─── 渲染 ────────────────────────────────────────────────

  if (initError) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-text-primary gap-3">
        <p className="text-[14px] font-medium">初始化失败</p>
        <p className="text-[12px] text-text-muted max-w-md text-center">{initError}</p>
        <button
          onClick={() => api.projectExecution.close()}
          className="mt-2 px-4 py-1.5 rounded-lg bg-surface-hover text-[12px] hover:bg-surface-hover/70"
        >
          关闭窗口
        </button>
      </div>
    )
  }

  // 初始化期间保持 HTML loader 显示（由 executionEntry.tsx 的 removeLoader 控制）
  // 这里返回 null，让 #execution-loader 继续可见，避免黑屏闪烁
  if (!initialized) {
    return null
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // 计算缩放动画的 transform-origin（朝向悬浮球方向）
  const transformOrigin = avatarPos
    ? (() => {
        const screenW = window.screen.width
        const screenH = window.screen.height
        const isRight = avatarPos.x > screenW / 2
        const isBottom = avatarPos.y > screenH / 2
        return isRight
          ? (isBottom ? 'bottom right' : 'top right')
          : (isBottom ? 'bottom left' : 'top left')
      })()
    : 'bottom right'

  // 动画变体
  const animVariants = {
    visible: { scale: 1, opacity: 1, filter: 'blur(0px)' },
    minimizing: {
      scale: 0.05,
      opacity: 0,
      filter: 'blur(4px)',
      transition: { duration: 0.2, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
    },
    restoring: {
      scale: 1,
      opacity: 1,
      filter: 'blur(0px)',
      transition: { duration: 0.25, ease: [0, 0, 0.2, 1] as [number, number, number, number] },
    },
  }

  return (
    <ToastProvider>
      <GlobalErrorHandler>
        <ThemeManager>
          {/* 全局 Toast 容器（渲染右上角通知卡片） */}
          <GlobalToastContainer />
          {/* 全局决策弹窗（PendingChangesBar 全部拒绝二次确认等场景依赖） */}
          <GlobalDecisionOverlay />
          <motion.div
            className="flex flex-col h-full bg-background overflow-hidden"
            style={{ transformOrigin }}
            animate={animState}
            variants={animVariants}
            initial="visible"
          >
            {/* 标题栏 */}
            <ExecutionWindowTitleBar
              projectName={activeTab?.projectName ?? ''}
              onMinimize={() => api.projectExecution.minimize()}
              onClose={() => api.projectExecution.close()}
            />

            {/* Tab 栏（多项目时显示） */}
            {tabs.length > 1 && (
              <ExecutionTabBar
                tabs={tabs}
                activeTabId={activeTabId ?? ''}
                onSwitch={handleTabSwitch}
                onClose={handleTabClose}
              />
            )}

            {/* 主体布局：左栏(文件树+任务列表) | 中栏(文件预览) | 右栏(聊天) */}
            <div className="flex flex-1 min-h-0">
              {/* 左栏：上下分栏（上=项目文件树，下=任务列表），可拖拽中间分割线 */}
              <div
                ref={leftPanelRef}
                className="flex-shrink-0 flex flex-col min-h-0 relative overflow-hidden border-r border-border/30 bg-surface"
                style={{ width: `${taskListWidth}px` }}
              >
                {/* 上栏：项目文件树 */}
                <div
                  className="flex-shrink-0 overflow-hidden"
                  style={{ height: `${fileTreeHeight}px`, minHeight: FILE_TREE_MIN_HEIGHT }}
                >
                  <ExecutionFileTree
                    workspacePath={projectPath}
                    onFileSelect={handleFileSelect}
                  />
                </div>

                {/* 垂直分割线（上下拖拽调整文件树/任务列表高度） */}
                <Divider
                  orientation="vertical"
                  onMouseDown={startVDrag}
                />

                {/* 下栏：任务列表（占满剩余空间） */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {activeTab ? (
                    <ExecutionTaskList
                      projectId={activeTab.projectId}
                      threadId={activeTab.threadId}
                      onTaskSelect={handleTaskSelect}
                      onReExecuteTask={handleReExecuteTask}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-text-muted text-[12px]">
                      无执行中的任务
                    </div>
                  )}
                </div>
              </div>

              {/* 分隔条 1：左栏 | 文件预览 */}
              <Divider orientation="horizontal" onMouseDown={(e) => startDrag(e, 'taskList')} />

              {/* 中栏：文件编辑器/预览（复用主窗口 Editor 组件） */}
              {/* 无打开文件时隐藏中栏 + 分隔条 2，聊天窗口占满空间 */}
              {hasOpenFiles ? (
                <>
                  <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
                    <React.Suspense
                      fallback={
                        <div className="flex items-center justify-center h-full text-text-muted text-[13px]">
                          加载编辑器...
                        </div>
                      }
                    >
                      <Editor />
                    </React.Suspense>
                  </div>

                  {/* 分隔条 2：文件预览 | 聊天 */}
                  <Divider orientation="horizontal" onMouseDown={(e) => startDrag(e, 'chat')} />
                </>
              ) : null}

              {/* 右栏：AI 执行聊天（有文件预览时固定宽度，无文件时 flex-1 占满） */}
              {/* ⚠️ ChatPanel 根 div 是 absolute inset-0，必须提供 relative 父容器 */}
              <div
                className={`flex flex-col min-w-0 min-h-0 relative overflow-hidden ${
                  hasOpenFiles ? 'flex-shrink-0' : 'flex-1'
                }`}
                style={hasOpenFiles ? { width: `${chatWidth}px` } : undefined}
              >
                {activeTab ? (
                  <ChatPanel />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-text-muted text-[13px]">
                    无执行中的任务
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </ThemeManager>
      </GlobalErrorHandler>
    </ToastProvider>
  )
}

// ============================================
// 子组件：可拖拽分隔条（支持横向/纵向两种方向）
// ============================================

interface DividerProps {
  /** 方向：horizontal=竖条（左右分栏，col-resize）；vertical=横条（上下分栏，row-resize） */
  orientation?: 'horizontal' | 'vertical'
  onMouseDown: (e: React.MouseEvent) => void
}

function Divider({ orientation = 'horizontal', onMouseDown }: DividerProps) {
  const isVertical = orientation === 'vertical'
  return (
    <div
      onMouseDown={onMouseDown}
      className={`flex-shrink-0 bg-border/30 hover:bg-accent/40 transition-colors group relative ${
        isVertical
          ? 'h-1 w-full cursor-row-resize'
          : 'w-1 h-full cursor-col-resize'
      }`}
      style={{ zIndex: 5 }}
    >
      {/* 拖拽热区扩大（视觉 4px，热区 8px） */}
      <div
        className={isVertical
          ? 'absolute inset-x-0 -top-1.5 -bottom-1.5'
          : 'absolute inset-y-0 -left-1.5 -right-1.5'}
      />
    </div>
  )
}
