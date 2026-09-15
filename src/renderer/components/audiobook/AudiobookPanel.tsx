/**
 * AudiobookPanel — 有声书面板
 *
 * 功能：
 * 1. 导入文档：支持 EPUB/PDF/TXT/MD
 * 2. 任务列表：显示所有任务及状态
 * 3. 任务进度：实时显示合成进度
 * 4. 试听下载：试听和下载生成的音频
 *
 * 设计要点：
 * 1. 默认关闭：遵循 P1 通用要求
 * 2. 进度可见：实时显示任务进度
 * 3. 断点续传：支持中断后继续
 * 4. 成本提示：批量 TTS 前显示预估信息
 *
 * @module components/audiobook/AudiobookPanel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BookOpen,
  Play,
  Pause,
  Trash2,
  Download,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  FileAudio,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'

// ============================================
// 类型定义
// ============================================

/** 任务状态 */
type TaskStatus = 'pending' | 'parsing' | 'segmenting' | 'synthesizing' | 'assembling' | 'completed' | 'failed' | 'paused' | 'cancelled'

/** 任务元数据 */
interface TaskMetadata {
  id: string
  sourcePath: string
  sourceName: string
  sourceType: 'epub' | 'pdf' | 'txt' | 'md'
  status: TaskStatus
  config: {
    engine: string
    voice?: string
    speed: number
    concurrency: number
    format: 'mp3' | 'wav'
    maxSegmentLength: number
    maxRetries: number
    chapterSilenceMs: number
  }
  createdAt: number
  updatedAt: number
  completedAt?: number
  error?: string
}

/** 任务进度事件 */
interface TaskProgressEvent {
  taskId: string
  phase: string
  progress: number
  message?: string
  error?: string
}

/** 预估信息 */
interface TaskEstimate {
  title: string
  estimatedChars: number
  estimatedSegments: number
  estimatedDurationMs: number
}

// ============================================
// 常量
// ============================================

/** 支持的文件类型 */
const SUPPORTED_FILE_TYPES = ['.epub', '.pdf', '.txt', '.md']

/** 状态颜色 */
const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'text-gray-500',
  parsing: 'text-blue-500',
  segmenting: 'text-blue-500',
  synthesizing: 'text-yellow-500',
  assembling: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  paused: 'text-orange-500',
  cancelled: 'text-gray-400',
}

/** 状态图标 */
const STATUS_ICONS: Record<TaskStatus, React.ReactNode> = {
  pending: <Clock className="w-4 h-4" />,
  parsing: <Loader2 className="w-4 h-4 animate-spin" />,
  segmenting: <Loader2 className="w-4 h-4 animate-spin" />,
  synthesizing: <Loader2 className="w-4 h-4 animate-spin" />,
  assembling: <Loader2 className="w-4 h-4 animate-spin" />,
  completed: <CheckCircle className="w-4 h-4" />,
  failed: <XCircle className="w-4 h-4" />,
  paused: <Pause className="w-4 h-4" />,
  cancelled: <XCircle className="w-4 h-4" />,
}

/** 状态文本 */
const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: '待处理',
  parsing: '解析中',
  segmenting: '切分中',
  synthesizing: '合成中',
  assembling: '拼接中',
  completed: '已完成',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
}

// ============================================
// AudiobookPanel 组件
// ============================================

interface AudiobookPanelProps {
  language: Language
}

