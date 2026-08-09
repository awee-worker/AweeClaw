/**
 * 待确认文件变更栏（统一接受/拒绝）
 *
 * 在底部消息输入框上方显示，像 VSCode/Trae 一样：
 * - 有待确认变更时显示此栏
 * - 可展开/折叠查看文件列表
 * - 支持全部接受 / 全部拒绝 / 单个接受 / 单个拒绝
 *
 * 数据来源：useAgentStore.pendingChanges
 * 操作：acceptChange / undoChange / acceptAllChanges / undoAllChanges
 */
import { useState, useMemo, memo } from 'react'
import { Check, X, ChevronDown, ChevronUp, FileCode, FilePlus } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { PendingChange } from '@intelligence/providerTypes'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { composerService } from '@intelligence/runtime/composerEngine'
import { useStore } from '@store'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { getFileName } from '@shared/toolkit/pathHelper'

interface PendingChangesBarProps {
  pendingChanges: PendingChange[]
}

function PendingChangesBarBase({ pendingChanges }: PendingChangesBarProps) {
  const language = useStore(s => s.language)
  const [isExpanded, setIsExpanded] = useState(false)

  // 直接从 agent store 读取操作方法
  const acceptChange = useAgentStore(s => s.acceptChange)
  const undoChange = useAgentStore(s => s.undoChange)
  const acceptAllChanges = useAgentStore(s => s.acceptAllChanges)
  const undoAllChanges = useAgentStore(s => s.undoAllChanges)

  const isZh = language === 'zh'

  // 统计信息
  const stats = useMemo(() => {
    let linesAdded = 0
    let linesRemoved = 0
    let createCount = 0
    let modifyCount = 0
    for (const c of pendingChanges) {
      linesAdded += c.linesAdded || 0
      linesRemoved += c.linesRemoved || 0
      if (c.changeType === 'create') createCount++
      else modifyCount++
    }
    return { linesAdded, linesRemoved, createCount, modifyCount, total: pendingChanges.length }
  }, [pendingChanges])

  // 无待确认变更时不渲染
  if (pendingChanges.length === 0) return null

  /** 全部接受 */
  const handleAcceptAll = async () => {
    acceptAllChanges()
    // 同步清除编辑器的 diff 状态（写入文件 + 移除编辑器 diff 标记）
    await composerService.acceptAll()
    toast.success(isZh ? `已接受全部 ${stats.total} 个变更` : `Accepted ${stats.total} changes`)
  }

  /** 全部拒绝（撤销）— 加二次确认，防止误点 */
  const handleRejectAll = async () => {
    // 二次确认：防止用户误点「全部拒绝」导致 AI 生成的代码被全部撤销
    const confirmed = await globalConfirm({
      title: isZh ? '确认拒绝全部变更' : 'Confirm Reject All Changes',
      message: isZh
        ? `即将撤销全部 ${stats.total} 个文件的变更（恢复为原始内容），此操作不可恢复。确认拒绝吗？`
        : `This will revert all ${stats.total} file(s) to their original content. This action cannot be undone. Are you sure?`,
      confirmText: isZh ? '确认拒绝' : 'Confirm Reject',
      cancelText: isZh ? '取消' : 'Cancel',
      variant: 'danger',
    })
    if (!confirmed) return

    const result = await undoAllChanges()
    // 同步清除编辑器的 diff 状态（恢复旧内容 + 移除编辑器 diff 标记）
    await composerService.rejectAll()
    if (result.success) {
      toast.success(isZh ? `已撤销 ${result.restoredFiles.length} 个文件` : `Reverted ${result.restoredFiles.length} files`)
    } else {
      toast.error(isZh ? `部分撤销失败：${result.errors.join(', ')}` : `Failed to revert some: ${result.errors.join(', ')}`)
    }
  }

  /** 接受单个文件 */
  const handleAcceptFile = async (filePath: string) => {
    acceptChange(filePath)
    // 同步清除编辑器的 diff 状态
    await composerService.acceptChange(filePath)
    toast.success(isZh ? `已接受：${getFileName(filePath)}` : `Accepted: ${getFileName(filePath)}`)
  }

  /** 拒绝单个文件（撤销） */
  const handleRejectFile = async (filePath: string) => {
    const success = await undoChange(filePath)
    // 同步清除编辑器的 diff 状态
    await composerService.rejectChange(filePath)
    if (success) {
      toast.success(isZh ? `已撤销：${getFileName(filePath)}` : `Reverted: ${getFileName(filePath)}`)
    } else {
      toast.error(isZh ? `撤销失败：${getFileName(filePath)}` : `Failed to revert: ${getFileName(filePath)}`)
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-accent/20 bg-accent/5 overflow-hidden">
      {/* 头部：统计 + 展开按钮 + 全部接受/拒绝 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          onClick={() => setIsExpanded(v => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-accent/5 rounded-md transition-colors px-1 py-0.5"
        >
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />
          )}
          <span className="text-xs font-medium text-text-primary truncate">
            {isZh ? `${stats.total} 个文件待确认` : `${stats.total} file${stats.total > 1 ? 's' : ''} pending review`}
          </span>
          <span className="text-[11px] text-status-success shrink-0">+{stats.linesAdded}</span>
          <span className="text-[11px] text-status-error shrink-0">-{stats.linesRemoved}</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRejectAll}
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-all active:scale-95"
            title={isZh ? '拒绝全部（撤销所有变更）' : 'Reject all (revert all changes)'}
          >
            {isZh ? '全部拒绝' : 'Reject all'}
          </button>
          <button
            onClick={handleAcceptAll}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground hover:bg-accent-hover rounded-md transition-all shadow-sm shadow-accent/20 active:scale-95 hover:shadow-accent/40"
            title={isZh ? '接受全部（保留所有变更）' : 'Accept all (keep all changes)'}
          >
            {isZh ? '全部接受' : 'Accept all'}
          </button>
        </div>
      </div>

      {/* 展开的文件列表 */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-t border-accent/10 overflow-hidden"
          >
            <div className="max-h-[280px] overflow-y-auto py-1">
              {pendingChanges.map(change => {
                const isCreate = change.changeType === 'create'
                const fileName = getFileName(change.filePath)
                const dirPath = change.relativePath || change.filePath
                const dirName = dirPath.includes('/')
                  ? dirPath.slice(0, dirPath.lastIndexOf('/'))
                  : ''

                return (
                  <div
                    key={change.filePath}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-accent/5 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isCreate ? (
                        <FilePlus className="w-3.5 h-3.5 text-status-success shrink-0" />
                      ) : (
                        <FileCode className="w-3.5 h-3.5 text-accent shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-text-primary truncate">
                            {fileName}
                          </span>
                          <span className="text-[10px] text-status-success">+{change.linesAdded || 0}</span>
                          <span className="text-[10px] text-status-error">-{change.linesRemoved || 0}</span>
                        </div>
                        {dirName && (
                          <div className="text-[10px] text-text-muted truncate">{dirName}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRejectFile(change.filePath)}
                        className="p-1 text-text-muted hover:text-status-error hover:bg-status-error/10 rounded transition-colors"
                        title={isZh ? '拒绝（撤销）' : 'Reject (revert)'}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleAcceptFile(change.filePath)}
                        className="p-1 text-text-muted hover:text-status-success hover:bg-status-success/10 rounded transition-colors"
                        title={isZh ? '接受（保留）' : 'Accept (keep)'}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default memo(PendingChangesBarBase)
