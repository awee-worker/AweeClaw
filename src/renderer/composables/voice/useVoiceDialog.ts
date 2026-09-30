/**
 * 语音对话编排 Hook（并入当前聊天会话）
 *
 * 定位：输入框长按进入的语音对话，产物直接落在当前会话里 ——
 * 本 hook 只负责「耳朵」和「嘴」，不再自成一套对话历史：
 *
 *   麦克风 → VAD 断句 → STT → 文本
 *                              ↓
 *                       Agent.send()（聊天主链路）
 *                              ↓
 *                   订阅 messages 增量 → 分句 TTS → 扬声器
 *
 * 与 useVoiceChat 的区别：后者是自闭环的独立语音会话（头像窗口、桌面伴侣
 * 使用），自带 LLM 会话与历史归档；本 hook 只在主聊天窗口使用，生成权交给
 * Agent.send，因此工具、审批、上下文压缩、检查点等能力全部原样复用。
 * 两者共用 @utils/voiceTextUtils 的断句与文本清洗规则，播报节奏一致。
 *
 * 打断分级（见 triggerBargeIn）：
 *   - AI 播报中   → 停播即可，生成早已结束，不动会话
 *   - LLM 生成中  → abort 本轮，新话作为下一轮继续
 *   - 工具执行中  → 不打断，新话排队等工具跑完（副作用不可回滚）
 *   - 等待审批    → 高危交还控制权，低危走语音确认
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { convertBlobToWav } from '../../utils/audioConverter'
import { voiceApi } from '../../services/voiceApi'
import {
  stripNonSpeakableContent,
  isEndConversationCommand,
  normalizeSpeechText,
  takeSpeakableSegment,
  takeTailSegment,
} from '../../utils/voiceTextUtils'
import { getMessageText, isAssistantMessage } from '@intelligence/providerTypes'
import type { ChatMessage } from '@intelligence/providerTypes'
import type { PendingToolApproval, StreamState } from '@intelligence/types/dialogThreadModel'
import { isIrreversibleTool, isRiskyCommand } from '@intelligence/decision/approvalEscalation'
import { StorageService } from '@shared/toolkit/StorageService'
import { toast } from '@components/foundation/NotificationProvider'

/** 语音对话界面状态 */
export type VoiceDialogState =
  | 'idle'         // 未激活
  | 'connecting'   // 申请麦克风
  | 'listening'    // 聆听中
  | 'recording'    // 检测到用户说话
  | 'processing'   // 已提交，等 AI
  | 'speaking'     // 播报中
  | 'paused'       // 因高危审批暂停，控制权已交还
  | 'error'

/** 采样率：与语音链路其它环节保持一致 */
const SAMPLE_RATE = 16000

/** VAD 检测间隔（ms） */
const VAD_CHECK_INTERVAL = 100

/** 说话检测阈值（RMS） */
const VAD_THRESHOLD = 0.015

/** 最短说话时长，短于此视为噪音（咳嗽、敲键） */
const VAD_MIN_SPEECH_TIME = 300

/**
 * 双阈值发送
 *
 * 单阈值（静音即发）的痛点是用户思考时话没说完就被抢先发出去。改成两级：
 * 静音满 PENDING 先给出「即将发送」的视觉提示，中途恢复说话则取消；
 * 满 SEND 才真正提交。等待期用户看得见，也来得及补话。
 */
const VAD_PENDING_SILENCE_MS = 700
const VAD_SEND_SILENCE_MS = 1400

/** 单次录音上限：长时间不停顿的连续说话不能无限攒着 */
const MAX_UTTERANCE_MS = 30000

/**
 * 抢话排队后的续发延迟
 *
 * 工具循环里 streamState 的 phase 会在两轮工具之间短暂回落到 idle，
 * 若一回落就立刻续发，新消息会插进工具调用的间隙、把还没跑完的循环打断。
 * 等这段静默期过去再二次确认，才说明工具循环真的收尾了。
 */
