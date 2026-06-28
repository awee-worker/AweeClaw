/**
 * 调试面板（试运行）
 *
 * 将当前选中项目临时加载到客户端，无需正式安装即可预览效果。
 * - 试运行：调用 scenario-builder:tryRunStart IPC，将项目路径注册到主进程
 * - 停止：调用 scenario-builder:tryRunStop IPC，从注册表移除
 * - 加载场景：通知客户端场景加载器从项目路径临时加载
 *
 * 设计要点：
 * - 试运行不修改 dist 目录，直接以源码加载（声明式）或运行 dist（编程式）
 * - 同一项目只能有一个试运行实例
 */
import { useState, useEffect, useCallback } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'

interface TryRunResult {
  success: boolean
  scenarioId?: string
  error?: string
}

interface TryRunStatus {
  running: boolean
  projectPath: string | null
}

const DebugPanel: React.FC = () => {
  const { t } = useI18n()
  const { project: selectedProject, refresh: refreshProject } = useSelectedProject()
  const [running, setRunning] = useState(false)
  const [runningScenarioId, setRunningScenarioId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string>('')

  // 拉取当前项目的试运行状态
  const refreshStatus = useCallback(async () => {
    if (!selectedProject) {
      setRunning(false)
      setRunningScenarioId(null)
      return
    }
    if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderTryRunStatus) {
      return
    }
    try {
      const status: TryRunStatus = await (window as any).electronAPI.scenarioBuilderTryRunStatus({
        scenarioId: selectedProject.scenarioId,
      })
      setRunning(status.running)
      if (status.running) {
        setRunningScenarioId(selectedProject.scenarioId)
      } else {
        setRunningScenarioId(null)
      }
    } catch (err) {
      console.warn('[DebugPanel] refreshStatus failed:', err)
    }
  }, [selectedProject])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const appendLog = (line: string) => {
    const ts = new Date().toLocaleTimeString()
    setLog((prev) => `${prev}[${ts}] ${line}\n`)
  }

  const handleStart = useCallback(async () => {
    if (!selectedProject) return
    setBusy(true)
    setError(null)
    try {
      appendLog(`启动试运行：${selectedProject.name} (${selectedProject.scenarioId})`)
      appendLog(`项目路径：${selectedProject.localPath}`)

      if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderTryRunStart) {
        throw new Error('Electron API not available')
      }

      const result: TryRunResult = await (window as any).electronAPI.scenarioBuilderTryRunStart({
        projectPath: selectedProject.localPath,
      })

      if (!result.success) {
        throw new Error(result.error || '试运行启动失败')
      }

      setRunningScenarioId(result.scenarioId || selectedProject.scenarioId)
      setRunning(true)
      appendLog(`✓ 试运行已启动，scenarioId=${result.scenarioId}`)

      // 通知客户端场景加载器加载该场景（可选，依赖客户端实现）
      if ((window as any).electronAPI?.scenarioTryRunLoad) {
        await (window as any).electronAPI.scenarioTryRunLoad({
          scenarioId: result.scenarioId,
          projectPath: selectedProject.localPath,
        })
        appendLog('✓ 已通知客户端场景加载器')
      }

      await refreshProject()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      appendLog(`✗ 启动失败：${msg}`)
    } finally {
      setBusy(false)
    }
  }, [selectedProject, refreshProject])

  const handleStop = useCallback(async () => {
    if (!runningScenarioId) return
    setBusy(true)
    setError(null)
    try {
      appendLog(`停止试运行：${runningScenarioId}`)

      if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderTryRunStop) {
        throw new Error('Electron API not available')
      }

      const result = await (window as any).electronAPI.scenarioBuilderTryRunStop({
        scenarioId: runningScenarioId,
      })

      if (!result.success) {
        throw new Error(result.error || '停止失败')
      }

      appendLog('✓ 试运行已停止')
      setRunning(false)
      setRunningScenarioId(null)
      await refreshProject()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      appendLog(`✗ 停止失败：${msg}`)
    } finally {
      setBusy(false)
    }
  }, [runningScenarioId, refreshProject])

  const handleClearLog = useCallback(() => {
    setLog('')
  }, [])

  if (!selectedProject) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-3">
          <h2 className="text-sm font-medium">{t('builder.debug.title')}</h2>
        </div>
        <div className="p-4 text-center text-xs text-muted-foreground">
          请先在项目列表中选择一个项目
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="border-b border-border p-3">
        <h2 className="text-sm font-medium">{t('builder.debug.title')}</h2>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t('builder.debug.description')}
        </p>
      </div>

      {/* 当前项目信息 */}
      <div className="border-b border-border p-3">
        <div className="text-xs text-muted-foreground">当前项目</div>
        <div className="mt-1 text-sm font-medium">{selectedProject.name}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
          {selectedProject.scenarioId} · v{selectedProject.version}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleStart}
            disabled={busy || running}
            className="flex-1 rounded bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? '处理中…' : running ? '运行中' : '启动试运行'}
          </button>
          <button
            onClick={handleStop}
            disabled={busy || !running}
            className="flex-1 rounded bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            停止试运行
          </button>
        </div>
        {running && (
          <div className="text-[10px] text-emerald-600">
            ✓ 试运行中（scenarioId: {runningScenarioId}）
          </div>
        )}
        {error && <div className="text-[10px] text-destructive">{error}</div>}
      </div>

      {/* 日志 */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-1">
          <span className="text-xs">运行日志</span>
          <button
            onClick={handleClearLog}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            清空
          </button>
        </div>
        <pre className="flex-1 overflow-auto bg-muted/30 p-2 text-[11px] font-mono whitespace-pre-wrap">
          {log || '暂无日志'}
        </pre>
      </div>

      {/* 说明 */}
      <div className="border-t border-border p-3 text-[10px] text-muted-foreground space-y-1">
        <div>• 试运行不会修改已安装场景列表</div>
        <div>• 声明式场景直接从项目路径加载 scenario.json</div>
        <div>• 编程式场景需要先构建（生成 dist/）再试运行</div>
        <div>• 停止试运行后会从临时注册表移除</div>
      </div>
    </div>
  )
}

export default DebugPanel
