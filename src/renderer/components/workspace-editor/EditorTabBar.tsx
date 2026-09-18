/**
 * 编辑器标签栏组件
 * [AweeClaw] 增强功能：场景标签指示、文件类型图标、拖拽排序视觉反馈
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import { X, AlertCircle, AlertTriangle, RefreshCw, FileX, FileDiff, Globe, Eye, Edit, Columns, PenLine } from 'lucide-react'
import { getFileName, normalizePath } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { t, type Language } from '@renderer/i18n'
import { isPreviewDocumentPath } from '@shared/protocols/previewProtocol'
import { HintOverlay } from '../ui/HintOverlay'
import { isPptPreviewPath } from '@shared/protocols/pptPreviewProtocol'
import { isOoEditPath, OO_EDITABLE_EXTENSIONS } from '@shared/protocols/onlyOfficeProtocol'
import { BRAND } from '@shared/brand'

export type ViewMode = 'edit' | 'preview' | 'split'

interface EditorTabsProps {
  activeFilePath: string | null
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, filePath: string) => void
  lintErrorCount: number
  lintWarningCount: number
  isLinting: boolean
  onRunLint: () => void
  activeFileKind?: 'file' | 'diff' | 'preview' | 'ppt-preview' | 'oo-edit'
  /** 当前活跃文件类型（用于决定是否显示视图模式按钮） */
  activeFileType?: string
  /** 当前视图模式 */
  viewMode?: ViewMode
  /** 视图模式切换回调 */
  onViewModeChange?: (mode: ViewMode) => void
  /** ONLYOFFICE 在线编辑入口（doc/docx/ppt/pptx/xls/xlsx/csv 等，保存后回写本地） */
  onOnlyOfficeEdit?: (filePath: string) => void
}

/**
 * 获取 tab 显示名称
 */
function getTabDisplayName(filePath: string): string {
  const name = getFileName(filePath)
  return name || 'Untitled'
}

function isPlanJsonFile(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return normalizedPath.includes(`/${BRAND.dirName}/planner/`) && normalizedPath.endsWith('.json')
}

/** 可在 ONLYOFFICE 中在线编辑的扩展名（与主进程上传白名单共用一份） */
const ONLYOFFICE_ENTRY_EXTENSIONS = new Set<string>(OO_EDITABLE_EXTENSIONS)
function isOnlyOfficeEntryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return ONLYOFFICE_ENTRY_EXTENSIONS.has(ext)
}

/** 单个标签页的展示数据（在父组件统一解算，子组件只负责渲染） */
interface EditorTabItemProps {
  filePath: string
  fileName: string
  isActive: boolean
  isDirty: boolean
  isDeleted: boolean
  isDiff: boolean
  isPreview: boolean
  isOoEdit: boolean
  language: Language
  onSelectFile: (path: string) => void
  onCloseFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, filePath: string) => void
}

/**
 * 单个标签页
 *
 * 单独 memo 化：编辑内容、脏标记、开关文件都只影响对应的那一个 Tab，
 * 否则每次 openFiles 变化都会让整条标签栏的 DOM 全部重建，Tab 一多就卡。
 */
