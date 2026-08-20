/**
 * 文件编辑器骨架（FileEditorShell）
 *
 * 通用文件编辑器组件，封装「项目选中 → 文件路径选择 → 加载内容 → 编辑 → 保存」流程。
 * 三个专用编辑器（PromptEditor / ScriptEditor / DbScriptEditor）通过传入不同的
 * 预设文件列表与扩展名约束，复用本组件的能力。
 *
 * 数据流：
 *   选中项目 → scenarioBuilderReadFile（按文件路径读取）
 *   → textarea 编辑
 *   → scenarioBuilderWriteFile 写回（含 createDirs 自动创建目录）
 *
 * 设计要点：
 * - 文件路径下拉展示预设列表 + 自由输入（兜底场景：用户自定义文件名）
 * - 切换文件前如有改动则提示确认
 * - 字体 ≥ 12px，代码区使用 Menlo/Monaco 等宽字体
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import SnippetDrawer, { type SnippetInsertPayload } from './SnippetDrawer'
import {
  Save,
  Check,
  AlertTriangle,
  RefreshCw,
  FileText,
  FolderOpen,
  Plus,
  ChevronDown,
  Code2,
} from 'lucide-react'

// ==========================================
// Props
// ==========================================

interface FileEditorShellProps {
  /** 编辑器标题（如"提示词编辑器"） */
  title: string
  /** 编辑器副标题/提示文案 */
  tip?: string
  /** 预设文件列表（用户可从下拉中选择，也允许自定义输入） */
  presetFiles: string[]
  /** 默认选中的文件（首次加载） */
  defaultFile?: string
  /** 文件扩展名约束（仅用于校验输入） */
  extension?: string
  /** 文件路径输入 placeholder */
  filePathPlaceholder?: string
  /** textarea placeholder */
  contentPlaceholder?: string
  /** textarea 最小高度（px） */
  minHeight?: number
  /** 图标名（lucide-react） */
  icon?: string
}

// ==========================================
// 主组件
// ==========================================

