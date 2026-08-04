/**
 * OrganizePanel - 会议纪要整理面板（弹出层）
 *
 * 三种状态：
 * 1. 进行中：显示进度条 + 阶段文案
 * 2. 成功：显示结构化会议纪要预览 + 文件路径
 * 3. 失败：显示错误信息 + 重试提示
 *
 * 关闭按钮统一在右上角，整理完成后展示结果。
 */

import { memo } from 'react'
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileType,
  Users,
  ListChecks,
  Target,
  ClipboardList,
} from 'lucide-react'
import type { OrganizeProgress, MeetingMinutes } from '@shared/protocols/meetingNotes'

export interface OrganizePanelResult {
  minutes: MeetingMinutes | null
  error: string | null
  docxPath: string | null
}

export interface OrganizePanelProps {
  /** 整理进度（null 表示已完成或未开始） */
  progress: OrganizeProgress | null
  /** 整理结果 */
  result: OrganizePanelResult
  /** 关闭面板 */
  onClose: () => void
}

/** 阶段文案映射 */
const STAGE_LABELS: Record<string, string> = {
  analyzing: '正在分析转写内容',
  extracting: 'AI 正在提取关键信息',
  structuring: '正在构建结构化纪要',
  done: '整理完成',
  error: '整理失败',
}

function OrganizePanelImpl(props: OrganizePanelProps) {
  const { progress, result, onClose } = props
  const isOrganizing = progress !== null && progress.stage !== 'done' && progress.stage !== 'error'
  const isError = result.error !== null || progress?.stage === 'error'
  const isSuccess = result.minutes !== null

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex max-h-[88vh] w-[720px] max-w-[92vw] flex-col rounded-lg border border-border bg-background-secondary shadow-glass">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary">会议纪要整理</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isOrganizing && (
            <OrganizingView progress={progress!} />
          )}

          {isError && !isOrganizing && (
            <ErrorView message={result.error || progress?.message || '整理失败'} />
          )}

          {isSuccess && !isOrganizing && (
            <SuccessView minutes={result.minutes!} docxPath={result.docxPath} />
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-surface px-4 py-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
          >
            {isSuccess ? '完成' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// 进行中视图
// ============================================

function OrganizingView({ progress }: { progress: OrganizeProgress }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
        <Loader2 size={28} className="animate-spin text-accent" />
      </div>
      <h3 className="mb-2 text-base font-medium text-text-primary">
        {STAGE_LABELS[progress.stage] || '正在整理...'}
      </h3>
      {progress.message && (
        <p className="text-sm text-text-secondary">{progress.message}</p>
      )}
      <div className="mt-6 w-full max-w-md">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-text-muted">
          <span>{STAGE_LABELS[progress.stage] || ''}</span>
          <span>{progress.percent}%</span>
        </div>
      </div>
    </div>
  )
}

// ============================================
// 错误视图
// ============================================

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-status-error/10">
        <AlertCircle size={28} className="text-status-error" />
      </div>
      <h3 className="mb-2 text-base font-medium text-text-primary">整理失败</h3>
      <p className="max-w-md text-center text-sm text-text-secondary">{message}</p>
      <p className="mt-4 text-xs text-text-muted">
        请检查 LLM 配置后重试，或手动整理录音原文。
      </p>
    </div>
  )
}

// ============================================
// 成功视图
// ============================================

function SuccessView({ minutes, docxPath }: { minutes: MeetingMinutes; docxPath: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {/* 标题 */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{minutes.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-muted">
          <span>日期：{minutes.date}</span>
          <span>时间：{minutes.startTime} - {minutes.endTime}</span>
        </div>
      </div>

      {/* 参会人 */}
      {minutes.attendees.length > 0 && (
        <div className="flex items-start gap-2">
          <Users size={14} className="mt-0.5 flex-shrink-0 text-text-muted" />
          <div>
            <div className="mb-1 text-xs font-medium text-text-secondary">参会人</div>
            <div className="flex flex-wrap gap-1.5">
              {minutes.attendees.map((name, i) => (
                <span
                  key={i}
                  className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 摘要 */}
      {minutes.summary && (
        <div className="flex items-start gap-2">
          <ClipboardList size={14} className="mt-0.5 flex-shrink-0 text-text-muted" />
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-text-secondary">会议摘要</div>
            <p className="text-sm leading-relaxed text-text-primary">{minutes.summary}</p>
          </div>
        </div>
      )}

      {/* 议题 */}
      {minutes.topics.length > 0 && (
        <div className="flex items-start gap-2">
          <Target size={14} className="mt-0.5 flex-shrink-0 text-text-muted" />
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-text-secondary">讨论议题</div>
            <div className="flex flex-col gap-2">
              {minutes.topics.map((topic, i) => (
                <div key={i} className="rounded border border-border-subtle bg-surface/40 px-3 py-2">
                  <div className="text-sm font-medium text-text-primary">
                    {i + 1}. {topic.title}
                  </div>
                  {topic.discussion && (
                    <p className="mt-1 text-sm text-text-secondary">{topic.discussion}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 决议 */}
      {minutes.decisions.length > 0 && (
        <div className="flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-status-success" />
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-text-secondary">会议决议</div>
            <ul className="ml-4 list-disc space-y-1 text-sm text-text-primary">
              {minutes.decisions.map((decision, i) => (
                <li key={i}>{decision}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 待办事项 */}
      {minutes.actionItems.length > 0 && (
        <div className="flex items-start gap-2">
          <ListChecks size={14} className="mt-0.5 flex-shrink-0 text-accent" />
          <div className="flex-1">
            <div className="mb-1 text-xs font-medium text-text-secondary">待办事项</div>
            <div className="flex flex-col gap-1.5">
              {minutes.actionItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-text-muted">{i + 1}.</span>
                  <span className="flex-1 text-text-primary">{item.task}</span>
                  {item.assignee && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                      @{item.assignee}
                    </span>
                  )}
                  {item.deadline && (
                    <span className="text-xs text-text-muted">{item.deadline}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 文件路径 */}
      {docxPath && (
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2">
          <FileType size={14} className="flex-shrink-0 text-accent" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-text-muted">Word 文档已保存</div>
            <div className="truncate text-xs text-text-primary" title={docxPath}>
              {docxPath}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const OrganizePanel = memo(OrganizePanelImpl)
