/**
 * 摄像头隐私控制主视图
 *
 * 全屏弹窗，整合：
 * - 摄像头权限请求（macOS 系统授权对话框）
 * - 实时预览（短暂开启摄像头验证，使用浏览器 getUserMedia API）
 * - 隐私模式开关（严格模式：帧处理完立即释放，不保留任何图像）
 * - 检测配置（检测模式/采样帧率/离开阈值/事件保留期）
 * - 检测控制（启动/停止 + 状态展示）
 * - 事件列表（仅元数据，绝不包含图像/视频）
 *
 * 依赖：
 * - computer-vision 插件（MCP 工具：start_detection/stop_detection/get_status/get_events/clear_events）
 * - 插件配置（plugin:getConfig/plugin:saveConfig）
 * - 主进程摄像头权限 IPC（perception:getCameraPermissionStatus/requestCameraPermission/openCameraSettings）
 *
 * 隐私保护（强制设计）：
 * - 严格隐私模式默认开启
 * - 实时预览仅在用户主动开启时短暂激活，关闭后立即释放 MediaStream
 * - 事件列表只展示元数据（type/timestamp/duration），无任何图像
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Camera,
  CameraOff,
  Shield,
  ShieldCheck,
  Play,
  Square,
  RefreshCw,
  Trash2,
  Eye,
  EyeOff,
  Settings,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  UserX,
  Hand,
  Sun,
  Moon,
} from 'lucide-react'
import { OverlayDialog, ToggleSwitch } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { logger } from '@shared/toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import {
  getInstalledPlugins,
  getPluginConfig,
  savePluginConfig,
  type InstalledPlugin,
} from '@services/pluginService'

// ============================================================
// 常量
// ============================================================

/** computer-vision 插件的 pluginKey */
const COMPUTER_VISION_PLUGIN_KEY = 'computer-vision'

/** 摄像头权限状态 */
type CameraPermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

/** 检测模式 */
type DetectionMode = 'presence' | 'pose' | 'hands' | 'full'

/** 检测事件类型 */
type VisionEventType =
  | 'user_left'
  | 'user_returned'
  | 'gesture_wave'
  | 'gesture_stop'
  | 'gesture_point'
  | 'ambient_dark'
  | 'ambient_bright'

/** 检测事件 */
interface VisionEvent {
  id: string
  type: VisionEventType
  timestamp: number
  [key: string]: unknown
}

/** 检测状态 */
interface DetectionStatus {
  running: boolean
  mode: DetectionMode
  privacyMode: boolean
  userPresent: boolean
  lastPresenceAt: number
  frameCount: number
  lastFrameAt: number
  eventCount: number
  lastError: string | null
}

/** 插件配置 */
interface VisionPluginConfig {
  detectionMode: DetectionMode
  sampleRateFps: number
  leaveThresholdSec: number
  privacyMode: boolean
  retentionDays: number
}

/** 默认配置（与插件 manifest.json 一致） */
const DEFAULT_CONFIG: VisionPluginConfig = {
  detectionMode: 'presence',
  sampleRateFps: 5,
  leaveThresholdSec: 30,
  privacyMode: true,
  retentionDays: 7,
}

// ============================================================
// 组件 Props
// ============================================================

interface CameraPrivacyControlProps {
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 语言 */
  language: Language
}

// ============================================================
// 主组件
// ============================================================