const FileEditorShell: React.FC<FileEditorShellProps> = ({
  title,
  tip,
  presetFiles,
  defaultFile,
  extension,
  filePathPlaceholder,
  contentPlaceholder,
  minHeight = 400,
}) => {
  const { t } = useI18n()
  const { project } = useSelectedProject()

  // 当前编辑的文件路径
  const [filePath, setFilePath] = useState<string>(defaultFile ?? '')
  // 文件内容
  const [content, setContent] = useState<string>('')
  // 上次保存的内容（用于 dirty 判定）
  const savedContentRef = useRef<string>('')
  // 加载 / 保存状态
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')
  // 下拉是否展开
  const [dropdownOpen, setDropdownOpen] = useState(false)
  // 代码片段抽屉
  const [snippetDrawerOpen, setSnippetDrawerOpen] = useState(false)
  // 片段插入后短暂提示
  const [snippetToast, setSnippetToast] = useState<string>('')
  // textarea ref（用于光标定位）
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 片段插入提示 3 秒后清除
  useEffect(() => {
    if (snippetToast) {
      const timer = setTimeout(() => setSnippetToast(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [snippetToast])

  // ==========================================
  // 加载文件
  // ==========================================

  const loadFile = useCallback(
    async (path: string): Promise<boolean> => {
      if (!project || !path) return false
      setLoading(true)
      setError('')
      try {
        const electronAPI = (window as any).electronAPI
        if (!electronAPI?.scenarioBuilderReadFile) {
          throw new Error('IPC scenarioBuilderReadFile not available')
        }
        const result = await electronAPI.scenarioBuilderReadFile({
          projectPath: project.localPath,
          relativePath: path,
        })
        // 文件不存在：保持空内容，让用户编辑后保存即可创建
        if (!result?.success) {
          setContent('')
          savedContentRef.current = ''
          return true
        }
        setContent(result.content ?? '')
        savedContentRef.current = result.content ?? ''
        return true
      } catch (err) {
        setError((err as Error).message || t('builder.fileEditor.loadFailed'))
        return false
      } finally {
        setLoading(false)
      }
    },
    [project, t],
  )

  // 项目变化时，加载默认文件
  useEffect(() => {
    if (!project) {
      setFilePath(defaultFile ?? '')
      setContent('')
      savedContentRef.current = ''
      return
    }
    const target = filePath || defaultFile || presetFiles[0] || ''
    if (target) {
      setFilePath(target)
      void loadFile(target)
    }
    // 仅在 project 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // 切换文件路径
  const handleFileChange = useCallback(
    async (nextPath: string) => {
      // 切换前如有改动则确认
      if (content !== savedContentRef.current && !window.confirm(t('builder.fileEditor.confirmDiscard'))) {
        return
      }
      setFilePath(nextPath)
      await loadFile(nextPath)
      setDropdownOpen(false)
    },
    [content, loadFile, t],
  )

  // ==========================================
  // 保存
  // ==========================================

  const handleSave = useCallback(async () => {
    if (!project || !filePath) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const electronAPI = (window as any).electronAPI
      if (!electronAPI?.scenarioBuilderWriteFile) {
        throw new Error('IPC scenarioBuilderWriteFile not available')
      }
      const result = await electronAPI.scenarioBuilderWriteFile({
        projectPath: project.localPath,
        relativePath: filePath,
        content,
        createDirs: true,
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Write failed')
      }
      savedContentRef.current = content
      setSuccess(t('builder.fileEditor.saved'))
    } catch (err) {
      setError((err as Error).message || t('builder.fileEditor.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [project, filePath, content, t])

  // 成功提示 3 秒后清除
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  // ==========================================
  // 内容编辑
  // ==========================================

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
  }, [])

  // 新建文件：清空内容，保留路径
  const handleNewFile = useCallback(() => {
    if (content !== savedContentRef.current && !window.confirm(t('builder.fileEditor.confirmDiscard'))) {
      return
    }
    setContent('')
    savedContentRef.current = ''
  }, [content, t])

  // 重新加载
  const handleReload = useCallback(() => {
    if (filePath) {
      void loadFile(filePath)
    }
  }, [filePath, loadFile])

  // ==========================================
  // 代码片段插入
  // ==========================================

  /**
   * 处理 SnippetDrawer 的插入请求
   *
   * 三种模式：
   *  - insert_at_cursor：在当前 textarea 光标位置插入
   *  - append_file：追加到当前文件末尾
   *  - replace_file：替换整个文件内容
   *
   * 若目标文件与当前编辑文件不一致，则切换到目标文件后再插入
   * （切换时如有改动会先保存，避免丢失编辑）
   */
  const handleSnippetInsert = useCallback(
    (payload: SnippetInsertPayload) => {
      const { code, mode, targetFile } = payload

      // 1. 目标文件与当前文件不同：先切换
      if (targetFile && targetFile !== filePath) {
        // 切换前如有改动，先保存
        if (content !== savedContentRef.current) {
          void handleSave()
        }
        // 切换到目标文件
        setFilePath(targetFile)
        void loadFile(targetFile).then((ok) => {
          if (!ok) return
          // 加载完成后按 mode 处理
          if (mode === 'replace_file') {
            setContent(code)
            savedContentRef.current = ''
            setSnippetToast(t('builder.snippet.inserted') + ' → ' + targetFile)
          } else if (mode === 'append_file') {
            // loadFile 设置了 content；这里通过 setContent 追加
            // 注意：使用函数式更新读取最新 state
            setContent((prev) => (prev ? prev + '\n' + code : code))
            savedContentRef.current = ''
            setSnippetToast(t('builder.snippet.inserted') + ' → ' + targetFile)
          } else {
            // insert_at_cursor：切换到新文件后光标在开头，等价于 prepend
            setContent((prev) => (prev ? code + '\n' + prev : code))
            savedContentRef.current = ''
            setSnippetToast(t('builder.snippet.inserted') + ' → ' + targetFile)
          }
        })
        return
      }

      // 2. 同一文件内插入
      if (mode === 'replace_file') {
        setContent(code)
        setSnippetToast(t('builder.snippet.inserted'))
      } else if (mode === 'append_file') {
        setContent((prev) => (prev ? prev + '\n' + code : code))
        setSnippetToast(t('builder.snippet.inserted'))
      } else {
        // insert_at_cursor
        const textarea = textareaRef.current
        if (!textarea) {
          // 兜底：追加到末尾
          setContent((prev) => (prev ? prev + '\n' + code : code))
          setSnippetToast(t('builder.snippet.inserted'))
          return
        }
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const current = textarea.value
        const newContent = current.substring(0, start) + code + current.substring(end)
        setContent(newContent)
        // 移动光标到插入内容末尾
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + code.length
            textareaRef.current.focus()
          }
        }, 0)
        setSnippetToast(t('builder.snippet.inserted'))
      }
    },
    [filePath, content, handleSave, loadFile, t],
  )

  // ==========================================
  // 派生状态
  // ==========================================

  const dirty = content !== savedContentRef.current
  const canSave = useMemo(() => {
    return !!project && !!filePath && !saving && dirty
  }, [project, filePath, saving, dirty])

  // 扩展名校验
  const extensionMismatch = useMemo(() => {
    if (!extension || !filePath) return false
    return !filePath.toLowerCase().endsWith(extension.toLowerCase())
  }, [extension, filePath])

  // ==========================================
  // 渲染
  // ==========================================

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">{t('builder.fileEditor.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部标题栏 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
          <h2 className="truncate text-[13px] font-medium">{title}</h2>
        </div>
        {tip && (
          <p className="px-3 pb-1.5 text-[12px] text-muted-foreground/70">{tip}</p>
        )}

        {/* 文件路径选择行 */}
        <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
          <div className="relative flex-1">
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              onBlur={() => {
                if (filePath && content === savedContentRef.current) {
                  void loadFile(filePath)
                }
              }}
              placeholder={filePathPlaceholder || t('builder.fileEditor.filePathPlaceholder')}
              className={`w-full rounded border bg-background px-2 py-1.5 pr-7 font-mono text-[12px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-accent/30 ${
                extensionMismatch
                  ? 'border-destructive/60'
                  : 'border-border focus:border-accent/50'
              }`}
            />
            {/* 下拉切换按钮 */}
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('builder.fileEditor.selectFile')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {/* 下拉列表 */}
            {dropdownOpen && (
              <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-background py-1 shadow-lg">
                {presetFiles.map((f) => (
                  <li key={f}>
                    <button
                      type="button"
                      onClick={() => handleFileChange(f)}
                      className={`block w-full truncate px-2 py-1 text-left font-mono text-[12px] transition-colors hover:bg-muted/60 ${
                        f === filePath ? 'text-accent' : 'text-foreground/90'
                      }`}
                      title={f}
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* 加载 */}
          <button
            onClick={handleReload}
            disabled={loading || !filePath}
            className="shrink-0 rounded border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
            title={t('builder.fileEditor.loadFile')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {/* 新建 */}
          <button
            onClick={handleNewFile}
            className="shrink-0 rounded border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            title={t('builder.fileEditor.newFile')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {/* 代码片段 */}
          <button
            type="button"
            onClick={() => setSnippetDrawerOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t('builder.snippet.open')}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('builder.snippet.title')}</span>
          </button>
          {/* 保存 */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex shrink-0 items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent"
            title={t('builder.fileEditor.save')}
          >
            <Save className="h-3 w-3" />
            {saving ? t('builder.fileEditor.saving') : t('builder.fileEditor.save')}
          </button>
        </div>
      </div>

      {/* ========== 状态提示 ========== */}
      {(error || success || snippetToast || extensionMismatch || (dirty && !error)) && (
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
          {error && (
            <div className="flex items-center gap-1.5 text-[12px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          {success && !error && (
            <div className="flex items-center gap-1.5 text-[12px] text-emerald-600">
              <Check className="h-3 w-3 shrink-0" />
              <span className="truncate">{success}</span>
            </div>
          )}
          {snippetToast && !error && !success && (
            <div className="flex items-center gap-1.5 text-[12px] text-accent">
              <Code2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{snippetToast}</span>
            </div>
          )}
          {extensionMismatch && !error && (
            <div className="flex items-center gap-1.5 text-[12px] text-yellow-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {t('builder.fileEditor.filePath')}：{filePath}
              </span>
            </div>
          )}
          {dirty && !error && !success && !snippetToast && (
            <div className="flex items-center gap-1.5 text-[12px] text-yellow-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>{t('builder.fileEditor.dirty')}</span>
            </div>
          )}
        </div>
      )}

      {/* ========== 文本编辑区 ========== */}
      <div className="flex-1 overflow-hidden">
        {filePath ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            spellCheck={false}
            placeholder={contentPlaceholder || ''}
            className="w-full resize-none border-0 bg-background p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none"
            style={{ minHeight: `${minHeight}px`, height: '100%' }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-[12px] text-muted-foreground">{t('builder.fileEditor.fileEmpty')}</p>
          </div>
        )}
      </div>

      {/* ========== 代码片段抽屉 ========== */}
      <SnippetDrawer
        open={snippetDrawerOpen}
        onClose={() => setSnippetDrawerOpen(false)}
        currentFilePath={filePath}
        onInsert={handleSnippetInsert}
      />
    </div>
  )
}

export default FileEditorShell
