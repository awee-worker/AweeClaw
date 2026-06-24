/**
 * Git 冲突解决组件
 *
 * 设计理念：
 * - 关注点分离：冲突解析逻辑在 conflictParser.ts
 * - 三方合并视图：支持 ours/theirs/base 三栏对比
 * - 手动编辑：支持手动编辑解决冲突
 * - 键盘导航：支持快捷键导航冲突
 * - 状态管理：清晰的解决状态跟踪
 * - 可访问性：ARIA 标签
 */

import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  GitMerge,
  Check,
  X,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Edit3,
  Eye,
} from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { gitService } from '@services/gitAdapter'
import { toast } from '@components/foundation/NotificationProvider'
import { ActionButton } from '@components/ui'
import { getFileName } from '@shared/toolkit/pathHelper'
import {
  parseConflicts,
  extractConflictContent,
  resolveConflict,
  getConflictStats,
  type ConflictMarker,
  type ResolutionStrategy,
} from './conflictParser'

interface ConflictResolverProps {
  filePath: string
  onResolved: () => void
  onCancel: () => void
}

/** 视图模式 */
type ViewMode = 'split' | 'manual'

export function ConflictResolver({
  filePath,
  onResolved,
  onCancel,
}: ConflictResolverProps) {
  const language = useStore((s) => s.language)
  const [content, setContent] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictMarker[]>([])
  const [currentConflict, setCurrentConflict] = useState(0)
  const [resolvedContent, setResolvedContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [manualContent, setManualContent] = useState<string>('')

  const tt = useCallback((key: string) => t(key, language), [language])

  // 加载文件内容
  useEffect(() => {
    const loadFile = async () => {
      setIsLoading(true)
      try {
        const fileContent = await api.file.read(filePath)
        if (fileContent) {
          setContent(fileContent)
          setResolvedContent(fileContent)
          const parsed = parseConflicts(fileContent)
          setConflicts(parsed)
          if (parsed.length > 0) {
            const { ours, theirs } = extractConflictContent(fileContent, parsed[0])
            setManualContent(`${ours}\n${theirs}`)
          }
        }
      } catch {
        toast.error('Failed to load file')
      } finally {
        setIsLoading(false)
      }
    }
    void loadFile()
  }, [filePath])

  // 冲突统计
  const stats = useMemo(() => getConflictStats(conflicts), [conflicts])

  // 当前冲突内容
  const currentContent = useMemo(() => {
    const marker = conflicts[currentConflict]
    if (!marker) return null
    return extractConflictContent(content, marker)
  }, [content, conflicts, currentConflict])

  /**
   * 应用解决策略
   */
  const applyResolution = useCallback(
    (strategy: ResolutionStrategy) => {
      if (conflicts.length === 0) return

      const marker = conflicts[currentConflict]
      const newContent = resolveConflict(
        resolvedContent,
        marker,
        strategy,
        manualContent,
      )

      setResolvedContent(newContent)

      // 重新解析冲突
      const newConflicts = parseConflicts(newContent)
      setConflicts(newConflicts)

      // 调整当前冲突索引
      if (currentConflict >= newConflicts.length && newConflicts.length > 0) {
        setCurrentConflict(newConflicts.length - 1)
      }
    },
    [conflicts, currentConflict, resolvedContent, manualContent],
  )

  const acceptOurs = useCallback(() => applyResolution('ours'), [applyResolution])
  const acceptTheirs = useCallback(() => applyResolution('theirs'), [applyResolution])
  const acceptBoth = useCallback(() => applyResolution('both'), [applyResolution])
  const acceptManual = useCallback(() => applyResolution('manual'), [applyResolution])

  // 保存并标记为已解决
  const saveAndResolve = useCallback(async () => {
    if (conflicts.length > 0) {
      toast.warning(tt('git.unresolvedConflicts'))
      return
    }

    try {
      await api.file.write(filePath, resolvedContent)
      await gitService.stageFile(filePath)
      toast.success(tt('git.conflictResolved'))
      onResolved()
    } catch {
      toast.error('Failed to save file')
    }
  }, [conflicts, filePath, resolvedContent, tt, onResolved])

  // 切换冲突时更新手动编辑内容
  useEffect(() => {
    if (currentContent && viewMode === 'manual') {
      setManualContent(`${currentContent.ours}\n${currentContent.theirs}`)
    }
  }, [currentContent, viewMode])

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && currentConflict > 0) {
        e.preventDefault()
        setCurrentConflict((c) => Math.max(0, c - 1))
      } else if (
        e.key === 'ArrowRight' &&
        currentConflict < conflicts.length - 1
      ) {
        e.preventDefault()
        setCurrentConflict((c) => Math.min(conflicts.length - 1, c + 1))
      }
    },
    [currentConflict, conflicts.length],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" role="status">
        <RefreshCw className="w-6 h-6 animate-spin text-accent" aria-hidden />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full bg-background"
      role="dialog"
      aria-label="冲突解决器"
      onKeyDown={handleKeyDown}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-accent" aria-hidden />
          <span className="text-sm font-medium">{tt('git.resolveConflicts')}</span>
          <span className="text-xs text-text-muted">{getFileName(filePath)}</span>
        </div>
        <div className="flex items-center gap-2">
          {conflicts.length > 0 && (
            <span className="text-xs text-status-warning">
              {conflicts.length} {tt('git.conflictsRemaining')}
            </span>
          )}
          <ActionButton variant="ghost" size="sm" onClick={onCancel} aria-label="关闭">
            <X className="w-4 h-4" aria-hidden />
          </ActionButton>
        </div>
      </div>

      {/* 冲突导航和操作 */}
      {conflicts.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface/50">
          <div className="flex items-center gap-2">
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={currentConflict === 0}
              onClick={() => setCurrentConflict((c) => Math.max(0, c - 1))}
              aria-label="上一个冲突"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden />
            </ActionButton>
            <span className="text-xs">
              {currentConflict + 1} / {conflicts.length}
            </span>
            <ActionButton
              variant="ghost"
              size="sm"
              disabled={currentConflict >= conflicts.length - 1}
              onClick={() =>
                setCurrentConflict((c) => Math.min(conflicts.length - 1, c + 1))
              }
              aria-label="下一个冲突"
            >
              <ArrowRight className="w-4 h-4" aria-hidden />
            </ActionButton>
          </div>

          <div className="flex items-center gap-2">
            {/* 视图模式切换 */}
            <ActionButton
              variant={viewMode === 'split' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('split')}
              aria-label="分栏视图"
            >
              <Eye className="w-4 h-4" aria-hidden />
            </ActionButton>
            <ActionButton
              variant={viewMode === 'manual' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('manual')}
              aria-label="手动编辑"
            >
              <Edit3 className="w-4 h-4" aria-hidden />
            </ActionButton>

            <div className="w-px h-6 bg-border-subtle mx-1" />

            <ActionButton variant="secondary" size="sm" onClick={acceptOurs}>
              {tt('git.acceptOurs')}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={acceptTheirs}>
              {tt('git.acceptTheirs')}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={acceptBoth}>
              {tt('git.acceptBoth')}
            </ActionButton>
            {viewMode === 'manual' && (
              <ActionButton variant="primary" size="sm" onClick={acceptManual}>
                {tt('git.applyManual')}
              </ActionButton>
            )}
          </div>
        </div>
      )}

      {/* 冲突内容 */}
      <div className="flex-1 overflow-auto p-4">
        {currentContent ? (
          viewMode === 'split' ? (
            <div
              className={`grid gap-4 h-full ${stats.hasBase ? 'grid-cols-3' : 'grid-cols-2'}`}
            >
              {/* Base（diff3 格式） */}
              {stats.hasBase && currentContent.base !== undefined && (
                <div className="flex flex-col border border-border-subtle rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-yellow-500/10 border-b border-border-subtle">
                    <span className="text-xs font-medium text-yellow-400">
                      Base（原始版本）
                    </span>
                  </div>
                  <pre className="flex-1 p-3 text-xs font-mono overflow-auto bg-surface/30">
                    {currentContent.base}
                  </pre>
                </div>
              )}

              {/* Ours */}
              <div className="flex flex-col border border-border-subtle rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-green-500/10 border-b border-border-subtle">
                  <span className="text-xs font-medium text-green-400">
                    {tt('git.currentChanges')} (Ours)
                  </span>
                </div>
                <pre className="flex-1 p-3 text-xs font-mono overflow-auto bg-surface/30">
                  {currentContent.ours}
                </pre>
              </div>

              {/* Theirs */}
              <div className="flex flex-col border border-border-subtle rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-blue-500/10 border-b border-border-subtle">
                  <span className="text-xs font-medium text-blue-400">
                    {tt('git.incomingChanges')} (Theirs)
                  </span>
                </div>
                <pre className="flex-1 p-3 text-xs font-mono overflow-auto bg-surface/30">
                  {currentContent.theirs}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full border border-border-subtle rounded-lg overflow-hidden">
              <div className="px-3 py-1.5 bg-accent/10 border-b border-border-subtle">
                <span className="text-xs font-medium text-accent">
                  手动编辑解决
                </span>
              </div>
              <textarea
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                className="flex-1 p-3 text-xs font-mono bg-surface/30 resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                spellCheck={false}
                aria-label="手动编辑冲突内容"
              />
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Check className="w-12 h-12 text-green-400 mb-4" aria-hidden />
            <p className="text-sm">{tt('git.allConflictsResolved')}</p>
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-surface">
        <ActionButton variant="ghost" onClick={onCancel}>
          {tt('cancel')}
        </ActionButton>
        <ActionButton
          variant="primary"
          disabled={conflicts.length > 0}
          onClick={saveAndResolve}
        >
          <Check className="w-4 h-4 mr-1" aria-hidden />
          {tt('git.markResolved')}
        </ActionButton>
      </div>
    </div>
  )
}

export default ConflictResolver
