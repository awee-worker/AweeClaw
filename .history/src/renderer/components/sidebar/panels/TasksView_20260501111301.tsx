import { useState, useCallback } from 'react'
import {
    Plus, Trash2, Search, CheckSquare, Square,
} from 'lucide-react'
import { useStore } from '@store'

interface TaskItem {
    id: string
    title: string
    completed: boolean
    priority: 'low' | 'medium' | 'high'
    tags: string[]
    createdAt: number
}

const PRIORITY_CONFIG = {
    low: { label: 'Low', labelZh: '低', color: 'text-blue-400', dot: 'bg-blue-400' },
    medium: { label: 'Medium', labelZh: '中', color: 'text-amber-400', dot: 'bg-amber-400' },
    high: { label: 'High', labelZh: '高', color: 'text-red-400', dot: 'bg-red-400' },
}

export function TasksView() {
    const language = useStore(s => s.language)
    const [tasks, setTasks] = useState<TaskItem[]>([
        { id: 'task-1', title: language === 'zh' ? '欢迎使用任务管理' : 'Welcome to Tasks', completed: false, priority: 'medium', tags: [language === 'zh' ? '示例' : 'demo'], createdAt: Date.now() },
    ])
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all')
    const [newTaskTitle, setNewTaskTitle] = useState('')

    const filteredTasks = tasks.filter(t => {
        if (filterStatus === 'active' && t.completed) return false
        if (filterStatus === 'completed' && !t.completed) return false
        if (searchQuery) return t.title.toLowerCase().includes(searchQuery.toLowerCase())
        return true
    })

    const activeTasks = filteredTasks.filter(t => !t.completed)
    const completedTasks = filteredTasks.filter(t => t.completed)

    const handleAdd = useCallback(() => {
        if (!newTaskTitle.trim()) return
        setTasks(prev => [{
            id: `task-${Date.now()}`,
            title: newTaskTitle.trim(),
            completed: false,
            priority: 'medium',
            tags: [],
            createdAt: Date.now(),
        }, ...prev])
        setNewTaskTitle('')
    }, [newTaskTitle])

    const handleToggle = useCallback((id: string) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))
    }, [])

    const handleDelete = useCallback((id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id))
    }, [])

    const handleCyclePriority = useCallback((id: string) => {
        setTasks(prev => prev.map(t => {
            if (t.id !== id) return t
            const order: TaskItem['priority'][] = ['low', 'medium', 'high']
            const nextIndex = (order.indexOf(t.priority) + 1) % order.length
            return { ...t, priority: order[nextIndex] }
        }))
    }, [])

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-11 min-w-0 px-4 flex items-center justify-between gap-2 group border-b border-border/50 bg-transparent sticky top-0 z-10">
                <span className="min-w-0 flex-shrink-0 whitespace-nowrap text-[11px] font-black text-text-primary/60 uppercase tracking-[0.2em] font-sans">
                    {language === 'zh' ? '任务' : 'Tasks'}
                </span>
                <div className="flex items-center gap-1 text-[10px] text-text-muted">
                    <span>{activeTasks.length}</span>
                    <span>/</span>
                    <span>{tasks.length}</span>
                </div>
            </div>

            <div className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 px-2 py-1.5 bg-surface/30 rounded-md border border-border/20">
                    <Plus className="w-3 h-3 text-text-muted flex-shrink-0" />
                    <input
                        value={newTaskTitle}
                        onChange={e => setNewTaskTitle(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        placeholder={language === 'zh' ? '添加任务...' : 'Add task...'}
                        className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/70"
                    />
                </div>

                <div className="flex items-center gap-1">
                    {(['all', 'active', 'completed'] as const).map(status => (
                        <button
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${filterStatus === status ? 'text-accent bg-accent/10' : 'text-text-muted hover:text-text-primary'}`}
                        >
                            {status === 'all' ? (language === 'zh' ? '全部' : 'All') : status === 'active' ? (language === 'zh' ? '进行中' : 'Active') : (language === 'zh' ? '已完成' : 'Done')}
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
                                onCyclePriority={handleCyclePriority}
                                language={language}
                            />
                        ))}
                    </div>
                )}

                {completedTasks.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 px-2 py-1">
                            <CheckSquare className="w-3 h-3 text-text-muted" />
                            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                                {language === 'zh' ? '已完成' : 'Completed'} ({completedTasks.length})
                            </span>
                        </div>
                        <div className="space-y-0.5">
                            {completedTasks.map(task => (
                                <TaskRow
                                    key={task.id}
                                    task={task}
                                    onToggle={handleToggle}
                                    onDelete={handleDelete}
                                    onCyclePriority={handleCyclePriority}
                                    language={language}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {filteredTasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                        <CheckSquare className="w-8 h-8 mb-2 opacity-30" />
                        <p className="text-xs">{language === 'zh' ? '暂无任务' : 'No tasks yet'}</p>
                    </div>
                )}
            </div>
        </div>
    )
}

function TaskRow({
    task, onToggle, onDelete, onCyclePriority, language,
}: {
    task: TaskItem
    onToggle: (id: string) => void
    onDelete: (id: string) => void
    onCyclePriority: (id: string) => void
    language: string
}) {
    const priorityConfig = PRIORITY_CONFIG[task.priority]
    return (
        <div className={`flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md group hover:bg-surface-hover transition-colors ${task.completed ? 'opacity-55' : ''}`}>
            <button onClick={() => onToggle(task.id)} className="flex-shrink-0">
                {task.completed
                    ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                    : <Square className="w-3.5 h-3.5 text-text-muted" />
                }
            </button>
            <span className={`text-[11px] flex-1 truncate ${task.completed ? 'line-through text-text-muted' : 'text-text-primary'}`}>{task.title}</span>
            <button onClick={() => onCyclePriority(task.id)} className="flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" title={language === 'zh' ? priorityConfig.labelZh : priorityConfig.label}>
                <div className={`w-2 h-2 rounded-full ${priorityConfig.dot}`} />
            </button>
            <button onClick={() => onDelete(task.id)} className="p-0.5 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-2.5 h-2.5" />
            </button>
        </div>
    )
}
