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
import type { ScenarioDomain } from '@configuration/defaultProfile'

/** Monaco 实例类型别名 */
type MonacoInstance =
  | typeof import('monaco-editor')
  | typeof import('monaco-editor/esm/vs/editor/editor.api')

/** 场景 Lint 检查策略 */
export interface ScenarioLintPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否启用 Lint 检查 */
  enableLint: boolean
  /** 是否将警告视为错误（严格模式） */
  strictMode: boolean
  /** 是否启用安全规则（法律/医疗场景） */
  enableSecurityRules: boolean
  /** 是否启用合规规则 */
  enableComplianceRules: boolean
  /** 最大错误数（超过则停止检查） */
  maxErrors: number
  /** 是否自动修复 */
  enableAutoFix: boolean
  /** 忽略的规则 */
  ignoredRules: string[]
}

/** 场景 Lint 策略预设 */
const SCENARIO_LINT_POLICIES: Record<ScenarioDomain, ScenarioLintPolicy> = {
  /** 法律场景：严格模式 + 安全规则 + 合规规则 */
  legal: {
    domain: 'legal',
    enableLint: true,
    strictMode: true,
    enableSecurityRules: true,
    enableComplianceRules: true,
    maxErrors: 50,
    enableAutoFix: false,
    ignoredRules: [],
  },

  /** 医疗场景：严格模式 + 安全规则 + 合规规则 + 禁止自动修复 */
  medical: {
    domain: 'medical',
    enableLint: true,
    strictMode: true,
    enableSecurityRules: true,
    enableComplianceRules: true,
    maxErrors: 30,
    enableAutoFix: false,
    ignoredRules: [],
  },

  /** 教育场景：标准模式 + 自动修复 */
  education: {
    domain: 'education',
    enableLint: true,
    strictMode: false,
    enableSecurityRules: false,
    enableComplianceRules: false,
    maxErrors: 100,
    enableAutoFix: true,
    ignoredRules: [],
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    enableLint: true,
    strictMode: false,
    enableSecurityRules: false,
    enableComplianceRules: false,
    maxErrors: 100,
    enableAutoFix: true,
    ignoredRules: [],
  },
}

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
  strictMode: boolean,
): editor.IMarkerData {
  // 严格模式：警告升级为错误
  const severity = strictMode && err.severity === 'warning' ? 'error' : err.severity
  return {
    severity:
      severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `[${err.code}] ${err.message}`,
    startLineNumber: err.startLine ?? 1,
    startColumn: 1,
    endLineNumber: err.endLine ?? 1,
    endColumn: 1000,
  }
}

/** 应用场景策略过滤 Lint 错误 */
function applyScenarioPolicy(
  errors: LintError[],
  policy: ScenarioLintPolicy,
): LintError[] {
  let filtered = errors

  // 忽略指定规则
  if (policy.ignoredRules.length > 0) {
    const ignoredSet = new Set(policy.ignoredRules)
    filtered = filtered.filter((err) => !ignoredSet.has(err.code))
  }

  // 限制最大错误数
  if (filtered.length > policy.maxErrors) {
    filtered = filtered.slice(0, policy.maxErrors)
  }

  // 严格模式：警告升级为错误
  if (policy.strictMode) {
    filtered = filtered.map((err) =>
      err.severity === 'warning' ? { ...err, severity: 'error' as const } : err,
    )
  }

  return filtered
}

export function useLintCheck(
  domain: ScenarioDomain = 'general',
): UseLintCheckResult & { policy: ScenarioLintPolicy } {
  const [lintErrors, setLintErrors] = useState<LintError[]>([])
  const [isLinting, setIsLinting] = useState(false)
  const policy = SCENARIO_LINT_POLICIES[domain]

  const runLintCheck = useCallback(
    async (
      filePath: string,
      editorRef: editor.IStandaloneCodeEditor | null,
      monacoRef: MonacoInstance | null,
    ) => {
      // 场景策略：禁用 Lint 检查
      if (!policy.enableLint) {
        setLintErrors([])
        return
      }

      if (!filePath) return

      setIsLinting(true)
      try {
        const { errors } = await lintService.getLintErrors(filePath, true)
        const filteredErrors = applyScenarioPolicy(errors, policy)
        setLintErrors(filteredErrors)

        if (editorRef && monacoRef) {
          const model = editorRef.getModel()
          if (model) {
            monacoRef.editor.setModelMarkers(
              model,
              'lint',
              filteredErrors.map((err) => toMarker(err, monacoRef, policy.strictMode)),
            )
          }
        }

        // 审计日志（法律/医疗场景）
        if (policy.enableComplianceRules) {
          logger.security.info(`[LINT-AUDIT] [${domain}] ${filePath}`, {
            errorCount: filteredErrors.filter((e) => e.severity === 'error').length,
            warningCount: filteredErrors.filter((e) => e.severity === 'warning').length,
          })
        }
      } catch (e) {
        logger.ui.error('Lint check failed:', e)
      } finally {
        setIsLinting(false)
      }
    },
    [domain, policy],
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
    policy,
  }
}

/**
 * 获取场景 Lint 策略
 */
export function getScenarioLintPolicy(domain: ScenarioDomain): ScenarioLintPolicy {
  return SCENARIO_LINT_POLICIES[domain]
}
