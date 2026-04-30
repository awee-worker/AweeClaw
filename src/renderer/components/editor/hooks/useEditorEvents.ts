/**
 * 编辑器事件监听 Hook
 */
import { useEffect, useCallback } from 'react'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import type { editor } from 'monaco-editor'

export function useEditorEvents(editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>) {
  // 跳转到行事件
  useEffect(() => {
    const handleGotoLine = (e: CustomEvent<{ line: number; column: number }>) => {
      if (editorRef.current) {
        const { line, column } = e.detail
        editorRef.current.revealLineInCenter(line)
        editorRef.current.setPosition({ lineNumber: line, column })
        editorRef.current.focus()
      }
    }

    window.addEventListener('editor:goto-line', handleGotoLine as EventListener)
    return () => window.removeEventListener('editor:goto-line', handleGotoLine as EventListener)
  }, [editorRef])

  // 选区替换事件
  useEffect(() => {
    const handleReplaceSelection = (e: CustomEvent<{
      query: string
      replaceQuery: string
      isRegex: boolean
      isCaseSensitive: boolean
      isWholeWord: boolean
    }>) => {
      if (!editorRef.current) return
      const editor = editorRef.current
      const model = editor.getModel()
      const selection = editor.getSelection()

      if (!model || !selection || selection.isEmpty()) return

      const { query, replaceQuery, isRegex, isCaseSensitive, isWholeWord } = e.detail
      const selectedText = model.getValueInRange(selection)
      let newText = selectedText

      try {
        if (isRegex) {
          const flags = isCaseSensitive ? 'g' : 'gi'
          const regex = new RegExp(query, flags)
          newText = selectedText.replace(regex, replaceQuery)
        } else {
          const flags = isCaseSensitive ? 'g' : 'gi'
          const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regex = isWholeWord
            ? new RegExp(`\\b${escapedQuery}\\b`, flags)
            : new RegExp(escapedQuery, flags)
          newText = selectedText.replace(regex, replaceQuery)
        }

        if (newText !== selectedText) {
          editor.pushUndoStop()
          editor.executeEdits('replace-selection', [{
            range: selection,
            text: newText,
            forceMoveMarkers: true
          }])
          editor.pushUndoStop()
        }
      } catch (error) {
        logger.ui.error('Replace in selection failed:', error)
      }
    }

    window.addEventListener('editor:replace-selection', handleReplaceSelection as EventListener)
    return () => window.removeEventListener('editor:replace-selection', handleReplaceSelection as EventListener)
  }, [editorRef])

  // 光标位置追踪
  const setupCursorTracking = useCallback((
    editor: editor.IStandaloneCodeEditor,
    debounceRef: React.MutableRefObject<NodeJS.Timeout | null>
  ) => {
    const { setCursorPosition, setSelectedCode } = useStore.getState()

    editor.onDidChangeCursorPosition((e) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setCursorPosition({ line: e.position.lineNumber, column: e.position.column })
      }, 100)
    })

    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel()
      if (model && e.selection && !e.selection.isEmpty()) {
        const selectedText = model.getValueInRange(e.selection)
        setSelectedCode(selectedText)
      } else {
        setSelectedCode('')
      }
    })
  }, [])

  return { setupCursorTracking }
}
