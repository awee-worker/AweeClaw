/**
 * Skills 设置组件
 *
 * 管理工作区 Skills（基于 agentskills.io 标准）
 * 支持从 skills.sh 市场搜索安装、GitHub URL 安装、手动创建
 * 卡片式布局展示已安装 Skills
 */

import { useState, useEffect, useCallback } from 'react'
import { skillService, type SkillItem, type SkillTriggerType, type SkillSource } from '@intelligence/runtime/skillRepository'
import { api } from '../../../adapters/electronBridge'
import { useStore } from '@store'
import { ActionButton, TextField } from '@components/ui'
import { BRAND } from '@shared/brand'
import {
    Zap, Plus, Trash2, RefreshCw, Download, Search,
    ToggleLeft, ToggleRight, ExternalLink, Github, FolderOpen,
    Sparkles, Globe, FileCode, Power, ChevronDown, ChevronUp
} from 'lucide-react'

interface SkillSettingsProps {
    language: string
}

const SKILL_ICONS = [
    Sparkles, Globe, FileCode, Zap, Power
]

function getSkillIcon(name: string) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return SKILL_ICONS[Math.abs(hash) % SKILL_ICONS.length]
}

const SKILL_COLORS = [
    { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
    { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20' },
    { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
    { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
    { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
    { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
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
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

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

    const filteredSkills = skills.filter(s => {
        if (filterSource === 'all') return true
        return s.source === filterSource
    })

    const enabledCount = skills.filter(s => s.enabled).length
    const globalCount = skills.filter(s => s.source === 'global').length
    const projectCount = skills.filter(s => s.source === 'project').length

    return (
        <div className="space-y-5 animate-fade-in pb-10">
            {/* Stats Bar */}
            <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-surface/30 rounded-xl border border-border text-center">
                    <div className="text-lg font-bold text-accent">{skills.length}</div>
                    <div className="text-[11px] text-text-muted">{t('总技能', 'Total')}</div>
                </div>
                <div className="p-3 bg-surface/30 rounded-xl border border-border text-center">
                    <div className="text-lg font-bold text-green-400">{enabledCount}</div>
                    <div className="text-[11px] text-text-muted">{t('已启用', 'Enabled')}</div>
                </div>
                <div className="p-3 bg-surface/30 rounded-xl border border-border text-center">
                    <div className="text-lg font-bold text-text-secondary">{skills.length - enabledCount}</div>
                    <div className="text-[11px] text-text-muted">{t('已禁用', 'Disabled')}</div>
                </div>
            </div>

            {/* Header with filter */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-medium text-text-primary">
                            {t('已安装技能', 'Installed Skills')}
                        </h5>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-border overflow-hidden">
                            {([['all', t('全部', 'All')], ['global', t('全局', 'Global')], ['project', t('工作区', 'Project')]] as [string, string][]).map(([val, label]) => (
                                <button
                                    key={val}
                                    onClick={() => setFilterSource(val as 'all' | 'global' | 'project')}
                                    className={`text-[11px] px-2.5 py-1 transition-colors ${filterSource === val
                                        ? 'bg-accent/20 text-accent font-medium'
                                        : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                    }`}
                                >
                                    {label}
                                    {val === 'all' ? ` (${skills.length})` : val === 'global' ? ` (${globalCount})` : ` (${projectCount})`}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={loadSkills}
                            className="p-1.5 text-text-muted hover:text-accent transition-colors"
                            title={t('刷新', 'Refresh')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                <p className="text-xs text-text-muted">
                    {t(
                        'Skills 是基于 agentskills.io 标准的指令包，让 AI 在特定领域拥有专业能力。支持全局和工作区两级存储。',
                        'Skills are instruction packages based on the agentskills.io standard. Supports global and project-level storage.'
                    )}
                </p>

                {installedMessage && (
                    <div className={`p-2.5 rounded-lg text-xs ${installedMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                        {installedMessage.text}
                    </div>
                )}

                {/* Skill Cards Grid */}
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
                    <div className="h-40 flex flex-col items-center justify-center text-text-muted border border-dashed border-border rounded-xl gap-2">
                        <Zap className="w-10 h-10 opacity-30" />
                        <span className="text-xs">{t('暂无技能，点击下方按钮安装或创建', 'No skills yet. Use the buttons below to install or create one.')}</span>
                    </div>
                ) : filteredSkills.length === 0 ? (
                    <div className="h-24 flex items-center justify-center text-text-muted text-xs">
                        {t('当前筛选条件下无技能', 'No skills match the current filter')}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {filteredSkills.map((skill) => {
                            const Icon = getSkillIcon(skill.name)
                            const color = getSkillColor(skill.name)
                            const isExpanded = expandedSkill === skill.name

                            return (
                                <div
                                    key={skill.name}
                                    className={`group relative rounded-xl border transition-all duration-200 overflow-hidden ${skill.enabled
                                        ? 'bg-surface/40 border-border hover:border-accent/40'
                                        : 'bg-surface/20 border-border/40 opacity-50'
                                    }`}
                                >
                                    {/* Card Header */}
                                    <div className="p-3.5">
                                        <div className="flex items-start gap-3">
                                            {/* Icon */}
                                            <div className={`w-9 h-9 rounded-lg ${color.bg} flex items-center justify-center flex-shrink-0`}>
                                                <Icon className={`w-4 h-4 ${color.text}`} />
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-semibold text-text-primary truncate">{skill.name}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${skill.source === 'global'
                                                        ? 'bg-blue-500/15 text-blue-400'
                                                        : 'bg-green-500/15 text-green-400'
                                                    }`}>
                                                        {skill.source === 'global' ? t('全局', 'Global') : t('工作区', 'Project')}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed">{skill.description}</p>
                                            </div>

                                            {/* Toggle */}
                                            <button
                                                onClick={() => handleToggle(skill.name, skill.enabled)}
                                                className={`p-0.5 flex-shrink-0 transition-colors ${skill.enabled ? 'text-accent' : 'text-text-muted'}`}
                                                title={skill.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                                            >
                                                {skill.enabled ? (
                                                    <ToggleRight className="w-5 h-5" />
                                                ) : (
                                                    <ToggleLeft className="w-5 h-5" />
                                                )}
                                            </button>
                                        </div>

                                        {/* Tags Row */}
                                        <div className="flex items-center gap-2 mt-2.5">
                                            <div className="flex items-center rounded-md border border-border overflow-hidden">
                                                {([['auto', t('自动', 'Auto')], ['manual', t('手动', 'Manual')]] as [SkillTriggerType, string][]).map(([val, label]) => (
                                                    <button
                                                        key={val}
                                                        onClick={async () => {
                                                            await skillService.updateSkillType(skill.name, val)
                                                            loadSkills()
                                                        }}
                                                        className={`text-[10px] px-2 py-0.5 transition-colors ${skill.type === val
                                                            ? 'bg-accent/20 text-accent font-medium'
                                                            : 'bg-black/20 text-text-muted hover:bg-black/30 hover:text-text-secondary'
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                            {skill.keywords && skill.keywords.length > 0 && (
                                                <div className="flex items-center gap-1 overflow-hidden">
                                                    {skill.keywords.slice(0, 2).map(kw => (
                                                        <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-surface-hover rounded text-text-muted truncate max-w-[80px]">
                                                            {kw}
                                                        </span>
                                                    ))}
                                                    {skill.keywords.length > 2 && (
                                                        <span className="text-[10px] text-text-muted">+{skill.keywords.length - 2}</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expandable Actions Bar */}
                                    <div className={`border-t border-border/50 transition-all duration-200 ${isExpanded ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                                        <div className="flex items-center justify-between px-3.5 py-2">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={async () => {
                                                        const content = await api.file.read(skill.filePath)
                                                        if (content !== null) {
                                                            useStore.getState().openFile(skill.filePath, content)
                                                        }
                                                    }}
                                                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted hover:text-accent hover:bg-accent/10 rounded-md transition-colors"
                                                >
                                                    <FolderOpen className="w-3 h-3" />
                                                    {t('编辑', 'Edit')}
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(skill.name)}
                                                    onBlur={() => deleteConfirm === skill.name && setDeleteConfirm(null)}
                                                    className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors ${deleteConfirm === skill.name
                                                        ? 'text-red-400 bg-red-500/20'
                                                        : 'text-text-muted hover:text-red-400 hover:bg-red-500/10'
                                                    }`}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    {deleteConfirm === skill.name ? t('确认删除', 'Confirm') : t('删除', 'Delete')}
                                                </button>
                                            </div>
                                            <span className="text-[10px] text-text-muted/50 truncate max-w-[140px]" title={skill.filePath}>
                                                {skill.filePath.split('/').slice(-2).join('/')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Expand Toggle */}
                                    <button
                                        onClick={() => setExpandedSkill(isExpanded ? null : skill.name)}
                                        className="w-full flex items-center justify-center py-1 text-text-muted/40 hover:text-text-muted hover:bg-surface-hover/50 transition-colors"
                                    >
                                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            {/* Install Section */}
            <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-medium text-text-primary">
                        {t('安装技能', 'Install Skill')}
                    </h5>
                </div>

                <div className="flex gap-2">
                    <ActionButton
                        variant={installMode === 'marketplace' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'marketplace' ? null : 'marketplace')}
                        className="text-xs"
                    >
                        <Search className="w-3.5 h-3.5 mr-1.5" />
                        {t('搜索市场', 'Search Market')}
                    </ActionButton>
                    <ActionButton
                        variant={installMode === 'github' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'github' ? null : 'github')}
                        className="text-xs"
                    >
                        <Github className="w-3.5 h-3.5 mr-1.5" />
                        GitHub
                    </ActionButton>
                    <ActionButton
                        variant={installMode === 'create' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'create' ? null : 'create')}
                        className="text-xs"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        {t('手动创建', 'Create New')}
                    </ActionButton>
                </div>

                {installMode && installMode !== 'create' && (
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] text-text-muted">{t('安装到：', 'Install to:')}</span>
                        <div className="flex items-center rounded-md border border-border overflow-hidden">
                            {([['project', t('工作区', 'Workspace')], ['global', t('全局', 'Global')]] as [SkillSource, string][]).map(([val, label]) => (
                                <button
                                    key={val}
                                    onClick={() => setInstallLevel(val)}
                                    className={`text-[11px] px-2.5 py-0.5 transition-colors ${installLevel === val
                                        ? 'bg-accent/20 text-accent font-medium'
                                        : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {installMessage && (
                    <div className={`p-2.5 rounded-lg text-xs ${installMessage.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}>
                        {installMessage.text}
                    </div>
                )}

                {installMode === 'marketplace' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <TextField
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('搜索 skills.sh 市场...', 'Search skills.sh marketplace...')}
                                className="flex-1 bg-surface border-border text-xs"
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

                        <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                            <ExternalLink className="w-3 h-3" />
                            <a href="https://skills.sh" className="hover:text-accent transition-colors">
                                {t('浏览 skills.sh 市场', 'Browse skills.sh marketplace')}
                            </a>
                        </div>

                        {searchResults.length > 0 && (
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                {searchResults.map((result) => (
                                    <div key={result.package} className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium text-text-primary">{result.name}</div>
                                            <div className="text-[11px] text-text-muted">{result.package}</div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-2">
                                            <span className="text-[10px] text-text-muted">{result.installs} {t('次安装', 'installs')}</span>
                                            <ActionButton
                                                variant="primary"
                                                size="sm"
                                                onClick={() => handleMarketplaceInstall(result.package)}
                                                disabled={installing === result.package}
                                                className="text-[11px] px-2 py-1"
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

                {installMode === 'github' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <TextField
                                value={githubUrl}
                                onChange={(e) => setGithubUrl(e.target.value)}
                                placeholder="https://github.com/user/skill-repo"
                                className="flex-1 bg-surface border-border text-xs"
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
                        <p className="text-[12px] text-text-muted">
                            {t('输入包含 SKILL.md 的 GitHub 仓库地址', 'Enter a GitHub repo URL containing a SKILL.md file')}
                        </p>
                    </div>
                )}

                {installMode === 'create' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <TextField
                                value={newSkillName}
                                onChange={(e) => setNewSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                placeholder={t('skill-name（小写字母和连字符）', 'skill-name (lowercase and hyphens)')}
                                className="flex-1 bg-surface border-border text-xs"
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
                        <div className="flex items-center gap-2">
                            <span className="text-[12px] text-text-muted">{t('保存到：', 'Save to:')}</span>
                            <div className="flex items-center rounded-md border border-border overflow-hidden">
                                {([['project', t('工作区', 'Workspace')], ['global', t('全局', 'Global')]] as [SkillSource, string][]).map(([val, label]) => (
                                    <button
                                        key={val}
                                        onClick={() => setCreateLevel(val)}
                                        className={`text-[11px] px-2.5 py-0.5 transition-colors ${createLevel === val
                                            ? 'bg-accent/20 text-accent font-medium'
                                            : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <p className="text-[12px] text-text-muted">
                            {t(
                                `将在 ${BRAND.dirName}/skills/ 下创建目录和 SKILL.md 模板`,
                                `Creates a directory and SKILL.md template under ${BRAND.dirName}/skills/`
                            )}
                        </p>
                    </div>
                )}
            </section>

            {/* Tips */}
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-text-muted space-y-1">
                <p className="font-medium text-accent/80">{t('💡 使用提示', '💡 Tips')}</p>
                <ul className="list-disc list-inside space-y-0.5 text-[12px]">
                    <li>{t('自动模式：Skill 名称和描述对 AI 可见，AI 判断相关时自动加载完整内容（零额外延迟）', 'Auto mode: Skill name & description visible to AI, full content loaded on-demand when relevant (zero extra latency)')}</li>
                    <li>{t('手动模式：需要在聊天中 @skill-name 引用才生效', 'Manual mode: Requires @skill-name mention in chat to activate')}</li>
                    <li>{t('工作区 Skill 会覆盖同名的全局 Skill', 'Workspace skills override global skills with the same name')}</li>
                </ul>
            </div>
        </div>
    )
}
