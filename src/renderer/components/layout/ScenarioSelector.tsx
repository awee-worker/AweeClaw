/**
 * ScenarioSelector - 场景应用切换器（顶部栏内嵌）
 * 紧凑下拉样式，放在工作区选择器右侧
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Sparkles, ChevronDown, Check, Store } from 'lucide-react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { activateScenarioPanels, switchToFirstPanel } from '@components/scenario/panelUtils'

interface ScenarioSelectorProps {
    className?: string
    onOpenMarketplace?: () => void
}

export default function ScenarioSelector({ className = '', onOpenMarketplace }: ScenarioSelectorProps) {
    const language = useStore(s => s.language)
    const activeScenarioId = useStore(s => s.activeScenarioId)
    const [isOpen, setIsOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const isZh = language === 'zh'

    const scenarios = useMemo(() => {
        return scenarioRegistry.getAll().map((s) => ({
            id: s.id,
            name: isZh ? s.nameZh || s.name : s.name,
        }))
    }, [isZh])

    // 点击外部关闭
    useEffect(() => {
        if (!isOpen) return
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen])

    const handleScenarioSwitch = useCallback((scenarioId: string) => {
        if (scenarioId === activeScenarioId) return
        const scenario = scenarioRegistry.get(scenarioId)
        if (!scenario) return

        scenarioRegistry.setActive(scenarioId)
        useStore.getState().set('activeScenarioId', scenarioId)
        void useStore.getState().save()
        activateScenarioPanels(scenario)
        switchToFirstPanel(scenario)
        setIsOpen(false)
    }, [activeScenarioId])

    const currentName = activeScenarioId
        ? scenarios.find(s => s.id === activeScenarioId)?.name || (isZh ? '默认场景' : 'Default')
        : (isZh ? '默认场景' : 'Default')

    return (
        <div className={`no-drag relative ${className}`} ref={containerRef}>
            <button
                onClick={() => setIsOpen(v => !v)}
                className="flex items-center gap-1.5 px-2 h-[28px] rounded-md hover:bg-text-primary/[0.06] transition-all duration-200 text-text-muted hover:text-text-primary"
                title={isZh ? '切换场景应用' : 'Switch Scenario'}
            >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-xs max-w-[80px] truncate">{currentName}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-48 rounded-xl bg-surface border border-border/30 shadow-xl z-50 overflow-hidden">
                    <div className="max-h-80 overflow-y-auto p-1.5 space-y-0.5">
                        {/* 已安装的场景 */}
                        {scenarios.map((scenario) => {
                            const isActive = activeScenarioId === scenario.id
                            return (
                                <button
                                    key={scenario.id}
                                    onClick={() => handleScenarioSwitch(scenario.id)}
                                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                                        isActive
                                            ? 'bg-accent/10 text-accent'
                                            : 'text-text-primary hover:bg-surface-hover'
                                    }`}
                                >
                                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{scenario.name}</span>
                                    {isActive && <Check className="w-3.5 h-3.5 ml-auto" />}
                                </button>
                            )
                        })}

                        {scenarios.length === 0 && (
                            <div className="px-2.5 py-3 text-center text-xs text-text-muted">
                                {isZh ? '暂无已安装场景' : 'No scenarios installed'}
                            </div>
                        )}

                        {/* 分割线 */}
                        <div className="h-px bg-border/50 my-1.5 mx-1" />

                        {/* 场景应用市场入口 */}
                        <button
                            onClick={() => {
                                setIsOpen(false)
                                onOpenMarketplace?.()
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-text-primary hover:bg-surface-hover transition-colors"
                        >
                            <Store className="w-3.5 h-3.5 shrink-0 text-accent" />
                            <span className="truncate">{isZh ? '场景应用市场' : 'Scenario Marketplace'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