const EditorTabItem = memo(function EditorTabItem({
  filePath,
  fileName,
  isActive,
  isDirty,
  isDeleted,
  isDiff,
  isPreview,
  isOoEdit,
  language,
  onSelectFile,
  onCloseFile,
  onContextMenu,
}: EditorTabItemProps) {
  return (
    <HintOverlay content={filePath} side="top" delay={400} className="flex-shrink-0 h-full">
      <div
        data-file-path={filePath}
        className={`
          group relative flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] cursor-pointer transition-colors duration-150 rounded-md flex-shrink-0
          ${isActive
            ? 'bg-surface-hover text-text-primary'
            : 'bg-transparent text-text-muted hover:bg-surface-hover/50 hover:text-text-primary'}
          ${isDeleted ? 'opacity-60' : ''}
        `}
        onClick={() => onSelectFile(filePath)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e, filePath)
        }}
      >
        {/* 已删除文件图标 */}
        {isDeleted && (
          <span title={t('editor.fileDeleted', language)}>
            <FileX className="w-3.5 h-3.5 text-status-error flex-shrink-0" />
          </span>
        )}

        {isDiff && <FileDiff className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
        {isPreview && <Globe className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />}
        {isOoEdit && <PenLine className="w-3.5 h-3.5 text-accent flex-shrink-0" />}

        <span className={`text-[13px] truncate flex-1 ${isDeleted ? 'line-through text-text-muted' : ''}`}>{fileName}</span>

        <div
          className="flex items-center justify-center w-5 h-5 rounded-lg hover:bg-surface-hover transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onCloseFile(filePath)
          }}
        >
          {isDirty ? (
            <div className="w-2 h-2 rounded-full bg-accent group-hover:hidden" />
          ) : null}
          <X className={`w-3.5 h-3.5 ${isDirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100'} transition-opacity`} />
        </div>
      </div>
    </HintOverlay>
  )
})

