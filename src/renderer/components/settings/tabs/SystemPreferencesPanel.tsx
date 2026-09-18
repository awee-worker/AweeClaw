/**
 * 系统设置组件
 */

import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { useState, useEffect, useRef } from 'react'
import { HardDrive, AlertTriangle, Download, Upload, FileText, ExternalLink, Terminal, Globe, Package } from 'lucide-react'
import { toast } from '@components/foundation/NotificationProvider'
import { globalDecide as globalConfirm } from '@components/foundation/DecisionOverlay'
import { ActionButton, ToggleSwitch } from '@components/ui'
import {Language, t} from '@renderer/i18n'
import { useStore } from '@store'
import { downloadSettings, importSettings } from '../../../settings/configMigration'
import { settingsService } from '../../../settings/preferencesService'
import { isPluginAutoUpdateEnabled, setPluginAutoUpdateEnabled } from '@hooks/usePluginUpdateChecker'
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

/** uv 包管理器环境区块 */
function UvEnvSection({ language }: { language: Language }) {
    // 复用 environment 检测接口获取 uv 状态
    const [uvStatus, setUvStatus] = useState<{
        ready: boolean
        path?: string
        source: string
    } | null>(null)
    const [isInstalling, setIsInstalling] = useState(false)
    const [progressMsg, setProgressMsg] = useState<string>('')

    const refreshStatus = async () => {
        try {
            const result = await api.environment.environmentCheck()
            if (result.success) {
                setUvStatus(result.status.uv)
            }
        } catch (err) {
            logger.settings.warn('Failed to check uv status:', err)
        }
    }

    useEffect(() => {
        refreshStatus()
        // 订阅安装进度
        const off = api.environment.onEnvironmentProgress((event) => {
            if (event.id === 'uv') {
                setProgressMsg(event.message)
                if (event.stage === 'done' || event.stage === 'error') {
                    // 安装结束，刷新状态
                    setTimeout(refreshStatus, 300)
                }
            }
        })
        return off
    }, [])

    const handleInstall = async () => {
        setIsInstalling(true)
        setProgressMsg(language === 'zh' ? '正在安装 uv...' : 'Installing uv...')
        try {
            const result = await api.environment.environmentInstall('uv')
            if (result.success) {
                toast.success(language === 'zh' ? 'uv 安装成功' : 'uv installed successfully')
            } else {
                toast.error(language === 'zh' ? 'uv 安装失败，请查看日志排查' : 'uv installation failed, check logs')
            }
            // 无论成功失败都刷新状态（environmentInstall 不返回 status）
            await refreshStatus()
        } catch (err) {
            toast.error(language === 'zh' ? 'uv 安装失败' : 'uv installation failed')
        } finally {
            setIsInstalling(false)
            setProgressMsg('')
        }
    }

    return (
        <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-bold text-text-primary flex items-center gap-2">
                        <Package className="w-4 h-4 text-accent" />
                        {t('settings.uvpackagemanager', language as Language) || 'uv Package Manager'}
                    </div>
                    <div className="text-xs text-text-muted mt-1 opacity-70">
                        {t('settings.uvfordesc', language as Language) || 'Python package installer/resolver used by plugins and MCP tools'}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${uvStatus?.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium text-text-secondary">
                        {uvStatus?.ready
                            ? t('settings.ready', language as Language)
                            : t('settings.notready', language as Language)}
                    </span>
                </div>
            </div>

            {uvStatus && uvStatus.ready && uvStatus.path && (
                <div className="space-y-2 p-4 bg-background/50 rounded-xl border border-border shadow-inner">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-text-muted w-20">{t('settings.path', language as Language)}</span>
                        <span className="text-text-secondary font-mono break-all">{uvStatus.path}</span>
                    </div>
                </div>
            )}

            {uvStatus && !uvStatus.ready && (
                <div className="flex items-start gap-2 text-[11px] font-medium text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded-lg border border-yellow-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div>
                        {t('settings.uvisnotavailable', language as Language) || 'uv is not available. Plugin installation and MCP tool dependency resolution will be unavailable. Click install to auto-download.'}
                    </div>
                </div>
            )}

            {isInstalling && progressMsg && (
                <div className="flex items-center gap-2 text-xs text-accent bg-accent/5 px-3 py-2 rounded-lg border border-accent/20">
                    <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    <span>{progressMsg}</span>
                </div>
            )}

            <div className="flex gap-3">
                <ActionButton
                    variant="secondary"
                    size="sm"
                    onClick={handleInstall}
                    disabled={isInstalling}
                    className="rounded-xl px-4"
                >
                    {isInstalling
                        ? t('settings.installing', language as Language)
                        : uvStatus?.ready
                            ? (t('settings.reinstall', language as Language))
                            : (t('settings.install', language as Language) || 'Install')}
                </ActionButton>
                <ActionButton
                    variant="secondary"
                    size="sm"
                    onClick={refreshStatus}
                    disabled={isInstalling}
                    className="rounded-xl px-4"
                >
                    {t('settings.refresh', language as Language) || 'Refresh'}
                </ActionButton>
            </div>
        </div>
    )
}

/** 与主进程 MIN_VENV_BASE_VERSION 对齐：插件的 Python 工具链要求 3.10+ */
const MIN_PYTHON_VERSION: [number, number] = [3, 10]

/** 判断版本字符串是否满足下限；无法解析时返回 null（不要把「不知道」当成「不行」） */
function isPythonVersionOk(version: string | null | undefined): boolean | null {
    if (!version) return null
    const m = version.match(/^(\d+)\.(\d+)/)
    if (!m) return null
    const major = Number(m[1])
    const minor = Number(m[2])
    if (major !== MIN_PYTHON_VERSION[0]) return major > MIN_PYTHON_VERSION[0]
    return minor >= MIN_PYTHON_VERSION[1]
}

function PythonEnvSection({ language }: { language: Language }) {
    const [pythonStatus, setPythonStatus] = useState<{
        ready: boolean
        pythonPath: string | null
        uvPath: string | null
        source: 'system' | 'managed' | 'none'
        version: string | null
        venvDir: string | null
        venvBaseVersion?: string | null
        installedPackages: string[]
        diagnostics?: {
            requiredVersion: string
            candidates: Array<{
                kind: string
                path: string
                version: string | null
                accepted: boolean
                reason: string
            }>
            outcome: string
        }
        error?: string
    } | null>(null)
    const [isReinstalling, setIsReinstalling] = useState(false)
    const [isRepairing, setIsRepairing] = useState(false)

    // 环境「就绪」不等于「可用」：3.9 可以让 ready=true，却跑不了要求 3.10+ 的插件脚本
    const versionOk = isPythonVersionOk(pythonStatus?.version)

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

    /**
     * 重新检测并修复运行环境
     *
     * 用 forceRefresh 走与启动时相同的候选链：系统 Python 低于要求时会被跳过，
     * 改为复用已下载的受管解释器（或按需下载）。这是「机器上已经装着 3.11，
     * 却一直在用系统 3.9」这类状态的修复入口。
     */
    const handleRepair = async () => {
        setIsRepairing(true)
        try {
            const status = await api.python.ensureReady({
                minVersion: MIN_PYTHON_VERSION,
                forceRefresh: true,
            })
            setPythonStatus(status)
            if (status.ready && isPythonVersionOk(status.version)) {
                toast.success(`运行环境已更新（Python ${status.version}）`)
            } else {
                toast.error(status.error || '运行环境仍未满足要求，请查看下方诊断信息')
            }
        } catch (err) {
            toast.error(t('settings.reinstallfailed', language as Language))
        } finally {
            setIsRepairing(false)
        }
    }


    return (
        <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-bold text-text-primary flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-accent" />
                        {t('settings.pythonruntime', language as Language)}
                    </div>
                    <div className="text-xs text-text-muted mt-1 opacity-70 ml-6">
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
                                <div className="flex items-center gap-2 text-xs flex-wrap">
                                    <span className="text-text-muted w-20">Python:</span>
                                    <span className="text-text-secondary font-mono">{pythonStatus.version}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted border border-border">
                                        {pythonStatus.source === 'system' ? (t('settings.system2', language as Language)) : 'uv'}
                                    </span>
                                    {/* 版本是否满足插件要求——这是「环境可用但插件跑不动」的关键信号 */}
                                    {versionOk !== null && (
                                        <span
                                            className={`text-[10px] px-1.5 py-0.5 rounded border ${versionOk
                                                ? 'bg-green-500/10 text-green-500 border-green-500/20'
                                                : 'bg-red-500/10 text-red-400 border-red-500/20'}`}
                                        >
                                            {versionOk
                                                ? `满足 ${MIN_PYTHON_VERSION.join('.')}+`
                                                : `低于 ${MIN_PYTHON_VERSION.join('.')}+`}
                                        </span>
                                    )}
                                </div>
                            )}
                            {/* venv 基底版本：与 venv 内 python 版本不一致时说明环境需要修复 */}
                            {pythonStatus.venvBaseVersion && pythonStatus.venvBaseVersion !== pythonStatus.version && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-text-muted w-20">venv:</span>
                                    <span className="text-text-secondary font-mono">{pythonStatus.venvBaseVersion}</span>
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

                    {/* 环境「就绪」但版本不达标：插件会直接拿它跑脚本并撞上 SyntaxError，
                        所以必须在这里显式提示，而不是只等插件层报错 */}
                    {pythonStatus?.ready && versionOk === false && (
                        <div className="flex items-start gap-2 text-[11px] font-medium text-red-400 bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <div>
                                当前 Python {pythonStatus.version} 低于插件要求的 {MIN_PYTHON_VERSION.join('.')}+，
                                依赖 Python 的工具链（如 img2threejs）会执行失败。点击「重新检测并修复」可切换到满足要求的解释器。
                            </div>
                        </div>
                    )}

                    {/* 候选链诊断：解释器为何是现在这个 */}
                    {pythonStatus?.diagnostics && pythonStatus.diagnostics.candidates.length > 0 && (
                        <details className="text-[11px] text-text-muted bg-background/40 rounded-lg border border-border px-3 py-2">
                            <summary className="cursor-pointer select-none">
                                解释器选择诊断（要求 {pythonStatus.diagnostics.requiredVersion}+）
                            </summary>
                            <div className="mt-2 space-y-1">
                                {pythonStatus.diagnostics.candidates.map((c, i) => (
                                    <div key={`${c.kind}-${c.path}-${i}`} className="flex items-start gap-2">
                                        <span className={c.accepted ? 'text-green-500' : 'text-text-muted opacity-60'}>
                                            {c.accepted ? '✓' : '×'}
                                        </span>
                                        <span className="font-mono break-all flex-1">
                                            [{c.kind}] {c.path || '(未生成)'} {c.version ? `(${c.version})` : ''} — {c.reason}
                                        </span>
                                    </div>
                                ))}
                                {pythonStatus.diagnostics.outcome && (
                                    <div className="pt-1 text-text-secondary">{pythonStatus.diagnostics.outcome}</div>
                                )}
                            </div>
                        </details>
                    )}

                    <div className="flex gap-3 flex-wrap">
                        <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={handleRepair}
                            disabled={isRepairing}
                            className="rounded-xl px-4"
                        >
                            {isRepairing ? '正在检测...' : '重新检测并修复'}
                        </ActionButton>
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
        <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm font-bold text-text-primary flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-accent" />
                        {t('settings.noderuntime', language as Language) || 'Node.js Runtime'}
                    </div>
                    <div className="text-xs text-text-muted mt-1 opacity-70 ml-6">
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
    )
}

