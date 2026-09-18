/**
 * VrmCompanionApp — VRM 桌面伴侣窗口顶层组件
 *
 * 职责：
 * - 读取主进程配置与模型列表，驱动 VrmStage 渲染对应 VRM 角色
 * - 窗口拖拽（主进程轮询鼠标坐标方案，鼠标移出窗口也能继续拖）
 * - 口型驱动：三路来源按优先级消费 ——
 *   1) 本窗口语音对话的实时 TTS 音量（最精确）
 *   2) 主窗口推送的实时音量
 *   3) 主窗口/AI 推送的文本（按字数估算时长模拟）
 * - 悬浮控制栏：语音对话 / 模型切换 / 导入 / 鼠标穿透 / 隐藏窗口
 * - 语音对话：本窗口内独立完成「说话 → 识别 → 回答 → 朗读」（见 useVrmCompanionVoice）
 * - AI 动作指令：消费 companion_control 工具下发的动作/表情/视线指令
 *
 * 设计约束：
 * - 窗口透明（body 背景透明），3D 画布以 alpha 输出，角色之外区域完全透出桌面
 * - 口型值通过 ref 逐帧传递，避免 60fps 触发 React 重渲染
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EyeOff,
  Lock,
  Mic,
  MoreVertical,
  MousePointerClick,
  Move,
  PhoneOff,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Unlock,
  X,
  type LucideIcon,
} from 'lucide-react'
import type {
  VrmAnimationInfo,
  VrmCompanionCommand,
  VrmCompanionConfig,
  VrmModelInfo,
} from '@renderer/types/electronBridge'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { useVrmCompanionBridge } from '@renderer/composables/useVrmCompanionBridge'
import { useVrmCompanionVoice } from '@renderer/composables/useVrmCompanionVoice'
import { VrmStage, type VrmStageHandle } from './VrmStage'
import { useVrmLipSync } from './useVrmLipSync'

export interface VrmCompanionAppProps {
  /** React 挂载就绪回调（移除加载占位） */
  onReady?: () => void
}

/** 模拟说话时的最小 / 最大时长（ms） */
const MIN_SPEAK_MS = 900
const MAX_SPEAK_MS = 20000
/** 单字估算时长（ms/字，中文语速约 5~6 字/秒） */
const MS_PER_CHAR = 170

/**
 * 控制栏热区（相对窗口右上角，px）。
 *
 * 比按钮本身略大一圈：指针一进热区就先把鼠标事件接管过来，
 * 避免「刚移上去立刻点击」时第一下还按穿透落到桌面上（表现为按钮点不动）。
 * 宽度需覆盖主栏 + 展开后向左溢出的子面板。
 */
const BAR_HOT_ZONE = { width: 118, height: 210 }

/**
 * 指针离开角色 / 控制栏后的收起宽限（ms）。
 *
 * 为什么必须留宽限：从角色（画面中央）移到右上角控制栏的途中，
 * 「压在角色上」与「压在控制栏上」会同时为 false。若立刻收起，
 * 控制栏会被卸载 —— 指针到达时已无按钮可命中，形成「永远点不到」的死局。
 */
const HOVER_LEAVE_GRACE_MS = 420

/**
 * 渲染层拖拽看门狗（ms）。
 *
 * 主进程侧已有 60s 兜底，这里用更短的阈值先结束拖拽：
 * 拖拽中窗口必须持续接管鼠标事件，一旦 dragging 卡住，
 * 穿透模式下窗口会永久挡住桌面点击（比「拖拽没收尾」严重得多）。
 */
const MAX_DRAG_GUARD_MS = 30_000

/**
 * 动作语义别名 → 实际动作名（内置动作目录里的文件名，见 vrmIdleAnimation.actionNameFromUrl）。
 *
 * AI 很自然会输出「挥手 / 打招呼 / 思考」这类语义词，而不是文件名，
 * 因此在渲染层做一层别名归一，让指令更容错（不必把所有别名写进工具描述里）。
 */
const ACTION_ALIASES: Record<string, string> = {
  wave: 'greeting', hi: 'greeting', hello: 'greeting', 打招呼: 'greeting', 挥手: 'greeting', 你好: 'greeting',
  think: 'scratch_head', 思考: 'scratch_head', 挠头: 'scratch_head', 疑惑: 'scratch_head',
  stretch: 'stretch', 伸懒腰: 'stretch', 伸展: 'stretch', 放松: 'stretch',
  peace: 'peace_sign', 比耶: 'peace_sign', 剪刀手: 'peace_sign', victory: 'peace_sign',
  akimbo: 'akimbo', 叉腰: 'akimbo',
  pose: 'model_pose', 摆pose: 'model_pose', 摆拍: 'model_pose', 凹造型: 'model_pose',
  spin: 'spin', 转圈: 'spin',
  squat: 'squat', 下蹲: 'squat',
  playful: 'play_fingers', 抖手: 'play_fingers', dance: 'play_fingers', 跳舞: 'play_fingers',
}

/**
 * 把 AI 给出的动作名解析为可用动作名。
 *
 * 匹配顺序：精确文件名 → 语义别名 → 包含匹配（容忍 "greeting.vrma" / "打招呼动作"）。
 * @returns 无法匹配时返回 null（调用方据此反馈错误，而不是静默随机播一个）
 */
function resolveActionName(
  raw: string | undefined,
  available: VrmAnimationInfo[],
): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  const names = available.map((a) => a.name.toLowerCase())

  if (names.includes(key)) return key
  const alias = ACTION_ALIASES[key]
  if (alias && names.includes(alias)) return alias
  return names.find((n) => n.includes(key) || key.includes(n)) ?? null
}

/** 语音状态 → 展示文案（渲染层只做展示，状态机在 useVoiceChat） */
const VOICE_STATE_LABEL: Record<string, string> = {
  connecting: '连接中…',
  listening: '在听…',
  recording: '在听…',
  processing: '思考中…',
  speaking: '回答中…',
  error: '语音出错',
}

