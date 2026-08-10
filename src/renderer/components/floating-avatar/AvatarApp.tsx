/**
 * AvatarApp - 悬浮头像窗口顶层组件
 *
 * 整合语音唤醒、语音对话、迷你聊天、3D 球体，构成完整的悬浮头像体验。
 *
 * 三态状态机：
 * ┌─────────┐  点击球体      ┌──────────────┐
 * │  idle   │ ─────────────→ │   chat       │  手动点击 → 迷你文本聊天
 * │(唤醒检测)│                │ (迷你聊天窗)  │
 * └─────────┘ ←───────────── └──────────────┘
 *     │         关闭按钮          │ 麦克风按钮
 *     │ 唤醒词命中               ↓
 *     │                 ┌──────────────┐
 *     └───────────────→ │   voice      │  唤醒词 → 语音对话
 *                       │ (语音对话)    │
 *                       └──────────────┘
 * idle ← 关闭/结束指令 ─ voice
 *
 * idle 状态：
 * - 唤醒引擎运行（若开关开启且未暂停）
 * - 窗口收起（48×48，仅显示静态头像）
 * - 静态头像 + 唤醒检测脉冲指示
 *
 * chat 状态（手动点击触发）：
 * - 唤醒引擎暂停
 * - 窗口展开（340×480，显示迷你聊天面板）
 * - 纯文本输入 + 流式 LLM 输出
 * - 麦克风按钮可切换到 voice 状态
 *
 * voice 状态（唤醒词触发）：
 * - 唤醒引擎暂停
 * - 窗口展开（340×480，显示 3D 球体 + 对话面板）
 * - 3D 球体配色随语音状态变化
 * - 语音状态转发到主进程
 *
 * 交互：
 * - 点击球体（idle）：打开迷你聊天
 * - 拖拽球体：移动窗口位置（主进程原生拖拽，setInterval 轮询鼠标坐标）
 * - 对话面板关闭按钮：结束对话/聊天
 * - 用户说"结束对话"：自动结束（useVoiceChat 内部检测）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { useAvatarBridge } from '../../composables/useAvatarBridge'
import { useWakeWordEngine } from '../../composables/useWakeWordEngine'
import { useAvatarVoiceChat } from '../../composables/useAvatarVoiceChat'
import { useAvatarMiniChat, type ChatAttachment } from '../../composables/useAvatarMiniChat'
import { AvatarStatic } from './AvatarStatic'
import { MiniChatPanel } from './MiniChatPanel'
import { ImmersiveVoiceView } from '../voice/ImmersiveVoiceView'
import { AvatarExecutionStatus } from './AvatarExecutionStatus'

// ============================================
// 常量
// ============================================

/** 拖拽阈值（px），超过此距离判定为拖拽而非点击 */
const DRAG_THRESHOLD = 5

/** 头像模式 */
type AvatarMode = 'idle' | 'chat' | 'voice'

// ============================================
// 主组件
// ============================================

export interface AvatarAppProps {
  /** React 挂载就绪回调（移除加载占位） */
  onReady?: () => void
}

