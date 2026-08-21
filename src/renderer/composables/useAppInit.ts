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
import { useSceneModeEffects } from '@hooks/useSceneModeEffects'
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
  // 注册场景模式副作用（悬浮头像颜色切换等）
  useSceneModeEffects()

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
    let loaderRemoved = false

    /** 移除加载动画（仅一次） */
    const removeLoaderOnce = () => {
      if (loaderRemoved) return
      loaderRemoved = true
      handleRemoveLoader()
    }

    api.appReady()

    const runInit = async () => {
      let result: { success: boolean; shouldShowOnboarding: boolean; error?: string }

      try {
        // onWorkspaceReady 回调：workspace 绑定后立即移除 loader，
        // 让用户尽快看到主界面，后续 restoreWorkspaceAgentStore 在后台继续
        result = await initializeApp(handleLoaderStatus, removeLoaderOnce)
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

      // 兜底：无 workspace（首次使用）或 onWorkspaceReady 未触发时，
      // initializeApp 完成后移除 loader
      removeLoaderOnce()

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
