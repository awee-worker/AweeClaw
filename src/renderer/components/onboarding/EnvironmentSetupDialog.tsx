/**
 * 环境检测与安装弹窗
 *
 * 首次启动完成引导后弹出，检测 Python/uv/Node 三项核心运行时：
 * - 全部就绪：自动关闭，不打扰用户
 * - 有缺失项：展示"一键安装"、"后台安装"和"跳过"按钮
 * - 安装中：显示进度条 + 阶段文案
 *
 * 跳过后写入 environmentCheckCompleted=true，不再自动弹出，
 * 用户仍可在设置 → 环境管理中手动检测/安装。
 *
 * 后台安装：关闭弹窗但继续后台安装，顶部"新对话"按钮前出现状态提示。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@renderer/adapters/electronBridge'
import { useStore } from '@store'
import { logger } from '@toolkit/LogEngine'

// 主进程类型（通过 import type 跨进程引用类型，不引入运行时代码）
type RuntimeCheckItem = { ready: boolean; path?: string; version?: string; source: string }
type EnvironmentStatus = {
  python: RuntimeCheckItem
  uv: RuntimeCheckItem
  node: RuntimeCheckItem
  allReady: boolean
}

type InstallProgressEvent = {
  id: 'python' | 'uv' | 'node'
  stage: 'downloading' | 'installing' | 'configuring' | 'done' | 'error'
  percent: number
  message: string
}

interface EnvironmentSetupDialogProps {
  /** 关闭回调（用户跳过或安装完成后调用） */
  onComplete: () => void
}

// 单个运行时的展示配置
const RUNTIME_META = {
  python: { nameZh: 'Python', nameEn: 'Python', descZh: 'AI 脚本执行、数据分析', descEn: 'AI script execution, data analysis' },
  uv: { nameZh: 'uv 包管理器', nameEn: 'uv Package Manager', descZh: '插件安装、MCP 工具依赖', descEn: 'Plugin install, MCP tool deps' },
  node: { nameZh: 'Node.js', nameEn: 'Node.js', descZh: 'MCP 插件启动、终端命令', descEn: 'MCP plugin launch, terminal cmds' },
} as const

type RuntimeId = keyof typeof RUNTIME_META

