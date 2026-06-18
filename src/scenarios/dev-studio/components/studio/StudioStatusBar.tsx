import type React from 'react'

interface StudioStatusBarProps {
  projectName?: string
  language?: string
  encoding?: string
  branch?: string
  lspStatus?: 'ready' | 'loading' | 'error'
  notifications?: number
}

const StudioStatusBar: React.FC<StudioStatusBarProps> = ({
  projectName,
  language = 'Plain Text',
  encoding = 'UTF-8',
  branch,
  lspStatus = 'ready',
  notifications = 0,
}) => {
  return (
    <div className="flex items-center h-6 px-2 bg-accent text-white text-[11px] select-none gap-3">
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        {projectName && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {projectName}
          </span>
        )}

        {branch && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {branch}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* 右侧 */}
      <div className="flex items-center gap-3">
        {/* LSP 状态 */}
        <span className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              lspStatus === 'ready' ? 'bg-emerald-400' : lspStatus === 'loading' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
            }`}
          />
          LSP
        </span>

        <span>{language}</span>
        <span>{encoding}</span>

        {/* 通知 */}
        {notifications > 0 && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {notifications}
          </span>
        )}
      </div>
    </div>
  )
}

export default StudioStatusBar