export function CameraPrivacyControl({
  isOpen,
  onClose,
  language,
}: CameraPrivacyControlProps) {
  const isZh = language === 'zh'

  // ── 状态 ──
  const [loading, setLoading] = useState(true)
  const [pluginInstalled, setPluginInstalled] = useState(false)
  const [pluginRecord, setPluginRecord] = useState<InstalledPlugin | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<CameraPermissionStatus>('unknown')
  const [permissionRequesting, setPermissionRequesting] = useState(false)
  const [needRedirectToSettings, setNeedRedirectToSettings] = useState(false)

  const [config, setConfig] = useState<VisionPluginConfig>(DEFAULT_CONFIG)
  const [configSaving, setConfigSaving] = useState(false)

  const [status, setStatus] = useState<DetectionStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [events, setEvents] = useState<VisionEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // 实时预览
  const [previewEnabled, setPreviewEnabled] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // 自动刷新定时器
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ============================================================
  // 初始化加载
  // ============================================================

  /** 检查插件是否已安装 */
  const checkPluginInstalled = useCallback(async (): Promise<InstalledPlugin | null> => {
    try {
      const installed = await getInstalledPlugins()
      const found = installed.find(
        (p) => p.pluginKey === COMPUTER_VISION_PLUGIN_KEY,
      )
      setPluginInstalled(!!found)
      setPluginRecord(found ?? null)
      return found ?? null
    } catch (e) {
      logger.settings.error('Failed to check computer-vision plugin:', e)
      setPluginInstalled(false)
      return null
    }
  }, [])

  /** 加载摄像头权限状态 */
  const loadPermissionStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.perception.getCameraPermissionStatus()
      if (result.success && result.data) {
        setPermissionStatus(result.data as CameraPermissionStatus)
      }
    } catch (e) {
      logger.settings.error('Failed to get camera permission status:', e)
    }
  }, [])

  /** 加载插件配置 */
  const loadPluginConfig = useCallback(async () => {
    try {
      const saved = await getPluginConfig(COMPUTER_VISION_PLUGIN_KEY)
      setConfig({
        detectionMode: (saved.detectionMode as DetectionMode) || DEFAULT_CONFIG.detectionMode,
        sampleRateFps: Number(saved.sampleRateFps) || DEFAULT_CONFIG.sampleRateFps,
        leaveThresholdSec: Number(saved.leaveThresholdSec) || DEFAULT_CONFIG.leaveThresholdSec,
        privacyMode: saved.privacyMode === undefined ? DEFAULT_CONFIG.privacyMode : saved.privacyMode === 'true',
        retentionDays: Number(saved.retentionDays) || DEFAULT_CONFIG.retentionDays,
      })
    } catch (e) {
      logger.settings.error('Failed to load computer-vision config:', e)
    }
  }, [])

  /** 调用 MCP 工具 */
  const callVisionTool = useCallback(
    async (toolName: string, args: Record<string, unknown> = {}): Promise<unknown> => {
      if (!pluginRecord?.mcpServerId) {
        throw new Error(isZh ? 'MCP 服务未连接' : 'MCP service not connected')
      }
      const result = await window.electronAPI.mcpCallTool({
        serverId: pluginRecord.mcpServerId,
        toolName,
        arguments: args,
      })
      if (result && typeof result === 'object' && 'isError' in result && result.isError) {
        const content = (result as { content?: Array<{ text?: string }> }).content
        const msg = content?.[0]?.text || 'Unknown error'
        throw new Error(msg)
      }
      return result
    },
    [pluginRecord, isZh],
  )

  /** 加载检测状态 */
  const loadStatus = useCallback(async () => {
    if (!pluginRecord?.mcpServerId) return
    setStatusLoading(true)
    try {
      const result = (await callVisionTool('get_status', {})) as {
        content?: Array<{ text?: string }>
      }
      const text = result?.content?.[0]?.text
      if (text) {
        const parsed = JSON.parse(text) as DetectionStatus
        setStatus(parsed)
      }
    } catch (e) {
      logger.settings.warn('Failed to load vision status:', e)
    } finally {
      setStatusLoading(false)
    }
  }, [pluginRecord, callVisionTool])

  /** 加载事件列表 */
  const loadEvents = useCallback(async () => {
    if (!pluginRecord?.mcpServerId) return
    setEventsLoading(true)
    try {
      const result = (await callVisionTool('get_events', { limit: 50 })) as {
        content?: Array<{ text?: string }>
      }
      const text = result?.content?.[0]?.text
      if (text) {
        const parsed = JSON.parse(text) as { events?: VisionEvent[] }
        setEvents(parsed.events || [])
      }
    } catch (e) {
      logger.settings.warn('Failed to load vision events:', e)
    } finally {
      setEventsLoading(false)
    }
  }, [pluginRecord, callVisionTool])

  /** 初始化（第1步）：权限检查 + 插件检查 + 配置加载
   *  注意：不依赖 loadStatus/loadEvents，避免 pluginRecord 更新触发循环。
   *  status/events 的加载放在第2个 useEffect 中，由 pluginRecord?.mcpServerId 驱动。
   */
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      await loadPermissionStatus()
      const installed = await checkPluginInstalled()
      if (installed && !cancelled) {
        await loadPluginConfig()
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  /** 初始化（第2步）：pluginRecord 确定后加载检测状态和事件
   *  依赖 pluginRecord?.mcpServerId，只在插件记录变化时执行一次，不参与循环。
   */
  useEffect(() => {
    if (!isOpen || !pluginRecord?.mcpServerId) return
    loadStatus()
    loadEvents()
  }, [isOpen, pluginRecord?.mcpServerId, loadStatus, loadEvents])

  /** 自动刷新状态（每 5s） */
  useEffect(() => {
    if (!isOpen || !pluginRecord?.mcpServerId) return
    refreshTimerRef.current = setInterval(() => {
      loadStatus()
      loadEvents()
    }, 5000)
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [isOpen, pluginRecord, loadStatus, loadEvents])

  // ============================================================
  // 实时预览（getUserMedia）
  // ============================================================

  /** 开启实时预览 */
  const startPreview = useCallback(async () => {
    try {
      // 先确认权限
      if (permissionStatus !== 'granted') {
        toast.warning(isZh ? '请先授权摄像头权限' : 'Please grant camera permission first')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setPreviewEnabled(true)
    } catch (e) {
      logger.settings.error('Failed to start camera preview:', e)
      toast.error(isZh ? '无法访问摄像头' : 'Cannot access camera')
    }
  }, [permissionStatus, isZh])

  /** 关闭实时预览 */
  const stopPreview = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setPreviewEnabled(false)
  }, [])

  /** 关闭弹窗时清理 */
  useEffect(() => {
    if (!isOpen) {
      stopPreview()
    }
  }, [isOpen, stopPreview])

  // ============================================================
  // 摄像头权限
  // ============================================================

  /** 请求摄像头权限 */
  const handleRequestPermission = useCallback(async () => {
    setPermissionRequesting(true)
    try {
      const result = await window.electronAPI.perception.requestCameraPermission()
      if (result.success) {
        if (result.data === true) {
          setPermissionStatus('granted')
          toast.success(isZh ? '摄像头权限已授予' : 'Camera permission granted')
        } else if (result.redirectToSettings) {
          setPermissionStatus('denied')
          setNeedRedirectToSettings(true)
          toast.warning(
            isZh
              ? '您曾拒绝摄像头权限，需在系统设置中手动开启'
              : 'Camera permission was denied. Please enable it in System Settings.',
          )
        } else {
          setPermissionStatus('denied')
          toast.error(isZh ? '摄像头权限被拒绝' : 'Camera permission denied')
        }
      } else {
        toast.error(result.error || (isZh ? '请求权限失败' : 'Failed to request permission'))
      }
    } catch (e) {
      toast.error(isZh ? '请求权限失败' : 'Failed to request permission')
      logger.settings.error('Request camera permission failed:', e)
    } finally {
      setPermissionRequesting(false)
    }
  }, [isZh])

  /** 打开系统设置 */
  const handleOpenSystemSettings = useCallback(async () => {
    try {
      await window.electronAPI.perception.openCameraSettings()
    } catch (e) {
      logger.settings.error('Open camera settings failed:', e)
    }
  }, [])

  // ============================================================
  // 配置更新
  // ============================================================

  /** 更新插件配置 */
  const updateConfig = useCallback(
    async (updates: Partial<VisionPluginConfig>) => {
      const newConfig = { ...config, ...updates }
      setConfig(newConfig)
      setConfigSaving(true)
      try {
        // 转换为字符串值（插件配置统一存储为字符串）
        const values: Record<string, string> = {
          detectionMode: newConfig.detectionMode,
          sampleRateFps: String(newConfig.sampleRateFps),
          leaveThresholdSec: String(newConfig.leaveThresholdSec),
          privacyMode: String(newConfig.privacyMode),
          retentionDays: String(newConfig.retentionDays),
        }
        await savePluginConfig(COMPUTER_VISION_PLUGIN_KEY, values)
      } catch (e) {
        logger.settings.error('Failed to save vision config:', e)
        toast.error(isZh ? '保存配置失败' : 'Failed to save config')
      } finally {
        setConfigSaving(false)
      }
    },
    [config, isZh],
  )

  // ============================================================
  // 检测控制
  // ============================================================

  /** 启动检测 */
  const handleStartDetection = useCallback(async () => {
    setActionLoading(true)
    try {
      await callVisionTool('start_detection', {
        detectionMode: config.detectionMode,
        sampleRateFps: config.sampleRateFps,
        leaveThresholdSec: config.leaveThresholdSec,
        privacyMode: config.privacyMode,
      })
      toast.success(isZh ? '检测已启动' : 'Detection started')
      await Promise.all([loadStatus(), loadEvents()])
    } catch (e) {
      toast.error(isZh ? `启动失败：${e instanceof Error ? e.message : String(e)}` : `Start failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setActionLoading(false)
    }
  }, [config, callVisionTool, loadStatus, loadEvents, isZh])

  /** 停止检测 */
  const handleStopDetection = useCallback(async () => {
    setActionLoading(true)
    try {
      await callVisionTool('stop_detection', {})
      toast.success(isZh ? '检测已停止' : 'Detection stopped')
      await loadStatus()
    } catch (e) {
      toast.error(isZh ? `停止失败：${e instanceof Error ? e.message : String(e)}` : `Stop failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setActionLoading(false)
    }
  }, [callVisionTool, loadStatus, isZh])

  /** 清空事件 */
  const handleClearEvents = useCallback(async () => {
    if (!confirm(isZh ? '确定要清空所有检测事件吗？' : 'Clear all vision events?')) return
    setActionLoading(true)
    try {
      await callVisionTool('clear_events', {})
      toast.success(isZh ? '事件已清空' : 'Events cleared')
      await loadEvents()
    } catch (e) {
      toast.error(isZh ? '清空失败' : 'Clear failed')
    } finally {
      setActionLoading(false)
    }
  }, [callVisionTool, loadEvents, isZh])

  // ============================================================
  // 渲染
  // ============================================================

  if (!isOpen) return null

  return (
    <OverlayDialog isOpen={isOpen} onClose={onClose} size="4xl" noPadding>
      <div className="flex flex-col h-[85vh]">
        {/* 头部 */}
        <div className="flex items-center justify-between pl-6 pr-14 py-4 border-b border-border/50 bg-red-500/[0.03]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Camera className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-primary">
                {t('camera.title', language)}
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {t('camera.subtitle', language)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {configSaving && (
              <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                {isZh ? '保存中' : 'Saving'}
              </div>
            )}
            <button
              onClick={() => {
                loadStatus()
                loadEvents()
              }}
              className="p-1.5 rounded-lg hover:bg-text-primary/5 text-text-muted hover:text-text-primary transition-all"
              title={t('camera.refresh', language)}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
            </div>
          ) : !pluginInstalled ? (
            <PluginNotInstalledView language={language} />
          ) : (
            <>
              {/* 摄像头权限 */}
              <CameraPermissionSection
                language={language}
                status={permissionStatus}
                requesting={permissionRequesting}
                needRedirectToSettings={needRedirectToSettings}
                onRequestPermission={handleRequestPermission}
                onOpenSystemSettings={handleOpenSystemSettings}
              />

              {/* 实时预览 */}
              <CameraPreviewSection
                language={language}
                previewEnabled={previewEnabled}
                videoRef={videoRef}
                permissionStatus={permissionStatus}
                onTogglePreview={previewEnabled ? stopPreview : startPreview}
              />

              {/* 隐私模式 */}
              <PrivacyModeSection
                language={language}
                config={config}
                onUpdate={updateConfig}
              />

              {/* 检测配置 */}
              <DetectionConfigSection
                language={language}
                config={config}
                onUpdate={updateConfig}
              />

              {/* 检测控制与状态 */}
              <DetectionControlSection
                language={language}
                status={status}
                statusLoading={statusLoading}
                actionLoading={actionLoading}
                onStart={handleStartDetection}
                onStop={handleStopDetection}
              />

              {/* 事件列表 */}
              <EventsListSection
                language={language}
                events={events}
                loading={eventsLoading}
                onClear={handleClearEvents}
                actionLoading={actionLoading}
              />
            </>
          )}
        </div>
      </div>
    </OverlayDialog>
  )
}

