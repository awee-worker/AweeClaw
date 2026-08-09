/**
 * TaskResultCard — 任务执行结果卡片
 *
 * AI 执行任务完成后，从回复中解析出的结构化结果以卡片形式展示：
 * - 执行摘要（一段话总结）
 * - 产出文件（AI 创建/修改的文件列表，可点击预览）
 * - 验收对照（逐条对照验收标准，通过/未通过）
 * - 后续建议（改进方向/待办事项）
 *
 * 卡片底部提供操作：查看对话 / 重新执行 / 标记完成
 *
 * 设计原则：
 * - 结构化呈现，让用户一眼看到执行成果，而非翻阅长对话
 * - 验收对照让「完成」有据可依，而非主观判断
 * - 产出文件可点击预览，快速验证交付物质量
 */
import { useCallback } from 'react'
import {
  CheckCircle2, XCircle, FileText, Lightbulb,
  Package, Clock, RefreshCw, Check, MessageSquare, FileCode,
} from 'lucide-react'
import type { TaskExecutionResult } from '../taskQuality'
import type { FileItem } from '@shared/protocols'

interface TaskResultCardProps {
  /** 解析出的结构化执行结果 */
  result: TaskExecutionResult
  /** 是否中文 */
  isZh: boolean
  /** 查看对话（切回对话流视图） */
  onViewConversation: () => void
  /** 重新执行任务 */
  onRerun: () => void
  /** 标记任务完成 */
  onMarkDone: () => void
  /** 预览产出文件（点击文件路径时触发） */
  onPreviewFile?: (file: FileItem) => void
}

export function TaskResultCard({
  result,
  isZh,
  onViewConversation,
  onRerun,
  onMarkDone,
  onPreviewFile,
}: TaskResultCardProps) {
  const t = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh])

  const passedCount = result.acceptanceCheck.filter(c => c.passed).length
  const totalCount = result.acceptanceCheck.length
  const allPassed = totalCount > 0 && passedCount === totalCount

  const handleFileClick = useCallback(
    (path: string, description: string) => {
      if (!onPreviewFile) return
      const name = path.split('/').pop() || path
      const fileItem: FileItem = {
        path,
        name,
        isDirectory: false,
        size: undefined,
        lastModified: undefined,
      }
      void description // description 仅用于展示，不传递
      onPreviewFile(fileItem)
    },
    [onPreviewFile],
  )

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-2xl mx-auto p-5 space-y-4">
        {/* 完成状态头 */}
        <div className="flex items-center gap-3 pb-3 border-b border-border/30">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            allPassed ? 'bg-green-500/15' : (totalCount === 0 ? 'bg-blue-500/15' : 'bg-amber-500/15')
          }`}>
            <CheckCircle2 className={`w-5 h-5 ${
              allPassed ? 'text-green-500' : (totalCount === 0 ? 'text-blue-500' : 'text-amber-500')
            }`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-semibold text-text-primary">
              {t('执行完成', 'Execution Complete')}
            </h3>
            <div className="flex items-center gap-3 text-[12px] text-text-muted mt-0.5">
              {result.durationSec != null && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {result.durationSec < 60
                    ? `${result.durationSec}${t('秒', 's')}`
                    : `${Math.floor(result.durationSec / 60)}${t('分', 'm')}${result.durationSec % 60}${t('秒', 's')}`}
                </span>
              )}
              {totalCount > 0 && (
                <span className={allPassed ? 'text-green-500' : 'text-amber-500'}>
                  {t('验收', 'Acceptance')} {passedCount}/{totalCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 执行摘要 */}
        {result.summary && (
          <section>
            <h4 className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary mb-2">
              <FileText className="w-3.5 h-3.5" />
              {t('执行摘要', 'Summary')}
            </h4>
            <p className="text-[13px] text-text-primary leading-relaxed bg-surface/40 rounded-lg p-3">
              {result.summary}
            </p>
          </section>
        )}

        {/* 产出文件 */}
        {result.deliverables.length > 0 && (
          <section>
            <h4 className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary mb-2">
              <Package className="w-3.5 h-3.5" />
              {t('产出文件', 'Deliverables')}
              <span className="text-text-muted">({result.deliverables.length})</span>
            </h4>
            <div className="space-y-1">
              {result.deliverables.map((d, i) => (
                <div
                  key={i}
                  onClick={() => handleFileClick(d.path, d.description)}
                  className={`flex items-start gap-2 px-3 py-2 rounded-lg bg-surface/40 transition-colors ${
                    onPreviewFile ? 'cursor-pointer hover:bg-surface-hover/50' : ''
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <code className="text-[12px] text-accent break-all">{d.path}</code>
                    {d.description && (
                      <p className="text-[12px] text-text-muted mt-0.5">{d.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 验收对照 */}
        {result.acceptanceCheck.length > 0 && (
          <section>
            <h4 className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary mb-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('验收对照', 'Acceptance Check')}
              <span className={allPassed ? 'text-green-500' : 'text-amber-500'}>
                {passedCount}/{totalCount}
              </span>
            </h4>
            <div className="space-y-1">
              {result.acceptanceCheck.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface/40"
                >
                  {c.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] ${c.passed ? 'text-text-primary' : 'text-text-primary'}`}>
                      {c.criteria}
                    </p>
                    {c.note && (
                      <p className={`text-[12px] mt-0.5 ${c.passed ? 'text-text-muted' : 'text-amber-500'}`}>
                        {c.note}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 后续建议 */}
        {result.followUp && result.followUp !== '无' && result.followUp !== 'None' && (
          <section>
            <h4 className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary mb-2">
              <Lightbulb className="w-3.5 h-3.5" />
              {t('后续建议', 'Follow-up')}
            </h4>
            <p className="text-[13px] text-text-primary leading-relaxed bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              {result.followUp}
            </p>
          </section>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 pt-3 border-t border-border/30">
          <button
            onClick={onViewConversation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {t('查看对话', 'View Conversation')}
          </button>
          <button
            onClick={onRerun}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-secondary rounded-lg hover:bg-surface-hover/50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('重新执行', 'Rerun')}
          </button>
          <button
            onClick={onMarkDone}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-green-500/15 text-green-500 rounded-lg hover:bg-green-500/25 transition-colors ml-auto"
          >
            <Check className="w-3.5 h-3.5" />
            {t('标记完成', 'Mark Done')}
          </button>
        </div>
      </div>
    </div>
  )
}
