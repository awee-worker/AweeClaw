import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Search, Bookmark as BookmarkIcon,
    Star, FolderOpen, FileText, Globe,
} from 'lucide-react'
import { useStore } from '@store'

interface BookmarkItem {
    id: string
    title: string
    path: string
    type: 'file' | 'url' | 'folder'
    starred: boolean
    createdAt: number
}

const TYPE_CONFIG = {
    file: { icon: FileText, color: 'text-blue-400' },
    url: { icon: Globe, color: 'text-emerald-400' },
    folder: { icon: FolderOpen, color: 'text-amber-400' },
}

export function BookmarksView() {
    const language = useStore(s => s.language)
    const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([
        { id: 'bm-1', title: language === 'zh' ? '项目根目录' : 'Project Root', path: '/', type: 'folder', starred: true, createdAt: Date.now() },
    ])
    const [searchQuery, setSearchQuery] = useState('')
    const [filterType, setFilterType] = useState<string | null>(null)

    const filteredBookmarks = bookmarks.filter(b => {
        if (filterType && b.type !== filterType) return false
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            return b.title.toLowerCase().includes(q) || b.path.toLowerCase().includes(q)
        }
        return true
    })

    const starredBookmarks = filteredBookmarks.filter(b => b.starred)
    const otherBookmarks = filteredBookmarks.filter(b => !b.starred)

    const handleDelete = useCallback((id: string) => {
        setBookmarks(prev => prev.filter(b => b.id !== id))
    }, [])

    const handleToggleStar = useCallback((id: string) => {
        setBookmarks(prev => prev.map(b => b.id === id ? { ...b, starred: !b.starred } : b))
    }, [])

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {language === 'zh' ? '书签' : 'Bookmarks'}
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
                        placeholder={language === 'zh' ? '搜索书签...' : 'Search bookmarks...'}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>
                <div className="flex gap-1">
                    {(['file', 'url', 'folder'] as const).map(type => {
                        const config = TYPE_CONFIG[type]
                        const Icon = config.icon
                        return (
                            <button
                                key={type}
                                onClick={() => setFilterType(filterType === type ? null : type)}
                                className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${filterType === type ? `${config.color} bg-surface-active` : 'text-text-muted hover:text-text-primary'}`}
                            >
                                <Icon className="w-2.5 h-2.5" />
                                {type === 'file' ? (language === 'zh' ? '文件' : 'File') : type === 'url' ? (language === 'zh' ? '链接' : 'URL') : (language === 'zh' ? '文件夹' : 'Folder')}
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {starredBookmarks.length > 0 && (
                    <div className="mb-2">
                        <div className="flex items-center gap-1.5 px-2 py-1">
                            <Star className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{language === 'zh' ? '收藏' : 'Starred'}</span>
                        </div>
                        {starredBookmarks.map(bm => (
                            <BookmarkRow key={bm.id} bookmark={bm} onDelete={handleDelete} onToggleStar={handleToggleStar} />
                        ))}
                    </div>
                )}

                {otherBookmarks.length > 0 && (
                    <div>
                        {starredBookmarks.length > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1">
                                <BookmarkIcon className="w-3 h-3 text-text-muted" />
                                <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{language === 'zh' ? '全部' : 'All'}</span>
                            </div>
                        )}
                        {otherBookmarks.map(bm => (
                            <BookmarkRow key={bm.id} bookmark={bm} onDelete={handleDelete} onToggleStar={handleToggleStar} />
                        ))}
                    </div>
                )}

                {filteredBookmarks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <BookmarkIcon className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{language === 'zh' ? '暂无书签' : 'No bookmarks yet'}</p>
                    </div>
                )}
            </div>
        </div>
    )
}

function BookmarkRow({ bookmark, onDelete, onToggleStar }: {
    bookmark: BookmarkItem
    onDelete: (id: string) => void
    onToggleStar: (id: string) => void
}) {
    const config = TYPE_CONFIG[bookmark.type]
    const Icon = config.icon
    return (
        <div className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md hover:bg-surface-hover cursor-pointer group transition-colors">
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${config.color}`} />
            <div className="flex-1 min-w-0">
                <span className="text-[11px] font-medium text-text-primary truncate block">{bookmark.title}</span>
                <span className="text-[10px] text-text-muted truncate block font-mono">{bookmark.path}</span>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); onToggleStar(bookmark.id) }} className="p-0.5 text-text-muted hover:text-amber-400">
                    <Star className={`w-2.5 h-2.5 ${bookmark.starred ? 'text-amber-400 fill-amber-400' : ''}`} />
                </button>
                <button onClick={e => { e.stopPropagation(); onDelete(bookmark.id) }} className="p-0.5 text-text-muted hover:text-red-400">
                    <Trash2 className="w-2.5 h-2.5" />
                </button>
            </div>
        </div>
    )
}
