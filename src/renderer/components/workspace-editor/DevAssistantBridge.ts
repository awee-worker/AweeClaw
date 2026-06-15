/**
 * DevAssistant 场景 Hooks 桥接层
 *
 * WorkspaceEditor 依赖 dev-assistant 场景的 hooks，
 * 使用动态 import 初始化，失败时返回 stub 实现。
 */

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

let _useEditorActions: UseEditorActionsFn = () => ({
  registerActions: () => {},
})
let _useAICompletion: UseAICompletionFn = () => ({
  registerProvider: () => {},
})
let _useEditorEvents: UseEditorEventsFn = () => ({
  setupCursorTracking: () => {},
})
let _useComposerInlineDiff: UseComposerInlineDiffFn = () => {}

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