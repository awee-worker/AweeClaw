/**
 * MiniChatPanel - 悬浮头像迷你聊天面板（普通聊天窗口的缩小版）
 *
 * 布局与普通聊天窗口一致：
 * - 消息列表内容居中（max-width 800px），用户气泡右、AI 气泡左
 * - 底部输入区居中（max-width 840px），附件 + 模型选择 + 输入框 + 发送
 * - 完整工具栏始终展示（窗口最小宽度 960px，无需响应式收起）
 *
 * 特性：
 * - 纯文本输入 + 流式 LLM 输出（带工具调用循环）
 * - 支持图片/文件附件上传（多模态消息）
 * - 支持模型切换（通过 IPC 从主窗口获取模型列表）
 * - 工具调用状态实时展示（正在执行/已完成/失败）
 * - 发送/语音按钮合并：有内容→发送，无内容→语音，流式中→停止
 * - 主题色跟随系统（CSS 变量 var(--accent) 等）
 *
 * 布局（展开窗口 960×780）：
 * ┌────────────────────────────────────────────────┐
 * │ [最大化]              [清空] [关闭]              │  顶栏（44px）
 * ├────────────────────────────────────────────────┤
 * │         消息列表（居中 max-w-800，可滚动）       │  弹性高度
 * │          user 气泡（右） / ai 气泡（左）         │
 * │          [工具调用状态] [审批卡片]               │
 * ├────────────────────────────────────────────────┤
 * │ [活动状态栏]                                    │  可选
 * ├────────────────────────────────────────────────┤
 * │    [附件预览区]                                 │  可选
 * │    [📎] [模型选择] [授权方式]                    │  工具栏（居中 max-w-840）
 * │    [输入框................................] [➤] │  输入行
 * └────────────────────────────────────────────────┘
 */

import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  ArrowUp,
  Mic,
  X,
  Loader2,
  AlertCircle,
  Paperclip,
  ChevronDown,
  Check,
  Cloud,
  FileText,
  FileCode,
  File,
  Wrench,
  Maximize2,
  Puzzle,
  AlertTriangle,
  Terminal,
  Globe,
  MousePointer,
  Folder,
  Brain,
  ChevronRight,
  Sparkles,
  Crop,
  Phone,
  Square,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import ScreenPermissionGuide from '../ui/ScreenPermissionGuide'
import { useVoiceInput, appendVoiceText } from '../../composables/useVoiceInput'
import VoiceVisualizer from '../voice/VoiceVisualizer'
import {
  readFileAsAttachment,
  type MiniChatMessage,
  type MiniChatToolCall,
  type MiniChatActivity,
  type ChatAttachment,
} from '../../composables/useAvatarMiniChat'
import type { PendingApprovalToolCall } from '@intelligence/voice/miniChatApprovalService'
import { MiniMarkdown } from './MiniMarkdown'
import { MiniAuthorizationSelector } from './MiniAuthorizationSelector'
import { MiniWorkModeSelector } from './MiniWorkModeSelector'
import { MiniAgentSelector } from './MiniAgentSelector'
import { CollapsibleContent } from '@components/intelligence/chatMessage/components/CollapsibleContent'
import { publicAsset } from '@utils/publicAsset'
import { getToolDisplayName } from '@configuration/toolDefinitions'
import type {
  AvatarAgentConfig,
  AvatarModelOption,
  MainConversationSnapshot,
} from '../../types/electronBridge'

// ============================================
// 类型定义
// ============================================

export interface MiniChatPanelProps {
  /** 消息列表 */
  messages: MiniChatMessage[]
  /** 是否正在生成回复 */
  streaming: boolean
  /** 当前活动状态（AI 正在执行的工具） */
  activity: MiniChatActivity | null
  /** 待审批的工具调用列表（与普通聊天窗口的 pendingApprovalToolCalls 一致） */
  pendingApproval: PendingApprovalToolCall[]
  /** 语言 */
  language: 'zh' | 'en'
  /** 错误信息 */
  errorMessage: string | null
  /** 发送一条消息（可携带附件） */
  onSend: (text: string, attachments?: ChatAttachment[]) => void
  /** 中止当前生成 */
  onAbort: () => void
  /** 清空消息 */
  onClear: () => void
  /** 关闭面板（收起窗口） */
  onClose: () => void
  /** 切换到语音对话模式 */
  onSwitchToVoice: () => void
  /** 最大化：打开主聊天窗口 */
  onOpenMain: () => void
  /** 批准所有待审批工具 */
  onApproveAll: () => void
  /** 拒绝所有待审批工具 */
  onRejectAll: () => void
  /** 当前 LLM 配置 */
  currentProvider?: string
  currentModel?: string
  cloudMode?: 'cloud' | 'local'
  /** 完整 LLM 配置对象（来自 voiceContext.llmConfig，用于 AI 优化输入时调用 LLM） */
  llmConfig?: unknown | null
  /** 工具执行授权方式（来自 voiceContext，同步主窗口 authorizationMode） */
  authorizationMode?: 'every-step' | 'dangerous-only' | 'never'
  /** 工作模式（来自 voiceContext，同步主窗口 workMode）：快速/思考/专家 */
  workMode?: 'chat' | 'agent' | 'plan'
  /** 自定义智能体配置（来自 voiceContext.agentConfig，供智能体选择器显示/切换） */
  agentConfig?: AvatarAgentConfig | null
  /** 主窗口当前对话快照（同步显示主窗口对话内容，提问时作为上下文） */
  mainConversation?: MainConversationSnapshot | null
  /** 外部注入的待添加附件（如截图提问结果），组件合并到输入框附件区后调用 onPendingAttachmentConsumed */
  pendingAttachment?: ChatAttachment | null
  /** 外部附件已被合并消费，调用方应清空 pendingAttachment */
  onPendingAttachmentConsumed?: () => void
}

// ============================================
// 常量
// ============================================

/** 消息列表内容最大宽度（与普通聊天窗口一致） */
const MESSAGE_MAX_WIDTH = 800
/** 底部输入区最大宽度（与普通聊天窗口一致） */
const INPUT_MAX_WIDTH = 840

