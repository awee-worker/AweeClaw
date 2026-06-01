import { io, Socket } from 'socket.io-client';
import { getServerUrl, getAccessToken } from '../adapters/backendApi';
import { convertBlobToWav } from '../utils/audioConverter';

export enum VoiceWsEvent {
  START_SESSION = 'voice:start',
  AUDIO_CHUNK = 'voice:audio',
  END_SESSION = 'voice:end',
  STOP_TTS = 'voice:stop_tts',
  INTERRUPT = 'voice:interrupt',
  SET_MODE = 'voice:set_mode',
}

export enum VoiceWsResponse {
  SESSION_STARTED = 'voice:session_started',
  STT_PARTIAL = 'voice:stt_partial',
  STT_FINAL = 'voice:stt_final',
  TTS_AUDIO = 'voice:tts_audio',
  TTS_END = 'voice:tts_end',
  AI_TEXT = 'voice:ai_text',
  AI_TEXT_END = 'voice:ai_text_end',
  ERROR = 'voice:error',
  VAD_SILENCE = 'voice:vad_silence',
  MODE_CHANGED = 'voice:mode_changed',
  COMMAND_DETECTED = 'voice:command_detected',
}

export type VoiceMode = 'push-to-talk' | 'continuous';

export interface VoiceCommand {
  type: string;
  action: string;
  params: Record<string, unknown>;
  rawText: string;
  confidence: number;
}

export interface VoiceRealtimeCallbacks {
  onSessionStarted?: (data: { sessionId: string; mode: VoiceMode; language: string; enableVad: boolean }) => void;
  onSttPartial?: (data: { text: string }) => void;
  onSttFinal?: (data: { text: string; language: string; duration: number; provider: string }) => void;
  onTtsAudio?: (data: { data: string; contentType: string; isFinal: boolean }) => void;
  onTtsEnd?: (data: { provider: string; voice: string }) => void;
  onVadSilence?: (data: { silenceDurationMs: number }) => void;
  onError?: (data: { code: string; message: string }) => void;
  onModeChanged?: (data: { mode: VoiceMode }) => void;
  onCommandDetected?: (command: VoiceCommand) => void;
  onDisconnected?: () => void;
}

export class VoiceRealtimeService {
  private socket: Socket | null = null;
  private callbacks: VoiceRealtimeCallbacks = {};
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private isActive = false;

  constructor(callbacks: VoiceRealtimeCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    const serverUrl = getServerUrl();
    const token = getAccessToken();
    if (!serverUrl || !token) {
      throw new Error('Server URL or token not available');
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(`${serverUrl}/voice`, {
          transports: ['websocket'],
          auth: { token },
          reconnection: false,
          timeout: 5000,
        });

        this.socket.on('connect', () => {
          resolve();
        });

        this.socket.on('connect_error', (err) => {
          reject(new Error(`Socket.IO connection failed: ${err.message}`));
        });

        this.socket.on('disconnect', () => {
          this.isActive = false;
          this.callbacks.onDisconnected?.();
        });

        this.socket.on(VoiceWsResponse.SESSION_STARTED, (data) => {
          this.callbacks.onSessionStarted?.(
            data as Parameters<NonNullable<VoiceRealtimeCallbacks['onSessionStarted']>>[0],
          );
        });

        this.socket.on(VoiceWsResponse.STT_PARTIAL, (data) => {
          this.callbacks.onSttPartial?.(data as { text: string });
        });

        this.socket.on(VoiceWsResponse.STT_FINAL, (data) => {
          this.callbacks.onSttFinal?.(
            data as Parameters<NonNullable<VoiceRealtimeCallbacks['onSttFinal']>>[0],
          );
        });

        this.socket.on(VoiceWsResponse.TTS_AUDIO, (data) => {
          this.callbacks.onTtsAudio?.(
            data as Parameters<NonNullable<VoiceRealtimeCallbacks['onTtsAudio']>>[0],
          );
        });

        this.socket.on(VoiceWsResponse.TTS_END, (data) => {
          this.callbacks.onTtsEnd?.(
            data as Parameters<NonNullable<VoiceRealtimeCallbacks['onTtsEnd']>>[0],
          );
        });

        this.socket.on(VoiceWsResponse.VAD_SILENCE, (data) => {
          this.callbacks.onVadSilence?.(data as { silenceDurationMs: number });
        });

        this.socket.on(VoiceWsResponse.ERROR, (data) => {
          this.callbacks.onError?.(data as { code: string; message: string });
        });

        this.socket.on(VoiceWsResponse.MODE_CHANGED, (data) => {
          this.callbacks.onModeChanged?.(data as { mode: VoiceMode });
        });

        this.socket.on(VoiceWsResponse.COMMAND_DETECTED, (data) => {
          this.callbacks.onCommandDetected?.(data as VoiceCommand);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async startSession(options?: {
    language?: string;
    mode?: VoiceMode;
    enableVad?: boolean;
    vadSilenceThreshold?: number;
    vadSilenceDuration?: number;
  }): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Socket.IO not connected');
    }

    this.socket.emit(VoiceWsEvent.START_SESSION, {
      language: options?.language || 'auto',
      mode: options?.mode || 'push-to-talk',
      enableVad: options?.enableVad ?? true,
      vadSilenceThreshold: options?.vadSilenceThreshold,
      vadSilenceDuration: options?.vadSilenceDuration,
    });
  }

  async startRecording(): Promise<MediaStream> {
    if (this.isActive) {
      throw new Error('Recording already in progress');
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1,
      },
    });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(this.mediaStream, {
      mimeType,
      audioBitsPerSecond: 16000,
    });

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && this.socket?.connected) {
        try {
          const wavBlob = await convertBlobToWav(event.data);
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            if (base64) {
              this.sendAudioChunk(base64, 'audio/wav');
            }
          };
          reader.readAsDataURL(wavBlob);
        } catch {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            if (base64) {
              this.sendAudioChunk(base64, mimeType);
            }
          };
          reader.readAsDataURL(event.data);
        }
      }
    };

    this.mediaRecorder.start(250);
    this.isActive = true;

    return this.mediaStream;
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isActive = false;

    this.sendAudioChunk('', 'audio/wav', true);
  }

  sendAudioChunk(base64Data: string, mimeType: string, isFinal = false): void {
    if (this.socket?.connected) {
      this.socket.emit(VoiceWsEvent.AUDIO_CHUNK, {
        data: base64Data,
        mimeType,
        isFinal,
      });
    }
  }

  endSession(): void {
    this.stopRecording();
    if (this.socket?.connected) {
      this.socket.emit(VoiceWsEvent.END_SESSION, {});
    }
  }

  interrupt(): void {
    if (this.socket?.connected) {
      this.socket.emit(VoiceWsEvent.INTERRUPT, { reason: 'user_speech' });
    }
  }

  setMode(mode: VoiceMode): void {
    if (this.socket?.connected) {
      this.socket.emit(VoiceWsEvent.SET_MODE, { mode });
    }
  }

  disconnect(): void {
    this.stopRecording();
    this.releaseMediaStream();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.isActive = false;
  }

  getIsConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  getIsRecording(): boolean {
    return this.isActive;
  }

  private releaseMediaStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.mediaRecorder = null;
  }
}
