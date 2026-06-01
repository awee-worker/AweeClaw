import { useState, useEffect, useCallback, useMemo } from 'react'
import { Code2, RotateCcw, AlertTriangle, Check, Gauge, Shield, Sparkles } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

interface ProviderPreset {
  payload: Record<string, unknown>
  tokenBudget: number
  supportsStreaming: boolean
  supportsTools: boolean
  maxTemperature: number
}

const SCENARIO_PRESETS: Record<string, Record<string, ProviderPreset>> = {
  'workspace-editor': {
    openai: { payload: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.3, top_p: 0.95 }, tokenBudget: 8192, supportsStreaming: true, supportsTools: true, maxTemperature: 1.0 },
    anthropic: { payload: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.3 }, tokenBudget: 8192, supportsStreaming: true, supportsTools: true, maxTemperature: 1.0 },
    deepseek: { payload: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.3, top_p: 0.95 }, tokenBudget: 8192, supportsStreaming: true, supportsTools: true, maxTemperature: 1.0 },
    gemini: { payload: { model: '{{model}}', maxOutputTokens: 8192, temperature: 0.3 }, tokenBudget: 8192, supportsStreaming: true, supportsTools: true, maxTemperature: 1.0 },
    ollama: { payload: { model: '{{model}}', stream: true, options: { num_predict: 8192, temperature: 0.3 } }, tokenBudget: 8192, supportsStreaming: true, supportsTools: false, maxTemperature: 1.0 },
  },
  'legal-review': {
    openai: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.1, top_p: 0.8, presence_penalty: 0.1 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.5 },
    anthropic: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.1 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.5 },
    deepseek: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.1, top_p: 0.8 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.5 },
    gemini: { payload: { model: '{{model}}', maxOutputTokens: 4096, temperature: 0.1 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.5 },
    ollama: { payload: { model: '{{model}}', stream: true, options: { num_predict: 4096, temperature: 0.1 } }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.5 },
  },
  'education-tutor': {
    openai: { payload: { model: '{{model}}', max_tokens: 6144, stream: true, temperature: 0.6, top_p: 0.9, frequency_penalty: 0.3 }, tokenBudget: 6144, supportsStreaming: true, supportsTools: true, maxTemperature: 1.2 },
    anthropic: { payload: { model: '{{model}}', max_tokens: 6144, stream: true, temperature: 0.6 }, tokenBudget: 6144, supportsStreaming: true, supportsTools: true, maxTemperature: 1.2 },
    deepseek: { payload: { model: '{{model}}', max_tokens: 6144, stream: true, temperature: 0.6, top_p: 0.9 }, tokenBudget: 6144, supportsStreaming: true, supportsTools: true, maxTemperature: 1.2 },
    gemini: { payload: { model: '{{model}}', maxOutputTokens: 6144, temperature: 0.6 }, tokenBudget: 6144, supportsStreaming: true, supportsTools: true, maxTemperature: 1.2 },
    ollama: { payload: { model: '{{model}}', stream: true, options: { num_predict: 6144, temperature: 0.6 } }, tokenBudget: 6144, supportsStreaming: true, supportsTools: false, maxTemperature: 1.2 },
  },
  'medical-assistant': {
    openai: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.05, top_p: 0.7, presence_penalty: 0.2 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.3 },
    anthropic: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.05 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.3 },
    deepseek: { payload: { model: '{{model}}', max_tokens: 4096, stream: true, temperature: 0.05, top_p: 0.7 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.3 },
    gemini: { payload: { model: '{{model}}', maxOutputTokens: 4096, temperature: 0.05 }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.3 },
    ollama: { payload: { model: '{{model}}', stream: true, options: { num_predict: 4096, temperature: 0.05 } }, tokenBudget: 4096, supportsStreaming: true, supportsTools: false, maxTemperature: 0.3 },
  },
}

const FALLBACK_PRESET: ProviderPreset = {
  payload: { model: '{{model}}', max_tokens: 8192, stream: true, temperature: 0.7 },
  tokenBudget: 8192,
  supportsStreaming: true,
  supportsTools: true,
  maxTemperature: 2.0,
}

