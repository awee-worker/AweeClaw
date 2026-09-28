/**
 * 编辑器主组件
 */
import { useRef, useCallback, useEffect, useState, useMemo, Suspense, type ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import MonacoEditor, { OnMount, BeforeMount, loader } from '@monaco-editor/react'
import { MonacoLifecycleBoundary } from './MonacoLifecycleBoundary'
import type { editor } from 'monaco-editor'

import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {t, type Language} from '@renderer/i18n'
import { BRAND } from '@shared/brand'
import { useAgentChangeState } from '@hooks/useAgent'
import { useLspIntegration, useFileSave, useLintCheck } from '@hooks'
import { toast } from '@components/foundation/NotificationProvider'
import { getFileName, normalizePath } from '@shared/toolkit/pathHelper'
import { api } from '../../adapters/electronBridge'
import { didChangeDocument } from '@services/languageServerAdapter'
import { getFileInfo, type EditorSizeProfile } from '@services/largeFileAdapter'
import { getMonacoEditorOptions } from '@renderer/config/monacoSetup'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { keybindingService } from '@services/keybindingAdapter'
import { monaco } from '@renderer/monacoWorkerEntry'
import { initMonacoTypeService } from '@services/monacoTypeAdapter'
import { streamingEditService } from '@intelligence/runtime/streamingEditor'
import { composerService } from '@intelligence/runtime/composerEngine'
import { EventBus } from '@intelligence/engine/EventDispatcher'
import type { StreamingEditState } from '@intelligence/providerTypes'
import type { ThemeName } from '@store/slices/themeSlice'
import { useEditorBreakpoints } from '@hooks/useEditorBreakpoints'
import { consumePendingNavigation } from '@services/editorNavigator'
import { GitLineHistoryPanel } from './GitLineHistoryPanel'
import { subscribeGitLineHistory, type GitLineHistoryRequest } from './gitLineHistoryBus'
import {
  DEFINITION_PICKER_EVENT,
  revealLocation,
  setActiveEditorInstance,
  clearActiveEditorInstance,
  type DefinitionCandidate,
  type DefinitionPickerRequest,
} from '@services/editorNavigation'
import { safeLazy, safeNamedLazy } from '@renderer/utils/safeImport'
import { ensureFileContentLoaded } from '../../toolkit/fileUtils'

// 子组件（通过 safeLazy 加载，场景卸载时不会崩溃）
const EditorTabs = safeNamedLazy(() => import('./EditorTabBar'), 'EditorTabs', { label: 'EditorTabs', silent: true })
const EditorBreadcrumbs = safeNamedLazy(() => import('./EditorPathNav'), 'EditorBreadcrumbs', { label: 'EditorBreadcrumbs', silent: true })
const InlineEdit = safeLazy(() => import('./InlineCodeEdit'), { label: 'InlineCodeEdit', silent: true })
const EditorContextMenu = safeLazy(() => import('./CodeEditorMenu'), { label: 'EditorContextMenu', silent: true })
const DefinitionQuickPick = safeLazy(() => import('./DefinitionQuickPick'), { label: 'DefinitionQuickPick', silent: true })
const TabContextMenu = safeNamedLazy(() => import('./TabActionMenu'), 'TabContextMenu', { label: 'TabContextMenu', silent: true })
const EditorWelcome = safeNamedLazy(() => import('./EditorLanding'), 'EditorWelcome', { label: 'EditorWelcome', silent: true })
const BrowserPreviewTab = safeLazy(() => import('./WebPreviewTab'), { label: 'BrowserPreviewTab', silent: true })

const PdfPreview = safeNamedLazy(() => import('./DocumentPreview'), 'PdfPreview', { label: 'PdfPreview', silent: true })
const DocxPreview = safeNamedLazy(() => import('./DocumentPreview'), 'DocxPreview', { label: 'DocxPreview', silent: true })
const DocPreview = safeNamedLazy(() => import('./DocumentPreview'), 'DocPreview', { label: 'DocPreview', silent: true })
const PptPreview = safeNamedLazy(() => import('./DocumentPreview'), 'PptPreview', { label: 'PptPreview', silent: true })
// v2.3.2：工作区 .pptx 文件预览改用 SlideCanvas 渲染（与 PPT 生成预览视觉一致）
const WorkspacePptxPreview = safeLazy(() => import('../ppt-preview/WorkspacePptxPreview'), { label: 'WorkspacePptxPreview', silent: true })
// v2.4：xlsx 默认进入高保真只读预览（exceljs/SheetJS），点「编辑表格」再切换 x-data-spreadsheet 编辑
const XlsxFileView = safeNamedLazy(() => import('./DocumentPreview'), 'XlsxFileView', { label: 'XlsxFileView', silent: true })
const CsvPreview = safeNamedLazy(() => import('./DocumentPreview'), 'CsvPreview', { label: 'CsvPreview', silent: true })

// v2.3：PPT 实时预览面板（主窗口内嵌 Tab 模式）
const PptPreviewPanel = safeLazy(() => import('../ppt-preview/PptPreviewPanel'), { label: 'PptPreviewPanel', silent: true })

// v2.4：ONLYOFFICE 在线编辑视图（主窗口内嵌 Tab，kind='oo-edit'）
const OnlyOfficeEditView = safeLazy(() => import('../onlyoffice/OnlyOfficeEditView'), { label: 'OnlyOfficeEditView', silent: true })

const DockPanel = safeLazy(() => import('@components/dock-panels/DockPanel'), { label: 'DockPanel', silent: true })

import { DiffPreview } from './DiffViewerPanel'
import DiffViewer from './CodeDiffViewer'
import { SafeDiffEditor } from './SecureDiffEditor'
import { getFileType, MarkdownPreview, ImagePreview, VideoPreview, HtmlPreview, UnsupportedFile } from './FilePreviewPanel'
import { Model3DPreview } from './Model3DPreview'
import { CodeSkeleton } from '../ui/ProgressIndicator'
import { ExecutionBoard } from '../plan/ExecutionBoard'
import WritingWorkspace from '../writing/WritingWorkspace'

function isPlanJsonFile(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return normalizedPath.includes(`/${BRAND.dirName}/planner/`) && normalizedPath.endsWith('.json')
}

function getPlanIdFromPlanFilePath(filePath: string): string {
  return getFileName(filePath).replace(/\.json$/i, '')
}

/** 需要「外部写入时自动滚动到底部」的文档类扩展名 */
const DOCUMENT_EXTENSIONS = new Set([
  'md', 'mdx', 'txt', 'rst', 'adoc', 'asciidoc',
  'html', 'htm', 'css', 'json', 'yaml', 'yml', 'xml',
  'csv', 'tsv', 'log', 'ini', 'conf', 'config',
  'dockerfile', 'makefile', 'gitignore', 'gitattributes',
  'env', 'properties', 'toml',
])

/** 是否为文档类文件（提升到模块级，避免每次渲染都重建扩展名集合） */
function isDocumentFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase()
  const baseName = lowerPath.split(/[/\\]/).pop() || ''
  if (DOCUMENT_EXTENSIONS.has(baseName)) return true
  const ext = lowerPath.split('.').pop() || ''
  return DOCUMENT_EXTENSIONS.has(ext)
}

