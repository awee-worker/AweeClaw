/**
 * 编辑器快捷键和动作 Hook
 */
import { useCallback } from 'react'
import type { editor, IPosition, IRange } from 'monaco-editor'
import { goToDefinition } from '@services/languageServerAdapter'
import { lspUriToPath } from '@shared/toolkit/uriHelper'
import { getFileName } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'
import {
  revealLocation,
  setActiveEditorInstance,
  goBack,
  goForward,
  DEFINITION_PICKER_EVENT,
  type DefinitionCandidate,
  type DefinitionPickerRequest,
} from '@services/editorNavigation'
import { useReferencesStore } from '@services/referencesRepository'

export { DEFINITION_PICKER_EVENT }
export type { DefinitionPickerRequest }

interface InlineEditState {
  show: boolean
  position: { x: number; y: number }
  selectedCode: string
  lineRange: [number, number]
}

/** 工作区相对路径展示（不在工作区内时回退原路径） */
function toDisplayPath(filePath: string): string {
  const workspacePath = useStore.getState().workspacePath
  if (!workspacePath) return filePath
  const normalizedFile = filePath.replace(/\\/g, '/')
  const normalizedWs = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedWs) return filePath
  return normalizedFile.startsWith(`${normalizedWs}/`) ? normalizedFile.slice(normalizedWs.length + 1) : filePath
}

/** Quick Pick 锚点：贴在光标下方，无坐标信息时回退到左上角 */
function getPickerAnchor(editorInstance: editor.IStandaloneCodeEditor): { x: number; y: number } {
  const position = editorInstance.getPosition()
  const coords = position ? editorInstance.getScrolledVisiblePosition(position) : null
  const domNode = editorInstance.getDomNode()
  if (coords && domNode) {
    const rect = domNode.getBoundingClientRect()
    return {
      x: Math.round(rect.left + coords.left),
      y: Math.round(rect.top + coords.top + coords.height),
    }
  }
  return { x: 120, y: 160 }
}

/**
 * 执行 Go-to-Definition 导航。
 *  - 单一目标：直接跳转（同文件移动光标 / 跨文件打开并定位），并写入导航历史
 *  - 多个目标：唤起多定义 Quick Pick，由用户选择后再跳转
 */
export async function navigateToDefinition(
  editorInstance: editor.IStandaloneCodeEditor,
  filePath: string,
  line: number,   // LSP 0-indexed
  col: number,    // LSP 0-indexed
  documentText?: string
) {
  // 跳转入口使用的必定是当前活跃编辑器：登记后供历史导航 / 引用面板复用
  setActiveEditorInstance(editorInstance)

  const locations = await goToDefinition(filePath, line, col, documentText)
  if (!locations || locations.length === 0) return

  const candidates: DefinitionCandidate[] = locations.map((loc) => {
    const targetPath = lspUriToPath(loc.uri)
    const targetLine = loc.range.start.line + 1       // Monaco 1-indexed
    const targetCol = loc.range.start.character + 1
    return {
      uri: loc.uri,
      filePath: targetPath,
      line: targetLine,
      column: targetCol,
      label: `${getFileName(targetPath) || targetPath}:${targetLine}`,
      detail: toDisplayPath(targetPath),
    }
  })

  if (candidates.length > 1) {
    window.dispatchEvent(new CustomEvent<DefinitionPickerRequest>(DEFINITION_PICKER_EVENT, {
      detail: { items: candidates, position: getPickerAnchor(editorInstance) },
    }))
    return
  }

  const target = candidates[0]
  // stdlib / 工作区外文件会被安全模块拦截，revealLocation 内部静默失败
  await revealLocation({ filePath: target.filePath, line: target.line, column: target.column })
}

/**
 * 查找引用并展示在引用结果面板（Dock Tab: references）。
 * F12 系列快捷键、右键菜单、命令面板共用同一条链路。
 */
export async function openReferencesPanel(editorInstance: editor.IStandaloneCodeEditor): Promise<void> {
  const model = editorInstance.getModel()
  const position = editorInstance.getPosition()
  if (!model || !position) return

  const filePath = lspUriToPath(model.uri.toString())
  const word = model.getWordAtPosition(position)

  useStore.getState().openDockPanel('references')
  await useReferencesStore.getState().findReferencesAt(
    filePath,
    position.lineNumber - 1,
    position.column - 1,
    word?.word,
  )
}