const SCENARIO_LABELS: Record<string, { en: string; zh: string; icon: string }> = {
  'workspace-editor': { en: 'Code Editor', zh: '代码编辑', icon: '💻' },
  'legal-review': { en: 'Legal Review', zh: '法律审查', icon: '⚖️' },
  'education-tutor': { en: 'Education Tutor', zh: '教育辅导', icon: '📚' },
  'medical-assistant': { en: 'Medical Assistant', zh: '医疗助手', icon: '🏥' },
}

interface PayloadConfiguratorProps {
  providerId: string
  scenarioId?: string
  requestBody?: Record<string, unknown>
  onChange: (body: Record<string, unknown>) => void
  language: 'en' | 'zh'
}

interface ValidationWarning {
  field: string
  level: 'error' | 'warning' | 'info'
  message: string
}

function estimateTokenCount(obj: Record<string, unknown>): number {
  const serialized = JSON.stringify(obj)
  return Math.ceil(serialized.length / 4)
}

function validatePayload(payload: Record<string, unknown>, preset: ProviderPreset): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  const temp = payload.temperature as number | undefined
  if (temp !== undefined) {
    if (temp > preset.maxTemperature) {
      warnings.push({ field: 'temperature', level: 'error', message: `Temperature ${temp} exceeds max ${preset.maxTemperature} for this scenario` })
    } else if (temp > preset.maxTemperature * 0.8) {
      warnings.push({ field: 'temperature', level: 'warning', message: `Temperature ${temp} is high for this scenario (max ${preset.maxTemperature})` })
    }
  }

  const maxTokens = (payload.max_tokens || payload.maxOutputTokens || payload.options) as number | undefined
  if (maxTokens !== undefined && maxTokens > preset.tokenBudget * 1.5) {
    warnings.push({ field: 'max_tokens', level: 'warning', message: `Token limit ${maxTokens} significantly exceeds budget ${preset.tokenBudget}` })
  }

  if (payload.stream === false && preset.supportsStreaming) {
    warnings.push({ field: 'stream', level: 'info', message: 'Streaming is disabled; responses may feel slower' })
  }

  if (payload.tools && !preset.supportsTools) {
    warnings.push({ field: 'tools', level: 'error', message: 'Tool calling is not supported in this scenario configuration' })
  }

  return warnings
}

