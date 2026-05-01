import { useState, useCallback } from 'react'
import { Database, FileSpreadsheet, Plus, RefreshCw, FolderOpen, ChevronRight, ChevronDown, Server, Cable, X, Check } from 'lucide-react'
import { useStore } from '@store'
import { Button } from '../../ui'
import { Agent } from '@/renderer/agent/core'
import { getAgentConfig } from '@/renderer/agent/utils/AgentConfig'

interface DataSource {
    id: string
    name: string
    type: 'database' | 'file' | 'api'
    status: 'connected' | 'disconnected' | 'error'
    meta?: string
    driver?: string
    host?: string
    port?: number
    database?: string
}

const INITIAL_SOURCES: DataSource[] = [
    { id: '1', name: 'workspace', type: 'file', status: 'connected', meta: 'CSV / Excel / JSON' },
    { id: '2', name: 'SQLite Local', type: 'database', status: 'disconnected', meta: 'SQLite', driver: 'sqlite' },
    { id: '3', name: 'PostgreSQL', type: 'database', status: 'disconnected', meta: 'postgresql', driver: 'postgresql', host: 'localhost', port: 5432 },
    { id: '4', name: 'REST API', type: 'api', status: 'disconnected', meta: 'HTTP Endpoint' },
]

type AddFormType = 'database' | 'file' | 'api' | null

const DB_DRIVERS = [
    { value: 'sqlite', label: 'SQLite' },
    { value: 'postgresql', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'duckdb', label: 'DuckDB' },
]

