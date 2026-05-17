/**
 * Skills 设置组件
 *
 * 管理工作区 Skills（基于 agentskills.io 标准）
 * 支持从 skills.sh 市场搜索安装、GitHub URL 安装、手动创建
 * 单列流式布局，卡片式展示已安装 Skills
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { skillService, type SkillItem, type SkillTriggerType, type SkillSource } from '@intelligence/runtime/skillRepository'
import { api } from '../../../adapters/electronBridge'
import { useStore } from '@store'
import { ActionButton, TextField, OverlayDialog } from '@components/ui'
import { BRAND } from '@shared/brand'
import {
    Zap, Plus, Trash2, RefreshCw, Download, Search,
    ToggleLeft, ToggleRight, ExternalLink, Github, FolderOpen,
    Sparkles, Globe, FileCode, Power, ChevronDown,
    MoreHorizontal, Pencil, Info
} from 'lucide-react'

interface SkillSettingsProps {
    language: string
}

const SKILL_ICONS = [Sparkles, Globe, FileCode, Zap, Power]

function getSkillIcon(name: string) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return SKILL_ICONS[Math.abs(hash) % SKILL_ICONS.length]
}

const SKILL_COLORS = [
    { bg: 'bg-blue-500/10', text: 'text-blue-400' },
    { bg: 'bg-purple-500/10', text: 'text-purple-400' },
    { bg: 'bg-green-500/10', text: 'text-green-400' },
    { bg: 'bg-amber-500/10', text: 'text-amber-400' },
    { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
    { bg: 'bg-rose-500/10', text: 'text-rose-400' },
]

function getSkillColor(name: string) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return SKILL_COLORS[Math.abs(hash) % SKILL_COLORS.length]
}

export function SkillRegistryPanel({ language }: SkillSettingsProps) {
    const t = (zh: string, en: string) => language === 'zh' ? zh : en
    const workspacePath = useStore(s => s.workspacePath)

    const [skills, setSkills] = useState<SkillItem[]>([])
    const [loading, setLoading] = useState(true)

    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<{ name: string; package: string; installs: number; url: string }[]>([])
    const [searching, setSearching] = useState(false)
    const [installing, setInstalling] = useState<string | null>(null)

    const [githubUrl, setGithubUrl] = useState('')
    const [githubInstalling, setGithubInstalling] = useState(false)

    const [newSkillName, setNewSkillName] = useState('')
    const [creating, setCreating] = useState(false)
    const [createLevel, setCreateLevel] = useState<SkillSource>('project')

    const [installMode, setInstallMode] = useState<'marketplace' | 'github' | 'create' | null>(null)
    const [installLevel, setInstallLevel] = useState<SkillSource>('project')

    const [installedMessage, setInstalledMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
    const [installMessage, setInstallMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const [filterSource, setFilterSource] = useState<'all' | 'global' | 'project'>('all')
    const [skillSearch, setSkillSearch] = useState('')
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
    const [activeMenu, setActiveMenu] = useState<string | null>(null)
    const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null)
    const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

    const [editingSkill, setEditingSkill] = useState<{ name: string; filePath: string; content: string; original: string } | null>(null)
    const [editSaving, setEditSaving] = useState(false)

    const showInstalledMessage = (type: 'success' | 'error', text: string) => {
        setInstalledMessage({ type, text })
        setTimeout(() => setInstalledMessage(null), 3000)
    }

    const showInstallMessage = (type: 'success' | 'error', text: string) => {
        setInstallMessage({ type, text })
        setTimeout(() => setInstallMessage(null), 5000)
    }

    const loadSkills = useCallback(async () => {
        setLoading(true)
        const items = await skillService.getAllSkills(true)
        setSkills(items)
        setLoading(false)
    }, [])

    useEffect(() => {
        loadSkills()
    }, [loadSkills])

    useEffect(() => {
        if (!activeMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest('[data-skill-menu]')) {
                setActiveMenu(null)
                setMenuPosition(null)
            }
        }
        const timer = setTimeout(() => {
            document.addEventListener('click', handleClickOutside)
        }, 0)
        return () => {
            clearTimeout(timer)
            document.removeEventListener('click', handleClickOutside)
        }
    }, [activeMenu])

    const handleSearch = async () => {
        if (!searchQuery.trim()) return
        setSearching(true)
        const results = await skillService.searchMarketplace(searchQuery)
        setSearchResults(results)
        setSearching(false)
    }

    const handleMarketplaceInstall = async (packageId: string) => {
        setInstalling(packageId)
        const result = await skillService.installFromMarketplace(packageId, installLevel)
        if (result.success) {
            showInstalledMessage('success', t('安装成功', 'Installed successfully'))
            showInstallMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setSearchResults([])
            setSearchQuery('')
        } else {
            showInstallMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setInstalling(null)
    }

    const handleGithubInstall = async () => {
        if (!githubUrl.trim()) return
        setGithubInstalling(true)
        const result = await skillService.installFromGitHub(githubUrl, installLevel)
        if (result.success) {
            showInstalledMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setGithubUrl('')
            setInstallMode(null)
        } else {
            showInstallMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setGithubInstalling(false)
    }

    const handleCreate = async () => {
        if (!newSkillName.trim()) return
        setCreating(true)
        const result = await skillService.createSkill(newSkillName.trim(), '', createLevel)
        if (result.success) {
            showInstalledMessage('success', t('创建成功', 'Created successfully'))
            loadSkills()
            setNewSkillName('')
            setInstallMode(null)
            if (result.filePath) {
                const content = await api.file.read(result.filePath)
                if (content !== null) {
                    useStore.getState().openFile(result.filePath, content)
                }
            }
        } else {
            showInstallMessage('error', result.error || t('创建失败', 'Create failed'))
        }
        setCreating(false)
    }

    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const handleDelete = async (name: string) => {
        if (deleteConfirm !== name) {
            setDeleteConfirm(name)
            return
        }
        setDeleteConfirm(null)
        setActiveMenu(null)
        const skill = skills.find(s => s.name === name)
        const success = await skillService.deleteSkill(name, skill?.source || 'project')
        if (success) {
            showInstalledMessage('success', t('已删除', 'Deleted'))
            loadSkills()
        }
    }

    const handleToggle = async (name: string, currentEnabled: boolean) => {
        await skillService.toggleSkill(name, !currentEnabled)
        loadSkills()
    }

    const handleTriggerTypeChange = async (name: string, type: SkillTriggerType) => {
        await skillService.updateSkillType(name, type)
        loadSkills()
    }

    const handleOpenEditor = async (skill: SkillItem) => {
        const content = await api.file.read(skill.filePath)
        if (content !== null) {
            setEditingSkill({ name: skill.name, filePath: skill.filePath, content, original: content })
        }
    }

    const handleSaveEdit = async () => {
        if (!editingSkill) return
        setEditSaving(true)
        const success = await api.file.write(editingSkill.filePath, editingSkill.content)
        if (success) {
            showInstalledMessage('success', t('保存成功', 'Saved successfully'))
            loadSkills()
            setEditingSkill(null)
        } else {
            showInstalledMessage('error', t('保存失败', 'Save failed'))
        }
        setEditSaving(false)
    }

    const filteredSkills = useMemo(() => {
        let result = skills
        if (filterSource !== 'all') {
            result = result.filter(s => s.source === filterSource)
        }
        if (skillSearch.trim()) {
            const query = skillSearch.toLowerCase()
            result = result.filter(s =>
                s.name.toLowerCase().includes(query) ||
                (s.description && s.description.toLowerCase().includes(query)) ||
                (s.keywords && s.keywords.some(kw => kw.toLowerCase().includes(query)))
            )
        }
        return result
    }, [skills, filterSource, skillSearch])

    const enabledCount = skills.filter(s => s.enabled).length
    const globalCount = skills.filter(s => s.source === 'global').length
    const projectCount = skills.filter(s => s.source === 'project').length

    return (
        <div className="space-y-4 animate-fade-in pb-10">
            {installedMessage && (
                <div className={`p-2.5 rounded-lg text-xs animate-fade-in ${installedMessage.type === 'success'
                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                    {installedMessage.text}
                </div>
            )}

            {/* 已安装技能 */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="relative">
                    {/* 标题栏 */}
                    <div className="flex items-center justify-between p-5 pb-3">
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                                <Zap className="w-4 h-4" />
                            </div>
                            <div>
                                <h5 className="text-sm font-semibold text-text-primary">{t('已安装技能', 'Installed Skills')}</h5>
                                <p className="text-[11px] text-text-muted mt-0.5">
                                    {enabledCount}/{skills.length} {t('已启用', 'enabled')}
                                    {skills.length > 0 && (
                                        <span className="ml-2">
                                            <span className="text-blue-400">{globalCount}</span> {t('全局', 'Global')}
                                            <span className="mx-1 text-border">·</span>
                                            <span className="text-green-400">{projectCount}</span> {t('工作区', 'Project')}
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={loadSkills}
                            className="p-1.5 text-text-muted hover:text-accent transition-colors rounded-md hover:bg-accent/10"
                            title={t('刷新', 'Refresh')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* 搜索和筛选栏 */}
                    <div className="px-5 pb-3 flex items-center gap-3">
                        <div className="flex-1 relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted/50" />
                            <input
                                type="text"
                                value={skillSearch}
                                onChange={(e) => setSkillSearch(e.target.value)}
                                placeholder={t('搜索技能名称、描述或关键词...', 'Search skills by name, description or keyword...')}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background/40 border border-border/40 rounded-lg text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all"
                            />
                            {skillSearch && (
                                <button
                                    onClick={() => setSkillSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted/50 hover:text-text-muted text-xs"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        <div className="flex items-center rounded-lg border border-border/50 bg-background/30 overflow-hidden">
                            {([['all', t('全部', 'All'), skills.length], ['global', t('全局', 'Global'), globalCount], ['project', t('工作区', 'Project'), projectCount]] as [string, string, number][]).map(([val, label, count]) => (
                                <button
                                    key={val}
                                    onClick={() => setFilterSource(val as 'all' | 'global' | 'project')}
                                    className={`text-[11px] px-2.5 py-1 transition-colors flex items-center gap-1 ${filterSource === val
                                        ? 'bg-accent/15 text-accent font-medium'
                                        : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                    }`}
                                >
                                    {label}
                                    <span className="text-[10px] opacity-60">{count}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 技能说明 */}
                    <div className="px-5 pb-3">
                        <p className="text-[11px] text-text-muted/70">
                            {t(
                                'Skills 是基于 agentskills.io 标准的指令包，让 AI 在特定领域拥有专业能力。',
                                'Skills are instruction packages based on the agentskills.io standard that give AI specialized capabilities.'
                            )}
                        </p>
                    </div>

                    {/* 技能列表 */}
                    <div className="px-5 pb-5">
                        {loading ? (
                            <div className="h-32 flex items-center justify-center text-text-muted">
                                <RefreshCw className="w-5 h-5 animate-spin" />
                            </div>
                        ) : !workspacePath ? (
                            <div className="h-32 flex flex-col items-center justify-center text-text-muted gap-2">
                                <FolderOpen className="w-8 h-8 opacity-40" />
                                <span className="text-xs">{t('请先打开一个工作区', 'Please open a workspace first')}</span>
                            </div>
                        ) : skills.length === 0 ? (
                            <div className="h-40 flex flex-col items-center justify-center text-text-muted border border-dashed border-border/50 rounded-xl gap-2">
                                <Zap className="w-10 h-10 opacity-30" />
                                <span className="text-xs">{t('暂无技能，点击下方安装技能添加', 'No skills yet. Click "Install Skill" below to add one.')}</span>
                            </div>
                        ) : filteredSkills.length === 0 ? (
                            <div className="h-24 flex items-center justify-center text-text-muted text-xs">
                                {skillSearch
                                    ? t('未找到匹配的技能', 'No skills match your search')
                                    : t('当前筛选条件下无技能', 'No skills match the current filter')}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredSkills.map((skill) => {
                                    const Icon = getSkillIcon(skill.name)
                                    const color = getSkillColor(skill.name)
                                    const isExpanded = expandedSkill === skill.name

                                    return (
                                        <div
                                            key={skill.name}
                                            className={`rounded-xl border transition-all duration-200 overflow-hidden ${skill.enabled
                                                ? 'bg-surface/40 border-border/60 hover:border-accent/30'
                                                : 'bg-surface/15 border-border/30 opacity-60 hover:opacity-80'
                                            }`}
                                        >
                                            {/* 主内容行 */}
                                            <div className="flex items-center gap-3 px-4 py-3">
                                                {/* 图标 */}
                                                <div className={`w-8 h-8 rounded-lg ${color.bg} flex items-center justify-center flex-shrink-0`}>
                                                    <Icon className={`w-4 h-4 ${color.text}`} />
                                                </div>

                                                {/* 名称和描述 */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-xs font-semibold text-text-primary">{skill.name}</span>
                                                        <span className={`text-[10px] px-1.5 py-px rounded ${skill.source === 'global'
                                                            ? 'bg-blue-500/15 text-blue-400'
                                                            : 'bg-green-500/15 text-green-400'
                                                        }`}>
                                                            {skill.source === 'global' ? t('全局', 'Global') : t('工作区', 'Project')}
                                                        </span>
                                                        <button
                                                            onClick={() => handleTriggerTypeChange(skill.name, skill.type === 'auto' ? 'manual' : 'auto')}
                                                            className={`text-[10px] px-1.5 py-px rounded cursor-pointer transition-colors ${skill.type === 'auto'
                                                                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                                                                : 'bg-surface-hover/60 text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                                            }`}
                                                            title={t('点击切换触发模式', 'Click to toggle trigger mode')}
                                                        >
                                                            {skill.type === 'auto' ? t('自动', 'Auto') : t('手动', 'Manual')}
                                                        </button>
                                                    </div>
                                                    {skill.description && (
                                                        <p className="text-[11px] text-text-muted mt-0.5 truncate">{skill.description}</p>
                                                    )}
                                                </div>

                                                {/* 关键词标签 */}
                                                {skill.keywords && skill.keywords.length > 0 && (
                                                    <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                                                        {skill.keywords.slice(0, 3).map(kw => (
                                                            <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-surface-hover/40 rounded text-text-muted/70">
                                                                {kw}
                                                            </span>
                                                        ))}
                                                        {skill.keywords.length > 3 && (
                                                            <span className="text-[10px] text-text-muted/50">+{skill.keywords.length - 3}</span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* 开关 */}
                                                <button
                                                    onClick={() => handleToggle(skill.name, skill.enabled)}
                                                    className={`flex-shrink-0 transition-colors ${skill.enabled ? 'text-accent' : 'text-text-muted/50'}`}
                                                    title={skill.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                                                >
                                                    {skill.enabled ? (
                                                        <ToggleRight className="w-6 h-6" />
                                                    ) : (
                                                        <ToggleLeft className="w-6 h-6" />
                                                    )}
                                                </button>

                                                {/* 更多操作 */}
                                                <div className="relative flex-shrink-0" data-skill-menu={skill.name}>
                                                    <button
                                                        ref={(el) => {
                                                            if (el) menuButtonRefs.current.set(skill.name, el)
                                                            else menuButtonRefs.current.delete(skill.name)
                                                        }}
                                                        onClick={() => {
                                                            if (activeMenu === skill.name) {
                                                                setActiveMenu(null)
                                                                setMenuPosition(null)
                                                            } else {
                                                                const btn = menuButtonRefs.current.get(skill.name)
                                                                if (btn) {
                                                                    const rect = btn.getBoundingClientRect()
                                                                    setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
                                                                }
                                                                setActiveMenu(skill.name)
                                                            }
                                                        }}
                                                        className="p-1 text-text-muted/50 hover:text-text-secondary hover:bg-surface-hover/50 rounded-md transition-colors"
                                                    >
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* 展开详情 */}
                                            {isExpanded && (
                                                <div className="px-4 pb-3 pt-0 animate-fade-in">
                                                    <div className="ml-11 p-3 rounded-lg bg-background/30 border border-border/30 space-y-2">
                                                        {skill.description && (
                                                            <div>
                                                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider">{t('描述', 'Description')}</span>
                                                                <p className="text-[11px] text-text-secondary mt-0.5">{skill.description}</p>
                                                            </div>
                                                        )}
                                                        {skill.keywords && skill.keywords.length > 0 && (
                                                            <div>
                                                                <span className="text-[10px] text-text-muted/60 uppercase tracking-wider">{t('关键词', 'Keywords')}</span>
                                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                                    {skill.keywords.map(kw => (
                                                                        <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-surface-hover/40 rounded text-text-muted">{kw}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <span className="text-[10px] text-text-muted/60 uppercase tracking-wider">{t('文件路径', 'File Path')}</span>
                                                            <p className="text-[11px] text-text-muted mt-0.5 font-mono truncate" title={skill.filePath}>
                                                                {skill.filePath}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 安装技能（可折叠） */}
            <section className="rounded-2xl border border-border/50 bg-surface/20 backdrop-blur-xl shadow-sm relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                <button
                    onClick={() => setInstallMode(installMode ? null : 'marketplace')}
                    className="w-full flex items-center justify-between p-5 cursor-pointer focus:outline-none relative z-10"
                >
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 bg-accent/10 rounded-md text-accent">
                            <Download className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                            <h5 className="text-sm font-semibold text-text-primary">{t('安装技能', 'Install Skill')}</h5>
                            <p className="text-[11px] text-text-muted mt-0.5">{t('从市场搜索、GitHub 克隆或手动创建', 'Search marketplace, clone from GitHub, or create manually')}</p>
                        </div>
                    </div>
                    <div className={`p-1.5 rounded-full bg-surface-hover transition-transform duration-300 ${installMode ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                    </div>
                </button>

                <div className={`grid transition-all duration-300 ease-in-out ${installMode ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                        <div className="px-5 pb-5 space-y-4 relative z-10">
                            {/* 安装方式 Tab */}
                            <div className="flex items-center border-b border-border/30">
                                {([
                                    ['marketplace', t('搜索市场', 'Marketplace'), Search],
                                    ['github', 'GitHub', Github],
                                    ['create', t('手动创建', 'Create'), Plus],
                                ] as [string, string, typeof Search][]).map(([key, label, TabIcon]) => (
                                    <button
                                        key={key}
                                        onClick={() => setInstallMode(key as 'marketplace' | 'github' | 'create')}
                                        className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${installMode === key
                                            ? 'border-accent text-accent'
                                            : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border/50'
                                        }`}
                                    >
                                        <TabIcon className="w-3.5 h-3.5" />
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* 安装位置选择 */}
                            {installMode && installMode !== 'create' && (
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-text-muted">{t('安装到：', 'Install to:')}</span>
                                    <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
                                        {([['project', t('工作区', 'Workspace')], ['global', t('全局', 'Global')]] as [SkillSource, string][]).map(([val, label]) => (
                                            <button
                                                key={val}
                                                onClick={() => setInstallLevel(val)}
                                                className={`text-[11px] px-2.5 py-0.5 transition-colors ${installLevel === val
                                                    ? 'bg-accent/15 text-accent font-medium'
                                                    : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {installMessage && (
                                <div className={`p-2.5 rounded-lg text-xs animate-fade-in ${installMessage.type === 'success'
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                                }`}>
                                    {installMessage.text}
                                </div>
                            )}

                            {/* 搜索市场 */}
                            {installMode === 'marketplace' && (
                                <div className="space-y-3 animate-fade-in">
                                    <div className="flex gap-2">
                                        <TextField
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder={t('搜索 skills.sh 市场...', 'Search skills.sh marketplace...')}
                                            className="flex-1 bg-background/50 border-border text-xs"
                                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                        />
                                        <ActionButton
                                            variant="secondary"
                                            onClick={handleSearch}
                                            disabled={searching || !searchQuery.trim()}
                                            className="px-3 shrink-0"
                                        >
                                            {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        </ActionButton>
                                    </div>

                                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                                        <ExternalLink className="w-3 h-3" />
                                        <a href="https://skills.sh" className="hover:text-accent transition-colors">
                                            {t('浏览 skills.sh 市场', 'Browse skills.sh marketplace')}
                                        </a>
                                    </div>

                                    {searchResults.length > 0 && (
                                        <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                            {searchResults.map((result) => (
                                                <div key={result.package} className="flex items-center justify-between p-3 rounded-lg bg-background/30 border border-border/50 hover:border-accent/30 transition-colors">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-xs font-medium text-text-primary">{result.name}</div>
                                                        <div className="text-[11px] text-text-muted">{result.package}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2 ml-3">
                                                        <span className="text-[10px] text-text-muted">{result.installs} {t('次安装', 'installs')}</span>
                                                        <ActionButton
                                                            variant="primary"
                                                            size="sm"
                                                            onClick={() => handleMarketplaceInstall(result.package)}
                                                            disabled={installing === result.package}
                                                            className="text-[11px] px-2.5 py-1"
                                                        >
                                                            {installing === result.package
                                                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                                                : t('安装', 'Install')
                                                            }
                                                        </ActionButton>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* GitHub 安装 */}
                            {installMode === 'github' && (
                                <div className="space-y-3 animate-fade-in">
                                    <div className="flex gap-2">
                                        <TextField
                                            value={githubUrl}
                                            onChange={(e) => setGithubUrl(e.target.value)}
                                            placeholder="https://github.com/user/skill-repo"
                                            className="flex-1 bg-background/50 border-border text-xs"
                                            onKeyDown={(e) => e.key === 'Enter' && handleGithubInstall()}
                                        />
                                        <ActionButton
                                            variant="primary"
                                            size="sm"
                                            onClick={handleGithubInstall}
                                            disabled={githubInstalling || !githubUrl.trim()}
                                            className="text-xs shrink-0"
                                        >
                                            {githubInstalling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('克隆安装', 'Clone')}
                                        </ActionButton>
                                    </div>
                                    <p className="text-[11px] text-text-muted">
                                        {t('输入包含 SKILL.md 的 GitHub 仓库地址', 'Enter a GitHub repo URL containing a SKILL.md file')}
                                    </p>
                                </div>
                            )}

                            {/* 手动创建 */}
                            {installMode === 'create' && (
                                <div className="space-y-3 animate-fade-in">
                                    <div className="flex gap-2">
                                        <TextField
                                            value={newSkillName}
                                            onChange={(e) => setNewSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                            placeholder={t('skill-name（小写字母和连字符）', 'skill-name (lowercase and hyphens)')}
                                            className="flex-1 bg-background/50 border-border text-xs"
                                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                        />
                                        <ActionButton
                                            variant="primary"
                                            size="sm"
                                            onClick={handleCreate}
                                            disabled={creating || !newSkillName.trim()}
                                            className="text-xs shrink-0"
                                        >
                                            {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('创建', 'Create')}
                                        </ActionButton>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-text-muted">{t('保存到：', 'Save to:')}</span>
                                            <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
                                                {([['project', t('工作区', 'Workspace')], ['global', t('全局', 'Global')]] as [SkillSource, string][]).map(([val, label]) => (
                                                    <button
                                                        key={val}
                                                        onClick={() => setCreateLevel(val)}
                                                        className={`text-[11px] px-2.5 py-0.5 transition-colors ${createLevel === val
                                                            ? 'bg-accent/15 text-accent font-medium'
                                                            : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <span className="text-[11px] text-text-muted/50">
                                            {t(
                                                `将创建 ${BRAND.dirName}/skills/ 目录和模板`,
                                                `Creates ${BRAND.dirName}/skills/ directory and template`
                                            )}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* 使用提示 */}
            <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 text-xs text-text-muted">
                <p className="font-medium text-accent/80 mb-2">{t('使用提示', 'Tips')}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex items-start gap-2">
                        <Zap className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-text-secondary font-medium">{t('自动模式', 'Auto Mode')}</span>
                            <p className="text-[11px] text-text-muted/70 mt-0.5">{t('AI 判断相关时自动加载', 'AI loads on-demand when relevant')}</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Search className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-text-secondary font-medium">{t('手动模式', 'Manual Mode')}</span>
                            <p className="text-[11px] text-text-muted/70 mt-0.5">{t('聊天中 @skill-name 引用', 'Use @skill-name in chat')}</p>
                        </div>
                    </div>
                    <div className="flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 text-accent/60 mt-0.5 flex-shrink-0" />
                        <div>
                            <span className="text-text-secondary font-medium">{t('优先级', 'Priority')}</span>
                            <p className="text-[11px] text-text-muted/70 mt-0.5">{t('工作区覆盖同名全局技能', 'Workspace overrides global')}</p>
                        </div>
                    </div>
                </div>
            </div>

            {activeMenu && menuPosition && (() => {
                const skill = skills.find(s => s.name === activeMenu)
                if (!skill) return null
                const isExpanded = expandedSkill === skill.name
                return (
                    <div
                        style={{ position: 'fixed', top: menuPosition.top, right: menuPosition.right, zIndex: 9999 }}
                        className="w-36 bg-surface border border-border/60 rounded-lg shadow-xl py-1 animate-fade-in"
                        data-skill-menu={skill.name}
                    >
                        <button
                            onClick={() => {
                                setActiveMenu(null)
                                setMenuPosition(null)
                                handleOpenEditor(skill)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                            {t('编辑', 'Edit')}
                        </button>
                        <button
                            onClick={() => {
                                setActiveMenu(null)
                                setMenuPosition(null)
                                setExpandedSkill(isExpanded ? null : skill.name)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-accent/10 hover:text-accent transition-colors"
                        >
                            <Info className="w-3.5 h-3.5" />
                            {t('详情', 'Details')}
                        </button>
                        <div className="border-t border-border/30 my-1"></div>
                        <button
                            onClick={() => {
                                if (deleteConfirm === skill.name) {
                                    handleDelete(skill.name)
                                    setMenuPosition(null)
                                } else {
                                    setDeleteConfirm(skill.name)
                                    setTimeout(() => setDeleteConfirm(null), 3000)
                                }
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${deleteConfirm === skill.name
                                ? 'text-red-400 bg-red-500/10 font-medium'
                                : 'text-red-400/70 hover:bg-red-500/10 hover:text-red-400'
                            }`}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            {deleteConfirm === skill.name ? t('确认删除', 'Confirm') : t('删除', 'Delete')}
                        </button>
                    </div>
                )
            })()}

            <OverlayDialog
                isOpen={!!editingSkill}
                onClose={() => setEditingSkill(null)}
                title={editingSkill ? `${t('编辑技能', 'Edit Skill')} - ${editingSkill.name}` : ''}
                size="3xl"
                showCloseButton={true}
            >
                {editingSkill && (
                    <div className="flex flex-col h-[60vh]">
                        <textarea
                            value={editingSkill.content}
                            onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                            className="flex-1 w-full p-4 bg-background/50 border border-border/40 rounded-xl text-xs font-mono text-text-primary resize-none focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 custom-scrollbar leading-relaxed"
                            spellCheck={false}
                        />
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                            <span className="text-[11px] text-text-muted/60 font-mono truncate max-w-[60%]" title={editingSkill.filePath}>
                                {editingSkill.filePath}
                            </span>
                            <div className="flex items-center gap-2">
                                <ActionButton
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingSkill(null)}
                                    className="text-xs"
                                >
                                    {t('取消', 'Cancel')}
                                </ActionButton>
                                <ActionButton
                                    variant="primary"
                                    size="sm"
                                    onClick={handleSaveEdit}
                                    disabled={editSaving || editingSkill.content === editingSkill.original}
                                    className="text-xs min-w-[80px]"
                                >
                                    {editSaving
                                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        : t('保存', 'Save')
                                    }
                                </ActionButton>
                            </div>
                        </div>
                    </div>
                )}
            </OverlayDialog>
        </div>
    )
}
