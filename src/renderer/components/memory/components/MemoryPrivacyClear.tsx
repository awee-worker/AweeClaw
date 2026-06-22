/**
 * 记忆隐私清除工具
 * 提供按条件批量清除记忆的能力，支持预览和确认
 */
import { useState, useCallback } from 'react'
import {
  Shield,
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { useMemoryStore } from '../store'
import { memoryApi } from '../api'
import { CATEGORY_META, TIER_META, type MemoryCategory, type MemoryTier } from '../types'

type ClearScope =
  | 'all'
  | 'by_category'
  | 'by_tier'
  | 'by_date_range'
  | 'by_keyword'
  | 'forgotten_only'
  | 'expired_only'

interface ClearConfig {
  scope: ClearScope
  category?: MemoryCategory
  tier?: MemoryTier
  startDate?: string
  endDate?: string
  keyword?: string
  confirmText: string
}

const SCOPE_OPTIONS: Array<{ value: ClearScope; label: string; description: string; danger: boolean }> = [
  { value: 'forgotten_only', label: '仅清除已遗忘记忆', description: '清除所有标记为已遗忘的记忆', danger: false },
  { value: 'expired_only', label: '清除过期记忆', description: '清除所有已过期的记忆', danger: false },
  { value: 'by_category', label: '按分类清除', description: '清除指定分类的所有记忆', danger: true },
  { value: 'by_tier', label: '按层级清除', description: '清除指定层级的所有记忆', danger: true },
  { value: 'by_date_range', label: '按时间范围清除', description: '清除指定时间段内的记忆', danger: true },
  { value: 'by_keyword', label: '按关键词清除', description: '清除包含指定关键词的记忆', danger: true },
  { value: 'all', label: '清除所有记忆', description: '清除全部记忆数据，不可恢复！', danger: true },
]

export function MemoryPrivacyClear() {
  const { total, fetchMemories, fetchOverview } = useMemoryStore()
  const [config, setConfig] = useState<ClearConfig>({
    scope: 'forgotten_only',
    confirmText: '',
  })
  const [previewing, setPreviewing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [result, setResult] = useState<{ success: boolean; count: number; message: string } | null>(null)

  // 预览将被清除的记忆数量
  const handlePreview = useCallback(async () => {
    setPreviewing(true)
    setPreviewCount(null)
    try {
      // 根据范围查询匹配数量
      const filter: Record<string, unknown> = { limit: 1 }
      if (config.scope === 'by_category' && config.category) {
        filter.category = config.category
      } else if (config.scope === 'by_tier' && config.tier) {
        filter.tier = config.tier
      } else if (config.scope === 'by_keyword' && config.keyword) {
        filter.keyword = config.keyword
      } else if (config.scope === 'by_date_range') {
        if (config.startDate) filter.startDate = config.startDate
        if (config.endDate) filter.endDate = config.endDate
      } else if (config.scope === 'forgotten_only') {
        filter.isForgotten = true
      } else if (config.scope === 'expired_only') {
        filter.isExpired = true
      }

      const res = await memoryApi.query.list(filter)
      setPreviewCount(res.total ?? 0)
    } catch (err) {
      console.error('预览失败', err)
      setPreviewCount(0)
    } finally {
      setPreviewing(false)
    }
  }, [config])

  // 执行清除
  const handleClear = useCallback(async () => {
    setClearing(true)
    setShowConfirm(false)
    try {
      let clearedCount = 0

      if (config.scope === 'forgotten_only') {
        // 通过遗忘引擎清理
        await memoryApi.forgetting.cleanupExpired()
        clearedCount = previewCount ?? 0
      } else if (config.scope === 'expired_only') {
        await memoryApi.forgetting.cleanupExpired()
        clearedCount = previewCount ?? 0
      } else {
        // 其他范围：先查询所有匹配的记忆 ID，再批量删除
        const filter: Record<string, unknown> = { limit: 1000 }
        if (config.scope === 'by_category' && config.category) {
          filter.category = config.category
        } else if (config.scope === 'by_tier' && config.tier) {
          filter.tier = config.tier
        } else if (config.scope === 'by_keyword' && config.keyword) {
          filter.keyword = config.keyword
        } else if (config.scope === 'by_date_range') {
          if (config.startDate) filter.startDate = config.startDate
          if (config.endDate) filter.endDate = config.endDate
        }

        const res = await memoryApi.query.list(filter)
        const ids = (res.items ?? []).map((m: { id: string }) => m.id)

        // 批量删除
        for (const id of ids) {
          try {
            await memoryApi.query.delete(id)
            clearedCount++
          } catch (err) {
            console.error(`删除记忆 ${id} 失败`, err)
          }
        }
      }

      setResult({
        success: true,
        count: clearedCount,
        message: `成功清除 ${clearedCount} 条记忆`,
      })

      // 刷新数据
      fetchMemories(true)
      fetchOverview()
    } catch (err) {
      setResult({
        success: false,
        count: 0,
        message: `清除失败: ${err instanceof Error ? err.message : '未知错误'}`,
      })
    } finally {
      setClearing(false)
    }
  }, [config, previewCount, fetchMemories, fetchOverview])

  const currentScope = SCOPE_OPTIONS.find((s) => s.value === config.scope)
  const requiresConfirm = currentScope?.danger ?? false
  const confirmMatched = !requiresConfirm || config.confirmText === '确认清除'

  return (
    <div className="flex flex-col h-full overflow-y-auto no-scrollbar p-4 space-y-4">
      {/* 头部 */}
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">隐私清除</h3>
      </div>

      {/* 警告提示 */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700 dark:text-amber-400">
          <div className="font-medium mb-1">注意</div>
          <div>清除操作不可恢复。建议先预览影响范围，确认后再执行清除。</div>
        </div>
      </div>

      {/* 清除范围选择 */}
      <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
        <h4 className="text-sm font-medium text-text-primary mb-3">选择清除范围</h4>
        <div className="space-y-2">
          {SCOPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                config.scope === option.value
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-border/30 hover:bg-surface-hover/30'
              }`}
            >
              <input
                type="radio"
                name="scope"
                value={option.value}
                checked={config.scope === option.value}
                onChange={(e) => setConfig((c) => ({ ...c, scope: e.target.value as ClearScope }))}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-primary">{option.label}</span>
                  {option.danger && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                      危险
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">{option.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 条件配置 */}
      {config.scope === 'by_category' && (
        <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
          <h4 className="text-sm font-medium text-text-primary mb-3">选择分类</h4>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(CATEGORY_META)
              .filter(([key]) => key !== 'UNCATEGORIZED')
              .map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => setConfig((c) => ({ ...c, category: key as MemoryCategory }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                    config.category === key
                      ? 'border-accent/40 bg-accent/5 text-accent'
                      : 'border-border/30 text-text-secondary hover:bg-surface-hover/30'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </button>
              ))}
          </div>
        </div>
      )}

      {config.scope === 'by_tier' && (
        <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
          <h4 className="text-sm font-medium text-text-primary mb-3">选择层级</h4>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TIER_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setConfig((c) => ({ ...c, tier: key as MemoryTier }))}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  config.tier === key
                    ? 'border-accent/40 bg-accent/5 text-accent'
                    : 'border-border/30 text-text-secondary hover:bg-surface-hover/30'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {config.scope === 'by_date_range' && (
        <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
          <h4 className="text-sm font-medium text-text-primary mb-3">时间范围</h4>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={config.startDate ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, startDate: e.target.value }))}
              className="flex-1 px-2 py-1.5 text-xs bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <span className="text-text-muted">至</span>
            <input
              type="date"
              value={config.endDate ?? ''}
              onChange={(e) => setConfig((c) => ({ ...c, endDate: e.target.value }))}
              className="flex-1 px-2 py-1.5 text-xs bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
        </div>
      )}

      {config.scope === 'by_keyword' && (
        <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
          <h4 className="text-sm font-medium text-text-primary mb-3">关键词</h4>
          <input
            type="text"
            value={config.keyword ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, keyword: e.target.value }))}
            placeholder="输入要清除的记忆包含的关键词"
            className="w-full px-3 py-2 text-xs bg-surface border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        </div>
      )}

      {/* 预览 */}
      <div className="rounded-lg border border-border/30 bg-surface/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-text-primary">影响预览</h4>
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            {previewing ? '预览中...' : '预览影响'}
          </button>
        </div>
        {previewCount !== null ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-hover/30">
            <EyeOff className="w-4 h-4 text-amber-500" />
            <div className="text-xs">
              <span className="text-text-muted">将清除 </span>
              <span className="font-mono font-medium text-amber-500">{previewCount}</span>
              <span className="text-text-muted"> 条记忆（共 {total} 条）</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-text-muted text-center py-3">
            点击"预览影响"查看将被清除的记忆数量
          </div>
        )}
      </div>

      {/* 危险确认 */}
      {requiresConfirm && previewCount !== null && previewCount > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <h4 className="text-sm font-medium text-red-500 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            危险操作确认
          </h4>
          <p className="text-xs text-text-muted mb-2">
            此操作将永久清除 {previewCount} 条记忆，不可恢复。请输入"确认清除"以继续。
          </p>
          <input
            type="text"
            value={config.confirmText}
            onChange={(e) => setConfig((c) => ({ ...c, confirmText: e.target.value }))}
            placeholder="确认清除"
            className="w-full px-3 py-1.5 text-xs bg-surface border border-red-500/30 rounded focus:outline-none focus:ring-1 focus:ring-red-500/40"
          />
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowConfirm(true)}
          disabled={
            clearing ||
            previewCount === null ||
            previewCount === 0 ||
            (requiresConfirm && !confirmMatched)
          }
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            clearing || previewCount === null || previewCount === 0 || (requiresConfirm && !confirmMatched)
              ? 'bg-surface-hover text-text-muted cursor-not-allowed'
              : 'bg-red-500 text-white hover:bg-red-600'
          }`}
        >
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {clearing ? '清除中...' : `清除 ${previewCount ?? 0} 条记忆`}
        </button>
      </div>

      {/* 确认对话框 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowConfirm(false)}>
          <div
            className="mx-4 w-full max-w-sm rounded-xl bg-surface border border-border/40 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h3 className="text-base font-semibold text-text-primary">最终确认</h3>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              确定要清除 {previewCount} 条记忆吗？此操作不可恢复。
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClear}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
              >
                确认清除
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 结果提示 */}
      {result && (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border ${
            result.success
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className={`text-xs font-medium ${result.success ? 'text-green-500' : 'text-red-500'}`}>
              {result.message}
            </div>
            <button
              onClick={() => setResult(null)}
              className="text-[10px] text-text-muted hover:text-text-primary mt-1"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