export function AudiobookPanel({ language }: AudiobookPanelProps) {
  const [tasks, setTasks] = useState<TaskMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskMetadata | null>(null)
  const [estimate, setEstimate] = useState<TaskEstimate | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const progressRef = useRef<Map<string, TaskProgressEvent>>(new Map())

  // ============================================
  // 任务管理
  // ============================================

  /** 加载任务列表 */
  const loadTasks = useCallback(async () => {
    try {
      const result = await api.audiobook.getAllTasks()
      if (result.success) {
        setTasks(result.data || [])
      }
    } catch (error) {
      console.error('[AudiobookPanel] 加载任务失败:', error)
    }
  }, [])

  /** 初始化 */
  useEffect(() => {
    loadTasks()

    // 监听任务进度事件
    const handleProgress = (_event: unknown, progress: TaskProgressEvent) => {
      progressRef.current.set(progress.taskId, progress)
      // 触发重新渲染
      setTasks(prev => [...prev])
    }

    api.ipc.on('audiobook:task-progress', handleProgress)

    return () => {
      api.ipc.removeListener('audiobook:task-progress', handleProgress)
    }
  }, [loadTasks])

  /** 导入文档 */
  const handleImport = useCallback(async () => {
    try {
      const result = await api.dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: '文档文件', extensions: ['epub', 'pdf', 'txt', 'md'] },
        ],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return
      }

      const filePath = result.filePaths[0]

      // 预估任务信息
      const estimateResult = await api.audiobook.estimateTask(filePath)
      if (estimateResult.success) {
        setEstimate(estimateResult.data)
        setShowImportDialog(true)
      }
    } catch (error) {
      toast.error('导入失败', error instanceof Error ? error.message : '未知错误')
    }
  }, [])

  /** 创建任务 */
  const handleCreateTask = useCallback(async () => {
    if (!estimate) return

    try {
      setLoading(true)
      const result = await api.audiobook.createTask(estimate.title, {
        engine: 'cloud',
        speed: 1.0,
        concurrency: 2,
        format: 'mp3',
        maxSegmentLength: 500,
        maxRetries: 3,
        chapterSilenceMs: 800,
      })

      if (result.success) {
        toast.success('任务创建成功', `任务 ${result.data.sourceName} 已创建`)
        setShowImportDialog(false)
        setEstimate(null)
        await loadTasks()
      } else {
        toast.error('创建失败', result.error)
      }
    } catch (error) {
      toast.error('创建失败', error instanceof Error ? error.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }, [estimate, loadTasks])

  /** 执行任务 */
  const handleExecute = useCallback(async (taskId: string) => {
    try {
      const result = await api.audiobook.executeTask(taskId)
      if (result.success) {
        toast.info('任务开始执行', '任务正在后台执行，请稍候...')
      } else {
        toast.error('执行失败', result.error)
      }
    } catch (error) {
      toast.error('执行失败', error instanceof Error ? error.message : '未知错误')
    }
  }, [])

  /** 暂停任务 */
  const handlePause = useCallback(async (taskId: string) => {
    try {
      await api.audiobook.pauseTask(taskId)
      toast.info('任务已暂停', '任务已暂停，可稍后继续')
    } catch (error) {
      toast.error('暂停失败', error instanceof Error ? error.message : '未知错误')
    }
  }, [])

  /** 取消任务 */
  const handleCancel = useCallback(async (taskId: string) => {
    try {
      await api.audiobook.cancelTask(taskId)
      toast.info('任务已取消', '任务已取消')
      await loadTasks()
    } catch (error) {
      toast.error('取消失败', error instanceof Error ? error.message : '未知错误')
    }
  }, [loadTasks])

  /** 删除任务 */
  const handleDelete = useCallback(async (taskId: string) => {
    try {
      const result = await api.audiobook.deleteTask(taskId)
      if (result.success) {
        toast.success('删除成功', '任务已删除')
        await loadTasks()
      } else {
        toast.error('删除失败', result.error)
      }
    } catch (error) {
      toast.error('删除失败', error instanceof Error ? error.message : '未知错误')
    }
  }, [loadTasks])

  /** 获取任务进度 */
  const getTaskProgress = useCallback((taskId: string): TaskProgressEvent | undefined => {
    return progressRef.current.get(taskId)
  }, [])

  // ============================================
  // 渲染
  // ============================================

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          <h2 className="text-lg font-semibold">有声书</h2>
        </div>
        <button
          onClick={handleImport}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          导入文档
        </button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-auto p-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <FileAudio className="w-12 h-12 mb-4" />
            <p>暂无任务</p>
            <p className="text-sm">点击"导入文档"开始创建有声书</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map(task => {
              const progress = getTaskProgress(task.id)
              return (
                <div
                  key={task.id}
                  className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={STATUS_COLORS[task.status]}>
                        {STATUS_ICONS[task.status]}
                      </span>
                      <span className="font-medium">{task.sourceName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {task.status === 'pending' && (
                        <button
                          onClick={() => handleExecute(task.id)}
                          className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                        >
                          开始
                        </button>
                      )}
                      {(task.status === 'synthesizing' || task.status === 'assembling') && (
                        <button
                          onClick={() => handlePause(task.id)}
                          className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600"
                        >
                          暂停
                        </button>
                      )}
                      {task.status === 'paused' && (
                        <button
                          onClick={() => handleExecute(task.id)}
                          className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                        >
                          继续
                        </button>
                      )}
                      {(task.status === 'pending' || task.status === 'paused' || task.status === 'failed') && (
                        <button
                          onClick={() => handleCancel(task.id)}
                          className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                        >
                          取消
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-gray-500 mb-2">
                    {STATUS_TEXT[task.status]}
                    {progress?.message && ` - ${progress.message}`}
                  </div>

                  {/* 进度条 */}
                  {(task.status === 'synthesizing' || task.status === 'assembling') && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${(progress?.progress || 0) * 100}%` }}
                      />
                    </div>
                  )}

                  {/* 错误信息 */}
                  {task.status === 'failed' && task.error && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                      {task.error}
                    </div>
                  )}

                  {/* 完成信息 */}
                  {task.status === 'completed' && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => {
                          // 下载音频
                          const outputPath = api.audiobook.getOutputPath(task.id, `${task.sourceName}.${task.config.format}`)
                          api.shell.showItemInFolder(outputPath)
                        }}
                        className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                      >
                        <Download className="w-4 h-4 inline mr-1" />
                        下载
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 导入对话框 */}
      {showImportDialog && estimate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">确认导入</h3>

            <div className="space-y-2 mb-4">
              <p><strong>标题：</strong>{estimate.title}</p>
              <p><strong>预估字数：</strong>{estimate.estimatedChars.toLocaleString()}</p>
              <p><strong>预估段落：</strong>{estimate.estimatedSegments}</p>
              <p><strong>预估时长：</strong>{Math.ceil(estimate.estimatedDurationMs / 60000)} 分钟</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              批量 TTS 会消耗大量 API 额度，请确认是否继续？
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowImportDialog(false)
                  setEstimate(null)
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                取消
              </button>
              <button
                onClick={handleCreateTask}
                disabled={loading}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 inline mr-1 animate-spin" /> : null}
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}