const QUEUE_RESUME_DELAY_MS = 700

/** 播报回采保护：起播后这段时间内不判定打断（扬声器起振与首帧瞬态） */
const INTERRUPT_GRACE_MS = 420

/** 打断阈值相对说话阈值的倍数（回采经回声消除后残余有限） */
const INTERRUPT_RMS_FACTOR = 3.5

/** 需连续超阈多久才认定打断 */
const INTERRUPT_HOLD_MS = 260

/** 语音确认词（归一化后短文本才参与匹配，避免正常句子里的「好」被误判） */
const CONFIRM_WORDS = ['确认', '确定', '好的', '可以', '同意', '执行', '继续', '是的', '对的', '没问题']
const CANCEL_WORDS = ['取消', '不要', '不用', '算了', '拒绝', '停止', '别执行']
/** 参与确认词匹配的最大长度（归一化后字符数） */
const CONFIRM_MAX_LEN = 6

/** 需要用户确认的工具是否属高危（交给用户亲自点，不给语音放行通道） */
function isHighRiskApproval(tool: PendingToolApproval): boolean {
  if (isIrreversibleTool(tool.name)) return true
  if (isRiskyCommand(tool.name, tool.arguments)) return true
  return false
}

/** 解析语音确认结果：'confirm' | 'cancel' | null */
function parseConfirmIntent(text: string): 'confirm' | 'cancel' | null {
  const norm = normalizeSpeechText(text)
  if (!norm || norm.length > CONFIRM_MAX_LEN) return null
  if (CONFIRM_WORDS.some((w) => norm.includes(w))) return 'confirm'
  if (CANCEL_WORDS.some((w) => norm.includes(w))) return 'cancel'
  return null
}

export interface UseVoiceDialogOptions {
  /** 当前会话消息列表（用于订阅 AI 增量并播报） */
  messages: ChatMessage[]
  /** AI 是否正在生成 */
  isStreaming: boolean
  /** 当前线程的流式状态（判断工具是否在执行） */
  streamState: StreamState
  /** 是否在等待工具审批 */
  isAwaitingApproval: boolean
  /** 待审批的工具调用 */
  pendingApprovalToolCalls: PendingToolApproval[]
  /** 当前线程 id */
  currentThreadId: string | null
  /** 发送消息（走聊天主链路） */
  sendMessage: (content: string) => Promise<void>
  /** 中止当前生成 */
  abort: (threadId?: string) => void
  /** 放行 / 拒绝全部待审批工具 */
  approveAllTools: () => void
  rejectAllTools: () => void
  /** 语言 */
  language?: string
  /** 语音播报开关（关闭时只倾听不发声） */
  speakEnabled?: boolean
}

export interface UseVoiceDialogReturn {
  /** 语音对话是否已激活 */
  active: boolean
  /** 界面状态 */
  state: VoiceDialogState
  /** 麦克风音量 0~1（驱动波形） */
  volume: number
  /** 麦克风流（驱动波形组件） */
  stream: MediaStream | null
  /** 提示文案（抢话排队、审批等场景） */
  notice: string | null
  /** 是否已进入「即将发送」倒数（UI 显示进度） */
  pendingSend: boolean
  /** 是否在等待语音确认审批 */
  awaitingConfirm: boolean
  /** 进入语音对话 */
  enter: () => void
  /** 退出语音对话 */
  exit: () => void
  /** 手动打断当前播报/生成 */
  interrupt: () => void
}

