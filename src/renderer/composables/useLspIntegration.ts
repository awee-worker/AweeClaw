/**
 * LSP 与 Monaco 编辑器集成 Hook
 *
 * 负责 LSP 服务启动、Provider 注册、诊断同步与链接跳转。
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'
import {
  startLspServer,
  didOpenDocument,
  onDiagnostics,
} from '@services/languageServerAdapter'
import { registerLspProviders } from '@services/languageServerProviders'
import { pathLinkService } from '@services/pathLinkAdapter'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { normalizeLspUri } from '@shared/toolkit/uriHelper'
import type { editor } from 'monaco-editor'
import { LSP_SUPPORTED_LANGUAGES } from '@shared/languageRegistry'

/** 路径链接支持的语言（LSP 语言 + markdown） */
const PATH_LINK_LANGUAGES: string[] = [...LSP_SUPPORTED_LANGUAGES, 'markdown']

/** Monaco 诊断同步防抖时长 */
const MARKER_SYNC_DEBOUNCE_MS = 500

/** Monaco 命名空间类型别名 */
type MonacoNS = typeof import('monaco-editor')

/** 可释放资源句柄 */
type Disposable = import('monaco-editor').IDisposable

/* ------------------------------------------------------------------ */
/* 诊断转换                                                          */
/* ------------------------------------------------------------------ */

/** LSP 严重级别到 Monaco MarkerSeverity 的映射 */
function lspSeverityToMonaco(
  monaco: MonacoNS,
  severity: number,
): import('monaco-editor').MarkerSeverity {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error
    case 2:
      return monaco.MarkerSeverity.Warning
    case 3:
      return monaco.MarkerSeverity.Info
    default:
      return monaco.MarkerSeverity.Hint
  }
}

/** Monaco MarkerSeverity 到 LSP 严重级别的映射 */
function monacoSeverityToLsp(
  monaco: MonacoNS,
  severity: import('monaco-editor').MarkerSeverity,
): number {
  switch (severity) {
    case monaco.MarkerSeverity.Error:
      return 1
    case monaco.MarkerSeverity.Warning:
      return 2
    case monaco.MarkerSeverity.Info:
      return 3
    default:
      return 4
  }
}

/** 将 Monaco marker code 转为字符串 */
function stringifyCode(code: unknown): string | undefined {
  if (code == null) return undefined
  if (typeof code === 'object' && code !== null && 'value' in code) {
    return String((code as { value: unknown }).value)
  }
  return String(code)
}

/* ------------------------------------------------------------------ */
/* Hook                                                              */
/* ------------------------------------------------------------------ */

export function useLspIntegration() {
  const workspacePath = useStore((state) => state.workspacePath)
  const isLspReady = useStore((state) => state.isLspReady)
  const setIsLspReady = useStore((state) => state.setIsLspReady)

  const disposablesRef = useRef<Disposable[]>([])

  /* ---------------- 启动 LSP 服务 ---------------- */
  useEffect(() => {
    if (!workspacePath || isLspReady) return

    let cancelled = false
    logger.ui.info('[LSP] Starting server for workspace:', workspacePath)

    startLspServer(workspacePath).then((success) => {
      if (cancelled) return
      if (success) {
        logger.ui.info('[LSP] Server started successfully')
        setIsLspReady(true)
      } else {
        logger.ui.warn('[LSP] Server failed to start')
      }
    })

    return () => {
      cancelled = true
    }
  }, [workspacePath, isLspReady, setIsLspReady])

  /* ---------------- 卸载时清理 ---------------- */
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d.dispose())
      disposablesRef.current = []
    }
  }, [])

  /* ---------------- 注册 Provider ---------------- */
  const registerProviders = useCallback((monaco: MonacoNS) => {
    disposablesRef.current.forEach((d) => d.dispose())
    disposablesRef.current = []

    const lspDisposables = registerLspProviders(monaco as typeof import('monaco-editor'))
    if (Array.isArray(lspDisposables)) {
      disposablesRef.current.push(...lspDisposables)
    }

    const linkDisposable = monaco.languages.registerLinkProvider(
      PATH_LINK_LANGUAGES,
      pathLinkService.createLinkProvider(),
    )
    disposablesRef.current.push(linkDisposable)
  }, [])

  /* ---------------- 诊断同步 ---------------- */
  const setupDiagnostics = useCallback((monaco: MonacoNS) => {
    // LSP 诊断 -> Monaco markers
    const unsubscribeLsp = onDiagnostics((uri, diagnostics) => {
      const normalizedUri = normalizeLspUri(uri)
      const model = monaco.editor.getModels().find((m: { uri: { toString: () => string } }) => normalizeLspUri(m.uri.toString()) === normalizedUri)
      if (!model) return

      const markers = diagnostics.map((d) => ({
        severity: lspSeverityToMonaco(monaco, d.severity),
        message: d.message,
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        source: d.source,
        code: d.code?.toString(),
      }))
      monaco.editor.setModelMarkers(model, 'lsp', markers)
    })

    // Monaco markers -> diagnosticsStore
    const collectMonacoMarkers = () => {
      for (const model of monaco.editor.getModels()) {
        const uri = model.uri.toString()
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })

        const diagnostics = markers.map((marker: import('monaco-editor').editor.IMarker) => ({
          range: {
            start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
            end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
          },
          severity: monacoSeverityToLsp(monaco, marker.severity),
          message: marker.message,
          source: marker.source || 'monaco',
          code: stringifyCode(marker.code),
        }))

        useDiagnosticsStore.getState().setDiagnostics(uri, diagnostics)
      }
    }

    collectMonacoMarkers()

    let syncTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedSync = () => {
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(collectMonacoMarkers, MARKER_SYNC_DEBOUNCE_MS)
    }

    const markerDisposable = monaco.editor.onDidChangeMarkers(debouncedSync)

    return () => {
      unsubscribeLsp()
      markerDisposable.dispose()
      if (syncTimer) clearTimeout(syncTimer)
    }
  }, [])

  /* ---------------- Ctrl+Click 跳转 ---------------- */
  const setupLinkNavigation = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    editorInstance.onMouseDown((e) => {
      if (!e.event.ctrlKey && !e.event.metaKey) return

      const model = editorInstance.getModel()
      const position = e.target.position
      if (!model || !position) return

      const language = model.getLanguageId()
      const content = model.getValue()
      const linkPath = pathLinkService.getLinkAtPosition(content, language, position.lineNumber, position.column)
      if (!linkPath) return

      const { activeFilePath } = useStore.getState()
      if (!activeFilePath) return

      e.event.preventDefault()
      e.event.stopPropagation()
      pathLinkService.handlePathClick(linkPath, activeFilePath)
    })
  }, [])

  /* ---------------- 通知文件打开 ---------------- */
  const notifyFileOpened = useCallback(
    (filePath: string, content: string) => {
      void didOpenDocument(filePath, content).then((success) => {
        if (success && !useStore.getState().isLspReady) {
          setIsLspReady(true)
        }
      })
    },
    [setIsLspReady],
  )

  return {
    isLspReady,
    registerProviders,
    setupDiagnostics,
    setupLinkNavigation,
    notifyFileOpened,
  }
}
