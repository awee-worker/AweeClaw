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
  onSttResult?: (text: string) => void;
  onTtsAudioChunk?: (base64Data: string, contentType: string) => void;
  onCommand?: (command: VoiceCommand) => void;
  onError?: (error: { code: string; message: string }) => void;
}

interface UseVoiceRealtimeReturn {
  state: RealtimeVoiceState;
  mode: VoiceMode;
  stream: MediaStream | null;
  sttText: string;
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
  const [sessionId, setSessionId] = useState<string | null>(null);

  const serviceRef = useRef<VoiceRealtimeService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

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
        options?.onSttResult?.(data.text);
      },
      onTtsAudio: (data) => {
        if (state !== 'speaking') {
          setState('speaking');
        }
        options?.onTtsAudioChunk?.(data.data, data.contentType);
        playAudioChunk(data.data, data.contentType);
      },
      onTtsEnd: () => {
        setState('connected');
        if (mode === 'continuous') {
          setState('listening');
        }
      },
      onVadSilence: () => {
        // VAD detected silence, auto-stop handled by server
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
      },
    };
  }, [mode, options, playAudioChunk, state]);

  const connect = useCallback(async () => {
    if (serviceRef.current) {
      serviceRef.current.disconnect();
    }

    setState('connecting');

    const service = new VoiceRealtimeService(createCallbacks());
    serviceRef.current = service;

    try {
      await service.connect();
      await service.startSession({
        language: options?.language || 'auto',
        mode: options?.mode || 'push-to-talk',
        enableVad: options?.enableVad ?? true,
        vadSilenceDuration: options?.vadSilenceDuration,
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
    stopCurrentAudio();
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      serviceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setState('disconnected');
    setStream(null);
    setSessionId(null);
  }, [stopCurrentAudio]);

  const startListening = useCallback(async () => {
    if (!serviceRef.current) {
      await connect();
    }

    if (serviceRef.current) {
      try {
        const mediaStream = await serviceRef.current.startRecording();
        setStream(mediaStream);
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
    if (serviceRef.current) {
      serviceRef.current.stopRecording();
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
    sessionId,
    connect,
    disconnect,
    startListening,
    stopListening,
    interrupt,
    setMode,
  };
}
