/**
 * Git 行级历史与还原面板
 *
 * 解决「这行代码是谁、什么时候、在哪次提交改的，我想退回去」这件事：
 *   1. 当前行归属（git blame）—— 作者 / 提交 / 时间
 *   2. 该文件的提交历史（--follow，随重命名追踪）
 *   3. 选中提交时预览该文件在该提交的内容
 *   4. 一键把文件还原到该版本（带二次确认）
 *
 * 只依赖既有 gitService（blame / getFileHistory / getFileContentAtCommit），
 * 不新增 IPC —— 面板纯前端组合既有只读能力，外加一次"写回编辑器缓冲"的回调。
 *
 * @module workspace-editor/GitLineHistoryPanel
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  GitCommitHorizontal,
  History,
  Loader2,
  RotateCcw,
  User,
  X,
} from 'lucide-react'
import { gitService, type GitCommit } from '@services/gitAdapter'
import { useStore } from '@store'
import { getFileName, toRelativePath } from '@shared/toolkit/pathHelper'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { toast } from '@components/foundation/NotificationProvider'
import type { GitLineHistoryRequest } from './gitLineHistoryBus'

/** 预览最多渲染的行数：文件很大时避免一次性挂出上万个 DOM 节点 */
const MAX_PREVIEW_LINES = 200

interface BlameLine {
  line: number
  hash: string
  author: string
  date: Date
  content: string
}

interface GitLineHistoryPanelProps {
  request: GitLineHistoryRequest
  /** 还原回调：把内容写回编辑器缓冲（落盘 / 标脏由宿主负责） */
  onRestore: (content: string) => void
  onClose: () => void
}