// ============================================================
// 子组件：插件未安装提示
// ============================================================

function PluginNotInstalledView({ language }: { language: Language }) {
  const isZh = language === 'zh'
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-4 bg-amber-500/10 rounded-2xl mb-4">
        <AlertCircle className="w-10 h-10 text-amber-500" />
      </div>
      <h3 className="text-base font-bold text-text-primary mb-2">
        {isZh ? '摄像头视觉感知插件未安装' : 'Computer Vision plugin not installed'}
      </h3>
      <p className="text-sm text-text-muted max-w-md mb-4">
        {isZh
          ? '请先在插件市场安装「摄像头视觉感知」插件，然后返回此页面进行配置。'
          : 'Please install the "Computer Vision" plugin from the marketplace first, then return here to configure.'}
      </p>
      <button
        onClick={() => {
          // 触发打开插件中心事件（由外层监听）
          window.dispatchEvent(
            new CustomEvent('aweeclaw:openPluginCenter', {
              detail: { pluginKey: COMPUTER_VISION_PLUGIN_KEY },
            }),
          )
        }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-all"
      >
        <ExternalLink className="w-4 h-4" />
        {isZh ? '前往插件市场' : 'Open Plugin Marketplace'}
      </button>
    </div>
  )
}

// ============================================================
// 子组件：摄像头权限
// ============================================================

