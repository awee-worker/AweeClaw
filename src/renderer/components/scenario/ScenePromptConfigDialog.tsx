/**
 * 场景级 Prompt 配置弹窗
 *
 * 职责：为每个已安装场景独立配置 Prompt 模板和自定义指令
 *
 * 数据存储：通过 api.settings.set/get 持久化到 'scene-prompt-config' key
 * 数据结构：Record<scenarioId, ScenePromptConfig>
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileText, Eye, RotateCcw, Save, Sparkles, Info } from 'lucide-react'
import { OverlayDialog, ActionButton } from '@components/ui'
import { DropdownSelector } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { getPromptTemplates, getPromptTemplateById, getDefaultPromptTemplate } from '@intelligence/prompt-engine/promptLibrary'
import { PromptPreviewDialog } from '../settings/tabs/PromptPreviewDialog'
import { api } from '../../adapters/electronBridge'
import { useStore } from '@store'
import type { Language } from '@renderer/i18n'

/** 场景级 Prompt 配置 */
export interface ScenePromptConfig {
    /** Prompt 模板 ID（未配置时使用全局默认） */
    promptTemplateId: string
    /** 场景级自定义指令（叠加在模板之上） */
    customInstructions: string
    /** 是否启用场景级配置（false 时回退到全局） */
    enabled: boolean
}

/** 存储所有场景的配置：Record<scenarioId, ScenePromptConfig> */
const STORAGE_KEY = 'scene-prompt-config'

/** 从存储加载某场景的配置 */
async function loadScenePromptConfig(scenarioId: string): Promise<ScenePromptConfig | null> {
    try {
        const all = (await api.settings.get(STORAGE_KEY)) as Record<string, ScenePromptConfig> | null
        return all?.[scenarioId] ?? null
    } catch {
        return null
    }
}

/** 保存某场景的配置（合并写入） */
async function saveScenePromptConfig(scenarioId: string, config: ScenePromptConfig): Promise<void> {
    const all = ((await api.settings.get(STORAGE_KEY)) as Record<string, ScenePromptConfig> | null) || {}
    all[scenarioId] = config
    await api.settings.set(STORAGE_KEY, all)
}

interface ScenePromptConfigDialogProps {
    scenarioId: string
    scenarioName: string
    language: Language
    onClose: () => void
    /** 配置保存后的回调（用于通知调用方刷新） */
    onSaved?: () => void
}