export default function EnvironmentSetupDialog({ onComplete }: EnvironmentSetupDialogProps) {
  const language = useStore((s) => s.language)
  const isZh = language !== 'en'
  const setEnvInstallStatus = useStore((s) => s.setEnvInstallStatus)

  const [status, setStatus] = useState<EnvironmentStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<Record<RuntimeId, InstallProgressEvent | null>>({
    python: null,
    uv: null,
    node: null,
  })
  const [error, setError] = useState<string | null>(null)
  const dialogClosedRef = useRef(false)

  /** 检测环境状态 */
  const checkEnvironment = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await api.environment.environmentCheck()
      if (result.success) {
        setStatus(result.status)
      } else {
        setError(isZh ? '检测失败，请稍后重试' : 'Check failed, please retry')
      }
    } catch (err) {
      logger.system.error('[EnvironmentSetupDialog] check failed:', err)
      setError(isZh ? '检测失败，请稍后重试' : 'Check failed, please retry')
    } finally {
      setChecking(false)
    }
  }, [isZh])

  // 进入时检测
  useEffect(() => {
    void checkEnvironment()
  }, [checkEnvironment])

  // 订阅安装进度
  useEffect(() => {
    const off = api.environment.onEnvironmentProgress((event: InstallProgressEvent) => {
      setProgress((prev) => ({ ...prev, [event.id]: event }))
      
      // 同步更新后台安装状态
      setEnvInstallStatus((prev) => {
        const newProgress = { ...prev.progress, [event.id]: event }
        // 计算整体进度
        const values = Object.values(newProgress).filter(Boolean)
        const avgPercent = values.length > 0 
          ? Math.round(values.reduce((sum, p) => sum + p.percent, 0) / values.length)
          : prev.percent
        
        return {
          ...prev,
          progress: newProgress,
          percent: avgPercent,
          activeId: event.id,
          message: event.message || prev.message,
          state: event.stage === 'done' ? 'done' : event.stage === 'error' ? 'error' : 'installing',
        }
      })
    })
    return off
  }, [setEnvInstallStatus])

  // 检测完成且全部就绪：自动关闭（不打扰用户）
  useEffect(() => {
    if (!checking && status?.allReady && !installing && !dialogClosedRef.current) {
      dialogClosedRef.current = true
      // 标记完成，避免下次启动再弹
      useStore.getState().set('environmentCheckCompleted', true)
      // 短暂展示"全部就绪"后自动关闭
      const timer = setTimeout(onComplete, 800)
      return () => clearTimeout(timer)
    }
  }, [checking, status, installing, onComplete])

  /** 后台安装所有缺失项（关闭弹窗，继续后台安装） */
  const handleBackgroundInstall = useCallback(async () => {
    setInstalling(true)
    setError(null)
    setProgress({ python: null, uv: null, node: null })
    
    // 设置后台安装状态
    setEnvInstallStatus({
      state: 'installing',
      isInstalling: true,
      percent: 0,
      message: isZh ? '正在后台安装环境...' : 'Installing environment in background...',
    })

    try {
      const result = await api.environment.environmentInstallAll()
      
      // 更新最终状态
      if (result.success && result.status.allReady) {
        setEnvInstallStatus({
          state: 'done',
          isInstalling: false,
          percent: 100,
          message: isZh ? '环境安装完成！' : 'Environment setup complete!',
        })
        useStore.getState().set('environmentCheckCompleted', true)
      } else if (!result.status.allReady) {
        setEnvInstallStatus({
          state: 'error',
          isInstalling: false,
          message: isZh ? '部分环境安装失败，可到设置 → 环境管理 中重试' : 'Some environments failed, retry in Settings → Environment',
        })
        setStatus(result.status)
      }
    } catch (err) {
      logger.system.error('[EnvironmentSetupDialog] background install failed:', err)
      setEnvInstallStatus({
        state: 'error',
        isInstalling: false,
        message: isZh ? '安装失败，请稍后重试' : 'Install failed, please retry',
      })
      setError(isZh ? '安装失败，请稍后重试' : 'Install failed, please retry')
    } finally {
      setInstalling(false)
      // 立即关闭弹窗
      dialogClosedRef.current = true
      onComplete()
    }
  }, [isZh, onComplete, setEnvInstallStatus])

  /** 一键安装所有缺失项（保持弹窗打开） */
  const handleInstallAll = useCallback(async () => {
    setInstalling(true)
    setError(null)
    setProgress({ python: null, uv: null, node: null })

    try {
      const result = await api.environment.environmentInstallAll()
      if (result.success && result.status.allReady) {
        // 安装成功，标记完成并关闭
        useStore.getState().set('environmentCheckCompleted', true)
        dialogClosedRef.current = true
        setTimeout(onComplete, 500)
      } else if (!result.status.allReady) {
        // 部分失败：引导用户去 设置 → 系统设置 → 环境管理
        setError(isZh ? '部分环境安装失败，可到 设置 → 系统设置 → 环境管理 中重试' : 'Some environments failed to install, retry in Settings → System → Environment')
        setStatus(result.status)
      }
    } catch (err) {
      logger.system.error('[EnvironmentSetupDialog] installAll failed:', err)
      setError(isZh ? '安装失败，请稍后重试' : 'Install failed, please retry')
    } finally {
      setInstalling(false)
    }
  }, [isZh, onComplete])

  /** 跳过 */
  const handleSkip = useCallback(() => {
    useStore.getState().set('environmentCheckCompleted', true)
    dialogClosedRef.current = true
    onComplete()
  }, [onComplete])

  /** 渲染单个运行时状态行 */
  const renderRuntimeRow = (id: RuntimeId) => {
    const meta = RUNTIME_META[id]
    const itemStatus = status?.[id]
    const itemProgress = progress[id]
    const isThisInstalling = installing && itemProgress && itemProgress.stage !== 'done' && itemProgress.stage !== 'error'
    const isReady = itemStatus?.ready
    const hasError = itemProgress?.stage === 'error'

    return (
      <div
        key={id}
        className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface/50"
      >
        {/* 状态图标 */}
        <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0">
          {checking ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full"
            />
          ) : isReady ? (
            <div className="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : hasError ? (
            <div className="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : isThisInstalling ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-amber-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          )}
        </div>

        {/* 名称 + 描述 */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary">
            {isZh ? meta.nameZh : meta.nameEn}
          </div>
          <div className="text-xs text-text-muted truncate">
            {isZh ? meta.descZh : meta.descEn}
          </div>
          {/* 安装中显示进度文案 */}
          {isThisInstalling && itemProgress && (
            <div className="text-xs text-accent mt-0.5 truncate">{itemProgress.message}</div>
          )}
          {/* 已就绪显示版本 */}
          {isReady && itemStatus?.version && (
            <div className="text-xs text-text-muted/70 mt-0.5">v{itemStatus.version}</div>
          )}
          {/* 失败显示错误 */}
          {hasError && itemProgress && (
            <div className="text-xs text-red-500 mt-0.5 truncate">{itemProgress.message}</div>
          )}
        </div>

        {/* 右侧状态标签 */}
        <div className="flex-shrink-0">
          {checking ? (
            <span className="text-xs text-text-muted">{isZh ? '检测中' : 'Checking'}</span>
          ) : isReady ? (
            <span className="text-xs text-green-500 font-medium">{isZh ? '已就绪' : 'Ready'}</span>
          ) : hasError ? (
            <span className="text-xs text-red-500">{isZh ? '失败' : 'Failed'}</span>
          ) : isThisInstalling ? (
            <span className="text-xs text-accent">{isZh ? '安装中' : 'Installing'}</span>
          ) : (
            <span className="text-xs text-amber-500">{isZh ? '缺失' : 'Missing'}</span>
          )}
        </div>
      </div>
    )
  }

  const allReady = status?.allReady

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden"
        >
          {/* 标题区 */}
          <div className="px-6 pt-6 pb-4">
            <h2 className="text-xl font-bold text-text-primary mb-1">
              {isZh ? '运行环境检测' : 'Runtime Environment Check'}
            </h2>
            <p className="text-sm text-text-muted">
              {allReady
                ? isZh ? '所有核心运行时已就绪' : 'All core runtimes are ready'
                : isZh
                  ? '检测 AI 功能所需的核心运行时环境'
                  : 'Check core runtimes required for AI features'}
            </p>
          </div>

          {/* 环境列表 */}
          <div className="px-6 pb-4 space-y-2">
            {renderRuntimeRow('python')}
            {renderRuntimeRow('uv')}
            {renderRuntimeRow('node')}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="px-6 pb-3">
              <div className="text-xs text-red-500 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </div>
            </div>
          )}

          {/* 全部就绪时的成功提示 */}
          {allReady && !installing && (
            <div className="px-6 pb-3">
              <div className="flex items-center gap-2 text-sm text-green-500 bg-green-500/10 rounded-md px-3 py-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {isZh ? '环境检测完成，即将进入应用' : 'Environment check complete, entering app'}
              </div>
            </div>
          )}

          {/* 按钮区 */}
          <div className="px-6 pb-6 pt-2 flex flex-col gap-2">
            {!allReady && (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={handleInstallAll}
                    disabled={installing || checking}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {installing
                      ? isZh ? '安装中...' : 'Installing...'
                      : isZh ? '一键安装（保持弹窗）' : 'Install (Stay)'}
                  </button>
                  <button
                    onClick={handleBackgroundInstall}
                    disabled={installing || checking}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-surface-active text-text-secondary text-sm font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-border"
                  >
                    {isZh ? '后台安装' : 'Background Install'}
                  </button>
                </div>
                <button
                  onClick={handleSkip}
                  disabled={installing}
                  className="w-full px-4 py-2 rounded-lg text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  {isZh ? '跳过，我稍后再安装' : 'Skip, install later'}
                </button>
              </>
            )}
            {allReady && (
              <button
                onClick={handleSkip}
                className="w-full px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                {isZh ? '进入应用' : 'Enter App'}
              </button>
            )}
          </div>

          {/* 跳过说明 */}
          {!allReady && (
            <div className="px-6 pb-4 -mt-1">
              <p className="text-xs text-text-muted/60 text-center">
                {isZh
                  ? '跳过后可在 设置 → 系统设置 → 环境管理 中手动安装'
                  : 'Can install later in Settings → System → Environment'}
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
