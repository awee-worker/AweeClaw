import { useState, useCallback } from 'react'
import {
    Plus, GripVertical, Trash2, Edit3, Check, X,
    Move, Link2, Type, StickyNote,
    ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'
import { useStore } from '@store'

interface CanvasNode {
    id: string
    type: 'note' | 'idea' | 'task' | 'link'
    x: number
    y: number
    width: number
    height: number
    title: string
    content: string
    color: string
}

const NODE_COLORS = [
    { id: 'violet', bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400', dot: 'bg-violet-400' },
    { id: 'blue', bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-400' },
    { id: 'emerald', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    { id: 'amber', bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', dot: 'bg-amber-400' },
    { id: 'rose', bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400', dot: 'bg-rose-400' },
    { id: 'cyan', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400', dot: 'bg-cyan-400' },
]

const NODE_TYPE_CONFIG = {
    note: { icon: StickyNote, label: 'Note', labelZh: '笔记' },
    idea: { icon: Type, label: 'Idea', labelZh: '想法' },
    task: { icon: Check, label: 'Task', labelZh: '任务' },
    link: { icon: Link2, label: 'Link', labelZh: '链接' },
}

function createNode(type: CanvasNode['type'], x: number, y: number): CanvasNode {
    const colorIndex = Math.floor(Math.random() * NODE_COLORS.length)
    return {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        x,
        y,
        width: 220,
        height: 120,
        title: '',
        content: '',
        color: NODE_COLORS[colorIndex].id,
    }
}

function CanvasNodeCard({
    node,
    onUpdate,
    onDelete,
    language,
}: {
    node: CanvasNode
    onUpdate: (id: string, updates: Partial<CanvasNode>) => void
    onDelete: (id: string) => void
    language: string
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [editTitle, setEditTitle] = useState(node.title)
    const [editContent, setEditContent] = useState(node.content)
    const [isDragging, setIsDragging] = useState(false)
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

    const colorConfig = NODE_COLORS.find(c => c.id === node.color) || NODE_COLORS[0]
    const typeConfig = NODE_TYPE_CONFIG[node.type]
    const TypeIcon = typeConfig.icon

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (isEditing) return
        e.preventDefault()
        setIsDragging(true)
        setDragOffset({ x: e.clientX - node.x, y: e.clientY - node.y })

        const handleMouseMove = (e: MouseEvent) => {
            onUpdate(node.id, { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
        }
        const handleMouseUp = () => {
            setIsDragging(false)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }, [node.id, node.x, node.y, isEditing, dragOffset, onUpdate])

    const handleSave = useCallback(() => {
        onUpdate(node.id, { title: editTitle, content: editContent })
        setIsEditing(false)
    }, [node.id, editTitle, editContent, onUpdate])

    return (
        <div
            style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
            className={`absolute ${colorConfig.bg} ${colorConfig.border} border rounded-xl backdrop-blur-sm shadow-lg shadow-black/10 transition-shadow ${isDragging ? 'shadow-xl shadow-black/20 z-50' : 'z-10'}`}
            onMouseDown={handleMouseDown}
        >
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5">
                <GripVertical className="w-3 h-3 text-text-muted/75 cursor-grab" />
                <TypeIcon className={`w-3.5 h-3.5 ${colorConfig.text}`} />
                {isEditing ? (
                    <input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="flex-1 bg-transparent text-xs font-medium text-text-primary outline-none"
                        placeholder={language === 'zh' ? '标题...' : 'Title...'}
                        autoFocus
                    />
                ) : (
                    <span className="flex-1 text-xs font-medium text-text-primary truncate">
                        {node.title || (language === 'zh' ? typeConfig.labelZh : typeConfig.label)}
                    </span>
                )}
                <div className={`w-2 h-2 rounded-full ${colorConfig.dot}`} />
                {!isEditing && (
                    <button onClick={() => { setEditTitle(node.title); setEditContent(node.content); setIsEditing(true) }} className="p-0.5 text-text-muted/75 hover:text-text-primary">
                        <Edit3 className="w-3 h-3" />
                    </button>
                )}
                <button onClick={() => onDelete(node.id)} className="p-0.5 text-text-muted/75 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                </button>
            </div>
            <div className="px-3 py-2">
                {isEditing ? (
                    <div className="space-y-2">
                        <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full bg-transparent text-[11px] text-text-secondary outline-none resize-none min-h-[40px]"
                            placeholder={language === 'zh' ? '输入内容...' : 'Type content...'}
                            rows={3}
                        />
                        <div className="flex gap-1 justify-end">
                            <button onClick={() => setIsEditing(false)} className="p-1 text-text-muted hover:text-text-primary"><X className="w-3 h-3" /></button>
                            <button onClick={handleSave} className="p-1 text-accent hover:text-accent/80"><Check className="w-3 h-3" /></button>
                        </div>
                    </div>
                ) : (
                    <p className="text-[11px] text-text-muted leading-relaxed line-clamp-3">
                        {node.content || (language === 'zh' ? '双击编辑内容...' : 'Double-click to edit...')}
                    </p>
                )}
            </div>
        </div>
    )
}

export default function CanvasWorkspace() {
    const language = useStore(s => s.language)
    const [nodes, setNodes] = useState<CanvasNode[]>([
        { id: 'welcome-1', type: 'note', x: 60, y: 60, width: 240, height: 120, title: language === 'zh' ? '欢迎使用画布' : 'Welcome to Canvas', content: language === 'zh' ? '拖拽节点、添加想法、构建思维导图' : 'Drag nodes, add ideas, build mind maps', color: 'violet' },
        { id: 'welcome-2', type: 'idea', x: 340, y: 80, width: 220, height: 120, title: language === 'zh' ? '自由创作' : 'Free Creation', content: language === 'zh' ? '在无限画布上自由组织和探索思路' : 'Organize and explore ideas on an infinite canvas', color: 'blue' },
        { id: 'welcome-3', type: 'task', x: 180, y: 240, width: 220, height: 120, title: language === 'zh' ? '任务规划' : 'Task Planning', content: language === 'zh' ? '将任务可视化，理清优先级和依赖关系' : 'Visualize tasks, clarify priorities and dependencies', color: 'emerald' },
    ])
    const [zoom, setZoom] = useState(1)
    const [showAddMenu, setShowAddMenu] = useState(false)

    const handleAddNode = useCallback((type: CanvasNode['type']) => {
        const baseX = 100 + Math.random() * 200
        const baseY = 100 + Math.random() * 200
        setNodes(prev => [...prev, createNode(type, baseX, baseY)])
        setShowAddMenu(false)
    }, [])

    const handleUpdateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n))
    }, [])

    const handleDeleteNode = useCallback((id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id))
    }, [])

    return (
        <div className="flex-1 flex flex-col h-full bg-background relative overflow-hidden">
            <div className="absolute top-3 left-3 z-40 flex items-center gap-1.5">
                <div className="relative">
                    <button
                        onClick={() => setShowAddMenu(!showAddMenu)}
                        className="h-8 px-3 flex items-center gap-1.5 bg-surface/80 backdrop-blur-md border border-border/30 rounded-lg text-xs font-medium text-text-primary hover:bg-surface-hover transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {language === 'zh' ? '添加节点' : 'Add Node'}
                    </button>
                    {showAddMenu && (
                        <div className="absolute top-full left-0 mt-1 bg-surface/95 backdrop-blur-md border border-border/30 rounded-lg shadow-xl py-1 min-w-[140px] z-50">
                            {(Object.entries(NODE_TYPE_CONFIG) as [CanvasNode['type'], typeof NODE_TYPE_CONFIG.note][]).map(([type, config]) => {
                                const Icon = config.icon
                                return (
                                    <button
                                        key={type}
                                        onClick={() => handleAddNode(type)}
                                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {language === 'zh' ? config.labelZh : config.label}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="absolute top-3 right-3 z-40 flex items-center gap-1 bg-surface/80 backdrop-blur-md border border-border/30 rounded-lg px-1.5 py-1">
                <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-1 text-text-muted hover:text-text-primary transition-colors">
                    <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] text-text-muted min-w-[36px] text-center font-mono">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="p-1 text-text-muted hover:text-text-primary transition-colors">
                    <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-border/30 mx-0.5" />
                <button onClick={() => setZoom(1)} className="p-1 text-text-muted hover:text-text-primary transition-colors">
                    <Maximize2 className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="absolute bottom-3 left-3 z-40 flex items-center gap-2 text-[10px] text-text-muted/75">
                <Move className="w-3 h-3" />
                {language === 'zh' ? '拖拽移动节点' : 'Drag to move nodes'}
                <span className="text-text-muted/40">·</span>
                <span>{nodes.length} {language === 'zh' ? '个节点' : 'nodes'}</span>
            </div>

            <div
                className="flex-1 relative"
                style={{
                    backgroundImage: 'radial-gradient(circle, rgb(var(--text-muted) / 0.08) 1px, transparent 1px)',
                    backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
                }}
            >
                <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }} className="absolute inset-0">
                    {nodes.map(node => (
                        <CanvasNodeCard
                            key={node.id}
                            node={node}
                            onUpdate={handleUpdateNode}
                            onDelete={handleDeleteNode}
                            language={language}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}
