/**
 * 预览会话同步 Hook
 *
 * 集中管理：
 * - 订阅 previewSessionService，获取当前 sessionId 对应的 session
 * - 地址栏输入态（addressInput）与 session.url 的同步
 * - 提交导航（走 previewSessionService.navigate，保持单向数据流）
 * - 新建标签页（forceNew 创建独立会话，不复用同 URL 已有会话）
 *
 * 将这些副作用从视图组件中抽离，使 BrowserPreviewTab 仅做编排。
 */
import { useEffect, useMemo, useState } from 'react'
import type { OpenFile } from '@store'
import type { PreviewSession } from '@shared/protocols/previewProtocol'
import { useStore } from '@store'
import { previewSessionService } from '@/renderer/preview/previewSessionManager'
import { devServerDiscoveryService } from '@/renderer/preview/devServerLocator'

/** 将用户输入规整为合法 http(s) URL，无协议时补 http:// */
export function sanitizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

/** 新标签页默认主页 */
const NEW_TAB_HOMEPAGE = 'https://www.google.com'

export interface PreviewSessionSync {
  /** 当前会话（可能为 null，表示空状态） */
  session: PreviewSession | null
  /** 地址栏输入值 */
  addressInput: string
  /** 设置地址栏输入值 */
  setAddressInput: (value: string) => void
  /** 提交导航：规整 URL 后走 previewSessionService.navigate */
  commitNavigation: (url: string) => void
  /** 还原地址栏为当前 session.url（Esc 键） */
  resetAddress: () => void
  /** 新建标签页：强制创建新会话并激活，不复用同 URL 已有会话 */
  openNewTab: () => void
}

export function usePreviewSessionSync(file: OpenFile): PreviewSessionSync {
  const workspace = useStore((state) => state.workspace)
  const preview = file.preview
  const initialSession = preview ? previewSessionService.getSession(preview.sessionId) : null

  const [session, setSession] = useState<PreviewSession | null>(initialSession)
  const [addressInput, setAddressInput] = useState(initialSession?.url || preview?.url || '')

  // 预览元数据变化时恢复会话（切换 preview tab）
  useEffect(() => {
    if (!preview) return
    previewSessionService.restoreSession(preview)
    const restored = previewSessionService.getSession(preview.sessionId)
    setSession(restored)
    setAddressInput(restored?.url || preview.url)
  }, [preview])

  // 订阅 service 状态变化，同步当前 session 与地址栏
  useEffect(() => {
    return previewSessionService.subscribe((state) => {
      if (!preview?.sessionId) return
      const next = state.sessions.find((item) => item.id === preview.sessionId) || null
      setSession(next)
      // 仅在非聚焦输入态时跟随更新，避免用户输入被覆盖
      if (next && document.activeElement?.tagName !== 'INPUT') {
        setAddressInput(next.url)
      }
    })
  }, [preview?.sessionId])

  // 工作区根变化时刷新本地服务发现（供 openPreferredPreview 等使用）
  useEffect(() => {
    if (workspace?.roots?.length) {
      void devServerDiscoveryService.refresh(workspace.roots)
    }
  }, [workspace?.roots])

  const commitNavigation = useMemo(
    () => (url: string) => {
      if (!preview?.sessionId) return
      const next = sanitizeUrl(url)
      if (!next) return
      previewSessionService.navigate(preview.sessionId, next)
      setAddressInput(next)
    },
    [preview?.sessionId],
  )

  const resetAddress = useMemo(
    () => () => {
      setAddressInput(session?.url || preview?.url || '')
    },
    [session?.url, preview?.url],
  )

  const openNewTab = useMemo(
    () => () => {
      // forceNew 确保每次点击都创建新会话（新编辑器 tab），不复用同 URL 已有会话
      previewSessionService.openUrl(NEW_TAB_HOMEPAGE, {
        title: 'New Tab',
        source: 'manual',
        activate: true,
        forceNew: true,
      })
    },
    [],
  )

  return {
    session,
    addressInput,
    setAddressInput,
    commitNavigation,
    resetAddress,
    openNewTab,
  }
}
