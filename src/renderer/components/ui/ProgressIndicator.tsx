import { Loader2 } from 'lucide-react'
import { memo } from 'react'

type SpinnerScale = 'xs' | 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: SpinnerScale
  className?: string
}

const SPINNER_DIM: Record<SpinnerScale, string> = { xs: 'w-3 h-3', sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' }

export const Spinner = memo(({ size = 'sm', className = '' }: SpinnerProps) => (
  <Loader2 className={`animate-spin text-accent ${SPINNER_DIM[size]} ${className}`} />
))
Spinner.displayName = 'Spinner'

interface FullscreenLoaderProps { message?: string }

export const FullscreenLoader = memo(({ message }: FullscreenLoaderProps) => (
  <div className="h-full flex flex-col items-center justify-center gap-3 bg-background">
    <Spinner size="lg" />
    {message && <span className="text-xs text-text-muted">{message}</span>}
  </div>
))
FullscreenLoader.displayName = 'FullscreenLoader'

export const FullScreenLoading = FullscreenLoader

export const SidebarSkeleton = memo(() => (
  <div className="h-full flex flex-col bg-background border-r border-border">
    <div className="h-10 px-4 flex items-center justify-between border-b border-border">
      <div className="h-3 w-16 bg-surface-active/50 rounded animate-pulse" />
      <div className="flex items-center gap-1">
        {Array.from({ length: 3 }, (_, i) => (<div key={i} className="w-6 h-6 bg-surface-active/30 rounded animate-pulse" />))}
      </div>
    </div>
    <div className="flex-1 p-2 flex flex-col gap-0.5 overflow-hidden">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5 animate-pulse" style={{ paddingLeft: `${8 + (i % 4) * 12}px` }}>
          <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />
          <div className="h-3.5 bg-surface-active/30 rounded" style={{ width: `${Math.max(40, 85 - i * 5)}%` }} />
        </div>
      ))}
    </div>
    <div className="px-3 py-2 border-t border-border">
      <div className="flex items-center gap-2 animate-pulse">
        <div className="w-3.5 h-3.5 bg-surface-active/50 rounded" />
        <div className="h-3 w-16 bg-surface-active/30 rounded" />
      </div>
    </div>
  </div>
))
SidebarSkeleton.displayName = 'SidebarSkeleton'

export const PanelSkeleton = SidebarSkeleton

export const CodeAreaSkeleton = memo(() => (
  <div className="h-full w-full flex flex-col bg-background">
    <div className="h-9 border-b border-border flex items-center px-2 gap-1">
      <div className="h-6 w-24 bg-surface-active/50 rounded animate-pulse" />
      <div className="h-6 w-20 bg-surface-active/30 rounded animate-pulse" />
    </div>
    <div className="flex-1 p-4 flex flex-col gap-2">
      {Array.from({ length: 15 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="w-8 h-4 bg-surface-active/30 rounded flex-shrink-0" />
          <div className="h-4 bg-surface-active/40 rounded" style={{ width: `${Math.max(20, 70 - ((i * 5) % 50))}%`, marginLeft: `${(i % 3) * 16}px` }} />
        </div>
      ))}
    </div>
  </div>
))
CodeAreaSkeleton.displayName = 'CodeAreaSkeleton'

export const EditorSkeleton = CodeAreaSkeleton

export const ConversationSkeleton = memo(() => (
  <div className="h-full w-full p-4 space-y-6 overflow-hidden bg-background-chat">
    {Array.from({ length: 3 }, (_, idx) => (
      <div key={idx} className="flex gap-3 animate-pulse">
        <div className="w-7 h-7 bg-surface-active/50 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className={`h-3 ${idx % 2 === 0 ? 'w-16' : 'w-12'} bg-surface-active/50 rounded`} />
          <div className="space-y-1.5">
            <div className="h-3 bg-surface-active/30 rounded w-[90 - idx * 10]%" />
            <div className="h-3 bg-surface-active/30 rounded w-[75 - idx * 10]%" />
            {idx % 2 === 0 && <div className="h-3 bg-surface-active/30 rounded w-[60]%" />}
          </div>
        </div>
      </div>
    ))}
  </div>
))
ConversationSkeleton.displayName = 'ConversationSkeleton'

export const ChatMessagesSkeleton = ConversationSkeleton

export const ChatSkeleton = memo(() => (
  <div className="h-full flex flex-col bg-background-chat">
    <div className="h-10 border-b border-border flex items-center justify-between px-4">
      <div className="h-4 w-12 bg-surface-active/50 rounded animate-pulse" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (<div key={i} className="w-5 h-5 bg-surface-active/30 rounded animate-pulse" />))}
      </div>
    </div>
    <ConversationSkeleton />
    <div className="p-3 border-t border-border">
      <div className="h-16 bg-surface-active/30 rounded-xl animate-pulse" />
    </div>
  </div>
))
ChatSkeleton.displayName = 'ChatSkeleton'

interface RowSkeletonProps { rows?: number; showIcon?: boolean }

