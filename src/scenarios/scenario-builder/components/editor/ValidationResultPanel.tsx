/**
 * 校验结果面板（ValidationResultPanel）
 *
 * 调用 scenarioBuilderValidate IPC 校验当前选中项目，展示返回的 errors / warnings。
 *
 * 布局：
 * 1. 顶部工具栏：运行校验 / 清空 / 状态徽章
 * 2. 主区：
 *    - 错误列表（红色高亮）
 *    - 警告列表（黄色高亮）
 *    - 通过状态：显示绿色徽章
 * 3. 底部：错误/警告总数汇总
 *
 * 数据来源：types/index.ts 中的 ValidationResult / ValidationError / ValidationWarning
 *
 * 设计要点：
 * - 单列布局，适配侧边栏宽度
 * - 字体 ≥ 12px
 * - 错误/警告使用警告图标，通过使用绿色徽章
 */
import { useState, useCallback, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import type { ValidationResult, ValidationError, ValidationWarning } from '../../types'
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Play,
  Trash2,
  FolderOpen,
} from 'lucide-react'

// ==========================================
// 主组件
// ==========================================

const ValidationResultPanel: React.FC = () => {
  const { t } = useI18n()
  const { project } = useSelectedProject()

  // 校验结果
  const [result, setResult] = useState<ValidationResult | null>(null)
  // 加载状态
  const [validating, setValidating] = useState(false)
  // 错误信息
  const [error, setError] = useState<string>('')

  // ==========================================
  // 运行校验
  // ==========================================

  const handleValidate = useCallback(async () => {
    if (!project) return
    setValidating(true)
    setError('')
    setResult(null)
    try {
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderValidate) {
        throw new Error('IPC scenarioBuilderValidate not available')
      }
      const response = await electronAPI.scenarioBuilderValidate({
        projectPath: project.localPath,
      })
      if (!response?.success) {
        throw new Error(response?.error || t('builder.validation.failed'))
      }
      // 兼容两种返回：{ valid, errors, warnings } 或 { result: { valid, errors, warnings } }
      const payload: ValidationResult = response.result ?? {
        valid: response.valid ?? true,
        errors: response.errors ?? [],
        warnings: response.warnings ?? [],
      }
      setResult(payload)
    } catch (err) {
      setError((err as Error).message || t('builder.validation.failed'))
    } finally {
      setValidating(false)
    }
  }, [project, t])

  // 清空结果
  const handleClear = useCallback(() => {
    setResult(null)
    setError('')
  }, [])

  // ==========================================
  // 派生状态
  // ==========================================

  const summary = useMemo(() => {
    if (!result) return null
    const errors = result.errors?.length ?? 0
    const warnings = result.warnings?.length ?? 0
    return { errors, warnings, passed: result.valid && errors === 0 }
  }, [result])

  // ==========================================
  // 渲染
  // ==========================================

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">{t('builder.validation.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部标题栏 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
          <h2 className="truncate text-[13px] font-medium">{t('builder.validation.title')}</h2>
        </div>
        {/* 操作按钮行 */}
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            onClick={handleValidate}
            disabled={validating}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[12px] text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent"
            title={t('builder.validation.runValidate')}
          >
            <Play className="h-3 w-3" />
            {validating ? t('builder.validation.validating') : t('builder.validation.runValidate')}
          </button>
          <button
            onClick={handleClear}
            disabled={validating || (!result && !error)}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40"
            title={t('builder.validation.clear')}
          >
            <Trash2 className="h-3 w-3" />
            {t('builder.validation.clear')}
          </button>
          {summary && (
            <span
              className={`ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[12px] ${
                summary.passed
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {summary.passed ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <ShieldAlert className="h-3 w-3" />
              )}
              {summary.passed
                ? t('builder.validation.passed')
                : t('builder.validation.failed')}
            </span>
          )}
        </div>
      </div>

      {/* ========== 状态提示 ========== */}
      {error && (
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-[12px] text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        </div>
      )}

      {/* ========== 汇总信息 ========== */}
      {summary && (
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[12px] text-muted-foreground">
          {t('builder.validation.summary')
            .replace('{errors}', String(summary.errors))
            .replace('{warnings}', String(summary.warnings))}
        </div>
      )}

      {/* ========== 主区域 ========== */}
      <div className="flex-1 overflow-y-auto">
        {/* 空状态 */}
        {!result && !error && !validating && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-[12px] text-muted-foreground">{t('builder.validation.empty')}</p>
          </div>
        )}

        {/* 加载中 */}
        {validating && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <p className="text-[12px] text-muted-foreground">{t('builder.validation.validating')}</p>
          </div>
        )}

        {/* 通过状态 */}
        {result && summary?.passed && (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-[13px] font-medium text-emerald-600">
              {t('builder.validation.passed')}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {t('builder.validation.noIssues')}
            </p>
          </div>
        )}

        {/* 错误列表 */}
        {result && result.errors?.length > 0 && (
          <div className="border-b border-border/60">
            <div className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-destructive">
              <ShieldAlert className="h-3 w-3" />
              {t('builder.validation.errors')}：{result.errors.length}
            </div>
            <ul>
              {result.errors.map((err: ValidationError, idx: number) => (
                <li
                  key={`err-${idx}`}
                  className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-[12px]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-destructive">{err.code || 'E'}</span>
                    <span className="font-medium text-foreground">{err.field || '-'}</span>
                  </div>
                  <p className="mt-1 text-foreground/80">{err.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 警告列表 */}
        {result && result.warnings?.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-yellow-600">
              <AlertTriangle className="h-3 w-3" />
              {t('builder.validation.warnings')}：{result.warnings.length}
            </div>
            <ul>
              {result.warnings.map((warn: ValidationWarning, idx: number) => (
                <li
                  key={`warn-${idx}`}
                  className="border-l-2 border-yellow-500 bg-yellow-500/5 px-3 py-2 text-[12px]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-yellow-600">{warn.code || 'W'}</span>
                    <span className="font-medium text-foreground">{warn.field || '-'}</span>
                  </div>
                  <p className="mt-1 text-foreground/80">{warn.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default ValidationResultPanel
