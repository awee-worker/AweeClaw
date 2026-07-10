/**
 * 系统设置组件
 */

import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { useState, useEffect, useRef } from 'react'
import { HardDrive, AlertTriangle, Download, Upload, FileText, ExternalLink, Terminal, Globe } from 'lucide-react'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { ActionButton, ToggleSwitch } from '@components/ui'
import {Language, t} from '@renderer/i18n'
import { useStore } from '@store'
import { downloadSettings, importSettings } from '../../../settings/configMigration'
import { settingsService } from '../../../settings/preferencesService'
import { Agent } from '@intelligence/engine'
import { memoryService } from '@intelligence/runtime/recallService'
import type { ProviderModelConfig, SettingsState } from '@shared/configuration/preferenceSync'
import { DEFAULT_SCENARIO_PREFERENCES } from '@shared/configuration/preferenceSchema'

interface SystemSettingsProps {
    language: Language
    enableFileLogging: boolean
    setEnableFileLogging: (enabled: boolean) => void
}

function DataPathDisplay() {
    const [path, setPath] = useState('')
    useEffect(() => {
        // @ts-ignore
        api.settings.getConfigPath?.().then(setPath)
    }, [])
    return <span>{path || '...'}</span>
}

function PythonEnvSection({ language }: { language: Language }) {
    const [pythonStatus, setPythonStatus] = useState<{
        ready: boolean
        pythonPath: string | null
        uvPath: string | null
        source: 'system' | 'managed' | 'none'
        version: string | null
        venvDir: string | null
        installedPackages: string[]
        error?: string
    } | null>(null)
    const [isReinstalling, setIsReinstalling] = useState(false)

    useEffect(() => {
        api.python.getStatus().then(setPythonStatus).catch(() => {})
    }, [])

    const handleReinstall = async () => {
        setIsReinstalling(true)
        try {
            const status = await api.python.reinstall()
            setPythonStatus(status)
            if (status.ready) {
                toast.success(t('settings.pythonenvironmentreinstalled', language as Language))
            } else {
                toast.error(t('settings.pythonenvironmentinstallationfailed', language as Language))
            }
        } catch (err) {
            toast.error(t('settings.reinstallfailed', language as Language))
        } finally {
            setIsReinstalling(false)
        }
    }

    const handleSetCustomPath = async () => {
        const result = await api.file.selectFolder()
        if (result) {
            const pythonBin = result.endsWith('python3') || result.endsWith('python') || result.endsWith('python.exe')
                ? result
                : `${result}/bin/python3`
            const res = await api.python.setCustomPath(pythonBin)
            if (res.success) {
                const status = await api.python.getStatus()
                setPythonStatus(status)
                toast.success(t('settings.pythonpathupdated', language as Language))
            }
        }
    }

    return (
        <section>
            <div className="flex items-center gap-2 mb-5 ml-1">
                <Terminal className="w-4 h-4 text-accent" />
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                    {t('settings.pythonenvironment', language as Language)}
                </h4>
            </div>
            <div className="space-y-4">
                <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold text-text-primary">
                                {t('settings.pythonruntime', language as Language)}
                            </div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {t('settings.aiagentscriptexecutionpython', language as Language)}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${pythonStatus?.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-xs font-medium text-text-secondary">
                                {pythonStatus?.ready
                                    ? (t('settings.ready', language as Language))
                                    : (t('settings.notready', language as Language))}
                            </span>
                        </div>
                    </div>

                    {pythonStatus && (
                        <div className="space-y-2 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                            {pythonStatus.version && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">Python:</span>
                                    <span className="text-text-secondary font-mono">{pythonStatus.version}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted border border-border">
                                        {pythonStatus.source === 'system' ? (t('settings.system2', language as Language)) : 'uv'}
                                    </span>
                                </div>
                            )}
                            {pythonStatus.pythonPath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">{t('settings.path', language as Language)}</span>
                                    <span className="text-text-secondary font-mono break-all">{pythonStatus.pythonPath}</span>
                                </div>
                            )}
                            {pythonStatus.uvPath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">uv:</span>
                                    <span className="text-text-secondary font-mono break-all">{pythonStatus.uvPath}</span>
                                </div>
                            )}
                            {pythonStatus.installedPackages.length > 0 && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">{t('settings.packages', language as Language)}</span>
                                    <span className="text-text-secondary font-mono">{pythonStatus.installedPackages.join(', ')}</span>
                                </div>
                            )}
                            {pythonStatus.error && (
                                <div className="flex items-start gap-2 text-xs text-red-400 mt-2">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <span>{pythonStatus.error}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {!pythonStatus?.ready && (
                        <div className="flex items-start gap-2 text-[11px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                                {t('settings.pythonisnotavailableai', language as Language)}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleReinstall}
                            disabled={isReinstalling}
                            className="rounded-xl px-4"
                        >
                            {isReinstalling
                                ? (t('settings.installing', language as Language))
                                : (t('settings.reinstall', language as Language))}
                        </ActionButton>
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleSetCustomPath}
                            className="rounded-xl px-4"
                        >
                            {t('settings.setpythonpath', language as Language)}
                        </ActionButton>
                    </div>
                </div>
            </div>
        </section>
    )
}

function NodeEnvSection({ language }: { language: Language }) {
    const [nodeStatus, setNodeStatus] = useState<{
        ready: boolean
        nodePath: string | null
        npmPath: string | null
        npxPath: string | null
        source: 'system' | 'managed' | 'none'
        version: string | null
        nodeDir: string | null
        binDir: string | null
        installedPackages: string[]
        error?: string
    } | null>(null)
    const [isReinstalling, setIsReinstalling] = useState(false)

    useEffect(() => {
        // @ts-ignore - node API 可能未在类型声明中
        api.node?.getStatus().then(setNodeStatus).catch(() => {})
    }, [])

    const handleReinstall = async () => {
        setIsReinstalling(true)
        try {
            // @ts-ignore
            const status = await api.node.reinstall()
            setNodeStatus(status)
            if (status.ready) {
                toast.success(t('settings.nodeenvironmentreinstalled', language as Language) || 'Node.js environment reinstalled')
            } else {
                toast.error(t('settings.nodeenvironmentinstallationfailed', language as Language) || 'Node.js installation failed')
            }
        } catch (err) {
            toast.error(t('settings.reinstallfailed', language as Language))
        } finally {
            setIsReinstalling(false)
        }
    }

    const handleSetCustomPath = async () => {
        const result = await api.file.selectFolder()
        if (result) {
            const nodeBin = result.endsWith('node') || result.endsWith('node.exe')
                ? result
                : `${result}/bin/node`
            // @ts-ignore
            const res = await api.node.setCustomPath(nodeBin)
            if (res.success) {
                // @ts-ignore
                const status = await api.node.getStatus()
                setNodeStatus(status)
                toast.success(t('settings.nodepathupdated', language as Language) || 'Node.js path updated')
            }
        }
    }

    return (
        <section>
            <div className="flex items-center gap-2 mb-5 ml-1">
                <Terminal className="w-4 h-4 text-accent" />
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                    {t('settings.nodeenvironment', language as Language) || 'Node.js Environment'}
                </h4>
            </div>
            <div className="space-y-4">
                <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold text-text-primary">
                                {t('settings.noderuntime', language as Language) || 'Node.js Runtime'}
                            </div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {t('settings.aiagentscriptexecutionnode', language as Language) || 'For AI agent script execution and MCP plugin startup'}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${nodeStatus?.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-xs font-medium text-text-secondary">
                                {nodeStatus?.ready
                                    ? (t('settings.ready', language as Language))
                                    : (t('settings.notready', language as Language))}
                            </span>
                        </div>
                    </div>

                    {nodeStatus && (
                        <div className="space-y-2 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                            {nodeStatus.version && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">Node:</span>
                                    <span className="text-text-secondary font-mono">{nodeStatus.version}</span>
                                    <span className="text-[12px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted border border-border">
                                        {nodeStatus.source === 'system'
                                            ? (t('settings.system2', language as Language))
                                            : (t('settings.managed', language as Language) || 'Managed')}
                                    </span>
                                </div>
                            )}
                            {nodeStatus.nodePath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">{t('settings.path', language as Language)}</span>
                                    <span className="text-text-secondary font-mono break-all">{nodeStatus.nodePath}</span>
                                </div>
                            )}
                            {nodeStatus.npmPath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">npm:</span>
                                    <span className="text-text-secondary font-mono break-all">{nodeStatus.npmPath}</span>
                                </div>
                            )}
                            {nodeStatus.npxPath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">npx:</span>
                                    <span className="text-text-secondary font-mono break-all">{nodeStatus.npxPath}</span>
                                </div>
                            )}
                            {nodeStatus.installedPackages.length > 0 && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">{t('settings.packages', language as Language)}</span>
                                    <span className="text-text-secondary font-mono">{nodeStatus.installedPackages.join(', ')}</span>
                                </div>
                            )}
                            {nodeStatus.error && (
                                <div className="flex items-start gap-2 text-xs text-red-400 mt-2">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <span>{nodeStatus.error}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {!nodeStatus?.ready && (
                        <div className="flex items-start gap-2 text-[12px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                                {t('settings.nodeisnotavailableai', language as Language) || 'Node.js is not available. AI Node.js script execution and some MCP plugins will be unavailable. Click reinstall to auto-download.'}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleReinstall}
                            disabled={isReinstalling}
                            className="rounded-xl px-4"
                        >
                            {isReinstalling
                                ? (t('settings.installing', language as Language))
                                : (t('settings.reinstall', language as Language))}
                        </ActionButton>
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleSetCustomPath}
                            className="rounded-xl px-4"
                        >
                            {t('settings.setnodepath', language as Language) || 'Set Node Path'}
                        </ActionButton>
                    </div>
                </div>
            </div>
        </section>
    )
}

export function SystemPreferencesPanel({ language, enableFileLogging, setEnableFileLogging }: SystemSettingsProps) {
    const [isClearing, setIsClearing] = useState(false)
    const [includeApiKeys, setIncludeApiKeys] = useState(false)
    const [logPath, setLogPath] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const getStore = () => useStore.getState()
    const browserMode = useStore(s => s.browserMode)

    // 获取日志文件路径
    useEffect(() => {
        const getLogPath = async () => {
            try {
                const userDataPath = await api.settings.getUserDataPath()
                if (userDataPath) {
                    setLogPath(`${userDataPath}/logs/main.log`)
                }
            } catch (err) {
                logger.settings.error('Failed to get log path:', err)
            }
        }
        getLogPath()
    }, [])

    const handleToggleFileLogging = (enabled: boolean) => {
        setEnableFileLogging(enabled)
    }

    // 构建当前设置对象（直接从 settingsService 缓存获取）
    const getCurrentSettings = (): SettingsState => {
        const cached = settingsService.getCache()
        if (cached) return cached

        // 如果缓存不存在，从 store 构建
        return {
            llmConfig: getStore().llmConfig,
            language: getStore().language,
            autoApprove: getStore().autoApprove,
            promptTemplateId: getStore().promptTemplateId,
            activeScenarioId: getStore().activeScenarioId,
            providerConfigs: getStore().providerConfigs,
            agentConfig: getStore().agentConfig,
            editorConfig: getStore().editorConfig,
            securitySettings: getStore().securitySettings,
            webSearchConfig: getStore().webSearchConfig,
            mcpConfig: getStore().mcpConfig,
            emailConfig: getStore().emailConfig,
            aiInstructions: getStore().aiInstructions,
            onboardingCompleted: getStore().onboardingCompleted,
            enableFileLogging: getStore().enableFileLogging,
            browserMode: getStore().browserMode,
            scenarioPreferences: getStore().scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES,
            privacySettings: getStore().privacySettings,
        }
    }

    const handleExport = () => {
        try {
            downloadSettings(getCurrentSettings(), includeApiKeys)
            toast.success(t('settings.settingsexported', language as Language))
        } catch (error) {
            logger.settings.error('Failed to export settings:', error)
            toast.error(t('settings.exportfailed', language as Language))
        }
    }

    const handleImport = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        try {
            const text = await file.text()
            const result = importSettings(text)

            if (!result.success || !result.settings) {
                toast.error(result.error || (t('settings.importfailed', language as Language)))
                return
            }

            const settings = result.settings

            // 应用导入的设置
            if (settings.language) getStore().set('language', settings.language as 'en' | 'zh')
            if (settings.autoApprove) getStore().set('autoApprove', settings.autoApprove)
            if (settings.promptTemplateId) getStore().set('promptTemplateId', settings.promptTemplateId)
            if (settings.agentConfig) getStore().set('agentConfig', settings.agentConfig)
            if (settings.aiInstructions !== undefined) getStore().set('aiInstructions', settings.aiInstructions)

            // 应用 provider 配置
            if (settings.providerConfigs) {
                for (const [id, config] of Object.entries(settings.providerConfigs)) {
                    getStore().setProvider(id, config as ProviderModelConfig)
                }
            }

            // 应用 LLM 配置
            if (settings.llmConfig) {
                getStore().update('llmConfig', {
                    provider: settings.llmConfig.provider || getStore().llmConfig.provider,
                    model: settings.llmConfig.model || getStore().llmConfig.model,
                })
            }

            // 保存设置到持久化存储
            await getStore().save()

            toast.success(t('settings.settingsimported', language as Language))
        } catch (error) {
            logger.settings.error('Failed to import settings:', error)
            toast.error(t('settings.importfailed2', language as Language))
        }

        // 清空 input
        e.target.value = ''
    }

    const handleClearCache = async () => {
        setIsClearing(true)
        try {
            // 1. 清除 localStorage 缓存
            const keysToRemove = ['editor-config', 'workspace', 'sessions', 'threads']
            keysToRemove.forEach(key => StorageService.remove(key))

            // 2. 清除代码库索引
            const wsPath = getStore().workspacePath
            if (wsPath) {
                try {
                    await api.index.clear(wsPath)
                } catch (e) { logger.index.warn('Failed to clear index:', e) }
            }

            // 3. 清除持久化编辑器配置
            await api.settings.set('editorConfig', undefined)

            // 4. 清除 Agent 文件读取缓存
            Agent.clearSession()

            // 5. 清除 Memory 服务缓存
            memoryService.clearCache()

            toast.success(t('settings.cachecleared', language as Language))
        } catch (error) {
            logger.settings.error('Failed to clear cache:', error)
            toast.error(t('settings.failedtoclearcache', language as Language))
        } finally {
            setIsClearing(false)
        }
    }

    const handleReset = async () => {
        const confirmed = await globalConfirm({
            title: t('settings.resetsettings', language as Language),
            message: t('settings.areyousureyouwant', language as Language),
            variant: 'danger',
        })
        if (confirmed) {
            // 清除所有持久化数据
            await api.settings.set('app-settings', undefined)
            await api.settings.set('editorConfig', undefined)
            await api.settings.set('securitySettings', undefined)
            await api.settings.set('themeId', undefined)
            StorageService.clearAll()
            window.location.reload()
        }
    }

    const handleOpenLogFile = async () => {
        try {
            if (logPath) {
                await api.file.showInFolder(logPath)
            }
        } catch (err) {
            logger.settings.error('Failed to open log file:', err)
            toast.error(t('settings.failedtoopenlogfile', language as Language))
        }
    }

    const handleExportLogs = async () => {
        try {
            const logs = await api.settings.getRecentLogs()
            if (logs) {
                const blob = new Blob([logs], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `aweeclaw-logs-${new Date().toISOString().slice(0, 10)}.log`
                a.click()
                URL.revokeObjectURL(url)
                toast.success(t('settings.logsexported', language as Language))
            } else {
                toast.error(t('settings.nologstoexport', language as Language))
            }
        } catch (err) {
            logger.settings.error('Failed to export logs:', err)
            toast.error(t('settings.failedtoexportlogs', language as Language))
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <HardDrive className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.storagecache', language as Language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{t('settings.configstoragepath', language as Language)}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('settings.storagelocationforallconfig', language as Language)}
                                </div>
                            </div>
                            <ActionButton variant="secondary" size="sm" className="rounded-xl px-4" onClick={async () => {
                                const newPath = await api.file.selectFolder()
                                if (newPath) {
                                    // @ts-ignore
                                    const success = await api.settings.setConfigPath?.(newPath)
                                    if (success) {
                                        toast.success(t('settings.pathupdatedrestartrequiredto', language as Language))
                                    } else {
                                        toast.error(t('settings.failedtoupdatepath', language as Language))
                                    }
                                }
                            }}>
                                {t('settings.changepath', language as Language)}
                            </ActionButton>
                        </div>

                        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                            <div className="p-1.5 bg-white/5 rounded-lg">
                                <HardDrive className="w-4 h-4 text-text-muted" />
                            </div>
                            <div className="text-xs text-text-secondary font-mono break-all opacity-90">
                                <DataPathDisplay />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {t('settings.restartapplicationmanuallyafterchanging', language as Language)}
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{t('settings.clearcache', language as Language)}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">{t('settings.cleareditorcacheindexdata', language as Language)}</div>
                        </div>
                        <ActionButton variant="secondary" size="sm" onClick={handleClearCache} disabled={isClearing} className="rounded-xl px-6">
                            {isClearing ? (t('settings.clearing', language as Language)) : (t('settings.clear', language as Language))}
                        </ActionButton>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-red-500/10 rounded-2xl border border-red-500/20 shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-red-400">{t('settings.resetallsettings', language as Language)}</div>
                            <div className="text-xs text-red-400/70 mt-1">{t('settings.restorefactorysettingsirreversible', language as Language)}</div>
                        </div>
                        <ActionButton variant="danger" size="sm" onClick={handleReset} className="rounded-xl px-6">
                            {t('settings.reset', language as Language)}
                        </ActionButton>
                    </div>
                </div>
            </section>

            {/* Python 环境 */}
            <PythonEnvSection language={language} />
            <NodeEnvSection language={language} />

            {/* 日志管理 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <FileText className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.logmanagement', language as Language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {t('settings.enablefilelogging', language as Language)}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('settings.saveapplicationlogstofile', language as Language)}
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={enableFileLogging}
                                onChange={(e) => handleToggleFileLogging(e.target.checked)}
                            />
                        </div>

                        {enableFileLogging && (
                            <>
                                <div>
                                    <div className="text-sm font-bold text-text-primary mb-3">
                                        {t('settings.logfilelocation', language as Language)}
                                    </div>
                                    {logPath && (
                                        <div className="flex items-center gap-3 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                                            <div className="p-1.5 bg-white/5 rounded-lg">
                                                <FileText className="w-4 h-4 text-text-muted" />
                                            </div>
                                            <div className="text-xs text-text-secondary font-mono break-all opacity-90 flex-1">
                                                {logPath}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <ActionButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleOpenLogFile}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                        {t('settings.openlogfile', language as Language)}
                                    </ActionButton>
                                    <ActionButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleExportLogs}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <Download className="w-3.5 h-3.5 mr-1.5" />
                                        {t('settings.exportlogs', language as Language)}
                                    </ActionButton>
                                </div>

                                <div className="flex items-start gap-2 text-[11px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <div>
                                        {t('settings.logfilesrotateautomaticallykeeping', language as Language)}
                                    </div>
                                </div>
                            </>
                        )}

                        {!enableFileLogging && (
                            <div className="flex items-start gap-2 text-[11px] font-medium text-text-muted bg-white/5 px-3 py-2 rounded-lg border border-border">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <div>
                                    {t('settings.fileloggingisdisabledenable', language as Language)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 浏览器设置 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Globe className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.browser', language as Language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {t('settings.linkopenmode', language as Language)}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('settings.choosewhichbrowsertouse', language as Language)}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => useStore.getState().set('browserMode', 'internal')}
                                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                                    browserMode === 'internal'
                                        ? 'border-accent bg-accent/5 shadow-sm'
                                        : 'border-border hover:border-border/80 hover:bg-surface/30'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Globe className={`w-4 h-4 ${browserMode === 'internal' ? 'text-accent' : 'text-text-muted'}`} />
                                    <span className={`text-sm font-semibold ${browserMode === 'internal' ? 'text-accent' : 'text-text-primary'}`}>
                                        {t('settings.internalbrowser', language as Language)}
                                    </span>
                                </div>
                                <p className="text-[11px] text-text-muted leading-relaxed">
                                    {t('settings.openlinksinthebuiltin', language as Language)}
                                </p>
                            </button>
                            <button
                                onClick={() => useStore.getState().set('browserMode', 'external')}
                                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                                    browserMode === 'external'
                                        ? 'border-accent bg-accent/5 shadow-sm'
                                        : 'border-border hover:border-border/80 hover:bg-surface/30'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <ExternalLink className={`w-4 h-4 ${browserMode === 'external' ? 'text-accent' : 'text-text-muted'}`} />
                                    <span className={`text-sm font-semibold ${browserMode === 'external' ? 'text-accent' : 'text-text-primary'}`}>
                                        {t('settings.externalbrowser', language as Language)}
                                    </span>
                                </div>
                                <p className="text-[11px] text-text-muted leading-relaxed">
                                    {t('settings.openlinksinthesystem', language as Language)}
                                </p>
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* 配置导出/导入 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Download className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.settingsbackup', language as Language)}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{t('settings.exportsettings', language as Language)}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {t('settings.exportcurrentsettingstojson', language as Language)}
                                </div>
                            </div>
                            <ActionButton variant="secondary" size="sm" onClick={handleExport} className="rounded-xl px-4">
                                <Download className="w-3.5 h-3.5 mr-1.5" />
                                {t('settings.export', language as Language)}
                            </ActionButton>
                        </div>

                        <div className="flex items-center justify-between py-2">
                            <div className="text-xs text-text-muted">
                                {t('settings.includeapikeysnotrecommended', language as Language)}
                            </div>
                            <ToggleSwitch
                                checked={includeApiKeys}
                                onChange={(e) => setIncludeApiKeys(e.target.checked)}
                            />
                        </div>

                        {includeApiKeys && (
                            <div className="flex items-center gap-2 text-[11px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {t('settings.exportedfilewillcontainsensitive', language as Language)}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{t('settings.importsettings', language as Language)}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {t('settings.importsettingsfromjsonfile', language as Language)}
                            </div>
                        </div>
                        <ActionButton variant="secondary" size="sm" onClick={handleImport} className="rounded-xl px-4">
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                            {t('settings.import', language as Language)}
                        </ActionButton>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>
                </div>
            </section>
        </div>
    )
}
