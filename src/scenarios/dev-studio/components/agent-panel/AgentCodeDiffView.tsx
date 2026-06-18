/**
 * AgentCodeDiffView - 代码差异对比视图
 *
 * 展示代码审查中的变更差异，支持行内高亮。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { GitCompare, Copy, Check } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { AgentSessionState } from '../../services/AgentSessionService'

interface DiffHunk {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLine?: number
  newLine?: number
}

interface DiffFile {
  id: string
  path: string
  lang: string
  hunks: DiffHunk[]
  added: number
  removed: number
}

interface AgentCodeDiffViewProps {
  session?: AgentSessionState | null
  /** 外部传入的差异文件列表 */
  files?: DiffFile[]
  /** 当前选中的文件索引 */
  activeFile?: string
  onFileSelect?: (fileId: string) => void
}

// 模拟差异数据
const MOCK_DIFFS: DiffFile[] = [
  {
    id: 'diff-1',
    path: 'src/components/Header.tsx',
    lang: 'tsx',
    added: 12,
    removed: 3,
    hunks: [
      { type: 'context', content: 'import { useState } from \'react\'', oldLine: 1, newLine: 1 },
      { type: 'context', content: 'import { Button } from \'@/components/ui/button\'', oldLine: 2, newLine: 2 },
      { type: 'add', content: 'import { useAuth } from \'@/hooks/useAuth\'', newLine: 3 },
      { type: 'context', content: '', oldLine: 3, newLine: 4 },
      { type: 'context', content: 'export default function Header() {', oldLine: 4, newLine: 5 },
      { type: 'remove', content: '-  const [menuOpen, setMenuOpen] = useState(false)', oldLine: 5 },
      { type: 'add', content: '+  const { user, logout } = useAuth()', newLine: 6 },
      { type: 'add', content: '+  const [menuOpen, setMenuOpen] = useState(false)', newLine: 7 },
      { type: 'context', content: '', oldLine: 6, newLine: 8 },
      { type: 'context', content: '  return (', oldLine: 7, newLine: 9 },
    ],
  },
  {
    id: 'diff-2',
    path: 'src/utils/format.ts',
    lang: 'ts',
    added: 5,
    removed: 1,
    hunks: [
      { type: 'remove', content: '-export const formatDate = (d: Date) => d.toISOString()', oldLine: 12 },
      { type: 'add', content: '+export const formatDate = (d: Date): string => {', newLine: 12 },
      { type: 'add', content: '+  return d.toLocaleDateString(\'en-US\', {', newLine: 13 },
      { type: 'add', content: '+    year: \'numeric\', month: \'short\', day: \'numeric\'', newLine: 14 },
      { type: 'add', content: '+  })', newLine: 15 },
      { type: 'add', content: '+}', newLine: 16 },
    ],
  },
]

const AgentCodeDiffView: React.FC<AgentCodeDiffViewProps> = ({
  session: _session,
  files = MOCK_DIFFS,
  activeFile: _activeFile,
  onFileSelect: _onFileSelect,
}) => {
  const { t } = useI18n()
  const [selectedFile, setSelectedFile] = useState<string>(files[0]?.id ?? '')
  const [copied, setCopied] = useState(false)

  const currentFile = files.find(f => f.id === selectedFile) ?? files[0]

  const handleCopy = useCallback(() => {
    if (!currentFile) return
    const text = currentFile.hunks.map(h => h.content).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [currentFile])

  if (!files.length) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground gap-1">
        <GitCompare className="w-6 h-6 opacity-30" />
        <p className="text-[10px]">{t('studio.agent.noDiffs')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-md border border-border overflow-hidden">
      {/* 文件选择器 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto">
          {files.map(file => (
            <button
              key={file.id}
              onClick={() => setSelectedFile(file.id)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors ${
                selectedFile === file.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{file.path.split('/').pop()}</span>
              <span className="text-emerald-500">+{file.added}</span>
              <span className="text-red-500">-{file.removed}</span>
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          title={t('studio.agent.copyDiff')}
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {/* 差异内容 */}
      {currentFile && (
        <div className="max-h-48 overflow-auto font-mono text-[11px] leading-relaxed">
          <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border/50 bg-muted/10">
            {currentFile.path}
          </div>
          {currentFile.hunks.map((hunk, i) => {
            const lineNum = hunk.oldLine ?? hunk.newLine
            return (
              <div
                key={i}
                className={`flex px-2 ${
                  hunk.type === 'add'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : hunk.type === 'remove'
                    ? 'bg-red-500/10 text-red-600'
                    : 'text-foreground/70'
                }`}
              >
                <span className="w-8 text-right pr-2 text-muted-foreground/50 select-none flex-shrink-0">
                  {lineNum ?? ''}
                </span>
                <span className="flex-1 whitespace-pre">{hunk.content}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AgentCodeDiffView