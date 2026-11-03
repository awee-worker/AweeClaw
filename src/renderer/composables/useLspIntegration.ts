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
  stopLspServer,
  didOpenDocument,
  onDiagnostics,
} from '@services/languageServerAdapter'
import { registerLspProviders } from '@services/languageServerProviders'
import { pathLinkService } from '@services/pathLinkAdapter'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { normalizeLspUri } from '@shared/toolkit/uriHelper'
import type { editor } from 'monaco-editor'
import { LSP_SUPPORTED_LANGUAGES } from '@shared/languageRegistry'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { isLspAvailable } from '@renderer/modes/lspAvailability'

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
  const currentSceneMode = useSceneModeStore((state) => state.currentSceneMode)

  // 语言服务器只在代码开发场景下启用：其它场景不启动进程、不注册 provider、
  // 也不把文档同步给服务器，避免后台常驻一个用不上的服务实例
  const lspAvailable = isLspAvailable(currentSceneMode)

  /**
   * 路径链接 provider 句柄
   *
   * provider 注册在 monaco 全局实例上，编辑器重新挂载时不需要（也不应该）重复注册：
   * 重复注册会让一次 Ctrl+Click 触发多份解析。这里只保留首个句柄，
   * 与 LSP provider 一样跟随渲染进程生命周期。
   */
  const linkProviderRef = useRef<Disposable | null>(null)

  /* ---------------- 启动 / 停止 LSP 服务 ---------------- */
  useEffect(() => {
    if (!lspAvailable) {
      // 从开发场景切走后回收已启动的实例
      if (isLspReady) {
        logger.ui.info('[LSP] Scene mode left dev, stopping language servers')
        void stopLspServer().then(() => setIsLspReady(false))
      }
      return
    }

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
  }, [workspacePath, isLspReady, setIsLspReady, lspAvailable])

  /*
   * 内置语义常开，不随 LSP 状态关闭。
   *
   * 内置 ts.worker 对当前文件的补全、悬停、定义跳转不依赖索引与 IPC，
   * 写入即可用；外部 LSP 需要启动进程、建推断项目、索引 node_modules，
   * 首次响应往往要几十秒，且超时后只返回 null。两条链路并存时 Monaco 会
   * 合并结果 —— 慢的那一路只是让浮层晚一点收敛，而关掉内置那一路会让
   * 编辑器在 LSP 未响应期间彻底失去语言能力。宁可慢，不可无。
   */

  /* ---------------- 注册 Provider ---------------- */
  const registerProviders = useCallback((monaco: MonacoNS) => {
    // LSP provider 注册即生效、无法按场景撤销，因此非开发场景直接跳过；
    // 路径链接是纯文本解析，与语言服务器无关，任何场景都保留
    if (isLspAvailable(useSceneModeStore.getState().currentSceneMode)) {
      // 注册入口内部保证幂等：provider 全局唯一，不随编辑器实例累积
      registerLspProviders(monaco as typeof import('monaco-editor'))
    }

    if (!linkProviderRef.current) {
      linkProviderRef.current = monaco.languages.registerLinkProvider(
        PATH_LINK_LANGUAGES,
        pathLinkService.createLinkProvider(),
      )
    }
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
      if (!isLspAvailable(useSceneModeStore.getState().currentSceneMode)) return
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
