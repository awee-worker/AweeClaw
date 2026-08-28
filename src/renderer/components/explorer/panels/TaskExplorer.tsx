import { useState, useCallback, useMemo } from 'react'
import {
    Plus, Trash2, Search, CheckSquare, Square,
    Loader2, Sparkles,
} from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { useTodoStore, type WorkTodoItem } from '@renderer/components/scene-tools/stores'

/** 向 ChatPanel 发送 prompt，触发 AI 执行任务 */
function executeTask(item: WorkTodoItem, update: (id: string, patch: Partial<WorkTodoItem>) => void): void {
    update(item.id, { status: 'executing' })
    const prompt = `请帮我执行以下任务，完成后告知结果：\n\n${item.text}`
    window.dispatchEvent(new CustomEvent('aweeclaw:quick-prompt', { detail: prompt }))
}

export function TasksView() {
    const language = useStore(s => s.language)
    const { items, add, update, remove } = useTodoStore()
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'done'>('all')
    const [newTaskTitle, setNewTaskTitle] = useState('')

    const activeCount = useMemo(() => items.filter(t => t.status !== 'done').length, [items])

    const filteredTasks = useMemo(() => {
        return items.filter(t => {
            if (filterStatus === 'active' && t.status === 'done') return false
            if (filterStatus === 'done' && t.status !== 'done') return false
            if (searchQuery) return t.text.toLowerCase().includes(searchQuery.toLowerCase())
            return true
        }).sort((a, b) => {
            if (a.status === 'done' && b.status !== 'done') return 1
            if (a.status !== 'done' && b.status === 'done') return -1
            if (a.status === 'executing' && b.status !== 'executing') return -1
            if (a.status !== 'executing' && b.status === 'executing') return 1
            return 0
        })
    }, [items, filterStatus, searchQuery])

    const activeTasks = filteredTasks.filter(t => t.status !== 'done')
    const completedTasks = filteredTasks.filter(t => t.status === 'done')

    const handleAdd = useCallback(() => {
        if (!newTaskTitle.trim()) return
        add({ text: newTaskTitle.trim(), status: 'pending', priority: 'medium' })
        setNewTaskTitle('')
    }, [newTaskTitle, add])

    const handleToggle = useCallback((id: string) => {
        update(id, { status: 'done' })
    }, [update])

    const handleDelete = useCallback((id: string) => {
        remove(id)
    }, [remove])

    const handleExecute = useCallback((item: WorkTodoItem) => {
        executeTask(item, update)
    }, [update])

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {t('explorer.tasks', language as Language)}
                </span>
                <div className="flex items-center gap-1 text-[10px] text-text-muted">
                    <span>{activeCount}</span>
                    <span>/</span>
                    <span>{items.length}</span>
                </div>
            </div>

            <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
                    <Plus className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <input
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        placeholder={t('explorer.addtask', language as Language)}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>

                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
                    <Search className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={t('explorer.searchtasks', language as Language)}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>

                <div className="flex items-center gap-1">
                    {(['all', 'active', 'done'] as const).map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${filterStatus === status ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            {status === 'all' ? (t('explorer.all', language as Language)) : status === 'active' ? (t('explorer.active', language as Language)) : (t('explorer.done', language as Language))}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {activeTasks.length > 0 && (
                    <div className="space-y-0.5 mb-3">
                        {activeTasks.map(task => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                onToggle={handleToggle}
                                onDelete={handleDelete}
                                onExecute={handleExecute}
                                language={language}
                            />
                        ))}
                    </div>
                )}

                {completedTasks.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 px-2 py-1">
                            <CheckSquare className="w-3 h-3 text-text-muted/50" />
                            <span className="text-[10px] text-text-muted/60">{t('explorer.completed', language as Language)}</span>
                        </div>
                        <div className="space-y-0.5 mt-1">
                            {completedTasks.map(task => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    onToggle={handleToggle}
                                    onDelete={handleDelete}
                                    onExecute={handleExecute}
                                    language={language}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {filteredTasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <CheckSquare className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{t('explorer.notasksyet', language as Language)}</p>
                    </div>
                )}
            </div>
        </div>
    )
}

function TaskRow({
    task, onToggle, onDelete, onExecute, language,
}: {
    task: WorkTodoItem
    onToggle: (id: string) => void
    onDelete: (id: string) => void
    onExecute: (item: WorkTodoItem) => void
    language: Language
}) {
    return (
        <div className={`flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md group hover:bg-surface-hover transition-colors ${
            task.status === 'done' ? 'opacity-55' : task.status === 'executing' ? 'bg-accent/5 border border-accent/20' : ''
        }`}>
            <button onClick={() => onToggle(task.id)} className="flex-shrink-0">
                {task.status === 'done'
                    ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                    : <Square className="w-3.5 h-3.5 text-text-muted" />
                }
            </button>
            <span className={`text-[11px] flex-1 truncate ${task.status === 'done' ? 'line-through text-text-muted' : 'text-text-primary'}`}>{task.text}</span>
            {/* AI 执行按钮 */}
            {task.status !== 'done' && (
                <button
                    onClick={() => onExecute(task)}
                    title={language === 'zh' ? '让AI执行此任务' : 'Let AI execute'}
                    className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${task.status === 'executing' ? 'text-accent' : 'text-text-muted hover:text-violet-400'}`}
                >
                    {task.status === 'executing'
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Sparkles className="w-3 h-3" />
                    }
                </button>
            )}
            <button onClick={() => onDelete(task.id)} className="p-0.5 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-2.5 h-2.5" />
            </button>
        </div>
    )
}