export function useEditorActions(
  setInlineEditState: (state: InlineEditState | null) => void
) {
  const registerActions = useCallback((
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) => {
    const teardownFns: Array<() => void> = []
    let definitionDecorationIds: string[] = []
    let modifierPressed = false
    let lastHoverPosition: IPosition | null = null
    let hoverProbeSeq = 0
    let hoverProbeTimer: ReturnType<typeof setTimeout> | null = null
    const definitionAvailabilityCache = new Map<string, boolean>()

    const clearDefinitionDecoration = () => {
      if (hoverProbeTimer) {
        clearTimeout(hoverProbeTimer)
        hoverProbeTimer = null
      }
      if (definitionDecorationIds.length > 0) {
        definitionDecorationIds = editorInstance.deltaDecorations(definitionDecorationIds, [])
      }
      const domNode = editorInstance.getDomNode()
      if (domNode) {
        domNode.style.cursor = ''
      }
    }

    const applyDefinitionDecoration = (range: IRange) => {
      definitionDecorationIds = editorInstance.deltaDecorations(definitionDecorationIds, [{
        range,
        options: {
          inlineClassName: 'aweeclaw-definition-link',
        },
      }])
      const domNode = editorInstance.getDomNode()
      if (domNode) {
        domNode.style.cursor = 'pointer'
      }
    }

    const updateDefinitionHoverDecoration = async (position: IPosition | null) => {
      lastHoverPosition = position

      if (!modifierPressed || !position) {
        clearDefinitionDecoration()
        return
      }

      const model = editorInstance.getModel()
      if (!model) {
        clearDefinitionDecoration()
        return
      }

      const word = model.getWordAtPosition(position)
      if (!word) {
        clearDefinitionDecoration()
        return
      }

      const probeKey = `${model.uri.toString()}:${position.lineNumber}:${word.startColumn}-${word.endColumn}`
      const wordRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)

      const cachedAvailability = definitionAvailabilityCache.get(probeKey)
      if (cachedAvailability !== undefined) {
        if (cachedAvailability) {
          applyDefinitionDecoration(wordRange)
        } else {
          clearDefinitionDecoration()
        }
        return
      }

      if (hoverProbeTimer) {
        clearTimeout(hoverProbeTimer)
      }

      hoverProbeTimer = setTimeout(async () => {
        hoverProbeTimer = null
        const seq = ++hoverProbeSeq
        const filePath = lspUriToPath(model.uri.toString())

        try {
          const locations = await goToDefinition(
            filePath,
            position.lineNumber - 1,
            position.column - 1,
            model.getValue()
          )
          const hasDefinition = !!locations && locations.length > 0
          definitionAvailabilityCache.set(probeKey, hasDefinition)

          if (seq !== hoverProbeSeq) return
          if (!modifierPressed || !lastHoverPosition) return
          if (lastHoverPosition.lineNumber !== position.lineNumber || lastHoverPosition.column !== position.column) return

          if (hasDefinition) {
            applyDefinitionDecoration(wordRange)
          } else {
            clearDefinitionDecoration()
          }
        } catch {
          if (seq === hoverProbeSeq) {
            clearDefinitionDecoration()
          }
        }
      }, 120)
    }

    // Ctrl+D: 选择下一个匹配
    editorInstance.addAction({
      id: 'select-next-occurrence',
      label: 'DropdownSelector Next Occurrence',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (ed) => ed.getAction('editor.action.addSelectionToNextFindMatch')?.run()
    })

    // Ctrl+/: 切换注释
    editorInstance.addAction({
      id: 'toggle-comment',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => ed.getAction('editor.action.commentLine')?.run()
    })

    // Ctrl+Shift+K: 删除行
    editorInstance.addAction({
      id: 'delete-line',
      label: 'Delete Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
      run: (ed) => ed.getAction('editor.action.deleteLines')?.run()
    })

    // Cmd+K / Ctrl+K: 内联编辑
    editorInstance.addAction({
      id: 'inline-edit',
      label: 'Inline Edit with AI',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) {
          const position = ed.getPosition()
          if (position) {
            ed.setSelection({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: ed.getModel()?.getLineMaxColumn(position.lineNumber) || 1
            })
          }
        }

        const newSelection = ed.getSelection()
        if (newSelection && !newSelection.isEmpty()) {
          const model = ed.getModel()
          if (model) {
            const selectedText = model.getValueInRange(newSelection)
            const editorDomNode = ed.getDomNode()
            const coords = ed.getScrolledVisiblePosition(newSelection.getStartPosition())

            if (editorDomNode && coords) {
              const rect = editorDomNode.getBoundingClientRect()
              setInlineEditState({
                show: true,
                position: {
                  x: rect.left + Math.max(0, coords.left - 20),
                  y: rect.top + Math.max(0, coords.top - 36)
                },
                selectedCode: selectedText,
                lineRange: [newSelection.startLineNumber, newSelection.endLineNumber]
              })
            }
          }
        }
      }
    })

    // ── F12: Go to Definition（覆盖 Monaco 内置 revealDefinition）──────────
    // 使用 addCommand 的优先级高于 Monaco 内置 F12 绑定
    editorInstance.addCommand(monaco.KeyCode.F12, async () => {
      const model = editorInstance.getModel()
      const position = editorInstance.getPosition()
      if (!model || !position) return
      const filePath = lspUriToPath(model.uri.toString())
      try {
        await navigateToDefinition(
          editorInstance, filePath,
          position.lineNumber - 1, position.column - 1,
          model.getValue()
        )
      } catch { /* 静默忽略，如 stdlib 等不可访问路径 */ }
    })

    // ── Shift+F12: 查找引用（引用结果面板）──────────────────────────────────
    editorInstance.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
      void openReferencesPanel(editorInstance)
    })

    // ── 导航历史：Alt+← / Alt+→（macOS 兼容 Ctrl+- / Ctrl+Shift+-）──────────
    editorInstance.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => { void goBack() })
    editorInstance.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => { void goForward() })
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => { void goBack() })
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Minus, () => { void goForward() })

    // ── Ctrl+Click: Go to Definition ─────────────────────────────────────────
    // multiCursorModifier:'alt' 时 Ctrl+Click 触发定义跳转
    // 我们接管整个 Ctrl+Click 流程（包括同文件），防止 Monaco standalone 尝试跨文件打开
    editorInstance.onMouseDown(async (e) => {
      const browserButton = (e.event.browserEvent as MouseEvent | undefined)?.button
      // 鼠标侧键（3=后退 / 4=前进）：与 VS Code / 浏览器一致
      if (browserButton === 3 || browserButton === 4) {
        e.event.preventDefault()
        if (browserButton === 3) await goBack()
        else await goForward()
        return
      }

      if (!e.event.ctrlKey && !e.event.metaKey) return
      if (!e.target.position) return

      // 立即拦截，防止 Monaco 内部的 Ctrl+Click 导航逻辑触发
      e.event.preventDefault()

      const model = editorInstance.getModel()
      if (!model) return
      const filePath = lspUriToPath(model.uri.toString())
      try {
        await navigateToDefinition(
          editorInstance, filePath,
          e.target.position.lineNumber - 1, e.target.position.column - 1,
          model.getValue()
        )
      } catch { /* 静默忽略 */ }
    })

    editorInstance.onMouseMove((e) => {
      const position = e.target.position || null
      modifierPressed = !!(e.event.ctrlKey || e.event.metaKey)
      void updateDefinitionHoverDecoration(position)
    })

    editorInstance.onMouseLeave(() => {
      lastHoverPosition = null
      clearDefinitionDecoration()
    })

    const syncModifierState = (event: KeyboardEvent) => {
      const nextModifierPressed = !!(event.metaKey || event.ctrlKey)
      if (nextModifierPressed === modifierPressed) return
      modifierPressed = nextModifierPressed
      void updateDefinitionHoverDecoration(lastHoverPosition)
    }

    const handleWindowBlur = () => {
      modifierPressed = false
      lastHoverPosition = null
      clearDefinitionDecoration()
    }

    window.addEventListener('keydown', syncModifierState, true)
    window.addEventListener('keyup', syncModifierState, true)
    window.addEventListener('blur', handleWindowBlur)
    teardownFns.push(() => window.removeEventListener('keydown', syncModifierState, true))
    teardownFns.push(() => window.removeEventListener('keyup', syncModifierState, true))
    teardownFns.push(() => window.removeEventListener('blur', handleWindowBlur))

    editorInstance.onDidChangeModel(() => {
      definitionAvailabilityCache.clear()
      clearDefinitionDecoration()
      lastHoverPosition = null
    })

    editorInstance.onDidDispose(() => {
      clearDefinitionDecoration()
      teardownFns.forEach(fn => fn())
    })
  }, [setInlineEditState])

  return { registerActions }
}
