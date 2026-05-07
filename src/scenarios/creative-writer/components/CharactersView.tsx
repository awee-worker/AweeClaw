import { useState, useCallback } from 'react'
import { Users, Plus, X, Check, ChevronRight, ChevronDown, User, Trash2 } from 'lucide-react'
import { useStore } from '@store'
import { Button } from '@/renderer/components/ui'
import { Agent } from '@/renderer/agent/core'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'

interface Character {
    id: string
    name: string
    role: string
    description: string
    traits: string
}

const DEMO_CHARACTERS: Character[] = [
    { id: '1', name: 'Alice', role: 'protagonist', description: 'A curious young woman with a talent for solving mysteries', traits: 'curious, brave, observant' },
    { id: '2', name: 'The Stranger', role: 'antagonist', description: 'A mysterious figure who appears at key moments', traits: 'enigmatic, calculating, charismatic' },
]

const ROLE_OPTIONS = [
    { value: 'protagonist', label: 'Protagonist', labelZh: '主角' },
    { value: 'antagonist', label: 'Antagonist', labelZh: '反派' },
    { value: 'supporting', label: 'Supporting', labelZh: '配角' },
    { value: 'narrator', label: 'Narrator', labelZh: '叙述者' },
    { value: 'other', label: 'Other', labelZh: '其他' },
]

