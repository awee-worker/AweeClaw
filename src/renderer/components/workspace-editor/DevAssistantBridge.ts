/**
 * DevAssistant 场景 Hooks 桥接层
 *
 * WorkspaceEditor 依赖 dev-assistant 场景的 hooks，
 * 使用动态 import 初始化，失败时返回 stub 实现。
 *
 * 关键约束：stub 函数必须调用与真实实现**相同数量**的 React hooks，
 * 否则动态 import 解析后会导致 hook 链表不一致，触发
 * "Cannot read properties of undefined (reading 'length')" 错误。
 *
 * Hook 计数（与真实实现保持一致）：
 *   useEditorActions:     1  (useCallback)
 *   useAICompletion:      4  (useRef + useCallback + 2×useEffect)
 *   useEditorEvents:      3  (2×useEffect + useCallback)
 *   useComposerInlineDiff:9  (2×useState + 4×useRef + 3×useEffect)
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type UseEditorActionsFn = (setInlineEditState: any) => {
  registerActions: (editorInstance: any, monaco: any) => void
}
type UseAICompletionFn = (filePath: string | null) => {
  registerProvider: (monaco: any) => void
}
type UseEditorEventsFn = (editorRef: any) => {
  setupCursorTracking: (editor: any, cursorDebounceRef: any) => void
}
type UseComposerInlineDiffFn = (
  filePath: string | null,
  editorInstance: any,
  monacoInstance: any
) => void

// ── Stub 实现（hook 数量与真实实现一致） ──

let _useEditorActions: UseEditorActionsFn = (setInlineEditState) => {
  const registerActions = useCallback(() => {}, [setInlineEditState])
  return { registerActions }
}

let _useAICompletion: UseAICompletionFn = (filePath) => {
  useRef(null) // providerRef
  const registerProvider = useCallback(() => {}, [filePath])
  useEffect(() => {}, [filePath])
  useEffect(() => {}, [])
  return { registerProvider }
}

let _useEditorEvents: UseEditorEventsFn = (editorRef) => {
  useEffect(() => {}, [editorRef])
  useEffect(() => {}, [editorRef])
  const setupCursorTracking = useCallback(() => {}, [])
  return { setupCursorTracking }
}

let _useComposerInlineDiff: UseComposerInlineDiffFn = (
  filePath,
  editorInstance,
  monacoInstance
) => {
  useState(null) // pendingChange
  useState(null) // debouncedChange
  useRef([])    // zoneIdsRef
  useRef(null)  // decorationsRef
  useRef([])    // containerRefs
  useRef(null)  // timerRef
  useEffect(() => {}, [filePath])
  useEffect(() => {}, [filePath]) // 依赖 pendingChange（stub 中始终为 null）
  useEffect(() => {}, [filePath, editorInstance, monacoInstance])
}

// ── 动态加载 ──

let _hooksInitialized = false

async function initHooks(): Promise<void> {
  if (_hooksInitialized) return
  _hooksInitialized = true
  try {
    const mod = await import('./hooks')
    _useEditorActions = mod.useEditorActions
    _useAICompletion = mod.useAICompletion
    _useEditorEvents = mod.useEditorEvents
    _useComposerInlineDiff = mod.useComposerInlineDiff
  } catch {
    // 场景未安装，使用 stub
  }
}

initHooks()

export { _useEditorActions as useEditorActions }
export { _useAICompletion as useAICompletion }
export { _useEditorEvents as useEditorEvents }
export { _useComposerInlineDiff as useComposerInlineDiff }