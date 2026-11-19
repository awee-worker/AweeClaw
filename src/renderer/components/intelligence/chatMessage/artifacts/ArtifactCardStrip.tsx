/**
 * 会话产物卡片
 *
 * AI 执行任务时生成的图片 / 视频 / 音频 / 文档，在会话流里就地成卡展示，
 * 不必再展开工具调用才能看到结果。
 *
 * 状态约束：每张卡片都覆盖「正常 / 加载失败」两条路径；没有产物时整块不渲染
 * （返回 null），不占位、不留空标题。
 *
 * @module chatMessage/artifacts/ArtifactCardStrip
 */

import { memo, useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  FileText,
  FolderOpen,
  Maximize2,
  Music,
  Video as VideoIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCall } from '@intelligence/providerTypes'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { openLocalFileInEditor } from '@utils/linkRouter'
import { OverlayDialog } from '../../../ui/OverlayDialog'
import { collectArtifacts, artifactExtension, type ArtifactKind, type ChatArtifact } from './artifactModel'

/** 卡片通用操作按钮 */
function ActionButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
    </button>
  )
}

/** 卡片头部：类型图标 + 标题 + 操作 */
function CardHeader({
  icon: Icon,
  title,
  actions,
}: {
  icon: LucideIcon
  title: string
  actions: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border/40">
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden />
        <span className="text-[12px] text-text-primary truncate" title={title}>{title}</span>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">{actions}</div>
    </div>
  )
}

/** 加载失败占位 */
function MediaError({ isZh, text }: { isZh: boolean; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-6 text-text-muted">
      <AlertCircle className="w-4 h-4" aria-hidden />
      <span className="text-[12px]">{isZh ? '加载失败' : 'Failed to load'}</span>
      {text && <span className="text-[11px] text-text-muted/70 truncate max-w-[220px]">{text}</span>}
    </div>
  )
}

/** 图片卡 */
const ImageArtifactCard = memo(function ImageArtifactCard({
  artifact,
  isZh,
  onPreview,
}: {
  artifact: ChatArtifact
  isZh: boolean
  onPreview: (artifact: ChatArtifact) => void
}) {
  const [failed, setFailed] = useState(false)

  return (
    <figure className="m-0 rounded-xl overflow-hidden border border-border/50 bg-bg-hover/20 group">
      <CardHeader
        icon={Maximize2}
        title={artifact.title}
        actions={
          <>
            {!failed && artifact.src && (
              <ActionButton
                label={isZh ? '放大查看' : 'Zoom in'}
                icon={Maximize2}
                onClick={() => onPreview(artifact)}
              />
            )}
            {artifact.filePath && (
              <ActionButton
                label={isZh ? '在文件夹中显示' : 'Show in folder'}
                icon={FolderOpen}
                onClick={() => api.file.showInFolder(artifact.filePath)}
              />
            )}
          </>
        }
      />
      {failed || !artifact.src ? (
        <MediaError isZh={isZh} text={artifact.filePath} />
      ) : (
        <button
          type="button"
          onClick={() => onPreview(artifact)}
          className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={isZh ? `放大查看 ${artifact.title}` : `Zoom in ${artifact.title}`}
        >
          <img
            src={artifact.src}
            alt={artifact.title}
            loading="lazy"
            className="w-full max-h-[240px] object-contain bg-black/20 transition-transform duration-200 group-hover:scale-[1.01]"
            onError={() => setFailed(true)}
          />
        </button>
      )}
    </figure>
  )
})

