/**
 * TaskQualityFields — 任务质量元数据表单字段
 *
 * 在 TaskFormDialog 中以可折叠的「质量要求」区域呈现，引导用户填写：
 * - 预期产出：明确交付什么（文件/文档/格式）
 * - 验收标准：可勾选的检查清单（一行一条）
 * - 约束条件：技术栈/编码规范/禁止事项
 *
 * 设计原则：
 * - 可选字段，不强制（避免增加用户负担）
 * - 折叠态显示填写进度，展开后编辑
 * - 验收标准用 textarea + 换行分隔，降低操作成本
 * - 字段值通过 onChange 实时回传父组件
 */
import { useState, useCallback, useMemo } from 'react'
import { ChevronDown, ChevronRight, Target, ListChecks, ShieldAlert, Sparkles, Loader2 } from 'lucide-react'
import type { TaskQualityMeta } from './taskQuality'

interface TaskQualityFieldsProps {
  /** 当前质量元数据 */
  value: TaskQualityMeta
  /** 是否中文 */
  isZh: boolean
  /** 值变更回调 */
  onChange: (value: TaskQualityMeta) => void
  /** AI 优化回调（点击「AI 优化」时触发） */
  onAiOptimize?: () => void
  /** AI 优化进行中 */
  aiOptimizing?: boolean
}

export function TaskQualityFields({
  value,
  isZh,
  onChange,
  onAiOptimize,
  aiOptimizing,
}: TaskQualityFieldsProps) {
  const [expanded, setExpanded] = useState(false)
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh])

  // 填写进度（已填字段数 / 总字段数）
  const filledCount = useMemo(() => {
    let count = 0
    if (value.expectedOutput?.trim()) count++
    if (value.acceptanceCriteria && value.acceptanceCriteria.length > 0) count++
    if (value.constraints?.trim()) count++
    return count
  }, [value])

  const handleExpectedOutputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...value, expectedOutput: e.target.value })
    },
    [value, onChange],
  )

  const handleCriteriaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // 按换行分割为数组，过滤空行
      const lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean)
      onChange({ ...value, acceptanceCriteria: lines })
    },
    [value, onChange],
  )

  const handleConstraintsChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...value, constraints: e.target.value })
    },
    [value, onChange],
  )

  // 验收标准回显（数组转文本）
  const criteriaText = useMemo(
    () => (value.acceptanceCriteria || []).join('\n'),
    [value.acceptanceCriteria],
  )

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      {/* 折叠头 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-hover/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        )}
        <span className="text-[13px] font-medium text-text-primary flex-1 text-left">
          {t('质量要求', 'Quality Requirements')}
        </span>
        {/* 填写进度指示 */}
        {filledCount > 0 ? (
          <span className="text-[12px] text-accent bg-accent/10 px-2 py-0.5 rounded-full">
            {filledCount}/3
          </span>
        ) : (
          <span className="text-[12px] text-text-muted/60">{t('可选', 'Optional')}</span>
        )}
        {/* AI 优化按钮 */}
        {onAiOptimize && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onAiOptimize() }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onAiOptimize() } }}
            className={`flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full transition-colors ${
              aiOptimizing
                ? 'text-text-muted bg-surface-hover/40 cursor-wait'
                : 'text-accent hover:bg-accent/10 cursor-pointer'
            }`}
          >
            {aiOptimizing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {aiOptimizing ? t('优化中...', 'Optimizing...') : t('AI 优化', 'AI Optimize')}
          </span>
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/20">
          {/* 预期产出 */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary mb-1.5">
              <Target className="w-3.5 h-3.5" />
              {t('预期产出', 'Expected Output')}
            </label>
            <textarea
              value={value.expectedOutput || ''}
              onChange={handleExpectedOutputChange}
              placeholder={isZh
                ? '明确交付什么，例如：创建 /src/auth/login.ts，实现登录验证逻辑，导出 login 函数'
                : 'Specify deliverables, e.g.: Create /src/auth/login.ts implementing login validation, export login function'}
              rows={2}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none placeholder:text-text-muted/50"
            />
          </div>

          {/* 验收标准 */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary mb-1.5">
              <ListChecks className="w-3.5 h-3.5" />
              {t('验收标准', 'Acceptance Criteria')}
              <span className="text-text-muted/60 font-normal">{t('（每行一条）', ' (one per line)')}</span>
            </label>
            <textarea
              value={criteriaText}
              onChange={handleCriteriaChange}
              placeholder={isZh
                ? '每行一条验收标准，例如：\n实现登录表单验证\n返回 JWT token\n错误时给出提示'
                : 'One criterion per line, e.g.:\nImplement login form validation\nReturn JWT token\nShow error on failure'}
              rows={3}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none placeholder:text-text-muted/50"
            />
          </div>

          {/* 约束条件 */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary mb-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              {t('约束条件', 'Constraints')}
            </label>
            <textarea
              value={value.constraints || ''}
              onChange={handleConstraintsChange}
              placeholder={isZh
                ? '技术栈/编码规范/禁止事项，例如：使用 TypeScript，遵循 ESLint 规范，禁止使用 any'
                : 'Tech stack/coding standards/restrictions, e.g.: Use TypeScript, follow ESLint, no any type'}
              rows={2}
              className="w-full px-3 py-2 bg-surface/50 rounded-lg border border-border/40 focus:border-accent/50 text-[13px] text-text-primary outline-none transition-colors resize-none placeholder:text-text-muted/50"
            />
          </div>

          {/* AI 建议展示 */}
          {value.aiSuggestions && (
            <div className="rounded-lg bg-accent/5 border border-accent/20 p-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-accent mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                {t('AI 优化建议', 'AI Suggestions')}
              </div>
              <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                {value.aiSuggestions}
              </p>
            </div>
          )}

          {/* 质量评分 */}
          {value.qualityScore != null && (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-text-muted">{t('描述清晰度', 'Clarity Score')}:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <span
                    key={n}
                    className={`w-1.5 h-1.5 rounded-full ${
                      n <= value.qualityScore! ? 'bg-accent' : 'bg-border'
                    }`}
                  />
                ))}
                <span className="text-accent font-medium ml-1">{value.qualityScore}/10</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
