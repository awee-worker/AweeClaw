/**
 * 产物面板
 *
 * 汇总 AI 执行任务时产出的文件，点击即可打开预览（行为与工作区文件树一致），
 * 支持移除单条与清空全部。产物只保留路径元信息，文件内容由编辑器按需读取。
 */

import { useCallback, useMemo } from 'react'
import {
  Package,
  ChevronDown,
  ChevronRight,
  FileText,
  FileCode,
  Image as ImageIcon,
  Video,
  Plus,
  Pencil,
  X,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { api } from '../../../adapters/electronBridge'
import { getFileType, type FileType } from '@components/workspace-editor/FilePreviewPanel'
import { getFileName, resolveToRelative, normalizePath, pathStartsWith } from '@shared/toolkit/pathHelper'
import { t, type Language } from '@renderer/i18n'
import { toast } from '@components/foundation/NotificationProvider'
import { HintOverlay } from '../../ui'

/** 无需读取文本内容、直接交给预览组件处理的文件类型（与工作区文件树的打开规则一致） */
const DIRECT_PREVIEW_TYPES: FileType[] = [
  'image', 'video', 'binary', 'xlsx', 'pdf', 'docx', 'doc', 'pptx', 'ppt', 'model3d',
]

/** 代码类扩展名（用于挑选图标） */
const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm',
  'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'xml',
]

interface ArtifactIconProps {
  path: string
}

function ArtifactIcon({ path }: ArtifactIconProps) {
  const type = getFileType(path)

  if (type === 'image') {
    return <ImageIcon className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400/80" />
  }
  if (type === 'video') {
    return <Video className="w-3.5 h-3.5 flex-shrink-0 text-violet-400/80" />
  }

  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (CODE_EXTENSIONS.includes(ext)) {
    return <FileCode className="w-3.5 h-3.5 flex-shrink-0 text-sky-400/80" />
  }

  return <FileText className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
}

interface ArtifactPanelProps {
  /** 产物栏是否折叠（由工作区面板控制高度布局） */
  collapsed: boolean
  onToggleCollapse: () => void
}

export function ArtifactPanel({ collapsed, onToggleCollapse }: ArtifactPanelProps) {
  const {
    artifacts,
    workspacePath,
    activeFilePath,
    language,
    openFile,
    setActiveFile,
    removeArtifact,
    clearArtifacts,
  } = useStore(useShallow(s => ({
    artifacts: s.artifacts,
    workspacePath: s.workspacePath,
    activeFilePath: s.activeFilePath,
    language: s.language,
    openFile: s.openFile,
    setActiveFile: s.setActiveFile,
    removeArtifact: s.removeArtifact,
    clearArtifacts: s.clearArtifacts,
  })))

  // 只展示当前工作区的产物：切换工作区后列表自动切换，无需清空历史
  const visibleArtifacts = useMemo(() => {
    if (!workspacePath) return artifacts
    return artifacts.filter(item => pathStartsWith(item.path, workspacePath))
  }, [artifacts, workspacePath])

  const handleOpen = useCallback(async (filePath: string) => {
    const type = getFileType(filePath)

    // 图片 / 文档 / 二进制等类型不读文本，直接交给预览组件
    if (DIRECT_PREVIEW_TYPES.includes(type)) {
      openFile(filePath, '')
      setActiveFile(filePath)
      return
    }

    const content = await api.file.read(filePath)
    if (content === null) {
      toast.warning(t('error.fileNotFound', language as Language, { path: getFileName(filePath) }))
      return
    }
    openFile(filePath, content)
    setActiveFile(filePath)
  }, [language, openFile, setActiveFile])

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      <div className="flex items-center gap-1.5 h-[30px] min-h-[30px] px-3 border-t border-border/40 select-none">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left group"
          title={collapsed ? t('artifact.expand', language as Language) : t('artifact.collapse', language as Language)}
        >
          {collapsed
            ? <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
            : <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />}
          <Package className="w-3.5 h-3.5 text-accent/70 flex-shrink-0" />
          <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
            {t('artifact.title', language as Language)}
          </span>
          {visibleArtifacts.length > 0 && (
            <span className="flex-shrink-0 text-[10px] font-bold text-accent bg-accent/10 px-1.5 rounded-full">
              {visibleArtifacts.length}
            </span>
          )}
        </button>
        {!collapsed && visibleArtifacts.length > 0 && (
          <HintOverlay content={t('artifact.clear', language as Language)}>
            <button
              onClick={() => clearArtifacts(workspacePath || undefined)}
              className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </HintOverlay>
        )}
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {visibleArtifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
              <Package className="w-5 h-5 text-text-muted/40 mb-2" />
              <p className="text-[11px] text-text-muted">{t('artifact.empty', language as Language)}</p>
              <p className="text-[10px] text-text-muted/60 mt-0.5 leading-snug">
                {t('artifact.emptyHint', language as Language)}
              </p>
            </div>
          ) : (
            <div className="py-0.5">
              {visibleArtifacts.map(item => {
                const isActive = activeFilePath
                  ? normalizePath(activeFilePath) === normalizePath(item.path)
                  : false
                const relativePath = workspacePath
                  ? resolveToRelative(item.path, workspacePath)
                  : item.path

                return (
                  <div key={item.path} className="group relative">
                    <button
                      onClick={() => void handleOpen(item.path)}
                      className={`w-full flex items-start gap-2 px-3 py-1.5 pr-14 text-left transition-colors ${
                        isActive ? 'bg-accent/10' : 'hover:bg-surface-hover'
                      }`}
                    >
                      <span className="mt-0.5"><ArtifactIcon path={item.path} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={`text-xs truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                            {getFileName(item.path)}
                          </span>
                          <span className={`flex-shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 rounded ${
                            item.action === 'create'
                              ? 'text-emerald-400 bg-emerald-400/10'
                              : 'text-sky-400 bg-sky-400/10'
                          }`}>
                            {item.action === 'create'
                              ? <Plus className="w-2 h-2" />
                              : <Pencil className="w-2 h-2" />}
                            {item.action === 'create'
                              ? t('artifact.created', language as Language)
                              : t('artifact.edited', language as Language)}
                          </span>
                        </span>
                        <span className="block text-[10px] text-text-muted truncate mt-0.5">
                          {relativePath}
                        </span>
                      </span>
                    </button>

                    <div className="absolute right-1.5 top-1.5 hidden group-hover:flex items-center gap-0.5">
                      <HintOverlay content={t('contextMenu.revealFileLocation', language as Language)}>
                        <button
                          onClick={() => api.file.showInFolder(item.path)}
                          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-active transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </HintOverlay>
                      <HintOverlay content={t('artifact.remove', language as Language)}>
                        <button
                          onClick={() => removeArtifact(item.path)}
                          className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </HintOverlay>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ArtifactPanel