export function DataSourceView() {
    const language = useStore(s => s.language)
    const setActiveSidePanel = useStore(s => s.setActiveSidePanel)
    const llmConfig = useStore(s => s.llmConfig)
    const workspacePath = useStore(s => s.workspacePath)

    const [sources, setSources] = useState<DataSource[]>(INITIAL_SOURCES)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [showAddForm, setShowAddForm] = useState<AddFormType>(null)
    const [addForm, setAddForm] = useState({ driver: 'sqlite', name: '', host: '', port: '5432', database: '', url: '' })

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

    const toggleConnection = useCallback((sourceId: string) => {
        setSources(prev => prev.map(s => {
            if (s.id !== sourceId) return s
            const newStatus = s.status === 'connected' ? 'disconnected' : 'connected'
            return { ...s, status: newStatus }
        }))
    }, [])

    const handleBrowseFiles = useCallback(() => {
        setActiveSidePanel('explorer')
    }, [setActiveSidePanel])

    const handleAddSource = useCallback(() => {
        if (!addForm.name.trim()) return

        const newSource: DataSource = {
            id: Date.now().toString(),
            name: addForm.name.trim(),
            type: showAddForm as DataSource['type'],
            status: 'disconnected',
            meta: showAddForm === 'database'
                ? DB_DRIVERS.find(d => d.value === addForm.driver)?.label || addForm.driver
                : showAddForm === 'api' ? 'HTTP Endpoint' : 'CSV / Excel / JSON',
            driver: showAddForm === 'database' ? addForm.driver : undefined,
            host: showAddForm === 'database' && addForm.driver !== 'sqlite' ? addForm.host || 'localhost' : undefined,
            port: showAddForm === 'database' && addForm.driver !== 'sqlite' ? parseInt(addForm.port) || 5432 : undefined,
            database: showAddForm === 'database' ? addForm.database || undefined : undefined,
        }

        setSources(prev => [...prev, newSource])
        setShowAddForm(null)
        setAddForm({ driver: 'sqlite', name: '', host: '', port: '5432', database: '', url: '' })

        const prompt = showAddForm === 'database'
            ? (language === 'zh'
                ? `我添加了一个 ${newSource.meta} 数据源「${newSource.name}」${newSource.host ? `，地址 ${newSource.host}:${newSource.port}` : ''}${newSource.database ? `，数据库 ${newSource.database}` : ''}，请帮我连接并查看可用的表。`
                : `I added a ${newSource.meta} data source "${newSource.name}"${newSource.host ? `, address ${newSource.host}:${newSource.port}` : ''}${newSource.database ? `, database ${newSource.database}` : ''}. Please help me connect and check available tables.`)
            : showAddForm === 'api'
                ? (language === 'zh'
                    ? `我添加了一个 REST API 数据源「${newSource.name}」，URL: ${addForm.url || '(待配置)'}，请帮我获取数据。`
                    : `I added a REST API data source "${newSource.name}", URL: ${addForm.url || '(pending)'}. Please help me fetch data.`)
                : (language === 'zh'
                    ? `我添加了一个文件数据源「${newSource.name}」，请帮我分析其中的数据。`
                    : `I added a file data source "${newSource.name}". Please help me analyze the data.`)

        sendToChat(prompt)
    }, [addForm, showAddForm, language, sendToChat])

    const statusColor = (status: DataSource['status']) => {
        if (status === 'connected') return 'text-green-400'
        if (status === 'error') return 'text-red-400'
        return 'text-text-muted'
    }

    const statusLabel = (status: DataSource['status']) => {
        if (status === 'connected') return language === 'zh' ? '已连接' : 'Connected'
        if (status === 'error') return language === 'zh' ? '错误' : 'Error'
        return language === 'zh' ? '未连接' : 'Disconnected'
    }

    const typeIcon = (type: DataSource['type']) => {
        if (type === 'database') return <Server className="w-3.5 h-3.5" />
        if (type === 'file') return <FileSpreadsheet className="w-3.5 h-3.5" />
        return <Cable className="w-3.5 h-3.5" />
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    {language === 'zh' ? '数据源' : 'DATA SOURCES'}
                </span>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={language === 'zh' ? '刷新' : 'Refresh'}>
                        <RefreshCw className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddForm('database')} title={language === 'zh' ? '添加数据源' : 'Add Source'}>
                        <Plus className="w-3 h-3" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {sources.map((source) => (
                    <div key={source.id}>
                        <button
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                            onClick={() => setExpandedId(expandedId === source.id ? null : source.id)}
                        >
                            {expandedId === source.id ? (
                                <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
                            ) : (
                                <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
                            )}
                            {typeIcon(source.type)}
                            <span className="text-sm text-text-primary flex-1 truncate">{source.name}</span>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${source.status === 'connected' ? 'bg-green-400' : source.status === 'error' ? 'bg-red-400' : 'bg-text-muted/30'}`} />
                        </button>

                        {expandedId === source.id && (
                            <div className="pl-8 pr-3 pb-2 space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-text-muted">{language === 'zh' ? '类型' : 'Type'}</span>
                                    <span className="text-text-secondary">{source.meta}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-text-muted">{language === 'zh' ? '状态' : 'Status'}</span>
                                    <span className={statusColor(source.status)}>{statusLabel(source.status)}</span>
                                </div>
                                {source.type === 'file' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-full text-xs gap-1 justify-start"
                                        onClick={handleBrowseFiles}
                                    >
                                        <FolderOpen className="w-3 h-3" />
                                        {language === 'zh' ? '浏览文件' : 'Browse Files'}
                                    </Button>
                                )}
                                {source.type === 'database' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-full text-xs gap-1 justify-start"
                                        onClick={() => toggleConnection(source.id)}
                                    >
                                        <Database className="w-3 h-3" />
                                        {source.status === 'connected'
                                            ? (language === 'zh' ? '断开连接' : 'Disconnect')
                                            : (language === 'zh' ? '连接' : 'Connect')}
                                    </Button>
                                )}
                                {source.type === 'api' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-full text-xs gap-1 justify-start"
                                        onClick={() => toggleConnection(source.id)}
                                    >
                                        <Cable className="w-3 h-3" />
                                        {source.status === 'connected'
                                            ? (language === 'zh' ? '断开连接' : 'Disconnect')
                                            : (language === 'zh' ? '连接' : 'Connect')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {showAddForm && (
                <div className="border-t border-border/30 p-3 space-y-2 bg-surface/30">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-primary">
                            {language === 'zh' ? '添加数据源' : 'Add Data Source'}
                        </span>
                        <button onClick={() => setShowAddForm(null)} className="text-text-muted hover:text-text-primary">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    <div className="flex gap-1">
                        {(['database', 'file', 'api'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setShowAddForm(t)}
                                className={`flex-1 text-[11px] py-1 rounded transition-colors ${showAddForm === t ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'}`}
                            >
                                {t === 'database' ? (language === 'zh' ? '数据库' : 'Database') : t === 'file' ? (language === 'zh' ? '文件' : 'File') : 'API'}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text"
                        value={addForm.name}
                        onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                        placeholder={language === 'zh' ? '名称' : 'Name'}
                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                    />

                    {showAddForm === 'database' && (
                        <>
                            <select
                                value={addForm.driver}
                                onChange={e => setAddForm(f => ({ ...f, driver: e.target.value }))}
                                className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary"
                            >
                                {DB_DRIVERS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                            </select>
                            {addForm.driver !== 'sqlite' && (
                                <>
                                    <div className="flex gap-1.5">
                                        <input
                                            type="text"
                                            value={addForm.host}
                                            onChange={e => setAddForm(f => ({ ...f, host: e.target.value }))}
                                            placeholder="Host"
                                            className="flex-1 h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                                        />
                                        <input
                                            type="text"
                                            value={addForm.port}
                                            onChange={e => setAddForm(f => ({ ...f, port: e.target.value }))}
                                            placeholder="Port"
                                            className="w-16 h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                                        />
                                    </div>
                                    <input
                                        type="text"
                                        value={addForm.database}
                                        onChange={e => setAddForm(f => ({ ...f, database: e.target.value }))}
                                        placeholder={language === 'zh' ? '数据库名' : 'Database'}
                                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                                    />
                                </>
                            )}
                        </>
                    )}

                    {showAddForm === 'api' && (
                        <input
                            type="text"
                            value={addForm.url}
                            onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
                            placeholder="https://api.example.com/data"
                            className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                        />
                    )}

                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 w-full text-xs gap-1"
                        onClick={handleAddSource}
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
                        onClick={() => setShowAddForm('database')}
                    >
                        <Plus className="w-3 h-3" />
                        {language === 'zh' ? '添加数据源' : 'Add Data Source'}
                    </Button>
                </div>
            )}
        </div>
    )
}
