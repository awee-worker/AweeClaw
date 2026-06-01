import { memo, useCallback } from 'react';
import { Mic, Loader2, Square } from 'lucide-react';
import { motion } from 'framer-motion';
import type { RecordingState } from '../../composables/useVoiceInput';

interface VoiceInputButtonProps {
  state: RecordingState;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

const VoiceInputButton = memo(function VoiceInputButton({
  state,
  onStart,
  onStop,
  onCancel,
}: VoiceInputButtonProps) {
  const handleClick = useCallback(() => {
    if (state === 'idle') {
      onStart();
    } else if (state === 'recording') {
      onStop();
    }
  }, [state, onStart, onStop]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (state === 'recording') {
        onCancel();
      }
    },
    [state, onCancel],
  );

  const getIcon = () => {
    switch (state) {
      case 'requesting':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'recording':
        return <Square className="w-3.5 h-3.5" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      default:
        return <Mic className="w-4 h-4" />;
    }
  };

  const getButtonClass = () => {
    const base =
      'relative flex items-center justify-center rounded-full transition-all duration-200 focus:outline-none';

    switch (state) {
      case 'recording':
        return `${base} w-9 h-9 bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600`;
      case 'requesting':
      case 'processing':
        return `${base} w-8 h-8 bg-blue-500/20 text-blue-400 cursor-wait`;
      default:
        return `${base} w-8 h-8 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50`;
    }
  };

  return (
    <button
      type="button"
      className={getButtonClass()}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      disabled={state === 'requesting' || state === 'processing'}
      title={
        state === 'idle'
          ? 'Start voice input'
          : state === 'recording'
            ? 'Stop recording'
            : state === 'processing'
              ? 'Processing...'
              : 'Requesting microphone...'
      }
    >
      {state === 'recording' && (
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-red-400"
          animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
      {getIcon()}
    </button>
  );
});

export default VoiceInputButton;
