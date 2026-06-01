import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Volume2, Command } from 'lucide-react';
import { useVoiceRealtime, type RealtimeVoiceState } from '../../composables/useVoiceRealtime';
import VoiceVisualizer from '../voice/VoiceVisualizer';
import type { VoiceMode, VoiceCommand } from '../../services/voiceRealtime';

interface VoiceRealtimePanelProps {
  language?: string;
  onSttResult?: (text: string) => void;
  onClose?: () => void;
}

const STATE_LABELS: Record<RealtimeVoiceState, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  connected: '已连接',
  listening: '聆听中...',
  processing: '识别中...',
  speaking: '播报中...',
  error: '连接错误',
};

const STATE_COLORS: Record<RealtimeVoiceState, string> = {
  disconnected: 'text-text-muted',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  listening: 'text-accent',
  processing: 'text-yellow-400',
  speaking: 'text-blue-400',
  error: 'text-red-400',
};

export function VoiceRealtimePanel({
  language,
  onSttResult,
  onClose,
}: VoiceRealtimePanelProps) {
  const {
    state,
    mode,
    stream,
    sttText,
    connect,
    disconnect,
    startListening,
    stopListening,
    interrupt,
    setMode,
  } = useVoiceRealtime({
    language: language || 'auto',
    mode: 'push-to-talk',
    enableVad: true,
    onSttResult,
  });

  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const commandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isConnected = state !== 'disconnected' && state !== 'error';
  const isListening = state === 'listening';
  const isSpeaking = state === 'speaking';

  useEffect(() => {
    if (state === 'disconnected') {
      connect();
    }
  }, []);

  useEffect(() => {
    if (isSpeaking) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          e.preventDefault();
          interrupt();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isSpeaking, interrupt]);

  const handleMicToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    onClose?.();
  }, [disconnect, onClose]);

  const handleModeChange = useCallback(
    (newMode: VoiceMode) => {
      setMode(newMode);
    },
    [setMode],
  );

  return (
    <div className="flex flex-col items-center gap-4 p-4 rounded-xl bg-surface/90 border border-border/40 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm">
        <span className={`font-medium ${STATE_COLORS[state]}`}>
          {STATE_LABELS[state]}
        </span>
        {isConnected && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        )}
      </div>

      {stream && (
        <div className="w-48 h-12 flex items-center justify-center">
          <VoiceVisualizer
            stream={stream}
            isActive={isListening}
            color={isListening ? 'rgb(59, 130, 246)' : 'rgb(107, 114, 128)'}
            height={48}
            barCount={32}
            barGap={2}
          />
        </div>
      )}

      {sttText && (
        <div className="max-w-xs text-center text-sm text-text-primary bg-surface/60 rounded-lg px-3 py-2">
          {sttText}
        </div>
      )}

      {lastCommand && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs animate-pulse">
          <Command className="w-3.5 h-3.5" />
          <span>{lastCommand.action.replace(/_/g, ' ')}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleMicToggle}
          disabled={!isConnected || isSpeaking}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 ${
            isListening
              ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 scale-110'
              : 'bg-surface border border-border/60 text-text-primary hover:bg-surface/80 disabled:opacity-40'
          }`}
        >
          {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {isSpeaking && (
          <button
            onClick={interrupt}
            className="w-10 h-10 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center hover:bg-yellow-500/30 transition-colors"
            title="打断播报"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={handleDisconnect}
          className="w-10 h-10 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-colors"
          title="断开连接"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted">
        <button
          onClick={() => handleModeChange('push-to-talk')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            mode === 'push-to-talk'
              ? 'bg-accent/20 text-accent'
              : 'hover:bg-surface/80'
          }`}
        >
          按住说话
        </button>
        <button
          onClick={() => handleModeChange('continuous')}
          className={`px-2.5 py-1 rounded-md transition-colors ${
            mode === 'continuous'
              ? 'bg-accent/20 text-accent'
              : 'hover:bg-surface/80'
          }`}
        >
          连续对话
        </button>
      </div>

      {isSpeaking && (
        <div className="text-xs text-text-muted">
          按空格键打断播报
        </div>
      )}
    </div>
  );
}
