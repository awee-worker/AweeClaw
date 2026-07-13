/**
 * useVoiceRealtime - 实时语音对话 Hook
 *
 * 自然对话流程：
 * 1. 连接后自动开始聆听（持续录音）
 * 2. 后端 VAD 检测到用户说完 → 发送 stt_final
 * 3. 前端收到 stt_final → 停止录音（发送 isFinal）→ 进入 processing 状态
 * 4. 后端处理 LLM → 发送 tts_audio → 前端播放音频，进入 speaking 状态
 * 5. 后端发送 tts_end → 前端重新开始录音，回到 listening 状态
 * 6. 用户在 AI 说话时开口 → 前端检测到音频 → 发送 interrupt → 停止 TTS 播放
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  VoiceRealtimeService,
  type VoiceMode,
  type VoiceRealtimeCallbacks,
  type VoiceCommand,
} from '../services/voiceRealtime';

export type RealtimeVoiceState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

interface UseVoiceRealtimeOptions {
  language?: string;
  mode?: VoiceMode;
  enableVad?: boolean;
  vadSilenceDuration?: number;
  /** LLM provider（如 openai、deepseek、azure 等） */
  provider?: string;
  /** LLM model id（如 gpt-4o、deepseek-chat 等） */
  model?: string;
  /** 自定义系统提示词 */
  systemPrompt?: string;
  /** 会话线程 ID（可选） */
  threadId?: string;
  /**
   * 语音流水线模式
   * - classic: STT → LLM → TTS（默认）
   * - realtime: 端到端语音模型
   * 不传时后端会根据 model 名自动判断
   */
  pipeline?: 'classic' | 'realtime';
  /** 端到端模式的配置（仅 pipeline=realtime 时使用） */
  realtimeConfig?: {
    endpoint?: string;
    apiKey?: string;
    voice?: string;
    serverVad?: boolean;
  };
  /** 用户自定义的 STT/TTS 配置（自定义模式下传入后端） */
  userVoiceConfig?: {
    sttEnabled: boolean;
    sttProvider?: string;
    sttModel?: string;
    sttApiKey?: string;
    sttBaseUrl?: string;
    sttLanguage?: string;
    ttsEnabled: boolean;
    ttsProvider?: string;
    ttsModel?: string;
    ttsVoice?: string;
    ttsApiKey?: string;
    ttsBaseUrl?: string;
    ttsSpeed?: number;
  };
  onSttResult?: (text: string) => void;
  onTtsAudioChunk?: (base64Data: string, contentType: string) => void;
  /** AI 文本增量回调（流式，每次推送一部分文字） */
  onAiText?: (text: string, isFinal: boolean) => void;
  /** AI 文本全部完成回调 */
  onAiTextEnd?: (fullText: string) => void;
  onCommand?: (command: VoiceCommand) => void;
  onError?: (error: { code: string; message: string }) => void;
}

interface UseVoiceRealtimeReturn {
  state: RealtimeVoiceState;
  mode: VoiceMode;
  stream: MediaStream | null;
  sttText: string;
  /** AI 当前回复文本（流式累积） */
  aiText: string;
  sessionId: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => Promise<void>;
  stopListening: () => void;
  interrupt: () => void;
  setMode: (mode: VoiceMode) => void;
}

