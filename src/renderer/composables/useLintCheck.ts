/**
 * 代码 Lint 检查 Hook
 *
 * 调用 lint 服务获取错误，并在 Monaco 编辑器中渲染标记。
 */

import { useCallback, useState } from 'react'
import { logger } from '@toolkit/LogEngine'
import { lintService } from '@intelligence/runtime/codeAnalysisService'
import type { LintError } from '@intelligence/providerTypes'
import type { editor } from 'monaco-editor'

/** Monaco 实例类型别名 */
type MonacoInstance =
  | typeof import('monaco-editor')
  | typeof import('monaco-editor/esm/vs/editor/editor.api')

/** Hook 返回值 */
export interface UseLintCheckResult {
  lintErrors: LintError[]
  isLinting: boolean
  errorCount: number
  warningCount: number
  runLintCheck: (
    filePath: string,
    editorRef: editor.IStandaloneCodeEditor | null,
    monacoRef: MonacoInstance | null,
  ) => Promise<void>
  clearLintErrors: () => void
}

/** 将 LintError 转换为 Monaco marker */
function toMarker(
  err: LintError,
  monaco: MonacoInstance,
): editor.IMarkerData {
  return {
    severity:
      err.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `[${err.code}] ${err.message}`,
    startLineNumber: err.startLine ?? 1,
    startColumn: 1,
    endLineNumber: err.endLine ?? 1,
    endColumn: 1000,
  }
}

export function useLintCheck(): UseLintCheckResult {
  const [lintErrors, setLintErrors] = useState<LintError[]>([])
  const [isLinting, setIsLinting] = useState(false)

  const runLintCheck = useCallback(
    async (
      filePath: string,
      editorRef: editor.IStandaloneCodeEditor | null,
      monacoRef: MonacoInstance | null,
    ) => {
      if (!filePath) return

      setIsLinting(true)
      try {
        const { errors } = await lintService.getLintErrors(filePath, true)
        setLintErrors(errors)

        if (editorRef && monacoRef) {
          const model = editorRef.getModel()
          if (model) {
            monacoRef.editor.setModelMarkers(
              model,
              'lint',
              errors.map((err) => toMarker(err, monacoRef)),
            )
          }
        }
      } catch (e) {
        logger.ui.error('Lint check failed:', e)
      } finally {
        setIsLinting(false)
      }
    },
    [],
  )

  const clearLintErrors = useCallback(() => setLintErrors([]), [])

  const errorCount = lintErrors.filter((e) => e.severity === 'error').length
  const warningCount = lintErrors.filter((e) => e.severity === 'warning').length

  return {
    lintErrors,
    isLinting,
    runLintCheck,
    clearLintErrors,
    errorCount,
    warningCount,
  }
}