interface CameraPermissionSectionProps {
  language: Language
  status: CameraPermissionStatus
  requesting: boolean
  needRedirectToSettings: boolean
  onRequestPermission: () => void
  onOpenSystemSettings: () => void
}

function CameraPermissionSection({
  language,
  status,
  requesting,
  needRedirectToSettings,
  onRequestPermission,
  onOpenSystemSettings,
}: CameraPermissionSectionProps) {
  const isZh = language === 'zh'

  const statusConfig = {
    granted: {
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      label: isZh ? '已授权' : 'Granted',
    },
    denied: {
      icon: <XCircle className="w-4 h-4 text-red-500" />,
      color: 'text-red-500',
      bg: 'bg-red-500/10 border-red-500/30',
      label: isZh ? '已拒绝' : 'Denied',
    },
    restricted: {
      icon: <XCircle className="w-4 h-4 text-red-500" />,
      color: 'text-red-500',
      bg: 'bg-red-500/10 border-red-500/30',
      label: isZh ? '受限' : 'Restricted',
    },
    'not-determined': {
      icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10 border-amber-500/30',
      label: isZh ? '未决定' : 'Not Determined',
    },
    unknown: {
      icon: <AlertCircle className="w-4 h-4 text-text-muted" />,
      color: 'text-text-muted',
      bg: 'bg-surface/30 border-border/40',
      label: isZh ? '未知' : 'Unknown',
    },
  }[status]

  return (
    <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/50 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '摄像头权限' : 'Camera Permission'}
          </h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium ${statusConfig.bg} ${statusConfig.color}`}>
          {statusConfig.icon}
          {statusConfig.label}
        </div>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        {isZh
          ? '摄像头访问需要系统级授权。所有视觉处理在本地完成，不上传任何视觉数据。'
          : 'Camera access requires system-level authorization. All vision processing is local; no visual data is uploaded.'}
      </p>
      <div className="flex items-center gap-2">
        {status !== 'granted' && (
          <button
            onClick={onRequestPermission}
            disabled={requesting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-all"
          >
            {requesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Shield className="w-3.5 h-3.5" />
            )}
            {isZh ? '请求权限' : 'Request Permission'}
          </button>
        )}
        {(needRedirectToSettings || status === 'denied' || status === 'restricted') && (
          <button
            onClick={onOpenSystemSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-text-primary/5 text-text-secondary border border-border hover:bg-text-primary/10 transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {isZh ? '打开系统设置' : 'Open System Settings'}
          </button>
        )}
      </div>
    </section>
  )
}

// ============================================================
// 子组件：实时预览
// ============================================================

interface CameraPreviewSectionProps {
  language: Language
  previewEnabled: boolean
  videoRef: React.RefObject<HTMLVideoElement>
  permissionStatus: CameraPermissionStatus
  onTogglePreview: () => void
}

function CameraPreviewSection({
  language,
  previewEnabled,
  videoRef,
  permissionStatus,
  onTogglePreview,
}: CameraPreviewSectionProps) {
  const isZh = language === 'zh'
  const canPreview = permissionStatus === 'granted'

  return (
    <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/50 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-500" />
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '实时预览' : 'Live Preview'}
          </h3>
        </div>
        <button
          onClick={onTogglePreview}
          disabled={!canPreview}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            previewEnabled
              ? 'bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25'
              : 'bg-cyan-500/15 text-cyan-500 border border-cyan-500/30 hover:bg-cyan-500/25'
          }`}
        >
          {previewEnabled ? (
            <>
              <EyeOff className="w-3.5 h-3.5" />
              {isZh ? '关闭预览' : 'Stop Preview'}
            </>
          ) : (
            <>
              <Eye className="w-3.5 h-3.5" />
              {isZh ? '开启预览' : 'Start Preview'}
            </>
          )}
        </button>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        {isZh
          ? '短暂开启摄像头预览以验证画面。关闭后立即释放摄像头流，不留任何帧。'
          : 'Briefly enable camera preview to verify the image. Closing releases the stream immediately; no frames are retained.'}
      </p>
      <div className="relative aspect-video bg-black/80 rounded-xl overflow-hidden border border-border/50 flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${previewEnabled ? '' : 'hidden'}`}
        />
        {!previewEnabled && (
          <div className="flex flex-col items-center text-text-muted">
            <CameraOff className="w-10 h-10 mb-2 opacity-40" />
            <span className="text-[12px]">
              {isZh ? '预览已关闭' : 'Preview off'}
            </span>
          </div>
        )}
        {previewEnabled && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-red-500/80 text-white text-[12px] font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {isZh ? '实时' : 'LIVE'}
          </div>
        )}
      </div>
    </section>
  )
}