/**
 * 计算两段文本之间的最小差异区间
 *
 * 只回缩公共前缀与公共后缀，中间剩下的一段即为需要替换的范围 —— 这正是外部写入最常见的形态：
 * AI 追加或改写文件时，绝大部分行并未变化。相比整篇重设，把替换范围压到最小后，
 * Monaco 只需对真正变化的那几行重新分词与重绘，不会整屏刷一次。
 *
 * 无差异时返回 null；差异仅剩插入点（前后缀相接）时 startOffset === endOffset，等价于纯插入。
 */
function computeMinimalTextDiff(
  prev: string,
  next: string,
): { startOffset: number; endOffset: number; text: string } | null {
  if (prev === next) return null

  const maxPrefix = Math.min(prev.length, next.length)
  let startOffset = 0
  while (startOffset < maxPrefix && prev.charCodeAt(startOffset) === next.charCodeAt(startOffset)) {
    startOffset += 1
  }

  // 后缀回缩不得越过已确定的前缀，否则区间会反向
  let prevEnd = prev.length
  let nextEnd = next.length
  while (
    prevEnd > startOffset &&
    nextEnd > startOffset &&
    prev.charCodeAt(prevEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    prevEnd -= 1
    nextEnd -= 1
  }

  if (prevEnd === startOffset && nextEnd === startOffset) return null

  return { startOffset, endOffset: prevEnd, text: next.slice(startOffset, nextEnd) }
}

// Hooks
import { useEditorActions, useAICompletion, useEditorEvents, useComposerInlineDiff } from './hooks'
import { getLanguage } from './utils/langIdMapper'
import { defineMonacoTheme } from './utils/editorTheme'
import { isPreviewDocumentPath } from '@shared/protocols/previewProtocol'
import { isPptPreviewPath, extractSessionIdFromPptPreviewPath } from '@shared/protocols/pptPreviewProtocol'
import { isOoEditPath, OO_EDITABLE_EXTENSIONS } from '@shared/protocols/onlyOfficeProtocol'

/* ---------------- v2.4.2：Office 文档（Word/PPT/Excel）默认走 ONLYOFFICE 在线编辑 ---------------- */

/** 打开普通文件 Tab 时自动接入 ONLYOFFICE 的扩展名（与手动「在线编辑」入口共用一份：doc/docx/ppt/pptx/xls/xlsx/csv） */
const OO_AUTO_EXTENSIONS = new Set<string>(OO_EDITABLE_EXTENSIONS)
/** 本会话内已自动尝试过的文件路径 → 是否成功（避免反复自动启动；失败回退本地后可手动点「在线编辑」重试） */
const ooAutoAttempted = new Map<string, boolean>()

/**
 * Office 文档自动宿主（Word/PPT/Excel）：
 * 本地 file Tab 打开 Office 文档时自动接入 ONLYOFFICE —— 会话建立成功后立即关闭本地 file Tab，
 * 只保留唯一的 oo-edit Tab（「点击文件 → 只打开 ONLYOFFICE 在线编辑」）。
 * 服务器不可用/未配置/启动失败 → 回退本地预览（children），本会话内不再自动重试，
 * 可在标签栏点「在线编辑」手动重试。
 */
function OnlyOfficeAutoHost({ filePath, title, children }: { filePath: string; title: string; children: ReactNode }) {
  const [failed, setFailed] = useState(ooAutoAttempted.get(filePath) === false)
  useEffect(() => {
    // 本会话自动启动失败过一次 → 回退本地预览，不再反复打扰
    if (ooAutoAttempted.get(filePath) === false) return
    let cancelled = false
    void (async () => {
      try {
        const st = useStore.getState()
        // 同源文件的 oo-edit Tab 已存在 → 不重复建会话，只激活它并移除新建的本地 file Tab
        const existingOoTab = st.openFiles.find((f) => f.kind === 'oo-edit' && f.ooEdit?.sourcePath === filePath)
        if (existingOoTab) {
          ooAutoAttempted.set(filePath, true)
          st.closeFile(filePath)
          st.setActiveFile(existingOoTab.path)
          return
        }
        const res = await api.onlyOffice.startSession({ sourcePath: filePath, title })
        if (cancelled) return
        if (res?.ok && res.session) {
          ooAutoAttempted.set(filePath, true)
          st.openOnlyOfficeEdit(res.session, { activate: true })
          // 只保留 oo-edit Tab：关闭本地 file Tab（活跃 Tab 已切到 oo，不受影响）
          st.closeFile(filePath)
        } else {
          ooAutoAttempted.set(filePath, false)
          setFailed(true)
          toast.error(res?.error || 'ONLYOFFICE 在线编辑不可用，已回退本地预览')
        }
      } catch (err) {
        ooAutoAttempted.set(filePath, false)
        if (!cancelled) setFailed(true)
        toast.error(`启动 ONLYOFFICE 在线编辑失败：${(err as Error)?.message || '未知错误'}`)
      }
    })()
    return () => { cancelled = true }
  }, [filePath, title])

  if (failed) return <>{children}</>
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted select-none">
      <Loader2 className="w-6 h-6 animate-spin text-accent" />
      <span className="text-sm">正在 ONLYOFFICE 中打开 {title}…</span>
    </div>
  )
}

loader.config({ monaco })