export const RowSkeleton = memo(({ rows = 5, showIcon = true }: RowSkeletonProps) => (
  <div className="flex flex-col gap-1 p-2">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex items-center gap-2 p-2 animate-pulse">
        {showIcon && <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />}
        <div className="h-4 bg-surface-active/30 rounded" style={{ width: `${Math.max(40, 90 - i * 12)}%` }} />
      </div>
    ))}
  </div>
))
RowSkeleton.displayName = 'RowSkeleton'

export const ListSkeleton = RowSkeleton

interface TreeNodeSkeletonProps { rows?: number }

export const TreeNodeSkeleton = memo(({ rows = 12 }: TreeNodeSkeletonProps) => (
  <div className="flex flex-col gap-0.5 p-2">
    {Array.from({ length: rows }, (_, i) => {
      const depth = i % 4
      return (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5 animate-pulse" style={{ paddingLeft: `${8 + depth * 12}px` }}>
          <div className="w-3.5 h-3.5 rounded-sm bg-surface-active/45 flex-shrink-0" />
          <div className="h-3 rounded bg-surface-active/30" style={{ width: `${Math.max(32, 88 - (i % 6) * 11)}%` }} />
        </div>
      )
    })}
  </div>
))
TreeNodeSkeleton.displayName = 'TreeNodeSkeleton'

export const TreeSkeleton = TreeNodeSkeleton

export interface CodeBlockSkeletonProps { lines?: number }

export const CodeBlockSkeleton = memo(({ lines = 5 }: CodeBlockSkeletonProps) => (
  <div className="h-full w-full p-4 flex flex-col gap-3 select-none bg-surface/20">
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className="flex items-center gap-4 animate-pulse">
        <div className="w-8 h-3 bg-surface-active/40 rounded-sm shrink-0" />
        <div className="h-3 bg-surface-active/30 rounded-sm" style={{ width: `${Math.max(30, 85 - (i * 15) % 50)}%`, opacity: 0.7 - i * 0.1 }} />
      </div>
    ))}
  </div>
))
CodeBlockSkeleton.displayName = 'CodeBlockSkeleton'

export const CodeSkeleton = CodeBlockSkeleton

interface InlineBusyProps { text?: string; size?: 'xs' | 'sm' }

export const InlineBusy = memo(({ text, size = 'sm' }: InlineBusyProps) => (
  <div className="flex items-center gap-2 text-text-muted">
    <Spinner size={size} />
    {text && <span className={size === 'xs' ? 'text-[11px]' : 'text-xs'}>{text}</span>}
  </div>
))
InlineBusy.displayName = 'InlineBusy'

export const InlineLoading = InlineBusy

export const SettingsSkeleton = memo(() => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div className="w-full max-w-5xl mx-4 overflow-hidden bg-background/80 backdrop-blur-2xl border border-border/50 shadow-2xl shadow-black/20 rounded-3xl">
      <div className="flex h-[75vh] max-h-[800px]">
        <div className="w-64 bg-surface/30 backdrop-blur-xl border-r border-border/50 flex flex-col pt-8 pb-6">
          <div className="px-6 mb-6">
            <div className="h-7 w-20 bg-surface-active/50 rounded animate-pulse" />
          </div>
          <nav className="flex-1 px-4 space-y-1">
            {Array.from({ length: 11 }, (_, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg animate-pulse ${i === 0 ? 'bg-accent/10' : ''}`}>
                <div className="w-4 h-4 bg-surface-active/50 rounded flex-shrink-0" />
                <div className="h-3 bg-surface-active/50 rounded" style={{ width: `${60 + (i % 3) * 15}%` }} />
              </div>
            ))}
          </nav>
          <div className="mt-auto px-6 pt-6 border-t border-border/50 space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="w-3.5 h-3.5 bg-surface-active/50 rounded animate-pulse" />
              <div className="h-3 w-12 bg-surface-active/50 rounded animate-pulse" />
            </div>
            <div className="h-9 bg-surface-active/30 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
          <div className="flex-1 overflow-y-auto px-10 py-10">
            <div className="mb-8 pb-6 border-b border-border/40">
              <div className="h-9 w-40 bg-surface-active/50 rounded animate-pulse mb-2" />
              <div className="h-4 w-80 bg-surface-active/30 rounded animate-pulse" />
            </div>
            <div className="space-y-8">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2 animate-pulse">
                  <div className="h-4 w-32 bg-surface-active/50 rounded" />
                  <div className="h-10 bg-surface-active/30 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          <div className="absolute bottom-6 right-8 left-8 p-4 rounded-2xl bg-surface/80 backdrop-blur-xl border border-border/50 shadow-2xl flex items-center justify-between">
            <div className="h-3 w-32 bg-surface-active/30 rounded animate-pulse" />
            <div className="flex items-center gap-3">
              <div className="h-9 w-16 bg-surface-active/30 rounded-lg animate-pulse" />
              <div className="h-9 w-32 bg-accent/20 rounded-xl animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
))
SettingsSkeleton.displayName = 'SettingsSkeleton'
