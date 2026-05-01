import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Search, Star, Copy, MessageSquare,
    Zap, ChevronDown, Edit3, Check, X, Tag,
} from 'lucide-react'
import { useStore } from '@store'

interface PromptTemplate {
    id: string
    title: string
    content: string
    category: string
    starred: boolean
    variables: string[]
    createdAt: number
}

const PROMPT_CATEGORIES = [
    { id: 'writing', label: 'Writing', labelZh: '写作', color: 'text-pink-400' },
    { id: 'coding', label: 'Coding', labelZh: '编程', color: 'text-green-400' },
    { id: 'analysis', label: 'Analysis', labelZh: '分析', color: 'text-blue-400' },
    { id: 'creative', label: 'Creative', labelZh: '创意', color: 'text-purple-400' },
    { id: 'business', label: 'Business', labelZh: '商务', color: 'text-amber-400' },
    { id: 'education', label: 'Education', labelZh: '教育', color: 'text-cyan-400' },
]

export function PromptsView() {
    const language = useStore(s => s.language)
    const [prompts, setPrompts] = useState<PromptTemplate[]>([
        { id: 'prompt-1', title: language === 'zh' ? '代码审查助手' : 'Code Review Assistant', content: language === 'zh' ? '请审查以下代码，关注：1) 安全漏洞 2) 性能问题 3) 代码风格 4) 最佳实践' : 'Review the following code, focusing on: 1) Security vulnerabilities 2) Performance issues 3) Code style 4) Best practices', category: 'coding', starred: true, variables: [], createdAt: Date.now() },
        { id: 'prompt-2', title: language === 'zh' ? '文章润色' : 'Article Polish', content: language === 'zh' ? '请润色以下文章，保持原意不变，提升表达的流畅性和专业性' : 'Polish the following article while preserving the original meaning, improving fluency and professionalism', category: 'writing', starred: false, variables: [], createdAt: Date.now() },
        { id: 'prompt-3', title: language === 'zh' ? '数据分析报告' : 'Data Analysis Report', content: language === 'zh' ? '分析以下数据，生成结构化报告：1) 数据概览 2) 关键发现 3) 趋势分析 4) 建议措施' : 'Analyze the following data and generate a structured report: 1) Data overview 2) Key findings 3) Trend analysis 4) Recommendations', category: 'analysis', starred: true, variables: [], createdAt: Date.now() },
    ])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterCategory, setFilterCategory] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    const selectedPrompt = prompts.find(p => p.id === selectedId)

    const filteredPrompts = prompts.filter(p => {
        if (filterCategory && p.category !== filterCategory) return false
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            return p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
        }
        return true
    })

    const handleCopy = useCallback((id: string, content: string) => {
        navigator.clipboard.writeText(content)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 1500)
    }, [])

    const handleDelete = useCallback((id: string) => {
        setPrompts(prev => prev.filter(p => p.id !== id))
        if (selectedId === id) setSelectedId(null)
    }, [selectedId])

    const handleToggleStar = useCallback((id: string) => {
        setPrompts(prev => prev.map(p => p.id === id ? { ...p, starred: !p.starred } : p))
    }, [])

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {language === 'zh' ? '提示词库' : 'Prompts'}
                </span>
                <button className="p-1 text-text-muted hover:text-accent transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
                    <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={language === 'zh' ? '搜索提示词...' : 'Search prompts...'}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>
                <div className="flex flex-wrap gap-1">
                    {PROMPT_CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => setFilterCategory(filterCategory === cat.id ? null : cat.id)}
                            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${filterCategory === cat.id ? `${cat.color} bg-surface-active` : 'text-text-muted hover:text-text-primary'}`}
                        >
                            {language === 'zh' ? cat.labelZh : cat.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {filteredPrompts.map(prompt => {
                    const catConfig = PROMPT_CATEGORIES.find(c => c.id === prompt.category)
                    return (
                        <div
                            key={prompt.id}
                            onClick={() => setSelectedId(prompt.id)}
                            className={`flex items-start gap-2 px-2 py-1.5 mx-1 rounded-md cursor-pointer group transition-colors ${selectedId === prompt.id ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}
                        >
                            <Zap className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${catConfig?.color || 'text-text-muted'}`} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className="text-[11px] font-medium text-text-primary truncate">{prompt.title}</span>
                                    {prompt.starred && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                                </div>
                                <p className="text-[10px] text-text-muted truncate">{prompt.content}</p>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={e => { e.stopPropagation(); handleCopy(prompt.id, prompt.content) }} className="p-0.5 text-text-muted hover:text-accent">
                                    {copiedId === prompt.id ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
                                </button>
                                <button onClick={e => { e.stopPropagation(); handleToggleStar(prompt.id) }} className="p-0.5 text-text-muted hover:text-amber-400"><Star className="w-2.5 h-2.5" /></button>
                                <button onClick={e => { e.stopPropagation(); handleDelete(prompt.id) }} className="p-0.5 text-text-muted hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                            </div>
                        </div>
                    )
                })}

                {filteredPrompts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{language === 'zh' ? '暂无提示词' : 'No prompts yet'}</p>
                    </div>
                )}
            </div>

            {selectedPrompt && (
                <div className="border-t border-border/30 bg-surface/20 p-3">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text-primary truncate">{selectedPrompt.title}</span>
                        <button onClick={() => handleCopy(selectedPrompt.id, selectedPrompt.content)} className="p-1 text-text-muted hover:text-accent">
                            <Copy className="w-3 h-3" />
                        </button>
                    </div>
                    <p className="text-[11px] text-text-secondary leading-relaxed line-clamp-5">{selectedPrompt.content}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${PROMPT_CATEGORIES.find(c => c.id === selectedPrompt.category)?.color || 'text-text-muted'} bg-surface/50`}>
                            {language === 'zh' ? PROMPT_CATEGORIES.find(c => c.id === selectedPrompt.category)?.labelZh : PROMPT_CATEGORIES.find(c => c.id === selectedPrompt.category)?.label}
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
