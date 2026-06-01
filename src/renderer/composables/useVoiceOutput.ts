import { useState, useRef, useCallback, useEffect } from 'react';
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
}

export function useVoiceOutput(options?: UseVoiceOutputOptions): UseVoiceOutputReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [currentText, setCurrentText] = useState<string | null>(null);

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
      setPlaybackState('loading');
      setCurrentText(text);

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
          options?.onError?.(new Error('Audio playback error'));
        };

        audio.load();
      } catch (err) {
        setPlaybackState('idle');
        setCurrentText(null);
        const msg = err instanceof Error ? err.message : 'TTS failed';
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
  };
}
