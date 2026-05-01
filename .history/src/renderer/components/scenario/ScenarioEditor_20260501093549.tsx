import { useState, useCallback } from 'react'
import {
    X, Check, Sparkles, Code2, BarChart3, PenTool, Settings,
    Layout, Plus, Trash2, GripVertical, ChevronDown
} from 'lucide-react'
import { useStore } from '@store'
import { Button } from '../ui'
import type { ScenarioPlugin, UILayout, SidebarItemDescriptor, ScenarioCategory } from '@shared/types/scenario'
import type { LucideIcon } from 'lucide-react'

const ICON_OPTIONS: { value: string; Icon: LucideIcon }[] = [
    { value: 'Sparkles', Icon: Sparkles },
    { value: 'Code2', Icon: Code2 },
    { value: 'BarChart3', Icon: BarChart3 },
    { value: 'PenTool', Icon: PenTool },
    { value: 'Settings', Icon: Settings },
]

const LAYOUT_OPTIONS: { value: UILayout; label: { en: string; zh: string }; desc: { en: string; zh: string } }[] = [
    { value: 'chat-centric', label: { en: 'Chat Centric', zh: '对话为主' }, desc: { en: 'Chat panel as the main area', zh: '对话面板为主要区域' } },
    { value: 'editor-centric', label: { en: 'Editor Centric', zh: '编辑器为主' }, desc: { en: 'Code editor as the main area', zh: '代码编辑器为主要区域' } },
    { value: 'dashboard-centric', label: { en: 'Dashboard Centric', zh: '仪表盘为主' }, desc: { en: 'Dashboard with data widgets', zh: '带数据小部件的仪表盘' } },
    { value: 'canvas-centric', label: { en: 'Canvas Centric', zh: '画布为主' }, desc: { en: 'Freeform canvas workspace', zh: '自由画布工作区' } },
    { value: 'fullscreen-chat', label: { en: 'Fullscreen Chat', zh: '全屏对话' }, desc: { en: 'Immersive chat experience', zh: '沉浸式对话体验' } },
    { value: 'minimal', label: { en: 'Minimal', zh: '极简' }, desc: { en: 'Minimal UI, maximum focus', zh: '极简界面，最大专注' } },
]

const CATEGORY_OPTIONS: { value: ScenarioCategory; label: { en: string; zh: string } }[] = [
    { value: 'productivity', label: { en: 'Productivity', zh: '效率' } },
    { value: 'development', label: { en: 'Development', zh: '开发' } },
    { value: 'data', label: { en: 'Data', zh: '数据' } },
    { value: 'creative', label: { en: 'Creative', zh: '创意' } },
    { value: 'education', label: { en: 'Education', zh: '教育' } },
    { value: 'automation', label: { en: 'Automation', zh: '自动化' } },
    { value: 'custom', label: { en: 'Custom', zh: '自定义' } },
]

