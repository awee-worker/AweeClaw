import { Layout, Type, Check } from 'lucide-react'
import { useStore, type ThemeName } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager } from '@/renderer/config/themeConfig'
import { api } from '@/renderer/services/electronAPI'
import { Input, Select } from '@components/ui'
import { EditorSettingsProps } from '../types'

export function AppearanceSettings({ settings, setSettings, language }: EditorSettingsProps) {
    const { currentTheme, setTheme } = useStore(useShallow(s => ({ currentTheme: s.currentTheme, setTheme: s.setTheme })))
    const allThemes = themeManager.getAllThemes().map(t => t.id)

    const handleThemeChange = (themeId: string) => {
        setTheme(themeId as ThemeName)
        api.settings.set('themeId', themeId)
    }

    const sectionClass = "p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm hover:border-border transition-colors duration-300"
    const labelClass = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"
    const inputClass = "bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Layout className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '外观主题' : 'Appearance Theme'}
                    </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {allThemes.map(themeId => {
                        const theme = themeManager.getThemeById(themeId)!
                        const themeVars = theme.colors
                        return (
                            <button
                                key={themeId}
                                onClick={() => handleThemeChange(themeId)}
                                className={`group relative p-4 rounded-xl border text-left transition-all duration-300 overflow-hidden ${currentTheme === themeId
                                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                    : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                            >
                                <div className="flex gap-2.5 mb-4">
                                    <div className="w-8 h-8 rounded-full shadow-md ring-2 ring-white/10" style={{ backgroundColor: `rgb(${themeVars.background})` }} title="Background" />
                                    <div className="w-8 h-8 rounded-full shadow-md ring-2 ring-white/10" style={{ backgroundColor: `rgb(${themeVars.accent})` }} title="Accent" />
                                </div>
                                <span className={`text-sm font-semibold capitalize block truncate transition-colors ${currentTheme === themeId ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                    {themeId.replace(/-/g, ' ')}
                                </span>
                                {currentTheme === themeId && (
                                    <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                        <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                    </div>
                                )}
                            </button>
                        )
                    })}
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className={sectionClass}>
                    <div className="flex items-center gap-2 mb-1">
                        <Type className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? '排版与布局' : 'Typography & Layout'}</h5>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                        <div>
                            <label className={labelClass}>{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                            <Input
                                type="number"
                                value={settings.fontSize}
                                onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })}
                                min={10}
                                max={32}
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{language === 'zh' ? 'Tab 大小' : 'Tab Size'}</label>
                            <Select
                                value={settings.tabSize.toString()}
                                onChange={(value) => setSettings({ ...settings, tabSize: parseInt(value) })}
                                options={[{ value: '2', label: '2 Spaces' }, { value: '4', label: '4 Spaces' }, { value: '8', label: '8 Spaces' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{language === 'zh' ? '自动换行' : 'Word Wrap'}</label>
                            <Select
                                value={settings.wordWrap}
                                onChange={(value) => setSettings({ ...settings, wordWrap: value as 'on' | 'off' | 'wordWrapColumn' })}
                                options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'Column' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{language === 'zh' ? '行号' : 'Line Numbers'}</label>
                            <Select
                                value={settings.lineNumbers}
                                onChange={(value) => setSettings({ ...settings, lineNumbers: value as 'on' | 'off' | 'relative' })}
                                options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                    </div>
                </section>

                <section className={sectionClass}>
                    <div className="flex items-center gap-2 mb-1">
                        <Type className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? 'Agent 聊天区域' : 'Agent Chat Area'}</h5>
                    </div>
                    <div>
                        <label className={labelClass}>{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                        <Input
                            type="number"
                            value={settings.chatFontSize}
                            onChange={(e) => setSettings({ ...settings, chatFontSize: parseInt(e.target.value) || 14 })}
                            min={10}
                            max={32}
                            className={inputClass}
                        />
                    </div>
                </section>
            </div>
        </div>
    )
}
