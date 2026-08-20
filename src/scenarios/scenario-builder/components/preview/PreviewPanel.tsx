/**
 * 预览面板（PreviewPanel）
 *
 * 整合 PreviewService 与 FileWatcherService，提供场景预览与热重载的完整 UI：
 * - 启动 / 停止预览（基于 tryRun IPC）
 * - 手动热重载按钮
 * - 自动热重载开关（开启后文件变化自动 restart）
 * - 文件监听状态展示
 * - 操作日志（start / stop / restart / fileChange）
 *
 * C3 改造：主区域改为 Tab 布局，5 个 Tab 分别为：
 *   - 状态：原状态徽章/预览信息/文件监听/操作日志（StatusTab）
 *   - 日志：实时日志拉取（LiveLogsTab）
 *   - 数据库：表结构 + 样本数据（DatabaseTab）
 *   - 工具调用：工具调用轨迹（ToolCallTraceTab）
 *   - 性能：性能指标（MetricsTab）
 *
 * 数据流：
 *   PreviewService  ←→  tryRun IPC + 调试数据 IPC（C1/C2 扩展）
 *   FileWatcherService  ←→  watchProject IPC + fileChange 事件
 *   文件变化 → 防抖 → (自动) previewService.restart()
 *
 * 设计要点：
 * - 字体 ≥ 12px
 * - 状态徽章用颜色区分：运行绿色、停止灰色、错误红色、启动黄色
 * - 操作日志使用等宽字体，可滚动
 * - Tab 切换栏紧凑，单行可显示全部 5 个 Tab
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type React from 'react'
import { useI18n } from '@renderer/i18n'
import { useSelectedProject } from '../../hooks/useSelectedProject'
import { previewService, fileWatcherService } from '../../services'
import type { PreviewState, WatchState, FileChangeEvent } from '../../services'
import {
  Play,
  Square,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FolderOpen,
  Zap,
  ZapOff,
  Activity,
  ListChecks,
  Database,
  Wrench,
  Gauge,
} from 'lucide-react'
import StatusTab, { type OpStatus, type OperationLogEntry } from './tabs/StatusTab'
import LiveLogsTab from './tabs/LiveLogsTab'
import DatabaseTab from './tabs/DatabaseTab'
import ToolCallTraceTab from './tabs/ToolCallTraceTab'
import MetricsTab from './tabs/MetricsTab'

// ==========================================
// 类型
// ==========================================

type TabId = 'status' | 'logs' | 'database' | 'toolCalls' | 'metrics'

interface TabDef {
  id: TabId
  labelKey: string
  icon: React.ReactNode
}

const TABS: TabDef[] = [
  { id: 'status', labelKey: 'builder.preview.tab.status', icon: <Activity className="h-3 w-3" /> },
  { id: 'logs', labelKey: 'builder.preview.tab.logs', icon: <ListChecks className="h-3 w-3" /> },
  { id: 'database', labelKey: 'builder.preview.tab.database', icon: <Database className="h-3 w-3" /> },
  { id: 'toolCalls', labelKey: 'builder.preview.tab.toolCalls', icon: <Wrench className="h-3 w-3" /> },
  { id: 'metrics', labelKey: 'builder.preview.tab.metrics', icon: <Gauge className="h-3 w-3" /> },
]

// ==========================================
// 主组件
// ==========================================

const PreviewPanel: React.FC = () => {
  const { t } = useI18n()
  const { project } = useSelectedProject()

  // 预览状态
  const [previewState, setPreviewState] = useState<PreviewState>(previewService.getState())
  // 监听状态
  const [watchState, setWatchState] = useState<WatchState>(fileWatcherService.getState())
  // 自动热重载开关
  const [autoReload, setAutoReload] = useState(true)
  // 操作中（防止重复点击）
  const [busy, setBusy] = useState(false)
  // 错误提示
  const [error, setError] = useState<string>('')
  // 成功提示
  const [success, setSuccess] = useState<string>('')
  // 操作日志（仅状态 Tab 使用）
  const [logs, setLogs] = useState<OperationLogEntry[]>([])
  // 运行时长（秒）
  const [duration, setDuration] = useState(0)
  // 当前激活 Tab
  const [activeTab, setActiveTab] = useState<TabId>('status')

  // ==========================================
  // 订阅服务状态
  // ==========================================

  useEffect(() => {
    const unsubPreview = previewService.subscribe((event) => {
      if (event.type === 'state-change') {
        setPreviewState(event.state)
      } else if (event.type === 'error') {
        appendLog('error', event.error)
      }
    })
    const unsubWatch = fileWatcherService.onStateChange((state) => {
      setWatchState(state)
    })
    const unsubFile = fileWatcherService.onFileChange((event: FileChangeEvent) => {
      appendLog('fileChange', `${t('builder.preview.fileChanged')}${event.relativePath}`)
      // 自动热重载
      if (autoReload && previewState.running) {
        void handleRestart(true)
      }
    })
    return () => {
      unsubPreview()
      unsubWatch()
      unsubFile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReload, previewState.running])

  // ==========================================
  // 项目变化：自动切换预览/监听目标
  // ==========================================

  useEffect(() => {
    if (!project) {
      // 切换到无项目：停止当前预览与监听
      void previewService.stop()
      void fileWatcherService.unwatch()
      return
    }
    // 切换到新项目：若预览运行中先停止
    if (previewState.running && previewState.projectPath !== project.localPath) {
      void previewService.stop()
    }
    if (watchState.watching && watchState.projectPath !== project.localPath) {
      void fileWatcherService.unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // ==========================================
  // 运行时长计时
  // ==========================================

  useEffect(() => {
    if (previewState.running && previewState.startedAt) {
      const startedAtMs = new Date(previewState.startedAt).getTime()
      const updateDuration = () => {
        const now = Date.now()
        setDuration(Math.max(0, Math.floor((now - startedAtMs) / 1000)))
      }
      updateDuration()
      const timer = setInterval(updateDuration, 1000)
      return () => clearInterval(timer)
    } else {
      setDuration(0)
    }
  }, [previewState.running, previewState.startedAt])

  // 成功提示 3 秒后清除
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  // 组件卸载：清理
  useEffect(() => {
    return () => {
      // 注意：不在卸载时停止预览，让预览可以跨面板切换保持运行
      // 仅清理本地状态订阅
    }
  }, [])

  // ==========================================
  // 日志辅助
  // ==========================================

  const appendLog = useCallback((type: OperationLogEntry['type'], message: string) => {
    const entry: OperationLogEntry = {
      ts: new Date().toLocaleTimeString(),
      type,
      message,
    }
    setLogs((prev) => [...prev.slice(-99), entry])
  }, [])

  const handleClearLog = useCallback(() => {
    setLogs([])
  }, [])

  // ==========================================
  // 操作：启动预览
  // ==========================================

  const handleStart = useCallback(async () => {
    if (!project) return
    setBusy(true)
    setError('')
    setSuccess('')
    appendLog('start', `${t('builder.preview.start')}：${project.name}`)
    try {
      const result = await previewService.start(project.localPath, project.scenarioId)
      if (!result.success) {
        setError(result.error || t('builder.preview.startFailed'))
        appendLog('error', result.error || t('builder.preview.startFailed'))
        return
      }
      setSuccess(t('builder.preview.startSuccess'))
      appendLog('start', t('builder.preview.startSuccess'))
      // 启动预览后自动开始监听文件
      if (autoReload) {
        const watchRes = await fileWatcherService.watch({
          projectPath: project.localPath,
          debounceMs: 500,
        })
        if (!watchRes.success) {
          appendLog('error', watchRes.error || 'File watcher failed')
        }
      }
    } catch (err) {
      const msg = (err as Error).message || t('builder.preview.startFailed')
      setError(msg)
      appendLog('error', msg)
    } finally {
      setBusy(false)
    }
  }, [project, autoReload, t, appendLog])

  // ==========================================
  // 操作：停止预览
  // ==========================================

  const handleStop = useCallback(async () => {
    setBusy(true)
    setError('')
    setSuccess('')
    appendLog('stop', t('builder.preview.stop'))
    try {
      await fileWatcherService.unwatch()
      const result = await previewService.stop()
      if (!result.success) {
        setError(result.error || t('builder.preview.stopSuccess'))
        appendLog('error', result.error || t('builder.preview.stopSuccess'))
        return
      }
      setSuccess(t('builder.preview.stopSuccess'))
      appendLog('stop', t('builder.preview.stopSuccess'))
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      appendLog('error', msg)
    } finally {
      setBusy(false)
    }
  }, [t, appendLog])

  // ==========================================
  // 操作：热重载（手动或自动触发）
  // ==========================================

  const handleRestart = useCallback(
    async (autoTriggered = false) => {
      if (!previewState.running) {
        if (!autoTriggered) {
          setError(t('builder.preview.notRunning'))
        }
        return
      }
      if (!autoTriggered) {
        setBusy(true)
        setError('')
      }
      appendLog('restart', t('builder.preview.restart'))
      try {
        const result = await previewService.restart()
        if (!result.success) {
          if (!autoTriggered) {
            setError(result.error || t('builder.preview.reloadFailed'))
          }
          appendLog('error', result.error || t('builder.preview.reloadFailed'))
          return
        }
        if (!autoTriggered) {
          setSuccess(t('builder.preview.reloadSuccess'))
        }
        appendLog('restart', t('builder.preview.reloadSuccess'))
      } catch (err) {
        const msg = (err as Error).message
        if (!autoTriggered) {
          setError(msg)
        }
        appendLog('error', msg)
      } finally {
        if (!autoTriggered) {
          setBusy(false)
        }
      }
    },
    [previewState.running, t, appendLog],
  )

  // ==========================================
  // 自动热重载开关
  // ==========================================

  const handleToggleAutoReload = useCallback(async () => {
    const next = !autoReload
    setAutoReload(next)
    if (next && project && previewState.running) {
      // 开启自动重载 + 预览运行中：自动开启监听
      const res = await fileWatcherService.watch({
        projectPath: project.localPath,
        debounceMs: 500,
      })
      if (!res.success) {
        appendLog('error', res.error || 'File watcher failed')
      }
    } else if (!next && watchState.watching) {
      // 关闭自动重载：停止监听
      await fileWatcherService.unwatch()
    }
  }, [autoReload, project, previewState.running, watchState.watching, appendLog])

  // ==========================================
  // 派生状态
  // ==========================================

  const opStatus: OpStatus = useMemo(() => {
    if (previewState.lastError) return 'error'
    if (previewState.running) return 'running'
    if (busy) return 'starting'
    return 'idle'
  }, [previewState, busy])

  const durationText = useMemo(() => {
    if (!previewState.running || duration === 0) return '-'
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    const seconds = duration % 60
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${seconds}s`
  }, [previewState.running, duration])

  // ==========================================
  // 渲染
  // ==========================================

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">{t('builder.preview.noProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部标题栏 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Eye className="h-3.5 w-3.5 shrink-0 text-accent" />
          <h2 className="truncate text-[13px] font-medium">{t('builder.preview.title')}</h2>
        </div>
        <p className="px-3 pb-1.5 text-[12px] text-muted-foreground/70">
          {t('builder.preview.subtitle')}
        </p>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          <button
            onClick={handleStart}
            disabled={busy || previewState.running}
            className="flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1 text-[12px] text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            title={t('builder.preview.start')}
          >
            <Play className="h-3 w-3" />
            {busy && !previewState.running ? t('builder.preview.starting') : t('builder.preview.start')}
          </button>
          <button
            onClick={handleStop}
            disabled={busy || !previewState.running}
            className="flex items-center gap-1 rounded bg-destructive/10 px-2.5 py-1 text-[12px] text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
            title={t('builder.preview.stop')}
          >
            <Square className="h-3 w-3" />
            {busy && previewState.running ? t('builder.preview.stopping') : t('builder.preview.stop')}
          </button>
          <button
            onClick={() => handleRestart(false)}
            disabled={busy || !previewState.running}
            className="flex items-center gap-1 rounded bg-accent/10 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
            title={t('builder.preview.restart')}
          >
            <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
            {t('builder.preview.restart')}
          </button>
          {/* 自动热重载开关 */}
          <button
            onClick={handleToggleAutoReload}
            className={`ml-auto flex items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors ${
              autoReload
                ? 'bg-accent/10 text-accent hover:bg-accent/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            title={t('builder.preview.autoReloadHint')}
          >
            {autoReload ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
            {t('builder.preview.autoReload')}
          </button>
        </div>
      </div>

      {/* ========== 状态提示 ========== */}
      {(error || success) && (
        <div className="shrink-0 border-b border-border/60 px-3 py-1.5">
          {error && (
            <div className="flex items-center gap-1.5 text-[12px] text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          {success && !error && (
            <div className="flex items-center gap-1.5 text-[12px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{success}</span>
            </div>
          )}
        </div>
      )}

      {/* ========== Tab 切换栏 ========== */}
      <div className="shrink-0 border-b border-border bg-muted/30">
        <div className="flex items-center overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1 border-b-2 px-2.5 py-1.5 text-[12px] transition-colors ${
                  isActive
                    ? 'border-accent text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                title={t(tab.labelKey)}
              >
                {tab.icon}
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {/* ========== Tab 内容区 ========== */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'status' && (
          <StatusTab
            previewState={previewState}
            watchState={watchState}
            opStatus={opStatus}
            durationText={durationText}
            logs={logs}
            onClearLogs={handleClearLog}
          />
        )}
        {activeTab === 'logs' && (
          <LiveLogsTab
            scenarioId={previewState.scenarioId}
            running={previewState.running}
          />
        )}
        {activeTab === 'database' && (
          <DatabaseTab
            scenarioId={previewState.scenarioId}
            running={previewState.running}
          />
        )}
        {activeTab === 'toolCalls' && (
          <ToolCallTraceTab
            scenarioId={previewState.scenarioId}
            running={previewState.running}
          />
        )}
        {activeTab === 'metrics' && (
          <MetricsTab
            scenarioId={previewState.scenarioId}
            running={previewState.running}
          />
        )}
      </div>

      {/* ========== 底部说明 ========== */}
      <div className="shrink-0 border-t border-border px-3 py-2 text-[12px] text-muted-foreground/70">
        {t('builder.preview.tip')}
      </div>
    </div>
  )
}

export default PreviewPanel
