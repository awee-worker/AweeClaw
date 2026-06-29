import { memo, useCallback } from 'react';
import { Volume2, Loader2, Pause } from 'lucide-react';
import type { PlaybackState } from '../../composables/useVoiceOutput';

interface VoiceOutputButtonProps {
  playbackState: PlaybackState;
  onSpeak: (text: string) => Promise<void>;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  text: string;
  className?: string;
}

const VoiceOutputButton = memo(function VoiceOutputButton({
  playbackState,
  onSpeak,
  onStop,
  onPause,
  onResume,
  text,
  className = '',
}: VoiceOutputButtonProps) {
  const handleClick = useCallback(() => {
    if (playbackState === 'idle') {
      onSpeak(text);
    } else if (playbackState === 'playing') {
      onPause();
    } else if (playbackState === 'paused') {
      onResume();
    }
  }, [playbackState, onSpeak, onPause, onResume, text]);

  const getIcon = () => {
    switch (playbackState) {
      case 'loading':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'playing':
        return <Pause className="w-4 h-4" />;
      case 'paused':
        return <Volume2 className="w-4 h-4" />;
      default:
        return <Volume2 className="w-4 h-4" />;
    }
  };

  const getTitle = () => {
    switch (playbackState) {
      case 'loading':
        return 'Loading audio...';
      case 'playing':
        return 'Pause';
      case 'paused':
        return 'Resume';
      default:
        return 'Read aloud';
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        className={`flex items-center justify-center rounded p-1.5 transition-colors duration-150 ${
          playbackState === 'playing'
            ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
            : playbackState === 'loading'
              ? 'text-zinc-400 cursor-wait'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50'
        } ${className}`}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (playbackState !== 'idle') {
            onStop();
          }
        }}
        disabled={playbackState === 'loading'}
        title={getTitle()}
      >
        {getIcon()}
      </button>
      {playbackState === 'playing' && (
        <div className="flex items-center gap-0.5 ml-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-0.5 bg-blue-400 rounded-full animate-pulse"
              style={{
                height: `${6 + i * 3}px`,
                animationDelay: `${i * 0.15}s`,
                animationDuration: '0.8s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default VoiceOutputButton;
