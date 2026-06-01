import { useState, useEffect, useCallback } from 'react'
import { rulesService } from '@intelligence/runtime/ruleEngine'
import { ActionButton } from '@components/ui'
import { FileText, RefreshCw, AlertCircle, Save, RotateCcw } from 'lucide-react'
import { BRAND } from '@shared/brand'
import { t, type Language } from '@renderer/i18n'

interface RulesSettingsProps {
  language: Language
}

export function RulesSettings({ language }: RulesSettingsProps) {
  const [rulesContent, setRulesContent] = useState('')
  const [rulesSource, setRulesSource] = useState<string | null>(null)
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesModified, setRulesModified] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadRules = useCallback(async () => {
    setRulesLoading(true)
    const rules = await rulesService.getRules(true)
    if (rules) {
      setRulesContent(rules.content)
      setRulesSource(rules.source)
    } else {
      setRulesContent(rulesService.getDefaultRulesTemplate())
      setRulesSource(null)
    }
    setRulesModified(false)
    setRulesLoading(false)
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleSaveRules = async () => {
    setRulesSaving(true)
    const success = await rulesService.saveRules(rulesContent)
    if (success) {
      setRulesSource(BRAND.paths.rules)
      setRulesModified(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    }
    setRulesSaving(false)
  }

  const handleReset = () => {
    setRulesContent(rulesService.getDefaultRulesTemplate())
    setRulesModified(true)
  }

  const supportedFiles = [
    { path: BRAND.paths.rules, desc: t('app.recommended', language as Language) },
    { path: `.${BRAND.cssPrefix}rules`, desc: '' },
    { path: '.cursorrules', desc: t('app.cursorcompatible', language as Language) },
    { path: '.cursor/rules.md', desc: t('app.cursorcompatible2', language as Language) },
    { path: 'CODING_GUIDELINES.md', desc: '' },
  ]

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="p-5 bg-surface/30 rounded-xl border border-border space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h5 className="text-sm font-medium text-text-primary">
                {t('app.behaviorrules', language as Language)}
              </h5>
              <p className="text-xs text-text-muted mt-0.5">
                {t('app.defineaiagentbehavior', language as Language)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {rulesSource && (
              <span className="text-[11px] text-text-muted px-2 py-0.5 bg-white/[0.06] rounded">
                {rulesSource}
              </span>
            )}
            <button
              onClick={loadRules}
              className="p-1.5 text-text-muted hover:text-accent transition-colors rounded-md hover:bg-accent/10"
              title={t('app.refresh', language as Language)}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-accent/5 border border-accent/15 text-xs text-text-muted space-y-2">
          <p className="font-medium text-accent/80">{t('app.supportedrulefilesby', language as Language)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {supportedFiles.map((f) => (
              <span key={f.path} className="font-mono text-[12px]">
                <span className="text-text-secondary">{f.path}</span>
                {f.desc && <span className="text-text-muted ml-1">({f.desc})</span>}
              </span>
            ))}
          </div>
        </div>

        {rulesLoading ? (
          <div className="h-80 flex items-center justify-center text-text-muted">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="relative">
              <textarea
                value={rulesContent}
                onChange={(e) => {
                  setRulesContent(e.target.value)
                  setRulesModified(true)
                }}
                className="w-full h-80 p-4 bg-white/[0.04] rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-y text-[13px] font-mono leading-relaxed custom-scrollbar text-text-primary placeholder-text-muted/50"
                placeholder={t('app.behaviorrulesnnwriteaibehavior', language as Language)}
                spellCheck={false}
              />
              {rulesModified && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <AlertCircle className="w-3 h-3 text-amber-400" />
                  <span className="text-[11px] text-amber-400">{t('app.unsaved', language as Language)}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t('app.resettodefaulttemplate', language as Language)}
              </button>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="text-xs text-green-400 flex items-center gap-1 animate-fade-in">
                    <Save className="w-3 h-3" />
                    {t('app.saved', language as Language)}
                  </span>
                )}
                <ActionButton
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRules}
                  disabled={!rulesModified || rulesSaving}
                  className="text-xs gap-1.5"
                >
                  {rulesSaving
                    ? t('app.saving', language as Language)
                    : t('app.saverules', language as Language)
                  }
                </ActionButton>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="p-4 bg-surface/20 rounded-xl border border-border/50 space-y-3">
        <h6 className="text-xs font-medium text-text-primary">{t('app.rulewritingtips', language as Language)}</h6>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-text-muted">
          <div className="space-y-1.5">
            <p className="font-medium text-text-secondary">{t('app.recommendedstructure', language as Language)}</p>
            <pre className="text-[12px] font-mono bg-white/[0.04] p-2.5 rounded-lg leading-relaxed text-text-muted">{`# Project Rules

## Code Style
- Use TypeScript
- Functional components

## Conventions
- async/await over .then()
- const over let

## Project Structure
- Components: src/components/
- Utilities: src/`}</pre>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-text-secondary">{t('app.bestpractices', language as Language)}</p>
            <ul className="space-y-1.5 text-[12px]">
              <li className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5">•</span>
                {t('app.keeprulesconciseand', language as Language)}
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5">•</span>
                {t('app.usemarkdownformatfor', language as Language)}
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5">•</span>
                {t('app.groupbycategorycode', language as Language)}
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-accent mt-0.5">•</span>
                {t('app.rulesareautomaticallyinjected', language as Language)}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