export function CharactersView() {
    const language = useStore(s => s.language)
    const llmConfig = useStore(s => s.llmConfig)
    const workspacePath = useStore(s => s.workspacePath)

    const [characters, setCharacters] = useState<Character[]>(DEMO_CHARACTERS)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [showAddForm, setShowAddForm] = useState(false)
    const [addForm, setAddForm] = useState({ name: '', role: 'protagonist', description: '', traits: '' })

    const sendToChat = useCallback(async (prompt: string) => {
        try {
            const agentConfig = getAgentConfig()
            await Agent.send(
                prompt,
                { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
                workspacePath,
                'agent',
            )
        } catch {}
    }, [llmConfig, workspacePath])

    const handleAddCharacter = useCallback(() => {
        if (!addForm.name.trim()) return

        const char: Character = {
            id: Date.now().toString(),
            name: addForm.name.trim(),
            role: addForm.role,
            description: addForm.description.trim(),
            traits: addForm.traits.trim(),
        }

        setCharacters(prev => [...prev, char])
        setShowAddForm(false)
        setAddForm({ name: '', role: 'protagonist', description: '', traits: '' })

        const roleLabel = ROLE_OPTIONS.find(r => r.value === char.role)
        const roleText = language === 'zh' ? roleLabel?.labelZh : roleLabel?.label

        const prompt = language === 'zh'
            ? `我创建了一个新角色「${char.name}」（${roleText}），${char.description ? `描述：${char.description}` : ''}${char.traits ? `，特征：${char.traits}` : ''}。请帮我完善这个角色的设定。`
            : `I created a new character "${char.name}" (${roleText}), ${char.description ? `description: ${char.description}` : ''}${char.traits ? `, traits: ${char.traits}` : ''}. Please help me develop this character.`
        sendToChat(prompt)
    }, [addForm, language, sendToChat])

    const handleDeleteCharacter = useCallback((id: string) => {
        setCharacters(prev => prev.filter(c => c.id !== id))
        if (expandedId === id) setExpandedId(null)
    }, [expandedId])

    const handleCharacterClick = useCallback((char: Character) => {
        const roleLabel = ROLE_OPTIONS.find(r => r.value === char.role)
        const roleText = language === 'zh' ? roleLabel?.labelZh : roleLabel?.label

        const prompt = language === 'zh'
            ? `请帮我进一步发展角色「${char.name}」（${roleText}）的设定，包括背景故事、动机和人物弧线。`
            : `Please help me further develop the character "${char.name}" (${roleText}), including backstory, motivations, and character arc.`
        sendToChat(prompt)
    }, [language, sendToChat])

    const roleLabel = (role: string) => {
        const found = ROLE_OPTIONS.find(r => r.value === role)
        return language === 'zh' ? (found?.labelZh || role) : (found?.label || role)
    }

    const roleColor = (role: string) => {
        if (role === 'protagonist') return 'text-blue-400'
        if (role === 'antagonist') return 'text-red-400'
        if (role === 'narrator') return 'text-purple-400'
        return 'text-text-muted'
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    {language === 'zh' ? '角色' : 'CHARACTERS'}
                </span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddForm(true)} title={language === 'zh' ? '添加角色' : 'Add Character'}>
                    <Plus className="w-3 h-3" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {characters.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
                        <Users className="w-10 h-10 text-text-muted/75" />
                        <p className="text-xs text-text-muted text-center">
                            {language === 'zh' ? '暂无角色，点击 + 创建' : 'No characters yet. Click + to create one.'}
                        </p>
                    </div>
                ) : characters.map((char) => (
                    <div key={char.id}>
                        <button
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                            onClick={() => setExpandedId(expandedId === char.id ? null : char.id)}
                        >
                            {expandedId === char.id ? (
                                <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
                            ) : (
                                <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
                            )}
                            <User className="w-3.5 h-3.5 text-accent/70 flex-shrink-0" />
                            <span className="text-sm text-text-primary flex-1 truncate">{char.name}</span>
                            <span className={`text-[11px] ${roleColor(char.role)}`}>{roleLabel(char.role)}</span>
                        </button>

                        {expandedId === char.id && (
                            <div className="pl-8 pr-3 pb-2 space-y-1.5">
                                {char.description && (
                                    <p className="text-xs text-text-secondary leading-relaxed">{char.description}</p>
                                )}
                                {char.traits && (
                                    <div className="flex flex-wrap gap-1">
                                        {char.traits.split(',').map((trait, i) => (
                                            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-accent/10 text-accent/80">
                                                {trait.trim()}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 flex-1 text-xs gap-1"
                                        onClick={() => handleCharacterClick(char)}
                                    >
                                        <Users className="w-3 h-3" />
                                        {language === 'zh' ? '发展角色' : 'Develop'}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                                        onClick={() => handleDeleteCharacter(char.id)}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {showAddForm && (
                <div className="border-t border-border/30 p-3 space-y-2 bg-surface/30">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-primary">
                            {language === 'zh' ? '添加角色' : 'Add Character'}
                        </span>
                        <button onClick={() => setShowAddForm(false)} className="text-text-muted hover:text-text-primary">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <input
                        type="text"
                        value={addForm.name}
                        onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                        placeholder={language === 'zh' ? '角色名称' : 'Character name'}
                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                    />

                    <div className="flex gap-1">
                        {ROLE_OPTIONS.map(r => (
                            <button
                                key={r.value}
                                onClick={() => setAddForm(f => ({ ...f, role: r.value }))}
                                className={`flex-1 text-[11px] py-1 rounded transition-colors ${addForm.role === r.value ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
                            >
                                {language === 'zh' ? r.labelZh : r.label}
                            </button>
                        ))}
                    </div>

                    <textarea
                        value={addForm.description}
                        onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                        placeholder={language === 'zh' ? '角色描述' : 'Description'}
                        rows={2}
                        className="w-full px-2 py-1.5 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
                    />

                    <input
                        type="text"
                        value={addForm.traits}
                        onChange={e => setAddForm(f => ({ ...f, traits: e.target.value }))}
                        placeholder={language === 'zh' ? '特征（逗号分隔）' : 'Traits (comma separated)'}
                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                    />

                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-full text-xs gap-1"
                        onClick={handleAddCharacter}
                        disabled={!addForm.name.trim()}
                    >
                        <Check className="w-3 h-3" />
                        {language === 'zh' ? '添加' : 'Add'}
                    </Button>
                </div>
            )}

            {!showAddForm && (
                <div className="px-3 py-2 border-t border-border/30">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full text-xs gap-1.5"
                        onClick={() => setShowAddForm(true)}
                    >
                        <Plus className="w-3 h-3" />
                        {language === 'zh' ? '添加角色' : 'Add Character'}
                    </Button>
                </div>
            )}
        </div>
    )
}
