import type React from 'react'

interface StudioToolbarProps {
  projectName?: string
  serverRunning?: boolean
  onRun?: () => void
  onBuild?: () => void
  onStop?: () => void
  onPreview?: () => void
  onDeploy?: () => void
  onNewProject?: () => void
}

const StudioToolbar: React.FC<StudioToolbarProps> = ({
  projectName,
  serverRunning = false,
  onRun,
  onBuild,
  onStop,
  onPreview,
  onDeploy,
  onNewProject,
}) => {
  return (
    <div className="flex items-center h-10 px-3 bg-muted/50 border-b border-border gap-1.5">
      {/* 项目名称 */}
      {projectName && (
        <div className="flex items-center gap-1.5 mr-3">
          <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-xs font-medium truncate max-w-[120px]">{projectName}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* 操作按钮 */}
      <div className="flex items-center gap-1">
        {onNewProject && (
          <ToolbarButton onClick={onNewProject} title="New Project">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </ToolbarButton>
        )}

        <div className="w-px h-4 bg-border mx-1" />

        {!serverRunning ? (
          <ToolbarButton onClick={onRun} title="Run" className="text-emerald-500 hover:bg-emerald-500/10">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </ToolbarButton>
        ) : (
          <ToolbarButton onClick={onStop} title="Stop" className="text-red-500 hover:bg-red-500/10">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </ToolbarButton>
        )}

        <ToolbarButton onClick={onBuild} title="Build">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </ToolbarButton>

        <ToolbarButton onClick={onPreview} title="Preview">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton onClick={onDeploy} title="Deploy" className="text-sky-500 hover:bg-sky-500/10">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </ToolbarButton>
      </div>
    </div>
  )
}

export default StudioToolbar

function ToolbarButton({
  onClick,
  title,
  children,
  className = '',
}: {
  onClick?: () => void
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
      disabled={!onClick}
    >
      {children}
    </button>
  )
}