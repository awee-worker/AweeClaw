import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Search, BookOpen, Star, Copy,
} from 'lucide-react'
import { useStore } from '@store'

interface KnowledgeEntry {
    id: string
    title: string
    content: string
    tags: string[]
    starred: boolean
    category: string
    createdAt: number
}

const CATEGORIES = [
    { id: 'concept', label: 'Concept', labelZh: '概念', color: 'text-blue-400' },
    { id: 'faq', label: 'FAQ', labelZh: '常见问题', color: 'text-amber-400' },
    { id: 'reference', label: 'Reference', labelZh: '参考资料', color: 'text-emerald-400' },
    { id: 'glossary', label: 'Glossary', labelZh: '术语表', color: 'text-purple-400' },
    { id: 'best-practice', label: 'Best Practice', labelZh: '最佳实践', color: 'text-cyan-400' },
]

export function KnowledgeView() {
    const language = useStore(s => s.language)
    const [entries, setEntries] = useState<KnowledgeEntry[]>([
        { id: 'kb-1', title: language === 'zh' ? '欢迎使用知识库' : 'Welcome to Knowledge', content: language === 'zh' ? '在这里管理和检索你的知识条目' : 'Manage and retrieve your knowledge entries here', tags: [language === 'zh' ? '入门' : 'getting-started'], starred: true, category: 'concept', createdAt: Date.now() },
    ])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterCategory, setFilterCategory] = useState<string | null>(null)

    const selectedEntry = entries.find(e => e.id === selectedId)

    const filteredEntries = entries.filter(e => {
        if (filterCategory && e.category !== filterCategory) return false
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q))
        }
        return true
    })

    const handleDelete = useCallback((id: string) => {
        setEntries(prev => prev.filter(e => e.id !== id))
        if (selectedId === id) setSelectedId(null)
    }, [selectedId])

    const handleToggleStar = useCallback((id: string) => {
        setEntries(prev => prev.map(e => e.id === id ? { ...e, starred: !e.starred } : e))
    }, [])

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {language === 'zh' ? '知识库' : 'Knowledge'}
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
                        placeholder={language === 'zh' ? '搜索知识...' : 'Search knowledge...'}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>
                <div className="flex flex-wrap gap-1">
                    {CATEGORIES.map(cat => (
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
                {filteredEntries.map(entry => {
                    const catConfig = CATEGORIES.find(c => c.id === entry.category)
                    return (
                        <div
                            key={entry.id}
                            onClick={() => setSelectedId(entry.id)}
                            className={`flex items-start gap-2 px-2 py-1.5 mx-1 rounded-md cursor-pointer group transition-colors ${selectedId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-hover'}`}
                        >
                            <BookOpen className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${catConfig?.color || 'text-text-muted'}`} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className="text-[11px] font-medium text-text-primary truncate">{entry.title}</span>
                                    {entry.starred && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                                </div>
                                <p className="text-[10px] text-text-muted truncate">{entry.content}</p>
                                <div className="flex gap-1 mt-0.5">
                                    {entry.tags.slice(0, 3).map(tag => (
                                        <span key={tag} className="text-[9px] px-1 py-0 bg-surface/50 rounded text-text-muted">{tag}</span>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={e => { e.stopPropagation(); handleToggleStar(entry.id) }} className="p-0.5 text-text-muted hover:text-amber-400"><Star className="w-2.5 h-2.5" /></button>
                                <button onClick={e => { e.stopPropagation(); handleDelete(entry.id) }} className="p-0.5 text-text-muted hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                            </div>
                        </div>
                    )
                })}

                {filteredEntries.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <BookOpen className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{language === 'zh' ? '暂无知识条目' : 'No entries yet'}</p>
                    </div>
                )}
            </div>

            {selectedEntry && (
                <div className="border-t border-border/30 bg-surface/20 p-3">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text-primary truncate">{selectedEntry.title}</span>
                        <button className="p-1 text-text-muted hover:text-text-primary"><Copy className="w-3 h-3" /></button>
                    </div>
                    <p className="text-[11px] text-text-muted leading-relaxed line-clamp-4">{selectedEntry.content}</p>
                    <div className="flex gap-1 mt-1.5">
                        {selectedEntry.tags.map(tag => (
                            <span key={tag} className="text-[9px] px-1 py-0.5 bg-accent/10 text-accent rounded">{tag}</span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