export function useVoiceRealtime(
  options?: UseVoiceRealtimeOptions,
): UseVoiceRealtimeReturn {
  const [state, setState] = useState<RealtimeVoiceState>('disconnected');
  const [mode, setModeState] = useState<VoiceMode>(
    options?.mode || 'push-to-talk',
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [sttText, setSttText] = useState('');
  const [aiText, setAiText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const serviceRef = useRef<VoiceRealtimeService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // 用于在 AI 说话时持续录音检测用户打断
  const isRecordingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const shouldAutoRestartRef = useRef(false);
  // 累积 AI 文本（流式增量），避免每次 setState 触发闭包旧值
  const aiTextAccumulatorRef = useRef('');

  const playAudioChunk = useCallback(
    async (base64Data: string, _contentType: string) => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }

        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const audioBuffer = await audioContextRef.current.decodeAudioData(
          bytes.buffer,
        );
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);

        currentSourceRef.current = source;
        source.start(0);
      } catch {
        // audio decode/playback error
      }
    },
    [],
  );

  const stopCurrentAudio = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // already stopped
      }
      currentSourceRef.current = null;
    }
  }, []);

  const createCallbacks = useCallback((): VoiceRealtimeCallbacks => {
    return {
      onSessionStarted: (data) => {
        setSessionId(data.sessionId);
        setState('connected');
      },
      onSttPartial: (data) => {
        setSttText(data.text);
      },
      onSttFinal: (data) => {
        setSttText(data.text);
        setState('processing');
        // 新一轮对话开始：清空上一轮 AI 回复文本
        aiTextAccumulatorRef.current = '';
        setAiText('');
        options?.onSttResult?.(data.text);

        // 停止录音（发送 isFinal），让后端知道用户说完了
        // 注意：AI 说话期间会重新启动录音用于打断检测
        if (isRecordingRef.current && serviceRef.current) {
          serviceRef.current.stopRecording();
          isRecordingRef.current = false;
          setStream(null);
        }
      },
      onAiText: (data) => {
        // 流式增量累积 AI 回复文本
        aiTextAccumulatorRef.current += data.text;
        setAiText(aiTextAccumulatorRef.current);
        options?.onAiText?.(data.text, data.isFinal);
      },
      onAiTextEnd: (data) => {
        // AI 文本全部完成，确保使用后端给的完整文本
        aiTextAccumulatorRef.current = data.text;
        setAiText(data.text);
        options?.onAiTextEnd?.(data.text);
      },
      onTtsAudio: (data) => {
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          setState('speaking');
          // AI 开始说话时重新启动录音，用于检测用户打断
          // 后端会在 AI 说话期间做 VAD 检测，发现用户开口就发送打断事件
          if (!isRecordingRef.current && serviceRef.current) {
            serviceRef.current.startRecording().then((mediaStream) => {
              setStream(mediaStream);
              isRecordingRef.current = true;
            }).catch(() => {
              // 重启录音失败，打断功能不可用，但不影响 TTS 播放
            });
          }
        }
        options?.onTtsAudioChunk?.(data.data, data.contentType);
        playAudioChunk(data.data, data.contentType);
      },
      onTtsEnd: () => {
        isSpeakingRef.current = false;
        // TTS 结束后，如果是连续模式，自动重新开始聆听
        if (mode === 'continuous' && shouldAutoRestartRef.current) {
          setState('listening');
          // 如果 AI 说话期间已经启动了录音，就不需要重启
          if (!isRecordingRef.current && serviceRef.current) {
            setTimeout(() => {
              if (serviceRef.current && !isRecordingRef.current && shouldAutoRestartRef.current) {
                serviceRef.current.startRecording().then((mediaStream) => {
                  setStream(mediaStream);
                  isRecordingRef.current = true;
                }).catch(() => {
                  // 重启录音失败
                });
              }
            }, 200);
          }
        } else {
          setState('connected');
        }
      },
      onVadSilence: (data) => {
        // 后端检测到用户在 AI 说话时开口了 → 打断 AI
        const vadData = data as { silenceDurationMs: number; state?: string };
        if (isSpeakingRef.current && vadData.state === 'interrupt') {
          stopCurrentAudio();
          isSpeakingRef.current = false;
          setState('listening');
          // 录音已经在进行中（AI 说话时启动的），不需要重启
        }
      },
      onError: (data) => {
        setState('error');
        options?.onError?.(data);
      },
      onModeChanged: (data) => {
        setModeState(data.mode);
      },
      onCommandDetected: (command) => {
        options?.onCommand?.(command);
      },
      onDisconnected: () => {
        setState('disconnected');
        setSessionId(null);
        isRecordingRef.current = false;
        isSpeakingRef.current = false;
        shouldAutoRestartRef.current = false;
      },
    };
  }, [mode, options, playAudioChunk, stopCurrentAudio]);

  const connect = useCallback(async () => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
    }

    setState('connecting');
    shouldAutoRestartRef.current = true;

    const service = new VoiceRealtimeService(createCallbacks());
    serviceRef.current = service;

    try {
      await service.connect();
      await service.startSession({
        language: options?.language || 'auto',
        mode: options?.mode || 'push-to-talk',
        enableVad: options?.enableVad ?? true,
        vadSilenceDuration: options?.vadSilenceDuration,
        // 传入客户端当前选中的 LLM provider/model，让后端用对应模型生成 AI 回复
        provider: options?.provider,
        model: options?.model,
        systemPrompt: options?.systemPrompt,
        threadId: options?.threadId,
        // 语音流水线模式（classic / realtime），不传时后端自动判断
        pipeline: options?.pipeline,
        realtimeConfig: options?.realtimeConfig,
        // 用户自定义 STT/TTS 配置（自定义模式下传入后端用用户自己的 API Key）
        userVoiceConfig: options?.userVoiceConfig,
      });
    } catch (err) {
      setState('error');
      options?.onError?.({
        code: 'CONNECTION_FAILED',
        message: err instanceof Error ? err.message : 'Connection failed',
      });
    }
  }, [createCallbacks, options]);

  const disconnect = useCallback(() => {
    shouldAutoRestartRef.current = false;
    stopCurrentAudio();
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      serviceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    isRecordingRef.current = false;
    isSpeakingRef.current = false;
    aiTextAccumulatorRef.current = '';
    setState('disconnected');
    setStream(null);
    setSessionId(null);
    setAiText('');
  }, [stopCurrentAudio]);

  const startListening = useCallback(async () => {
    if (!serviceRef.current) {
      await connect();
    }

    if (serviceRef.current && !isRecordingRef.current) {
      try {
        const mediaStream = await serviceRef.current.startRecording();
        setStream(mediaStream);
        isRecordingRef.current = true;
        setState('listening');
        setSttText('');
      } catch (err) {
        setState('error');
        options?.onError?.({
          code: 'RECORDING_FAILED',
          message: err instanceof Error ? err.message : 'Failed to start recording',
        });
      }
    }
  }, [connect, options]);

  const stopListening = useCallback(() => {
    if (serviceRef.current && isRecordingRef.current) {
      serviceRef.current.stopRecording();
      isRecordingRef.current = false;
      setStream(null);
      if (mode === 'push-to-talk') {
        setState('processing');
      }
    }
  }, [mode]);

  const interrupt = useCallback(() => {
    stopCurrentAudio();
    if (serviceRef.current) {
      serviceRef.current.interrupt();
    }
    isSpeakingRef.current = false;
    setState('listening');
  }, [stopCurrentAudio]);

  const setMode = useCallback(
    (newMode: VoiceMode) => {
      setModeState(newMode);
      if (serviceRef.current) {
        serviceRef.current.setMode(newMode);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    mode,
    stream,
    sttText,
    aiText,
    sessionId,
    connect,
    disconnect,
    startListening,
    stopListening,
    interrupt,
    setMode,
  };
}
