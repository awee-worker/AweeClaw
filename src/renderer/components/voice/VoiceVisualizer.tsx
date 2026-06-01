import { useRef, useEffect, useCallback, memo } from 'react';

interface VoiceVisualizerProps {
  stream: MediaStream | null;
  isActive: boolean;
  color?: string;
  height?: number;
  barCount?: number;
  barGap?: number;
  className?: string;
}

const VoiceVisualizer = memo(function VoiceVisualizer({
  stream,
  isActive,
  color = 'rgb(239, 68, 68)',
  height = 40,
  barCount = 32,
  barGap = 2,
  className = '',
}: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array>(new Uint8Array(0));

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const totalBarWidth = w - (barCount - 1) * barGap;
    const barWidth = Math.max(1, totalBarWidth / barCount);
    const step = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += dataArray[i * step + j];
      }
      const avg = sum / step;
      const barHeight = Math.max(2, (avg / 255) * h * 0.9);

      const x = i * (barWidth + barGap);
      const y = (h - barHeight) / 2;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6 + (avg / 255) * 0.4;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
      ctx.fill();
    }

    ctx.restore();

    rafRef.current = requestAnimationFrame(draw);
  }, [barCount, barGap, color]);

  useEffect(() => {
    if (!isActive || !stream) {
      cleanup();
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    rafRef.current = requestAnimationFrame(draw);

    return cleanup;
  }, [isActive, stream, draw, cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleCanvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
      if (el) {
        const dpr = window.devicePixelRatio || 1;
        const rect = el.getBoundingClientRect();
        el.width = rect.width * dpr;
        el.height = height * dpr;
      }
    },
    [height],
  );

  return (
    <canvas
      ref={handleCanvasRef}
      className={`w-full ${className}`}
      style={{ height: `${height}px` }}
    />
  );
});

export default VoiceVisualizer;
