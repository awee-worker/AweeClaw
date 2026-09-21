import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from '@components/foundation/NotificationProvider';
import { voiceApi } from '../services/voiceApi';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

interface UseVoiceOutputOptions {
  voice?: string;
  speed?: number;
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
  language?: string;
  onPlaybackEnd?: () => void;
  onError?: (error: Error) => void;
}

interface UseVoiceOutputReturn {
  playbackState: PlaybackState;
  speak: (text: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  currentText: string | null;
  /** 最近一次播报的失败原因；成功或重新播报时清空 */
  error: string | null;
}

export function useVoiceOutput(options?: UseVoiceOutputOptions): UseVoiceOutputReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      cleanup();
      setError(null);
      setPlaybackState('loading');
      setCurrentText(text);

      // 空文本没有可合成的内容，直接给出结论，避免用户面对「点了没反应」
      if (!text.trim()) {
        setPlaybackState('idle');
        setCurrentText(null);
        toast.warning('这条消息没有可朗读的文字内容');
        return;
      }

      try {
        const blob = await voiceApi.textToSpeech(text, {
          voice: options?.voice,
          speed: options?.speed,
          format: options?.format,
          language: options?.language,
        });

        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;

        const audio = new Audio(blobUrl);
        audioRef.current = audio;

        audio.oncanplaythrough = () => {
          audio.play().catch(() => {});
          setPlaybackState('playing');
        };

        audio.onended = () => {
          setPlaybackState('idle');
          setCurrentText(null);
          options?.onPlaybackEnd?.();
        };

        audio.onerror = () => {
          setPlaybackState('idle');
          setCurrentText(null);
          const msg = '音频播放失败，请检查系统音频设备是否可用';
          setError(msg);
          toast.error(`语音播报失败：${msg}`);
          options?.onError?.(new Error('Audio playback error'));
        };

        audio.load();
      } catch (err) {
        setPlaybackState('idle');
        setCurrentText(null);
        const msg = err instanceof Error ? err.message : 'TTS failed';
        setError(msg);
        // 未传 onError 的调用方（如消息操作栏的「语音播报」按钮）过去会完全静默，
        // 用户只看到「点了没反应」；这里必须把失败原因摆到界面上。
        console.warn('[useVoiceOutput] 语音播报失败:', msg);
        toast.error(`语音播报失败：${msg}`);
        options?.onError?.(new Error(msg));
      }
    },
    [options, cleanup],
  );

  const stop = useCallback(() => {
    cleanup();
    setPlaybackState('idle');
    setCurrentText(null);
  }, [cleanup]);

  const pause = useCallback(() => {
    if (audioRef.current && playbackState === 'playing') {
      audioRef.current.pause();
      setPlaybackState('paused');
    }
  }, [playbackState]);

  const resume = useCallback(() => {
    if (audioRef.current && playbackState === 'paused') {
      audioRef.current.play().catch(() => {});
      setPlaybackState('playing');
    }
  }, [playbackState]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    playbackState,
    speak,
    stop,
    pause,
    resume,
    currentText,
    error,
  };
}
