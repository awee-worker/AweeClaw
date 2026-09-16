/**
 * 语音输入 Hook（实时流式听写）
 *
 * 架构：WebAudio 原始 PCM 采集 → 能量 VAD 分段 → 分段识别 → 边说边出字
 *
 *   MediaStream ──► AudioContext(16k) ──► ScriptProcessor(每帧 4096 样本)
 *                        │
 *                        ├─ RMS 能量 VAD（底噪自适应）
 *                        │    ├─ 静音 ≥ 600ms 且本段有效 → 提交本段（并入已确认文本）
 *                        │    └─ 说话中每 ≥ 800ms → 对当前段做一次预览识别
 *                        │
 *                        └─ 保留全量 PCM（停止时兜底，保证不丢内容）
 *
 * 为什么不用 MediaRecorder：
 * 容器格式（webm/opus）必须等 `stop` 之后才能交给 decodeAudioData 解码，
 * 因此「说话过程中」拿不到任何可提交的音频，只能等用户点停止才出结果。
 * 直接采集原始 PCM 后，任意时刻都能即时编码出合法 WAV，实时识别才成立。
 *
 * 引擎差异处理：
 * - 离线引擎（sherpa-onnx）：段级识别代价低，开启段内预览，出字最快
 * - 云端引擎：按音频时长计费，段内预览降频（2.5s），主要靠「说完一句就提交」
 *
 * @module composables/useVoiceInput
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '../services/voiceApi';
import { resolveVoiceRoute } from '../services/localVoiceEngine';
import { encodePcmChunksToWavBlob } from '../utils/audioConverter';
import { toast } from '@components/foundation/NotificationProvider';
import { tryRefreshToken, getAccessToken } from '../adapters/backendApi';

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'processing';

interface UseVoiceInputOptions {
  language?: string;
  /** 最终识别结果（停止录音后回调，为整段累计文本） */
  onResult?: (text: string) => void;
  /** 实时识别文本（说话过程中高频回调，用于即时上屏） */
  onPartialResult?: (text: string) => void;
  onError?: (error: Error) => void;
}

interface UseVoiceInputReturn {
  state: RecordingState;
  stream: MediaStream | null;
  /** 本次录音的实时累计文本（已确认段落 + 当前段预览） */
  partialText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  cancelRecording: () => void;
  duration: number;
}

function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('401') || err.message.includes('Unauthorized');
  }
  return false;
}

/** 采集帧大小（样本数）：4096 @16k ≈ 256ms，兼顾 VAD 粒度与回调开销 */
const PCM_FRAME_SIZE = 4096;

/** 目标采样率（sherpa 模型要求 16k；AudioContext 未生效时由 Python 侧重采样兜底） */
const TARGET_SAMPLE_RATE = 16000;

/** 静音持续该时长即判定「一句话说完」，提交该段 */
const SILENCE_END_MS = 600;

/** 有效语音段的最短时长（过滤咳嗽、敲击等瞬态噪声） */
const MIN_SEGMENT_MS = 400;

/** 单段最长时长：用户一口气不停时强制断段，避免预览识别越来越慢 */
const MAX_SEGMENT_MS = 12_000;

/** 段内预览：触发间隔 / 最小新增音频 / 最小段时长（离线引擎） */
const INTERIM_INTERVAL_MS = 800;
const INTERIM_MIN_NEW_MS = 350;
const INTERIM_MIN_SEGMENT_MS = 500;

/** 云端引擎的段内预览间隔（云端按音频时长计费，需降频） */
const CLOUD_INTERIM_INTERVAL_MS = 2500;

/** 静音判定：阈值下限、底噪倍数、底噪校准帧数 */
const MIN_RMS_THRESHOLD = 0.006;
const NOISE_FLOOR_MULTIPLIER = 3;
const CALIBRATION_FRAMES = 3;

/** 计算一帧的均方根能量（音量强度的常用度量） */
function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** 是否属于中日韩文字 / 全角标点（这类字符之间不插空格） */
function isCjk(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0x4e00 && code <= 0x9fff) || // 汉字
    (code >= 0xf900 && code <= 0xfaff) || // 兼容汉字
    (code >= 0xff00 && code <= 0xffef) // 全角字符
  );
}

/**
 * 语音文本拼接：中文之间不加空格，英文单词之间补一个空格。
 * 供调用方把「输入框原有内容 + 语音识别结果」自然接起来。
 */
export function appendVoiceText(base: string, text: string): string {
  const left = (base || '').trimEnd();
  const right = (text || '').trimStart();
  if (!left) return right;
  if (!right) return left;
  const needSpace = !isCjk(left[left.length - 1]) && !isCjk(right[0]);
  return `${left}${needSpace ? ' ' : ''}${right}`;
}

