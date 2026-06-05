import { useState, useEffect, useCallback } from 'react';
import { Mic, Volume2, Globe, Loader2, Check, ChevronDown } from 'lucide-react';
import { voiceApi, type VoiceInfo } from '../../../services/voiceApi';
import { toast } from '@components/foundation/NotificationProvider';
import { StorageService } from '@shared/toolkit/StorageService';
import type { Language } from '@renderer/i18n';

interface VoiceSettingsPanelProps {
  language: Language;
}

const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'auto', label: 'Auto Detect' },
];

export default function VoiceSettingsPanel({ language }: VoiceSettingsPanelProps) {
  const [sttLanguage, setSttLanguage] = useState(() => {
    return StorageService.get<string>('voice_stt_language') || 'auto';
  });
  const [ttsVoice, setTtsVoice] = useState(() => {
    return StorageService.get<string>('voice_tts_voice') || '';
  });
  const [ttsSpeed, setTtsSpeed] = useState(() => {
    const saved = StorageService.get<string>('voice_tts_speed');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [autoSpeak, setAutoSpeak] = useState(() => {
    return StorageService.get<string>('voice_auto_speak') === 'true';
  });
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setLoadingVoices(true);
    voiceApi
      .getVoices()
      .then(setVoices)
      .catch(() => {})
      .finally(() => setLoadingVoices(false));
  }, []);

  const handleSttLanguageChange = useCallback((value: string) => {
    setSttLanguage(value);
    StorageService.set('voice_stt_language', value);
    toast.success(language === 'zh' ? '语音识别语言已更新' : 'STT language updated');
  }, [language]);

  const handleTtsVoiceChange = useCallback((value: string) => {
    setTtsVoice(value);
    StorageService.set('voice_tts_voice', value);
    toast.success(language === 'zh' ? '语音合成音色已更新' : 'TTS voice updated');
  }, [language]);

  const handleTtsSpeedChange = useCallback((value: number) => {
    setTtsSpeed(value);
    StorageService.set('voice_tts_speed', String(value));
  }, []);

  const handleAutoSpeakChange = useCallback((value: boolean) => {
    setAutoSpeak(value);
    StorageService.set('voice_auto_speak', String(value));
  }, []);

  const handleTestTts = useCallback(async () => {
    setTesting(true);
    try {
      const testText = language === 'zh' ? '你好，语音合成测试' : 'Hello, TTS test';
      const blob = await voiceApi.textToSpeech(testText, {
        voice: ttsVoice || undefined,
        speed: ttsSpeed,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.play().catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'TTS test failed');
    } finally {
      setTesting(false);
    }
  }, [language, ttsVoice, ttsSpeed]);

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  return (
    <div className="space-y-8">
      <Section title={t('语音识别', 'Speech Recognition')} icon={<Mic className="w-5 h-5" />}>
        <SettingRow label={t('识别语言', 'Recognition Language')} description={t('设置语音识别的目标语言', 'Set the target language for speech recognition')}>
          <select
            value={sttLanguage}
            onChange={(e) => handleSttLanguageChange(e.target.value)}
            className="w-full max-w-xs px-3 py-2 rounded-lg bg-surface/80 border border-border/60 text-text-primary text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </Section>

      <Section title={t('语音合成', 'Text to Speech')} icon={<Volume2 className="w-5 h-5" />}>
        <SettingRow label={t('播报音色', 'Voice')} description={t('选择AI语音播报的音色', 'Select the voice for AI speech output')}>
          <div className="relative w-full max-w-xs">
            <select
              value={ttsVoice}
              onChange={(e) => handleTtsVoiceChange(e.target.value)}
              disabled={loadingVoices}
              className="w-full px-3 py-2 pr-8 rounded-lg bg-surface/80 border border-border/60 text-text-primary text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 appearance-none disabled:opacity-50"
            >
              <option value="">{t('默认', 'Default')}</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.language}) - {v.gender}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          </div>
        </SettingRow>

        <SettingRow label={t('语速', 'Speed')} description={t('调整语音播报速度', 'Adjust speech playback speed')}>
          <div className="flex items-center gap-3 w-full max-w-xs">
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={ttsSpeed}
              onChange={(e) => handleTtsSpeedChange(parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-full appearance-none bg-border/60 accent-accent"
            />
            <span className="text-sm text-text-muted w-10 text-right">{ttsSpeed.toFixed(1)}x</span>
          </div>
        </SettingRow>

        <SettingRow label={t('自动播报', 'Auto Speak')} description={t('AI回复后自动语音播报', 'Automatically speak AI responses')}>
          <button
            onClick={() => handleAutoSpeakChange(!autoSpeak)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${autoSpeak ? 'bg-accent' : 'bg-border/60'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${autoSpeak ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </SettingRow>

        <div className="pt-2">
          <button
            onClick={handleTestTts}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
            {t('测试语音', 'Test Voice')}
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="text-accent">{icon}</span>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="pl-7.5 space-y-4">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description && (
          <div className="text-xs text-text-muted mt-0.5">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