export const EditorTabs = memo(function EditorTabs({
  activeFilePath,
  onSelectFile,
  onCloseFile,
  onContextMenu,
  lintErrorCount,
  lintWarningCount,
  isLinting,
  onRunLint,
  activeFileKind,
  activeFileType,
  viewMode,
  onViewModeChange,
  onOnlyOfficeEdit,
}: EditorTabsProps) {
  // 获取数据
  const openFiles = useStore(state => state.openFiles)
  const language = useStore(state => state.language)
  const plans = useAgentStore(state => state.plans)

  // 计划 id → 名称索引：避免每个 Tab 都对 plans 做一次线性查找（Tab 多时是 O(Tab × Plan)）
  const planNameById = useMemo(() => new Map(plans.map((p) => [p.id, p.name])), [plans])

  // Tab 滚动容器 ref：当打开的文件较多时，保证当前激活 Tab 自动滚动到可见区域
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // activeFilePath 变化（切换/打开/关闭文件）时，自动将激活 Tab 滚动进可视区
  useEffect(() => {
    if (!activeFilePath) return
    const container = scrollContainerRef.current
    if (!container) return
    const tab = container.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(activeFilePath)}"]`)
    if (!tab) return
    // 注意：Tab 外包了 HintOverlay（relative wrapper），offsetLeft 参照的是 wrapper 而非滚动容器，
    // 必须用 getBoundingClientRect 差值计算 Tab 在滚动内容中的真实位置
    const tabRect = tab.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const tabLeft = tabRect.left - containerRect.left + container.scrollLeft
    const tabRight = tabLeft + tabRect.width
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    const MARGIN = 8
    if (tabLeft < viewLeft + MARGIN) {
      // Tab 在可视区左侧之外（或贴边）：向左滚动，露出完整 Tab
      container.scrollTo({ left: Math.max(0, tabLeft - MARGIN), behavior: 'smooth' })
    } else if (tabRight > viewRight - MARGIN) {
      // Tab 在可视区右侧之外（或贴边）：向右滚动，露出完整 Tab
      container.scrollTo({ left: tabRight - container.clientWidth + MARGIN, behavior: 'smooth' })
    }
  }, [activeFilePath])
  return (
    <div className="h-[42px] flex items-stretch bg-background border-b border-border/50 select-none">
      {/* 左侧：Tab 滚动区域 */}
      <div
        ref={scrollContainerRef}
        className="relative flex-1 flex items-center overflow-x-auto overflow-y-hidden scrollbar-none px-2 gap-1.5 py-1.5 min-w-0"
        onWheel={(e) => {
          if (e.deltaY !== 0 && e.currentTarget) {
            e.currentTarget.scrollLeft += e.deltaY
          }
        }}
      >
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath

          // 计算显示名称
          let fileName = getTabDisplayName(file.path)

          // 如果是计划文件，尝试显示计划名称
          if (file.path.endsWith('.json') && isPlanJsonFile(file.path)) {
            const planName = planNameById.get(fileName.replace('.json', ''))
            if (planName) fileName = planName
          }

          const isDiff = file.path.startsWith('diff://')
          if (isDiff) {
            fileName = `Diff: ${getFileName(file.path.slice(7))}`
          }

          const isPreview = file.kind === 'preview' || isPreviewDocumentPath(file.path)
          if (isPreview) {
            fileName = file.preview?.title || 'Preview'
          }

          // v2.3：PPT 预览 Tab 显示标题
          const isPptPreview = file.kind === 'ppt-preview' || isPptPreviewPath(file.path)
          if (isPptPreview) {
            fileName = file.pptPreview?.meta?.title || 'PPT 预览'
          }

          // v2.4：ONLYOFFICE 在线编辑 Tab 显示标题
          const isOoEdit = file.kind === 'oo-edit' || isOoEditPath(file.path)
          if (isOoEdit) {
            fileName = file.ooEdit?.title || '在线编辑'
          }

          return (
            <EditorTabItem
              key={file.path}
              filePath={file.path}
              fileName={fileName}
              isActive={isActive}
              isDirty={file.isDirty}
              isDeleted={Boolean(file.isDeleted)}
              isDiff={isDiff}
              isPreview={isPreview}
              isOoEdit={isOoEdit}
              language={language}
              onSelectFile={onSelectFile}
              onCloseFile={onCloseFile}
              onContextMenu={onContextMenu}
            />
          )
        })}
      </div>

      {/* 右侧操作区：固定位置，不随 Tab 滚动 */}
      {activeFilePath && activeFileKind !== 'preview' && activeFileKind !== 'ppt-preview' && activeFileKind !== 'oo-edit' && (
        <div className="flex items-center flex-shrink-0 h-full">
          {/* 视图模式按钮组（仅 markdown / html 显示） */}
          {activeFileType && (activeFileType === 'markdown' || activeFileType === 'html') && viewMode && onViewModeChange && (
            <div className="flex items-center gap-1 px-2 h-full border-l border-border">
              <button onClick={() => onViewModeChange('edit')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'edit' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`} title={t('editor.editMode', language)}>
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onViewModeChange('split')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'split' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`} title={t('editor.splitMode', language)}>
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onViewModeChange('preview')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'preview' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`} title={t('editor.previewMode', language)}>
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ONLYOFFICE 在线编辑入口（doc/docx/ppt/pptx/xls/xlsx/csv 等，保存后回写本地） */}
          {isOnlyOfficeEntryPath(activeFilePath) && onOnlyOfficeEdit && (
            <div className="flex items-center px-2 h-full border-l border-border">
              <button
                onClick={() => onOnlyOfficeEdit(activeFilePath)}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                title="在 ONLYOFFICE 中在线编辑（保存后回写本地文件）"
              >
                <PenLine className="w-3.5 h-3.5 text-accent" />
                在线编辑
              </button>
            </div>
          )}

          {/* 分隔竖线 + Lint 状态 */}
          <div className="flex items-center gap-2 px-3 h-full border-l border-border bg-transparent">
            {(lintErrorCount > 0 || lintWarningCount > 0) && (
              <div className="flex items-center gap-2 text-xs mr-2">
                {lintErrorCount > 0 && (
                  <span className="flex items-center gap-1 text-status-error" title="Errors">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {lintErrorCount}
                  </span>
                )}
                {lintWarningCount > 0 && (
                  <span className="flex items-center gap-1 text-status-warning" title="Warnings">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {lintWarningCount}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={onRunLint}
              disabled={isLinting}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50 group"
              title="Run lint check"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-text-muted group-hover:text-text-primary ${isLinting ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
