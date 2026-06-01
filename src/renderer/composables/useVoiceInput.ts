import { useState, useRef, useCallback, useEffect } from 'react';
import { voiceApi } from '../services/voiceApi';
import { convertBlobToWav } from '../utils/audioConverter';
import { toast } from '@components/foundation/NotificationProvider';
import { tryRefreshToken, getAccessToken } from '../adapters/backendApi';

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'processing';

interface UseVoiceInputOptions {
  language?: string;
  onResult?: (text: string) => void;
  onPartialResult?: (text: string) => void;
  onError?: (error: Error) => void;
}

interface UseVoiceInputReturn {
  state: RecordingState;
  stream: MediaStream | null;
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

const PARTIAL_INTERVAL_MS = 1500;
const PARTIAL_MIN_CHUNKS = 4;

export function useVoiceInput(options?: UseVoiceInputOptions): UseVoiceInputReturn {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [partialText, setPartialText] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const partialTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>('audio/webm');
  const authFailedRef = useRef(false);
  const isStoppedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (partialTimerRef.current) {
      clearInterval(partialTimerRef.current);
      partialTimerRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimers();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setDuration(0);
    releaseStream();
  }, [clearTimers, releaseStream]);

  const startRecording = useCallback(async () => {
    try {
      setState('requesting');
      setPartialText('');
      authFailedRef.current = false;
      isStoppedRef.current = false;

      if (!getAccessToken()) {
        const refreshed = await tryRefreshToken();
        if (!refreshed) {
          setState('idle');
          toast.error('Login expired, please log in again');
          options?.onError?.(new Error('Auth expired'));
          return;
        }
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(mediaStream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        cleanup();
        setState('idle');
        toast.error('Recording error occurred');
        options?.onError?.(new Error('Recording error'));
      };

      recorder.onstop = async () => {
        clearTimers();

        if (isStoppedRef.current) {
          return;
        }
        isStoppedRef.current = true;

        if (chunksRef.current.length === 0) {
          releaseStream();
          setState('idle');
          return;
        }

        setState('processing');
        releaseStream();

        try {
          const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
          const wavBlob = await convertBlobToWav(rawBlob);

          const result = await voiceApi.speechToText(wavBlob, {
            language: options?.language,
            noAuthRetry: true,
          });

          if (result.text) {
            setPartialText('');
            options?.onResult?.(result.text);
          } else {
            toast.error('No speech detected, please try again');
          }
        } catch (err) {
          if (isAuthError(err)) {
            toast.error('Login expired, please re-login');
          } else {
            const msg = err instanceof Error ? err.message : 'Speech recognition failed';
            toast.error(msg);
            options?.onError?.(err instanceof Error ? err : new Error(msg));
          }
        } finally {
          setState('idle');
          chunksRef.current = [];
        }
      };

      recorder.start(250);
      startTimeRef.current = Date.now();
      setState('recording');

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

      let partialChunkAccum: Blob[] = [];

      partialTimerRef.current = setInterval(async () => {
        if (authFailedRef.current || isStoppedRef.current) {
          if (partialTimerRef.current) {
            clearInterval(partialTimerRef.current);
            partialTimerRef.current = null;
          }
          return;
        }

        const newChunks = chunksRef.current.slice(partialChunkAccum.length);
        if (newChunks.length < PARTIAL_MIN_CHUNKS) return;

        partialChunkAccum = [...chunksRef.current];

        try {
          const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
          const wavBlob = await convertBlobToWav(rawBlob);
          const result = await voiceApi.speechToText(wavBlob, {
            language: options?.language,
            noAuthRetry: true,
          });
          if (result.text && !isStoppedRef.current) {
            setPartialText(result.text);
            options?.onPartialResult?.(result.text);
          }
        } catch (err) {
          if (isAuthError(err)) {
            authFailedRef.current = true;
            if (partialTimerRef.current) {
              clearInterval(partialTimerRef.current);
              partialTimerRef.current = null;
            }
          }
        }
      }, PARTIAL_INTERVAL_MS);
    } catch (err) {
      setState('idle');
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : err instanceof Error
            ? err.message
            : 'Failed to start recording';
      toast.error(msg);
      options?.onError?.(new Error(msg));
    }
  }, [options, cleanup, clearTimers, releaseStream]);

  const stopRecording = useCallback(() => {
    if (partialTimerRef.current) {
      clearInterval(partialTimerRef.current);
      partialTimerRef.current = null;
    }

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    isStoppedRef.current = true;
    chunksRef.current = [];
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
