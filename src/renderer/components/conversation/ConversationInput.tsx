/**
 * 聊天输入组件
 * 极致打磨：悬浮光晕、灵动按钮、精致上下文药丸
 */
import { memo, useRef, useCallback, useMemo, useState, useLayoutEffect, useEffect } from 'react'
import {
  FileText,
  X,
  Code,
  GitBranch,
  Terminal,
  Database,
  ArrowUp,
  Plus,
  Folder,
  Globe,
  Wrench,
  Paperclip,
  FileSpreadsheet,
  FileCode,
  Archive,
  Sparkles,
  Loader2,
  Eye,
  EyeOff,
  Mic,
  Square,
  Crop,
  File as FileIcon,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { getFileName } from '@shared/toolkit/pathHelper'
import { WorkMode } from '@/renderer/modes/workModeTypes'
import { motion, AnimatePresence } from 'framer-motion'
// VoiceRealtimePanel 已迁移到独立的 VoiceConversationOverlay 全屏语音对话界面
import {t, type Language} from '@renderer/i18n'
import { ActionButton } from '../ui'

import ModelSelector from './AIModelSelector'
import ModeSelector from './WorkModeSelector'
import AuthorizationModeSelector from './AuthorizationModeSelector'
import { useVoiceInput } from '../../composables/useVoiceInput'
import VoiceVisualizer from '../voice/VoiceVisualizer'
import { ContextItem, FileContext } from '@intelligence/providerTypes'
import { api } from '../../adapters/electronBridge'
import { getEffectiveLLMConfig } from '@services/modelConfigHelper'

export interface PendingAttachment {
  id: string
  file: File
  previewUrl?: string
  base64?: string
  isImage: boolean
  analyzeMode?: boolean
  localPath?: string
}

interface ChatInputProps {
  input: string
  setInput: (value: string) => void
  images: PendingAttachment[]
  setImages: React.Dispatch<React.SetStateAction<PendingAttachment[]>>
  isStreaming: boolean
  hasApiKey: boolean
  needsCloudLogin?: boolean
  hasPendingToolCall: boolean
  chatMode: WorkMode
  setChatMode: (mode: WorkMode) => void
  onSubmit: () => void
  onAbort: () => void
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  textareaRef: React.RefObject<HTMLTextAreaElement>
  inputContainerRef: React.RefObject<HTMLDivElement>
  contextItems: ContextItem[]
  onRemoveContextItem: (item: ContextItem) => void
  activeFilePath?: string | null
  onAddFile?: (filePath: string) => void
}

const ChatInput = memo(function ChatInput({
  input,
  setInput,
  images,
  setImages,
  isStreaming,
  hasApiKey,
  needsCloudLogin,
  hasPendingToolCall,
  chatMode,
  setChatMode,
  onSubmit,
  onAbort,
  onInputChange,
  onKeyDown,
  onPaste,
  textareaRef,
  inputContainerRef,
  contextItems,
  onRemoveContextItem,
  activeFilePath,
  onAddFile,
}: ChatInputProps) {
  const { language, editorConfig } = useStore(useShallow(s => ({ language: s.language, editorConfig: s.editorConfig })))
  const lt = (zh: string, en: string) => language === 'zh' ? zh : en
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)

  const voiceInput = useVoiceInput({
    onResult: (text) => {
      setInput(input ? `${input} ${text}` : text)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
      }, 0)
    },
  })

  // Auto-resize
  useLayoutEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input, textareaRef])

  // 文件引用检测
  const fileRefs = useMemo(() => {
    const refs: string[] = []
    const regex = /@(?:file:)?([^\s@]+\.[a-zA-Z0-9]+)/g
    let match
    while ((match = regex.exec(input)) !== null) {
      if (match[1] !== 'codebase') {
        refs.push(match[1])
      }
    }
    return refs
  }, [input])

  // 特殊上下文引用检测
  const hasCodebaseRef = useMemo(() => /@codebase\b/i.test(input), [input])
  const hasSymbolsRef = useMemo(() => /@symbols\b/i.test(input), [input])
  const hasGitRef = useMemo(() => /@git\b/i.test(input), [input])
  const hasTerminalRef = useMemo(() => /@terminal\b/i.test(input), [input])
  const hasWebRef = useMemo(() => /@web\b/i.test(input), [input])

  const addAttachment = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages((prev) => [...prev, { id, file, previewUrl, isImage }])
  }, [setImages])

  const removeAttachment = useCallback(
    (id: string) => {
      setImages((prev) => {
        const target = prev.find((img) => img.id === id)
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
        return prev.filter((img) => img.id !== id)
      })
    },
    [setImages]
  )

  // --------------------------------------------
  // 截图提问：触发主进程全屏区域选择 → 截图 → 作为附件注入输入框
  // 与迷你助手截图按钮功能一致，复用 ScreenshotAskManager（独立实例）
  // --------------------------------------------
  const handleScreenshot = useCallback(async () => {
    if (isStreaming) return
    try {
      await api.screenshot.start()
    } catch (err) {
      console.error('[ConversationInput] Start screenshot failed:', err)
    }
  }, [isStreaming])

  // 监听截图完成事件：将截图 base64 转为 File 对象并添加为附件
  useEffect(() => {
    const unsubscribe = api.screenshot.onResult(async (payload) => {
      try {
        // base64 → Uint8Array → File（与 AvatarApp 截图附件创建方式一致）
        const file = new File(
          [Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0))],
          payload.fileName || `screenshot_${Date.now()}.png`,
          { type: payload.mediaType },
        )
        await addAttachment(file)
        // 标记最后一个附件的 localPath（用于发送时带 localPath）
        setImages((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]
          if (last.localPath) return prev
          return prev.map((img, idx) =>
            idx === prev.length - 1 ? { ...img, localPath: payload.filePath } : img,
          )
        })
      } catch (err) {
        console.error('[ConversationInput] Screenshot result processing failed:', err)
      }
    })
    return unsubscribe
  }, [addAttachment, setImages])

  const toggleAnalyzeMode = useCallback(
    (id: string) => {
      setImages((prev) =>
        prev.map((img) =>
          img.id === id && img.isImage
            ? { ...img, analyzeMode: !img.analyzeMode }
            : img
        )
      )
    },
    [setImages]
  )

  const isSendable = input.trim().length > 0 || images.length > 0

  const handleOptimize = useCallback(async () => {
    if (!input.trim() || isOptimizing || isStreaming) return

    const config = getEffectiveLLMConfig()
    if (!config?.apiKey && !config?.cloudMode) return

    setIsOptimizing(true)
    const requestId = crypto.randomUUID()
    let result = ''
    let resolved = false
    const unsubs: (() => void)[] = []

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        unsubs.forEach(u => u())
      }
    }

    unsubs.push(
      api.llm.onStream(requestId, (chunk: { type: string; content?: string }) => {
        if (chunk.type === 'text' && chunk.content) {
          result += chunk.content
        }
      })
    )

    unsubs.push(
      api.llm.onDone(requestId, () => {
        cleanup()
        const optimized = result.trim()
        if (optimized) {
          setInput(optimized)
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto'
              textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
            }
          }, 0)
        }
        setIsOptimizing(false)
      })
    )

    unsubs.push(
      api.llm.onError(requestId, () => {
        cleanup()
        setIsOptimizing(false)
      })
    )

    setTimeout(() => {
      if (!resolved) {
        cleanup()
        setIsOptimizing(false)
      }
    }, 30000)

    try {
      const systemPrompt = t('app.youareaninputoptimization', language as Language)

      await api.llm.send({
        config,
        messages: [{ role: 'user', content: input.trim() }],
        systemPrompt,
        requestId,
      })
    } catch {
      cleanup()
      setIsOptimizing(false)
    }
  }, [input, isOptimizing, isStreaming, language, setInput, textareaRef])

  return (
    <div ref={inputContainerRef} className="z-20">
      <div
        className={`
            relative group flex flex-col rounded-xl transition-all duration-500 ease-out border
            ${isStreaming
            ? 'bg-surface border-accent/20 shadow-[0_4px_24px_-12px_rgba(var(--accent)/0.15)]'
            : isFocused
              ? 'bg-background border-accent/30 shadow-[0_8px_32px_-16px_rgba(var(--accent)/0.2)] ring-1 ring-accent/10 translate-y-[-1px]'
              : 'bg-surface border-border/50 hover:border-text-primary/10 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.1)]'
          }
        `}
      >
        {/* Attachment Previews */}
        {images.length > 0 && (
          <div className="flex gap-2 px-4 pt-4 overflow-x-auto custom-scrollbar">
            {images.map((att) => (
              <div
                key={att.id}
                className="relative group/att flex-shrink-0 rounded-xl overflow-hidden border border-border shadow-sm"
              >
                {att.isImage && att.previewUrl ? (
                  <div className="w-16 h-16 relative">
                    <img src={att.previewUrl} alt="preview" className="w-full h-full object-cover" />
                    {att.analyzeMode && (
                      <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                        <Eye className="w-4 h-4 text-accent" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 bg-surface/50 min-w-[120px] max-w-[180px]">
                    {getFileIcon(att.file.name, att.file.type)}
                    <span className="text-[12px] text-text-secondary truncate max-w-[100px]">{att.file.name}</span>
                  </div>
                )}
                {att.isImage && (
                  <button
                    onClick={() => toggleAnalyzeMode(att.id)}
                    className={`absolute top-1 left-1 p-1 backdrop-blur rounded-full transition-all opacity-0 group-hover/att:opacity-100 scale-90 hover:scale-100 ${
                      att.analyzeMode
                        ? 'bg-accent/80 text-white'
                        : 'bg-black/50 text-white/70 hover:text-white'
                    }`}
                    title={att.analyzeMode
                      ? lt('app.visualanalysisonai', language as Language)
                      : lt('app.clicktoenablevisual', language as Language)
                    }
                  >
                    {att.analyzeMode ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
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

        {/* Context Display Area (Top) */}
        {(contextItems.length > 0 || hasCodebaseRef || hasSymbolsRef || hasGitRef || hasTerminalRef || hasWebRef || fileRefs.length > 0 || (activeFilePath && onAddFile && !contextItems.some(i => i.type === 'File' && (i as FileContext).uri === activeFilePath))) && (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-1 border-b border-border/10">
            <AnimatePresence>
              {/* Active File Suggestion */}
              {activeFilePath && onAddFile && !contextItems.some(i => i.type === 'File' && (i as FileContext).uri === activeFilePath) && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => {
                    onAddFile(activeFilePath)
                    // 这里如果能自动清除输入框里的失焦状态体验会更好，暂通过 state 刷新实现
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/5 text-accent text-[12px] font-medium rounded-lg border border-accent/10 select-none hover:bg-accent/10 transition-colors"
                >
                  <Plus className="w-3 h-3" strokeWidth={3} />
                  <span>{getFileName(activeFilePath)}</span>
                </motion.button>
              )}

              {/* Context Items */}
              {contextItems.filter(item => ['File', 'Folder', 'CodeSelection', 'Skill'].includes(item.type)).map((item, i) => {
                const getContextStyle = (type: string) => {
                  switch (type) {
                    case 'File': return { bg: 'bg-text-primary/[0.04]', text: 'text-text-secondary', border: 'border-transparent', Icon: FileText }
                    case 'CodeSelection': return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-transparent', Icon: Code }
                    case 'Folder': return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-transparent', Icon: Folder }
                    case 'Skill': return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', Icon: Wrench }
                    default: return { bg: 'bg-text-primary/[0.04]', text: 'text-text-muted', border: 'border-transparent', Icon: FileText }
                  }
                }

                const style = getContextStyle(item.type)
                const label = (() => {
                  switch (item.type) {
                    case 'File':
                    case 'Folder': {
                      const uri = (item as import('@intelligence/providerTypes').FileContext).uri || ''
                      return getFileName(uri) || uri
                    }
                    case 'CodeSelection': {
                      const codeItem = item as import('@intelligence/providerTypes').CodeSelectionContext
                      const uri = codeItem.uri || ''
                      const range = codeItem.range as [number, number] | undefined
                      const name = getFileName(uri) || uri
                      return range ? `${name}:${range[0]}-${range[1]}` : name
                    }
                    case 'Skill': {
                      return `@${(item as import('@intelligence/providerTypes').SkillContext).skillId || 'skill'}`
                    }
                    default: return 'Context'
                  }
                })()

                return (
                  <motion.span
                    key={`${item.type}-${'uri' in item ? (item as { uri: string }).uri : i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
                    transition={{ duration: 0.15 }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${style.bg} ${style.text} text-[12px] font-medium rounded-lg border ${style.border} select-none group/chip transition-all hover:border-opacity-100 hover:shadow-sm`}
                  >
                    <style.Icon className="w-3 h-3 opacity-70" />
                    <span className="max-w-[120px] truncate">{label}</span>
                    <button
                      onClick={() => onRemoveContextItem(item)}
                      className="ml-0.5 p-0.5 rounded-full hover:bg-black/20 text-current hover:text-red-400 opacity-60 group-hover/chip:opacity-100 transition-all"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.span>
                )
              })}
            </AnimatePresence>

            {/* Other Reference Chips */}
            {hasCodebaseRef && <ContextChip icon={Database} label="@codebase" color="green" />}
            {hasSymbolsRef && <ContextChip icon={Code} label="@symbols" color="pink" />}
            {hasGitRef && <ContextChip icon={GitBranch} label="@git" color="orange" />}
            {hasTerminalRef && <ContextChip icon={Terminal} label="@terminal" color="cyan" />}
            {hasWebRef && <ContextChip icon={Globe} label="@web" color="blue" />}
          </div>
        )}

        {/* TextField Area */}
        <div className="flex flex-col px-4 pb-3 pt-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={hasApiKey ? t('chatInputPlaceholder', language) : needsCloudLogin ? t('cloudLoginRequired', language) : t('configureApiKey', language)}
            disabled={!hasApiKey}
            className="w-full bg-transparent border-none p-0 py-2.5
                       text-[15px] text-text-primary placeholder-text-muted/40 resize-none
                       focus:ring-0 focus:outline-none leading-relaxed custom-scrollbar max-h-[50vh] caret-accent font-medium tracking-wide"
            rows={1}
            style={{ minHeight: '48px', fontSize: `${Math.max(14, editorConfig.chatFontSize ?? editorConfig.fontSize)}px` }}
          />

          {voiceInput.state === 'recording' && voiceInput.partialText && (
            <div className="px-0 py-1 text-sm text-accent/70 italic truncate">
              {voiceInput.partialText}
            </div>
          )}

          {/* Bottom Actions */}
          <div className="relative flex items-center justify-between pt-1 gap-2">
            <div className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
              <ModeSelector mode={chatMode} onModeChange={setChatMode} disabled={isStreaming} />
              <ModelSelector alignLeft disabled={isStreaming} />
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                onChange={(e) => {
                  if (isStreaming) return
                  if (e.target.files) {
                    Array.from(e.target.files).forEach(addAttachment)
                  }
                  e.target.value = ''
                }}
              />
              {voiceInput.state === 'idle' && (
                <>
                  <ActionButton
                    variant="ghost"
                    size="icon"
                    onClick={() => !isStreaming && fileInputRef.current?.click()}
                    disabled={isStreaming}
                    title={t('app.uploadattachment', language as Language)}
                    className={`rounded-xl w-8 h-8 transition-all active:scale-95 ${
                      isStreaming
                        ? 'opacity-40 cursor-not-allowed text-text-muted'
                        : 'hover:bg-surface-active text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <Paperclip className="w-4 h-4 opacity-70 group-hover:opacity-100" />
                  </ActionButton>
                  {/* 截图提问按钮：触发全屏区域选择，截图完成后作为附件添加到输入框 */}
                  <ActionButton
                    variant="ghost"
                    size="icon"
                    onClick={handleScreenshot}
                    disabled={isStreaming}
                    title={lt('截图提问', 'Screenshot & Ask')}
                    className={`rounded-xl w-8 h-8 transition-all active:scale-95 ${
                      isStreaming
                        ? 'opacity-40 cursor-not-allowed text-text-muted'
                        : 'hover:bg-surface-active text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <Crop className="w-4 h-4 opacity-70 group-hover:opacity-100" />
                  </ActionButton>

                  <button
                    onClick={handleOptimize}
                    disabled={!input.trim() || isOptimizing || isStreaming || !hasApiKey}
                    title={t('app.optimizeinput', language as Language)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300
                      ${isOptimizing
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : input.trim() && hasApiKey && !isStreaming
                          ? 'bg-surface/50 text-text-muted hover:text-accent hover:bg-accent/10 border border-border/30 hover:border-accent/20 active:scale-95'
                          : 'bg-transparent text-text-muted/30 cursor-not-allowed border border-transparent'
                      }
                      `}
                  >
                    {isOptimizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                  </button>
                </>
              )}

              {isStreaming ? (
                <button
                  onClick={onAbort}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-surface/50 text-text-primary border border-text-primary/10 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20"
                >
                  <div className="w-2.5 h-2.5 bg-current rounded-[1px] animate-pulse" />
                </button>
              ) : voiceInput.state !== 'idle' ? (
                <div className="relative flex items-center gap-2">
                  {voiceInput.state === 'recording' && voiceInput.stream && (
                    <div className="w-20 h-8 flex items-center">
                      <VoiceVisualizer
                        stream={voiceInput.stream}
                        isActive={voiceInput.state === 'recording'}
                        color="rgb(239, 68, 68)"
                        height={32}
                        barCount={16}
                        barGap={1}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={voiceInput.state === 'recording' ? voiceInput.stopRecording : undefined}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (voiceInput.state === 'recording') {
                        voiceInput.cancelRecording();
                      }
                    }}
                    disabled={voiceInput.state === 'requesting' || voiceInput.state === 'processing'}
                    className={`relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none
                      ${voiceInput.state === 'recording'
                        ? 'w-9 h-9 bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600'
                        : 'w-8 h-8 bg-blue-500/20 text-blue-400 cursor-wait'
                      }`}
                    title={voiceInput.state === 'recording' ? 'Stop recording' : voiceInput.state === 'processing' ? 'Processing...' : 'Requesting microphone...'}
                  >
                    {voiceInput.state === 'recording' && (
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-red-400"
                        animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      />
                    )}
                    {(voiceInput.state === 'requesting' || voiceInput.state === 'processing') ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ) : isSendable ? (
                <button
                  onClick={onSubmit}
                  disabled={!hasApiKey || hasPendingToolCall}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300
                    ${hasApiKey && !hasPendingToolCall
                      ? 'bg-accent text-white shadow-md shadow-accent/20 hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 border border-transparent'
                      : 'bg-text-primary/5 text-text-muted/75 cursor-not-allowed border border-transparent'
                    }
                    `}
                >
                  <ArrowUp className="w-5 h-5 stroke-[3]" />
                </button>
              ) : (
                <button
                  onClick={voiceInput.startRecording}
                  disabled={!hasApiKey}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300
                    ${hasApiKey
                      ? 'bg-surface/50 text-text-muted hover:text-accent hover:bg-accent/10 border border-border/30 hover:border-accent/20 active:scale-95'
                      : 'bg-text-primary/5 text-text-muted/75 cursor-not-allowed border border-transparent'
                    }
                    `}
                  title={lt('语音输入', 'Voice input')}
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/*
        授权方式栏：独立底部栏，粘附在输入框容器底部
        - 用 clip-path 让顶部 12px（= rounded-xl 圆角距离）完全透明，直接露出容器底部圆角区
          → 永不透色（透明区无背景可渗透）、永不断开（露出容器本体），且无需匹配容器多变的状态底色
        - 主体背景接近边框色、无边框、层级 z-10 低于容器 z-20
        - padding-top 容纳透明区高度，内容下移不贴顶
      */}
      <div
        className="-mt-5 z-10"
      >
        <div className="flex items-center gap-2 bg-border/20 px-4 pt-6 pb-1 rounded-b-xl rounded-t-none">
          <AuthorizationModeSelector disabled={isStreaming} />
        </div>
      </div>
    </div>
  )
})

export default ChatInput

function getFileIcon(fileName: string, mimeType: string) {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    if (mimeType.startsWith('image/')) return <FileText className="w-4 h-4 text-green-400 flex-shrink-0" />
    const codeExts = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt', 'vue', 'svelte']
    if (codeExts.includes(ext)) return <FileCode className="w-4 h-4 text-blue-400 flex-shrink-0" />
    const dataExts = ['csv', 'xlsx', 'xls', 'tsv', 'json', 'xml']
    if (dataExts.includes(ext)) return <FileSpreadsheet className="w-4 h-4 text-emerald-400 flex-shrink-0" />
    const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2']
    if (archiveExts.includes(ext)) return <Archive className="w-4 h-4 text-amber-400 flex-shrink-0" />
    return <FileIcon className="w-4 h-4 text-text-muted flex-shrink-0" />
}

// 辅助组件：上下文 Chip
function ContextChip({ icon: Icon, label, color }: { icon: any, label: string, color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    pink: 'text-pink-400 bg-pink-400/10 border-pink-400/20',
    orange: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
    cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${colorMap[color]} text-[12px] font-medium rounded-lg border animate-fade-in select-none`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  )
}
