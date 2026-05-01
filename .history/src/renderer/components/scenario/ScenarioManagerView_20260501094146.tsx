import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Edit3, Check, Sparkles, Code2, BarChart3, PenTool,
    Settings, Shield
} from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/config/scenarios'
import { Button } from '../ui'
import type { ScenarioPlugin, UILayout } from '@shared/types/scenario'
import type { LucideIcon } from 'lucide-react'
import { ScenarioEditor } from './ScenarioEditor'

const ICON_MAP: Record<string, LucideIcon> = {
    Code2, BarChart3, PenTool, Sparkles, Settings,
}

const CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
    productivity: { en: 'Productivity', zh: '效率' },
    development: { en: 'Development', zh: '开发' },
    data: { en: 'Data', zh: '数据' },
    creative: { en: 'Creative', zh: '创意' },
    education: { en: 'Education', zh: '教育' },
    automation: { en: 'Automation', zh: '自动化' },
    custom: { en: 'Custom', zh: '自定义' },
}

const LAYOUT_LABELS: Record<UILayout, { en: string; zh: string }> = {
    'editor-centric': { en: 'Editor Centric', zh: '编辑器为主' },
    'chat-centric': { en: 'Chat Centric', zh: '对话为主' },
    'canvas-centric': { en: 'Canvas Centric', zh: '画布为主' },
    'dashboard-centric': { en: 'Dashboard Centric', zh: '仪表盘为主' },
    'analytics-centric': { en: 'Analytics Centric', zh: '分析为主' },
    'fullscreen-chat': { en: 'Fullscreen Chat', zh: '全屏对话' },
    'minimal': { en: 'Minimal', zh: '极简' },
}

export function ScenarioManagerView() {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)

    const [editingScenario, setEditingScenario] = useState<ScenarioPlugin | null>(null)
    const [showNewScenario, setShowNewScenario] = useState(false)

    const scenarios = scenarioRegistry.getAll()
    const activeScenario = scenarioRegistry.get(activeScenarioId)

    const handleSwitch = useCallback((scenario: ScenarioPlugin) => {
        scenarioRegistry.setActive(scenario.id)
        useStore.getState().set('activeScenarioId', scenario.id)
    }, [])

    const handleDelete = useCallback((scenarioId: string) => {
        if (scenarioId === 'general-assistant') return
        if (scenarioId === activeScenarioId) {
            const defaultScenario = scenarioRegistry.getDefault()
            handleSwitch(defaultScenario)
        }
        scenarioRegistry.unregister(scenarioId)
    }, [activeScenarioId, handleSwitch])

    const handleSave = useCallback((scenario: ScenarioPlugin) => {
        scenarioRegistry.register(scenario)
        setEditingScenario(null)
        setShowNewScenario(false)
    }, [])

    if (editingScenario || showNewScenario) {
        return (
            <ScenarioEditor
                scenario={editingScenario}
                isNew={showNewScenario}
                onSave={handleSave}
                onCancel={() => { setEditingScenario(null); setShowNewScenario(false) }}
            />
        )
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    {language === 'zh' ? '场景管理' : 'SCENARIOS'}
                </span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowNewScenario(true)} title={language === 'zh' ? '新建场景' : 'New Scenario'}>
                    <Plus className="w-3 h-3" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {scenarios.map(scenario => {
                    const IconComponent = ICON_MAP[scenario.icon] || Sparkles
                    const isActive = scenario.id === activeScenarioId
                    const isProtected = scenario.id === 'general-assistant'
                    const catLabel = CATEGORY_LABELS[scenario.category] || CATEGORY_LABELS.custom
                    const layoutLabel = LAYOUT_LABELS[scenario.ui.layout] || LAYOUT_LABELS.minimal

                    return (
                        <div
                            key={scenario.id}
                            className={`px-3 py-2.5 border-b border-border/10 transition-colors ${isActive ? 'bg-accent/5' : 'hover:bg-surface-hover'}`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-accent/15' : 'bg-surface/50'}`}>
                                    <IconComponent className={`w-3.5 h-3.5 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-sm text-text-primary truncate">{language === 'zh' ? scenario.nameZh : scenario.name}</span>
                                        {isActive && <Check className="w-3 h-3 text-accent flex-shrink-0" strokeWidth={2} />}
                                        {isProtected && <Shield className="w-3 h-3 text-amber-400/60 flex-shrink-0" strokeWidth={1.5} />}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[10px] text-text-muted">{language === 'zh' ? catLabel.zh : catLabel.en}</span>
                                        <span className="text-[10px] text-text-muted/50">·</span>
                                        <span className="text-[10px] text-text-muted">{language === 'zh' ? layoutLabel.zh : layoutLabel.en}</span>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] text-text-secondary mt-1.5 line-clamp-2 leading-relaxed">
                                {language === 'zh' ? scenario.descriptionZh : scenario.description}
                            </p>

                            <div className="flex items-center gap-1.5 mt-2">
                                {!isActive && (
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => handleSwitch(scenario)}>
                                        <Check className="w-2.5 h-2.5" />
                                        {language === 'zh' ? '切换' : 'Switch'}
                                    </Button>
                                )}
                                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2" onClick={() => setEditingScenario(scenario)}>
                                    <Edit3 className="w-2.5 h-2.5" />
                                    {language === 'zh' ? '编辑' : 'Edit'}
                                </Button>
                                {!isProtected && (
                                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2 text-red-400/70 hover:text-red-400" onClick={() => handleDelete(scenario.id)}>
                                        <Trash2 className="w-2.5 h-2.5" />
                                        {language === 'zh' ? '删除' : 'Delete'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div className="px-3 py-2 border-t border-border/30">
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowNewScenario(true)}>
                    <Plus className="w-3 h-3" />
                    {language === 'zh' ? '新建场景' : 'New Scenario'}
                </Button>
            </div>
        </div>
    )
}
