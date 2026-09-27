/**
 * 编辑器事件监听 Hook
 */
import { useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import type { editor } from 'monaco-editor'

/** 选区文本同步防抖：拖选会连续触发选区变化事件，逐帧写入全局 store 会驱动 ChatPanel 等订阅方反复重渲染 */
const SELECTION_SYNC_DELAY_MS = 150

/** 写入 store 的选区文本上限：避免全选大文件时把整份内容塞进全局状态 */
const SELECTED_CODE_MAX_CHARS = 50_000

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

  // 选区同步防抖定时器（拖选时只在选区稳定后读取一次文本）
  const selectionDebounceRef = useRef<NodeJS.Timeout | null>(null)

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
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current)

      if (!model || !e.selection || e.selection.isEmpty()) {
        selectionDebounceRef.current = setTimeout(() => setSelectedCode(''), SELECTION_SYNC_DELAY_MS)
        return
      }

      const selection = e.selection
      selectionDebounceRef.current = setTimeout(() => {
        // 拖选会逐帧触发该事件：等选区稳定后再读取文本，
        // 并对超大选区截断，避免把整份文件内容写进全局 store。
        try {
          const selectedText = model.getValueInRange(selection)
          setSelectedCode(
            selectedText.length > SELECTED_CODE_MAX_CHARS
              ? selectedText.slice(0, SELECTED_CODE_MAX_CHARS)
              : selectedText,
          )
        } catch {
          // 延迟期间内容变化可能导致 range 失效，忽略即可
        }
      }, SELECTION_SYNC_DELAY_MS)
    })
  }, [])

  return { setupCursorTracking }
}
