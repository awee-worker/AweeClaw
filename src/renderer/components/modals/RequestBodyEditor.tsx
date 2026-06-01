import { useState, useEffect, useCallback } from 'react'
import { Code2, RotateCcw, AlertTriangle, Check } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

const BASE_TEMPLATE: Record<string, unknown> = {
  model: '{{model}}',
  max_tokens: 8192,
  stream: true,
  temperature: 0.7,
}

const VENDOR_PRESETS: Record<string, Record<string, unknown>> = {
  openai: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.7 },
  anthropic: { model: '{{model}}', max_tokens: 8192, stream: true },
  deepseek: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.7 },
  gemini: { model: '{{model}}', maxOutputTokens: 8192 },
  ollama: { model: '{{model}}', stream: true, options: { num_predict: 8192, temperature: 0.7 } },
}

interface PayloadEditorProps {
  providerId: string
  requestBody?: Record<string, unknown>
  onChange: (body: Record<string, unknown>) => void
  language: 'en' | 'zh'
}

export default function RequestBodyEditor({ providerId, requestBody, onChange, language }: PayloadEditorProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    const preset = VENDOR_PRESETS[providerId] ?? BASE_TEMPLATE
    const initial = requestBody ?? preset
    setText(JSON.stringify(initial, null, 2))
    setError(null)
  }, [providerId])

  useEffect(() => {
    if (requestBody) setText(JSON.stringify(requestBody, null, 2))
  }, [requestBody])

  const onEdit = useCallback((raw: string) => {
    setText(raw)
    setConfirmed(false)
    try {
      const parsed = JSON.parse(raw)
      setError(null)
      onChange(parsed)
      setConfirmed(true)
      setTimeout(() => setConfirmed(false), 1500)
    } catch (e: any) {
      setError(e.message)
    }
  }, [onChange])

  const onReset = useCallback(() => {
    const preset = VENDOR_PRESETS[providerId] ?? BASE_TEMPLATE
    const serialized = JSON.stringify(preset, null, 2)
    setText(serialized)
    setError(null)
    onChange(preset)
  }, [providerId, onChange])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2.5 text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          <Code2 className="w-3.5 h-3.5 text-accent" />
          {t('modals.requestbodyconfig', language as Language)}
        </label>
        <div className="flex items-center gap-3">
          {confirmed && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20 animate-fade-in">
              <Check className="w-3 h-3" strokeWidth={3} />
              {t('modals.saved', language as Language)}
            </span>
          )}
          <button onClick={onReset} className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-text-muted hover:text-text-primary transition-all rounded-lg bg-white/5 border border-transparent hover:border-border" title={t('modals.resettodefault', language as Language)}>
            <RotateCcw className="w-3 h-3" />
            {t('modals.reset', language as Language)}
          </button>
        </div>
      </div>

      <p className="text-[12px] text-text-muted leading-relaxed opacity-60 ml-1">
        {t('modals.customizethejsonstructuresent', language as Language)}
      </p>

      <div className="relative group">
        <textarea
          value={text}
          onChange={e => onEdit(e.target.value)}
          className={`w-full px-4 py-3 text-[13px] font-mono leading-relaxed bg-black/30 backdrop-blur-sm border rounded-xl text-text-secondary focus:outline-none focus:text-text-primary transition-all shadow-inner ${error ? 'border-red-500/50 focus:border-red-500 ring-2 ring-red-500/10' : 'border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/10'}`}
          rows={12}
          spellCheck={false}
        />
        {error && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-2 text-[12px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg shadow-xl animate-scale-in">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">JSON Error: {error}</span>
          </div>
        )}
      </div>

      <div className="p-4 bg-white/[0.02] rounded-xl border border-border flex flex-col gap-2 shadow-sm">
        <div className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40">{t('modals.commonfields', language as Language)}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <code className="text-[12px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">temperature</code>
          <code className="text-[12px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">top_p</code>
          <code className="text-[12px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">max_tokens</code>
          <code className="text-[12px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">stream</code>
        </div>
      </div>
    </div>
  )
}