export function SystemPreferencesPanel({ language, enableFileLogging, setEnableFileLogging }: SystemSettingsProps) {
    const [isClearing, setIsClearing] = useState(false)
    const [includeApiKeys, setIncludeApiKeys] = useState(false)
    const [logPath, setLogPath] = useState('')
    /** 插件自动更新开关（从 localStorage 读取，默认开启） */
    const [pluginAutoUpdate, setPluginAutoUpdate] = useState(true)
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
        // 初始化插件自动更新开关
        setPluginAutoUpdate(isPluginAutoUpdateEnabled())
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
            authorizationMode: getStore().authorizationMode,
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
            environmentCheckCompleted: getStore().environmentCheckCompleted,
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
                </div>
            </section>

            {/* 环境管理（Python / uv / Node.js 三项核心运行时） */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Terminal className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.environmentmanagement', language as Language) || '环境管理'}
                    </h4>
                </div>
                <div className="space-y-4">
                    <UvEnvSection language={language} />
                    <PythonEnvSection language={language} />
                    <NodeEnvSection language={language} />
                </div>
            </section>

            {/* 插件管理 */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <Package className="w-4 h-4 text-accent" />
                    <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-[0.2em]">
                        {t('settings.pluginmanagement', language as Language) || '插件管理'}
                    </h4>
                </div>
                <div className="space-y-4">
                    {/* 插件自动更新 */}
                    <div className="p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-text-primary">
                                    {language === 'zh' ? '自动更新插件' : 'Auto-update Plugins'}
                                </div>
                                <div className="text-xs text-text-muted mt-1 opacity-70">
                                    {language === 'zh'
                                        ? '检测到新版本时自动升级插件（升级后右上角通知）。关闭后仅提醒，需手动更新。'
                                        : 'Automatically upgrade plugins when new versions are detected (notifies on success). When off, only reminds you to update manually.'}
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={pluginAutoUpdate}
                                onChange={(e) => {
                                    setPluginAutoUpdate(e.target.checked)
                                    setPluginAutoUpdateEnabled(e.target.checked)
                                }}
                            />
                        </div>
                    </div>
                </div>
            </section>

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

            {/* 危险区域：重置所有设置（置于页面最后） */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <h4 className="text-[12px] font-bold text-red-400/80 uppercase tracking-[0.2em]">
                        {t('settings.dangerzone', language as Language) || '危险区域'}
                    </h4>
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
            </section>
        </div>
    )
}
