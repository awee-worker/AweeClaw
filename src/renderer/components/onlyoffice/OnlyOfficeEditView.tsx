/**
 * ONLYOFFICE 在线编辑视图（主窗口内嵌 Tab，kind='oo-edit'）
 *
 * 结构：
 * - 顶部工具条：会话标题 + 服务器 + 「刷新」「保存」「放弃」
 * - 主体：webview 加载 {ds}/oo-gw/demo.html?file=…（服务端注入 JWT 签名 config）
 *
 * 保存链路：
 *   「保存」→ 主进程 force save + 下载结果 → 原子写回本地源文件
 *
 * 实时同步：
 *   本地源文件被外部改写（AI 重新生成、其它程序保存）→ 主进程文件监听推送 file:changed
 *   → 重新上传并复用同一 sessionId，webview 指向新副本，编辑区内容随文件更新。
 *
 * 安全：文件字节只在主进程流转；本组件仅持 editorUrl 与会话元信息。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { PenLine, Save, XCircle, ExternalLink, Loader2, AlertCircle, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { buildOoEditPath, type OnlyOfficeEditSessionMeta } from '@shared/protocols/onlyOfficeProtocol'
import { getFileName } from '@shared/toolkit/pathHelper'
import { toast } from '@components/foundation/NotificationProvider'
import { BROWSER_AI_EDIT_EVENT, buildDocAiEditPrompt } from '@components/workspace-editor/browser/aiEditPrompt'
import OoAiEditPanel from './OoAiEditPanel'

interface OnlyOfficeEditViewProps {
  session: OnlyOfficeEditSessionMeta
}

/** 路径归一化比较：忽略大小写与分隔符差异 */
function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

/**
 * 保存回写本身会触发文件变更事件，这段窗口内忽略自动刷新
 *
 * 窗口不能太短：刷新会重新上传并生成新的 document.key，编辑器被换掉后
 * 主进程记录的会话与页面上正在编辑的会话就对不上了，接着保存必然报
 * 「会话已失效」。保存后至少要留够文件监听把事件送完的时间。
 */
const SELF_SAVE_SUPPRESS_MS = 10_000
/** 一次写入常触发多个文件事件，去抖后再刷新 */
const REFRESH_DEBOUNCE_MS = 600
/** 等待选中时的轮询间隔与次数上限（约 60 秒） */
const SELECTION_POLL_MS = 900
const SELECTION_POLL_MAX = 66

interface ToolButtonProps {
  /** 悬停时显示的说明文字 */
  label: string
  onClick: () => void
  disabled?: boolean
  /** 带文字的按钮（放弃 / 保存），默认只有图标 */
  textual?: boolean
  /** 主按钮样式（保存） */
  primary?: boolean
  /** 处于激活态（等待选中） */
  active?: boolean
  children: ReactNode
}

/**
 * 工具条按钮：悬停显示自定义说明气泡
 *
 * 用原生 title 会有一秒左右的延迟、样式也跟随系统，和这套 UI 不搭，
 * 所以自己画一个定位在按钮下方、右对齐（右侧按钮不会溢出容器）。
 */
function ToolButton({
  label,
  onClick,
  disabled,
  textual,
  primary,
  active,
  children,
}: ToolButtonProps) {
  const [hovered, setHovered] = useState(false)
  const tone = primary
    ? 'font-medium text-white bg-accent hover:opacity-90'
    : active
      ? 'text-accent bg-accent/10'
      : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className={`flex items-center gap-1 rounded-lg transition-colors disabled:opacity-50 ${
          textual ? 'px-2.5 h-7 text-xs' : 'p-1.5'
        } ${tone}`}
      >
        {children}
      </button>
      {hovered && (
        <span className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-secondary shadow-md">
          {label}
        </span>
      )}
    </div>
  )
}