export function ScenePromptConfigDialog({
    scenarioId,
    scenarioName,
    language,
    onClose,
    onSaved,
}: ScenePromptConfigDialogProps) {
    const globalPromptTemplateId = useStore(s => s.promptTemplateId) || getDefaultPromptTemplate().id
    const globalAiInstructions = useStore(s => s.aiInstructions) || ''

    const templates = useMemo(() => getPromptTemplates(), [])
    const templateOptions = useMemo(() =>
        templates.map(t => ({
            value: t.id,
            label: language === 'zh' ? t.nameZh : t.name,
        })), [templates, language])

    const [config, setConfig] = useState<ScenePromptConfig>(() => ({
        promptTemplateId: globalPromptTemplateId,
        customInstructions: '',
        enabled: false,
    }))
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null)

    // 加载已有配置
    useEffect(() => {
        let cancelled = false
        loadScenePromptConfig(scenarioId).then(saved => {
            if (cancelled) return
            if (saved) {
                setConfig(saved)
            } else {
                // 未配置时使用全局默认值
                setConfig({
                    promptTemplateId: globalPromptTemplateId,
                    customInstructions: globalAiInstructions,
                    enabled: false,
                })
            }
            setLoading(false)
        })
        return () => { cancelled = true }
    }, [scenarioId, globalPromptTemplateId, globalAiInstructions])

    const handleTemplateChange = useCallback((value: string) => {
        setConfig(prev => ({ ...prev, promptTemplateId: value }))
    }, [])

    const handleInstructionsChange = useCallback((value: string) => {
        setConfig(prev => ({ ...prev, customInstructions: value }))
    }, [])

    const handleToggleEnabled = useCallback(() => {
        setConfig(prev => ({ ...prev, enabled: !prev.enabled }))
    }, [])

    const handleResetToGlobal = useCallback(() => {
        setConfig({
            promptTemplateId: globalPromptTemplateId,
            customInstructions: globalAiInstructions,
            enabled: false,
        })
        toast.success(language === 'zh' ? '已重置为全局配置' : 'Reset to global config')
    }, [globalPromptTemplateId, globalAiInstructions, language])

    const handlePreview = useCallback(() => {
        setPreviewTemplateId(config.promptTemplateId)
        setShowPreview(true)
    }, [config.promptTemplateId])

    const handleSave = useCallback(async () => {
        setSaving(true)
        try {
            await saveScenePromptConfig(scenarioId, config)
            toast.success(language === 'zh' ? '场景 Prompt 配置已保存' : 'Scene prompt config saved')
            onSaved?.()
            onClose()
        } catch (err) {
            toast.error(
                language === 'zh' ? '保存失败' : 'Save failed',
                err instanceof Error ? err.message : String(err)
            )
        } finally {
            setSaving(false)
        }
    }, [scenarioId, config, language, onSaved, onClose])

    const selectedTemplate = getPromptTemplateById(config.promptTemplateId)
    const isUsingGlobal = !config.enabled

    return (
        <>
            <OverlayDialog
                isOpen={true}
                onClose={onClose}
                title={language === 'zh'
                    ? `配置 Prompt · ${scenarioName}`
                    : `Prompt Config · ${scenarioName}`}
                size="lg"
            >
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* 全局/场景切换说明 */}
                        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5">
                            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                            <div className="text-xs text-text-secondary leading-relaxed">
                                {language === 'zh'
                                    ? '默认使用全局 Prompt 配置。启用场景级配置后，此场景将使用独立的 Prompt 模板和自定义指令，不影响其他场景。'
                                    : 'Uses global prompt config by default. Enable scene-level config to use independent prompt template and custom instructions for this scene only.'}
                            </div>
                        </div>

                        {/* 当前状态徽章 */}
                        <div className="flex items-center gap-2">
                            <div className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                                isUsingGlobal
                                    ? 'bg-surface/50 text-text-muted border-border'
                                    : 'bg-accent/10 text-accent border-accent/30'
                            }`}>
                                {isUsingGlobal
                                    ? (language === 'zh' ? '全局配置' : 'Global Config')
                                    : (language === 'zh' ? '场景级配置' : 'Scene-level Config')}
                            </div>
                            {selectedTemplate && (
                                <div className="px-2.5 py-1 rounded-full text-[11px] bg-surface/50 text-text-secondary border border-border">
                                    {language === 'zh' ? selectedTemplate.nameZh : selectedTemplate.name}
                                </div>
                            )}
                        </div>

                        {/* 启用场景级配置 */}
                        <div className="flex items-center justify-between p-4 bg-surface/30 rounded-xl border border-border/50">
                            <div>
                                <div className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                                    {language === 'zh' ? '启用场景级配置' : 'Enable scene-level config'}
                                </div>
                                <div className="text-[11px] text-text-muted mt-0.5">
                                    {language === 'zh'
                                        ? '关闭后回退到全局配置'
                                        : 'Falls back to global config when disabled'}
                                </div>
                            </div>
                            <button
                                onClick={handleToggleEnabled}
                                role="switch"
                                aria-checked={config.enabled}
                                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                                    config.enabled ? 'bg-accent' : 'bg-surface-hover'
                                }`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                    config.enabled ? 'translate-x-5' : 'translate-x-0'
                                }`} />
                            </button>
                        </div>

                        {/* Prompt 模板选择 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5" />
                                    {language === 'zh' ? 'Prompt 模板' : 'Prompt Template'}
                                </label>
                                <button
                                    onClick={handlePreview}
                                    className="text-[11px] text-accent hover:text-accent-hover transition-colors flex items-center gap-1"
                                >
                                    <Eye className="w-3 h-3" />
                                    {language === 'zh' ? '预览' : 'Preview'}
                                </button>
                            </div>
                            <DropdownSelector
                                value={config.promptTemplateId}
                                onChange={handleTemplateChange}
                                options={templateOptions}
                                className="w-full bg-background/50 border-border/50 text-sm"
                            />
                            {selectedTemplate && (
                                <p className="text-[11px] text-text-muted leading-relaxed">
                                    {language === 'zh' ? selectedTemplate.descriptionZh : selectedTemplate.description}
                                </p>
                            )}
                        </div>

                        {/* 自定义指令 */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5" />
                                {language === 'zh' ? '自定义指令' : 'Custom Instructions'}
                            </label>
                            <textarea
                                value={config.customInstructions}
                                onChange={(e) => handleInstructionsChange(e.target.value)}
                                placeholder={language === 'zh'
                                    ? '为此场景添加特定的角色定位、行为约束或输出格式要求...'
                                    : 'Add scene-specific role, behavior constraints, or output format requirements...'}
                                className="w-full h-32 p-3 bg-background/50 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none text-xs font-mono resize-none text-text-secondary custom-scrollbar"
                            />
                            <p className="text-[11px] text-text-muted">
                                {language === 'zh'
                                    ? '此指令会叠加在所选 Prompt 模板之上，仅对当前场景生效。'
                                    : 'These instructions are added on top of the selected template, only for this scene.'}
                            </p>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center justify-between pt-3 border-t border-border/30">
                            <button
                                onClick={handleResetToGlobal}
                                className="text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5"
                            >
                                <RotateCcw className="w-3 h-3" />
                                {language === 'zh' ? '重置为全局' : 'Reset to global'}
                            </button>
                            <div className="flex items-center gap-2">
                                <ActionButton
                                    variant="ghost"
                                    size="sm"
                                    onClick={onClose}
                                    className="h-8 px-3 text-xs"
                                >
                                    {language === 'zh' ? '取消' : 'Cancel'}
                                </ActionButton>
                                <ActionButton
                                    variant="primary"
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="h-8 px-3 text-xs gap-1.5"
                                >
                                    <Save className="w-3 h-3" />
                                    {saving
                                        ? (language === 'zh' ? '保存中...' : 'Saving...')
                                        : (language === 'zh' ? '保存' : 'Save')}
                                </ActionButton>
                            </div>
                        </div>
                    </div>
                )}
            </OverlayDialog>

            {/* Prompt 预览弹窗 */}
            {showPreview && previewTemplateId && (
                <PromptPreviewDialog
                    templateId={previewTemplateId}
                    language={language}
                    onClose={() => {
                        setShowPreview(false)
                        setPreviewTemplateId(null)
                    }}
                />
            )}
        </>
    )
}