function formatDateTime(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function GitLineHistoryPanel({ request, onRestore, onClose }: GitLineHistoryPanelProps) {
  const language = useStore((state) => state.language)
  const zh = language === 'zh'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [blameLine, setBlameLine] = useState<BlameLine | null>(null)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const fileName = useMemo(() => getFileName(request.filePath), [request.filePath])
  const selected = useMemo(
    () => history.find((commit) => commit.hash === selectedHash) || null,
    [history, selectedHash],
  )

  // 加载 blame + 文件历史
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setBlameLine(null)
      setHistory([])
      setSelectedHash(null)
      setPreview(null)

      const workspacePath = useStore.getState().workspacePath
      if (!workspacePath) {
        setError(zh ? '未打开工作区，无法读取 Git 历史。' : 'No workspace is open.')
        setLoading(false)
        return
      }

      // git 的 pathspec 需要仓库相对路径（gitAdapter 内部不做转换）
      const relativePath = toRelativePath(request.filePath, workspacePath)

      const [blameLines, commits] = await Promise.all([
        gitService.getBlame(relativePath, workspacePath),
        gitService.getFileHistory(relativePath, 40, workspacePath),
      ])

      if (cancelled) return

      const entry = blameLines.find((item) => item.line === request.line) || null
      setBlameLine(entry)
      setHistory(commits)

      // 默认选中：当前行归属的提交（blame 只回短 hash，需两种匹配方式）；否则最新一次提交
      const owner = entry
        ? commits.find(
          (commit) =>
            commit.hash === entry.hash ||
            commit.shortHash === entry.hash ||
            commit.hash.startsWith(entry.hash),
        )
        : undefined
      setSelectedHash((owner || commits[0])?.hash || null)

      if (!entry && commits.length === 0) {
        setError(
          zh
            ? '该文件暂无 Git 历史（可能尚未提交，或文件在工作区之外）。'
            : 'No Git history for this file (not committed yet, or outside the repository).',
        )
      }

      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
    // request.at 参与依赖：同一文件同一行再次点击也应重新拉取
  }, [request.filePath, request.line, request.at, zh])

  // 选中提交 → 预览该版本内容
  useEffect(() => {
    if (!selected) {
      setPreview(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setPreviewLoading(true)
      try {
        const workspacePath = useStore.getState().workspacePath
        if (!workspacePath) {
          if (!cancelled) setPreview(null)
          return
        }
        const relativePath = toRelativePath(request.filePath, workspacePath)
        const content = await gitService.getFileContentAtCommit(relativePath, selected.hash, workspacePath)
        if (!cancelled) setPreview(content)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selected, request.filePath])

  const handleRestore = async () => {
    if (!preview || !selected) return

    const confirmed = await globalConfirm({
      title: zh ? '还原到此版本' : 'Restore this version',
      message: zh
        ? `将「${fileName}」整体替换为提交 ${selected.shortHash} 时的内容。\n当前文件中未保存的改动会丢失，且该操作会覆盖编辑器缓冲。是否继续？`
        : `Replace "${fileName}" with its content at commit ${selected.shortHash}.\nUnsaved edits in the current file will be lost. Continue?`,
      confirmText: zh ? '还原' : 'Restore',
      cancelText: zh ? '取消' : 'Cancel',
      variant: 'danger',
    })
    if (!confirmed) return

    setRestoring(true)
    try {
      onRestore(preview)
      toast.success(
        zh
          ? `已还原「${fileName}」到 ${selected.shortHash}（记得保存）`
          : `Restored "${fileName}" to ${selected.shortHash} (remember to save)`,
      )
      onClose()
    } catch (err) {
      toast.error(
        zh
          ? `还原失败：${err instanceof Error ? err.message : String(err)}`
          : `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setRestoring(false)
    }
  }

  const previewLines = useMemo(() => (preview === null ? [] : preview.split('\n')), [preview])
  const shownLines = previewLines.slice(0, MAX_PREVIEW_LINES)
  const truncated = previewLines.length > MAX_PREVIEW_LINES

  return (
    <div className="fixed right-6 top-20 z-[90] w-[460px] max-h-[72vh] flex flex-col rounded-xl border border-border-subtle bg-surface shadow-xl no-drag">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border-subtle">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-accent shrink-0" />
            <h3 className="text-sm font-semibold text-text-primary truncate">
              {zh ? '行级历史与还原' : 'Line history & restore'}
            </h3>
          </div>
          <p className="mt-1 text-[11px] text-text-muted truncate" title={request.filePath}>
            {fileName} · L{request.line}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-active/50 transition-colors shrink-0"
          title={zh ? '关闭' : 'Close'}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {zh ? '读取历史…' : 'Loading history…'}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs bg-amber-500/10 border border-amber-500/20 text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        ) : (
          <>
            {/* 1. 当前行归属 */}
            <section className="rounded-lg border border-border/50 bg-surface-active/20 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                <GitCommitHorizontal className="w-3.5 h-3.5" />
                {zh ? `第 ${request.line} 行归属` : `Line ${request.line} blame`}
              </div>
              {blameLine ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3 text-text-muted" />
                      {blameLine.author}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-text-muted" />
                      {formatDateTime(blameLine.date)}
                    </span>
                    <span className="font-mono text-[11px] text-accent">{blameLine.hash}</span>
                  </div>
                  <pre className="text-[11px] text-text-primary bg-surface/60 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all">
                    {blameLine.content || ' '}
                  </pre>
                </>
              ) : (
                <p className="text-xs text-text-muted">
                  {zh ? '该行尚无提交记录（未提交的新增行）。' : 'This line has no commit yet (uncommitted).'}
                </p>
              )}
            </section>

            {/* 2. 文件历史 */}
            <section className="space-y-1.5">
              <div className="text-[11px] font-medium text-text-muted">
                {zh ? `文件历史（${history.length}）` : `File history (${history.length})`}
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-text-muted">{zh ? '暂无提交记录' : 'No commits'}</p>
              ) : (
                <ul className="space-y-0.5">
                  {history.map((commit) => {
                    const active = commit.hash === selectedHash
                    return (
                      <li key={commit.hash}>
                        <button
                          onClick={() => setSelectedHash(commit.hash)}
                          className={`w-full text-left px-2 py-1.5 rounded-lg border transition-colors ${active
                            ? 'border-accent/40 bg-accent/10'
                            : 'border-transparent hover:bg-surface-active/40'
                            }`}
                        >
                          <div className="flex items-center gap-2 text-[11px] text-text-muted">
                            <span className="font-mono text-accent">{commit.shortHash}</span>
                            <span className="truncate">{commit.author}</span>
                            <span className="ml-auto shrink-0">{formatDateTime(commit.date)}</span>
                          </div>
                          <div className="text-xs text-text-primary truncate mt-0.5">
                            {commit.message}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* 3. 该版本内容预览 */}
            {selected && (
              <section className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    {zh ? `${selected.shortHash} 时的文件内容` : `Content at ${selected.shortHash}`}
                  </span>
                  {previewLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                </div>

                {preview === null && !previewLoading ? (
                  <p className="text-xs text-text-muted">
                    {zh ? '该提交中不存在此文件（可能当时还未创建）。' : 'File did not exist in this commit.'}
                  </p>
                ) : (
                  <div className="max-h-[240px] overflow-auto rounded-lg border border-border/50 bg-surface-active/20 py-1">
                    {shownLines.map((text, index) => (
                      <div key={index} className="flex text-[11px] leading-5">
                        <span className="w-10 shrink-0 select-none pr-2 text-right text-text-muted">
                          {index + 1}
                        </span>
                        <span className="flex-1 whitespace-pre pr-2 text-text-primary">{text || ' '}</span>
                      </div>
                    ))}
                    {truncated && (
                      <div className="px-3 py-1 text-[11px] text-text-muted">
                        {zh
                          ? `… 仅预览前 ${MAX_PREVIEW_LINES} 行（共 ${previewLines.length} 行）`
                          : `… showing first ${MAX_PREVIEW_LINES} of ${previewLines.length} lines`}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle">
        <p className="text-[11px] text-text-muted leading-relaxed">
          {zh ? '还原会覆盖编辑器缓冲，需手动保存' : 'Restore only updates the editor buffer'}
        </p>
        <button
          onClick={() => void handleRestore()}
          disabled={!preview || !selected || restoring || previewLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          {zh ? '还原到此版本' : 'Restore this version'}
        </button>
      </footer>
    </div>
  )
}

export default GitLineHistoryPanel