export default function Editor() {
  const activeFilePath = useStore((state) => state.activeFilePath)
  const activeFile = useStore(useShallow(state => state.openFiles.find(f => f.path === state.activeFilePath)))
  const openFileCount = useStore((state) => state.openFiles.length)

  // 状态
  const [streamingEdit, setStreamingEdit] = useState<StreamingEditState | null>(null)
  const [showDiffPreview, setShowDiffPreview] = useState(false)
  const [isFileStreaming, setIsFileStreaming] = useState(false)
  const [inlineEditState, setInlineEditState] = useState<{
    show: boolean; position: { x: number; y: number }; selectedCode: string; lineRange: [number, number]
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)
  // 多定义 Quick Pick（符号存在多个定义时的选择弹窗）
  const [definitionPicker, setDefinitionPicker] = useState<{ items: DefinitionPickerRequest['items']; position: { x: number; y: number } } | null>(null)
  // Git 行级历史面板（编辑器右键菜单触发）
  const [lineHistoryRequest, setLineHistoryRequest] = useState<GitLineHistoryRequest | null>(null)
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview' | 'split'>('preview')
  const [htmlMode, setHtmlMode] = useState<'edit' | 'preview' | 'split'>('edit')

  const isContextMenuFileDirty = useStore(state => tabContextMenu ? state.openFiles.find(f => f.path === tabContextMenu.filePath)?.isDirty : false)
  const setActiveFile = useStore((state) => state.setActiveFile)
  const updateFileContent = useStore((state) => state.updateFileContent)
  const updateFileDirtyState = useStore((state) => state.updateFileDirtyState)
  const markFileSaved = useStore((state) => state.markFileSaved)
  const language = useStore((state) => state.language)
  const closeFile = useStore((state) => state.closeFile)
  const openOnlyOfficeEdit = useStore((state) => state.openOnlyOfficeEdit)
  const reloadFileFromDisk = useStore((state) => state.reloadFileFromDisk)
  const clearDiskUpdatePending = useStore((state) => state.clearDiskUpdatePending)

  const { pendingChanges, acceptChange, undoChange } = useAgentChangeState()

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null)
  // 滚动状态持久化定时器：滚动是高频事件，只在停止滚动后写一次 store
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // LSP 文档同步定时器：避免每次按键都把整份文件内容通过 IPC 发往语言服务
  const lspSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 记录最近一次「用户输入」交出的内容：用于把本地输入与外部写入区分开（本地路径 O(1) 短路）
  const lastLocalEditRef = useRef<string | null>(null)
  // 待补丁进模型的外部内容（含来源文件路径，避免排队期间切换 Tab 后写错文件）
  const pendingExternalContentRef = useRef<{ path: string; content: string } | null>(null)
  // 外部内容同步的帧调度句柄：同一帧内的多次写入合并为一次补丁
  const externalSyncRafRef = useRef<number | null>(null)
  // 标记「正在把外部内容补丁进模型」：该窗口内的模型变更不是用户编辑，不回写 store、不标脏、不触发自动保存
  const applyingExternalEditRef = useRef(false)
  const setFileScrollPosition = useStore((state) => state.setFileScrollPosition)

  // Hooks
  const { registerProviders, setupDiagnostics, setupLinkNavigation, notifyFileOpened } = useLspIntegration()
  const { saveFile, closeFileWithConfirm, closeOtherFiles, closeAllFiles, closeFilesToRight, triggerAutoSave } = useFileSave()
  const { isLinting, runLintCheck, clearLintErrors, errorCount, warningCount } = useLintCheck()
  const { setupCursorTracking } = useEditorEvents(editorRef)

  // 编辑器右键菜单「行级历史」→ 打开面板（总线是模块级的，WorkspaceEditor 常驻故不会丢事件）
  useEffect(() => subscribeGitLineHistory(setLineHistoryRequest), [])

  /**
   * 把历史版本的内容写回编辑器
   *
   * 走 Monaco model.setValue：一次写入即可让 onChange 同步 store、标脏并触发自动保存；
   * 仅当模型不可用（目标不是当前文件）时才退回直接改 store 缓冲。
   */
  const handleLineHistoryRestore = useCallback((content: string) => {
    const targetPath = lineHistoryRequest?.filePath
    if (!targetPath) return

    const model = editorRef.current?.getModel()
    if (model && activeFilePath === targetPath) {
      model.setValue(content)
      return
    }
    updateFileContent(targetPath, content)
  }, [lineHistoryRequest, activeFilePath, updateFileContent])

  /**
   * 加载磁盘版本：用磁盘内容覆盖编辑器中的未保存修改
   *
   * 只更新 store，模型侧交给外部内容同步 effect 做最小差异补丁，
   * 因此不会清空撤销栈或把光标拽到文末；isDirty 与冲突标记一并在 slice 内归位。
   */
  const handleLoadDiskVersion = useCallback(() => {
    const path = activeFilePath
    if (!path) return
    const pending = useStore.getState().openFiles.find((f) => f.path === path)?.diskUpdatePending
    if (!pending) return
    reloadFileFromDisk(path, pending.content)
  }, [activeFilePath, reloadFileFromDisk])

  /** 保留编辑器中的本地修改，丢弃磁盘上暂存的版本 */
  const handleKeepLocalEdits = useCallback(() => {
    if (!activeFilePath) return
    clearDiskUpdatePending(activeFilePath)
  }, [activeFilePath, clearDiskUpdatePending])

  const isPreviewDocument = Boolean(activeFile && (activeFile.kind === 'preview' || isPreviewDocumentPath(activeFile.path)))
  // v2.3：PPT 预览 Tab（主窗口内嵌模式）
  const isPptPreviewTab = Boolean(activeFile && activeFile.kind === 'ppt-preview' && isPptPreviewPath(activeFile.path))
  const pptPreviewSessionId = isPptPreviewTab && activeFile ? extractSessionIdFromPptPreviewPath(activeFile.path) : null

  // v2.4：ONLYOFFICE 在线编辑 Tab（主窗口内嵌模式）
  const isOoEditTab = Boolean(activeFile && activeFile.kind === 'oo-edit' && isOoEditPath(activeFile.path))
  /** 已打开的 ONLYOFFICE Tab：常驻挂载，切 Tab 只隐藏不卸载（避免 webview 反复重新加载） */
  const ooEditTabs = useStore(
    useShallow((state) => state.openFiles.filter((f) => f.kind === 'oo-edit' && Boolean(f.ooEdit))),
  )

  /** 启动 ONLYOFFICE 在线编辑会话：主进程上传本地文件 → 打开编辑 Tab（成功后关闭本地 file Tab，只保留 oo-edit Tab） */
  const handleOnlyOfficeEdit = useCallback(async (filePath: string) => {
    try {
      const st = useStore.getState()
      // 同源文件的 oo-edit Tab 已存在 → 不重复建会话，只激活它并移除本地 file Tab
      const existingOoTab = st.openFiles.find((f) => f.kind === 'oo-edit' && f.ooEdit?.sourcePath === filePath)
      if (existingOoTab) {
        closeFile(filePath)
        st.setActiveFile(existingOoTab.path)
        return
      }
      const res = await api.onlyOffice.startSession({ sourcePath: filePath, title: getFileName(filePath) })
      if (!res?.ok) {
        toast.error(res?.error || '无法启动 ONLYOFFICE 在线编辑')
        return
      }
      if (!res.session) {
        toast.error('启动失败：服务器未返回会话')
        return
      }
      openOnlyOfficeEdit(res.session, { activate: true })
      // 只保留 oo-edit Tab：关闭本地 file Tab（活跃 Tab 已切到 oo，不受影响）
      closeFile(filePath)
      ooAutoAttempted.set(filePath, true)
    } catch (err) {
      toast.error(`启动 ONLYOFFICE 编辑失败：${(err as Error)?.message || '未知错误'}`)
    }
  }, [closeFile])

  /**
   * Tab 栏回调保持引用稳定
   *
   * EditorTabs 是 memo 组件，内联箭头函数会让每次父组件重渲染都重建整个标签栏；
   * 流式编辑期间父组件重渲染频繁，Tab 一多就会明显卡顿。
   */
  const handleTabContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: path })
  }, [])

  /**
   * 当前文件的大文件档位（仅 isLarge / isVeryLarge）
   *
   * 不能直接依赖 activeFile.content 做 useMemo：用户在大文件里每敲一个字，content 都会产生新引用，
   * 重算不仅要对整段文本再做一次线性扫描（analyzeDocumentProfile 会遍历全部字符统计行数），
   * 还会让 monacoOptions 引用变化，从而触发 editor.updateOptions() —— 两者叠加正是
   * 「大文件里打字卡成幻灯片」的直接原因。
   * 这里改为按路径缓存：文件首次拿到内容时判定一次，之后 content 持续变化也复用同一结果。
   */
  const largeFileInfoCache = useRef(new Map<string, EditorSizeProfile | null>())
  const activeFileHasContent = Boolean(activeFile?.content)
  const activeFileInfo = useMemo<EditorSizeProfile | null>(() => {
    if (!activeFile) return null
    const cached = largeFileInfoCache.current.get(activeFile.path)
    if (cached !== undefined) return cached
    // 打开文件时（safeOpenFile）已算好并写入 store，优先复用；否则做一次兜底判定
    const info: EditorSizeProfile | null =
      activeFile.largeFileInfo ??
      (activeFile.content ? getFileInfo(activeFile.path, activeFile.content) : null)
    // content 尚未加载（被 LRU 淘汰过）时先不落缓存，等补载完成后再判定
    if (info !== null || activeFile.content) {
      largeFileInfoCache.current.set(activeFile.path, info)
    }
    return info
    // 只依赖路径与「是否已有内容」：content 本身不进依赖，避免每次输入都重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, activeFileHasContent])

  /** 当前文件是否走「大文件」降级（非受控编辑器 + 跳过 LSP 同步） */
  const isLargeActiveFile = Boolean(activeFileInfo?.isLarge)

  /**
   * 把外部内容以「最小差异补丁」写进当前模型
   *
   * 不使用整篇 setValue：整篇替换会清空撤销栈、把光标拽到文末、丢掉折叠状态，
   * 并让 Monaco 对全文重新分词重绘 —— 用户看到的就是编辑器整屏闪一下。
   * 这里只替换差异区间，且 cursorStateComputer 返回 null 保持光标与选区不动，
   * 外部写入（AI 编辑、磁盘重载、LRU 补载）因此表现为无感刷新。
   */
  const applyExternalContent = useCallback((filePath: string, content: string) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    // 补丁排队期间用户可能已切走：该文件的内容交给它自己的打开/补载流程处理
    if (useStore.getState().activeFilePath !== filePath) return

    const current = model.getValue()
    if (current === content) return

    const diff = computeMinimalTextDiff(current, content)
    if (!diff) return

    const start = model.getPositionAt(diff.startOffset)
    const end = model.getPositionAt(diff.endOffset)

    applyingExternalEditRef.current = true
    try {
      model.pushEditOperations(
        [],
        [{
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
          text: diff.text,
          forceMoveMarkers: false,
        }],
        () => null,
      )
    } finally {
      applyingExternalEditRef.current = false
    }
  }, [])

  /**
   * 当前文件的外部内容同步（AI 写入 / 磁盘重载 / LRU 补载）
   *
   * 主编辑器一律「非受控」挂载，内容由模型自身持有，store 只在外部变更时把差异补丁回来。
   * 之所以不再用受控 value：@monaco-editor/react 一旦发现 value 变化，会对整个 model 范围执行
   * executeEdits + pushUndoStop，等于每次外部写入都整篇替换一次 —— 光标跳到文末、滚动跳变、
   * 撤销栈被清空，AI 连续写入时就是肉眼可见的整屏闪动。
   *
   * 写入按帧合并：流式预览可能在一帧里连推多次，这里只把最新内容补丁一次。
   * 本地用户输入走 O(1) 短路（onChange 已把内容同步进 store），完全不触碰模型。
   */
  useEffect(() => {
    if (!activeFile || isPreviewDocument) return
    // 被 LRU 淘汰过的文件 content 只是空占位：交给补载流程回填，
    // 不能把它当成「文件被清空」补丁进模型，否则切回该文件时会先空一屏再填回
    if (activeFile.contentEvicted) return
    const content = activeFile.content ?? ''
    if (lastLocalEditRef.current !== null && content === lastLocalEditRef.current) return

    pendingExternalContentRef.current = { path: activeFile.path, content }
    if (externalSyncRafRef.current !== null) return
    externalSyncRafRef.current = window.requestAnimationFrame(() => {
      externalSyncRafRef.current = null
      const pending = pendingExternalContentRef.current
      pendingExternalContentRef.current = null
      if (!pending) return
      applyExternalContent(pending.path, pending.content)
    })
    // content 变化走上面的短路保护，不订阅 activeFile 本体
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, activeFile?.content, activeFile?.contentEvicted, isPreviewDocument, applyExternalContent])

  /**
   * 防抖地把文档变更同步给语言服务
   *
   * didChangeDocument 会把整份文件文本经 IPC 发送给 LSP；逐键发送意味着大文件下
   * 每次按键都要序列化几 MB 字符串，是打字卡顿与高 CPU 的重要来源。
   * 这里做 400ms 防抖；大文件直接跳过（编辑器层本就未为其开启语义分析）。
   */
  const scheduleLspSync = useCallback((filePath: string, content: string) => {
    if (lspSyncTimerRef.current) clearTimeout(lspSyncTimerRef.current)
    lspSyncTimerRef.current = setTimeout(() => {
      lspSyncTimerRef.current = null
      void didChangeDocument(filePath, content)
    }, 400)
  }, [])

  // 卸载时清理待触发的定时器与帧调度，避免对已销毁的编辑器 / 已关闭的文件继续写入
  useEffect(() => {
    return () => {
      if (lspSyncTimerRef.current) clearTimeout(lspSyncTimerRef.current)
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      if (externalSyncRafRef.current !== null) {
        window.cancelAnimationFrame(externalSyncRafRef.current)
        externalSyncRafRef.current = null
      }
      pendingExternalContentRef.current = null
    }
  }, [])

  useComposerInlineDiff(isPreviewDocument ? null : activeFilePath, editorRef.current, monacoRef.current)

  const { registerActions } = useEditorActions(setInlineEditState)
  // 大文件禁用 AI 补全：补全上下文需要整份文件内容（buildContext 会取 model.getValue），
  // 每次触发都要复制一遍几 MB 的文本，会让编辑器持续掉帧。
  const { registerProvider: registerAIProvider } = useAICompletion(
    isPreviewDocument ? null : activeFilePath,
    !activeFileInfo?.isLarge,
  )

  const activeLanguage = activeFile && !isPreviewDocument ? getLanguage(activeFile.path) : 'plaintext'
  const activeFileType = activeFile && !isPreviewDocument ? getFileType(activeFile.path) : 'text'
  /**
   * 超大文件降级为纯文本：Monaco 的分词（tokenization）要逐行跑语言规则，
   * 几 MB 的文件即使只渲染可视区，滚动时也会持续补分词。降级后编辑器只做纯文本渲染。
   */
  const editorLanguage = activeFileInfo?.isVeryLarge ? 'plaintext' : activeLanguage

  /** 视图模式切换（markdown / html），与 Tab 栏共用稳定引用 */
  const handleViewModeChange = useCallback((mode: 'edit' | 'preview' | 'split') => {
    if (activeFileType === 'markdown') setMarkdownMode(mode)
    else if (activeFileType === 'html') setHtmlMode(mode)
  }, [activeFileType])

  const editorFontSize = getEditorConfig().fontSize
  const editorFontFamily = getEditorConfig().fontFamily

  // ⚠️ Monaco 的 options 必须保持引用稳定：
  // @monaco-editor/react 在 options 引用变化时会调用 editor.updateOptions()，
  // 若该调用落在「已 dispose 的 editor」上，monaco 内部会走 _applyOptions → _createView()
  // → this._instantiationService.createInstance(...)，而该 child service 已随 editor 销毁，
  // 于是抛出 "InstantiationService has been disposed"。用 useMemo 固化引用可消除该窗口。
  const monacoOptions = useMemo(() => getMonacoEditorOptions(activeFileInfo), [activeFileInfo])

  // markdown / html 分屏左侧编辑器的精简 options（同样需引用稳定）
  const splitMonacoOptions = useMemo(
    () => ({
      fontSize: editorFontSize,
      fontFamily: editorFontFamily,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 16 },
      contextmenu: false,
    }),
    [editorFontSize, editorFontFamily]
  )
  // v2.4.2：Office 文档（Word/PPT/Excel：doc/docx/ppt/pptx/xls/xlsx/csv）普通文件 Tab 默认接入 ONLYOFFICE 在线编辑，不可用才回退本地预览
  const activeFileExt = activeFile ? (activeFile.path.split('.').pop() || '').toLowerCase() : ''
  const isOoAutoDocument = Boolean(
    activeFile && activeFile.kind === 'file' && !isOoEditTab && !isPreviewDocument && OO_AUTO_EXTENSIONS.has(activeFileExt),
  )
  const currentTheme = useStore((state) => state.currentTheme) as ThemeName

  // 断点管理
  useEditorBreakpoints(editorRef.current, isPreviewDocument ? null : activeFilePath)

  // 主题变化
  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      defineMonacoTheme(monacoRef.current, currentTheme)
      monacoRef.current.editor.setTheme('aweeclaw-dynamic')
    }
  }, [currentTheme])

  // 文件切换时清除 lint 错误并通知 LSP
  // 同时检查是否有跨文件 Go-to-Definition 待处理的跳转定位
  useEffect(() => {
    clearLintErrors()
    // 切换文件：本地输入标记与待同步内容都归属于上一个文件，必须一并清空，
    // 否则新文件会因字符串偶然相等而被短路，或把旧文件的内容补丁进来
    lastLocalEditRef.current = null
    pendingExternalContentRef.current = null
    const file = activeFilePath
      ? useStore.getState().openFiles.find((f) => f.path === activeFilePath)
      : undefined
    if (file && file.content != null && !isPreviewDocument) {
      // 大文件不通知 LSP：didOpenDocument 会让语言服务对整个文档建索引并做语义分析，
      // 几 MB 的文件足以同时拖住主进程与渲染进程，是打开大文件后持续掉帧的主因之一。
      if (!activeFileInfo?.isLarge) {
        notifyFileOpened(file.path, file.content)
      }
      // 检查是否有跨文件跳转定义的待定位请求
      const nav = consumePendingNavigation(file.path)
      if (nav && editorRef.current) {
        setTimeout(() => {
          editorRef.current?.setPosition({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.revealPositionInCenter({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.focus()
        }, 80)
      }
    }
    // activeFilePath + activeFileInfo 已是「文件切换」的稳定依赖：
    // 不订阅 activeFile 本体，避免每次输入都重跑本 effect
  }, [activeFilePath, activeFileInfo, clearLintErrors, notifyFileOpened, isPreviewDocument])

  // 补载被 LRU 淘汰过的文件内容
  // 打开文件数超过上限时 fileSlice 会清空最久未访问的非活跃文件内容以释放内存
  // （content 变成空串）。若不在这里补载，用户点开这些 Tab 会看到空文件 ——
  // AI 连续新建/编辑大量文件后，早期 Tab 被淘汰，表现就是「打开后文件没有内容」。
  useEffect(() => {
    if (!activeFilePath) return
    void ensureFileContentLoaded(activeFilePath)
  }, [activeFilePath])

  // 清理不再打开的文件的 Monaco Models，防止内存泄漏
  useEffect(() => {
    if (!monacoRef.current) return
    const monacoInstance = monacoRef.current
    const models = monacoInstance.editor.getModels()

    const validUris = new Set(
      useStore.getState().openFiles.map(f => {
        if (f.path.startsWith('diff://') || f.kind === 'preview') return ''
        return monacoInstance.Uri.file(f.path).toString()
      })
    )

    models.forEach((model: editor.ITextModel) => {
      const uri = model.uri.toString()
      if (uri.startsWith('inmemory://') || uri.startsWith('internal://')) return

      if (!validUris.has(uri)) {
        model.dispose()
      }
    })
  }, [openFileCount])

  // 流式编辑监听
  useEffect(() => {
    if (!activeFilePath || isPreviewDocument) return

    const activeEdit = streamingEditService.getActiveEditForFile(activeFilePath)
    if (activeEdit) {
      setStreamingEdit(activeEdit.state)
      setShowDiffPreview(true)

      const unsubscribe = streamingEditService.subscribe(activeEdit.editId, (state) => {
        setStreamingEdit(state)
        if (state.isComplete) {
          setTimeout(() => setShowDiffPreview(false), 500)
        }
      })
      return unsubscribe
    } else {
      setStreamingEdit(null)
      setShowDiffPreview(false)
    }
  }, [activeFilePath, isPreviewDocument])

  // 监听文件流式写入事件，追踪当前文件是否正在被 AI 写入
  useEffect(() => {
    if (!activeFilePath) {
      setIsFileStreaming(false)
      return
    }

    const unsub = EventBus.on('file:stream_content', (event) => {
      if (event.filePath === activeFilePath) {
        setIsFileStreaming(!event.isComplete)
      }
    })

    const unsubWritten = EventBus.on('file:written', (event) => {
      if (event.filePath === activeFilePath) {
        setIsFileStreaming(false)
      }
    })

    return () => {
      unsub()
      unsubWritten()
    }
  }, [activeFilePath])

  // 文档类型文件流式预览时自动滚动到底部
  useEffect(() => {
    // 用户手动编辑（isDirty）时不滚动：提前返回，避免每次按键都做一次路径/扩展名判定
    if (!editorRef.current || !activeFile || isPreviewDocument || activeFile.isDirty) return
    if (!activeFile.content) return
    // 仅对文档类型文件启用自动滚动
    if (!isDocumentFile(activeFile.path)) return

    // 文件内容被外部更新（非用户手动编辑）时滚动到底部
    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const lineCount = model.getLineCount()
    if (lineCount > 0) {
      // 使用 requestAnimationFrame 确保在内容渲染完成后滚动
      requestAnimationFrame(() => {
        editor.revealLine(lineCount, 1) // 1 = monaco.editor.ScrollType.Smooth
        editor.setPosition({ lineNumber: lineCount, column: model.getLineMaxColumn(lineCount) })
      })
    }
  }, [activeFile?.content, activeFile?.path, activeFile?.isDirty, isPreviewDocument])


  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    const { currentTheme } = useStore.getState() as { currentTheme: ThemeName }
    defineMonacoTheme(monacoInstance, currentTheme)
    initMonacoTypeService(monacoInstance)
  }

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance
    // 登记活跃编辑器实例：供导航历史 / 引用面板 / 大纲面包屑跨组件跳转复用
    setActiveEditorInstance(editor)
    const disposables: { dispose: () => void }[] = []
    const currentFilePath = activeFilePath

    setupCursorTracking(editor, cursorDebounceRef)
    registerProviders(monacoInstance)
    const unsubscribeDiagnostics = setupDiagnostics(monacoInstance)
    setupLinkNavigation(editor)
    registerActions(editor, monacoInstance)
    registerAIProvider(monacoInstance)

    monacoInstance.editor.setTheme('aweeclaw-dynamic')

    // 恢复文件视图状态
    if (currentFilePath) {
      const { openFiles } = useStore.getState()
      const file = openFiles.find(f => f.path === currentFilePath)
      if (file?.scrollPosition && typeof editor.restoreViewState === 'function') {
        try {
          editor.restoreViewState(file.scrollPosition as any)
        } catch (e) {
          // ignore restore errors
        }
      }
    }

    // 监听滚动变化并保存视图状态
    // 滚动是高频事件（可达每帧），逐帧写 store 会让 openFiles 反复重建、
    // 驱动侧栏与会话面板重渲染，是滚动卡顿与高 CPU 的主因之一。
    // 改为「停止滚动 400ms 后写一次」，并在编辑器销毁时补写最后一帧视图状态。
    let pendingScrollState: unknown = null
    const scrollDisposable = editor.onDidScrollChange(() => {
      if (!currentFilePath || typeof editor.saveViewState !== 'function') return
      pendingScrollState = editor.saveViewState()
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      scrollSaveTimerRef.current = setTimeout(() => {
        scrollSaveTimerRef.current = null
        if (pendingScrollState) setFileScrollPosition(currentFilePath, pendingScrollState as any)
      }, 400)
    })
    disposables.push(scrollDisposable)
    disposables.push({
      dispose: () => {
        if (scrollSaveTimerRef.current) {
          clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = null
        }
        if (pendingScrollState && currentFilePath) setFileScrollPosition(currentFilePath, pendingScrollState as any)
      },
    })

    // 监听内容变化，基于版本号更新 dirty 状态
    const model = editor.getModel()
    if (model && currentFilePath) {
      // 初始化时记录版本号
      const { openFiles } = useStore.getState()
      const file = openFiles.find(f => f.path === currentFilePath)
      if (file && !file.savedVersionId) {
        // 首次打开，记录初始版本号
        const { markFileSaved } = useStore.getState()
        markFileSaved(currentFilePath, model.getAlternativeVersionId())
      }

      const contentDisposable = editor.onDidChangeModelContent(() => {
        // 外部内容补丁引起的模型变更不是用户编辑：跳过脏状态判定，
        // 否则 AI 每次写入都会把文件标脏，进而连带触发自动保存
        if (applyingExternalEditRef.current) return
        // 只用版本号判断脏状态：Monaco 的 alternativeVersionId 在「撤销回保存点」时会回到原值，
        // 语义上等价于原先的整文件字符串比较，但省掉了每次按键对整份文件做一次
        // getValue() + 全等比较（大文件下这是两笔 O(n) 开销，也是打字卡顿的来源之一）。
        updateFileDirtyState(currentFilePath, model.getAlternativeVersionId())
      })
      disposables.push(contentDisposable)
    }

    const contextMenuDisposable = editor.onContextMenu((e) => {
      e.event.preventDefault()
      e.event.stopPropagation()
      if (e.target.position) {
        editor.setPosition(e.target.position)
      }
      setContextMenu({ x: e.event.posx, y: e.event.posy })
    })
    disposables.push(contextMenuDisposable)

    editor.onDidDispose(() => {
      clearActiveEditorInstance(editor)
      unsubscribeDiagnostics()
      disposables.forEach(d => d.dispose())
      disposables.length = 0
    })
  }

  const handleSave = useCallback(async () => {
    if (activeFile && editorRef.current) {
      const config = getEditorConfig()
      if (config.formatOnSave) {
        const formatAction = editorRef.current.getAction('editor.action.formatDocument')
        if (formatAction) await formatAction.run()
      }
      const content = editorRef.current.getValue()
      const success = await api.file.write(activeFile.path, content)
      if (success) {
        if (config.formatOnSave && content !== activeFile.content) {
          updateFileContent(activeFile.path, content)
        }
        // 保存时记录当前版本号
        const model = editorRef.current.getModel()
        const versionId = model?.getAlternativeVersionId()
        markFileSaved(activeFile.path, versionId)
        toast.success(t('editor.filesaved', language as Language), getFileName(activeFile.path))
      } else {
        toast.error(t('editor.savefailed', language as Language), t('editor.couldnotwritetofile', language as Language))
      }
    }
  }, [activeFile, markFileSaved, language, updateFileContent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e.nativeEvent, 'editor.save')) {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  // 监听菜单"保存文件"命令派发的全局事件
  useEffect(() => {
    const handleMenuSave = () => handleSave()
    window.addEventListener('editor:save-active-file', handleMenuSave as EventListener)
    return () => window.removeEventListener('editor:save-active-file', handleMenuSave as EventListener)
  }, [handleSave])

  // 多定义 Quick Pick：跳转方（F12 / Ctrl+Click）派发事件，这里统一渲染选择弹窗
  useEffect(() => {
    const handleDefinitionPicker = (event: Event) => {
      const detail = (event as CustomEvent<DefinitionPickerRequest>).detail
      if (!detail || !Array.isArray(detail.items) || detail.items.length === 0) return
      setDefinitionPicker({ items: detail.items, position: detail.position })
    }
    window.addEventListener(DEFINITION_PICKER_EVENT, handleDefinitionPicker as EventListener)
    return () => window.removeEventListener(DEFINITION_PICKER_EVENT, handleDefinitionPicker as EventListener)
  }, [])

  const handleRunLint = useCallback(() => {
    if (activeFilePath && !isPreviewDocument) {
      runLintCheck(activeFilePath, editorRef.current, monacoRef.current)
    }
  }, [activeFilePath, runLintCheck, isPreviewDocument])

  if (openFileCount === 0) {
    const scenarioId = useStore.getState().activeScenarioId
    if (scenarioId === 'creative-writer') {
      return <WritingWorkspace />
    }
    return <EditorWelcome />
  }

  return (
    <div className="h-full flex flex-col bg-background-editor relative overflow-hidden" onKeyDown={handleKeyDown}>
      <EditorTabs
        activeFilePath={activeFilePath}
        onSelectFile={setActiveFile}
        onCloseFile={closeFileWithConfirm}
        onContextMenu={handleTabContextMenu}
        lintErrorCount={errorCount}
        lintWarningCount={warningCount}
        isLinting={isLinting}
        onRunLint={handleRunLint}
        onOnlyOfficeEdit={handleOnlyOfficeEdit}
        activeFileKind={activeFile?.kind}
        activeFileType={activeFileType}
        viewMode={activeFileType === 'markdown' ? markdownMode : activeFileType === 'html' ? htmlMode : undefined}
        onViewModeChange={handleViewModeChange}
      />

      {activeFile && !isPreviewDocument && !isPptPreviewTab && !isOoEditTab && (
        <EditorBreadcrumbs
          filePath={activeFile.path}
          largeFileInfo={activeFileInfo}
          language={language}
        />
      )}

      {/* 磁盘变更冲突：用户正在编辑该文件时 AI 写入了磁盘，本地内容保持不变，由用户决定如何处理 */}
      {activeFile?.diskUpdatePending && !isPreviewDocument && !isPptPreviewTab && !isOoEditTab && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-status-warning/10 text-xs text-text-secondary">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1 truncate">
            {t('editor.diskconflicthint', language, { name: getFileName(activeFile.path) })}
          </span>
          <button
            type="button"
            onClick={handleLoadDiskVersion}
            className="shrink-0 rounded px-2 py-0.5 font-medium text-status-warning transition-colors hover:bg-status-warning/15"
          >
            {t('editor.diskconflictload', language)}
          </button>
          <button
            type="button"
            onClick={handleKeepLocalEdits}
            className="shrink-0 rounded px-2 py-0.5 text-text-muted transition-colors hover:bg-surface-hover/50 hover:text-text-secondary"
          >
            {t('editor.diskconflictkeep', language)}
          </button>
        </div>
      )}

      {/* 流式编辑预览 */}
      {showDiffPreview && streamingEdit && activeFile && (
        <div className="border-b border-border-subtle h-1/2">
          <DiffViewer
            originalContent={streamingEdit.originalContent}
            modifiedContent={streamingEdit.currentContent}
            filePath={streamingEdit.filePath}
            isStreaming={!streamingEdit.isComplete}
            onAccept={() => {
              updateFileContent(activeFile.path, streamingEdit.currentContent)
              composerService.acceptChange(activeFile.path)
              setShowDiffPreview(false)
            }}
            onReject={() => {
              composerService.rejectChange(activeFile.path)
              setShowDiffPreview(false)
            }}
            onClose={() => setShowDiffPreview(false)}
          />
        </div>
      )}

      {/* 内联编辑器 - 极简悬浮胶囊 */}
      {inlineEditState?.show && activeFile && (
        <InlineEdit
          position={inlineEditState.position}
          selectedCode={inlineEditState.selectedCode}
          filePath={activeFile.path}
          lineRange={inlineEditState.lineRange}
          onClose={() => setInlineEditState(null)}
        />
      )}

      {/* 编辑器主体 */}
      <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
        {/* v2.4：ONLYOFFICE 在线编辑（主窗口内嵌 Tab）
            已打开的 oo-edit Tab 常驻挂载：切走只隐藏不卸载，
            否则每次切回都要重新加载整个编辑器，表现为闪动并丢失滚动位置。 */}
        {ooEditTabs.map((tab) => (
          <div
            key={tab.path}
            aria-hidden={tab.path !== activeFilePath}
            className={
              tab.path === activeFilePath
                ? 'absolute inset-0 z-10 flex flex-col'
                : 'absolute inset-0 z-0 invisible pointer-events-none'
            }
          >
            {tab.ooEdit ? <OnlyOfficeEditView session={tab.ooEdit} /> : null}
          </div>
        ))}

        {isOoEditTab ? null : isPptPreviewTab && pptPreviewSessionId ? (
          <Suspense fallback={<CodeSkeleton lines={8} />}>
            <PptPreviewPanel sessionId={pptPreviewSessionId} />
          </Suspense>
        ) : activeFile?.path.startsWith('diff://') || activeFile?.path.startsWith('git-diff://') ? (
          <DiffPreview
            diff={{
              original: activeFile.originalContent || '',
              modified: activeFile.content || '',
              filePath: activeFile.path.replace(/^(git-)?diff:\/\//, '')
            }}
            isPending={activeFile.path.startsWith('diff://') && pendingChanges.some(c => c.filePath === activeFile.path.replace(/^(git-)?diff:\/\//, ''))}
            readOnly={activeFile.path.startsWith('git-diff://')}
            language={language}
            onClose={() => closeFile(activeFile.path)}
            onChange={(newContent) => {
              if (activeFile.path.startsWith('git-diff://')) return;
              updateFileContent(activeFile.path, newContent)
            }}
            onAccept={async () => {
              if (activeFile.path.startsWith('git-diff://')) return;
              const realPath = activeFile.path.replace(/^(git-)?diff:\/\//, '')
              acceptChange(realPath)
              await composerService.acceptChange(realPath)
              updateFileContent(realPath, activeFile.content)
              closeFile(activeFile.path)
            }}
            onReject={async () => {
              if (activeFile.path.startsWith('git-diff://')) return;
              const realPath = activeFile.path.replace(/^(git-)?diff:\/\//, '')
              await undoChange(realPath)
              await composerService.rejectChange(realPath)
              closeFile(activeFile.path)
            }}
          />
        ) : isPreviewDocument && activeFile ? (
          <Suspense fallback={<CodeSkeleton lines={8} />}>
            <BrowserPreviewTab file={activeFile} />
          </Suspense>
        ) : activeFile && (
          <MonacoLifecycleBoundary>
            <>
            {activeFileType === 'image' ? (
              <ImagePreview path={activeFile.path} />
            ) : activeFileType === 'video' ? (
              <VideoPreview path={activeFile.path} />
            ) : activeFileType === 'model3d' ? (
              <Model3DPreview path={activeFile.path} />
            ) : activeFileType === 'pdf' ? (
              <PdfPreview path={activeFile.path} />
            ) : isOoAutoDocument ? (
              /* v2.4.2：Word/PPT/Excel 等 Office 文档默认接入 ONLYOFFICE 在线编辑，启动失败自动回退本地预览 */
              <OnlyOfficeAutoHost filePath={activeFile.path} title={getFileName(activeFile.path)}>
                {activeFileType === 'docx' ? (
                  <DocxPreview path={activeFile.path} />
                ) : activeFileType === 'doc' ? (
                  <DocPreview path={activeFile.path} />
                ) : activeFileType === 'pptx' ? (
                  <Suspense fallback={<CodeSkeleton lines={8} />}>
                    <WorkspacePptxPreview path={activeFile.path} />
                  </Suspense>
                ) : activeFileType === 'ppt' ? (
                  <PptPreview path={activeFile.path} />
                ) : activeFileType === 'csv' ? (
                  <CsvPreview path={activeFile.path} content={activeFile.content} />
                ) : (
                  <XlsxFileView path={activeFile.path} />
                )}
              </OnlyOfficeAutoHost>
            ) : activeFileType === 'binary' ? (
              <UnsupportedFile path={activeFile.path} fileType="binary" />
            ) : isPlanJsonFile(activeFile.path) ? (
              <ExecutionBoard planId={getPlanIdFromPlanFilePath(activeFile.path)} />
            ) : activeFileType === 'markdown' && markdownMode === 'preview' ? (
              <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} isStreaming={isFileStreaming} />
            ) : activeFileType === 'markdown' && markdownMode === 'split' ? (
              <div className="flex h-full">
                <div className="flex-1 border-r border-border">
                  <MonacoEditor
                    height="100%"
                    key={activeFile.path}
                    path={monaco.Uri.file(activeFile.path).toString()}
                    language={activeLanguage}
                    defaultValue={activeFile.content}
                    theme="aweeclaw-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value === undefined) return
                      // 外部补丁写进模型时触发的变更不是用户编辑：内容本就来自 store，
                      // 只把最新内容同步给语言服务，不回流 store
                      if (applyingExternalEditRef.current) {
                        if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                        return
                      }
                      lastLocalEditRef.current = value
                      updateFileContent(activeFile.path, value)
                      if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                    }}
                    loading={<CodeSkeleton lines={12} />}
                    options={splitMonacoOptions}
                  />
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} isStreaming={isFileStreaming} />
                </div>
              </div>
            ) : activeFileType === 'html' && htmlMode === 'preview' ? (
              <HtmlPreview content={activeFile.content} filePath={activeFile.path} />
            ) : activeFileType === 'html' && htmlMode === 'split' ? (
              <div className="flex h-full">
                <div className="flex-1 border-r border-border">
                  <MonacoEditor
                    height="100%"
                    key={activeFile.path}
                    path={monaco.Uri.file(activeFile.path).toString()}
                    language={activeLanguage}
                    defaultValue={activeFile.content}
                    theme="aweeclaw-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value === undefined) return
                      // 外部补丁写进模型时触发的变更不是用户编辑：内容本就来自 store，
                      // 只把最新内容同步给语言服务，不回流 store
                      if (applyingExternalEditRef.current) {
                        if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                        return
                      }
                      lastLocalEditRef.current = value
                      updateFileContent(activeFile.path, value)
                      if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                    }}
                    loading={<CodeSkeleton lines={12} />}
                    options={splitMonacoOptions}
                  />
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <HtmlPreview content={activeFile.content} filePath={activeFile.path} />
                </div>
              </div>
            ) : activeFile.originalContent !== undefined ? (
              <SafeDiffEditor
                language={activeLanguage}
                original={activeFile.originalContent}
                modified={activeFile.content}
                onMount={(editor, monacoInstance) => {
                  const modifiedEditor = editor.getModifiedEditor()
                  editorRef.current = modifiedEditor
                  monacoRef.current = monacoInstance
                  setActiveEditorInstance(modifiedEditor)
                  modifiedEditor.onDidChangeModelContent(() => {
                    updateFileContent(activeFile.path, modifiedEditor.getValue())
                  })
                }}
                options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, fontLigatures: true, renderSideBySide: true, readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              />
            ) : (
              /* 非受控挂载（defaultValue）：内容由 Monaco 模型自身持有。
                 外部写入（AI 编辑 / 磁盘重载 / LRU 补载）由外部内容同步 effect
                 以最小差异补丁写回模型，不做整篇替换，因此不闪动、不丢光标与撤销栈。 */
              <MonacoEditor
                height="100%"
                key={activeFile.path}
                path={monaco.Uri.file(activeFile.path).toString()}
                language={editorLanguage}
                defaultValue={activeFile.content}
                theme="aweeclaw-dynamic"
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                onChange={(value) => {
                  if (value === undefined) return
                  // 外部补丁写进模型时触发的变更不是用户编辑：内容本就来自 store，
                  // 只把最新内容同步给语言服务，不标脏、不自动保存
                  if (applyingExternalEditRef.current) {
                    if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                    return
                  }
                  lastLocalEditRef.current = value
                  updateFileContent(activeFile.path, value)
                  if (!isLargeActiveFile) scheduleLspSync(activeFile.path, value)
                  triggerAutoSave(activeFile.path)
                }}
                loading={<CodeSkeleton lines={12} />}
                options={monacoOptions}
              />
            )}
            </>
          </MonacoLifecycleBoundary>
        )}

        {contextMenu && editorRef.current && (
          <EditorContextMenu x={contextMenu.x} y={contextMenu.y} editor={editorRef.current} onClose={() => setContextMenu(null)} />
        )}

        {/* Git 行级历史与还原（编辑器右键菜单 → 行级历史） */}
        {lineHistoryRequest && (
          <GitLineHistoryPanel
            request={lineHistoryRequest}
            onRestore={handleLineHistoryRestore}
            onClose={() => setLineHistoryRequest(null)}
          />
        )}

        {/* 多定义 Quick Pick：符号存在多个定义时由 F12 / Ctrl+Click 唤起 */}
        {definitionPicker && (
          <DefinitionQuickPick
            items={definitionPicker.items}
            position={definitionPicker.position}
            onSelect={(item: DefinitionCandidate) => {
              setDefinitionPicker(null)
              void revealLocation({ filePath: item.filePath, line: item.line, column: item.column })
            }}
            onClose={() => setDefinitionPicker(null)}
          />
        )}
      </div>

      <Suspense fallback={null}>
        <DockPanel />
      </Suspense>

      {tabContextMenu && (
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          filePath={tabContextMenu.filePath}
          onClose={() => setTabContextMenu(null)}
          onCloseFile={closeFileWithConfirm}
          onCloseOthers={closeOtherFiles}
          onCloseAll={closeAllFiles}
          onCloseToRight={closeFilesToRight}
          onSave={saveFile}
          isDirty={isContextMenuFileDirty || false}
          language={language}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 场景感知编辑器策略                                                */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景编辑器策略 */
export interface ScenarioEditorPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否启用文档预览 */
  enableDocumentPreview: boolean
  /** 是否启用 HTML 模式 */
  enableHtmlMode: boolean
  /** 是否启用写作工作区 */
  enableWritingWorkspace: boolean
  /** 是否启用自动保存 */
  enableAutoSave: boolean
  /** 自动保存延迟（毫秒） */
  autoSaveDelayMs: number
  /** 是否启用格式化 */
  enableFormatOnSave: boolean
  /** 是否启用内联 Diff */
  enableInlineDiff: boolean
  /** 最大文件大小（MB） */
  maxFileSizeMB: number
  /** 是否启用 AI 补全 */
  enableAICompletion: boolean
  /** 是否启用审计日志 */
  enableAudit: boolean
}

/** 场景编辑器策略预设 */
const SCENARIO_EDITOR_POLICIES: Record<ScenarioDomain, ScenarioEditorPolicy> = {
  /** 法律场景：启用文档预览，禁用自动保存，启用审计 */
  legal: {
    domain: 'legal',
    enableDocumentPreview: true,
    enableHtmlMode: false,
    enableWritingWorkspace: false,
    enableAutoSave: false,
    autoSaveDelayMs: 0,
    enableFormatOnSave: false,
    enableInlineDiff: true,
    maxFileSizeMB: 2,
    enableAICompletion: false,
    enableAudit: true,
  },

  /** 医疗场景：启用文档预览，禁用自动保存和 AI 补全 */
  medical: {
    domain: 'medical',
    enableDocumentPreview: true,
    enableHtmlMode: false,
    enableWritingWorkspace: false,
    enableAutoSave: false,
    autoSaveDelayMs: 0,
    enableFormatOnSave: false,
    enableInlineDiff: true,
    maxFileSizeMB: 2,
    enableAICompletion: false,
    enableAudit: true,
  },

  /** 教育场景：启用所有功能 */
  education: {
    domain: 'education',
    enableDocumentPreview: true,
    enableHtmlMode: true,
    enableWritingWorkspace: true,
    enableAutoSave: true,
    autoSaveDelayMs: 1000,
    enableFormatOnSave: true,
    enableInlineDiff: true,
    maxFileSizeMB: 5,
    enableAICompletion: true,
    enableAudit: false,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    enableDocumentPreview: true,
    enableHtmlMode: true,
    enableWritingWorkspace: true,
    enableAutoSave: false,
    autoSaveDelayMs: 1000,
    enableFormatOnSave: false,
    enableInlineDiff: true,
    maxFileSizeMB: 5,
    enableAICompletion: true,
    enableAudit: false,
  },
}

/**
 * 获取场景编辑器策略
 */
export function getScenarioEditorPolicy(domain: ScenarioDomain): ScenarioEditorPolicy {
  return SCENARIO_EDITOR_POLICIES[domain]
}

/**
 * 检查文件大小是否允许
 */
export function isFileSizeAllowed(
  sizeBytes: number,
  domain: ScenarioDomain,
): boolean {
  const policy = SCENARIO_EDITOR_POLICIES[domain]
  const sizeMB = sizeBytes / (1024 * 1024)
  return sizeMB <= policy.maxFileSizeMB
}

/**
 * 检查是否启用自动保存
 */
export function isAutoSaveEnabled(domain: ScenarioDomain): boolean {
  return SCENARIO_EDITOR_POLICIES[domain].enableAutoSave
}

/**
 * 检查是否启用 AI 补全
 */
export function isAICompletionEnabled(domain: ScenarioDomain): boolean {
  return SCENARIO_EDITOR_POLICIES[domain].enableAICompletion
}
