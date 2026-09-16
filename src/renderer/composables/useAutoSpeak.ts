import { useEffect, useRef } from 'react';
import { voiceApi } from '../services/voiceApi';
import { isAssistantMessage, getMessageText } from '@intelligence/providerTypes';
import { StorageService } from '@shared/toolkit/StorageService';
import type { ChatMessage } from '@intelligence/providerTypes';

interface UseAutoSpeakOptions {
  isStreaming: boolean;
  messages: ChatMessage[];
}

export function useAutoSpeak({ isStreaming, messages }: UseAutoSpeakOptions): void {
  const prevStreamingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // 用 ref 桥接 messages，避免每次消息变化都触发 TTS effect
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
        currentAudioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const autoSpeak = StorageService.get<string>('voice_auto_speak') === 'true';
      if (!autoSpeak) {
        prevStreamingRef.current = isStreaming;
        return;
      }

      const lastAssistantMsg = [...messagesRef.current]
        .reverse()
        .find((m) => isAssistantMessage(m));

      if (!lastAssistantMsg) {
        prevStreamingRef.current = isStreaming;
        return;
      }

      const text = getMessageText(lastAssistantMsg.content).trim();
      if (!text) {
        prevStreamingRef.current = isStreaming;
        return;
      }

      const speakText = text.length > 500 ? text.slice(0, 500) + '...' : text;

      const ttsVoice = StorageService.get<string>('voice_tts_voice') || undefined;
      const ttsSpeed = StorageService.get<string>('voice_tts_speed');
      const speed = ttsSpeed ? parseFloat(ttsSpeed) : undefined;

      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
        currentAudioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      voiceApi
        .textToSpeech(speakText, {
          voice: ttsVoice,
          speed,
        })
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl;

          const audio = new Audio(blobUrl);
          currentAudioRef.current = audio;

          audio.onended = () => {
            URL.revokeObjectURL(blobUrl);
            blobUrlRef.current = null;
            currentAudioRef.current = null;
          };
          audio.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            blobUrlRef.current = null;
            currentAudioRef.current = null;
          };

          audio.play().catch(() => {});
        })
        .catch((err) => {
          // 不静默：合成失败必须留下可追踪线索。
          // 历史问题：优先级「仅本地」+ 非法音色时，播报毫无反应且无任何日志，
          // 用户只能看到「点了没反应」。
          console.warn(
            '[useAutoSpeak] 自动播报失败:',
            err instanceof Error ? err.message : err,
          );
        });
    }

    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);
}