/** 视频卡 */
const VideoArtifactCard = memo(function VideoArtifactCard({
  artifact,
  isZh,
}: {
  artifact: ChatArtifact
  isZh: boolean
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 bg-bg-hover/20">
      <CardHeader
        icon={VideoIcon}
        title={artifact.title}
        actions={
          artifact.filePath ? (
            <ActionButton
              label={isZh ? '用系统程序打开' : 'Open with system app'}
              icon={FolderOpen}
              onClick={() => void openLocalFileInEditor(artifact.filePath)}
            />
          ) : null
        }
      />
      {failed || !artifact.src ? (
        <div>
          <MediaError isZh={isZh} text={artifact.filePath} />
          {artifact.filePath && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                onClick={() => void openLocalFileInEditor(artifact.filePath)}
                className="px-2 py-1 rounded-md text-[12px] text-accent hover:bg-accent/10 transition-colors"
              >
                {isZh ? '用系统程序打开' : 'Open with system app'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <video
          src={artifact.src}
          controls
          preload="metadata"
          playsInline
          className="w-full max-h-[280px] bg-black/60"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
})

/** 音频卡 */
const AudioArtifactCard = memo(function AudioArtifactCard({
  artifact,
  isZh,
}: {
  artifact: ChatArtifact
  isZh: boolean
}) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 bg-bg-hover/20">
      <CardHeader
        icon={Music}
        title={artifact.title}
        actions={
          artifact.filePath ? (
            <ActionButton
              label={isZh ? '在文件夹中显示' : 'Show in folder'}
              icon={FolderOpen}
              onClick={() => api.file.showInFolder(artifact.filePath)}
            />
          ) : null
        }
      />
      <div className="px-2.5 py-2">
        {failed || !artifact.src ? (
          <MediaError isZh={isZh} text={artifact.filePath} />
        ) : (
          <audio
            src={artifact.src}
            controls
            preload="metadata"
            className="w-full"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  )
})

/** 文档卡：点击交给编辑器 / 对应预览器打开 */
const DocumentArtifactCard = memo(function DocumentArtifactCard({
  artifact,
  isZh,
}: {
  artifact: ChatArtifact
  isZh: boolean
}) {
  const ext = artifactExtension(artifact.filePath) || 'FILE'
  const open = useCallback(() => {
    if (artifact.filePath) void openLocalFileInEditor(artifact.filePath)
  }, [artifact.filePath])

  return (
    <button
      type="button"
      onClick={open}
      className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-xl border border-border/50 bg-bg-hover/20 text-left hover:border-accent/40 hover:bg-accent/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      title={isZh ? '打开文档' : 'Open document'}
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/10 text-accent shrink-0">
        <FileText className="w-4 h-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-text-primary truncate">{artifact.title}</span>
        <span className="block text-[11px] text-text-muted">{ext}</span>
      </span>
      <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" aria-hidden />
    </button>
  )
})

function ArtifactCard({ artifact, isZh, onPreview }: {
  artifact: ChatArtifact
  isZh: boolean
  onPreview: (artifact: ChatArtifact) => void
}) {
  switch (artifact.kind) {
    case 'image':
      return <ImageArtifactCard artifact={artifact} isZh={isZh} onPreview={onPreview} />
    case 'video':
      return <VideoArtifactCard artifact={artifact} isZh={isZh} />
    case 'audio':
      return <AudioArtifactCard artifact={artifact} isZh={isZh} />
    case 'document':
    default:
      return <DocumentArtifactCard artifact={artifact} isZh={isZh} />
  }
}

/** 产物类型在网格中的跨列策略：媒体卡更宽，文档卡紧凑两列 */
function gridItemClass(kind: ArtifactKind): string {
  switch (kind) {
    case 'image':
      return 'sm:col-span-1'
    case 'video':
      return 'sm:col-span-2'
    case 'audio':
      return 'sm:col-span-2'
    case 'document':
    default:
      return 'sm:col-span-1'
  }
}

interface ArtifactCardStripProps {
  /** 该工具组内的工具调用（产物来源） */
  toolCalls: ToolCall[]
}

/**
 * 会话流中的产物卡片区
 *
 * 无产物时返回 null —— 普通的一次查询 / 一次代码修改不会留下空标题与空网格。
 */
export const ArtifactCardStrip = memo(function ArtifactCardStrip({ toolCalls }: ArtifactCardStripProps) {
  const language = useStore((state) => state.language)
  const isZh = language === 'zh'
  const [previewing, setPreviewing] = useState<ChatArtifact | null>(null)

  const artifacts = useMemo(() => collectArtifacts(toolCalls), [toolCalls])

  const handlePreview = useCallback((artifact: ChatArtifact) => setPreviewing(artifact), [])
  const closePreview = useCallback(() => setPreviewing(null), [])

  if (artifacts.length === 0) return null

  return (
    <section className="mt-2 mb-1" aria-label={isZh ? '本轮生成的内容' : 'Generated content'}>
      <div className="flex items-center gap-1.5 mb-1.5 text-[12px] text-text-muted">
        <span className="w-1 h-1 rounded-full bg-accent/70" aria-hidden />
        <span>{isZh ? '生成内容' : 'Generated'} ({artifacts.length})</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className={gridItemClass(artifact.kind)}>
            <ArtifactCard artifact={artifact} isZh={isZh} onPreview={handlePreview} />
          </div>
        ))}
      </div>

      <OverlayDialog
        isOpen={!!previewing}
        onClose={closePreview}
        size="full"
        noPadding
        showCloseButton={false}
      >
        <div
          className="w-full h-full flex items-center justify-center bg-black/85 p-4 cursor-zoom-out"
          onClick={closePreview}
          role="presentation"
        >
          {previewing?.src && (
            <img
              src={previewing.src}
              alt={previewing.title}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          )}
        </div>
      </OverlayDialog>
    </section>
  )
})