export default function OnlyOfficeEditView({ session }: OnlyOfficeEditViewProps) {
  // 演示文稿没有文档光标，选中单元是形状（文本框或图形），提示语与文档不同
  const isSlideDoc = session.ext === 'ppt' || session.ext === 'pptx'
  /** 提示语里指代「要选的东西」：文档是文字，演示文稿是文本框或图形 */
  const selectionHint = isSlideDoc ? '文本框或图形' : '文字'
  const closeFile = useStore((s) => s.closeFile)
  const openOnlyOfficeEdit = useStore((s) => s.openOnlyOfficeEdit)
  const [busy, setBusy] = useState<'saving' | 'discarding' | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refreshing, setRefreshing] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressUntilRef = useRef(0)
  const refreshingRef = useRef(false)
  /** 编辑器 guest 的 webContents id（快捷键 / 选区读写入口） */
  const [guestId, setGuestId] = useState<number | null>(null)
  /** AI 修改面板里的原文：null 表示面板关闭 */
  const [aiSource, setAiSource] = useState<string | null>(null)
  /** 是否处于「等待用户在文档里选中文字」阶段 */
  const [awaitingSelection, setAwaitingSelection] = useState(false)
  const tabPath = buildOoEditPath(session.sessionId)
  const fileName = getFileName(session.sourcePath)

  // webview 加载状态跟踪
  // webview 加载状态跟踪 + guest 绑定
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onReady = () => {
      setLoadState('ready')
      // guest 就绪后才能拿到 webContents id：快捷键拦截与选区读写都要用它
      let id: number | null = null
      try {
        id = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId() : null
      } catch {
        id = null
      }
      setGuestId(id)
      const bind = api.onlyOffice?.bindSaveShortcut
      if (id !== null && typeof bind === 'function') {
        void bind(id).catch(() => undefined)
      }
    }
    const onFail = () => setLoadState('error')
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [])

  /**
   * 拉取源文件最新内容并重建远端副本。
   * sessionId 保持复用，只替换 editorUrl / remoteName，所以 Tab 身份不会变。
   */
  const refreshFromSource = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const res = await api.onlyOffice.refreshSession({
        sessionId: session.sessionId,
        sourcePath: session.sourcePath,
        title: session.title,
      })
      if (res?.ok && res.session) {
        openOnlyOfficeEdit(res.session, { activate: false })
      }
    } catch {
      /* 网关异常时保留当前画面，等下一次文件变更再试 */
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [session.sessionId, session.sourcePath, session.title, openOnlyOfficeEdit])

  /** 手动刷新：跳过屏蔽窗口，立即同步一次 */
  const handleManualRefresh = useCallback(() => {
    suppressUntilRef.current = 0
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    void refreshFromSource()
  }, [refreshFromSource])

  // 源文件被外部改写 → 去抖后自动重新上传，编辑区跟随文件更新
  useEffect(() => {
    const subscribe = api.file?.onChanged
    if (typeof subscribe !== 'function') return
    const off = subscribe((evt) => {
      if (!evt?.path) return
      if (evt.event !== 'update' && evt.event !== 'create') return
      if (!samePath(evt.path, session.sourcePath)) return
      if (Date.now() < suppressUntilRef.current) return
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        if (Date.now() < suppressUntilRef.current) return
        void refreshFromSource()
      }, REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off?.()
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [session.sourcePath, refreshFromSource])

  /** 保存：主进程 force save → 下载 → 原子写回本地源文件（不关闭，可继续编辑后再次保存） */
  const handleSave = async () => {
    if (busy) return
    setBusy('saving')
    try {
      const res = await api.onlyOffice.saveSession(session.sessionId)
      if (!res?.ok) throw new Error(res?.error || '保存失败')
      // 写回会触发文件变更事件：短期内屏蔽自动刷新，避免刚保存就被自己重开一遍
      suppressUntilRef.current = Date.now() + SELF_SAVE_SUPPRESS_MS
      toast.success(`已保存并回写本地：${fileName}`)
    } catch (err) {
      const message = (err as Error)?.message || '未知错误'
      toast.error(`保存回写失败：${message}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * 编辑器快捷键：Cmd/Ctrl+S 直接保存
   *
   * 编辑器跑在 webview 的独立渲染进程里，宿主页面收不到它的按键，所以由主进程
   * before-input-event 拦截后回推事件；这里只管把事件落到最新的保存逻辑上。
   */
  const saveRef = useRef<() => void>(() => {})
  saveRef.current = () => {
    void handleSave()
  }

  useEffect(() => {
    const subscribe = api.onlyOffice?.onSaveShortcut
    if (typeof subscribe !== 'function') return
    const off = subscribe(() => saveRef.current())
    return () => off?.()
  }, [])

  /**
   * AI 修改入口：先点按钮进入「等待选中」，用户在文档里选好文字后自动弹出面板
   *
   * 让选择发生在用户自己的节奏里——点了按钮再去划选，比「先记住要选哪一段、
   * 再回头找按钮」自然。再次点击按钮即取消。
   */
  const handleToggleAIEdit = () => {
    if (aiSource !== null) {
      setAiSource(null)
      return
    }
    if (awaitingSelection) {
      setAwaitingSelection(false)
      return
    }
    if (guestId === null) {
      toast.error('编辑器尚未就绪，请稍候再试')
      return
    }
    setAwaitingSelection(true)
    // 点按钮会把焦点从编辑区拿走，先还回去，用户接着划选才有效
    try {
      webviewRef.current?.focus?.()
    } catch {
      /* 视图已卸载等场景忽略 */
    }
  }

  /**
   * 等待选中：轮询读选区，读到内容就打开面板
   *
   * 文档是 canvas，拿不到浏览器的 selection 事件，主进程读选区又是走剪贴板
   * （读后会把用户原内容还原），所以只能定频轮询，不能挂在事件上。
   */
  useEffect(() => {
    if (!awaitingSelection || guestId === null) return

    let cancelled = false
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (cancelled) return
      tries += 1
      try {
        const res = await api.onlyOffice.readSelection(guestId)
        if (cancelled) return
        // ok !== true 是真实失败（连接器不可用、格式不支持等），继续轮询只是白等
        if (res && res.ok === false) {
          setAwaitingSelection(false)
          toast.error(res.error || '读取选中内容失败')
          return
        }
        const text = res?.ok ? (res.text || '').trim() : ''
        if (text) {
          setAwaitingSelection(false)
          setAiSource(text)
          return
        }
        // 选中了但没文字：图形本身没有文本体，读出来就是空串。这种情况要立刻
        // 打开面板让人直接写内容，不能当成「还没选中」接着等。
        if (isSlideDoc && res?.ok && res.selected) {
          setAwaitingSelection(false)
          if (res.editable) {
            setAiSource('')
          } else {
            toast.error('选中的对象不支持写入文字（如图片），请改选文本框或图形')
          }
          return
        }
      } catch {
        /* 读失败按「还没选中」处理，继续等 */
      }
      if (tries >= SELECTION_POLL_MAX) {
        setAwaitingSelection(false)
        toast.error(`等待选中超时，请重新点击 AI 修改后再选中${selectionHint}`)
        return
      }
      timer = setTimeout(tick, SELECTION_POLL_MS)
    }

    timer = setTimeout(tick, SELECTION_POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [awaitingSelection, guestId, selectionHint])

  /** 应用修改：把文本粘贴回编辑器选区 */
  const handleApplyAIEdit = async (text: string) => {
    if (guestId === null) return
    try {
      const res = await api.onlyOffice.replaceSelection(guestId, text)
      if (!res?.ok) {
        toast.error(res?.error || '写回选区失败')
        return
      }
      setAiSource(null)
      toast.success(
        isSlideDoc
          ? '已替换选中文本框的内容，并重新选中该形状'
          : '已替换选中的内容，修改会在保存时回写本地',
      )
    } catch (err) {
      toast.error(`写回选区失败：${(err as Error)?.message || '未知错误'}`)
    }
  }

  /** 让 AI 改写：把原文与要求交给会话，结果回到对话里 */
  const handleAskAI = (instruction: string, draft: string) => {
    const prompt = buildDocAiEditPrompt({
      fileName,
      sourceText: draft || aiSource || '',
      instruction,
    })
    window.dispatchEvent(new CustomEvent(BROWSER_AI_EDIT_EVENT, { detail: { text: prompt } }))
    // 请求已经交出去了，面板继续拦在文档上只会挡住视线：用户此刻要看的是对话里的
    // 改写结果，回来时再点一次 AI 修改重新选段即可
    setAiSource(null)
    toast.success('已交给 AI，改写结果会出现在对话里')
  }

  /** 放弃：删除服务器端副本，不写回本地 */
  const handleDiscard = async () => {
    if (busy) return
    setBusy('discarding')
    try {
      const res = await api.onlyOffice.discardSession(session.sessionId)
      if (!res?.ok) {
        // 远端清理失败不阻塞关闭（网关 TTL 会自动回收）
        loggerWarn(res?.error)
      }
      closeFile(tabPath)
    } catch (err) {
      toast.error(`放弃会话失败：${(err as Error)?.message || '未知错误'}`)
      setBusy(null)
    }
  }

  const openExternal = () => {
    const { openExternalUrl } = api.file || ({} as any)
    if (openExternalUrl) openExternalUrl(session.editorUrl)
  }

  return (
    <div className="h-full flex flex-col bg-background-editor overflow-hidden">
      {/* 顶部工具条 */}
      <div className="flex items-center gap-2 px-3 h-11 border-b border-border flex-shrink-0">
        <PenLine className="w-4 h-4 text-accent flex-shrink-0" />
        <span className="text-[13px] text-text-primary truncate flex-1">{fileName}</span>

        <ToolButton
          label={awaitingSelection ? '等待选中，再点一次取消' : `点击后选中${selectionHint}，让 AI 改写并替换`}
          onClick={handleToggleAIEdit}
          active={awaitingSelection || aiSource !== null}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </ToolButton>

        <ToolButton label="重新载入本地文件的最新内容" onClick={handleManualRefresh} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </ToolButton>

        <ToolButton label="在浏览器中打开" onClick={openExternal}>
          <ExternalLink className="w-3.5 h-3.5" />
        </ToolButton>

        <ToolButton
          label="放弃修改，删除服务器副本并关闭（本地文件不变）"
          onClick={handleDiscard}
          disabled={busy !== null}
          textual
        >
          {busy === 'discarding' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
          放弃
        </ToolButton>
        <ToolButton
          label="强制保存：下载编辑结果并回写本地原文件（不关闭，可继续编辑）"
          onClick={handleSave}
          disabled={busy !== null}
          textual
          primary
        >
          {busy === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          保存
        </ToolButton>
      </div>

      {/* webview 编辑区 */}
      <div className="flex-1 relative min-h-0">
        <webview
          ref={webviewRef}
          src={session.editorUrl}
          title={session.title}
          className="w-full h-full border-0 bg-white"
        />

        {/* 等待选中提示条：点按钮后先等用户在文档里划选 */}
        {awaitingSelection && (
          <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
            <span className="text-[11px] text-text-secondary">
              请在文档中选中要修改的{selectionHint}，选中后自动打开编辑面板
            </span>
            <button
              type="button"
              onClick={() => setAwaitingSelection(false)}
              className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              取消
            </button>
          </div>
        )}

        {/* AI 修改浮层：改的是编辑器里的文字选区 */}
        {aiSource !== null && (
          <OoAiEditPanel
            sourceText={aiSource}
            onClose={() => setAiSource(null)}
            onApply={handleApplyAIEdit}
            onAskAI={handleAskAI}
          />
        )}
        {refreshing && (
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface/95 border border-border shadow-sm pointer-events-none">
            <Loader2 className="w-3 h-3 text-accent animate-spin" />
            <span className="text-[11px] text-text-muted">正在同步最新内容…</span>
          </div>
        )}
        {loadState === 'loading' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background-editor">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <span className="text-xs text-text-muted">正在加载 ONLYOFFICE 编辑器…</span>
            </div>
          </div>
        )}
        {loadState === 'error' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background-editor">
            <div className="text-center p-8 max-w-sm">
              <AlertCircle className="w-8 h-8 text-status-warning mx-auto mb-4" />
              <p className="text-sm text-text-secondary mb-2">编辑器加载失败</p>
              <p className="text-xs text-text-muted break-all">{session.editorUrl}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 轻量日志（不引入额外依赖） */
function loggerWarn(message?: string): void {
  if (!message) return
  try {
    // eslint-disable-next-line no-console
    console.warn('[OnlyOffice]', message)
  } catch {
    /* ignore */
  }
}
