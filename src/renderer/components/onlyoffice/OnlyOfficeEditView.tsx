/**
 * ONLYOFFICE 在线编辑视图（主窗口内嵌 Tab，kind='oo-edit'）
 *
 * 结构：
 * - 顶部工具条：会话标题 + 服务器 + 「保存」「放弃」
 * - 主体：webview 加载 {ds}/oo-gw/demo.html?file=…（服务端注入 JWT 签名 config）
 *
 * 保存链路：
 *   「保存」→ 主进程 force save + 下载结果 → 原子写回本地源文件
 *   → 不关闭当前 Tab，可继续编辑；「放弃」或关闭 Tab 才结束会话
 *
 * 安全：文件字节只在主进程流转；本组件仅持 editorUrl 与会话元信息。
 */
import { useEffect, useRef, useState } from 'react'
import { PenLine, Save, XCircle, ExternalLink, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import {
  buildOoEditPath,
  type OnlyOfficeEditSessionMeta,
} from '@shared/protocols/onlyOfficeProtocol'
import { getFileName } from '@shared/toolkit/pathHelper'
import { toast } from '@components/foundation/NotificationProvider'

interface OnlyOfficeEditViewProps {
  session: OnlyOfficeEditSessionMeta
}

export default function OnlyOfficeEditView({ session }: OnlyOfficeEditViewProps) {
  const closeFile = useStore((s) => s.closeFile)
  const [busy, setBusy] = useState<'saving' | 'discarding' | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)

  const tabPath = buildOoEditPath(session.sessionId)
  const fileName = getFileName(session.sourcePath)

  // webview 加载状态跟踪
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onReady = () => setLoadState('ready')
    const onFail = () => setLoadState('error')
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [])

  /** 保存：主进程 force save → 下载 → 原子写回本地源文件（不关闭，可继续编辑后再次保存） */
  const handleSave = async () => {
    if (busy) return
    setBusy('saving')
    try {
      const res = await api.onlyOffice.saveSession(session.sessionId)
      if (!res?.ok) throw new Error(res?.error || '保存失败')
      toast.success(`已保存并回写本地：${fileName}`)
    } catch (err) {
      const message = (err as Error)?.message || '未知错误'
      toast.error(`保存回写失败：${message}`)
    } finally {
      setBusy(null)
    }
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
        <span className="text-[13px] text-text-primary truncate flex-1">
          {fileName}
          <span className="ml-2 text-text-muted/70 text-xs font-normal">
            ONLYOFFICE 在线编辑 · {session.serverUrl.replace(/^https?:\/\//, '')}
          </span>
        </span>

        <a
          href="#"
          onClick={(e) => { e.preventDefault(); openExternal() }}
          className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
          title="在浏览器中打开"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>

        <button
          onClick={handleDiscard}
          disabled={busy !== null}
          className="flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
          title="放弃修改，删除服务器副本并关闭（本地文件不变）"
        >
          {busy === 'discarding' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
          放弃
        </button>
        <button
          onClick={handleSave}
          disabled={busy !== null}
          className="flex items-center gap-1 px-3 h-7 rounded-lg text-xs font-medium text-white bg-accent hover:opacity-90 transition-opacity disabled:opacity-50"
          title="触发强制保存，下载结果并回写本地原文件（不关闭，可继续编辑）"
        >
          {busy === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          保存
        </button>
      </div>

      {/* webview 编辑区 */}
      <div className="flex-1 relative min-h-0">
        <webview
          ref={webviewRef}
          src={session.editorUrl}
          title={session.title}
          className="w-full h-full border-0 bg-white"
        />
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