export function AvatarApp({ onReady }: AvatarAppProps) {
  // IPC 桥接
  const bridge = useAvatarBridge()

  // 语言
  const language = bridge.voiceContext?.language || 'zh'

  // 模式状态机
  const [mode, setMode] = useState<AvatarMode>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)

  /** 清除错误提示（ImmersiveVoiceView 的 onDismissError 回调） */
  const dismissError = useCallback(() => setErrorMessage(null), [])

  // 拖拽状态
  const dragStateRef = useRef<{
    /** mousedown 已触发，等待阈值判断 */
    pending: boolean
    /** 已超过阈值，正在拖拽 */
    dragging: boolean
    /** mousedown 时的屏幕坐标 */
    startX: number
    startY: number
  }>({ pending: false, dragging: false, startX: 0, startY: 0 })

  /** 当前是否展开（chat / voice 状态都展开窗口） */
  const isExpanded = mode !== 'idle'

  // --------------------------------------------
  // 唤醒引擎（idle 状态运行，chat/voice 状态暂停）
  // --------------------------------------------
  const wakeWordEnabled = bridge.wakeWordConfig?.enabled ?? false
  const wakeWordPaused = isExpanded || bridge.mainConversationActive

  const handleWakeWordDetected = useCallback(
    (info: { keyword: string; transcript: string; confidence: number }) => {
      logger.system.info('[AvatarApp] Wake word detected, starting voice conversation', info)
      void startVoiceConversation(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge.voiceContext],
  )

  const wakeWordEngine = useWakeWordEngine({
    enabled: wakeWordEnabled,
    keyword: bridge.wakeWordConfig?.keyword || '小喵小喵',
    sensitivity: bridge.wakeWordConfig?.sensitivity || 'balanced',
    cooldownMs: bridge.wakeWordConfig?.cooldownMs ?? 3000,
    minSpeechMs: bridge.wakeWordConfig?.minSpeechMs ?? 300,
    paused: wakeWordPaused,
    onWakeWordDetected: handleWakeWordDetected,
    onError: (msg) => {
      logger.system.warn('[AvatarApp] Wake word engine error:', msg)
      setErrorMessage(msg)
      setTimeout(() => setErrorMessage(null), 3000)
    },
  })

  // --------------------------------------------
  // 语音对话（voice 状态使用）
  // --------------------------------------------
  const handleVoiceStateChanged = useCallback(
    (state: string, volume: number) => {
      void bridge.notifyVoiceStateChanged({
        state: state as 'idle' | 'listening' | 'recording' | 'processing' | 'speaking' | 'error',
        volume,
      })
    },
    [bridge],
  )

  const handleConversationComplete = useCallback(
    (
      userText: string,
      aiText: string,
      toolCallRecords?: Array<{
        id: string
        name: string
        args: Record<string, unknown>
        success: boolean
        resultSummary: string
      }>,
    ) => {
      void bridge.notifySaveConversation({ userText, aiText, toolCallRecords })
    },
    [bridge],
  )

  const voiceChat = useAvatarVoiceChat({
    voiceContext: bridge.voiceContext,
    onStateChanged: handleVoiceStateChanged,
    onConversationComplete: handleConversationComplete,
    onError: (msg) => {
      setErrorMessage(msg)
      setTimeout(() => setErrorMessage(null), 5000)
    },
  })

  // --------------------------------------------
  // 迷你聊天（chat 状态使用，带工具调用）
  // --------------------------------------------
  const miniChat = useAvatarMiniChat({
    voiceContext: bridge.voiceContext,
    onConversationComplete: (userText, aiText, toolCallRecords) => {
      // 对话完成后保存到聊天历史（含工具调用记录）
      void bridge.notifySaveConversation({ userText, aiText, toolCallRecords })
    },
    onError: (msg) => {
      setErrorMessage(msg)
      setTimeout(() => setErrorMessage(null), 5000)
    },
  })

  // --------------------------------------------
  // 模式切换控制
  // --------------------------------------------

  /** 打开迷你聊天（手动点击触发） */
  const openMiniChat = useCallback(async () => {
    if (mode !== 'idle') return
    if (!bridge.voiceContext) {
      logger.system.warn('[AvatarApp] No voice context, cannot open mini chat')
      setErrorMessage(bridge.voiceContext === null ? '正在加载配置...' : '配置缺失')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }

    setMode('chat')
    setErrorMessage(null)

    // 展开窗口
    try {
      await api.floatingAvatar.expand()
    } catch (err) {
      logger.system.warn('[AvatarApp] Failed to expand window:', err)
    }
  }, [mode, bridge.voiceContext])

  /** 启动语音对话
   *  @param withGreeting 是否播放问候语（仅唤醒词触发时为 true，手动切换不播放）
   */
  const startVoiceConversation = useCallback(async (withGreeting = false) => {
    if (mode === 'voice') return
    if (!bridge.voiceContext) {
      logger.system.warn('[AvatarApp] No voice context, cannot start voice conversation')
      setErrorMessage(bridge.voiceContext === null ? '正在加载配置...' : '配置缺失')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }

    // 如果之前在 chat 模式，先中止文本生成
    if (mode === 'chat') {
      miniChat.abort()
    }

    setMode('voice')
    setErrorMessage(null)

    // 展开窗口（如果还没展开）
    if (mode === 'idle') {
      try {
        await api.floatingAvatar.expand()
      } catch (err) {
        logger.system.warn('[AvatarApp] Failed to expand window:', err)
      }
    }

    // 请求麦克风权限（macOS）
    const granted = await bridge.requestMicPermission()
    if (!granted) {
      setErrorMessage('麦克风权限被拒绝')
      setTimeout(() => setErrorMessage(null), 5000)
      setMode('idle')
      try {
        await api.floatingAvatar.collapse()
      } catch {
        /* ignore */
      }
      return
    }

    // 连接语音对话
    try {
      await voiceChat.connect()
      logger.system.info('[AvatarApp] Voice conversation started')

      // 仅唤醒词触发时播放问候语，手动切换不播放
      if (withGreeting) {
        const greeting = language === 'zh' ? '在呢' : 'Yes?'
        try {
          await voiceChat.speakGreeting(greeting)
        } catch (err) {
          logger.system.warn('[AvatarApp] Greeting failed, continuing:', err)
        }
      }
    } catch (err) {
      logger.system.error('[AvatarApp] Failed to start voice conversation:', err)
      setErrorMessage((err as Error).message || '启动对话失败')
      setMode('idle')
      try {
        await api.floatingAvatar.collapse()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bridge.voiceContext, bridge, language])

  /** 回到 idle 状态（关闭聊天/语音） */
  const returnToIdle = useCallback(async () => {
    // 停止语音对话
    if (mode === 'voice') {
      try {
        voiceChat.disconnect()
      } catch {
        /* ignore */
      }
    }
    // 中止文本生成
    if (mode === 'chat') {
      miniChat.abort()
    }

    setMode('idle')

    // 收起窗口
    try {
      await api.floatingAvatar.collapse()
    } catch (err) {
      logger.system.warn('[AvatarApp] Failed to collapse window:', err)
    }

    logger.system.info('[AvatarApp] Returned to idle')
  }, [mode, voiceChat, miniChat])

  // --------------------------------------------
  // 组件就绪通知
  // --------------------------------------------
  useEffect(() => {
    if (bridge.ready) {
      onReady?.()
    }
  }, [bridge.ready, onReady])

  // --------------------------------------------
  // 截图提问：接收主进程推送的截图 → 切换 chat 模式 → 作为附件添加到输入框（不自动发送）
  // 用户自行输入问题后点发送，实现「截图 → 添加附件 → 输入问题 → 发送」流程
  // --------------------------------------------
  const openMiniChatRef = useRef(openMiniChat)
  openMiniChatRef.current = openMiniChat

  // 外部注入到 MiniChatPanel 的待添加附件（截图提问结果，消费后置 null）
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null)
  // 稳定引用：避免每次渲染创建新函数导致 MiniChatPanel useEffect 重跑
  const handlePendingAttachmentConsumed = useCallback(() => {
    setPendingAttachment(null)
  }, [])

  useEffect(() => {
    const unsubscribe = bridge.onScreenshotResult(async (payload) => {
      logger.system.info(
        `[AvatarApp] Screenshot received: ${payload.width}x${payload.height}, adding as attachment`,
      )

      // 1. 先切换到 chat 模式（如果尚未在 chat 模式）
      if (mode !== 'chat') {
        await openMiniChatRef.current()
      }

      // 2. 构造图片附件
      //    previewUrl 用 dataUrl（无需 createObjectURL，revokeObjectURL 对 dataUrl 是 no-op 安全）
      //    name 用落盘文件名（来自 .aweeclaw/screenshot/screenshot_xxx.png）
      const attachment: ChatAttachment = {
        id: `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file: new File(
          [Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0))],
          payload.fileName || `screenshot_${Date.now()}.png`,
          { type: payload.mediaType },
        ),
        previewUrl: `data:${payload.mediaType};base64,${payload.base64}`,
        base64: payload.base64,
        isImage: true,
        mediaType: payload.mediaType,
        name: payload.fileName || `截图 ${payload.width}×${payload.height}`,
      }

      // 3. 等待 chat 模式渲染稳定后再注入附件
      //    setMode('chat') 触发的 React 渲染 + 窗口 expand 动画需要时间，
      //    若立即 setPendingAttachment，MiniChatPanel 可能尚未挂载，props 虽会传递但
      //    expand 动画期间的 resize 可能干扰附件区渲染。
      //
      //    注意：不用 requestAnimationFrame。截图流程中窗口经历了 hide → show，
      //    document.visibilityState 从 hidden 恢复到 visible 有延迟，rAF 可能不执行。
      //    setTimeout 不受 visibilityState 影响，更可靠。
      //    - 已在 chat 模式（迷你助手按钮路径）：短延迟 50ms 等 React 状态同步
      //    - 刚切换到 chat 模式（右键菜单路径）：100ms 等 expand 动画 + 渲染稳定
      const delay = mode === 'chat' ? 50 : 100
      setTimeout(() => setPendingAttachment(attachment), delay)
    })
    return unsubscribe
  }, [bridge, mode])

  // --------------------------------------------
  // 拖拽处理（主进程原生拖拽：setInterval 轮询鼠标坐标）
  // --------------------------------------------
  // 流程：
  // 1. mousedown → 记录起点，标记 pending
  // 2. mousemove → 若超过阈值，发 drag-start（主进程接管，开始轮询移动窗口）
  // 3. mouseup → 若在拖拽中，发 drag-end（主进程停止 + 边缘吸附）；若未拖拽，触发点击
  //
  // 主进程在收到 drag-start 后用 setInterval 轮询 screen.getCursorScreenPoint()，
  // 不依赖渲染进程 mousemove，因此鼠标移出窗口也能继续拖拽。

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 仅左键触发拖拽
      if (e.button !== 0) return
      dragStateRef.current = {
        pending: true,
        dragging: false,
        startX: e.screenX,
        startY: e.screenY,
      }
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds.pending || ds.dragging) return

      const dx = e.screenX - ds.startX
      const dy = e.screenY - ds.startY

      // 超过阈值 → 通知主进程接管拖拽
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        ds.dragging = true
        const channels = bridge.dragChannels
        if (channels) {
          api.floatingAvatar.sendDragStart(channels.start)
        }
      }
    },
    [bridge.dragChannels],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const ds = dragStateRef.current
      const wasDrag = ds.dragging

      // 若在拖拽中，通知主进程结束（触发边缘吸附 + 持久化）
      if (wasDrag) {
        const channels = bridge.dragChannels
        if (channels) {
          api.floatingAvatar.sendDragEnd(channels.end)
        }
      }

      // 重置状态
      dragStateRef.current = { pending: false, dragging: false, startX: 0, startY: 0 }

      // 如果不是拖拽（是点击），触发点击行为
      if (!wasDrag && e.button === 0) {
        // idle 状态点击 → 打开迷你聊天
        if (mode === 'idle') {
          void openMiniChat()
        }
        // chat/voice 状态点击球体不做操作（避免误触）
      }
    },
    [bridge.dragChannels, mode, openMiniChat],
  )

  // 全局 mouseup 兜底（鼠标移出窗口后释放时也能发 drag-end）
  // 注意：必须用 bubble 阶段（默认），不能用 capture。
  // React 合成事件在 root container 的 bubble 阶段处理，先于 window 的 bubble 事件执行。
  // 如果用 capture:true，全局 mouseup 会先于 React 重置 dragging=false，
  // 导致 React onMouseUp 误判为点击 → 拖拽释放后弹出聊天框。
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      const ds = dragStateRef.current
      if (!ds.pending) return // 没有 mousedown，忽略

      // 如果正在拖拽，发 drag-end
      if (ds.dragging) {
        const channels = bridge.dragChannels
        if (channels) {
          api.floatingAvatar.sendDragEnd(channels.end)
        }
      }

      // 重置状态（React onMouseUp 会在窗口内先执行并重置；
      // 此处仅在鼠标移出窗口释放时作为兜底）
      ds.pending = false
      ds.dragging = false
    }
    // bubble 阶段：React 合成事件先执行，此处仅兜底
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [bridge.dragChannels])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------

  const voiceState = voiceChat.state

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        // chat 模式：留 padding + overflow visible + 圆角面板
        // idle 模式：overflow visible（让 Pill 不被裁剪），球体自身的圆角由球体包裹 div 控制
        // voice 模式：overflow hidden
        padding: mode === 'chat' ? '6px' : 0,
        overflow: mode === 'voice' ? 'hidden' : 'visible',
        background: 'transparent',
        borderRadius: isExpanded ? '16px' : '0',
        transition: 'border-radius 0.3s ease',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {mode === 'idle' && (
        /* ============ idle：静态头像（可拖拽区域） ============ */
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            cursor: 'pointer',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* 执行状态指示器（球体上方，有项目任务执行时显示） */}
          <AvatarExecutionStatus
            status={bridge.executionStatus}
            edge={bridge.statusEdge}
            onClick={() => {
              // 点击恢复执行窗口（从悬浮球展开）
              api.projectExecution.restore()
            }}
          />
          {/* 球体固定在窗口底部（41×41），根据状态栏边缘方向定位 */}
          {/* - edge=null（未扩展）：球体居中（窗口=球体宽度 41px） */}
          {/* - edge='right'（靠右）：球体在窗口右下角（right: 0），tooltip 向左延伸 */}
          {/* - edge='left'（靠左）：球体在窗口左下角（left: 0），tooltip 向右延伸 */}
          <div style={{
            width: '41px',
            height: '41px',
            position: 'absolute',
            bottom: 0,
            ...(bridge.statusEdge === 'right'
              ? { right: 0 }
              : bridge.statusEdge === 'left'
                ? { left: 0 }
                : { left: '50%', transform: 'translateX(-50%)' }),
            borderRadius: '50%',
            overflow: 'hidden',
          }}>
            <AvatarStatic
              wakeWordActive={wakeWordEngine.running && !wakeWordEngine.cooling}
              cooling={wakeWordEngine.cooling}
              transcribing={wakeWordEngine.transcribing}
              isHovered={isHovered}
              language={language}
            />
          </div>
        </div>
      )}

      {mode === 'chat' && (
        /* ============ chat：迷你聊天面板 ============ */
        <MiniChatPanel
          messages={miniChat.messages}
          streaming={miniChat.streaming}
          activity={miniChat.activity}
          pendingApproval={miniChat.pendingApproval}
          language={language}
          errorMessage={errorMessage}
          onSend={miniChat.send}
          onAbort={miniChat.abort}
          onClear={miniChat.clear}
          onClose={() => void returnToIdle()}
          onSwitchToVoice={() => void startVoiceConversation()}
          onOpenMain={() => {
            void bridge.openMainWindow()
            void returnToIdle()
          }}
          onApproveAll={miniChat.approveAll}
          onRejectAll={miniChat.rejectAll}
          currentProvider={(bridge.voiceContext?.llmConfig as { provider?: string } | null)?.provider}
          currentModel={(bridge.voiceContext?.llmConfig as { model?: string } | null)?.model}
          cloudMode={bridge.voiceContext?.cloudMode}
          llmConfig={bridge.voiceContext?.llmConfig}
          authorizationMode={bridge.voiceContext?.authorizationMode}
          workMode={bridge.voiceContext?.workMode ?? undefined}
          pendingAttachment={pendingAttachment}
          onPendingAttachmentConsumed={handlePendingAttachmentConsumed}
        />
      )}

      {mode === 'voice' && (
        /* ============ voice：沉浸式语音对话（与主窗口语音对话页面一致） ============ */
        <ImmersiveVoiceView
          state={voiceState}
          volume={voiceChat.volume}
          isMuted={voiceChat.isMuted}
          streamEntries={voiceChat.streamEntries}
          activityStatus={voiceChat.activityStatus}
          errorMessage={errorMessage}
          isZh={language === 'zh'}
          onClose={() => void returnToIdle()}
          onInterrupt={voiceChat.interrupt}
          onToggleMute={voiceChat.toggleMute}
          onDismissError={dismissError}
          onMinimize={() => {
            // 「浮动模式」按钮：迷你助手没有浮动窗口，切回文本聊天模式
            voiceChat.disconnect()
            setMode('chat')
          }}
        />
      )}
    </div>
  )
}
