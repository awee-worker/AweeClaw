import { useState, useCallback, useEffect } from 'react'
import { Database, FileSpreadsheet, Plus, RefreshCw, FolderOpen, ChevronRight, ChevronDown, Server, Cable, X, Check, Loader2, Trash2, Table2, Search } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { api } from '@services/electronBridge'

interface SchemaTable {
    name: string
    columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean; defaultValue?: string }>
}

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
    filePath?: string
    url?: string
    lastError?: string
    tableCount?: number
    schema?: SchemaTable[]
    schemaLoading?: boolean
}

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

    const [sources, setSources] = useState<DataSource[]>([
        { id: 'workspace', name: 'workspace', type: 'file', status: 'connected', meta: 'CSV / Excel / JSON' },
    ])
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [showAddForm, setShowAddForm] = useState<AddFormType>(null)
    const [addForm, setAddForm] = useState({ driver: 'sqlite', name: '', host: '', port: '5432', database: '', url: '', filePath: '', username: '', password: '' })
    const [connecting, setConnecting] = useState<string | null>(null)
    const [schemaFilter, setSchemaFilter] = useState('')

    const syncConnections = useCallback(async () => {
        try {
            const connections = await api.data.getConnections()
            setSources(prev => {
                const fileSources = prev.filter(s => s.type === 'file')
                const apiSources = prev.filter(s => s.type === 'api')
                const dbSources: DataSource[] = connections.map(c => ({
                    id: c.id,
                    name: c.id,
                    type: 'database' as const,
                    status: 'connected' as const,
                    meta: c.driver?.toUpperCase(),
                    driver: c.driver,
                    host: c.host,
                    port: c.port,
                    database: c.database,
                    filePath: c.filePath,
                }))
                return [...fileSources, ...apiSources, ...dbSources]
            })
        } catch {}
    }, [])

    useEffect(() => {
        syncConnections()
    }, [syncConnections])

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

    const loadSchema = useCallback(async (sourceId: string) => {
        setSources(prev => prev.map(s => s.id === sourceId ? { ...s, schemaLoading: true } : s))
        try {
            const result = await api.data.browseSchema({ connectionId: sourceId, filter: schemaFilter || undefined })
            if (result.success && result.data) {
                const tables = (result.data as { tables?: SchemaTable[]; totalTables?: number }).tables || []
                setSources(prev => prev.map(s => s.id === sourceId ? {
                    ...s,
                    schema: tables,
                    tableCount: tables.length,
                    schemaLoading: false,
                } : s))
            } else {
                setSources(prev => prev.map(s => s.id === sourceId ? { ...s, schemaLoading: false } : s))
            }
        } catch {
            setSources(prev => prev.map(s => s.id === sourceId ? { ...s, schemaLoading: false } : s))
        }
    }, [schemaFilter])

    const handleExpand = useCallback((sourceId: string) => {
        setExpandedId(prev => {
            const newExpanded = prev === sourceId ? null : sourceId
            if (newExpanded) {
                const source = sources.find(s => s.id === sourceId)
                if (source?.type === 'database' && source.status === 'connected' && !source.schema) {
                    loadSchema(sourceId)
                }
            }
            return newExpanded
        })
    }, [sources, loadSchema])

    const handleConnect = useCallback(async (source: DataSource) => {
        if (source.status === 'connected') {
            setConnecting(source.id)
            try {
                await api.data.disconnectDatabase(source.id)
                setSources(prev => prev.map(s => s.id === source.id ? {
                    ...s,
                    status: 'disconnected' as const,
                    schema: undefined,
                    tableCount: undefined,
                } : s))
            } catch (err) {
                setSources(prev => prev.map(s => s.id === source.id ? { ...s, status: 'error' as const, lastError: err instanceof Error ? err.message : String(err) } : s))
            } finally {
                setConnecting(null)
            }
            return
        }

        setConnecting(source.id)
        try {
            const config: Record<string, unknown> = {
                id: source.id,
                driver: source.driver || 'sqlite',
            }
            if (source.driver === 'sqlite') {
                config.filePath = source.filePath
            } else {
                config.host = source.host || 'localhost'
                config.port = source.port || 5432
                config.database = source.database
            }

            const result = await api.data.connectDatabase(config as Parameters<typeof api.data.connectDatabase>[0])
            if (result.success) {
                setSources(prev => prev.map(s => s.id === source.id ? { ...s, status: 'connected' as const, lastError: undefined } : s))
                const prompt = language === 'zh'
                    ? `已成功连接 ${source.meta} 数据源「${source.name}」，请帮我查看可用的表。`
                    : `Successfully connected to ${source.meta} data source "${source.name}". Please help me check available tables.`
                sendToChat(prompt)
                loadSchema(source.id)
            } else {
                setSources(prev => prev.map(s => s.id === source.id ? { ...s, status: 'error' as const, lastError: result.error } : s))
            }
        } catch (err) {
            setSources(prev => prev.map(s => s.id === source.id ? { ...s, status: 'error' as const, lastError: err instanceof Error ? err.message : String(err) } : s))
        } finally {
            setConnecting(null)
        }
    }, [language, sendToChat, loadSchema])

    const handleDelete = useCallback(async (sourceId: string) => {
        const source = sources.find(s => s.id === sourceId)
        if (source?.status === 'connected' && source.type === 'database') {
            try { await api.data.disconnectDatabase(sourceId) } catch {}
        }
        setSources(prev => prev.filter(s => s.id !== sourceId))
    }, [sources])

    const handleBrowseFiles = useCallback(() => {
        setActiveSidePanel('explorer')
    }, [setActiveSidePanel])

    const handleAddSource = useCallback(async () => {
        if (!addForm.name.trim()) return

        const sourceId = `ds_${Date.now()}`
        const newSource: DataSource = {
            id: sourceId,
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
            filePath: showAddForm === 'database' && addForm.driver === 'sqlite' ? addForm.filePath || undefined : undefined,
            url: showAddForm === 'api' ? addForm.url || undefined : undefined,
        }

        setSources(prev => [...prev, newSource])
        setShowAddForm(null)
        setAddForm({ driver: 'sqlite', name: '', host: '', port: '5432', database: '', url: '', filePath: '', username: '', password: '' })

        if (showAddForm === 'database') {
            const config: Record<string, unknown> = {
                id: sourceId,
                driver: addForm.driver,
            }
            if (addForm.driver === 'sqlite') {
                config.filePath = addForm.filePath
            } else {
                config.host = addForm.host || 'localhost'
                config.port = parseInt(addForm.port) || 5432
                config.database = addForm.database
                config.username = addForm.username
                config.password = addForm.password
            }

            setConnecting(sourceId)
            try {
                const result = await api.data.connectDatabase(config as Parameters<typeof api.data.connectDatabase>[0])
                if (result.success) {
                    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'connected' as const } : s))
                    const prompt = language === 'zh'
                        ? `我添加了一个 ${newSource.meta} 数据源「${newSource.name}」${newSource.host ? `，地址 ${newSource.host}:${newSource.port}` : ''}${newSource.database ? `，数据库 ${newSource.database}` : ''}，请帮我查看可用的表。`
                        : `I added a ${newSource.meta} data source "${newSource.name}"${newSource.host ? `, address ${newSource.host}:${newSource.port}` : ''}${newSource.database ? `, database ${newSource.database}` : ''}. Please help me check available tables.`
                    sendToChat(prompt)
                    loadSchema(sourceId)
                } else {
                    setSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'error' as const, lastError: result.error } : s))
                }
            } catch (err) {
                setSources(prev => prev.map(s => s.id === sourceId ? { ...s, status: 'error' as const, lastError: err instanceof Error ? err.message : String(err) } : s))
            } finally {
                setConnecting(null)
            }
        } else if (showAddForm === 'api') {
            const prompt = language === 'zh'
                ? `我添加了一个 REST API 数据源「${newSource.name}」，URL: ${addForm.url || '(待配置)'}，请帮我获取数据。`
                : `I added a REST API data source "${newSource.name}", URL: ${addForm.url || '(pending)'}. Please help me fetch data.`
            sendToChat(prompt)
        } else {
            const prompt = language === 'zh'
                ? `我添加了一个文件数据源「${newSource.name}」，请帮我分析其中的数据。`
                : `I added a file data source "${newSource.name}". Please help me analyze the data.`
            sendToChat(prompt)
        }
    }, [addForm, showAddForm, language, sendToChat, loadSchema])

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
                    <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={syncConnections} title={language === 'zh' ? '刷新' : 'Refresh'}>
                        <RefreshCw className="w-3 h-3" />
                    </ActionButton>
                    <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddForm('database')} title={language === 'zh' ? '添加数据源' : 'Add Source'}>
                        <Plus className="w-3 h-3" />
                    </ActionButton>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {sources.map((source) => (
                    <div key={source.id}>
                        <button
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                            onClick={() => handleExpand(source.id)}
                        >
                            {expandedId === source.id ? (
                                <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" />
                            ) : (
                                <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
                            )}
                            {typeIcon(source.type)}
                            <span className="text-sm text-text-primary flex-1 truncate">{source.name}</span>
                            {source.tableCount != null && source.status === 'connected' && (
                                <span className="text-[10px] text-text-muted flex-shrink-0">{source.tableCount} {language === 'zh' ? '表' : 'tbl'}</span>
                            )}
                            {connecting === source.id && <Loader2 className="w-3 h-3 text-accent animate-spin flex-shrink-0" />}
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
                                {source.host && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-text-muted">{language === 'zh' ? '地址' : 'Host'}</span>
                                        <span className="text-text-secondary">{source.host}{source.port ? `:${source.port}` : ''}</span>
                                    </div>
                                )}
                                {source.database && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-text-muted">{language === 'zh' ? '数据库' : 'Database'}</span>
                                        <span className="text-text-secondary">{source.database}</span>
                                    </div>
                                )}
                                {source.lastError && (
                                    <div className="text-[11px] text-red-400 break-all">{source.lastError}</div>
                                )}
                                {source.type === 'file' && (
                                    <ActionButton
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-full text-xs gap-1 justify-start"
                                        onClick={handleBrowseFiles}
                                    >
                                        <FolderOpen className="w-3 h-3" />
                                        {language === 'zh' ? '浏览文件' : 'Browse Files'}
                                    </ActionButton>
                                )}
                                {source.type === 'database' && source.id !== 'workspace' && (
                                    <>
                                        <div className="flex gap-1">
                                            <ActionButton
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 flex-1 text-xs gap-1 justify-start"
                                                onClick={() => handleConnect(source)}
                                                disabled={connecting === source.id}
                                            >
                                                <Database className="w-3 h-3" />
                                                {source.status === 'connected'
                                                    ? (language === 'zh' ? '断开连接' : 'Disconnect')
                                                    : (language === 'zh' ? '连接' : 'Connect')}
                                            </ActionButton>
                                            {source.status === 'connected' && (
                                                <ActionButton
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0"
                                                    onClick={() => loadSchema(source.id)}
                                                    disabled={source.schemaLoading}
                                                    title={language === 'zh' ? '刷新Schema' : 'Refresh Schema'}
                                                >
                                                    <RefreshCw className={`w-3 h-3 ${source.schemaLoading ? 'animate-spin' : ''}`} />
                                                </ActionButton>
                                            )}
                                            {source.status !== 'connected' && (
                                                <ActionButton
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                                                    onClick={() => handleDelete(source.id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </ActionButton>
                                            )}
                                        </div>
                                        {source.status === 'connected' && source.schema && source.schema.length > 0 && (
                                            <div className="space-y-1 mt-1">
                                                <div className="flex items-center gap-1">
                                                    <Search className="w-2.5 h-2.5 text-text-muted" />
                                                    <input
                                                        type="text"
                                                        value={schemaFilter}
                                                        onChange={e => setSchemaFilter(e.target.value)}
                                                        placeholder={language === 'zh' ? '筛选表...' : 'Filter tables...'}
                                                        className="flex-1 h-5 px-1.5 text-[11px] bg-background border border-border/30 rounded focus:outline-none focus:border-accent/40 text-text-primary placeholder:text-text-muted/70"
                                                    />
                                                </div>
                                                <div className="max-h-40 overflow-y-auto space-y-0.5">
                                                    {source.schema
                                                        .filter(t => !schemaFilter || t.name.toLowerCase().includes(schemaFilter.toLowerCase()))
                                                        .map(table => (
                                                        <button
                                                            key={table.name}
                                                            className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-surface-hover transition-colors text-left"
                                                            onClick={() => sendToChat(language === 'zh'
                                                                ? `请查询 ${source.name} 数据源中表 ${table.name} 的数据，限制10行。列: ${table.columns.map(c => `${c.name}(${c.type})`).join(', ')}`
                                                                : `Please query table ${table.name} from ${source.name} data source, limit 10 rows. Columns: ${table.columns.map(c => `${c.name}(${c.type})`).join(', ')}`
                                                            )}
                                                        >
                                                            <Table2 className="w-2.5 h-2.5 text-accent/60 flex-shrink-0" />
                                                            <span className="text-[11px] text-text-secondary truncate flex-1">{table.name}</span>
                                                            <span className="text-[9px] text-text-muted">{table.columns.length}{language === 'zh' ? '列' : 'col'}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {source.status === 'connected' && source.schemaLoading && (
                                            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                {language === 'zh' ? '加载Schema...' : 'ProgressIndicator schema...'}
                                            </div>
                                        )}
                                    </>
                                )}
                                {source.type === 'api' && source.id !== 'workspace' && (
                                    <div className="flex gap-1">
                                        <ActionButton
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 flex-1 text-xs gap-1 justify-start"
                                            onClick={() => {
                                                if (source.url) {
                                                    sendToChat(language === 'zh'
                                                        ? `请帮我请求 API: ${source.url}`
                                                        : `Please help me fetch data from API: ${source.url}`)
                                                }
                                            }}
                                        >
                                            <Cable className="w-3 h-3" />
                                            {language === 'zh' ? '请求数据' : 'Fetch Data'}
                                        </ActionButton>
                                        <ActionButton
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-text-muted hover:text-red-400"
                                            onClick={() => handleDelete(source.id)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </ActionButton>
                                    </div>
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
                            {addForm.driver === 'sqlite' ? (
                                <input
                                    type="text"
                                    value={addForm.filePath}
                                    onChange={e => setAddForm(f => ({ ...f, filePath: e.target.value }))}
                                    placeholder={language === 'zh' ? '数据库文件路径' : 'Database file path'}
                                    className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                                />
                            ) : (
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
                                    <input
                                        type="text"
                                        value={addForm.username}
                                        onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))}
                                        placeholder={language === 'zh' ? '用户名' : 'Username'}
                                        className="w-full h-7 px-2 text-xs bg-background border border-border/50 rounded focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
                                    />
                                    <input
                                        type="password"
                                        value={addForm.password}
                                        onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                                        placeholder={language === 'zh' ? '密码' : 'Password'}
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

                    <ActionButton
                        variant="secondary"
                        size="sm"
                        className="h-7 w-full text-xs gap-1"
                        onClick={handleAddSource}
                        disabled={!addForm.name.trim() || (showAddForm === 'database' && addForm.driver === 'sqlite' && !addForm.filePath.trim())}
                    >
                        <Check className="w-3 h-3" />
                        {language === 'zh' ? '添加并连接' : 'Add & Connect'}
                    </ActionButton>
                </div>
            )}

            {!showAddForm && (
                <div className="px-3 py-2 border-t border-border/30">
                    <ActionButton
                        variant="ghost"
                        size="sm"
                        className="h-7 w-full text-xs gap-1.5"
                        onClick={() => setShowAddForm('database')}
                    >
                        <Plus className="w-3 h-3" />
                        {language === 'zh' ? '添加数据源' : 'Add Data Source'}
                    </ActionButton>
                </div>
            )}
        </div>
    )
}