// ============================================
// 主组件
// ============================================

function MiniChatPanelImpl({
  messages,
  streaming,
  activity,
  pendingApproval,
  language,
  errorMessage,
  onSend,
  onAbort,
  onClear,
  onClose,
  onSwitchToVoice,
  onOpenMain,
  onApproveAll,
  onRejectAll,
  currentProvider,
  currentModel,
  cloudMode,
  llmConfig,
  authorizationMode,
  workMode,
  agentConfig,
  mainConversation,
  pendingAttachment,
  onPendingAttachmentConsumed,
}: MiniChatPanelProps) {
  const isZh = language === 'zh'
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])

  // 自动滚动控制
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [messages, activity, pendingApproval, mainConversation, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    userScrolledUpRef.current = !atBottom
  }, [])

  // --------------------------------------------
  // 附件处理
  // --------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 输入框 ref：外部注入附件后自动聚焦，引导用户输入问题
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const files = Array.from(e.target.files)
    e.target.value = ''

    for (const file of files) {
      try {
        const att = await readFileAsAttachment(file)
        setAttachments((prev) => [...prev, att])
      } catch (err) {
        console.error('[MiniChatPanel] Read file failed:', err)
      }
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  // --------------------------------------------
  // 截图提问：触发主进程全屏区域选择 → 截图 → 作为附件注入输入框
  // 与右键菜单「截图提问」共用同一流程（ScreenshotAskManager）
  // --------------------------------------------
  const handleScreenshot = useCallback(async () => {
    if (streaming) return
    try {
      const res = await api.floatingAvatar.startScreenshotAsk()
      // 主进程权限前置检查：未授予 macOS 屏幕录制权限 → 弹出引导弹窗
      if (res && !res.success) {
        if (res.error === 'SCREEN_PERMISSION_DENIED') {
          setPermissionGuideOpen(true)
          return
        }
        console.error('[MiniChatPanel] Start screenshot ask failed:', res.error)
        return
      }
    } catch (err) {
      console.error('[MiniChatPanel] Start screenshot ask failed:', err)
    }
  }, [streaming])

  // --------------------------------------------
  // 语音输入（实时听写）：说话过程中即时把识别文本写回输入框
  // 与主窗口 ConversationInput 的语音输入功能一致，复用同一 useVoiceInput hook
  // --------------------------------------------
  /** 录音开始那一刻的输入框内容：实时文本始终与它合成，避免逐次叠加出重复文字 */
  const voiceBaseRef = useRef('')
  /** 当前已上屏的语音文本：用户手动编辑时用它把语音部分从输入框内容中剥离 */
  const lastVoiceTextRef = useRef('')

  const voiceInput = useVoiceInput({
    language: isZh ? 'zh' : 'en',
    onPartialResult: (text) => {
      lastVoiceTextRef.current = text
      setInput(appendVoiceText(voiceBaseRef.current, text))
    },
    onResult: (text) => {
      lastVoiceTextRef.current = ''
      setInput(appendVoiceText(voiceBaseRef.current, text))
      // 自动调整 textarea 高度
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
      }, 0)
    },
  })

  const handleVoiceStart = useCallback(() => {
    voiceBaseRef.current = input
    lastVoiceTextRef.current = ''
    void voiceInput.startRecording()
  }, [input, voiceInput.startRecording])

  /** 输入框变更：录音期间用户手动编辑时更新基线，避免实时文本覆盖用户输入 */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      if (voiceInput.state === 'recording') {
        const voiceText = lastVoiceTextRef.current
        voiceBaseRef.current =
          voiceText && value.endsWith(voiceText)
            ? value.slice(0, value.length - voiceText.length).trimEnd()
            : value
        lastVoiceTextRef.current = ''
      }
      setInput(value)
    },
    [voiceInput.state, setInput],
  )

  // --------------------------------------------
  // 外部注入附件（如截图提问结果）：合并到输入框附件区，不自动发送
  // 用户自行输入问题后点发送，实现「截图 → 添加附件 → 输入问题 → 发送」流程
  // --------------------------------------------
  useEffect(() => {
    if (!pendingAttachment) return
    setAttachments((prev) => [...prev, pendingAttachment])
    onPendingAttachmentConsumed?.()
    // 聚焦输入框，引导用户输入提问内容
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [pendingAttachment, onPendingAttachmentConsumed])

  // --------------------------------------------
  // 发送消息
  // --------------------------------------------
  const isSendable = input.trim().length > 0 || attachments.length > 0

  const handleSend = useCallback(() => {
    if (!isSendable || streaming) return
    const text = input.trim()
    onSend(text, attachments.length > 0 ? attachments : undefined)
    // 清空输入框和附件
    setInput('')
    setAttachments([])
    // 重置 textarea 高度
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    })
  }, [isSendable, streaming, input, attachments, onSend])

  // --------------------------------------------
  // AI 优化输入（与主窗口 ConversationInput.handleOptimize 一致）
  // --------------------------------------------
  const [isOptimizing, setIsOptimizing] = useState(false)
  // macOS 屏幕录制权限引导弹窗（截图返回 SCREEN_PERMISSION_DENIED 时打开）
  const [permissionGuideOpen, setPermissionGuideOpen] = useState(false)

  const handleOptimize = useCallback(async () => {
    if (!input.trim() || isOptimizing || streaming) return
    if (!llmConfig) return

    setIsOptimizing(true)
    const requestId = `mini-opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let result = ''
    let resolved = false
    const unsubs: (() => void)[] = []

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        unsubs.forEach((u) => u())
      }
    }

    unsubs.push(
      api.llm.onStream(requestId, (chunk: { type: string; content?: string }) => {
        if (chunk.type === 'text' && chunk.content) {
          result += chunk.content
        }
      }),
    )

    unsubs.push(
      api.llm.onDone(requestId, () => {
        cleanup()
        const optimized = result.trim()
        if (optimized) {
          setInput(optimized)
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto'
              textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
            }
          })
        }
        setIsOptimizing(false)
      }),
    )

    unsubs.push(
      api.llm.onError(requestId, () => {
        cleanup()
        setIsOptimizing(false)
      }),
    )

    // 超时保护（30s）
    setTimeout(() => {
      if (!resolved) {
        cleanup()
        setIsOptimizing(false)
      }
    }, 30000)

    try {
      const systemPrompt = isZh
        ? '你是一个输入优化助手。请仔细阅读用户输入以及附带的上下文（近期对话记录），将用户的输入优化为更清晰、更具体、更有条理的提示词，便于AI准确理解和高效执行。直接输出优化后的内容，不要添加任何解释、前缀或标记。保持用户的原始意图，不要改变核心意思。如果用户输入的是中文，优化后也用中文；如果是英文，优化后也用英文。'
        : 'You are an input optimization assistant. Read the user\'s input along with the attached context (recent conversation), then optimize it into a clearer, more specific, and well-structured prompt for accurate AI understanding and efficient execution. Output only the optimized content directly — no explanations, prefixes, or markers. Preserve the user\'s original intent without changing the core meaning. If the user writes in Chinese, respond in Chinese; if in English, respond in English.'

      // 提取近期对话历史作为上下文
      const recentMsgs = (messages as unknown as Array<{ role?: string; content?: string }>)
        ?.slice(-6)
        .filter(m => m?.role && m?.content)
        .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${(m.content as string)?.slice(0, 150)}`)
        .filter(Boolean)
        .join('\n') ?? ''

      const userContent = recentMsgs
        ? `## 近期对话\n${recentMsgs}\n\n## 用户输入\n${input.trim()}`
        : input.trim()

      await api.llm.send({
        config: llmConfig as never,
        messages: [{ role: 'user', content: userContent }] as never,
        systemPrompt,
        requestId,
      })
    } catch {
      cleanup()
      setIsOptimizing(false)
    }
  }, [input, isOptimizing, streaming, llmConfig, isZh, messages])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // --------------------------------------------
  // 主窗口对话快照 → 迷你消息格式（只读，复用 MessageBubble 渲染）
  // --------------------------------------------
  /** 迷你消息对象缓存：内容未变时复用同一引用，让 MessageBubble 的记忆化真正生效 */
  const mainMessageCacheRef = useRef(new Map<string, MiniChatMessage>())

  const mainMessages = useMemo<MiniChatMessage[]>(() => {
    const incoming = mainConversation?.messages
    if (!incoming?.length) {
      mainMessageCacheRef.current.clear()
      return []
    }

    const cache = mainMessageCacheRef.current
    const alive = new Set<string>()
    const next = incoming.map((m) => {
      alive.add(m.id)
      const cached = cache.get(m.id)
      // 正文与推理文本都未变时复用旧对象：否则每轮快照都会重建整个列表，
      // 记忆化失效后整列消息都要重新解析 Markdown。
      if (cached && cached.content === m.content && cached.reasoning === m.reasoning) {
        return cached
      }
      const fresh: MiniChatMessage = {
        id: m.id,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        timestamp: m.timestamp,
      }
      cache.set(m.id, fresh)
      return fresh
    })

    // 清理已不在列表中的条目，避免长时间运行后缓存无限增长
    for (const key of cache.keys()) {
      if (!alive.has(key)) cache.delete(key)
    }

    return next
  }, [mainConversation])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden rounded-2xl border border-[rgba(128,128,128,0.15)] shadow-[0_0_10px_rgba(0,0,0,0.1)]"
      style={{ background: 'rgb(var(--background-secondary) / 0.98)', backdropFilter: 'blur(20px)' }}
    >
      <style>{`
        @keyframes mini-chat-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes mini-chat-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        .mini-brand-logo-light { display: none; }
        .mini-brand-logo-dark { display: block; }
        @media (prefers-color-scheme: light) {
          .mini-brand-logo-dark { display: none; }
          .mini-brand-logo-light { display: block; }
        }
      `}</style>

      {/* ============ 顶栏（可拖动移动窗口） ============ */}
      <div
        className="flex items-center gap-2 px-4 h-11 flex-shrink-0 border-b border-border/40 bg-background/85"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* 左侧：应用头像 + AweeClaw 品牌名 */}
        <div
          className="flex items-center gap-2 select-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 根据系统明暗偏好自动切换 logo（不依赖 store） */}
          <img
            src={publicAsset('brand/logos/app.png')}
            alt="AweeClaw"
            className="mini-brand-logo-dark w-6 h-6 rounded-md object-contain"
          />
          <img
            src={publicAsset('brand/logos/app-light.png')}
            alt="AweeClaw"
            className="mini-brand-logo-light w-6 h-6 rounded-md object-contain"
          />
          <span
            className="font-bold tracking-tight"
            style={{
              fontSize: '13px',
              color: 'rgb(var(--text-primary) / 0.9)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
            }}
          >
            AweeClaw
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* 右侧：清空 + 最大化 + 关闭 */}
        {messages.length > 0 && !streaming && (
          <button
            onClick={onClear}
            style={{ ...headerBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={isZh ? '清空对话' : 'Clear'}
          >
            <span style={{ fontSize: '12px' }}>{isZh ? '清空' : 'Clear'}</span>
          </button>
        )}

        {/* 最大化按钮：打开主聊天窗口并关闭迷你助手 */}
        <button
          onClick={onOpenMain}
          style={{ ...headerMaximizeBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={isZh ? '打开主窗口' : 'Open main window'}
        >
          <Maximize2 size={15} color="rgb(var(--text-secondary) / 0.9)" />
        </button>

        {/* 语音对话按钮：切换到语音模式（与主窗口语音助手一致，缩小版） */}
        <button
          onClick={onSwitchToVoice}
          disabled={streaming}
          style={{
            ...headerMaximizeBtnStyle,
            WebkitAppRegion: 'no-drag',
            opacity: streaming ? 0.4 : 1,
            cursor: streaming ? 'not-allowed' : 'pointer',
          } as React.CSSProperties}
          title={isZh ? '语音对话' : 'Voice chat'}
        >
          <Phone size={15} color="rgb(var(--text-secondary) / 0.9)" />
        </button>

        <button
          onClick={onClose}
          style={{ ...headerCloseBtnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={isZh ? '关闭' : 'Close'}
        >
          <X size={14} color="rgb(var(--text-secondary) / 0.8)" />
        </button>
      </div>

      {/* ============ 消息列表（Tailwind class 与主窗口一致） ============ */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 custom-scrollbar"
        onScroll={handleScroll}
      >
        <div className="mx-auto w-full" style={{ maxWidth: MESSAGE_MAX_WIDTH }}>
          {messages.length === 0 && mainMessages.length === 0 && !errorMessage && pendingApproval.length === 0 && (
            <div className="flex flex-1 items-center justify-center min-h-[200px]">
              <p className="text-[13px] text-text-muted/60">
                {isZh ? '有什么可以帮你的？' : 'How can I help you?'}
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-status-error/10 border border-status-error/20 text-status-error text-[13px]">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 主窗口当前对话（只读同步，顶部区块） */}
          {mainMessages.length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 my-2">
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-[11px] text-text-muted/60 whitespace-nowrap select-none">
                  {isZh ? '主窗口对话' : 'Main window conversation'}
                </span>
                <div className="flex-1 h-px bg-border/40" />
              </div>
              {mainMessages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} isZh={isZh} />
              ))}
              {messages.length > 0 && (
                <div className="flex items-center gap-2 my-2">
                  <div className="flex-1 h-px bg-border/40" />
                  <span className="text-[11px] text-text-muted/60 whitespace-nowrap select-none">
                    {isZh ? '迷你对话' : 'Mini chat'}
                  </span>
                  <div className="flex-1 h-px bg-border/40" />
                </div>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} isZh={isZh} />
          ))}

          {/* 工具审批卡片（与普通聊天窗口的 BatchApprovalPanel 一致） */}
          {pendingApproval.length > 0 && (
            <MiniApprovalCard
              pendingTools={pendingApproval}
              isZh={isZh}
              onApproveAll={onApproveAll}
              onRejectAll={onRejectAll}
            />
          )}
        </div>
      </div>

      {/* ============ 活动状态栏 ============ */}
      {activity && streaming && (
        <div style={activityBarStyle}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'rgb(var(--accent))',
            animation: 'mini-chat-dot-pulse 1.5s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={activityTextStyle}>
            {activity.text}
            {activity.toolName ? ` · ${activity.toolName}` : ''}
          </span>
        </div>
      )}

      {/* ============ 输入区（Tailwind class 与主窗口 ConversationInput 完全一致） ============ */}
      <div className="z-20 px-4 pb-3">
        <div className="mx-auto" style={{ maxWidth: INPUT_MAX_WIDTH }}>
          {/* 输入框卡片：rounded-xl + border + shadow，与 ConversationInput 一致 */}
          <div
            className={`relative group flex flex-col rounded-xl transition-all duration-500 ease-out border ${
              streaming
                ? 'bg-surface border-accent/20 shadow-[0_4px_24px_-12px_rgba(var(--accent)/0.15)]'
                : 'bg-surface border-border/50 hover:border-text-primary/10 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)]'
            }`}
          >
            {/* 附件预览区 */}
            {attachments.length > 0 && (
              <div className="flex gap-2 px-4 pt-4 overflow-x-auto custom-scrollbar">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative group/att flex-shrink-0 rounded-xl overflow-hidden border border-border shadow-sm"
                  >
                    {att.isImage && att.previewUrl ? (
                      <div className="w-16 h-16 relative">
                        <img src={att.previewUrl} alt={att.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 bg-surface/50 min-w-[120px] max-w-[180px]">
                        {getAttachmentIcon(att.name, att.mediaType)}
                        <span className="text-[12px] text-text-secondary truncate max-w-[100px]">{att.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="absolute top-1 right-1 p-1 bg-black/60 backdrop-blur rounded-full text-white hover:bg-red-500 transition-all opacity-0 group-hover/att:opacity-100 scale-90 hover:scale-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 文本输入区 + 底部工具栏（与 ConversationInput 结构一致） */}
            <div className="flex flex-col px-4 pb-3 pt-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isZh ? '输入消息...' : 'Type a message...'}
                rows={1}
                disabled={streaming}
                className="w-full bg-transparent border-none p-0 py-2.5 text-[15px] text-text-primary placeholder-text-muted/40 resize-none focus:ring-0 focus:outline-none leading-relaxed custom-scrollbar max-h-[50vh] caret-accent font-medium tracking-wide"
                style={{ minHeight: '48px' }}
              />

              {/* 底部工具栏：左侧模型选择器 | 右侧附件+发送（与 ConversationInput 一致） */}
              <div className="relative flex items-center justify-between pt-1 gap-2">
                {/* 左侧：模型选择器 */}
                <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
                  <ModelSelectorButton
                    currentProvider={currentProvider}
                    currentModel={currentModel}
                    cloudMode={cloudMode}
                    disabled={streaming}
                    language={language}
                  />
                </div>

                {/* 右侧：截图 + 附件 + 发送/停止/语音 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input type="file" ref={fileInputRef} multiple onChange={handleFileSelect} className="hidden" />
                  {/* 语音输入中隐藏截图/附件/AI优化按钮，腾出空间给录音可视化（与主窗口一致） */}
                  {voiceInput.state === 'idle' && (
                    <>
                      <button
                        onClick={() => !streaming && fileInputRef.current?.click()}
                        disabled={streaming}
                        title={isZh ? '上传附件' : 'Upload attachment'}
                        className={`rounded-xl w-8 h-8 transition-all active:scale-95 flex items-center justify-center ${
                          streaming
                            ? 'opacity-40 cursor-not-allowed text-text-muted'
                            : 'hover:bg-surface-active text-text-muted hover:text-text-primary'
                        }`}
                      >
                        <Paperclip className="w-4 h-4 opacity-70 group-hover:opacity-100" />
                      </button>
                      {/* 截图提问按钮：触发全屏区域选择，截图完成后作为附件添加到输入框 */}
                      <button
                        onClick={handleScreenshot}
                        disabled={streaming}
                        title={isZh ? '截图提问' : 'Screenshot & Ask'}
                        className={`rounded-xl w-8 h-8 transition-all active:scale-95 flex items-center justify-center ${
                          streaming
                            ? 'opacity-40 cursor-not-allowed text-text-muted'
                            : 'hover:bg-surface-active text-text-muted hover:text-text-primary'
                        }`}
                      >
                        <Crop className="w-4 h-4 opacity-70 group-hover:opacity-100" />
                      </button>

                      {/* AI 优化输入按钮（与主窗口 ConversationInput 一致） */}
                      <button
                        onClick={handleOptimize}
                        disabled={!input.trim() || isOptimizing || streaming}
                        title={isZh ? '优化输入' : 'Optimize input'}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                          isOptimizing
                            ? 'bg-accent/10 text-accent border border-accent/20'
                            : input.trim() && !streaming
                              ? 'bg-surface/50 text-text-muted hover:text-accent hover:bg-accent/10 border border-border/30 hover:border-accent/20 active:scale-95'
                              : 'bg-transparent text-text-muted/30 cursor-not-allowed border border-transparent'
                        }`}
                      >
                        {isOptimizing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  )}

                  {streaming ? (
                    <button
                      onClick={onAbort}
                      title={isZh ? '停止生成' : 'Stop'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-surface/50 text-text-primary border border-text-primary/10 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20"
                    >
                      <div className="w-2.5 h-2.5 bg-current rounded-[1px] animate-pulse" />
                    </button>
                  ) : voiceInput.state !== 'idle' ? (
                    /* 录音/处理中：显示可视化 + 停止按钮（与主窗口一致） */
                    <div className="relative flex items-center gap-1.5">
                      {voiceInput.state === 'recording' && voiceInput.stream && (
                        <div className="w-16 h-8 flex items-center">
                          <VoiceVisualizer
                            stream={voiceInput.stream}
                            isActive={voiceInput.state === 'recording'}
                            color="rgb(239, 68, 68)"
                            height={32}
                            barCount={12}
                            barGap={1}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={voiceInput.state === 'recording' ? voiceInput.stopRecording : undefined}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          if (voiceInput.state === 'recording') {
                            voiceInput.cancelRecording()
                          }
                        }}
                        disabled={voiceInput.state === 'requesting' || voiceInput.state === 'processing'}
                        className={`relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none ${
                          voiceInput.state === 'recording'
                            ? 'w-8 h-8 bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600'
                            : 'w-8 h-8 bg-blue-500/20 text-blue-400 cursor-wait'
                        }`}
                        title={
                          voiceInput.state === 'recording'
                            ? isZh ? '停止录音' : 'Stop recording'
                            : voiceInput.state === 'processing'
                              ? isZh ? '识别中...' : 'Processing...'
                              : isZh ? '请求麦克风...' : 'Requesting microphone...'
                        }
                      >
                        {voiceInput.state === 'recording' && (
                          <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-60" />
                        )}
                        {(voiceInput.state === 'requesting' || voiceInput.state === 'processing') ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Square className="w-3 h-3" fill="currentColor" />
                        )}
                      </button>
                    </div>
                  ) : isSendable ? (
                    <button
                      onClick={handleSend}
                      title={isZh ? '发送' : 'Send'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-accent text-white shadow-md shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 border border-transparent"
                    >
                      <ArrowUp className="w-5 h-5 stroke-[3]" />
                    </button>
                  ) : (
                    /* 语音输入按钮：点击开始录音，语音转文字填入输入框（与主窗口一致） */
                    <button
                      onClick={handleVoiceStart}
                      title={isZh ? '语音输入' : 'Voice input'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-surface/50 text-text-muted hover:text-accent hover:bg-accent/10 border border-border/30 hover:border-accent/20 active:scale-95"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 授权方式栏：独立底部栏，粘附在输入框容器底部（与主窗口 -mt-5 一致） */}
          <div className="-mt-5 z-10">
            <div className="flex items-center gap-2 bg-border/20 px-4 pt-6 pb-1 rounded-b-xl rounded-t-none">
              <MiniAgentSelector
                agentConfig={agentConfig}
                language={language}
                disabled={streaming}
              />
              <MiniWorkModeSelector
                currentMode={workMode}
                language={language}
                disabled={streaming}
              />
              <MiniAuthorizationSelector
                currentMode={authorizationMode}
                language={language}
                disabled={streaming}
              />
            </div>
          </div>
        </div>
        </div>

      {/* macOS 屏幕录制权限引导（截图未授权时弹出） */}
      <ScreenPermissionGuide
        isOpen={permissionGuideOpen}
        onClose={() => setPermissionGuideOpen(false)}
        language={language}
      />
    </div>
  )
}

// ============================================
// 消息气泡子组件（含工具调用状态）
// ============================================

/**
 * 消息气泡
 *
 * 迷你面板同步主窗口对话时会整列重渲染，记忆化后只有内容真正变化的消息
 * （通常是流式中的最后一条）才会重新解析 Markdown。
 */
const MessageBubble = memo(function MessageBubble({ message, isZh }: { message: MiniChatMessage; isZh: boolean }) {
  const isUser = message.role === 'user'
  const hasError = !!message.error
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasReasoning = !isUser && !!message.reasoning && message.reasoning.trim().length > 0

  return (
    <div className={`flex flex-col mb-2 ${isUser ? 'items-end' : 'items-start'}`}>
      {/* 附件预览（仅 user 消息） */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex gap-1 mb-1 flex-wrap max-w-[80%]">
          {message.attachments.map((att) => (
            <div key={att.id} className="rounded-md overflow-hidden border border-border/40">
              {att.isImage && att.previewUrl ? (
                <img src={att.previewUrl} alt={att.name} className="w-15 h-15 object-cover" style={{ width: 60, height: 60 }} />
              ) : (
                <div className="flex items-center gap-1 px-2 py-1 bg-surface/40">
                  {getAttachmentIcon(att.name, att.mediaType)}
                  <span className="text-[12px] text-text-secondary/80 truncate max-w-[60px]">
                    {att.name}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 推理内容（思考模型的思考过程，与普通聊天窗口一致） */}
      {hasReasoning && (
        <ReasoningSection reasoning={message.reasoning!} isStreaming={message.streaming} isZh={isZh} />
      )}

      {/* 文本气泡 */}
      {(message.content || !hasToolCalls) && (
        <div
          className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed break-words ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-surface text-text-primary rounded-bl-md'
          } ${hasError ? 'border border-status-error/30 bg-status-error/5' : ''}`}
        >
          {hasError && (
            <div className="flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-3 h-3 text-status-error" />
              <span className="text-[12px] text-status-error">
                {isZh ? '生成失败' : 'Error'}
              </span>
            </div>
          )}
          {isUser ? (
            /* 用户消息：纯文本渲染（长内容折叠，点击「展开更多」查看全部） */
            <CollapsibleContent
              maxHeight={360}
              fadeColor="var(--accent)"
              expandLabel={isZh ? '展开更多' : 'Show more'}
              collapseLabel={isZh ? '收起' : 'Collapse'}
              buttonClassName="text-white/85 hover:text-white"
            >
              <span className="whitespace-pre-wrap">
                {message.content || ''}
              </span>
            </CollapsibleContent>
          ) : (
            /* AI 消息：Markdown 渲染（支持代码块、列表、标题等，与主窗口体验一致） */
            <>
              {message.content ? (
                <MiniMarkdown content={message.content} isStreaming={message.streaming} />
              ) : message.streaming ? (
                <span className="text-text-muted/50">...</span>
              ) : null}
              {message.streaming && message.content && (
                <span className="inline-block w-2 h-4 bg-accent animate-pulse ml-0.5" />
              )}
            </>
          )}
        </div>
      )}

      {/* 工具调用状态 */}
      {hasToolCalls && (
        <div className="flex flex-col gap-1 mt-1 max-w-[80%]">
          {message.toolCalls!.map((tc) => (
            <ToolCallStatus key={tc.id} toolCall={tc} isZh={isZh} />
          ))}
        </div>
      )}
    </div>
  )
})

// ============================================
// 推理内容子组件（思考模型的思考过程）
// ============================================

function ReasoningSection({
  reasoning,
  isStreaming,
  isZh,
}: {
  reasoning: string
  isStreaming?: boolean
  isZh: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div style={reasoningContainerStyle}>
      <button
        onClick={() => setExpanded((p) => !p)}
        style={reasoningHeaderStyle}
      >
        <Brain size={12} color="rgb(var(--text-muted) / 0.7)" style={{ flexShrink: 0 }} />
        <span style={reasoningTitleStyle}>
          {isZh ? '思考过程' : 'Reasoning'}
        </span>
        {isStreaming && (
          <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0, color: 'rgb(var(--text-muted) / 0.5)' }} />
        )}
        <ChevronRight
          size={12}
          color="rgb(var(--text-muted) / 0.5)"
          style={{ flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div style={reasoningContentStyle}>
          {reasoning}
        </div>
      )}
    </div>
  )
}

// ============================================
// 工具审批卡片子组件（与普通聊天窗口的 BatchApprovalPanel 一致）
// ============================================

/** 根据工具名获取操作图标 */
function getApprovalToolIcon(toolName: string) {
  if (toolName.startsWith('desktop_')) return MousePointer
  if (toolName === 'run_command') return Terminal
  if (['web_search', 'read_url'].includes(toolName)) return Globe
  if (['delete_file_or_folder', 'create_file_or_folder'].includes(toolName)) return Folder
  return FileText
}

/** 提取工具操作摘要（用于审批卡片展示） */
function getApprovalToolSummary(tc: PendingApprovalToolCall): string {
  const displayName = getToolDisplayName(tc.name)
  const args = tc.arguments || {}
  const path = (args.path as string) || (args.filePath as string) || (args.directory as string)

  if (path) {
    const fileName = path.split('/').pop() || path
    return `${displayName} ${fileName}`
  }

  if (tc.name === 'run_command' && typeof args.command === 'string') {
    const cmd = args.command.length > 50 ? args.command.slice(0, 50) + '...' : args.command
    return `${displayName} ${cmd}`
  }

  return displayName
}

function MiniApprovalCard({
  pendingTools,
  isZh,
  onApproveAll,
  onRejectAll,
}: {
  pendingTools: PendingApprovalToolCall[]
  isZh: boolean
  onApproveAll: () => void
  onRejectAll: () => void
}) {
  if (pendingTools.length === 0) return null

  return (
    <div style={approvalCardStyle}>
      <style>{`
        @keyframes mini-approval-breath {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(245, 158, 11, 0.2); }
          50% { opacity: 0.85; box-shadow: 0 0 16px rgba(245, 158, 11, 0.4); }
        }
      `}</style>

      {/* 头部：警告图标 + 标题（呼吸动画 2 秒周期，符合告警样式规范） */}
      <div style={approvalHeaderStyle}>
        <div
          style={{
            width: 24, height: 24, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            flexShrink: 0,
            animation: 'mini-approval-breath 2s ease-in-out infinite',
          }}
        >
          <AlertTriangle size={13} color="rgb(245, 158, 11)" />
        </div>
        <span style={approvalTitleStyle}>
          {isZh ? '待批准操作' : 'Pending Approval'}
        </span>
        <span style={approvalCountStyle}>
          {pendingTools.length}
        </span>
        <span style={approvalHintStyle}>
          {isZh ? '请确认后执行' : 'Confirm to proceed'}
        </span>
      </div>

      {/* 操作列表 */}
      <div style={approvalListStyle}>
        {pendingTools.map((tc) => {
          const Icon = getApprovalToolIcon(tc.name)
          const summary = getApprovalToolSummary(tc)
          return (
            <div key={tc.id} style={approvalItemStyle}>
              <Icon size={13} color="rgb(var(--text-muted) / 0.7)" style={{ flexShrink: 0 }} />
              <span style={approvalItemTextStyle}>
                {summary}
              </span>
              <span style={approvalItemNameStyle}>
                {tc.name}
              </span>
            </div>
          )
        })}
      </div>

      {/* 底部：批准/拒绝按钮 */}
      <div style={approvalFooterStyle}>
        <button onClick={onRejectAll} style={approvalRejectBtnStyle}>
          <X size={13} color="rgb(var(--status-error))" />
          <span>{isZh ? '全部拒绝' : 'Reject All'}</span>
        </button>
        <button onClick={onApproveAll} style={approvalApproveBtnStyle}>
          <Check size={13} color="#fff" />
          <span>{isZh ? '全部批准' : 'Approve All'}</span>
        </button>
      </div>
    </div>
  )
}

// ============================================
// 工具调用状态子组件
// ============================================

function ToolCallStatus({ toolCall }: { toolCall: MiniChatToolCall; isZh: boolean }) {
  const isRunning = toolCall.status === 'running'
  const isCompleted = toolCall.status === 'completed'
  const isFailed = toolCall.status === 'failed'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 8px',
      borderRadius: 8,
      background: 'rgb(var(--surface) / 0.3)',
      border: '1px solid rgb(var(--border) / 0.3)',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    }}>
      <Wrench size={11} style={{ flexShrink: 0, color: 'rgb(var(--text-muted) / 0.7)' }} />

      {isRunning && <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0, color: 'rgb(var(--accent))' }} />}
      {isCompleted && <Check size={11} style={{ flexShrink: 0, color: 'rgb(var(--status-success))' }} />}
      {isFailed && <X size={11} style={{ flexShrink: 0, color: 'rgb(var(--status-error))' }} />}

      <span style={{
        color: isRunning ? 'rgb(var(--text-secondary))' : isFailed ? 'rgb(var(--status-error))' : 'rgb(var(--text-secondary) / 0.8)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {toolCall.name}
      </span>

      {toolCall.result && !isRunning && (
        <span style={{
          fontSize: '12px',
          color: 'rgb(var(--text-muted) / 0.6)',
          maxWidth: 100,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {toolCall.result}
        </span>
      )}
    </div>
  )
}

// ============================================
// 模型选择器子组件
// ============================================

function ModelSelectorButton({
  currentProvider, currentModel, cloudMode,
  disabled, language,
}: {
  currentProvider?: string
  currentModel?: string
  cloudMode?: 'cloud' | 'local'
  disabled: boolean
  language: 'zh' | 'en'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [models, setModels] = useState<AvatarModelOption[]>([])
  const [loading, setLoading] = useState(false)
  // Tab 状态：跟随当前 cloudMode，弹窗内可独立切换（与普通会话体验一致）
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>(
    cloudMode === 'cloud' ? 'cloud' : 'local',
  )
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.floatingAvatar.getAvailableModels()
      console.log('[MiniChatPanel] getAvailableModels result:', {
        success: res.success,
        modelCount: res.data?.length || 0,
        error: res.error,
        cloudCount: res.data?.filter((m) => m.isCloud).length || 0,
        localCount: res.data?.filter((m) => !m.isCloud).length || 0,
      })
      if (res.success && res.data) setModels(res.data)
    } catch (err) {
      console.error('[MiniChatPanel] Load models failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 仅在弹窗打开时加载一次模型列表（移除 loading 依赖，避免无限循环：
  // loading true→false 会触发 effect 重跑，导致请求完成后立即重新发起）
  useEffect(() => {
    if (isOpen) void loadModels()
  }, [isOpen, loadModels])

  // 打开弹窗时同步 Tab 状态到当前 cloudMode
  useEffect(() => {
    if (isOpen) {
      setActiveTab(cloudMode === 'cloud' ? 'cloud' : 'local')
    }
  }, [isOpen, cloudMode])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleSelectModel = useCallback(async (model: AvatarModelOption) => {
    try {
      await api.floatingAvatar.selectModel({ provider: model.provider, model: model.id, isCloud: model.isCloud })
      setIsOpen(false)
    } catch (err) {
      console.error('[MiniChatPanel] Select model failed:', err)
    }
  }, [])

  // 按 Tab 过滤模型
  const filteredModels = models.filter((m) =>
    activeTab === 'cloud' ? m.isCloud : !m.isCloud,
  )

  const displayName = currentModel ? (currentModel.split('/').pop() || currentModel) : (isZh ? '选择模型' : 'Select model')

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        onClick={() => !disabled && setIsOpen((p) => !p)}
        disabled={disabled}
        style={{
          ...toolbarBtnStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
          flex: 1, justifyContent: 'flex-start', gap: 4, padding: '0 6px',
        }}
        title={displayName}
      >
        {cloudMode === 'cloud' && <Cloud size={12} color="rgb(var(--accent) / 0.8)" />}
        <span style={{
          fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.85)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 200,
        }}>
          {displayName}
        </span>
        <ChevronDown size={11} color="rgb(var(--text-muted) / 0.5)" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
      </button>

      {isOpen && (
        <div style={modelDropdownStyle}>
          {/* Tab 切换栏：自定义 / 云端（与普通会话一致） */}
          <div style={modelTabBarStyle}>
            <button
              onClick={() => setActiveTab('local')}
              style={{
                ...modelTabStyle,
                ...(activeTab === 'local' ? modelTabActiveStyle : {}),
              }}
            >
              <Puzzle size={11} style={{ flexShrink: 0 }} />
              <span>{isZh ? '自定义' : 'Custom'}</span>
            </button>
            <button
              onClick={() => setActiveTab('cloud')}
              style={{
                ...modelTabStyle,
                ...(activeTab === 'cloud' ? modelTabActiveStyle : {}),
              }}
            >
              <Cloud size={11} style={{ flexShrink: 0 }} />
              <span>{isZh ? '云端' : 'Cloud'}</span>
            </button>
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <Loader2 size={14} className="animate-spin" color="rgb(var(--text-muted) / 0.6)" />
            </div>
          )}
          {!loading && filteredModels.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: '12px', color: 'rgb(var(--text-muted) / 0.6)' }}>
              {activeTab === 'cloud' ? (isZh ? '暂无云端模型' : 'No cloud models') : (isZh ? '暂无自定义模型' : 'No custom models')}
            </div>
          )}
          {!loading && filteredModels.map((model) => {
            const isSelected = model.provider === currentProvider && model.id === currentModel
            return (
              <button key={`${model.provider}-${model.id}`} onClick={() => void handleSelectModel(model)} style={{ ...modelItemStyle, ...(isSelected ? modelItemSelectedStyle : {}) }}>
                <span style={{
                  fontSize: '12px',
                  color: isSelected ? 'rgb(var(--accent))' : 'rgb(var(--text-primary) / 0.9)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {model.name}
                </span>
                {model.isCloud && <Cloud size={10} color="rgb(var(--accent) / 0.6)" style={{ flexShrink: 0 }} />}
                {isSelected && <Check size={12} color="rgb(var(--accent))" style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================
// 辅助函数
// ============================================

function getAttachmentIcon(fileName: string, mimeType: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (mimeType.startsWith('image/')) return <FileText size={14} color="rgb(var(--status-success))" />
  const codeExts = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt', 'vue', 'svelte']
  if (codeExts.includes(ext)) return <FileCode size={14} color="rgb(var(--status-info))" />
  return <File size={14} color="rgb(var(--text-muted) / 0.6)" />
}

// ============================================
// 样式（使用 CSS 变量，跟随系统主题色）
// ============================================

/** 顶栏「最大化」图标按钮（点击打开主聊天窗口并关闭迷你助手） */
const headerMaximizeBtnStyle: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const headerBtnStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 6,
  border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  color: 'rgb(var(--text-secondary) / 0.8)', cursor: 'pointer',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  transition: 'background 0.15s',
}

const headerCloseBtnStyle: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const activityBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 12px', borderTop: '1px solid rgb(var(--border) / 0.3)',
  background: 'rgb(var(--background) / 0.85)', flexShrink: 0,
}

const activityTextStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.9)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

/** 保留旧的 toolbarBtnStyle 供 ModelSelectorButton 使用 */
const toolbarBtnStyle: React.CSSProperties = {
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 8,
  border: '1px solid rgb(var(--border) / 0.4)',
  background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 0.15s',
}

const modelDropdownStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
  width: 240, maxHeight: 320, overflowY: 'auto',
  background: 'rgb(var(--background-secondary) / 0.98)', backdropFilter: 'blur(20px)',
  border: '1px solid rgb(var(--border) / 0.6)', borderRadius: 10,
  boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)', zIndex: 200, padding: 4,
}

/** Tab 切换栏容器 */
const modelTabBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '4px 4px 6px',
  borderBottom: '1px solid rgb(var(--border) / 0.4)',
  marginBottom: 4, position: 'sticky', top: -4,
  background: 'rgb(var(--background-secondary) / 0.98)', zIndex: 1,
}

/** 单个 Tab 按钮 */
const modelTabStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '5px 8px', borderRadius: 6,
  border: 'none', background: 'transparent',
  fontSize: '12px', fontWeight: 500,
  color: 'rgb(var(--text-muted) / 0.8)',
  cursor: 'pointer', transition: 'all 0.15s',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

/** 激活的 Tab */
const modelTabActiveStyle: React.CSSProperties = {
  background: 'rgb(var(--surface) / 0.6)',
  color: 'rgb(var(--text-primary))',
}

const modelItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 6,
  border: 'none', background: 'transparent', cursor: 'pointer', width: '100%',
  textAlign: 'left', transition: 'background 0.15s',
}

const modelItemSelectedStyle: React.CSSProperties = {
  background: 'rgb(var(--accent) / 0.12)',
}

// ============================================
// 推理内容样式
// ============================================

const reasoningContainerStyle: React.CSSProperties = {
  maxWidth: '80%', marginBottom: 4, borderRadius: 10,
  background: 'rgb(var(--surface) / 0.2)',
  border: '1px solid rgb(var(--border) / 0.3)',
  overflow: 'hidden',
}

const reasoningHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
  background: 'transparent', border: 'none', cursor: 'pointer', width: '100%',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const reasoningTitleStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: 'rgb(var(--text-muted) / 0.8)',
  flex: 1, textAlign: 'left',
}

const reasoningContentStyle: React.CSSProperties = {
  padding: '4px 10px 8px', fontSize: '12px', lineHeight: 1.5,
  color: 'rgb(var(--text-muted) / 0.7)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  maxHeight: 200, overflowY: 'auto', borderTop: '1px solid rgb(var(--border) / 0.2)',
}

// ============================================
// 工具审批卡片样式
// ============================================

const approvalCardStyle: React.CSSProperties = {
  marginTop: 4, marginBottom: 8, borderRadius: 10, overflow: 'hidden',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  background: 'rgba(245, 158, 11, 0.05)',
}

const approvalHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  background: 'rgba(245, 158, 11, 0.1)',
  borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
}

const approvalTitleStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'rgb(245, 158, 11)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalCountStyle: React.CSSProperties = {
  fontSize: '12px', padding: '1px 6px', borderRadius: 4,
  background: 'rgba(245, 158, 11, 0.2)', color: 'rgb(245, 158, 11)',
  fontFamily: 'Menlo, Monaco, Consolas, monospace', flexShrink: 0,
}

const approvalHintStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgba(245, 158, 11, 0.6)', marginLeft: 'auto',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalListStyle: React.CSSProperties = {
  maxHeight: 120, overflowY: 'auto', padding: '4px 0',
}

const approvalItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
  transition: 'background 0.15s',
}

const approvalItemTextStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-primary) / 0.9)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalItemNameStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-muted) / 0.5)',
  fontFamily: 'Menlo, Monaco, Consolas, monospace', flexShrink: 0,
}

const approvalFooterStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
  padding: '6px 10px', borderTop: '1px solid rgba(245, 158, 11, 0.2)',
  background: 'rgba(245, 158, 11, 0.05)',
}

const approvalRejectBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
  border: '1px solid rgb(var(--status-error) / 0.3)', background: 'transparent',
  cursor: 'pointer', transition: 'background 0.15s',
  fontSize: '12px', fontWeight: 500, color: 'rgb(var(--status-error))',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalApproveBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
  border: 'none', background: 'rgb(var(--accent) / 0.85)',
  cursor: 'pointer', transition: 'opacity 0.15s',
  fontSize: '12px', fontWeight: 600, color: 'rgb(var(--accent-foreground))',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

export const MiniChatPanel = memo(MiniChatPanelImpl)
