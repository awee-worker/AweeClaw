import { useState } from 'react'
import { Database, FileSpreadsheet, Plus, RefreshCw, FolderOpen, ChevronRight, ChevronDown, Server, Cable } from 'lucide-react'
import { useStore } from '@store'
import { Button } from '../../ui'

interface DataSource {
    id: string
    name: string
    type: 'database' | 'file' | 'api'
    status: 'connected' | 'disconnected' | 'error'
    meta?: string
}

const DEMO_SOURCES: DataSource[] = [
    { id: '1', name: 'workspace', type: 'file', status: 'connected', meta: 'CSV / Excel / JSON' },
    { id: '2', name: 'SQLite Local', type: 'database', status: 'disconnected', meta: 'SQLite' },
    { id: '3', name: 'PostgreSQL', type: 'database', status: 'disconnected', meta: 'postgresql' },
    { id: '4', name: 'REST API', type: 'api', status: 'disconnected', meta: 'HTTP Endpoint' },
]

export function DataSourceView() {
    const language = useStore(s => s.language)
    const [sources] = useState<DataSource[]>(DEMO_SOURCES)
    const [expandedId, setExpandedId] = useState<string | null>(null)

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
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={language === 'zh' ? '添加数据源' : 'Add Source'}>
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
                                    >
                                        <Database className="w-3 h-3" />
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

            <div className="px-3 py-2 border-t border-border/30">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-xs gap-1.5"
                >
                    <Plus className="w-3 h-3" />
                    {language === 'zh' ? '添加数据源' : 'Add Data Source'}
                </Button>
            </div>
        </div>
    )
}
