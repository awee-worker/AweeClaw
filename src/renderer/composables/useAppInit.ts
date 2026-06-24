/**
 * 应用初始化 Hook
 *
 * 执行应用启动流程：初始化核心服务、注册设置同步与错误监听，
 * 完成后移除加载动画并通知主进程。
 */

import { useCallback, useEffect, useRef } from 'react'
import { api } from '../adapters/electronBridge'
import {
  initializeApp,
  registerSettingsSync,
  registerAppErrorListener,
} from '@services/appInitializer'
import { initWorkspaceStateSync } from '@services/workspaceStateAdapter'
import { logger } from '@toolkit/LogEngine'

/** 初始化完成回调携带的结果 */
export interface InitResult {
  shouldShowOnboarding: boolean
}

/** Hook 配置 */
export interface UseAppInitOptions {
  onInitialized?: (result: InitResult) => void
}

/** 加载动画淡出持续时间 */
const LOADER_FADE_MS = 300

/** 更新加载动画状态文本 */
function setLoaderStatus(status: string): void {
  const statusEl = document.querySelector('#initial-loader .loader-status')
  if (statusEl) statusEl.textContent = status
}

/** 移除初始加载动画 */
function removeInitialLoader(): void {
  const loader = document.getElementById('initial-loader')
  const root = document.getElementById('root')

  if (root) root.classList.add('ready')

  if (loader) {
    requestAnimationFrame(() => {
      loader.classList.add('fade-out')
      window.setTimeout(() => loader.remove(), LOADER_FADE_MS)
    })
  }
}

export function useAppInit(options: UseAppInitOptions = {}): void {
  const initRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const handleLoaderStatus = useCallback((status: string) => {
    setLoaderStatus(status)
  }, [])

  const handleRemoveLoader = useCallback(() => {
    removeInitialLoader()
  }, [])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    let cancelled = false

    // 立即移除加载动画：React 已渲染，让用户先看到界面
    // initializeApp 在后台继续完成初始化
    handleRemoveLoader()
    api.appReady()

    const runInit = async () => {
      let result: { success: boolean; shouldShowOnboarding: boolean; error?: string }

      try {
        result = await initializeApp(handleLoaderStatus)
      } catch (initError) {
        logger.system.error('[useAppInit] initializeApp threw:', initError)
        result = { success: false, shouldShowOnboarding: false, error: String(initError) }
      }

      if (cancelled) return

      // 注册设置同步与错误监听，失败不阻塞
      try {
        const unsubscribeSettings = registerSettingsSync()
        window.__settingsUnsubscribe = unsubscribeSettings
      } catch (syncError) {
        logger.system.error('[useAppInit] registerSettingsSync failed:', syncError)
      }

      try {
        const unsubscribeError = registerAppErrorListener()
        window.__errorUnsubscribe = unsubscribeError
      } catch (listenerError) {
        logger.system.error('[useAppInit] registerAppErrorListener failed:', listenerError)
      }

      optionsRef.current.onInitialized?.(result)
    }

    void runInit()

    return () => {
      cancelled = true
      try {
        window.__settingsUnsubscribe?.()
      } catch (e) {
        logger.system.error('[useAppInit] settings unsubscribe failed:', e)
      }
      try {
        window.__errorUnsubscribe?.()
      } catch (e) {
        logger.system.error('[useAppInit] error unsubscribe failed:', e)
      }
    }
  }, [handleLoaderStatus, handleRemoveLoader])

  // 工作区状态同步（独立生命周期）
  useEffect(() => {
    return initWorkspaceStateSync()
  }, [])
}