// ============================================================
// 子组件：隐私模式
// ============================================================

interface PrivacyModeSectionProps {
  language: Language
  config: VisionPluginConfig
  onUpdate: (updates: Partial<VisionPluginConfig>) => void
}

function PrivacyModeSection({ language, config, onUpdate }: PrivacyModeSectionProps) {
  const isZh = language === 'zh'
  return (
    <section className="p-5 bg-emerald-500/[0.03] backdrop-blur-md rounded-2xl border border-emerald-500/20 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-emerald-500/10 rounded-lg shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-text-primary mb-1">
              {isZh ? '严格隐私模式' : 'Strict Privacy Mode'}
            </h3>
            <p className="text-xs text-text-muted leading-relaxed">
              {isZh
                ? '启用后，摄像头帧处理完立即释放，内存中不保留任何帧。只保存事件元数据（如"用户于 15:30 离开"），绝不保存图像或视频。'
                : 'When enabled, camera frames are released immediately after processing; no frames are retained in memory. Only event metadata (e.g., "user left at 15:30") is saved — never images or video.'}
            </p>
          </div>
        </div>
        <ToggleSwitch
          checked={config.privacyMode}
          onChange={(e) => onUpdate({ privacyMode: e.target.checked })}
        />
      </div>
      {config.privacyMode && (
        <div className="mt-3 pt-3 border-t border-emerald-500/20 flex items-center gap-2 text-[12px] text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          {isZh
            ? '已启用：帧处理完立即 GC，磁盘无任何图像/视频数据'
            : 'Enabled: frames GC\'d immediately; no images/video on disk'}
        </div>
      )}
    </section>
  )
}

