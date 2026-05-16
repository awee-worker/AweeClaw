import { Globe, Check } from 'lucide-react'
import type { Language } from '@renderer/i18n'
import { LANGUAGES } from '../preferencesTypes'

interface LanguageSettingsProps {
    language: Language
    localLanguage: Language
    setLocalLanguage: (lang: Language) => void
}

const LANGUAGE_META: Record<Language, { labelZh: string; labelEn: string; descriptionZh: string; descriptionEn: string; flag: string }> = {
    zh: {
        labelZh: '中文',
        labelEn: 'Chinese',
        descriptionZh: '界面文字显示为简体中文',
        descriptionEn: 'Display interface in Simplified Chinese',
        flag: '🇨🇳',
    },
    en: {
        labelZh: 'English',
        labelEn: 'English',
        descriptionZh: '界面文字显示为英文',
        descriptionEn: 'Display interface in English',
        flag: '🇺🇸',
    },
}

export function LanguageSettings({ language, localLanguage, setLocalLanguage }: LanguageSettingsProps) {
    const isZh = language === 'zh'

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Globe className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {isZh ? '界面语言' : 'Interface Language'}
                    </h4>
                </div>

                <p className="text-sm text-text-muted mb-6 ml-1">
                    {isZh ? '选择你偏好的界面显示语言，更改将在保存后生效。' : 'Choose your preferred interface language. Changes take effect after saving.'}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {LANGUAGES.map(item => {
                        const meta = LANGUAGE_META[item.id]
                        const isActive = localLanguage === item.id
                        return (
                            <button
                                key={item.id}
                                onClick={() => setLocalLanguage(item.id)}
                                className={`group relative p-5 rounded-xl border text-left transition-all duration-300 ${
                                    isActive
                                        ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                        : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                }`}
                            >
                                <div className="flex items-start gap-4">
                                    <span className="text-3xl leading-none">{meta.flag}</span>
                                    <div className="flex-1 min-w-0">
                                        <span className={`text-base font-semibold block truncate transition-colors ${isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                            {isZh ? meta.labelZh : meta.labelEn}
                                        </span>
                                        <span className="text-xs text-text-muted mt-1 block">
                                            {isZh ? meta.descriptionZh : meta.descriptionEn}
                                        </span>
                                    </div>
                                </div>
                                {isActive && (
                                    <div className="absolute top-4 right-4 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                    </div>
                                )}
                            </button>
                        )
                    })}
                </div>
            </section>
        </div>
    )
}