export default function ApiPayloadConfigurator({ providerId, scenarioId, requestBody, onChange, language }: PayloadConfiguratorProps) {
  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [activeScenario, setActiveScenario] = useState(scenarioId || 'workspace-editor')

  const currentPreset = useMemo(() => {
    const scenarioPresets = SCENARIO_PRESETS[activeScenario]
    if (scenarioPresets && scenarioPresets[providerId]) {
      return scenarioPresets[providerId]
    }
    return FALLBACK_PRESET
  }, [activeScenario, providerId])

  const validationWarnings = useMemo(() => {
    if (parseError) return []
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null) {
        return validatePayload(parsed as Record<string, unknown>, currentPreset)
      }
    } catch { /* ignore */ }
    return []
  }, [text, parseError, currentPreset])

  const tokenEstimate = useMemo(() => {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null) {
        return estimateTokenCount(parsed as Record<string, unknown>)
      }
    } catch { /* ignore */ }
    return 0
  }, [text])

  useEffect(() => {
    const initial = requestBody ?? currentPreset.payload
    setText(JSON.stringify(initial, null, 2))
    setParseError(null)
  }, [providerId, activeScenario])

  useEffect(() => {
    if (requestBody) setText(JSON.stringify(requestBody, null, 2))
  }, [requestBody])

  const onEdit = useCallback((raw: string) => {
    setText(raw)
    setConfirmed(false)
    try {
      const parsed = JSON.parse(raw)
      setParseError(null)
      onChange(parsed)
      setConfirmed(true)
      setTimeout(() => setConfirmed(false), 1500)
    } catch (e: any) {
      setParseError(e.message)
    }
  }, [onChange])

  const onReset = useCallback(() => {
    const serialized = JSON.stringify(currentPreset.payload, null, 2)
    setText(serialized)
    setParseError(null)
    onChange(currentPreset.payload)
  }, [currentPreset, onChange])

  const onScenarioSwitch = useCallback((scenario: string) => {
    setActiveScenario(scenario)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2.5 text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          <Code2 className="w-3.5 h-3.5 text-accent" />
          {t('modals.apipayloadconfigurator', language as Language)}
        </label>
        <div className="flex items-center gap-3">
          {confirmed && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20 animate-fade-in">
              <Check className="w-3 h-3" strokeWidth={3} />
              {t('modals.saved', language as Language)}
            </span>
          )}
          <button onClick={onReset} className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-text-muted hover:text-text-primary transition-all rounded-lg bg-white/5 border border-transparent hover:border-border" title={t('modals.resettoscenariodefault', language as Language)}>
            <RotateCcw className="w-3 h-3" />
            {t('modals.reset', language as Language)}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-50">{t('modals.scenario', language as Language)}:</span>
        {Object.entries(SCENARIO_LABELS).map(([id, label]) => (
          <button
            key={id}
            onClick={() => onScenarioSwitch(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${activeScenario === id ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-white/5 text-text-muted border border-transparent hover:border-border'}`}
          >
            <span>{label.icon}</span>
            {language === 'zh' ? label.zh : label.en}
          </button>
        ))}
      </div>

      <p className="text-[12px] text-text-muted leading-relaxed opacity-60 ml-1">
        {t('modals.scenarioawareapipayloadconfigurationwill', language as Language, { p0: SCENARIO_LABELS[activeScenario]?.en || activeScenario, p1: SCENARIO_LABELS[activeScenario]?.zh || activeScenario })}
      </p>

      <div className="relative group">
        <textarea
          value={text}
          onChange={e => onEdit(e.target.value)}
          className={`w-full px-4 py-3 text-[13px] font-mono leading-relaxed bg-black/30 backdrop-blur-sm border rounded-xl text-text-secondary focus:outline-none focus:text-text-primary transition-all shadow-inner ${parseError ? 'border-red-500/50 focus:border-red-500 ring-2 ring-red-500/10' : 'border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/10'}`}
          rows={12}
          spellCheck={false}
        />
        {parseError && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-2 text-[12px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg shadow-xl animate-scale-in">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">JSON Syntax Error: {parseError}</span>
          </div>
        )}
      </div>

      {validationWarnings.length > 0 && !parseError && (
        <div className="space-y-1.5">
          {validationWarnings.map((w, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium ${w.level === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : w.level === 'warning' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'}`}>
              {w.level === 'error' ? <Shield className="w-3 h-3" /> : w.level === 'warning' ? <AlertTriangle className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-white/[0.02] rounded-xl border border-border flex flex-col gap-2 shadow-sm">
          <div className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40">{t('modals.commonfields', language as Language)}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">temperature</code>
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">top_p</code>
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">max_tokens</code>
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">stream</code>
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">presence_penalty</code>
            <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">frequency_penalty</code>
          </div>
        </div>
        <div className="p-3 bg-white/[0.02] rounded-xl border border-border flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Gauge className="w-3 h-3 text-accent/60" />
            <span className="text-[11px] font-black text-text-muted uppercase tracking-widest opacity-40">{t('modals.tokenbudget', language as Language)}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${tokenEstimate > currentPreset.tokenBudget ? 'bg-red-500' : tokenEstimate > currentPreset.tokenBudget * 0.8 ? 'bg-yellow-500' : 'bg-accent/60'}`}
                style={{ width: `${Math.min(100, (tokenEstimate / currentPreset.tokenBudget) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-text-muted">{tokenEstimate}/{currentPreset.tokenBudget}</span>
          </div>
          <div className="flex gap-3 text-[10px] text-text-muted/60">
            <span>Stream: {currentPreset.supportsStreaming ? '✓' : '✗'}</span>
            <span>Tools: {currentPreset.supportsTools ? '✓' : '✗'}</span>
            <span>Max T: {currentPreset.maxTemperature}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