// ============================================================
// 子组件：检测配置
// ============================================================

interface DetectionConfigSectionProps {
  language: Language
  config: VisionPluginConfig
  onUpdate: (updates: Partial<VisionPluginConfig>) => void
}

function DetectionConfigSection({ language, config, onUpdate }: DetectionConfigSectionProps) {
  const isZh = language === 'zh'

  const modeOptions: { value: DetectionMode; label: string; desc: string }[] = [
    { value: 'presence', label: isZh ? '人体存在' : 'Presence', desc: isZh ? '最轻量' : 'Lightest' },
    { value: 'pose', label: isZh ? '姿态' : 'Pose', desc: isZh ? '中等' : 'Medium' },
    { value: 'hands', label: isZh ? '手势' : 'Hands', desc: isZh ? '中等' : 'Medium' },
    { value: 'full', label: isZh ? '完整' : 'Full', desc: isZh ? '最重' : 'Heaviest' },
  ]

  return (
    <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/50 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-bold text-text-primary">
          {isZh ? '检测配置' : 'Detection Configuration'}
        </h3>
      </div>

      <div className="space-y-4">
        {/* 检测模式 */}
        <div>
          <label className="text-[12px] font-medium text-text-secondary mb-2 block">
            {isZh ? '检测模式' : 'Detection Mode'}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {modeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdate({ detectionMode: opt.value })}
                className={`px-3 py-2 rounded-lg text-[12px] font-medium border transition-all ${
                  config.detectionMode === opt.value
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'bg-surface/30 text-text-secondary border-border/40 hover:bg-surface/50'
                }`}
              >
                <div>{opt.label}</div>
                <div className="text-[10px] opacity-60 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 采样帧率 */}
        <SliderField
          label={isZh ? '采样帧率' : 'Sample Rate'}
          unit="FPS"
          value={config.sampleRateFps}
          min={1}
          max={30}
          step={1}
          onChange={(v) => onUpdate({ sampleRateFps: v })}
          hint={isZh ? '每秒处理多少帧，越低越省 CPU' : 'Frames per second to process; lower = less CPU'}
        />

        {/* 离开阈值 */}
        <SliderField
          label={isZh ? '离开判定阈值' : 'Leave Threshold'}
          unit={isZh ? '秒' : 'sec'}
          value={config.leaveThresholdSec}
          min={5}
          max={300}
          step={5}
          onChange={(v) => onUpdate({ leaveThresholdSec: v })}
          hint={isZh ? '未检测到人体的持续秒数后触发"用户离开"事件' : 'Seconds without presence before triggering user_left event'}
        />

        {/* 事件保留期 */}
        <SliderField
          label={isZh ? '事件保留期' : 'Event Retention'}
          unit={isZh ? '天' : 'days'}
          value={config.retentionDays}
          min={1}
          max={90}
          step={1}
          onChange={(v) => onUpdate({ retentionDays: v })}
          hint={isZh ? '事件元数据保留天数（不包含任何图像）' : 'Days to retain event metadata (no images)'}
        />
      </div>
    </section>
  )
}