/** 语音状态 → 指示点颜色 */
function voiceDotColor(state: string): string {
  switch (state) {
    case 'listening':
    case 'recording':
      return 'rgba(52,211,153,1)' // 绿：在听
    case 'processing':
      return 'rgba(167,139,250,1)' // 紫：思考
    case 'speaking':
      return 'rgba(34,211,238,1)' // 青：回答
    case 'error':
      return 'rgba(248,113,113,1)' // 红：出错
    default:
      return 'rgba(148,163,184,1)'
  }
}

export function VrmCompanionApp({ onReady }: VrmCompanionAppProps) {
  // --------------------------------------------
  // 状态
  // --------------------------------------------
  const [config, setConfig] = useState<VrmCompanionConfig | null>(null)
  const [models, setModels] = useState<VrmModelInfo[]>([])
  /** 可用待机动作（.vrma），由主进程扫描内置/用户动作目录得到 */
  const [animations, setAnimations] = useState<VrmAnimationInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isModelLoading, setIsModelLoading] = useState(false)
  /** 鼠标是否进入窗口（非穿透模式下据此显示控制栏） */
  const [hovered, setHovered] = useState(false)
  /**
   * 悬停热区闩锁：指针压在角色或控制栏上。
   *
   * 穿透模式下据此浮出控制栏 —— 这是「默认穿透但操作入口仍在」的核心状态，
   * 收起带 HOVER_LEAVE_GRACE_MS 宽限（见常量注释）。
   */
  const [pointerHot, setPointerHot] = useState(false)
  /** 指针是否压在控制栏热区上：只有此时才需要窗口接管鼠标事件，按钮才点得动 */
  const [overBar, setOverBar] = useState(false)
  /** 是否正在拖拽窗口：拖拽期间必须持续接管鼠标事件，否则 mouseup 收不到、窗口粘住鼠标 */
  const [dragging, setDragging] = useState(false)
  /** 自动隐藏是否已生效（角色已淡出让位）——生效时不显示控制栏 */
  const [autoHidden, setAutoHidden] = useState(false)
  /** 「更多」子面板展开状态（图标控制栏用于收纳次要操作） */
  const [panelOpen, setPanelOpen] = useState(false)

  // --------------------------------------------
  // 口型同步
  // --------------------------------------------
  const lipSync = useVrmLipSync()

  // --------------------------------------------
  // 语音对话（伴侣窗口内独立完成「说话 → 识别 → 回答 → 朗读」）
  //
  // 配置来源：主窗口 push 的 VoiceContext（llmConfig / 云端 token / STT-TTS 分流），
  // 与悬浮头像窗口共用主进程缓存，因此不需要在这里访问 @store。
  // --------------------------------------------
  const bridge = useVrmCompanionBridge()
  /** 语音对话是否激活 */
  const [voiceActive, setVoiceActive] = useState(false)
  /** 语音错误提示（短暂显示后自动消失） */
  const [voiceError, setVoiceError] = useState<string | null>(null)
  /** 字幕气泡：AI 最近一句回复（流式显示） */
  const [subtitle, setSubtitle] = useState('')
  /** 语音会话是否已经真正进入非 idle 状态（用于区分「未连接」与「已结束」） */
  const voiceStartedRef = useRef(false)

  const showVoiceError = useCallback((message: string) => {
    setVoiceError(message)
    window.setTimeout(() => setVoiceError(null), 4000)
  }, [])

  /**
   * 停止语音对话。
   *
   * 用 ref 间接引用：useVrmCompanionVoice 的 onEndConversation 回调在 hook
   * 创建时就已注册，而 disconnect 只能从返回对象上取 —— 直接引用会形成
   * 「hook 依赖 stopVoice、stopVoice 依赖 hook」的循环。
   */
  const stopVoiceRef = useRef<() => void>(() => {})

  const voiceChat = useVrmCompanionVoice({
    voiceContext: bridge.voiceContext,
    onStateChanged: (state, volume) => {
      bridge.notifyVoiceStateChanged({ state, volume })
    },
    onConversationComplete: (userText, aiText, toolCallRecords) => {
      // 伴侣窗口不维护聊天历史，交回主窗口落库
      bridge.notifySaveConversation({ userText, aiText, toolCallRecords })
    },
    onEndConversation: () => {
      // 用户说「结束对话」等指令：直接收尾，不弹错误提示（这是正常流程）
      stopVoiceRef.current()
    },
    // 口型跟「朗读出来的声音」走：TTS 播放电平，而不是麦克风采集电平
    onPlaybackVolume: (volume) => lipSync.pushVolume(volume),
    onError: showVoiceError,
  })

  const stopVoice = useCallback(() => {
    try {
      voiceChat.disconnect()
    } catch (err) {
      logger.system.debug('[VrmCompanion] disconnect voice failed:', err)
    }
    voiceStartedRef.current = false
    setVoiceActive(false)
    setSubtitle('')
    lipSync.reset()
  }, [lipSync, voiceChat])

  stopVoiceRef.current = stopVoice

  const startVoice = useCallback(async () => {
    if (voiceActive) return
    if (!bridge.voiceContext) {
      showVoiceError('语音配置加载中，请稍后重试')
      return
    }
    // 主窗口正在语音对话时不要抢麦克风（否则两边互相听到对方的 TTS）
    if (bridge.mainConversationActive) {
      showVoiceError('主窗口正在语音对话中')
      return
    }
    // macOS 需主进程触发系统授权弹窗
    const granted = await bridge.requestMicPermission()
    if (!granted) {
      showVoiceError('麦克风权限被拒绝')
      return
    }
    try {
      await voiceChat.connect()
      setVoiceActive(true)
      logger.system.info('[VrmCompanion] Voice conversation started')
    } catch (err) {
      showVoiceError(err instanceof Error ? err.message : '启动语音对话失败')
    }
  }, [bridge, showVoiceError, voiceActive, voiceChat])

  /** 语音状态回落到 idle（用户说「结束对话」/ 连接断开）→ 退出语音态 */
  useEffect(() => {
    if (!voiceActive) {
      voiceStartedRef.current = false
      return
    }
    if (voiceChat.state !== 'idle') {
      voiceStartedRef.current = true
      return
    }
    // 必须「先进入过非 idle」才认为会话确实结束，避免 connect 尚未生效时被误判
    if (voiceStartedRef.current) {
      setVoiceActive(false)
      setSubtitle('')
    }
  }, [voiceActive, voiceChat.state])

  /** 主窗口开始语音对话 → 伴侣让出麦克风 */
  useEffect(() => {
    if (bridge.mainConversationActive && voiceActive) {
      showVoiceError('主窗口已接管语音')
      stopVoice()
    }
  }, [bridge.mainConversationActive, showVoiceError, stopVoice, voiceActive])

  /**
   * 伴侣窗口被隐藏 / 关闭 → 结束语音对话。
   *
   * 隐藏只隐藏窗口并保留 warm renderer，渲染层不会随窗口一起停止：
   * 不显式收尾就会出现「窗口都没了、麦克风还在采集、AI 还在朗读」的状态泄漏。
   * 这里是正常收尾而非异常，故不弹错误提示（与「用户说结束对话」同等对待）。
   */
  useEffect(() => {
    if (bridge.windowVisible || !voiceActive) return
    logger.system.info('[VrmCompanion] Window hidden, ending voice conversation')
    stopVoice()
  }, [bridge.windowVisible, stopVoice, voiceActive])

  /** AI 流式文本 → 字幕气泡 */
  useEffect(() => {
    if (voiceChat.aiText) setSubtitle(voiceChat.aiText)
  }, [voiceChat.aiText])

  /**
   * 口型的「闭口」路径。
   *
   * 说话期间的开合由 TTS 播放电平驱动（见 onPlaybackVolume），这里只负责
   * 非说话态归零，否则会停在说完话时的开合值上。
   *
   * 不能再用 voiceChat.volume：那是麦克风采集电平（只反映用户在说什么），
   * AI 朗读时它接近 0，拿它当口型实参就是「AI 在说、嘴不动」。
   */
  useEffect(() => {
    if (!voiceActive) return
    if (voiceChat.state === 'speaking') return
    lipSync.pushVolume(0)
  }, [lipSync, voiceActive, voiceChat.state])

  // --------------------------------------------
  // 拖拽
  //
  // 机制：渲染层发 drag-start / drag-end，主进程轮询鼠标屏幕坐标移动窗口。
  // 可靠性处理：频道名与窗口 id 绑定，启动阶段拿取可能失败，
  // 因此改为「懒加载 + 每次 mousedown 自动重试」，避免一次失败就永久无法拖动；
  // 结束拖拽做多重兜底（mouseup / pointerup / pointercancel / 窗口失焦）。
  // --------------------------------------------
  const dragChannelsRef = useRef<{ start: string; end: string } | null>(null)
  const draggingRef = useRef(false)
  /** 鼠标位置（归一化 -1~1，相对窗口中心），驱动角色视线跟随 */
  const pointerRef = useRef({ x: 0, y: 0 })
  /** 指针是否位于窗口内（主进程轮询 / DOM 事件维护，用于门控悬停射线检测） */
  const pointerInsideRef = useRef(false)
  /** 指针是否压在角色上（VrmStage 射线检测回调写入，供指针事件里合并判定） */
  const overCharacterRef = useRef(false)
  /** 悬停收起宽限计时器（见 HOVER_LEAVE_GRACE_MS） */
  const hotTimerRef = useRef<number | null>(null)
  /** 3D 舞台句柄：调用视角复位等命令式能力 */
  const stageRef = useRef<VrmStageHandle | null>(null)

  /** 获取拖拽频道（失败时不缓存，下次 mousedown 自动重试） */
  const ensureDragChannels = useCallback(async (): Promise<{ start: string; end: string } | null> => {
    if (dragChannelsRef.current) return dragChannelsRef.current
    try {
      const res = await api.vrmCompanion.getDragChannel()
      if (res.success && res.data) {
        dragChannelsRef.current = res.data
        return res.data
      }
      logger.system.warn('[VrmCompanion] getDragChannel failed:', res.error)
    } catch (err) {
      logger.system.warn('[VrmCompanion] getDragChannel threw:', err)
    }
    return null
  }, [])

  useEffect(() => {
    void ensureDragChannels()
  }, [ensureDragChannels])

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    const channels = dragChannelsRef.current
    if (channels) api.vrmCompanion.sendDragEnd(channels.end)
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      // 锁定位置：不发起拖拽
      if (config?.locked) return
      draggingRef.current = true
      // 拖拽期间窗口必须持续接收鼠标事件（否则 window 上的 mouseup 收不到）
      setDragging(true)
      void ensureDragChannels().then((channels) => {
        // 频道获取失败，或等待期间鼠标已松开 → 放弃本次拖拽
        if (!channels || !draggingRef.current) return
        // 主进程收到 start 后自行轮询鼠标坐标，无需传递坐标
        api.vrmCompanion.sendDragStart(channels.start)
      })
    },
    [config?.locked, ensureDragChannels],
  )

  /** 鼠标移动 → 更新视线目标（归一化到 -1 ~ 1） */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 拖拽中窗口跟随鼠标，相对坐标无意义，跳过以免视线乱转
      if (draggingRef.current) return
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      pointerRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
      }
      pointerInsideRef.current = true
      // 悬停判定不在这里刷新：穿透模式由主进程轮询驱动（20Hz），
      // 这里的 DOM 事件只在「窗口已接管鼠标事件」时才有，作为视线数据的补充即可
    },
    [],
  )

  /**
   * 拖拽超时兜底。
   *
   * 拖拽期间窗口必须持续接管鼠标事件（否则 mouseup 收不到、窗口粘住鼠标），
   * 一旦 mouseup 被系统吞掉，dragging 会一直为真 —— 穿透模式下就成了
   * 「窗口永久挡住桌面点击」。主进程另有 60s 看门狗，这里用更短的阈值先收手。
   */
  useEffect(() => {
    if (!dragging) return
    const timer = window.setTimeout(() => endDrag(), MAX_DRAG_GUARD_MS)
    return () => window.clearTimeout(timer)
  }, [dragging, endDrag])

  // 结束拖拽的多重兜底：鼠标在窗口外松开 / 指针取消 / 窗口失焦
  useEffect(() => {
    const onUp = (): void => endDrag()
    window.addEventListener('mouseup', onUp)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [endDrag])

  // --------------------------------------------
  // 初始化：配置 + 模型列表
  // --------------------------------------------
  const loadModels = useCallback(async () => {
    const res = await api.vrmCompanion.listModels()
    if (res.success && res.data) setModels(res.data)
    return res.success ? (res.data ?? []) : []
  }, [])

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const [configRes, modelsRes, animRes] = await Promise.all([
          api.vrmCompanion.getConfig(),
          api.vrmCompanion.listModels(),
          api.vrmCompanion.listAnimations(),
        ])
        if (disposed) return
        if (configRes.success && configRes.data) setConfig(configRes.data)
        if (modelsRes.success && modelsRes.data) setModels(modelsRes.data)
        if (animRes.success && animRes.data) setAnimations(animRes.data)
      } catch (err) {
        logger.system.warn('[VrmCompanion] Init failed:', err)
        if (!disposed) setError('初始化失败')
      } finally {
        if (!disposed) onReady?.()
      }
    })()
    return () => {
      disposed = true
    }
  }, [onReady])

  // 配置更新（主进程推送：模型切换 / 缩放变更）
  useEffect(() => {
    const off = api.vrmCompanion.onConfigUpdated((next) => {
      setConfig(next)
      // 模型切换后刷新列表以同步 selected 标记
      void loadModels()
    })
    return () => off()
  }, [loadModels])

  // --------------------------------------------
  // 口型：订阅主窗口推送
  // --------------------------------------------
  const speakTimerRef = useRef<number | null>(null)

  const stopSimulatedSpeech = useCallback(() => {
    if (speakTimerRef.current != null) {
      window.clearTimeout(speakTimerRef.current)
      speakTimerRef.current = null
    }
  }, [])

  /**
   * 模拟说话节奏。
   *
   * 当没有实时音频（onVolume）输入时使用：按文本长度估算总时长，
   * 以 70ms 为节拍推送伪随机音量，并周期性插入「句读停顿」，
   * 让口型看起来自然而非机械匀速。
   */
  const startSimulatedSpeech = useCallback(
    (text: string, durationMs?: number) => {
      stopSimulatedSpeech()
      const estimated = durationMs ?? text.length * MS_PER_CHAR
      const duration = Math.max(MIN_SPEAK_MS, Math.min(MAX_SPEAK_MS, estimated))
      const startedAt = performance.now()

      const tick = (): void => {
        const elapsed = performance.now() - startedAt
        if (elapsed >= duration) {
          speakTimerRef.current = null
          lipSync.pushVolume(0)
          return
        }
        // 基础开合 + 伪随机抖动；正弦阈值制造句读停顿
        const base = 0.32 + Math.random() * 0.5
        const pauseFactor = Math.sin(elapsed / 130) > 0.72 ? 0.12 : 1
        lipSync.pushVolume(base * pauseFactor)
        speakTimerRef.current = window.setTimeout(tick, 70)
      }
      tick()
    },
    [lipSync, stopSimulatedSpeech],
  )

  useEffect(() => {
    const offSpeak = api.vrmCompanion.onSpeak(({ text, durationMs }) => {
      startSimulatedSpeech(text ?? '', durationMs)
    })
    const offStop = api.vrmCompanion.onStopSpeak(() => {
      stopSimulatedSpeech()
      lipSync.reset()
    })
    // 实时音量优先：有真实音量推送时立即接管（模拟节奏仍会跑，但被更高频的真实值覆盖）
    const offVolume = api.vrmCompanion.onVolume((volume) => {
      if (volume > 0.02) stopSimulatedSpeech()
      lipSync.pushVolume(volume)
    })

    return () => {
      offSpeak()
      offStop()
      offVolume()
      stopSimulatedSpeech()
    }
  }, [lipSync, startSimulatedSpeech, stopSimulatedSpeech])

  // --------------------------------------------
  // AI 动作指令（companion_control 工具 → 主进程 → 本窗口）
  //
  // 由主窗口的 AI 主动调用，用于「AI 控制桌面伴侣」：
  // 播放动作 / 切换表情 / 说话 / 视线 / 复位。
  // --------------------------------------------
  const handleCommand = useCallback(
    (cmd: VrmCompanionCommand): void => {
      try {
        switch (cmd.type) {
          case 'speak': {
            const text = cmd.text ?? ''
            setSubtitle(text)
            startSimulatedSpeech(text, cmd.durationMs)
            break
          }

          case 'stop_speak': {
            stopSimulatedSpeech()
            lipSync.reset()
            setSubtitle('')
            break
          }

          case 'play_action': {
            if (!cmd.name) {
              // 未指定名称 → 随机播一个
              stageRef.current?.playAction()
              break
            }
            const resolved = resolveActionName(cmd.name, animations)
            if (!resolved) {
              showVoiceError(`未找到动作「${cmd.name}」`)
              break
            }
            stageRef.current?.playAction(resolved)
            break
          }

          case 'expression': {
            stageRef.current?.setExpression(cmd.name ?? 'happy', cmd.weight, cmd.durationMs)
            break
          }

          case 'reset': {
            stageRef.current?.stopAction()
            stageRef.current?.clearExpression()
            stageRef.current?.setLookAt('cursor')
            stopSimulatedSpeech()
            lipSync.reset()
            setSubtitle('')
            break
          }

          case 'look_at': {
            stageRef.current?.setLookAt(cmd.target ?? 'cursor')
            break
          }

          default:
            logger.system.warn('[VrmCompanion] Unknown command:', cmd)
        }
      } catch (err) {
        logger.system.warn('[VrmCompanion] Command failed:', err)
      }
    },
    [animations, lipSync, showVoiceError, startSimulatedSpeech, stopSimulatedSpeech],
  )

  useEffect(() => {
    const off = api.vrmCompanion.onCommand((cmd) => handleCommand(cmd))
    return off
  }, [handleCommand])

  // --------------------------------------------
  // 控制栏交互
  // --------------------------------------------
  const handleSelectModel = useCallback(
    async (id: string) => {
      const res = await api.vrmCompanion.selectModel(id)
      if (res.success && res.data) setConfig(res.data)
      await loadModels()
    },
    [loadModels],
  )

  const handleImportModel = useCallback(async () => {
    const res = await api.vrmCompanion.importModel()
    if (!res.success) {
      if (res.error && res.error !== 'CANCELED') setError('导入失败')
      return
    }
    const list = await loadModels()
    if (res.data?.id) {
      await handleSelectModel(res.data.id)
    } else if (list.length > 0) {
      await handleSelectModel(list[list.length - 1].id)
    }
  }, [handleSelectModel, loadModels])

  /** 切换鼠标穿透（持久化）：关闭后窗口恢复完整交互，开启后点击穿透到桌面 */
  const handleToggleClickThrough = useCallback(async () => {
    // 直接读配置而不是派生变量：派生的 clickThrough 在下面才声明，
    // 这里若引用它会触发「块级变量先使用」错误
    const current = config?.clickThrough ?? true
    const next = !current
    const res = await api.vrmCompanion.setClickThrough(next)
    if (!res.success) return
    // 主进程会回推完整配置；这里先乐观更新，避免按钮状态闪回
    const value = res.data?.clickThrough ?? next
    setConfig((prev) => (prev ? { ...prev, clickThrough: value } : prev))
    // 关闭穿透后窗口立即恢复完整交互，而指针此刻正停在按钮上：
    // DOM 的 mouseenter 不一定再补发（指针原本就在窗口内），若只依赖它会「刚关完按钮就消失」，
    // 因此按已知的「指针在窗内」直接补一次悬停态。
    if (!value && pointerInsideRef.current) setHovered(true)
  }, [config?.clickThrough])

  /**
   * 增量更新配置并同步本地状态。
   *
   * 待机动作 / 自动隐藏等快捷开关共用：主进程写盘后会回推完整配置，
   * 以回推值为准可避免与设置面板出现状态分歧。
   */
  const patchConfig = useCallback(async (partial: Partial<VrmCompanionConfig>) => {
    try {
      const res = await api.vrmCompanion.updateConfig(partial)
      if (res.success && res.data) setConfig(res.data)
    } catch (err) {
      logger.system.warn('[VrmCompanion] updateConfig failed:', err)
    }
  }, [])

  /** 切换「锁定位置」：锁定后无法拖动，避免误触移动窗口 */
  const handleToggleLock = useCallback(async () => {
    await patchConfig({ locked: !(config?.locked ?? false) })
  }, [config?.locked, patchConfig])

  /** 视角复位：拖动旋转后一键回到正面机位 */
  const handleResetView = useCallback(() => {
    stageRef.current?.resetView()
  }, [])

  const handleHide = useCallback(() => {
    void api.vrmCompanion.hide()
  }, [])

  const handleCycleModel = useCallback(() => {
    if (models.length === 0) return
    const currentId = config?.modelId ?? models[0]?.id
    const index = models.findIndex((m) => m.id === currentId)
    const next = models[(index + 1) % models.length]
    if (next) void handleSelectModel(next.id)
  }, [config?.modelId, handleSelectModel, models])

  // --------------------------------------------
  // 派生
  // --------------------------------------------
  const currentModelUrl = useMemo(() => {
    if (models.length === 0) return null
    const selected = config?.modelId ? models.find((m) => m.id === config.modelId) : undefined
    return (selected ?? models[0]).url
  }, [config?.modelId, models])

  const scale = config?.scale ?? 1

  /**
   * 进入待机队列的动作 URL。
   *
   * 只取 idleFriendly：spin / squat / show_full_body / shoot 这类动作幅度大或
   * 涉及下肢位移，在伴侣窗口的「上半身近景」构图中会跑出取景框，
   * 与「安静陪在桌面一角」的定位不符。
   */
  const idleAnimationUrls = useMemo(
    () => animations.filter((a) => a.idleFriendly).map((a) => a.url),
    [animations],
  )

  // --------------------------------------------
  // 鼠标穿透 / 悬停交互
  //
  // 默认开启穿透：点击直接落到桌面，伴侣不该抢走桌面的操作。
  // 但穿透不能把操作入口一起锁死 —— 鼠标移到角色上仍要浮出控制栏，
  // 指针压到控制栏上时窗口临时接管鼠标事件（用完立刻交还穿透）。
  //
  // 判定链路：主进程轮询指针（穿透下 DOM 事件不可靠）
  //   → 渲染层射线检测角色 + 几何命中控制栏
  //   → 上报主进程「是否接管鼠标事件」/「是否临时穿透」。
  // --------------------------------------------
  /** 穿透开关（取自持久化配置，默认开启） */
  const clickThrough = config?.clickThrough ?? true

  /** 指针是否落在控制栏热区（相对窗口右上角） */
  const isInBarZone = useCallback((clientX: number, clientY: number): boolean => {
    if (clientY < 0 || clientY > BAR_HOT_ZONE.height) return false
    return clientX >= window.innerWidth - BAR_HOT_ZONE.width
  }, [])

  /**
   * 指针是否压在控制栏上：几何热区 + DOM 命中双保险。
   *
   * 几何热区覆盖主栏与（展开后向左溢出的）子面板；
   * DOM 命中兜底工具提示等溢出元素。两者都不依赖鼠标事件投递，
   * 因此穿透状态下同样有效。
   */
  const detectBarHit = useCallback(
    (clientX: number, clientY: number): boolean => {
      if (isInBarZone(clientX, clientY)) return true
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
      return !!el?.closest('[data-vrm-interactive]')
    },
    [isInBarZone],
  )

  /** 立即收起悬停 UI（指针离开窗口时用，不留宽限，避免窗口继续接管鼠标事件） */
  const cancelPointerHot = useCallback(() => {
    if (hotTimerRef.current != null) {
      window.clearTimeout(hotTimerRef.current)
      hotTimerRef.current = null
    }
    overCharacterRef.current = false
    setPointerHot(false)
    setOverBar(false)
  }, [])

  /**
   * 合并更新悬停结果（角色 + 控制栏）。
   *
   * 变热：立即生效（操作入口要跟手）。
   * 变冷：延迟 HOVER_LEAVE_GRACE_MS 再收起，给「角色 → 控制栏」的移动留时间。
   * 注意 `overBar` 不跟着延迟 —— 它决定窗口是否接管鼠标事件，
   * 指针一离开控制栏就必须尽快交还穿透，否则又会挡住桌面点击。
   */
  const updatePointerHot = useCallback((overCharacter: boolean, overBarHit: boolean) => {
    setOverBar(overBarHit)
    if (overCharacter || overBarHit) {
      if (hotTimerRef.current != null) {
        window.clearTimeout(hotTimerRef.current)
        hotTimerRef.current = null
      }
      setPointerHot(true)
      return
    }
    if (hotTimerRef.current != null) return
    hotTimerRef.current = window.setTimeout(() => {
      hotTimerRef.current = null
      setPointerHot(false)
    }, HOVER_LEAVE_GRACE_MS)
  }, [])

  /** 用最近一次指针坐标（归一化）刷新悬停结果 */
  const refreshHot = useCallback(
    (overCharacter: boolean) => {
      const raw = pointerRef.current
      const clientX = ((raw.x + 1) / 2) * window.innerWidth
      const clientY = ((raw.y + 1) / 2) * window.innerHeight
      updatePointerHot(overCharacter, detectBarHit(clientX, clientY))
    },
    [detectBarHit, updatePointerHot],
  )

  /**
   * 指针位置订阅（主进程轮询下发）。
   *
   * 穿透模式下窗口忽略鼠标事件，DOM mousemove / mouseleave 都可能缺失或迟到，
   * 因此悬停判定一律以主进程下发的位置为准（与窗口拖拽同一套可靠方案）。
   */
  useEffect(() => {
    const off = api.vrmCompanion.onPointerState((state) => {
      pointerInsideRef.current = state.inside
      if (!state.inside) {
        pointerRef.current = { x: 0, y: 0 }
        cancelPointerHot()
        return
      }
      pointerRef.current = { x: state.x, y: state.y }
      refreshHot(overCharacterRef.current)
    })
    return () => off()
  }, [cancelPointerHot, refreshHot])

  /**
   * 角色悬停变化（VrmStage 射线检测，即时结果）。
   *
   * 穿透模式下这是「浮出控制栏」的触发点；autoHide 的淡出让位另走 onHoverChange。
   */
  const handlePointerOverChange = useCallback(
    (over: boolean) => {
      overCharacterRef.current = over
      refreshHot(over)
    },
    [refreshHot],
  )

  /**
   * 自动隐藏生效/解除 → 设置「临时穿透」。
   *
   * 与用户穿透偏好分开：临时穿透只作用于本次悬停 —— 用户关掉穿透后，
   * 自动隐藏依然能让开点击，但不会把用户偏好偷偷改回穿透。
   */
  const handleStageHoverChange = useCallback((hidden: boolean) => {
    setAutoHidden(hidden)
    void api.vrmCompanion.setTransientPassThrough(hidden).catch((err) => {
      logger.system.warn('[VrmCompanion] transient pass-through failed:', err)
    })
  }, [])

  /**
   * 是否需要在穿透状态下临时接管鼠标事件。
   *
   * 只认「指针压在控制栏上」与「拖拽中」：
   * 若按住角色也接管，角色就会挡住它下方的桌面点击 —— 穿透等于失效，
   * 而按住角色本身无需交互（旋转视角需先关闭穿透）。
   */
  const pointerInteractive = !clickThrough || overBar || dragging

  useEffect(() => {
    void api.vrmCompanion
      .setPointerInteractive(pointerInteractive)
      .catch((err) => logger.system.warn('[VrmCompanion] setPointerInteractive failed:', err))
  }, [pointerInteractive])

  /**
   * 控制栏是否显示。
   *
   * - 未穿透：鼠标在窗口内即显示
   * - 穿透：指针压在角色/控制栏上时显示；autoHide 已让位时不显示
   *   （角色都淡出了，再浮出操作栏会重新挡住刚让出来的桌面内容）
   */
  const showControls = clickThrough ? pointerHot && !autoHidden : hovered


  const handleStageReady = useCallback(() => {
    setIsModelLoading(false)
    setError(null)
  }, [])

  const handleStageError = useCallback((message: string) => {
    setIsModelLoading(false)
    setError(message)
  }, [])

  // 模型 URL 变化时进入 loading 态
  useEffect(() => {
    if (currentModelUrl) setIsModelLoading(true)
  }, [currentModelUrl])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'transparent',
        // 拖动旋转由 VrmStage 内部的 OrbitControls 接管，
        // 因此这里刻意不绑定 onMouseDown（否则会同时拖动窗口 + 旋转视角）
        cursor:
          !config?.locked && !clickThrough && hovered ? 'grab' : dragging ? 'grabbing' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => {
        setHovered(true)
        pointerInsideRef.current = true
      }}
      onMouseLeave={() => {
        setHovered(false)
        setPanelOpen(false)
        // 鼠标离开窗口时视线收回正前方
        pointerRef.current = { x: 0, y: 0 }
        // 穿透模式的悬停判定以主进程轮询为准：DOM 的 leave 会随「临时接管」切换而少发/多发，
        // 若跟着它收起，会出现「指针还在控制栏上按钮却已消失」的抖动
        if (!clickThrough) {
          pointerInsideRef.current = false
          cancelPointerHot()
        }
      }}
    >
      {/* 3D 角色舞台 */}
      {currentModelUrl ? (
        <VrmStage
          ref={stageRef}
          modelUrl={currentModelUrl}
          scale={scale}
          // 窗口隐藏时彻底停掉渲染循环：伴侣窗口关闭 backgroundThrottling 后
          // 隐藏不会自动停 rAF，不显式停就是「关了窗口 CPU 还在满速跑」
          active={bridge.windowVisible}
          mouthOpenRef={lipSync.mouthOpenRef}
          idleEnabled={config?.idleAnimation ?? true}
          lookAtEnabled={config?.lookAtCursor ?? true}
          pointerRef={pointerRef}
          pointerInsideRef={pointerInsideRef}
          animationUrls={idleAnimationUrls}
          autoHide={config?.autoHide ?? false}
          onHoverChange={handleStageHoverChange}
          onPointerOverChange={handlePointerOverChange}
          onReady={handleStageReady}
          onError={handleStageError}
        />
      ) : (
        <div style={styles.placeholder}>
          <span style={styles.placeholderText}>未检测到 VRM 模型</span>
          <span style={styles.placeholderHint}>
            在内置 models 目录或设置中导入 .vrm 文件
          </span>
        </div>
      )}

      {/* 加载中指示 */}
      {isModelLoading && currentModelUrl ? (
        <div style={styles.loadingBadge}>加载中…</div>
      ) : null}

      {/* 错误提示 */}
      {error ? <div style={styles.errorBadge}>{error}</div> : null}

      {/*
        悬浮控制栏。

        显隐规则：
        - 未开启穿透：鼠标进入窗口即显示（完整交互模式）
        - 已开启穿透（默认）：指针压在角色或控制栏上时显示 ——
          穿透不再等于「无法操作」，鼠标移到角色上依旧会浮出操作入口；
          autoHide 生效（角色已淡出让位）时不显示，避免挡住刚让出来的桌面内容。

        图标按钮 + 左侧子面板的布局参照 example/super-ai-browser：
        主栏只放高频操作（拖动 / 复位视角 / 更多 / 隐藏），其余收进子面板，
        避免按钮排长、挡占角色。
      */}
      {showControls ? (
        <div
          style={styles.controlBar}
          // 供穿透模式的几何命中检测使用（elementFromPoint 向上查找）
          data-vrm-interactive=""
          onMouseDown={(e) => e.stopPropagation()}
        >

          {/* 拖动窗口：现在唯一能移动窗口的入口（画布上的拖拽已改为旋转视角） */}
          <ControlButton
            icon={Move}
            label={config?.locked ? '位置已锁定（在「更多」里解锁）' : '按住拖动窗口'}
            onMouseDown={handleMouseDown}
          />
          {/* 语音对话：在伴侣窗口内直接对话（STT → LLM → TTS，口型随朗读音量开合） */}
          <ControlButton
            icon={voiceActive ? PhoneOff : Mic}
            label={voiceActive ? '结束语音对话' : '语音对话（点一下开始说话）'}
            active={voiceActive}
            tone={voiceActive ? 'danger' : 'default'}
            onClick={() => void (voiceActive ? stopVoice() : startVoice())}
          />
          <ControlButton icon={RotateCcw} label="复位视角" onClick={handleResetView} />
          <ControlButton
            icon={MoreVertical}
            label={panelOpen ? '收起更多操作' : '更多操作'}
            active={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          />
          <ControlButton icon={X} label="隐藏伴侣" tone="danger" onClick={handleHide} />

          {/* 子面板：收纳次要操作 */}
          {panelOpen ? (
            <div style={styles.subPanel} data-vrm-interactive="">
              <ControlButton
                icon={Shuffle}
                label={
                  models.length > 1 ? `切换模型（共 ${models.length} 个）` : '切换模型（仅 1 个）'
                }
                disabled={models.length < 2}
                onClick={handleCycleModel}
              />
              <ControlButton
                icon={Plus}
                label="导入 VRM 模型"
                onClick={() => void handleImportModel()}
              />
              <ControlButton
                icon={Sparkles}
                label={config?.idleAnimation ?? true ? '待机动作：开' : '待机动作：关'}
                active={config?.idleAnimation ?? true}
                onClick={() =>
                  void patchConfig({ idleAnimation: !(config?.idleAnimation ?? true) })
                }
              />
              <ControlButton
                icon={EyeOff}
                label={config?.autoHide ? '自动隐藏：开' : '自动隐藏：关'}
                active={config?.autoHide ?? false}
                onClick={() => void patchConfig({ autoHide: !(config?.autoHide ?? false) })}
              />
              <ControlButton
                icon={config?.locked ? Lock : Unlock}
                label={config?.locked ? '解锁位置' : '锁定位置'}
                active={config?.locked ?? false}
                onClick={() => void handleToggleLock()}
              />
              <ControlButton
                icon={MousePointerClick}
                label={
                  clickThrough
                    ? '鼠标穿透：开（点击关闭，关闭后可拖动旋转角色）'
                    : '鼠标穿透：关（点击开启，点击将穿透到桌面）'
                }
                active={clickThrough}
                onClick={() => void handleToggleClickThrough()}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        语音对话 UI。

        刻意不加 data-vrm-interactive：这些是「只读状态展示」，
        若参与控制栏命中判定，指针扫过字幕时窗口就会接管鼠标事件，
        反而挡住桌面的点击（与伴侣「默认穿透」的定位冲突）。
      */}
      {voiceActive && !voiceError ? (
        <div style={styles.voiceStatus}>
          <span style={{ ...styles.voiceDot, background: voiceDotColor(voiceChat.state) }} />
          <span>{VOICE_STATE_LABEL[voiceChat.state] ?? '语音对话'}</span>
        </div>
      ) : null}

      {voiceActive && subtitle ? <div style={styles.subtitle}>{subtitle}</div> : null}

      {/* 语音错误提示（与模型加载错误分开显示，避免互相覆盖） */}
      {voiceError ? <div style={styles.voiceErrorBadge}>{voiceError}</div> : null}

      {/* 模型名提示（区别于控制栏，始终在底部弱化展示） */}
      {showControls && models.length > 0 ? (
        <div style={styles.modelTip}>
          {models.find((m) => m.id === config?.modelId)?.name ?? models[0]?.name}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 控制栏图标按钮（悬浮提示 + 悬停反馈）。
 *
 * 参照 example/super-ai-browser 的控制面板：圆形图标按钮，悬停时轻微放大，
 * 并在按钮左侧浮出文字提示（左侧弹出不会被窗口右边缘裁掉）。
 * 用组件内 state 而不是 CSS :hover —— 本页样式全部走内联对象，写不了伪类。
 */
function ControlButton({
  icon: Icon,
  label,
  onClick,
  onMouseDown,
  active = false,
  disabled = false,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  active?: boolean
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  const [hover, setHover] = useState(false)
  const interactive = !disabled

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      onMouseDown={onMouseDown}
      style={{
        ...styles.controlButton,
        background: active
          ? 'rgba(96,165,250,0.30)'
          : hover && interactive
            ? 'rgba(255,255,255,0.16)'
            : 'rgba(255,255,255,0.06)',
        color:
          tone === 'danger' && hover && interactive
            ? 'rgba(255,140,140,1)'
            : active
              ? 'rgba(147,197,253,1)'
              : 'rgba(255,255,255,0.9)',
        transform: hover && interactive ? 'scale(1.08)' : 'scale(1)',
        cursor: interactive ? 'pointer' : 'default',
        opacity: interactive ? 1 : 0.4,
      }}
    >
      <Icon size={15} strokeWidth={2.1} />
      <span style={{ ...styles.tooltip, opacity: hover ? 1 : 0 }}>{label}</span>
    </button>
  )
}

// ============================================
// 内联样式（伴侣窗口为独立极简页面，不引入 Tailwind 依赖链）
// ============================================

const styles: Record<string, React.CSSProperties> = {
  placeholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: 'rgba(255,255,255,0.85)',
    textShadow: '0 1px 4px rgba(0,0,0,0.55)',
    fontSize: 12,
    pointerEvents: 'none',
  },
  placeholderText: {
    fontSize: 13,
    fontWeight: 600,
  },
  placeholderHint: {
    fontSize: 11,
    opacity: 0.7,
  },
  loadingBadge: {
    position: 'absolute',
    top: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    fontSize: 11,
    pointerEvents: 'none',
  },
  errorBadge: {
    position: 'absolute',
    bottom: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '90%',
    padding: '4px 10px',
    borderRadius: 8,
    background: 'rgba(220,38,38,0.85)',
    color: '#fff',
    fontSize: 11,
    textAlign: 'center',
    pointerEvents: 'none',
  },
  controlBar: {
    position: 'absolute',
    top: 8,
    right: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    background: 'rgba(20,20,24,0.72)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.12)',
    // 悬浮提示会溢出到按钮左侧，不能被裁剪
    overflow: 'visible',
  },
  subPanel: {
    position: 'absolute',
    right: '100%',
    top: 0,
    marginRight: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    background: 'rgba(20,20,24,0.78)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.12)',
  },
  controlButton: {
    position: 'relative',
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: 'none',
    padding: 0,
    lineHeight: 1,
    transition: 'background 0.15s ease, color 0.15s ease, transform 0.15s ease',
  },
  tooltip: {
    position: 'absolute',
    right: 'calc(100% + 10px)',
    top: '50%',
    transform: 'translateY(-50%)',
    padding: '3px 8px',
    borderRadius: 6,
    background: 'rgba(0,0,0,0.86)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    fontSize: 11,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transition: 'opacity 0.16s ease',
  },
  modelTip: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(0,0,0,0.45)',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  /** 语音状态胶囊（连接中 / 在听 / 思考 / 回答） */
  voiceStatus: {
    position: 'absolute',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(10,12,16,0.78)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  voiceDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.2s ease',
  },
  /** 字幕气泡：AI 流式回复（最多 3 行） */
  subtitle: {
    position: 'absolute',
    bottom: 52,
    left: 8,
    right: 8,
    maxHeight: 54,
    overflow: 'hidden',
    padding: '5px 9px',
    borderRadius: 10,
    background: 'rgba(10,12,16,0.72)',
    backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.94)',
    fontSize: 11,
    lineHeight: 1.5,
    textAlign: 'left',
    pointerEvents: 'none',
  },
  voiceErrorBadge: {
    position: 'absolute',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '92%',
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(185,28,28,0.88)',
    color: '#fff',
    fontSize: 11,
    textAlign: 'center',
    pointerEvents: 'none',
  },
}
