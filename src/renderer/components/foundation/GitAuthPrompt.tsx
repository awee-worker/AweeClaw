/**
 * GitAuthPrompt — Git 凭证输入弹窗（全局单例）
 *
 * 触发场景（两类，行为一致）：
 *   1. 用户在版本控制面板点 push / pull，而远程需要账号密码
 *   2. AI 调用 git_sync 工具同步远程，而凭证缺失或已失效
 *
 * 交互约定：
 *   - 账号 / 密码（或 Personal Access Token）+「记住凭证」勾选
 *   - 用户取消或 120 秒无响应 → 返回 null，调用方按「已取消」处理，不重试
 *   - 明文只随 IPC 单次上行，主进程用 safeStorage 加密落盘，弹窗不保留任何副本
 *
 * 与 PromptOverlay 同模式（模块级 setState + Promise resolver），
 * 因此可在非 React 上下文（工具执行器、adapter）通过 `globalGitAuth` 调用。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'
import {
  setGitCredentialPromptHandler,
  type GitCredentialAnswer,
  type GitCredentialRequest,
} from '@services/gitAuthBridge'

/** 弹窗等待上限：用户长时间不响应时释放调用方（避免 AI 工具永久挂起） */
const AUTH_TIMEOUT_MS = 120_000

interface AuthState {
  isOpen: boolean
  request: GitCredentialRequest | null
}

let globalResolve: ((value: GitCredentialAnswer | null) => void) | null = null
let globalSetState: ((state: AuthState) => void) | null = null
let globalTimer: ReturnType<typeof setTimeout> | null = null

function settle(value: GitCredentialAnswer | null): void {
  if (globalTimer) {
    clearTimeout(globalTimer)
    globalTimer = null
  }
  const resolve = globalResolve
  globalResolve = null
  globalSetState?.({ isOpen: false, request: null })
  resolve?.(value)
}

/**
 * 全局函数：向用户索要 git 凭证
 *
 * @returns 用户填写的凭证；取消或超时返回 null
 */
export function globalGitAuth(request: GitCredentialRequest): Promise<GitCredentialAnswer | null> {
  return new Promise((resolve) => {
    if (!globalSetState) {
      resolve(null)
      return
    }
    globalResolve = resolve
    globalSetState({ isOpen: true, request })
    if (globalTimer) clearTimeout(globalTimer)
    globalTimer = setTimeout(() => settle(null), AUTH_TIMEOUT_MS)
  })
}

/** 全局凭证弹窗（需在应用根节点挂载一次） */
export function GlobalGitAuthOverlay() {
  const [state, setState] = useState<AuthState>({ isOpen: false, request: null })
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [remember, setRemember] = useState(true)
  const [showSecret, setShowSecret] = useState(false)

  const usernameRef = useRef<HTMLInputElement>(null)
  const language = useStore((s) => s.language) as Language
  // 「记住凭证」默认值来自设置 → Git 面板
  const rememberDefault = useStore(
    (s) => (s.editorConfig?.git?.rememberCredentials ?? true) as boolean,
  )

  // 注册到桥接模块：adapter / AI 工具据此唤起弹窗
  useEffect(() => {
    setGitCredentialPromptHandler((request) => globalGitAuth(request))
    return () => setGitCredentialPromptHandler(null)
  }, [])

  useEffect(() => {
    globalSetState = setState
    return () => {
      globalSetState = null
    }
  }, [])

  // 每次打开重置表单并聚焦用户名
  useEffect(() => {
    if (state.isOpen) {
      setUsername('')
      setSecret('')
      setRemember(rememberDefault)
      setShowSecret(false)
      requestAnimationFrame(() => usernameRef.current?.focus())
    }
  }, [state.isOpen, rememberDefault])

  const handleConfirm = useCallback(() => {
    const name = username.trim()
    if (!name || !secret) return
    settle({ username: name, secret, remember })
  }, [username, secret, remember])

  const handleCancel = useCallback(() => settle(null), [])

  const request = state.request
  const hostLabel = request?.host || (language === 'zh' ? '远程仓库' : 'remote repository')
  const tokenHint = request?.hint === 'token-required'

  if (!request) return null

  const zh = language === 'zh'

  return (
    <OverlayDialog
      isOpen={state.isOpen}
      onClose={handleCancel}
      title={zh ? 'Git 身份验证' : 'Git Authentication'}
      size="sm"
    >
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl text-amber-400 bg-amber-500/10 flex-shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 pt-1 space-y-3">
          <p className="text-sm text-text-secondary leading-relaxed">
            {(zh ? '远程仓库 ' : 'The remote repository ') + hostLabel + (zh ? ' 需要身份验证。' : ' requires authentication.')}
          </p>

          {tokenHint && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-300/90 leading-relaxed">
                {zh
                  ? '该平台已禁用密码认证，请输入 Personal Access Token（令牌）作为密码。'
                  : 'This platform disabled password authentication — enter a Personal Access Token as the password.'}
              </p>
            </div>
          )}

          {request.hasStoredCredential && !tokenHint && (
            <p className="text-xs text-text-muted">
              {zh ? '已保存的凭证可能已过期，请重新输入。' : 'Stored credentials may have expired — please re-enter them.'}
            </p>
          )}

          <div className="space-y-2">
            <label className="text-xs text-text-muted">{zh ? '用户名' : 'Username'}</label>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder="git@example.com"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-text-muted">
              {tokenHint ? (zh ? 'Personal Access Token' : 'Personal Access Token') : zh ? '密码 / 令牌' : 'Password / Token'}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleConfirm()
                  }
                }}
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full px-3 py-2 pr-10 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                tabIndex={-1}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border accent-[var(--accent)]"
            />
            <span className="text-xs text-text-secondary">
              {zh ? '记住凭证（本机加密保存）' : 'Remember credentials (encrypted locally)'}
            </span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <ActionButton variant="ghost" size="sm" onClick={handleCancel}>
          {t('cancel', language)}
        </ActionButton>
        <ActionButton
          variant="primary"
          size="sm"
          onClick={handleConfirm}
          disabled={!username.trim() || !secret}
        >
          {zh ? '确定并重试' : 'Confirm & Retry'}
        </ActionButton>
      </div>
    </OverlayDialog>
  )
}

export default GlobalGitAuthOverlay
