/**
 * 编辑器断点装饰器 Hook
 *
 * 在 Monaco 编辑器的 glyph margin 渲染断点标记，并处理点击切换。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'

/** 断点样式节点 ID */
const STYLE_NODE_ID = 'breakpoint-styles'

/** Monaco 目标类型：glyph margin */
const TARGET_GLYPH_MARGIN = 2
/** Monaco 目标类型：行号 */
const TARGET_LINE_NUMBERS = 3

/** 启用断点的装饰器选项 */
const ENABLED_DECORATION: editor.IModelDecorationOptions = {
  glyphMarginClassName: 'breakpoint-glyph',
  glyphMarginHoverMessage: { value: 'Click to remove breakpoint' },
  stickiness: 1,
}

/** 禁用断点的装饰器选项 */
const DISABLED_DECORATION: editor.IModelDecorationOptions = {
  glyphMarginClassName: 'breakpoint-glyph-disabled',
  glyphMarginHoverMessage: { value: 'Breakpoint (disabled)' },
  stickiness: 1,
}

/** 断点相关 CSS */
const BREAKPOINT_CSS = `
  .breakpoint-glyph {
    background: rgb(var(--status-error));
    border-radius: 50%;
    width: 10px !important;
    height: 10px !important;
    margin-left: 5px;
    margin-top: 5px;
    cursor: pointer;
  }
  .breakpoint-glyph-disabled {
    background: rgb(var(--surface-muted));
    border-radius: 50%;
    width: 10px !important;
    height: 10px !important;
    margin-left: 5px;
    margin-top: 5px;
    cursor: pointer;
    opacity: 0.5;
  }
  .monaco-editor .margin-view-overlays .cgmr {
    cursor: pointer;
  }
  .breakpoint-candidate {
    background: rgb(var(--status-error) / 0.3);
    border-radius: 50%;
    width: 10px !important;
    height: 10px !important;
    margin-left: 5px;
    margin-top: 5px;
  }
`

/** 注入断点样式（仅一次） */
function ensureBreakpointStyles(): void {
  if (document.getElementById(STYLE_NODE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_NODE_ID
  style.textContent = BREAKPOINT_CSS
  document.head.appendChild(style)
}

/** 将断点转换为装饰器 */
function buildDecorations(
  breakpoints: Array<{ line: number; enabled: boolean }>,
): editor.IModelDeltaDecoration[] {
  return breakpoints.map((bp) => ({
    range: {
      startLineNumber: bp.line,
      startColumn: 1,
      endLineNumber: bp.line,
      endColumn: 1,
    },
    options: bp.enabled ? ENABLED_DECORATION : DISABLED_DECORATION,
  }))
}

/** 从鼠标事件中提取行号 */
function extractLineFromTarget(target: { type: number; position?: { lineNumber?: number } }): number | undefined {
  if (target.type !== TARGET_GLYPH_MARGIN && target.type !== TARGET_LINE_NUMBERS) return undefined
  return target.position?.lineNumber
}

export interface UseEditorBreakpointsResult {
  updateDecorations: () => void
}

/**
 * 在指定编辑器中管理断点装饰与点击切换
 */
export function useEditorBreakpoints(
  editor: editor.IStandaloneCodeEditor | null,
  filePath: string | null,
): UseEditorBreakpointsResult {
  const decorationsRef = useRef<string[]>([])

  const { breakpoints, toggleBreakpoint, getBreakpointsForFile } = useStore(
    useShallow((s) => ({
      breakpoints: s.breakpoints,
      toggleBreakpoint: s.toggleBreakpoint,
      getBreakpointsForFile: s.getBreakpointsForFile,
    })),
  )

  // 注入样式
  useEffect(() => {
    ensureBreakpointStyles()
  }, [])

  // 刷新装饰器
  const updateDecorations = useCallback(() => {
    if (!editor || !filePath) return
    const model = editor.getModel()
    if (!model) return

    const fileBreakpoints = getBreakpointsForFile(filePath)
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      buildDecorations(fileBreakpoints),
    )
  }, [editor, filePath, getBreakpointsForFile])

  // 断点变化时刷新
  useEffect(() => {
    updateDecorations()
  }, [breakpoints, updateDecorations])

  // 处理 glyph margin / 行号点击
  useEffect(() => {
    if (!editor || !filePath) return

    const disposable = editor.onMouseDown((e) => {
      const line = extractLineFromTarget(e.target)
      if (line !== undefined) {
        toggleBreakpoint(filePath, line)
      }
    })

    return () => disposable.dispose()
  }, [editor, filePath, toggleBreakpoint])

  // 卸载时清理装饰器
  useEffect(() => {
    return () => {
      if (editor && decorationsRef.current.length > 0) {
        editor.deltaDecorations(decorationsRef.current, [])
        decorationsRef.current = []
      }
    }
  }, [editor])

  return { updateDecorations }
}