/** 滑块字段 */
function SliderField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12px] font-medium text-text-secondary">{label}</label>
        <span className="text-[12px] font-bold text-accent tabular-nums">
          {value} <span className="opacity-60 font-normal">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-surface/50 rounded-full appearance-none cursor-pointer accent-accent"
      />
      {hint && <p className="text-[11px] text-text-muted mt-1">{hint}</p>}
    </div>
  )
}

// ============================================================
// 子组件：检测控制与状态
// ============================================================

interface DetectionControlSectionProps {
  language: Language
  status: DetectionStatus | null
  statusLoading: boolean
  actionLoading: boolean
  onStart: () => void
  onStop: () => void
}

function DetectionControlSection({
  language,
  status,
  statusLoading,
  actionLoading,
  onStart,
  onStop,
}: DetectionControlSectionProps) {
  const isZh = language === 'zh'
  const isRunning = status?.running ?? false

  return (
    <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/50 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '检测控制' : 'Detection Control'}
          </h3>
        </div>
        <button
          onClick={isRunning ? onStop : onStart}
          disabled={actionLoading}
          className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all disabled:opacity-50 ${
            isRunning
              ? 'bg-red-500/15 text-red-500 border border-red-500/30 hover:bg-red-500/25'
              : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/25'
          }`}
        >
          {actionLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isRunning ? (
            <Square className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {isRunning
            ? isZh ? '停止检测' : 'Stop Detection'
            : isZh ? '启动检测' : 'Start Detection'}
        </button>
      </div>

      {statusLoading && !status ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : status ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusCard
            icon={status.running ? <Activity className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            label={isZh ? '运行状态' : 'Running'}
            value={status.running ? (isZh ? '运行中' : 'Running') : isZh ? '已停止' : 'Stopped'}
            color={status.running ? 'emerald' : 'text-muted'}
          />
          <StatusCard
            icon={status.userPresent ? <User className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
            label={isZh ? '人体存在' : 'User Present'}
            value={status.userPresent ? (isZh ? '在场' : 'Yes') : isZh ? '离开' : 'No'}
            color={status.userPresent ? 'emerald' : 'amber'}
          />
          <StatusCard
            icon={<Camera className="w-3.5 h-3.5" />}
            label={isZh ? '已处理帧数' : 'Frames'}
            value={String(status.frameCount)}
            color="cyan"
          />
          <StatusCard
            icon={<Activity className="w-3.5 h-3.5" />}
            label={isZh ? '事件总数' : 'Events'}
            value={String(status.eventCount)}
            color="violet"
          />
        </div>
      ) : (
        <div className="text-center py-6 text-[12px] text-text-muted">
          {isZh ? '点击"启动检测"开始视觉感知' : 'Click "Start Detection" to begin vision sensing'}
        </div>
      )}

      {status?.lastError && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-500 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{status.lastError}</span>
        </div>
      )}
    </section>
  )
}

/** 状态卡片 */
function StatusCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'emerald' | 'amber' | 'cyan' | 'violet' | 'text-muted'
}) {
  const colorMap = {
    emerald: 'text-emerald-500 bg-emerald-500/10',
    amber: 'text-amber-500 bg-amber-500/10',
    cyan: 'text-cyan-500 bg-cyan-500/10',
    violet: 'text-violet-500 bg-violet-500/10',
    'text-muted': 'text-text-muted bg-surface/30',
  }
  return (
    <div className="p-3 rounded-xl border border-border/40 bg-surface/30">
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={`p-1 rounded-md ${colorMap[color]}`}>{icon}</div>
        <span className="text-[11px] text-text-muted uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-sm font-bold text-text-primary tabular-nums">{value}</div>
    </div>
  )
}

// ============================================================
// 子组件：事件列表
// ============================================================

interface EventsListSectionProps {
  language: Language
  events: VisionEvent[]
  loading: boolean
  onClear: () => void
  actionLoading: boolean
}

function EventsListSection({
  language,
  events,
  loading,
  onClear,
  actionLoading,
}: EventsListSectionProps) {
  const isZh = language === 'zh'

  return (
    <section className="p-5 bg-surface/20 backdrop-blur-md rounded-2xl border border-border/50 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-bold text-text-primary">
            {isZh ? '检测事件' : 'Detection Events'}
          </h3>
          {events.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-500 text-[11px] font-medium">
              {events.length}
            </span>
          )}
        </div>
        {events.length > 0 && (
          <button
            onClick={onClear}
            disabled={actionLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-all"
          >
            <Trash2 className="w-3 h-3" />
            {isZh ? '清空' : 'Clear'}
          </button>
        )}
      </div>

      <p className="text-[11px] text-text-muted mb-3 leading-relaxed">
        {isZh
          ? '仅展示事件元数据（类型/时间/持续秒数等），绝不包含图像或视频。'
          : 'Shows event metadata only (type/time/duration etc.) — never images or video.'}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-[12px] text-text-muted">
          {isZh ? '暂无检测事件' : 'No events detected'}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
          {events.map((event) => (
            <EventRow key={event.id} event={event} isZh={isZh} />
          ))}
        </div>
      )}
    </section>
  )
}

/** 事件行 */
function EventRow({ event, isZh }: { event: VisionEvent; isZh: boolean }) {
  const eventConfig: Record<VisionEventType, { icon: React.ReactNode; color: string; label: string }> = {
    user_left: {
      icon: <UserX className="w-3.5 h-3.5" />,
      color: 'text-amber-500 bg-amber-500/10',
      label: isZh ? '用户离开' : 'User Left',
    },
    user_returned: {
      icon: <User className="w-3.5 h-3.5" />,
      color: 'text-emerald-500 bg-emerald-500/10',
      label: isZh ? '用户返回' : 'User Returned',
    },
    gesture_wave: {
      icon: <Hand className="w-3.5 h-3.5" />,
      color: 'text-cyan-500 bg-cyan-500/10',
      label: isZh ? '挥手' : 'Wave',
    },
    gesture_stop: {
      icon: <Hand className="w-3.5 h-3.5" />,
      color: 'text-red-500 bg-red-500/10',
      label: isZh ? '停止手势' : 'Stop Gesture',
    },
    gesture_point: {
      icon: <Hand className="w-3.5 h-3.5" />,
      color: 'text-violet-500 bg-violet-500/10',
      label: isZh ? '指向手势' : 'Point',
    },
    ambient_dark: {
      icon: <Moon className="w-3.5 h-3.5" />,
      color: 'text-indigo-500 bg-indigo-500/10',
      label: isZh ? '环境变暗' : 'Ambient Dark',
    },
    ambient_bright: {
      icon: <Sun className="w-3.5 h-3.5" />,
      color: 'text-yellow-500 bg-yellow-500/10',
      label: isZh ? '环境变亮' : 'Ambient Bright',
    },
  }

  const cfg = eventConfig[event.type] || {
    icon: <Activity className="w-3.5 h-3.5" />,
    color: 'text-text-muted bg-surface/30',
    label: event.type,
  }

  // 格式化时间
  const date = new Date(event.timestamp)
  const timeStr = isZh
    ? `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  // 元数据摘要
  const metaParts: string[] = []
  if (typeof event.awayDurationSec === 'number') {
    metaParts.push(isZh ? `离开 ${event.awayDurationSec}s` : `away ${event.awayDurationSec}s`)
  }
  if (typeof event.confidence === 'number') {
    metaParts.push(`${(event.confidence * 100).toFixed(0)}%`)
  }
  if (typeof event.brightness === 'number') {
    metaParts.push(`${(event.brightness * 100).toFixed(0)}%`)
  }

  return (
    <div className="flex items-center gap-2.5 p-2 rounded-lg bg-surface/30 border border-border/30 hover:bg-surface/50 transition-all">
      <div className={`p-1.5 rounded-md ${cfg.color} shrink-0`}>{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-text-primary">{cfg.label}</div>
        {metaParts.length > 0 && (
          <div className="text-[11px] text-text-muted">{metaParts.join(' · ')}</div>
        )}
      </div>
      <div className="text-[11px] text-text-muted tabular-nums shrink-0">{timeStr}</div>
    </div>
  )
}

/** Activity 图标（避免额外 import） */
function Activity({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}
