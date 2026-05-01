import { useState, useCallback, useEffect, useRef } from 'react'
import {
    Plus, Trash2, Edit3, Check, Sparkles, Code2, BarChart3, PenTool,
    Settings, Shield, MoreHorizontal
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

const CATEGORY_LABELS: Record<string, { en: string; zh: string; color: string }> = {
    productivity: { en: 'Productivity', zh: '效率', color: 'text-blue-400' },
    development: { en: 'Development', zh: '开发', color: 'text-green-400' },
    data: { en: 'Data', zh: '数据', color: 'text-purple-400' },
    creative: { en: 'Creative', zh: '创意', color: 'text-pink-400' },
    education: { en: 'Education', zh: '教育', color: 'text-amber-400' },
    automation: { en: 'Automation', zh: '自动化', color: 'text-cyan-400' },
    custom: { en: 'Custom', zh: '自定义', color: 'text-text-muted' },
}

const LAYOUT_ICONS: Record<UILayout, string> = {
    'editor-centric': '📝',
    'chat-centric': '💬',
    'canvas-centric': '🎨',
    'dashboard-centric': '📊',
    'analytics-centric': '📈',
    'fullscreen-chat': '🖥️',
    'minimal': '✨',
}

export function ScenarioManagerView() {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const setSidebarWidth = useStore(s => s.setSidebarWidth)
    const prevWidthRef = useRef<number | null>(null)

    const [editingScenario, setEditingScenario] = useState<ScenarioPlugin | null>(null)
    const [showNewScenario, setShowNewScenario] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    useEffect(() => {
        const currentWidth = useStore.getState().sidebarWidth
        if (currentWidth < 360) {
            prevWidthRef.current = currentWidth
            setSidebarWidth(360)
        }
        return () => {
            if (prevWidthRef.current !== null) {
                setSidebarWidth(prevWidthRef.current)
            }
        }
    }, [setSidebarWidth])

    const scenarios = scenarioRegistry.getAll()

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
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
                <div>
                    <h2 className="text-sm font-semibold text-text-primary">
                        {language === 'zh' ? '场景管理' : 'Scenarios'}
                    </h2>
                    <p className="text-[10px] text-text-muted mt-0.5">
                        {language === 'zh' ? `${scenarios.length} 个场景` : `${scenarios.length} scenarios`}
                    </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => setShowNewScenario(true)} title={language === 'zh' ? '新建场景' : 'New Scenario'}>
                    <Plus className="w-4 h-4" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {scenarios.map(scenario => {
                    const IconComponent = ICON_MAP[scenario.icon] || Sparkles
                    const isActive = scenario.id === activeScenarioId
                    const isProtected = scenario.id === 'general-assistant'
                    const catLabel = CATEGORY_LABELS[scenario.category] || CATEGORY_LABELS.custom
                    const layoutIcon = LAYOUT_ICONS[scenario.ui.layout] || '✨'
                    const isExpanded = expandedId === scenario.id

                    return (
                        <div
                            key={scenario.id}
                            className={`
                                rounded-xl border transition-all duration-200 overflow-hidden
                                ${isActive
                                    ? 'border-accent/30 bg-accent/[0.06] shadow-sm shadow-accent/5'
                                    : 'border-border/20 bg-surface/20 hover:bg-surface/40 hover:border-border/40'}
                            `}
                        >
                            <div
                                className="px-3.5 py-3 cursor-pointer"
                                onClick={() => setExpandedId(isExpanded ? null : scenario.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? 'bg-accent/15' : 'bg-surface/60'}`}>
                                        <IconComponent className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-text-muted'}`} strokeWidth={1.5} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[13px] font-medium truncate ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                                                {language === 'zh' ? scenario.nameZh : scenario.name}
                                            </span>
                                            {isActive && (
                                                <span className="flex items-center gap-0.5 text-[9px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                                                    <Check className="w-2.5 h-2.5" strokeWidth={2.5} />
                                                    {language === 'zh' ? '当前' : 'Active'}
                                                </span>
                                            )}
                                            {isProtected && (
                                                <Shield className="w-3 h-3 text-amber-400/50 flex-shrink-0" strokeWidth={1.5} />
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] font-medium ${catLabel.color}`}>
                                                {language === 'zh' ? catLabel.zh : catLabel.en}
                                            </span>
                                            <span className="text-[10px] text-text-muted/40">·</span>
                                            <span className="text-[10px] text-text-muted/70">
                                                {layoutIcon} {scenario.ui.layout.replace('-', ' ')}
                                            </span>
                                        </div>
                                    </div>
                                    <MoreHorizontal className={`w-4 h-4 text-text-muted/30 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="px-3.5 pb-3 border-t border-border/10 pt-2.5">
                                    <p className="text-[11px] text-text-secondary leading-relaxed mb-3">
                                        {language === 'zh' ? scenario.descriptionZh : scenario.description}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {!isActive && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="h-7 text-[11px] gap-1.5 px-3 rounded-lg"
                                                onClick={(e) => { e.stopPropagation(); handleSwitch(scenario) }}
                                            >
                                                <Check className="w-3 h-3" />
                                                {language === 'zh' ? '切换' : 'Switch'}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-[11px] gap-1.5 px-3 rounded-lg"
                                            onClick={(e) => { e.stopPropagation(); setEditingScenario(scenario) }}
                                        >
                                            <Edit3 className="w-3 h-3" />
                                            {language === 'zh' ? '编辑' : 'Edit'}
                                        </Button>
                                        {!isProtected && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-[11px] gap-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-400/10"
                                                onClick={(e) => { e.stopPropagation(); handleDelete(scenario.id) }}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                                {language === 'zh' ? '删除' : 'Delete'}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            <div className="px-3 py-2.5 border-t border-border/20">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full text-xs gap-1.5 rounded-lg border border-dashed border-border/30 hover:border-accent/30 hover:text-accent"
                    onClick={() => setShowNewScenario(true)}
                >
                    <Plus className="w-3.5 h-3.5" />
                    {language === 'zh' ? '新建场景' : 'New Scenario'}
                </Button>
            </div>
        </div>
    )
}
