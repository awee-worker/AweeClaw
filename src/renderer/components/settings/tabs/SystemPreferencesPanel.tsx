/**
 * 系统设置组件
 */

import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useState, useEffect, useRef } from 'react'
import { HardDrive, AlertTriangle, Download, Upload, FileText, ExternalLink, Terminal } from 'lucide-react'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { ActionButton, ToggleSwitch } from '@components/ui'
import { Language } from '@renderer/i18n'
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
                toast.success(language === 'zh' ? 'Python 环境已重新安装' : 'Python environment reinstalled')
            } else {
                toast.error(language === 'zh' ? 'Python 环境安装失败' : 'Python environment installation failed')
            }
        } catch (err) {
            toast.error(language === 'zh' ? '重新安装失败' : 'Reinstall failed')
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
                toast.success(language === 'zh' ? 'Python 路径已更新' : 'Python path updated')
            }
        }
    }

    return (
        <section>
            <div className="flex items-center gap-2 mb-5 ml-1">
                <Terminal className="w-4 h-4 text-accent" />
                <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                    {language === 'zh' ? 'Python 环境' : 'Python Environment'}
                </h4>
            </div>
            <div className="space-y-4">
                <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold text-text-primary">
                                {language === 'zh' ? 'Python 运行时' : 'Python Runtime'}
                            </div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {language === 'zh'
                                    ? 'AI Agent 脚本执行、Python LSP、调试器等功能依赖 Python 环境'
                                    : 'AI Agent script execution, Python LSP, debugger, etc. depend on Python'}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${pythonStatus?.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-xs font-medium text-text-secondary">
                                {pythonStatus?.ready
                                    ? (language === 'zh' ? '已就绪' : 'Ready')
                                    : (language === 'zh' ? '未就绪' : 'Not Ready')}
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
                                        {pythonStatus.source === 'system' ? (language === 'zh' ? '系统' : 'System') : 'uv'}
                                    </span>
                                </div>
                            )}
                            {pythonStatus.pythonPath && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">{language === 'zh' ? '路径:' : 'Path:'}</span>
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
                                    <span className="text-text-muted w-20">{language === 'zh' ? '已安装包:' : 'Packages:'}</span>
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
                                {language === 'zh'
                                    ? 'Python 环境不可用。AI Agent 执行 Python 脚本、Python 调试和 Lint 功能将无法使用。点击"重新安装"自动配置 Python 环境。'
                                    : 'Python is not available. AI Agent Python scripts, debugging, and lint features will be unavailable. Click "Reinstall" to auto-configure Python.'}
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
                                ? (language === 'zh' ? '安装中...' : 'Installing...')
                                : (language === 'zh' ? '重新安装' : 'Reinstall')}
                        </ActionButton>
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleSetCustomPath}
                            className="rounded-xl px-4"
                        >
                            {language === 'zh' ? '指定 Python 路径' : 'Set Python Path'}
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
            aiInstructions: getStore().aiInstructions,
            onboardingCompleted: getStore().onboardingCompleted,
            enableFileLogging: getStore().enableFileLogging,
            scenarioPreferences: getStore().scenarioPreferences ?? DEFAULT_SCENARIO_PREFERENCES,
        }
    }

    const handleExport = () => {
        try {
            downloadSettings(getCurrentSettings(), includeApiKeys)
            toast.success(language === 'zh' ? '配置已导出' : 'Settings exported')
        } catch (error) {
            logger.settings.error('Failed to export settings:', error)
            toast.error(language === 'zh' ? '导出失败' : 'Export failed')
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
                toast.error(result.error || (language === 'zh' ? '导入失败' : 'Import failed'))
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

            toast.success(language === 'zh' ? '配置已导入' : 'Settings imported')
        } catch (error) {
            logger.settings.error('Failed to import settings:', error)
            toast.error(language === 'zh' ? '导入失败' : 'Import failed')
        }

        // 清空 input
        e.target.value = ''
    }

    const handleClearCache = async () => {
        setIsClearing(true)
        try {
            // 1. 清除 localStorage 缓存
            const keysToRemove = ['aweeclaw-editor-config', 'aweeclaw-workspace', 'aweeclaw-sessions', 'aweeclaw-threads']
            keysToRemove.forEach(key => localStorage.removeItem(key))

            // 2. 清除代码库索引
            const wsPath = getStore().workspacePath
            if (wsPath) {
                try {
                    await api.index.clear(wsPath)
                } catch { }
            }

            // 3. 清除持久化编辑器配置
            await api.settings.set('editorConfig', undefined)

            // 4. 清除 Agent 文件读取缓存
            Agent.clearSession()

            // 5. 清除 Memory 服务缓存
            memoryService.clearCache()

            toast.success(language === 'zh' ? '缓存已清除' : 'Cache cleared')
        } catch (error) {
            logger.settings.error('Failed to clear cache:', error)
            toast.error(language === 'zh' ? '清除缓存失败' : 'Failed to clear cache')
        } finally {
            setIsClearing(false)
        }
    }

    const handleReset = async () => {
        const confirmed = await globalConfirm({
            title: language === 'zh' ? '重置设置' : 'Reset Settings',
            message: language === 'zh' ? '确定要重置所有设置吗？这将丢失所有自定义配置。' : 'Are you sure you want to reset all settings? This will lose all custom configurations.',
            variant: 'danger',
        })
        if (confirmed) {
            // 清除所有持久化数据
            await api.settings.set('app-settings', undefined)
            await api.settings.set('editorConfig', undefined)
            await api.settings.set('securitySettings', undefined)
            await api.settings.set('themeId', undefined)
            localStorage.clear()
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
            toast.error(language === 'zh' ? '打开日志文件失败' : 'Failed to open log file')
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
                toast.success(language === 'zh' ? '日志已导出' : 'Logs exported')
            } else {
                toast.error(language === 'zh' ? '没有可导出的日志' : 'No logs to export')
            }
        } catch (err) {
            logger.settings.error('Failed to export logs:', err)
            toast.error(language === 'zh' ? '导出日志失败' : 'Failed to export logs')
        }
    }

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <HardDrive className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '存储与缓存' : 'Storage & Cache'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '配置存储路径' : 'Config Storage Path'}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh'
                                        ? '所有配置文件（config.json、mcp.json 等）的存储位置'
                                        : 'Storage location for all config files (config.json, mcp.json, etc.)'}
                                </div>
                            </div>
                            <ActionButton variant="secondary" size="sm" className="rounded-xl px-4" onClick={async () => {
                                const newPath = await api.file.selectFolder()
                                if (newPath) {
                                    // @ts-ignore
                                    const success = await api.settings.setConfigPath?.(newPath)
                                    if (success) {
                                        toast.success(language === 'zh' ? '路径已更新，重启后生效' : 'Path updated, restart required to take effect')
                                    } else {
                                        toast.error(language === 'zh' ? '更新路径失败' : 'Failed to update path')
                                    }
                                }
                            }}>
                                {language === 'zh' ? '更改路径' : 'Change Path'}
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
                            {language === 'zh' ? '更改路径后需要手动重启应用以应用所有变更' : 'Restart application manually after changing path to apply all changes'}
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '清除缓存' : 'Clear Cache'}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">{language === 'zh' ? '清除编辑器缓存、索引数据和临时文件' : 'Clear editor cache, index data, and temporary files'}</div>
                        </div>
                        <ActionButton variant="secondary" size="sm" onClick={handleClearCache} disabled={isClearing} className="rounded-xl px-6">
                            {isClearing ? (language === 'zh' ? '清除中...' : 'Clearing...') : (language === 'zh' ? '清除' : 'Clear')}
                        </ActionButton>
                    </div>

                    <div className="flex items-center justify-between p-6 bg-red-500/10 rounded-2xl border border-red-500/20 shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-red-400">{language === 'zh' ? '重置所有设置' : 'Reset All Settings'}</div>
                            <div className="text-xs text-red-400/70 mt-1">{language === 'zh' ? '恢复出厂设置，不可撤销' : 'Restore factory settings, irreversible'}</div>
                        </div>
                        <ActionButton variant="danger" size="sm" onClick={handleReset} className="rounded-xl px-6">
                            {language === 'zh' ? '重置' : 'Reset'}
                        </ActionButton>
                    </div>
                </div>
            </section>

            {/* Python 环境 */}
            <PythonEnvSection language={language} />

            {/* 日志管理 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <FileText className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '日志管理' : 'Log Management'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {language === 'zh' ? '启用文件日志' : 'Enable File Logging'}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh'
                                        ? '将应用日志保存到文件，用于调试和问题排查'
                                        : 'Save application logs to file for debugging and troubleshooting'}
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
                                        {language === 'zh' ? '日志文件位置' : 'Log File Location'}
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
                                        {language === 'zh' ? '打开日志文件' : 'Open Log File'}
                                    </ActionButton>
                                    <ActionButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleExportLogs}
                                        className="rounded-xl px-4 flex-1"
                                    >
                                        <Download className="w-3.5 h-3.5 mr-1.5" />
                                        {language === 'zh' ? '导出日志' : 'Export Logs'}
                                    </ActionButton>
                                </div>

                                <div className="flex items-start gap-2 text-[11px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
                                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                    <div>
                                        {language === 'zh'
                                            ? '日志文件会自动轮转，最多保留 5 个文件（每个最大 10MB）。生产环境默认只记录警告和错误。'
                                            : 'Log files rotate automatically, keeping up to 5 files (10MB each). Production mode logs warnings and errors only.'}
                                    </div>
                                </div>
                            </>
                        )}

                        {!enableFileLogging && (
                            <div className="flex items-start gap-2 text-[11px] font-medium text-text-muted bg-white/5 px-3 py-2 rounded-lg border border-border">
                                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <div>
                                    {language === 'zh'
                                        ? '文件日志已禁用。启用后可以查看详细的应用运行日志，包括 LSP 安装、错误信息等。'
                                        : 'File logging is disabled. Enable it to view detailed application logs including LSP installation, errors, etc.'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* 配置导出/导入 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Download className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {language === 'zh' ? '配置备份' : 'Settings Backup'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '导出配置' : 'Export Settings'}</div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh'
                                        ? '将当前配置导出为 JSON 文件，方便备份或迁移'
                                        : 'Export current settings to JSON file for backup or migration'}
                                </div>
                            </div>
                            <ActionButton variant="secondary" size="sm" onClick={handleExport} className="rounded-xl px-4">
                                <Download className="w-3.5 h-3.5 mr-1.5" />
                                {language === 'zh' ? '导出' : 'Export'}
                            </ActionButton>
                        </div>

                        <div className="flex items-center justify-between py-2">
                            <div className="text-xs text-text-muted">
                                {language === 'zh' ? '包含 API 密钥（不推荐）' : 'Include API keys (not recommended)'}
                            </div>
                            <ToggleSwitch
                                checked={includeApiKeys}
                                onChange={(e) => setIncludeApiKeys(e.target.checked)}
                            />
                        </div>

                        {includeApiKeys && (
                            <div className="flex items-center gap-2 text-[11px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {language === 'zh' ? '导出文件将包含敏感的 API 密钥，请妥善保管' : 'Exported file will contain sensitive API keys, keep it safe'}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div>
                            <div className="text-sm font-bold text-text-primary">{language === 'zh' ? '导入配置' : 'Import Settings'}</div>
                            <div className="text-xs text-text-muted mt-1 opacity-70">
                                {language === 'zh' ? '从 JSON 文件导入配置' : 'Import settings from JSON file'}
                            </div>
                        </div>
                        <ActionButton variant="secondary" size="sm" onClick={handleImport} className="rounded-xl px-4">
                            <Upload className="w-3.5 h-3.5 mr-1.5" />
                            {language === 'zh' ? '导入' : 'Import'}
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