export function useVoiceDialog(options: UseVoiceDialogOptions): UseVoiceDialogReturn {
  const [active, setActive] = useState(false)
  const [state, setState] = useState<VoiceDialogState>('idle')
  const [volume, setVolume] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingSend, setPendingSend] = useState(false)
  const [awaitingConfirm, setAwaitingConfirm] = useState(false)

  /* ------------------------------------------------------------------ */
  /* 最新参数桥（避免回调依赖频繁重建）                                  */
  /* ------------------------------------------------------------------ */

  const optionsRef = useRef(options)
  optionsRef.current = options

  /* ------------------------------------------------------------------ */
  /* 音频采集                                                            */
  /* ------------------------------------------------------------------ */

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const activeRef = useRef(false)

  /** exit 的最新引用（submitUtterance 需要调用，避免循环依赖） */
  const exitRef = useRef<(() => void) | null>(null)
  /** 是否在等待语音确认（submitUtterance 与审批 effect 需要读取最新值） */
  const awaitingConfirmRef = useRef(false)
  awaitingConfirmRef.current = awaitingConfirm
  /** 工具执行期间抢下来的话，等工具跑完自动续发 */
  const pendingQueueRef = useRef<string | null>(null)

  /* ------------------------------------------------------------------ */
  /* VAD 状态机                                                          */
  /* ------------------------------------------------------------------ */

  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadStateRef = useRef<'silence' | 'speaking'>('silence')
  const speechStartRef = useRef(0)
  const silenceStartRef = useRef(0)
  const pendingSendRef = useRef(false)
  const interruptHoldStartRef = useRef(0)
  /** 起播静默期截止时刻（performance 时钟），避开扬声器起振被当成打断 */
  const interruptGraceUntilRef = useRef(0)

  /** 本轮开口时定下的打断策略：interrupt = 掐断当前生成；queue = 排队等工具跑完 */
  const bargeInModeRef = useRef<'interrupt' | 'queue'>('interrupt')

  /* ------------------------------------------------------------------ */
  /* 播报                                                                */
  /* ------------------------------------------------------------------ */

  const ttsQueueRef = useRef<Blob[]>([])
  const isPlayingRef = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentAudioUrlRef = useRef<string | null>(null)
  const ttsPendingRef = useRef(0)

  /**
   * 播报轮次号
   *
   * 打断会清空队列，但已经发出去的合成请求还会 resolve 回来；
   * 若不校验轮次，被丢弃的那半句话会在打断后突然冒出来。
   */
  const speakTurnRef = useRef(0)

  /** playNextTts 的自身引用桥（递归播放下一段） */
  const playNextTtsRef = useRef<() => void>(() => {})

  /** 当前正在播报的 assistant 消息 id */
  const spokenMessageIdRef = useRef<string | null>(null)
  /** 已切到原文的哪个位置（流式文本会不断增长，靠它避免重念） */
  const speakCursorRef = useRef(0)
  /** 上一帧读到的原文长度，仅在增长时切句 */
  const lastRawLenRef = useRef(0)
  /** 上一帧的 isStreaming，用于捕捉「生成刚结束」这一刻补播尾巴 */
  const prevStreamingRef = useRef(options.isStreaming)

  /** 打断/退出时作废当前轮次的播报游标 */
  const resetSpeakCursor = useCallback(() => {
    spokenMessageIdRef.current = null
    speakCursorRef.current = 0
    lastRawLenRef.current = 0
  }, [])

  /* ------------------------------------------------------------------ */
  /* 播报实现                                                            */
  /* ------------------------------------------------------------------ */

  const stopTts = useCallback(() => {
    // 轮次先自增：在途的合成请求回来时会因轮次不符而自行丢弃
    speakTurnRef.current += 1
    ttsQueueRef.current = []
    ttsPendingRef.current = 0
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null
      currentAudioRef.current.onerror = null
      try {
        currentAudioRef.current.pause()
        currentAudioRef.current.src = ''
      } catch {
        // 播放器已释放，忽略
      }
      currentAudioRef.current = null
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current)
      currentAudioUrlRef.current = null
    }
    isPlayingRef.current = false
  }, [])

  /** 取下一段音频播放；播放结束后若还有排队就继续，否则回到聆听 */
  const playNextTts = useCallback(() => {
    if (isPlayingRef.current) return
    const blob = ttsQueueRef.current.shift()
    if (!blob) return

    isPlayingRef.current = true
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudioRef.current = audio
    currentAudioUrlRef.current = url

    const finish = () => {
      if (currentAudioUrlRef.current === url) {
        URL.revokeObjectURL(url)
        currentAudioUrlRef.current = null
      }
      if (currentAudioRef.current === audio) {
        currentAudioRef.current = null
      }
      isPlayingRef.current = false

      if (ttsQueueRef.current.length > 0) {
        playNextTtsRef.current()
        return
      }
      // 队列清空且没有在途合成：本轮播报结束，回到聆听
      if (activeRef.current && ttsPendingRef.current === 0 && !optionsRef.current.isStreaming) {
        setState((prev) => (prev === 'paused' ? prev : 'listening'))
      }
    }

    audio.onended = finish
    audio.onerror = finish
    void audio.play().catch(finish)
  }, [])
  playNextTtsRef.current = playNextTts

  /** 合成一段文本并入播报队列 */
  const enqueueSpeak = useCallback((raw: string) => {
    const text = stripNonSpeakableContent(raw).trim()
    if (!text) return
    if (optionsRef.current.speakEnabled === false) return

    // 记下当前轮次：合成期间若发生打断（轮次自增），这段音频自行作废
    const turn = speakTurnRef.current
    const ttsVoice = StorageService.get<string>('voice_tts_voice') || undefined
    const ttsSpeed = StorageService.get<string>('voice_tts_speed')
    const speed = ttsSpeed ? parseFloat(ttsSpeed) : undefined

    ttsPendingRef.current += 1
    void voiceApi
      .textToSpeech(text, { voice: ttsVoice, speed })
      .then((blob) => {
        if (turn !== speakTurnRef.current || !activeRef.current) return
        ttsQueueRef.current.push(blob)
        setState((prev) => (prev === 'paused' ? prev : 'speaking'))
        playNextTtsRef.current()
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[useVoiceDialog] 语音合成失败:', msg)
      })
      .finally(() => {
        if (turn !== speakTurnRef.current) return
        ttsPendingRef.current -= 1
        if (
          activeRef.current &&
          ttsPendingRef.current === 0 &&
          !isPlayingRef.current &&
          ttsQueueRef.current.length === 0 &&
          !optionsRef.current.isStreaming
        ) {
          setState((prev) => (prev === 'paused' ? prev : 'listening'))
        }
      })
  }, [])

  /* ------------------------------------------------------------------ */
  /* 订阅 AI 增量并分句播报                                              */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!active) return

    const messages = options.messages
    const streaming = options.isStreaming
    const last = messages[messages.length - 1]

    // 生成刚结束：把缓冲里不够一句长的尾巴补播一次
    const justFinished = prevStreamingRef.current && !streaming
    prevStreamingRef.current = streaming

    if (!last || !isAssistantMessage(last)) {
      return
    }

    // 换了一条 assistant 消息：游标归零，重新开始播
    if (spokenMessageIdRef.current !== last.id) {
      spokenMessageIdRef.current = last.id
      speakCursorRef.current = 0
      lastRawLenRef.current = 0
    }

    const raw = getMessageText(last.content)
    if (raw.length < lastRawLenRef.current) {
      // 内容被重写（重新生成）：游标跟着退回去，避免错位
      speakCursorRef.current = 0
    }
    lastRawLenRef.current = raw.length

    while (true) {
      const seg = takeSpeakableSegment(raw, speakCursorRef.current)
      if (!seg) break
      speakCursorRef.current = seg.end
      enqueueSpeak(seg.text)
    }

    if (justFinished) {
      const tail = takeTailSegment(raw, speakCursorRef.current)
      if (tail && tail.text.trim()) {
        speakCursorRef.current = tail.end
        enqueueSpeak(tail.text)
      }
    }
  }, [active, options.messages, options.isStreaming, enqueueSpeak])

  /**
   * 状态兜底：生成结束且没有待播报内容时回到聆听
   *
   * 覆盖「AI 只调了工具、没有文本回复」这类完全没有播报的情况 ——
   * 否则界面会一直停在 processing 上，用户以为它还在忙。
   */
  useEffect(() => {
    if (!active) return
    if (options.isStreaming) return
    const phase = options.streamState.phase
    if (phase !== 'idle' && phase !== 'error') return

    const timer = setTimeout(() => {
      if (!activeRef.current) return
      if (isPlayingRef.current || ttsPendingRef.current > 0 || ttsQueueRef.current.length > 0) return
      if (optionsRef.current.isStreaming) return
      setState((prev) => (prev === 'paused' || prev === 'recording' ? prev : 'listening'))
    }, 400)
    return () => clearTimeout(timer)
  }, [active, options.isStreaming, options.streamState.phase])

  /* ------------------------------------------------------------------ */
  /* 提交语音文本                                                        */
  /* ------------------------------------------------------------------ */

  /** 等待流式状态落回 idle：abort 之后 isStreaming 不会立刻为 false，
   *  立即 send 会被 handleSubmit 的守卫吞掉，或起两个线程 */
  const waitForIdle = useCallback(async (timeoutMs = 3000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const st = optionsRef.current.streamState
      if (st.phase === 'idle' || st.phase === 'error') return true
      await new Promise((r) => setTimeout(r, 60))
    }
    return false
  }, [])

  /**
   * 打断当前生成并把新话作为下一轮发送
   *
   * 这是整个语音链路里唯一涉及时序竞争的地方：必须先让 Agent 停下并等
   * 流式状态回落，再发送，否则新消息会被 isStreaming 守卫挡掉。
   */
  const interruptAndSend = useCallback(
    async (text: string) => {
      const { abort, currentThreadId, sendMessage } = optionsRef.current
      const freshThreadId = optionsRef.current.currentThreadId ?? undefined
      void currentThreadId

      abort(freshThreadId)
      await waitForIdle()
      await sendMessage(text)
    },
    [waitForIdle],
  )

  /** 提交一段识别结果（含结束对话、审批确认、正常发送三条分支） */
  const submitUtterance = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) {
        if (activeRef.current) setState('listening')
        return
      }

      // 1. 结束对话指令
      if (isEndConversationCommand(trimmed)) {
        toast.info('语音对话已结束', 2500)
        exitRef.current?.()
        return
      }

      // 2. 等待审批时：只解析「确认 / 取消」，不当作新消息
      if (awaitingConfirmRef.current) {
        const intent = parseConfirmIntent(trimmed)
        if (intent === 'confirm') {
          setAwaitingConfirm(false)
          setNotice(null)
          optionsRef.current.approveAllTools()
          setState('processing')
        } else if (intent === 'cancel') {
          setAwaitingConfirm(false)
          setNotice(null)
          optionsRef.current.rejectAllTools()
          setState('listening')
        } else {
          setNotice('没听清，请说「确认」或「取消」')
          setState('listening')
        }
        return
      }

      // 3. 正常发送
      const mode = bargeInModeRef.current
      const { isStreaming, streamState } = optionsRef.current

      if (mode === 'queue' && (isStreaming || streamState.phase === 'tool_pending' || streamState.phase === 'tool_running')) {
        // 工具执行中：不打断，把话记下，等工具跑完自动续上
        const queued = trimmed
        setNotice('工具执行中，已记下你的话，稍后继续')
        pendingQueueRef.current = queued
        setState('processing')
        return
      }

      if (isStreaming) {
        setState('processing')
        await interruptAndSend(trimmed)
        return
      }

      setState('processing')
      await optionsRef.current.sendMessage(trimmed)
    },
    [interruptAndSend],
  )

  /** 工具执行结束、回到空闲且有排队的文本时自动续上 */
  useEffect(() => {
    if (!active) return
    const phase = options.streamState.phase
    if (phase !== 'idle' && phase !== 'error') return
    if (!pendingQueueRef.current) return

    // 工具循环中 phase 会短暂回落，延迟一下再二次确认，避免抢在工具跑完前发出
    const timer = setTimeout(() => {
      if (!activeRef.current) return
      const queued = pendingQueueRef.current
      if (!queued) return
      const st = optionsRef.current.streamState
      if (st.phase !== 'idle' && st.phase !== 'error') return
      if (optionsRef.current.isStreaming) return

      pendingQueueRef.current = null
      setNotice(null)
      setState('processing')
      void optionsRef.current.sendMessage(queued)
    }, QUEUE_RESUME_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active, options.streamState.phase])

  /* ------------------------------------------------------------------ */
  /* 审批处理：高危交还控制权(b)、低危语音确认(c)                        */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    if (!active) return
    if (!options.isAwaitingApproval) {
      // 审批已处理完，收掉提示
      if (awaitingConfirmRef.current) setAwaitingConfirm(false)
      return
    }

    const tools = options.pendingApprovalToolCalls
    const highRisk = tools.some(isHighRiskApproval)

    if (highRisk) {
      // (b) 高危：退出语音专注态，把控制权交还给用户亲自确认
      stopTts()
      setNotice('这一步需要你亲自确认，已为你调出确认卡片')
      setState('paused')
      return
    }

    // (c) 低危：语音确认即可放行
    if (!awaitingConfirmRef.current) {
      const names = tools.map((t) => t.name).join('、')
      setAwaitingConfirm(true)
      setNotice(`要执行 ${names}，说「确认」继续，说「取消」放弃`)
      enqueueSpeak(`要执行 ${names}，确认还是取消？`)
    }
    // pendingApprovalToolCalls 是数组引用，流式期间可能每帧变化；
    // 这里只需关心「是否出现待审批」，用长度做稳定依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, options.isAwaitingApproval, options.pendingApprovalToolCalls.length, stopTts, enqueueSpeak])

  /* ------------------------------------------------------------------ */
  /* 录音与 VAD                                                          */
  /* ------------------------------------------------------------------ */

  const startRecording = useCallback(() => {
    if (!streamRef.current) return
    if (recorderRef.current && recorderRef.current.state === 'recording') return

    chunksRef.current = []
    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm' })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      recorderRef.current = recorder
    } catch (err) {
      console.warn('[useVoiceDialog] 启动录音失败:', err)
    }
  }, [])

  /** 停止录音并把音频交给 STT */
  const stopRecordingAndSubmit = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      chunksRef.current = []
      recorderRef.current = null
      if (blob.size === 0) {
        if (activeRef.current) setState('listening')
        return
      }
      void (async () => {
        try {
          setState('processing')
          const wav = await convertBlobToWav(blob)
          const result = await voiceApi.speechToText(wav, {
            language: optionsRef.current.language,
            forceLocal: true,
          })
          await submitUtterance(result.text ?? '')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.warn('[useVoiceDialog] 识别失败:', msg)
          toast.warning(`语音识别失败：${msg}`, 5000)
          if (activeRef.current) setState('listening')
        }
      })()
    }
    recorder.stop()
  }, [submitUtterance])

  /** 放弃当前录音（噪音段） */
  const discardRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = () => {
        chunksRef.current = []
        recorderRef.current = null
      }
      recorder.stop()
    }
  }, [])

  /**
   * 用户开口时的打断决策
   *
   * 播报中与生成中允许掐断；工具执行中不行 —— 副作用不可回滚，
   * 硬切会让下一轮重复执行，悬空的 tool_calls 还会让部分 Provider 直接报错。
   */
  const triggerBargeIn = useCallback(() => {
    const { isStreaming, streamState } = optionsRef.current
    const toolRunning = streamState.phase === 'tool_pending' || streamState.phase === 'tool_running'

    // 播报中：先停播。若同时还在生成，按生成中处理
    if (isPlayingRef.current) {
      stopTts()
    }

    if (toolRunning) {
      bargeInModeRef.current = 'queue'
      return
    }

    if (isStreaming) {
      bargeInModeRef.current = 'interrupt'
      const tid = optionsRef.current.currentThreadId ?? undefined
      optionsRef.current.abort(tid)
      return
    }

    bargeInModeRef.current = 'interrupt'
  }, [stopTts])

  const startVad = useCallback(() => {
    if (vadTimerRef.current) clearInterval(vadTimerRef.current)
    vadStateRef.current = 'silence'
    speechStartRef.current = 0
    silenceStartRef.current = 0
    pendingSendRef.current = false

    vadTimerRef.current = setInterval(() => {
      const analyser = analyserRef.current
      if (!analyser) return

      const data = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      setVolume(rms)

      const now = Date.now()

      // 播报中的打断判定：阈值更高、需持续超阈、且避开起播静默期
      if (isPlayingRef.current) {
        const inGrace = performance.now() < interruptGraceUntilRef.current
        const overThreshold = rms > VAD_THRESHOLD * INTERRUPT_RMS_FACTOR
        if (inGrace || !overThreshold) {
          interruptHoldStartRef.current = 0
          return
        }
        if (interruptHoldStartRef.current === 0) {
          interruptHoldStartRef.current = now
          return
        }
        if (now - interruptHoldStartRef.current < INTERRUPT_HOLD_MS) return

        interruptHoldStartRef.current = 0
        triggerBargeIn()
        startRecording()
        vadStateRef.current = 'speaking'
        speechStartRef.current = now
        setState('recording')
        return
      }

      // 正常 VAD 状态机
      if (vadStateRef.current === 'silence') {
        if (rms > VAD_THRESHOLD) {
          // 开口瞬间先决定打断策略，再开录
          if (optionsRef.current.isStreaming || isPlayingRef.current) {
            triggerBargeIn()
          } else {
            bargeInModeRef.current = 'interrupt'
          }
          vadStateRef.current = 'speaking'
          speechStartRef.current = now
          silenceStartRef.current = 0
          interruptGraceUntilRef.current = 0
          startRecording()
          setState('recording')
        }
        return
      }

      // speaking 状态
      if (rms < VAD_THRESHOLD) {
        if (silenceStartRef.current === 0) silenceStartRef.current = now
        const silentFor = now - silenceStartRef.current

        if (!pendingSendRef.current && silentFor >= VAD_PENDING_SILENCE_MS) {
          pendingSendRef.current = true
          setPendingSend(true)
        }

        if (silentFor >= VAD_SEND_SILENCE_MS) {
          if (now - speechStartRef.current >= VAD_MIN_SPEECH_TIME) {
            pendingSendRef.current = false
            setPendingSend(false)
            vadStateRef.current = 'silence'
            silenceStartRef.current = 0
            stopRecordingAndSubmit()
          } else {
            discardRecording()
            pendingSendRef.current = false
            setPendingSend(false)
            vadStateRef.current = 'silence'
            setState('listening')
          }
        }
      } else {
        // 还在说话：重置静音计时，取消即将发送
        silenceStartRef.current = 0
        if (pendingSendRef.current) {
          pendingSendRef.current = false
          setPendingSend(false)
        }
      }

      // 单次录音上限
      if (
        vadStateRef.current === 'speaking' &&
        now - speechStartRef.current >= MAX_UTTERANCE_MS
      ) {
        pendingSendRef.current = false
        setPendingSend(false)
        vadStateRef.current = 'silence'
        silenceStartRef.current = 0
        stopRecordingAndSubmit()
      }
    }, VAD_CHECK_INTERVAL)
  }, [triggerBargeIn, startRecording, stopRecordingAndSubmit, discardRecording])

  const stopVad = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
  }, [])

  /* ------------------------------------------------------------------ */
  /* 进入 / 退出                                                         */
  /* ------------------------------------------------------------------ */

  const releaseAudio = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // 已停止
      }
    }
    recorderRef.current = null
    chunksRef.current = []

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setStream(null)
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [])

  const exit = useCallback(() => {
    activeRef.current = false
    stopVad()
    stopTts()
    releaseAudio()
    resetSpeakCursor()
    pendingQueueRef.current = null
    setActive(false)
    setState('idle')
    setVolume(0)
    setNotice(null)
    setPendingSend(false)
    setAwaitingConfirm(false)
    setStream(null)
    pendingSendRef.current = false
    vadStateRef.current = 'silence'
  }, [stopVad, stopTts, releaseAudio, resetSpeakCursor])

  // 把最新引用交给 submitUtterance（避免循环依赖）
  exitRef.current = exit

  const enter = useCallback(async () => {
    if (activeRef.current) return
    setState('connecting')
    setNotice(null)

    try {
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
        },
      })

      audioContextRef.current = ctx
      streamRef.current = mediaStream
      setStream(mediaStream)

      const source = ctx.createMediaStreamSource(mediaStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      analyserRef.current = analyser

      activeRef.current = true
      prevStreamingRef.current = optionsRef.current.isStreaming

      // 进入对话时把「会话里已经存在的最后一条 AI 回复」标记为已播报。
      //
      // 这条回复是在用户开启播报之前就生成完的，补念一遍就成了
      // 「AI 都答完了还在念」。游标直接推到原文末尾，此后只有新长出来的
      // 分句才会入队 —— 生成中途进入的情况同理，进入前那部分不再回头补播。
      const history = optionsRef.current.messages
      const lastAssistant = history[history.length - 1]
      if (lastAssistant && isAssistantMessage(lastAssistant)) {
        const raw = getMessageText(lastAssistant.content)
        spokenMessageIdRef.current = lastAssistant.id
        speakCursorRef.current = raw.length
        lastRawLenRef.current = raw.length
      } else {
        // 末条不是 AI 回复（用户刚开口、或还没答）：游标归零，等它现身再播
        resetSpeakCursor()
      }

      setActive(true)
      startVad()
      setState('listening')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[useVoiceDialog] 启动麦克风失败:', msg)
      toast.warning(`无法开启语音对话：${msg}`, 5000)
      setState('error')
      setTimeout(() => {
        if (!activeRef.current) setState('idle')
      }, 2000)
    }
  }, [startVad, resetSpeakCursor])

  // 播报开始时记录起播时刻，作为打断静默期的起点
  useEffect(() => {
    if (state === 'speaking' && interruptGraceUntilRef.current === 0) {
      interruptGraceUntilRef.current = performance.now() + INTERRUPT_GRACE_MS
    }
    if (state === 'listening') {
      interruptGraceUntilRef.current = 0
    }
  }, [state])

  /* ------------------------------------------------------------------ */
  /* 手动打断                                                            */
  /* ------------------------------------------------------------------ */

  const interrupt = useCallback(() => {
    stopTts()
    const { isStreaming, streamState, abort, currentThreadId } = optionsRef.current
    const toolRunning = streamState.phase === 'tool_pending' || streamState.phase === 'tool_running'
    if (isStreaming && !toolRunning) {
      abort(currentThreadId ?? undefined)
    }
    if (activeRef.current) setState('listening')
  }, [stopTts])

  /* ------------------------------------------------------------------ */
  /* 卸载清理                                                            */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    return () => {
      activeRef.current = false
      if (vadTimerRef.current) {
        clearInterval(vadTimerRef.current)
        vadTimerRef.current = null
      }
      stopTts()
      const stream = streamRef.current
      if (stream) stream.getTracks().forEach((t) => t.stop())
      const ctx = audioContextRef.current
      if (ctx) void ctx.close().catch(() => undefined)
    }
    // 仅需在卸载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    active,
    state,
    volume,
    stream,
    notice,
    pendingSend,
    awaitingConfirm,
    enter: useCallback(() => void enter(), [enter]),
    exit,
    interrupt,
  }
}