/** 按语种规则拼装多个段落 */
function joinSegments(parts: string[]): string {
  return parts.reduce((acc, part) => appendVoiceText(acc, part), '');
}

/** 创建采集用 AudioContext（兼容旧版 webkit 前缀） */
function createAudioContext(sampleRate: number): AudioContext {
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    AudioContext;
  return new Ctor({ sampleRate });
}

export function useVoiceInput(options?: UseVoiceInputOptions): UseVoiceInputReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [partialText, setPartialText] = useState('');

  // 回调与配置放 ref：避免闭包过期（onResult 常依赖调用方 state），
  // 同时让内部函数保持稳定引用，不会因每次渲染重建
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const startingRef = useRef(false);

  /** 已确认（整段识别完成）的段落文本 */
  const finalizedRef = useRef<string[]>([]);
  /** 当前段未提交的 PCM 帧 */
  const segmentRef = useRef<Float32Array[]>([]);
  const segmentSamplesRef = useRef(0);
  /** 本次录音的全量 PCM 帧（无任何段落识别成功时兜底） */
  const allPcmRef = useRef<Float32Array[]>([]);
  /** 当前段的最新预览文本（会被下次预览或提交覆盖） */
  const interimRef = useRef('');
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE);

  const silenceMsRef = useRef(0);
  const calibrationRef = useRef({ frames: 0, minRms: Number.POSITIVE_INFINITY });
  const noiseFloorRef = useRef(MIN_RMS_THRESHOLD);
  /** 本段 / 本次是否检测到过有效语音（纯静音的片段不必送识别） */
  const segmentHasSpeechRef = useRef(false);
  const allHasSpeechRef = useRef(false);
  const lastInterimAtRef = useRef(0);
  const lastInterimSamplesRef = useRef(0);

  const authFailedRef = useRef(false);
  const isStoppedRef = useRef(false);
  /** 本次是否走云端引擎（决定段内预览的频率） */
  const cloudAsrRef = useRef(false);

  /** 识别任务串行队列：保证文本顺序，且不并发抢占 CPU / 网络 */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const busyRef = useRef(0);

  const releaseAudio = useCallback(() => {
    const processor = processorRef.current;
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* ignore */ }
      processorRef.current = null;
    }

    const source = sourceRef.current;
    if (source) {
      try { source.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }

    const ctx = audioContextRef.current;
    if (ctx) {
      audioContextRef.current = null;
      void ctx.close().catch(() => undefined);
    }
  }, []);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const resetBuffers = useCallback(() => {
    finalizedRef.current = [];
    segmentRef.current = [];
    segmentSamplesRef.current = 0;
    allPcmRef.current = [];
    interimRef.current = '';
    silenceMsRef.current = 0;
    lastInterimAtRef.current = 0;
    lastInterimSamplesRef.current = 0;
    calibrationRef.current = { frames: 0, minRms: Number.POSITIVE_INFINITY };
    noiseFloorRef.current = MIN_RMS_THRESHOLD;
    segmentHasSpeechRef.current = false;
    allHasSpeechRef.current = false;
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    releaseAudio();
    resetBuffers();
    setDuration(0);
    releaseStream();
  }, [releaseAudio, resetBuffers, releaseStream]);

  /** 用「已确认段落 + 当前段预览」刷新实时文本 */
  const flushPartial = useCallback(() => {
    const parts = [...finalizedRef.current];
    if (interimRef.current) parts.push(interimRef.current);
    const text = joinSegments(parts);
    setPartialText(text);
    optionsRef.current?.onPartialResult?.(text);
  }, []);

  /** 串行执行识别任务 */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    busyRef.current += 1;
    const run = queueRef.current.then(task, task);
    queueRef.current = run.then(
      () => { busyRef.current -= 1; },
      () => { busyRef.current -= 1; },
    );
    return run;
  }, []);

  /** 识别一段 PCM；返回 null 表示失败或鉴权已失效 */
  const transcribe = useCallback(async (pcm: Float32Array[]): Promise<string | null> => {
    if (authFailedRef.current) return null;

    let samples = 0;
    for (const chunk of pcm) samples += chunk.length;
    if (samples === 0) return null;

    const wav = encodePcmChunksToWavBlob(pcm, sampleRateRef.current);
    try {
      const result = await voiceApi.speechToText(wav, {
        language: optionsRef.current?.language,
        noAuthRetry: true,
      });
      return result.text ?? '';
    } catch (err) {
      if (isAuthError(err)) authFailedRef.current = true;
      // 流式过程中的单段失败不弹窗打扰，最终无结果时由停止流程统一提示
      console.warn('[useVoiceInput] 识别失败:', err);
      return null;
    }
  }, []);

  /** 提交当前段：进入识别队列，成功后并入已确认文本 */
  const commitSegment = useCallback(() => {
    const pcm = segmentRef.current;
    const samples = segmentSamplesRef.current;
    const hasSpeech = segmentHasSpeechRef.current;

    segmentRef.current = [];
    segmentSamplesRef.current = 0;
    segmentHasSpeechRef.current = false;
    interimRef.current = '';
    silenceMsRef.current = 0;

    // 纯静音片段直接丢弃，不必占用一次识别
    if (!hasSpeech) return;
    if (samples === 0) return;
    if ((samples / sampleRateRef.current) * 1000 < MIN_SEGMENT_MS) return;

    void enqueue(async () => {
      const text = await transcribe(pcm);
      if (text) finalizedRef.current.push(text);
      flushPartial();
    });
  }, [enqueue, transcribe, flushPartial]);

  /** 段内预览：让「还没说完的这句话」也能提前上屏 */
  const maybePreview = useCallback(() => {
    const segmentMs = (segmentSamplesRef.current / sampleRateRef.current) * 1000;
    if (segmentMs < INTERIM_MIN_SEGMENT_MS) return;

    // 队列忙时跳过本次预览：预览只服务于即时反馈，积压反而拖慢正式识别
    if (busyRef.current > 0) return;

    const interval = cloudAsrRef.current ? CLOUD_INTERIM_INTERVAL_MS : INTERIM_INTERVAL_MS;
    const now = Date.now();
    if (now - lastInterimAtRef.current < interval) return;

    const newSamples = segmentSamplesRef.current - lastInterimSamplesRef.current;
    if ((newSamples / sampleRateRef.current) * 1000 < INTERIM_MIN_NEW_MS) return;

    lastInterimAtRef.current = now;
    lastInterimSamplesRef.current = segmentSamplesRef.current;

    const pcm = [...segmentRef.current];
    void enqueue(async () => {
      const text = await transcribe(pcm);
      if (text) {
        interimRef.current = text;
        flushPartial();
      }
    });
  }, [enqueue, transcribe, flushPartial]);

  /** 单帧 PCM：缓存 → 能量 VAD → 分段提交 / 段内预览 */
  const handleFrame = useCallback((frame: Float32Array) => {
    if (isStoppedRef.current) return;

    const sampleRate = sampleRateRef.current;
    const frameMs = (frame.length / sampleRate) * 1000;

    allPcmRef.current.push(frame);
    segmentRef.current.push(frame);
    segmentSamplesRef.current += frame.length;

    const rms = computeRms(frame);

    // 底噪校准：取开头若干帧的最低能量作为环境噪声基线。
    // 若用户在第一帧就开始说话，最低值会被抬高，故再设一个上限兜底。
    const cal = calibrationRef.current;
    if (cal.frames < CALIBRATION_FRAMES) {
      cal.minRms = Math.min(cal.minRms, rms);
      cal.frames += 1;
      if (cal.frames === CALIBRATION_FRAMES) {
        const floor = Number.isFinite(cal.minRms) ? cal.minRms : MIN_RMS_THRESHOLD;
        noiseFloorRef.current = Math.min(floor, MIN_RMS_THRESHOLD * 3);
      }
    }

    const threshold = Math.max(noiseFloorRef.current * NOISE_FLOOR_MULTIPLIER, MIN_RMS_THRESHOLD);

    if (rms >= threshold) {
      // 检测到有效语音：标记本段与整次录音，供提交 / 兜底时判断是否值得识别
      segmentHasSpeechRef.current = true;
      allHasSpeechRef.current = true;
      silenceMsRef.current = 0;
    } else if (cal.frames >= CALIBRATION_FRAMES) {
      // 校准期不累计静音，避免把开头的话当成静音起点而误提交
      silenceMsRef.current += frameMs;
    }

    const segmentMs = (segmentSamplesRef.current / sampleRate) * 1000;

    // 1) 一句话说完（静音足够）→ 提交本段
    if (silenceMsRef.current >= SILENCE_END_MS && segmentMs >= MIN_SEGMENT_MS) {
      commitSegment();
      return;
    }

    // 2) 一口气不停 → 强制断段，避免单段无限增长拖慢预览
    if (segmentMs >= MAX_SEGMENT_MS) {
      commitSegment();
      return;
    }

    // 3) 段内实时预览
    maybePreview();
  }, [commitSegment, maybePreview]);

  const startRecording = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      setState('requesting');
      setPartialText('');
      cleanup();
      authFailedRef.current = false;
      isStoppedRef.current = false;
      busyRef.current = 0;
      queueRef.current = Promise.resolve();

      if (!getAccessToken()) {
        const refreshed = await tryRefreshToken();
        if (!refreshed) {
          setState('idle');
          toast.error('Login expired, please log in again');
          optionsRef.current?.onError?.(new Error('Auth expired'));
          return;
        }
      }

      // 探测走离线还是云端：离线引擎段级识别代价低，预览可以更密；
      // 云端按音频时长计费，预览降频（段落提交频率不受影响）
      try {
        const route = await resolveVoiceRoute('asr');
        cloudAsrRef.current = route.primary !== 'local';
      } catch {
        cloudAsrRef.current = true;
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: TARGET_SAMPLE_RATE,
          channelCount: 1,
        },
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      // 直接采集原始 PCM：任意时刻都能立即编码出可提交的 WAV，
      // 无需等停止录音后再从容器格式解码（那是「停止后才出字」的根因）
      const ctx = createAudioContext(TARGET_SAMPLE_RATE);
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      sampleRateRef.current = ctx.sampleRate || TARGET_SAMPLE_RATE;

      const source = ctx.createMediaStreamSource(mediaStream);
      sourceRef.current = source;

      const processor = ctx.createScriptProcessor(PCM_FRAME_SIZE, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        // inputBuffer 会被复用，必须拷贝一份再缓存
        handleFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      // ScriptProcessor 需接入输出链路才会触发回调；
      // 回调不写 outputBuffer，输出默认为静音，不会产生回声
      processor.connect(ctx.destination);

      startTimeRef.current = Date.now();
      setState('recording');

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (err) {
      cleanup();
      setState('idle');
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : err instanceof Error
            ? err.message
            : 'Failed to start recording';
      toast.error(msg);
      optionsRef.current?.onError?.(new Error(msg));
    } finally {
      startingRef.current = false;
    }
  }, [cleanup, handleFrame]);

  const stopRecording = useCallback(() => {
    if (isStoppedRef.current) return;
    isStoppedRef.current = true;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 先断开采集，防止停止后仍有新帧写入缓冲
    releaseAudio();
    releaseStream();

    const tailSamples = segmentSamplesRef.current;
    const tailHasSpeech = segmentHasSpeechRef.current;
    const tailPcm = [...segmentRef.current];
    const allPcm = [...allPcmRef.current];
    const hasAnySpeech = allHasSpeechRef.current;

    segmentRef.current = [];
    segmentSamplesRef.current = 0;
    segmentHasSpeechRef.current = false;

    if (allPcm.length === 0) {
      resetBuffers();
      setDuration(0);
      setPartialText('');
      setState('idle');
      return;
    }

    // 全程没检测到有效语音：不发起任何识别请求，直接提示
    if (!hasAnySpeech) {
      resetBuffers();
      setDuration(0);
      setPartialText('');
      setState('idle');
      toast.error('No speech detected, please try again');
      return;
    }

    setState('processing');

    void (async () => {
      // 1) 等已排队的段落识别落盘，保证段落顺序与完整性
      await queueRef.current;

      // 2) 收尾段：最后一句若未达静音判定，在这里补提交
      if (tailHasSpeech && (tailSamples / sampleRateRef.current) * 1000 >= MIN_SEGMENT_MS) {
        const text = await transcribe(tailPcm);
        if (text) finalizedRef.current.push(text);
      }

      // 3) 兜底：全程没有任何有效段落（如环境噪声导致阈值判断偏差、
      //    说话过短未成段），用完整音频再识别一次，确保不丢内容
      if (finalizedRef.current.length === 0) {
        const text = await transcribe(allPcm);
        if (text) finalizedRef.current.push(text);
      }

      const text = joinSegments(finalizedRef.current);

      resetBuffers();
      setDuration(0);
      setPartialText('');
      setState('idle');

      if (text) {
        optionsRef.current?.onResult?.(text);
      } else if (authFailedRef.current) {
        toast.error('Login expired, please re-login');
      } else {
        toast.error('No speech detected, please try again');
      }
    })();
  }, [releaseAudio, releaseStream, resetBuffers, transcribe]);

  const cancelRecording = useCallback(() => {
    isStoppedRef.current = true;
    cleanup();
    setState('idle');
    setPartialText('');
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    stream,
    partialText,
    startRecording,
    stopRecording,
    cancelRecording,
    duration,
  };
}
