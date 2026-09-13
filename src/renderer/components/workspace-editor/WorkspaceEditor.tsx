/**
 * 编辑器主组件
 */
import { useRef, useCallback, useEffect, useState, Suspense, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import MonacoEditor, { OnMount, BeforeMount, loader } from '@monaco-editor/react'
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
import { getFileInfo } from '@services/largeFileAdapter'
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
import { safeLazy, safeNamedLazy } from '@renderer/utils/safeImport'

// 子组件（通过 safeLazy 加载，场景卸载时不会崩溃）
const EditorTabs = safeNamedLazy(() => import('./EditorTabBar'), 'EditorTabs', { label: 'EditorTabs', silent: true })
const EditorBreadcrumbs = safeNamedLazy(() => import('./EditorPathNav'), 'EditorBreadcrumbs', { label: 'EditorBreadcrumbs', silent: true })
const InlineEdit = safeLazy(() => import('./InlineCodeEdit'), { label: 'InlineCodeEdit', silent: true })
const EditorContextMenu = safeLazy(() => import('./CodeEditorMenu'), { label: 'EditorContextMenu', silent: true })
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

// Hooks
import { useEditorActions, useAICompletion, useEditorEvents, useComposerInlineDiff } from './DevAssistantBridge'
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

  const { pendingChanges, acceptChange, undoChange } = useAgentChangeState()

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const setFileScrollPosition = useStore((state) => state.setFileScrollPosition)

  // Hooks
  const { registerProviders, setupDiagnostics, setupLinkNavigation, notifyFileOpened } = useLspIntegration()
  const { saveFile, closeFileWithConfirm, closeOtherFiles, closeAllFiles, closeFilesToRight, triggerAutoSave } = useFileSave()
  const { isLinting, runLintCheck, clearLintErrors, errorCount, warningCount } = useLintCheck()
  const { setupCursorTracking } = useEditorEvents(editorRef)

  const isPreviewDocument = Boolean(activeFile && (activeFile.kind === 'preview' || isPreviewDocumentPath(activeFile.path)))
  // v2.3：PPT 预览 Tab（主窗口内嵌模式）
  const isPptPreviewTab = Boolean(activeFile && activeFile.kind === 'ppt-preview' && isPptPreviewPath(activeFile.path))
  const pptPreviewSessionId = isPptPreviewTab && activeFile ? extractSessionIdFromPptPreviewPath(activeFile.path) : null

  // v2.4：ONLYOFFICE 在线编辑 Tab（主窗口内嵌模式）
  const isOoEditTab = Boolean(activeFile && activeFile.kind === 'oo-edit' && isOoEditPath(activeFile.path))
  const ooEditSession = isOoEditTab && activeFile?.ooEdit ? activeFile.ooEdit : null

  /** 启动 ONLYOFFICE 在线编辑会话：主进程上传本地文件 → 打开编辑 Tab（成功后关闭本地 file Tab，只保留 oo-edit Tab） */
  const handleOnlyOfficeEdit = async (filePath: string) => {
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
  }



  useComposerInlineDiff(isPreviewDocument ? null : activeFilePath, editorRef.current, monacoRef.current)

  const { registerActions } = useEditorActions(setInlineEditState)
  const { registerProvider: registerAIProvider } = useAICompletion(isPreviewDocument ? null : activeFilePath)

  const activeLanguage = activeFile && !isPreviewDocument ? getLanguage(activeFile.path) : 'plaintext'
  const activeFileType = activeFile && !isPreviewDocument ? getFileType(activeFile.path) : 'text'
  const activeFileInfo = (activeFile && activeFile.content != null) ? getFileInfo(activeFile.path, activeFile.content) : null
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
    if (activeFile && activeFile.content != null && !isPreviewDocument) {
      notifyFileOpened(activeFile.path, activeFile.content)
      // 检查是否有跨文件跳转定义的待定位请求
      const nav = consumePendingNavigation(activeFile.path)
      if (nav && editorRef.current) {
        setTimeout(() => {
          editorRef.current?.setPosition({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.revealPositionInCenter({ lineNumber: nav.line, column: nav.col })
          editorRef.current?.focus()
        }, 80)
      }
    }
  }, [activeFilePath, activeFile, clearLintErrors, notifyFileOpened, isPreviewDocument])

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
    if (!editorRef.current || !activeFile || isPreviewDocument) return
    if (!activeFile.content) return

    // 仅对文档类型文件启用自动滚动
    const isDocumentFile = (filePath: string): boolean => {
      const DOCUMENT_EXTENSIONS = new Set([
        'md', 'mdx', 'txt', 'rst', 'adoc', 'asciidoc',
        'html', 'htm', 'css', 'json', 'yaml', 'yml', 'xml',
        'csv', 'tsv', 'log', 'ini', 'conf', 'config',
        'dockerfile', 'makefile', 'gitignore', 'gitattributes',
        'env', 'properties', 'toml',
      ])
      const lowerPath = filePath.toLowerCase()
      const baseName = lowerPath.split(/[/\\]/).pop() || ''
      if (DOCUMENT_EXTENSIONS.has(baseName)) return true
      const ext = lowerPath.split('.').pop() || ''
      return DOCUMENT_EXTENSIONS.has(ext)
    }

    if (!isDocumentFile(activeFile.path)) return

    // 文件内容被外部更新（非用户手动编辑）时滚动到底部
    if (!activeFile.isDirty) {
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
    const scrollDisposable = editor.onDidScrollChange(() => {
      if (currentFilePath && typeof editor.saveViewState === 'function') {
        const state = editor.saveViewState()
        setFileScrollPosition(currentFilePath, state as any)
      }
    })
    disposables.push(scrollDisposable)

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
        const currentVersionId = model.getAlternativeVersionId()
        const editorContent = editor.getValue()
        const { openFiles: currentFiles } = useStore.getState()
        const currentFile = currentFiles.find(f => f.path === currentFilePath)

        if (currentFile && editorContent === currentFile.content) {
          markFileSaved(currentFilePath, currentVersionId)
        } else {
          updateFileDirtyState(currentFilePath, currentVersionId)
        }
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
        onContextMenu={(e: React.MouseEvent, path: string) => setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: path })}
        lintErrorCount={errorCount}
        lintWarningCount={warningCount}
        isLinting={isLinting}
        onRunLint={handleRunLint}
        onOnlyOfficeEdit={handleOnlyOfficeEdit}
        activeFileKind={activeFile?.kind}
        activeFileType={activeFileType}
        viewMode={activeFileType === 'markdown' ? markdownMode : activeFileType === 'html' ? htmlMode : undefined}
        onViewModeChange={(mode: 'edit' | 'preview' | 'split') => {
          if (activeFileType === 'markdown') setMarkdownMode(mode)
          else if (activeFileType === 'html') setHtmlMode(mode)
        }}
      />

      {activeFile && !isPreviewDocument && !isPptPreviewTab && !isOoEditTab && (
        <EditorBreadcrumbs
          filePath={activeFile.path}
          largeFileInfo={activeFileInfo}
          language={language}
        />
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
        {/* v2.4：ONLYOFFICE 在线编辑（主窗口内嵌 Tab） */}
        {isOoEditTab && ooEditSession ? (
          <OnlyOfficeEditView session={ooEditSession} />
        ) : isPptPreviewTab && pptPreviewSessionId ? (
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
                    value={activeFile.content}
                    theme="aweeclaw-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value !== undefined) {
                        updateFileContent(activeFile.path, value)
                        didChangeDocument(activeFile.path, value)
                      }
                    }}
                    loading={<CodeSkeleton lines={12} />}
                    options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, contextmenu: false }}
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
                    value={activeFile.content}
                    theme="aweeclaw-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value !== undefined) {
                        updateFileContent(activeFile.path, value)
                        didChangeDocument(activeFile.path, value)
                      }
                    }}
                    loading={<CodeSkeleton lines={12} />}
                    options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, contextmenu: false }}
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
                  modifiedEditor.onDidChangeModelContent(() => {
                    updateFileContent(activeFile.path, modifiedEditor.getValue())
                  })
                }}
                options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, fontLigatures: true, renderSideBySide: true, readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false }}
              />
            ) : (
              <MonacoEditor
                height="100%"
                key={activeFile.path}
                path={monaco.Uri.file(activeFile.path).toString()}
                language={activeLanguage}
                value={activeFile.content}
                theme="aweeclaw-dynamic"
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                onChange={(value) => {
                  if (value !== undefined) {
                    updateFileContent(activeFile.path, value)
                    didChangeDocument(activeFile.path, value)
                    triggerAutoSave(activeFile.path)
                  }
                }}
                loading={<CodeSkeleton lines={12} />}
                options={getMonacoEditorOptions(activeFileInfo)}
              />
            )}
          </>
        )}

        {contextMenu && editorRef.current && (
          <EditorContextMenu x={contextMenu.x} y={contextMenu.y} editor={editorRef.current} onClose={() => setContextMenu(null)} />
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
