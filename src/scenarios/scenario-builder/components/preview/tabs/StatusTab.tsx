/**
 * 状态 Tab（StatusTab）
 *
 * 展示预览运行状态、场景信息、文件监听状态与操作日志。
 * 这是预览面板默认的 Tab，保留原有 PreviewPanel 的状态可视化能力。
 *
 * 数据来源：
 *   - PreviewState（来自 PreviewService.subscribe）
 *   - WatchState（来自 FileWatcherService.onStateChange）
 *   - 本地操作日志（由 PreviewPanel 主组件通过 props 传入）
 *
 * 设计要点：
 *   - 字体 ≥ 12px
 *   - 状态徽章用颜色区分：运行绿、停止灰、错误红、启动黄
 *   - 操作日志使用等宽字体，最新条目在顶部
 */
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import type { PreviewState, WatchState } from '../../../services'
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'

// ==========================================
// 类型
// ==========================================

export type OpStatus = 'idle' | 'starting' | 'running' | 'error'

export interface OperationLogEntry {
  /** 时间戳字符串（来自 new Date().toLocaleTimeString()） */
  ts: string
  /** 日志类型 */
  type: 'start' | 'stop' | 'restart' | 'fileChange' | 'error'
  /** 日志消息 */
  message: string
}

interface StatusTabProps {
  /** 预览状态 */
  previewState: PreviewState
  /** 文件监听状态 */
  watchState: WatchState
  /** 派生的操作状态 */
  opStatus: OpStatus
  /** 运行时长文本（已格式化） */
  durationText: string
  /** 操作日志 */
  logs: OperationLogEntry[]
  /** 清空操作日志 */
  onClearLogs: () => void
}

// ==========================================
// 状态徽章样式
// ==========================================

const statusBadgeClass: Record<OpStatus, string> = {
  idle: 'bg-gray-500/10 text-gray-500',
  starting: 'bg-yellow-500/10 text-yellow-600',
  running: 'bg-emerald-500/10 text-emerald-600',
  error: 'bg-destructive/10 text-destructive',
}

// ==========================================
// 主组件
// ==========================================

const StatusTab: React.FC<StatusTabProps> = ({
  previewState,
  watchState,
  opStatus,
  durationText,
  logs,
  onClearLogs,
}) => {
  const { t } = useI18n()

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {/* 状态徽章 */}
        <div className="border-b border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {t('builder.preview.status.idle')}
            </span>
            <span
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[12px] font-medium ${statusBadgeClass[opStatus]}`}
            >
              {opStatus === 'running' ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : opStatus === 'error' ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-current opacity-60" />
              )}
              {t(
                `builder.preview.status.${opStatus === 'starting' ? 'starting' : opStatus}`,
              )}
            </span>
          </div>
        </div>

        {/* 预览信息 */}
        <div className="border-b border-border/60 px-3 py-2.5">
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('builder.preview.scenarioId')}</span>
              <span className="truncate font-mono text-foreground">
                {previewState.scenarioId ?? '-'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('builder.preview.startedAt')}</span>
              <span className="truncate text-foreground">
                {previewState.startedAt
                  ? new Date(previewState.startedAt).toLocaleString()
                  : '-'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t('builder.preview.duration')}</span>
              <span className="font-mono text-foreground">{durationText}</span>
            </div>
            {previewState.lastError && (
              <div className="flex flex-col gap-1 pt-1">
                <span className="text-destructive">{t('builder.preview.lastError')}</span>
                <span className="truncate rounded bg-destructive/5 px-1.5 py-0.5 text-[12px] text-destructive">
                  {previewState.lastError}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 文件监听状态 */}
        <div className="border-b border-border/60 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {t('builder.preview.fileWatcher')}
            </span>
            <span
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[12px] ${
                watchState.watching
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {watchState.watching ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              )}
              {watchState.watching
                ? t('builder.preview.watcher.on')
                : t('builder.preview.watcher.off')}
            </span>
          </div>
          {watchState.lastChangedFile && (
            <div className="mt-1.5 flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">{t('builder.preview.lastChangedFile')}</span>
              <span className="truncate font-mono text-foreground/80">
                {watchState.lastChangedFile}
              </span>
            </div>
          )}
        </div>

        {/* 操作日志 */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
            <span className="text-[12px] font-medium">{t('builder.preview.log')}</span>
            <button
              onClick={onClearLogs}
              disabled={logs.length === 0}
              className="flex items-center gap-1 rounded text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              {t('builder.preview.clearLog')}
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto p-2">
            {logs.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-muted-foreground/60">-</p>
            ) : (
              <ul className="space-y-0.5 font-mono text-[12px]">
                {logs
                  .slice()
                  .reverse()
                  .map((entry, idx) => (
                    <li
                      key={`${idx}-${entry.ts}`}
                      className={`flex items-start gap-1.5 px-1 py-0.5 ${
                        entry.type === 'error'
                          ? 'text-destructive'
                          : entry.type === 'restart' || entry.type === 'fileChange'
                            ? 'text-accent'
                            : 'text-foreground/80'
                      }`}
                    >
                      <span className="shrink-0 text-muted-foreground/60">[{entry.ts}]</span>
                      <span className="truncate">{entry.message}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default StatusTab
