/**
 * ExecutionWindowTitleBar — 执行窗口自定义标题栏
 *
 * 职责：
 * - 显示当前项目名称
 * - 提供最小化（到悬浮球）和关闭按钮
 * - 支持窗口拖拽（-webkit-app-region: drag）
 *
 * 布局：
 * ┌──────────────────────────────────────────────┐
 * │  ◉ 项目名称              [_最小化]  [✕关闭]   │
 * └──────────────────────────────────────────────┘
 *
 * 最小化按钮触发缩放动画（由主进程控制），
 * 关闭按钮直接关闭窗口。
 */

import { Minus, X, FolderGit2 } from 'lucide-react'

interface ExecutionWindowTitleBarProps {
  projectName: string
  onMinimize: () => void
  onClose: () => void
}

export function ExecutionWindowTitleBar({ projectName, onMinimize, onClose }: ExecutionWindowTitleBarProps) {
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between h-10 px-3 bg-surface/40 border-b border-border/30"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：项目名称 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <FolderGit2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-[13px] font-medium text-text-primary truncate" title={projectName}>
          {projectName || '项目执行'}
        </span>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div
        className="flex items-center gap-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onMinimize}
          className="p-1.5 rounded hover:bg-surface-hover/60 text-text-muted hover:text-text-primary transition-colors"
          title="最小化到悬浮球"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-red-500/15 text-text-muted hover:text-red-500 transition-colors"
          title="关闭窗口"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
