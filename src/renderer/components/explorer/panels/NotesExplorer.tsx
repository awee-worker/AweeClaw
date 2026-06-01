import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Edit3, Check, X, Search,
    FileText, Star, Pin,
} from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface Note {
    id: string
    title: string
    content: string
    pinned: boolean
    starred: boolean
    createdAt: number
    updatedAt: number
}

export function NotesView() {
    const language = useStore(s => s.language)
    const [notes, setNotes] = useState<Note[]>([
        { id: 'note-1', title: t('explorer.welcometonotes', language as Language), content: t('explorer.quicklycaptureyourthoughtsand', language as Language), pinned: true, starred: false, createdAt: Date.now(), updatedAt: Date.now() },
    ])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState(false)
    const [editTitle, setEditTitle] = useState('')
    const [editContent, setEditContent] = useState('')
    const [searchQuery, setSearchQuery] = useState('')

    const selectedNote = notes.find(n => n.id === selectedId)

    const handleAdd = useCallback(() => {
        const newNote: Note = {
            id: `note-${Date.now()}`,
            title: '',
            content: '',
            pinned: false,
            starred: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
        setNotes(prev => [newNote, ...prev])
        setSelectedId(newNote.id)
        setEditTitle('')
        setEditContent('')
        setIsEditing(true)
    }, [])

    const handleSave = useCallback(() => {
        if (!selectedId) return
        setNotes(prev => prev.map(n => n.id === selectedId ? { ...n, title: editTitle, content: editContent, updatedAt: Date.now() } : n))
        setIsEditing(false)
    }, [selectedId, editTitle, editContent])

    const handleDelete = useCallback((id: string) => {
        setNotes(prev => prev.filter(n => n.id !== id))
        if (selectedId === id) {
            setSelectedId(null)
            setIsEditing(false)
        }
    }, [selectedId])

    const handleStartEdit = useCallback((note: Note) => {
        setEditTitle(note.title)
        setEditContent(note.content)
        setIsEditing(true)
    }, [])

    const handleTogglePin = useCallback((id: string) => {
        setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n))
    }, [])

    const handleToggleStar = useCallback((id: string) => {
        setNotes(prev => prev.map(n => n.id === id ? { ...n, starred: !n.starred } : n))
    }, [])

    const filteredNotes = notes.filter(n =>
        !searchQuery || n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
    const pinnedNotes = filteredNotes.filter(n => n.pinned)
    const otherNotes = filteredNotes.filter(n => !n.pinned)

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {t('explorer.notes', language as Language)}
                </span>
                <button onClick={handleAdd} className="p-1 text-text-muted hover:text-accent transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="px-3 py-2">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
                    <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={t('explorer.searchnotes', language as Language)}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {pinnedNotes.length > 0 && (
                    <div className="mb-2">
                        <div className="flex items-center gap-1.5 px-2 py-1">
                            <Pin className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t('explorer.pinned', language as Language)}</span>
                        </div>
                        {pinnedNotes.map(note => (
                            <NoteItem
                                key={note.id}
                                note={note}
                                isSelected={selectedId === note.id}
                                onSelect={() => { setSelectedId(note.id); setIsEditing(false) }}
                                onDelete={handleDelete}
                                onTogglePin={handleTogglePin}
                                onToggleStar={handleToggleStar}
                                language={language}
                            />
                        ))}
                    </div>
                )}

                {otherNotes.length > 0 && (
                    <div>
                        {pinnedNotes.length > 0 && (
                            <div className="flex items-center gap-1.5 px-2 py-1">
                                <FileText className="w-3 h-3 text-text-muted" />
                                <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t('explorer.allnotes', language as Language)}</span>
                            </div>
                        )}
                        {otherNotes.map(note => (
                            <NoteItem
                                key={note.id}
                                note={note}
                                isSelected={selectedId === note.id}
                                onSelect={() => { setSelectedId(note.id); setIsEditing(false) }}
                                onDelete={handleDelete}
                                onTogglePin={handleTogglePin}
                                onToggleStar={handleToggleStar}
                                language={language}
                            />
                        ))}
                    </div>
                )}

                {filteredNotes.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <FileText className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{t('explorer.nonotesyet', language as Language)}</p>
                        <button onClick={handleAdd} className="mt-2 text-[11px] text-accent hover:underline">
                            {t('explorer.createyourfirstnote', language as Language)}
                        </button>
                    </div>
                )}
            </div>

            {selectedNote && (
                <div className="border-t border-border/30 bg-surface/20">
                    {isEditing ? (
                        <div className="p-3 space-y-2">
                            <input
                                value={editTitle}
                                onChange={e => setEditTitle(e.target.value)}
                                placeholder={t('explorer.title', language as Language)}
                                className="w-full bg-transparent text-xs font-medium text-text-primary outline-none placeholder:text-text-muted/70"
                                autoFocus
                            />
                            <textarea
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                placeholder={t('explorer.typecontent', language as Language)}
                                rows={4}
                                className="w-full bg-transparent text-[11px] text-text-secondary outline-none resize-none placeholder:text-text-muted/70"
                            />
                            <div className="flex gap-1.5 justify-end">
                                <button onClick={() => setIsEditing(false)} className="px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"><X className="w-3 h-3" /></button>
                                <button onClick={handleSave} className="px-2 py-1 text-[11px] text-accent hover:text-accent/80 flex items-center gap-1"><Check className="w-3 h-3" />{t('explorer.save', language as Language)}</button>
                            </div>
                        </div>
                    ) : (
                        <div className="p-3">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-text-primary truncate">{selectedNote.title || (t('explorer.untitled', language as Language))}</span>
                                <button onClick={() => handleStartEdit(selectedNote)} className="p-1 text-text-muted hover:text-text-primary"><Edit3 className="w-3 h-3" /></button>
                            </div>
                            <p className="text-[11px] text-text-muted leading-relaxed line-clamp-4">{selectedNote.content || (t('explorer.clickedittoaddcontent', language as Language))}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function NoteItem({
    note, isSelected, onSelect, onDelete, onTogglePin, onToggleStar, language,
}: {
    note: Note
    isSelected: boolean
    onSelect: () => void
    onDelete: (id: string) => void
    onTogglePin: (id: string) => void
    onToggleStar: (id: string) => void
    language: Language
}) {
    return (
        <div
            onClick={onSelect}
            className={`flex items-start gap-2 px-2 py-1.5 mx-1 rounded-md cursor-pointer group transition-colors ${isSelected ? 'bg-accent/10 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}`}
        >
            <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-text-muted" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium truncate">{note.title || (t('explorer.untitled2', language as Language))}</span>
                    {note.starred && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />}
                </div>
                <p className="text-[10px] text-text-muted truncate">{note.content || (t('explorer.emptynote', language as Language))}</p>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); onTogglePin(note.id) }} className="p-0.5 text-text-muted hover:text-amber-400"><Pin className="w-2.5 h-2.5" /></button>
                <button onClick={e => { e.stopPropagation(); onToggleStar(note.id) }} className="p-0.5 text-text-muted hover:text-amber-400"><Star className="w-2.5 h-2.5" /></button>
                <button onClick={e => { e.stopPropagation(); onDelete(note.id) }} className="p-0.5 text-text-muted hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
            </div>
        </div>
    )
}