const SIDEBAR_COMPONENT_OPTIONS = [
    { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView' },
    { id: 'search', icon: 'Search', label: 'Search', labelZh: '搜索', component: 'SearchView' },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView' },
    { id: 'outline', icon: 'ListTree', label: 'Outline', labelZh: '大纲', component: 'OutlineView' },
    { id: 'git', icon: 'GitBranch', label: 'Git', labelZh: 'Git', component: 'GitView' },
    { id: 'problems', icon: 'AlertCircle', label: 'Problems', labelZh: '问题', component: 'ProblemsView' },
    { id: 'data-sources', icon: 'Database', label: 'Data Sources', labelZh: '数据源', component: 'DataSourceView' },
    { id: 'charts', icon: 'BarChart3', label: 'Charts', labelZh: '图表', component: 'ChartsView' },
    { id: 'characters', icon: 'Users', label: 'Characters', labelZh: '角色', component: 'CharactersView' },
    { id: 'shell', icon: 'Terminal', label: 'Shell', labelZh: 'Shell', component: 'ShellView' },
]

interface ScenarioEditorProps {
    scenario: ScenarioPlugin | null
    isNew: boolean
    onSave: (scenario: ScenarioPlugin) => void
    onCancel: () => void
}

export function ScenarioEditor({ scenario, isNew, onSave, onCancel }: ScenarioEditorProps) {
    const language = useStore(s => s.language)

    const [name, setName] = useState(scenario?.name || '')
    const [nameZh, setNameZh] = useState(scenario?.nameZh || '')
    const [description, setDescription] = useState(scenario?.description || '')
    const [descriptionZh, setDescriptionZh] = useState(scenario?.descriptionZh || '')
    const [icon, setIcon] = useState(scenario?.icon || 'Sparkles')
    const [category, setCategory] = useState<ScenarioCategory>(scenario?.category || 'custom')
    const [layout, setLayout] = useState<UILayout>(scenario?.ui.layout || 'chat-centric')
    const [sidebarItems, setSidebarItems] = useState<SidebarItemDescriptor[]>(
        scenario?.ui?.sidebarItems || [
            { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
            { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 1 },
        ]
    )
    const [showSidebarPicker, setShowSidebarPicker] = useState(false)

    const handleAddSidebarItem = useCallback((item: typeof SIDEBAR_COMPONENT_OPTIONS[0]) => {
        if (sidebarItems.some(s => s.id === item.id)) return
        setSidebarItems(prev => [...prev, {
            id: item.id,
            icon: item.icon,
            label: item.label,
            labelZh: item.labelZh,
            component: item.component,
            position: prev.length,
        }])
        setShowSidebarPicker(false)
    }, [sidebarItems])

    const handleRemoveSidebarItem = useCallback((id: string) => {
        setSidebarItems(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, position: i })))
    }, [])

    const handleSave = useCallback(() => {
        if (!name.trim()) return

        const existingScenario = scenario || {
            id: `custom-${Date.now()}`,
            version: '1.0.0',
            author: 'user',
            tags: [] as string[],
            requiresWorkspace: false,
            identity: {
                systemPrompt: `You are an AI assistant for the ${name.trim()} scenario. Help users accomplish their tasks effectively.`,
                securityRules: '## Security Rules\n- Follow general safety guidelines',
                conventions: '## Conventions\n- Be helpful and accurate',
                workflow: '## Workflow\n1. Understand the task\n2. Plan the approach\n3. Execute\n4. Verify',
            },
            capabilities: {
                toolPacks: ['code'],
                modes: [
                    { id: 'chat', label: 'Chat', labelZh: '对话', icon: 'MessageSquare', description: 'Quick conversation', descriptionZh: '快速对话', toolPolicy: { enabled: false } },
                    { id: 'agent', label: 'Agent', labelZh: '智能体', icon: 'Sparkles', description: 'Autonomous with tools', descriptionZh: '自主工具调用', toolPolicy: { enabled: true, requireApproval: false } },
                ],
                contextTypes: [
                    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
                ],
                outputFormats: ['markdown', 'text'],
            },
            dataSources: { workspace: false },
        }

        const updated: ScenarioPlugin = {
            ...existingScenario,
            name: name.trim(),
            nameZh: nameZh.trim() || name.trim(),
            description: description.trim(),
            descriptionZh: descriptionZh.trim() || description.trim(),
            icon,
            category,
            ui: {
                ...(existingScenario as ScenarioPlugin).ui,
                layout,
                sidebarItems: sidebarItems.map((s, i) => ({ ...s, position: i })),
                panels: (existingScenario as ScenarioPlugin).ui?.panels || [],
                statusBarItems: (existingScenario as ScenarioPlugin).ui?.statusBarItems || [],
            },
        }

        onSave(updated)
    }, [scenario, name, nameZh, description, descriptionZh, icon, category, layout, sidebarItems, onSave])

    const availableSidebarItems = SIDEBAR_COMPONENT_OPTIONS.filter(opt => !sidebarItems.some(s => s.id === opt.id))

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    {isNew ? (language === 'zh' ? '新建场景' : 'New Scenario') : (language === 'zh' ? '编辑场景' : 'Edit Scenario')}
                </span>
                <button onClick={onCancel} className="text-text-muted hover:text-text-primary">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                        {language === 'zh' ? '名称' : 'Name'}
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder={language === 'zh' ? '英文名称' : 'Name'}
                            className="flex-1 h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/50"
                        />
                        <input
                            type="text"
                            value={nameZh}
                            onChange={e => setNameZh(e.target.value)}
                            placeholder="中文名称"
                            className="flex-1 h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/50"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                        {language === 'zh' ? '描述' : 'Description'}
                    </label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder={language === 'zh' ? '英文描述' : 'Description'}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/50 resize-none"
                    />
                    <textarea
                        value={descriptionZh}
                        onChange={e => setDescriptionZh(e.target.value)}
                        placeholder="中文描述"
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/50 resize-none"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                        {language === 'zh' ? '图标' : 'Icon'}
                    </label>
                    <div className="flex gap-1.5">
                        {ICON_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setIcon(opt.value)}
                                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${icon === opt.value ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-surface/50 text-text-muted hover:text-text-primary hover:bg-surface-hover border border-transparent'}`}
                            >
                                <opt.Icon className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                        {language === 'zh' ? '类别' : 'Category'}
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {CATEGORY_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setCategory(opt.value)}
                                className={`text-[10px] px-2 py-1 rounded-md transition-all ${category === opt.value ? 'bg-accent/15 text-accent border border-accent/30' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover border border-transparent'}`}
                            >
                                {language === 'zh' ? opt.label.zh : opt.label.en}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                        <Layout className="w-3 h-3" />
                        {language === 'zh' ? '布局' : 'Layout'}
                    </label>
                    <div className="space-y-1.5">
                        {LAYOUT_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setLayout(opt.value)}
                                className={`w-full text-left px-3 py-2 rounded-lg transition-all border ${layout === opt.value ? 'bg-accent/10 border-accent/30' : 'border-border/30 hover:bg-surface-hover'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${layout === opt.value ? 'bg-accent' : 'bg-text-muted/30'}`} />
                                    <span className={`text-xs font-medium ${layout === opt.value ? 'text-accent' : 'text-text-primary'}`}>
                                        {language === 'zh' ? opt.label.zh : opt.label.en}
                                    </span>
                                </div>
                                <p className="text-[10px] text-text-muted mt-0.5 ml-4">
                                    {language === 'zh' ? opt.desc.zh : opt.desc.en}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '侧边栏项目' : 'Sidebar Items'}
                        </label>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 text-[10px] gap-0.5 px-1.5"
                            onClick={() => setShowSidebarPicker(!showSidebarPicker)}
                        >
                            <Plus className="w-2.5 h-2.5" />
                            {language === 'zh' ? '添加' : 'Add'}
                        </Button>
                    </div>

                    {showSidebarPicker && availableSidebarItems.length > 0 && (
                        <div className="border border-border/30 rounded-lg p-1.5 bg-surface/30 space-y-0.5">
                            {availableSidebarItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => handleAddSidebarItem(item)}
                                    className="w-full text-left px-2 py-1.5 text-[11px] text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded transition-colors"
                                >
                                    + {language === 'zh' ? item.labelZh : item.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="space-y-1">
                        {sidebarItems.map((item, index) => (
                            <div key={item.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-surface/30 border border-border/20">
                                <GripVertical className="w-3 h-3 text-text-muted/30 flex-shrink-0" />
                                <span className="text-[11px] text-text-primary flex-1 truncate">
                                    {language === 'zh' ? item.labelZh : item.label}
                                </span>
                                <span className="text-[9px] text-text-muted/50">{item.id}</span>
                                <button
                                    onClick={() => handleRemoveSidebarItem(item.id)}
                                    className="p-0.5 text-text-muted/50 hover:text-red-400 transition-colors"
                                >
                                    <Trash2 className="w-2.5 h-2.5" />
                                </button>
                            </div>
                        ))}
                        {sidebarItems.length === 0 && (
                            <p className="text-[10px] text-text-muted/50 text-center py-2">
                                {language === 'zh' ? '暂无侧边栏项目' : 'No sidebar items'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="px-3 py-2 border-t border-border/30 flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={onCancel}>
                    {language === 'zh' ? '取消' : 'Cancel'}
                </Button>
                <Button variant="secondary" size="sm" className="h-7 flex-1 text-xs gap-1" onClick={handleSave} disabled={!name.trim()}>
                    <Check className="w-3 h-3" />
                    {language === 'zh' ? '保存' : 'Save'}
                </Button>
            </div>
        </div>
    )
}
