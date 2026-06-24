/**
 * 流式处理器 — 助手响应的流式处理
 *
 * 职责：
 * - 收集文本、推理、工具调用事件
 * - 解析并组装最终结果
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { EventBus } from './EventDispatcher'
import { getErrorMessage, ErrorCode } from '@shared/toolkit/errorCatalog'
import type { ToolCall, TokenUsage } from '@intelligence/providerTypes'
import type { LLMCallResult } from '@intelligence/providerTypes'
import { filterToolCallLeakChunk } from '@intelligence/utils/toolCallSanitizer'
import { t } from '@renderer/i18n'
import { StreamingEditPreviewCoordinator } from '../runtime/editPreviewStreamer'
import type { LLMStreamSource } from '@shared/protocols/modelGateway'
import {
  arePartialArgsEqual,
  parseFinalJsonArgs,
  parsePartialJsonArgs,
} from './toolArgStreamDecoder'
import { joinPath } from '@shared/toolkit/pathHelper'

// Tracks active IPC listeners for leak debugging.
let activeListenerCount = 0

export function getActiveListenerCount(): number {
  return activeListenerCount
}

// ===== Stream Processor =====

export interface StreamProcessor {
  wait: () => Promise<LLMCallResult>
  cleanup: () => void
}

export function createStreamProcessor(
  assistantId: string | null,
  store: import('../state/IntelligenceStore').ThreadBoundStore,
  requestId: string,
  options?: {
    allowToolCalls?: boolean
  }
): StreamProcessor {
  const allowToolCalls = options?.allowToolCalls ?? true

  let content = ''
  let reasoning = ''
  let isInReasoning = false
  let reasoningPartId: string | null = null
  let toolCalls: ToolCall[] = []
  let sources: LLMStreamSource[] = []
  let usage: TokenUsage | undefined
  let error: string | undefined
  let retryable: boolean | undefined
  let isCleanedUp = false
  let filteredToolMarkupBuffer = ''
  let pendingToolCallAvailableCount = 0

  const streamingToolCalls = new Map<string, {
    id: string
    name: string
    argsString: string
    lastPreviewArgs?: Record<string, unknown>
  }>()
  const streamingEditPreviewCoordinator = new StreamingEditPreviewCoordinator()

  // 流式文件内容预览状态
  const streamingFilePreview = new Map<string, {
    filePath: string
    workspacePath: string
    lastContent: string
    hasEmittedWriting: boolean
  }>()
  let filePreviewRafId: number | null = null
  const pendingFilePreviewUpdates = new Map<string, {
    content: string
    filePath: string
    workspacePath: string
    isComplete: boolean
  }>()

  let toolUpdateRafId: number | null = null
  const pendingToolPreviewUpdates = new Map<string, {
    partialArgs?: Record<string, unknown>
    name?: string
    timestamp: number
  }>()

  // Cleanup callbacks for request-scoped listeners.
  const cleanups: (() => void)[] = []

  const drainToolPreviewQueue = () => {
    if (toolUpdateRafId !== null) {
      clearTimeout(toolUpdateRafId)
      toolUpdateRafId = null
    }

    if (!assistantId || pendingToolPreviewUpdates.size === 0) return

    for (const [toolId, update] of pendingToolPreviewUpdates) {
      store.setToolStreamingPreview(toolId, {
        isStreaming: true,
        ...(update.partialArgs ? { partialArgs: update.partialArgs } : {}),
        ...(update.name ? { name: update.name } : {}),
        lastUpdateTime: update.timestamp,
      })
    }

    pendingToolPreviewUpdates.clear()
  }

  const scheduleToolPreviewFlush = () => {
    if (toolUpdateRafId !== null) return

    // 降低工具预览更新频率，避免频繁触发状态更新
    toolUpdateRafId = window.setTimeout(() => {
      toolUpdateRafId = null
      drainToolPreviewQueue()
    }, 150) as unknown as number
  }

  const enqueueToolPreviewUpdate = (
    toolId: string,
    update: {
      partialArgs?: Record<string, unknown>
      name?: string
      timestamp: number
    }
  ) => {
    const current = pendingToolPreviewUpdates.get(toolId)
    pendingToolPreviewUpdates.set(toolId, {
      ...current,
      ...update,
      timestamp: update.timestamp,
    })
    scheduleToolPreviewFlush()
  }

  const synchronizeEditPreviewStream = async (toolId: string, toolName: string, partialArgs?: Record<string, unknown>) => {
    await streamingEditPreviewCoordinator.sync(
      toolId,
      toolName,
      partialArgs,
      useStore.getState().workspacePath
    )
  }

  // ===== 流式文件内容预览（打字机效果）=====
  const STREAMABLE_FILE_TOOLS = new Set(['write_file', 'create_file_or_folder'])
  const MIN_CONTENT_LENGTH_FOR_PREVIEW = 20
  const FILE_PREVIEW_THROTTLE_MS = 80

  // 仅对文档类型文件启用实时预览（代码文件不预览）
  const DOCUMENT_EXTENSIONS = new Set([
    'md', 'mdx', 'txt', 'rst', 'adoc', 'asciidoc', 'json', 'yaml', 'yml', 'xml',
    'csv', 'tsv', 'log', 'ini', 'conf', 'config',
    'dockerfile', 'makefile', 'gitignore', 'gitattributes',
    'env', 'properties', 'toml',
  ])

  const isPreviewableDocument = (filePath: string): boolean => {
    const lowerPath = filePath.toLowerCase()
    // 无扩展名的文件（如 Dockerfile、Makefile）
    const baseName = lowerPath.split(/[/\\]/).pop() || ''
    if (DOCUMENT_EXTENSIONS.has(baseName)) return true
    // 有扩展名的文件
    const ext = lowerPath.split('.').pop() || ''
    return DOCUMENT_EXTENSIONS.has(ext)
  }

  const normalizeFilePath = (path: string, workspacePath: string | null): string => {
    if (!workspacePath) return path
    const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(path)
    return isAbsolute ? path : joinPath(workspacePath, path)
  }

  const extractContentFragment = (argsString: string): string | null => {
    const contentMatch = argsString.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (!contentMatch) return null
    return contentMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }

  const drainFilePreviewQueue = () => {
    if (filePreviewRafId !== null) {
      clearTimeout(filePreviewRafId)
      filePreviewRafId = null
    }

    for (const [toolId, update] of pendingFilePreviewUpdates) {
      EventBus.emit({
        type: 'file:stream_content',
        filePath: update.filePath,
        workspacePath: update.workspacePath,
        content: update.content,
        toolCallId: toolId,
        isComplete: update.isComplete,
      })
    }
    pendingFilePreviewUpdates.clear()
  }

  const scheduleFilePreviewFlush = () => {
    if (filePreviewRafId !== null) return
    filePreviewRafId = window.setTimeout(() => {
      filePreviewRafId = null
      drainFilePreviewQueue()
    }, FILE_PREVIEW_THROTTLE_MS) as unknown as number
  }

  const synchronizeFilePreviewStream = (toolId: string, toolName: string, argsString: string) => {
    if (!STREAMABLE_FILE_TOOLS.has(toolName)) return

    const workspacePath = useStore.getState().workspacePath
    const partialArgs = parsePartialJsonArgs(argsString)
    if (!partialArgs || typeof partialArgs.path !== 'string') return

    const filePath = normalizeFilePath(partialArgs.path, workspacePath)

    // 仅文档类型文件启用实时预览
    if (!isPreviewableDocument(filePath)) return

    const partialContent = extractContentFragment(argsString)
    if (partialContent === null) return

    const previewState = streamingFilePreview.get(toolId)
    if (previewState) {
      if (partialContent === previewState.lastContent) return
      previewState.lastContent = partialContent
      if (!previewState.hasEmittedWriting && partialContent.length >= MIN_CONTENT_LENGTH_FOR_PREVIEW) {
        previewState.hasEmittedWriting = true
        EventBus.emit({ type: 'file:writing', filePath, workspacePath: workspacePath || '' })
      }
    } else {
      const hasEnoughContent = partialContent.length >= MIN_CONTENT_LENGTH_FOR_PREVIEW
      streamingFilePreview.set(toolId, {
        filePath,
        workspacePath: workspacePath || '',
        lastContent: partialContent,
        hasEmittedWriting: hasEnoughContent,
      })
      if (hasEnoughContent) {
        EventBus.emit({ type: 'file:writing', filePath, workspacePath: workspacePath || '' })
      }
    }

    pendingFilePreviewUpdates.set(toolId, {
      content: partialContent,
      filePath,
      workspacePath: workspacePath || '',
      isComplete: false,
    })
    scheduleFilePreviewFlush()
  }

  const completeFilePreviewStream = (toolId: string, toolName: string, finalArgs: Record<string, unknown>) => {
    if (!STREAMABLE_FILE_TOOLS.has(toolName)) return

    const workspacePath = useStore.getState().workspacePath
    const path = typeof finalArgs.path === 'string' ? finalArgs.path : ''
    if (!path) return

    const filePath = normalizeFilePath(path, workspacePath)

    // 仅文档类型文件启用实时预览
    if (!isPreviewableDocument(filePath)) return

    const content = typeof finalArgs.content === 'string' ? finalArgs.content : ''

    streamingFilePreview.delete(toolId)

    pendingFilePreviewUpdates.set(toolId, {
      content,
      filePath,
      workspacePath: workspacePath || '',
      isComplete: true,
    })
    drainFilePreviewQueue()
  }

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true

    if (toolUpdateRafId !== null) {
      clearTimeout(toolUpdateRafId)
      toolUpdateRafId = null
    }
    if (filePreviewRafId !== null) {
      clearTimeout(filePreviewRafId)
      filePreviewRafId = null
    }
    pendingToolPreviewUpdates.clear()
    pendingFilePreviewUpdates.clear()
    streamingFilePreview.clear()
    streamingEditPreviewCoordinator.releaseAll()

    for (const fn of cleanups) {
      try {
        fn()
        activeListenerCount--
      } catch (err) {
        logger.agent.error('[StreamProcessor] Cleanup error:', err)
      }
    }
    cleanups.length = 0
    logger.agent.info('[StreamProcessor] Active listeners remaining:', activeListenerCount)
  }

  const processStreamEvent = (data: {
    type: string
    content?: string
    id?: string
    name?: string
    arguments?: unknown
    argumentsDelta?: string
    usage?: unknown
    source?: LLMStreamSource
  }) => {
    switch (data.type) {
      case 'text':
        if (data.content) {
          const filtered = filterToolCallLeakChunk(data.content, filteredToolMarkupBuffer)
          const visibleChunk = filtered.visibleText
          filteredToolMarkupBuffer = filtered.buffer

          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }

          store.setStreamState({ streamDetail: 'responding', waitPhase: 'idle', retryAttempt: undefined, retryDelay: undefined })

          content += visibleChunk
          if (assistantId && visibleChunk) {
            store.appendToAssistant(assistantId, visibleChunk)
          }
          if (visibleChunk) {
            EventBus.emit({ type: 'stream:text', text: visibleChunk })
          }
        }
        break

      case 'reasoning': {
        const reasoningContent = data.content
        if (reasoningContent) {
          if (!isInReasoning) {
            isInReasoning = true
            if (assistantId) {
              reasoningPartId = store.addReasoningPart(assistantId)
              store.updateMessage(assistantId, {
                reasoningStartTime: Date.now(),
              } as Partial<import('../providerTypes').AssistantMessage>)
            }
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'start' })
          }

          store.setStreamState({ streamDetail: 'reasoning', waitPhase: 'idle', retryAttempt: undefined, retryDelay: undefined })

          reasoning += reasoningContent
          if (assistantId && reasoningPartId) {
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
            store.updateMessage(assistantId, {
              reasoning,
            } as Partial<import('../providerTypes').AssistantMessage>)
          }
          EventBus.emit({ type: 'stream:reasoning', text: reasoningContent, phase: 'delta' })
        }
        break
      }

      case 'tool_call_start': {
        if (!allowToolCalls) {
          break
        }

        const toolId = data.id || `tool-${Date.now()}`
        const toolName = data.name || '...'

        if (isInReasoning && assistantId && reasoningPartId) {
          store.finalizeReasoningPart(assistantId, reasoningPartId)
          EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
          isInReasoning = false
        }

        streamingToolCalls.set(toolId, {
          id: toolId,
          name: toolName,
          argsString: '',
        })

        pendingToolCallAvailableCount++

        if (assistantId) {
          store.setToolStreamingPreview(toolId, {
            isStreaming: true,
            name: toolName,
            lastUpdateTime: Date.now(),
          })
        }
        EventBus.emit({ type: 'stream:tool_start', id: toolId, name: toolName })
        break
      }

      case 'tool_call_delta': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id
        const argsDelta = data.argumentsDelta

        if (tcId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            if (argsDelta) {
              tc.argsString += argsDelta

              if (assistantId) {
                const partialArgs = parsePartialJsonArgs(tc.argsString)
                if (partialArgs && Object.keys(partialArgs).length > 0) {
                  if (!arePartialArgsEqual(tc.lastPreviewArgs, partialArgs)) {
                    tc.lastPreviewArgs = partialArgs
                    enqueueToolPreviewUpdate(tc.id, {
                      partialArgs,
                      timestamp: Date.now(),
                    })
                    void synchronizeEditPreviewStream(tc.id, tc.name, partialArgs)
                  }
                }
              }

              // 流式文件内容预览（打字机效果）
              synchronizeFilePreviewStream(tc.id, tc.name, tc.argsString)
            }
            if (data.name && data.name !== tc.name) {
              tc.name = data.name
              if (assistantId) {
                enqueueToolPreviewUpdate(tc.id, {
                      name: data.name,
                      timestamp: Date.now(),
                    })
              }
            }
            EventBus.emit({ type: 'stream:tool_delta', id: tc.id, args: tc.argsString })
          }
        }
        break
      }

      case 'tool_call_delta_end': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id
        if (tcId && assistantId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            drainToolPreviewQueue()
            const finalArgs = parseFinalJsonArgs(tc.argsString)
            const resolvedArgs = finalArgs || tc.lastPreviewArgs || {}
            if (finalArgs) {
              void synchronizeEditPreviewStream(tc.id, tc.name, finalArgs)
              store.updateToolCall(assistantId, tc.id, {
                arguments: finalArgs,
                streamingState: undefined,
              })
            }

            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.name,
              arguments: resolvedArgs,
              status: 'pending',
            }

            const existingIdx = toolCalls.findIndex(t => t.id === tc.id)
            if (existingIdx === -1) {
              toolCalls.push(toolCall)
            } else {
              toolCalls[existingIdx] = toolCall
            }

            // 最终化流式文件内容预览
            if (finalArgs) {
              completeFilePreviewStream(tc.id, tc.name, finalArgs)
            }
          }
        }
        break
      }

      case 'tool_call_available': {
        if (!allowToolCalls) {
          break
        }

        const tcId = data.id || ''
        const toolName = data.name || ''
        const args = data.arguments as Record<string, unknown>

        if (tcId) {
          drainToolPreviewQueue()
          streamingToolCalls.delete(tcId)
          pendingToolCallAvailableCount = Math.max(0, pendingToolCallAvailableCount - 1)
        }

        const toolCall: ToolCall = {
          id: tcId,
          name: toolName,
          arguments: args,
          status: 'pending',
        }

        const existingIdx = toolCalls.findIndex(tc => tc.id === tcId)
        if (existingIdx === -1) {
          toolCalls.push(toolCall)
        } else {
          toolCalls[existingIdx] = toolCall
        }

        if (assistantId && tcId) {
          store.setToolStreamingPreview(tcId, {
            isStreaming: true,
            name: toolName,
            partialArgs: args,
            lastUpdateTime: Date.now(),
          })
          store.updateToolCall(assistantId, tcId, {
            arguments: args,
            streamingState: undefined,
          })
        }

        void synchronizeEditPreviewStream(tcId, toolName, args)

        // 最终化流式文件内容预览（兜底处理）
        completeFilePreviewStream(tcId, toolName, args)

        EventBus.emit({ type: 'stream:tool_available', id: tcId, name: toolName, args })
        break
      }

      case 'usage':
        if (data.usage) {
          usage = data.usage as TokenUsage
        }
        break

      case 'source':
        if (data.source) {
          sources.push(data.source)
          if (assistantId) {
            store.upsertSourcesPart(assistantId, data.source)
          }
        }
        break
    }
  }

  const completeReasoningPhase = () => {
    if (isInReasoning) {
      if (assistantId && reasoningPartId) {
        store.finalizeReasoningPart(assistantId, reasoningPartId)
      }
      EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
      isInReasoning = false
    }
  }

  // Promise resolver is hoisted to avoid listener registration races.
  let resolveWait: ((result: LLMCallResult) => void) | null = null
  let isResolved = false

  const waitPromise = new Promise<LLMCallResult>((resolve) => {
    resolveWait = resolve
  })

  const doResolve = (result: LLMCallResult) => {
    if (isResolved) return
    isResolved = true

    if (resolveWait) {
      resolveWait(result)
    }

    cleanup()
  }

  // Handle request error.
  const resolveWithError = (err: { message?: string; code?: string; suggestion?: string } | string) => {
    let errorMsg: string
    let errorCode: string | undefined
    let errorSuggestion: string | undefined

    if (typeof err === 'string') {
      errorMsg = err
    } else {
      errorCode = err.code
      errorSuggestion = err.suggestion
      if (err.code && err.code in ErrorCode) {
        const language = useStore.getState().language
        const baseMsg = getErrorMessage(err.code as ErrorCode, language)
        errorMsg = err.message ? `${baseMsg}: ${err.message}` : baseMsg
      } else {
        const language = useStore.getState().language as 'en' | 'zh'
        errorMsg = err.message || t('error.unknown', language)
      }
    }

    logger.agent.error('[StreamProcessor] Error:', errorMsg)
    error = errorMsg
    retryable = typeof err === 'object' && err !== null && 'retryable' in err ? (err as { retryable?: boolean }).retryable : undefined
    completeReasoningPhase()
    doResolve({ content, toolCalls, sources, usage, error: errorMsg, retryable, errorCode, errorSuggestion })
  }

  const resolveWithSuccess = (result: { reasoning?: string; usage?: unknown }) => {
    if (result?.usage) {
      usage = result.usage as TokenUsage
    }
    if (typeof result?.reasoning === 'string' && result.reasoning.length >= reasoning.length) {
      const missingReasoning = result.reasoning.slice(reasoning.length)
      reasoning = result.reasoning

      if (assistantId && missingReasoning && reasoningPartId) {
        store.updateReasoningPart(assistantId, reasoningPartId, missingReasoning, true)
      }

      if (assistantId) {
        store.updateMessage(assistantId, {
          reasoning,
        } as Partial<import('../providerTypes').AssistantMessage>)
      }
    }
    drainToolPreviewQueue()

    const resolveWhenReady = () => {
      completeReasoningPhase()
      doResolve({ content, reasoning, toolCalls, sources, usage, error })
    }

    if (pendingToolCallAvailableCount > 0) {
      const startTime = Date.now()
      const maxWait = 2000
      const checkInterval = 10
      const poll = () => {
        if (pendingToolCallAvailableCount <= 0 || Date.now() - startTime > maxWait) {
          resolveWhenReady()
        } else {
          window.setTimeout(poll, checkInterval)
        }
      }
      window.setTimeout(poll, 0)
    } else {
      window.setTimeout(resolveWhenReady, 0)
    }
  }

  // Subscribe only to this request's IPC channel.
  const unsubStream = api.llm.onStream(requestId, processStreamEvent)
  const unsubError = api.llm.onError(requestId, resolveWithError)
  const unsubDone = api.llm.onDone(requestId, resolveWithSuccess)

  cleanups.push(unsubStream, unsubError, unsubDone)
  activeListenerCount += 3

  // Expose the already-created completion promise.
  const wait = (): Promise<LLMCallResult> => waitPromise

  return { wait, cleanup }
}
