/**
 * [AweeClaw] 场景感知版本控制引擎
 *
 * - 新增场景感知的提交策略（法律文档审计追踪、医疗合规记录、教育版本管理）
 * - 新增场景感知的忽略规则集成
 * - 新增场景特定的分支命名约定
 */

import { api } from './electronBridge'
import { requestGitCredential } from './gitAuthBridge'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { logger } from '@toolkit/LogEngine'
import { normalizePath, toRelativePath } from '@shared/toolkit/pathHelper'
import { BRAND } from '@shared/brand'
import { useStore } from '@store'

function handleGitError(err: unknown): string {
    const error = toAppError(err)
    return error.message
}

export interface GitStatus {
    branch: string
    ahead: number
    behind: number
    staged: GitFileChange[]
    unstaged: GitFileChange[]
    untracked: string[]
    hasConflicts: boolean
    conflictFiles: string[]
}

export interface GitFileChange {
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged'
    oldPath?: string
    additions?: number
    deletions?: number
}

export interface GitCommit {
    hash: string
    shortHash: string
    message: string
    author: string
    email?: string
    date: Date
    parents?: string[]
}

export interface GitStashEntry {
    index: number
    message: string
    branch: string
    date?: Date
}

export interface GitBranch {
    name: string
    current: boolean
    remote: boolean
    upstream?: string
    ahead?: number
    behind?: number
    lastCommit?: string
}

export interface GitRepository {
    root: string
    name: string
    relativePath: string
    isWorkspaceRoot: boolean
}

/**
 * 链接工作树（git worktree）
 *
 * 用于并行隔离：AI 的每个独立任务可以占用一个 worktree，
 * 各自拥有独立的工作目录与检出分支，互不污染对方未提交的改动。
 */
export interface GitWorktree {
    /** 工作树目录绝对路径 */
    path: string
    /** 当前 HEAD 提交（完整 hash） */
    head?: string
    /** 检出的分支名（detached 时为空） */
    branch?: string
    detached: boolean
    bare: boolean
    locked: boolean
    /** 目录已失效（可被 prune 清理） */
    prunable: boolean
    /** 是否为仓库主工作树（即工作区自身） */
    isMain: boolean
}

/** 审计封存结果（合规场景的不可篡改留痕） */
export interface AuditSealResult {
    success: boolean
    error?: string
    /** 被封存的提交 */
    commitHash?: string
    commitShort?: string
    /** 审计 tag 名（带注记，指向上面的提交） */
    tag?: string
    /** 封存时间（ISO） */
    sealedAt?: string
    /** 本次封存一并提交的变更文件数 */
    committed?: number
}

/** 已有审计 tag 条目 */
export interface AuditSealEntry {
    name: string
    hash: string
    date: string
    message: string
}

/** 取多行输出的首个非空行（git 的报错常把关键信息放在第一行） */
function firstNonEmptyLine(text: string): string {
    return (text || '').split('\n').map((line) => line.trim()).find((line) => line.length > 0) || ''
}

/** 审计 tag 的时间戳后缀：20260917-113425（本地时间，便于人工核对） */
function formatAuditStamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

interface GitExecResult {
    stdout: string
    stderr: string
    exitCode: number
    /** 需要用户提供凭证（主进程识别出的认证失败） */
    authRequired?: boolean
    /** 需要凭证的主机 */
    authHost?: string
    /** 凭证提示类型：token-required 表示平台已禁用密码认证 */
    authHint?: 'credential-required' | 'token-required'
}

/** 一次性凭证（用户在弹窗中填写，或来自已存凭证） */
interface GitExecCredential {
    host?: string
    username?: string
    secret?: string
    useStored?: boolean
}

/** 网络类命令的失败形状（含用户取消） */
export interface GitNetworkResult {
    success: boolean
    error?: string
    authHost?: string
    /** 用户在凭证弹窗中选择了取消 / 弹窗超时 */
    cancelled?: boolean
    /** 是否需要用户提供凭证（调用方决定是否再次提示） */
    authRequired?: boolean
}

interface ScenarioCommitConfig {
    commitPrefix: string
    requireCoAuthor: boolean
    auditTrail: boolean
    branchConvention: RegExp | null
}

const SCENARIO_COMMIT_CONFIGS: Record<string, ScenarioCommitConfig> = {
    'dev-assistant': {
        commitPrefix: '',
        requireCoAuthor: false,
        auditTrail: false,
        branchConvention: null,
    },
    'legal': {
        commitPrefix: '[legal]',
        requireCoAuthor: true,
        auditTrail: true,
        branchConvention: /^(feature|fix|review|compliance)\/.+/,
    },
    'medical': {
        commitPrefix: '[medical]',
        requireCoAuthor: false,
        auditTrail: true,
        branchConvention: /^(feature|fix|compliance|review)\/.+/,
    },
    'education': {
        commitPrefix: '[edu]',
        requireCoAuthor: false,
        auditTrail: false,
        branchConvention: /^(feature|fix|content|assessment)\/.+/,
    },
}

function getScenarioCommitConfig(): ScenarioCommitConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    return SCENARIO_COMMIT_CONFIGS[scenarioId] ?? SCENARIO_COMMIT_CONFIGS['dev-assistant']
}

function formatCommitMessage(message: string): string {
    const config = getScenarioCommitConfig()
    if (!config.commitPrefix) return message
    if (message.startsWith(config.commitPrefix)) return message
    return `${config.commitPrefix} ${message}`
}

class ScenarioVersionControl {
    private primaryWorkspacePath: string | null = null
    private readonly repositoryDiscoveryCache = new Map<string, GitRepository[]>()
    private readonly DISCOVERY_IGNORED_DIRS = new Set([
        '.git',
        'node_modules',
        'dist',
        'build',
        '.next',
        BRAND.dirName,
        'coverage',
        '__pycache__',
        '.venv',
        'venv',
    ])

    setWorkspace(path: string | null) {
        this.primaryWorkspacePath = path
    }

    getWorkspace(): string | null {
        return this.primaryWorkspacePath
    }

    private async exec(
        args: string[],
        rootPath?: string,
        credential?: GitExecCredential,
    ): Promise<GitExecResult> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) {
            return { stdout: '', stderr: 'No workspace', exitCode: 1 }
        }

        try {
            const normalizedPath = normalizePath(targetPath)
            const fullArgs = ['-c', 'core.quotePath=false', ...args]
            const result = await api.git.execSecure(
                fullArgs,
                normalizedPath,
                credential ? { credential } : undefined,
            )
            const exitCode = result.success === false ? (result.exitCode ?? 1) : (result.exitCode || 0)
            return {
                stdout: result.stdout || '',
                stderr: result.stderr || result.error || '',
                exitCode,
                authRequired: result.authRequired,
                authHost: result.authHost,
                authHint: result.authHint
            }
        } catch (err) {
            return {
                stdout: '',
                stderr: handleGitError(err),
                exitCode: 1
            }
        }
    }

    /**
     * 网络类 git 命令统一入口（push / pull / fetch / clone）
     *
     * 认证流程（三层降级）：
     *   1. 主进程自动注入已存凭证 / 系统 keychain → 成功即返回
     *   2. 失败且被识别为「缺少凭证」→ 弹出账号密码输入框（AI 调用时同样弹窗）
     *   3. 用户填写后带一次性凭证重试一次；勾选「记住」则加密落盘供后续复用
     *
     * 用户取消 / 弹窗超时 → 返回 cancelled，调用方不应视为崩溃错误。
     */
    private async runNetworkCommand(
        args: string[],
        rootPath: string | undefined,
        operation: string,
    ): Promise<GitNetworkResult> {
        let result = await this.exec(args, rootPath)

        if (result.exitCode === 0) return { success: true }
        if (!result.authRequired) {
            return { success: false, error: result.stderr || result.stdout }
        }

        const host = result.authHost || ''
        const answer = await requestGitCredential({
            host,
            hint: result.authHint || 'credential-required',
            operation,
            hasStoredCredential: host ? await this.hasStoredCredential(host) : false,
        })

        if (!answer) {
            return {
                success: false,
                cancelled: true,
                authHost: host,
                authRequired: true,
                error: result.stderr || 'Authentication cancelled by user',
            }
        }

        // 勾选「记住」才落盘；未勾选时凭证只在本次会话内存中有效
        if (answer.remember && host) {
            await api.git.credentialSave({
                host,
                username: answer.username,
                secret: answer.secret,
                remember: true,
            })
        }

        result = await this.exec(args, rootPath, {
            host: host || undefined,
            username: answer.username,
            secret: answer.secret,
            useStored: true,
        })

        if (result.exitCode === 0) return { success: true }

        if (result.authRequired) {
            // 带上 git 原始错误：输入的是 Token / 密码、账号是否被授权等差异只能从这里看出来
            const detail = (result.stderr || '').split('\n').find((line) => line.trim().length > 0)
            return {
                success: false,
                authRequired: true,
                authHost: host,
                error: detail
                    ? `Authentication failed: 账号或密码 / Token 无效（${detail.trim()}）`
                    : 'Authentication failed: 账号或密码 / Token 无效',
            }
        }

        return { success: false, error: result.stderr || result.stdout }
    }

    /** 查询某主机是否已有可用凭证（用于弹窗提示「凭证可能已过期」） */
    async hasStoredCredential(host: string): Promise<boolean> {
        try {
            const result = await api.git.credentialHas(host)
            return result?.has === true
        } catch {
            return false
        }
    }

    private async resolveGitPath(pathName: string, rootPath?: string): Promise<string | null> {
        const result = await this.exec(['rev-parse', '--git-path', pathName], rootPath)
        if (result.exitCode !== 0) return null
        const resolvedPath = result.stdout.trim()
        return resolvedPath ? normalizePath(resolvedPath) : null
    }

    private async gitPathExists(pathName: string, rootPath?: string): Promise<boolean> {
        try {
            const resolvedPath = await this.resolveGitPath(pathName, rootPath)
            if (!resolvedPath) return false
            return await api.file.exists(resolvedPath)
        } catch {
            return false
        }
    }

    private async detectOperationState(rootPath?: string): Promise<'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) return 'normal'

        if (await this.gitPathExists('rebase-merge', targetPath)) return 'rebase'
        if (await this.gitPathExists('rebase-apply', targetPath)) return 'rebase'
        if (await this.gitPathExists('MERGE_HEAD', targetPath)) return 'merge'
        if (await this.gitPathExists('CHERRY_PICK_HEAD', targetPath)) return 'cherry-pick'
        if (await this.gitPathExists('REVERT_HEAD', targetPath)) return 'revert'

        return 'normal'
    }

    async isGitRepo(rootPath?: string): Promise<boolean> {
        try {
            const result = await this.exec(['rev-parse', '--is-inside-work-tree'], rootPath)
            return result.exitCode === 0
        } catch {
            return false
        }
    }

    async discoverRepositories(workspacePath: string, maxDepth: number = 1, forceRefresh: boolean = false): Promise<GitRepository[]> {
        const normalizedWorkspace = normalizePath(workspacePath).replace(/\/+$/, '')
        const cacheKey = `${normalizedWorkspace}::${maxDepth}`

        if (!forceRefresh) {
            const cachedRepositories = this.repositoryDiscoveryCache.get(cacheKey)
            if (cachedRepositories) {
                return cachedRepositories
            }
        }

        const performDiscovery = async (): Promise<GitRepository[]> => {
            const visited = new Set<string>()
            const repositories = new Map<string, GitRepository>()

            const registerRepository = async (candidatePath: string) => {
                const revParseResult = await this.exec(['rev-parse', '--show-toplevel'], candidatePath)
                const resolvedRoot = normalizePath(
                    revParseResult.exitCode === 0 && revParseResult.stdout.trim()
                        ? revParseResult.stdout.trim()
                        : candidatePath,
                ).replace(/\/+$/, '')

                const workspaceInsideRepo = normalizedWorkspace === resolvedRoot
                    || normalizedWorkspace.startsWith(`${resolvedRoot}/`)
                const repoInsideWorkspace = resolvedRoot.startsWith(`${normalizedWorkspace}/`)

                if (!workspaceInsideRepo && !repoInsideWorkspace) return
                if (repositories.has(resolvedRoot)) return

                const relativePath = resolvedRoot === normalizedWorkspace || workspaceInsideRepo
                    ? '.'
                    : resolvedRoot.slice(normalizedWorkspace.length + 1)

                repositories.set(resolvedRoot, {
                    root: resolvedRoot,
                    name: resolvedRoot.split('/').filter(Boolean).pop() || resolvedRoot,
                    relativePath,
                    isWorkspaceRoot: workspaceInsideRepo,
                })
            }

            const walk = async (dirPath: string, depth: number): Promise<void> => {
                const normalizedDir = normalizePath(dirPath).replace(/\/+$/, '')
                if (visited.has(normalizedDir) || depth > maxDepth) return
                visited.add(normalizedDir)

                let entries
                try { entries = await api.file.readDir(normalizedDir) } catch { return }
                if (!entries) return

                const hasGitMarker = entries.some(entry => entry.name === '.git')
                if (hasGitMarker) await registerRepository(normalizedDir)

                if (depth === maxDepth) return

                for (const entry of entries) {
                    if (!entry.isDirectory) continue
                    if (this.DISCOVERY_IGNORED_DIRS.has(entry.name)) continue
                    await walk(entry.path, depth + 1)
                }
            }

            await walk(normalizedWorkspace, 0)
            return Array.from(repositories.values()).sort((left, right) => {
                if (left.isWorkspaceRoot !== right.isWorkspaceRoot) return left.isWorkspaceRoot ? -1 : 1
                return left.relativePath.localeCompare(right.relativePath)
            })
        }

        let discoveredRepositories = await performDiscovery()

        if (!forceRefresh && discoveredRepositories.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 250))
            discoveredRepositories = await performDiscovery()
        }

        if (discoveredRepositories.length > 0) {
            this.repositoryDiscoveryCache.set(cacheKey, discoveredRepositories)
        } else {
            this.repositoryDiscoveryCache.delete(cacheKey)
        }

        return discoveredRepositories
    }

    async getCurrentBranch(rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['branch', '--show-current'], rootPath)
            return result.exitCode === 0 ? result.stdout.trim() : null
        } catch {
            return null
        }
    }

    async getStatus(rootPath?: string): Promise<GitStatus | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null

        try {
            const [branchResult, statusResult] = await Promise.all([
                this.exec(['branch', '--show-current'], targetRoot),
                this.exec(['status', '--porcelain=v1', '-uall'], targetRoot),
            ])

            let branch = 'HEAD'
            if (branchResult.exitCode === 0 && branchResult.stdout.trim()) {
                branch = branchResult.stdout.trim()
            } else {
                const revParseResult = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'], targetRoot)
                if (revParseResult.exitCode === 0 && revParseResult.stdout.trim()) {
                    branch = revParseResult.stdout.trim()
                }
            }

            let ahead = 0, behind = 0
            try {
                const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], targetRoot)
                if (aheadBehind.exitCode === 0) {
                    const parts = aheadBehind.stdout.trim().split(/\s+/)
                    if (parts.length >= 2) {
                        behind = Number(parts[0]) || 0
                        ahead = Number(parts[1]) || 0
                    }
                }
            } catch { /* 无上游 */ }

            const staged: GitFileChange[] = []
            const unstaged: GitFileChange[] = []
            const untracked: string[] = []
            const conflictFiles: string[] = []
            let hasConflicts = false

            if (statusResult.exitCode === 0 && statusResult.stdout) {
                const lines = statusResult.stdout.split('\n').filter(Boolean)

                for (const line of lines) {
                    if (line.length < 4) continue
                    const X = line[0]
                    const Y = line[1]
                    let fullPathPart = line.slice(3)
                    let currentPath = fullPathPart
                    if (X === 'R' || Y === 'R') {
                        const parts = fullPathPart.split(' -> ')
                        currentPath = parts[parts.length - 1]
                    }

                    const isConflict = (X === 'U' || Y === 'U' || (X === 'A' && Y === 'A') || (X === 'D' && Y === 'D'))
                    if (isConflict) {
                        hasConflicts = true
                        conflictFiles.push(currentPath)
                        continue
                    }

                    if (X === '?' && Y === '?') {
                        if (!currentPath.endsWith('/')) untracked.push(currentPath)
                        continue
                    }

                    if (X !== ' ' && X !== '?') staged.push({ path: currentPath, status: this.parseStatus(X) })
                    if (Y !== ' ' && Y !== '?') unstaged.push({ path: currentPath, status: this.parseStatus(Y) })
                }
            }

            return { branch, ahead, behind, staged, unstaged, untracked, hasConflicts, conflictFiles }
        } catch (err) {
            logger.git.error('[ScenarioVersionControl] getStatus failed:', err)
            return null
        }
    }

    private parseStatus(char: string): GitFileChange['status'] {
        switch (char) {
            case 'A': return 'added'
            case 'M': return 'modified'
            case 'D': return 'deleted'
            case 'R': return 'renamed'
            case 'C': return 'copied'
            case 'U': return 'unmerged'
            default: return 'modified'
        }
    }

    async getFileDiff(filePath: string, staged: boolean = false, rootPath?: string): Promise<string | null> {
        try {
            const args = staged ? ['diff', '--cached', '--', filePath] : ['diff', '--', filePath]
            const result = await this.exec(args, rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch { return null }
    }

    async getCommitDiff(commitHash: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['show', '--format=', '--patch', commitHash], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch { return null }
    }

    async getHeadFileContent(absolutePath: string, rootPath?: string): Promise<string | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null
        const relativePath = toRelativePath(absolutePath, targetRoot)
        try {
            const fullArgs = ['-c', 'core.quotePath=false', 'show', `HEAD:${relativePath}`]
            const result = await api.git.execSecure(fullArgs, targetRoot)
            if (result.success !== false && result.exitCode === 0) return result.stdout || ''
            return ''
        } catch { return '' }
    }

    async getIndexFileContent(absolutePath: string, rootPath?: string): Promise<string | null> {
        const targetRoot = rootPath || this.primaryWorkspacePath
        if (!targetRoot) return null
        const relativePath = toRelativePath(absolutePath, targetRoot)
        try {
            const fullArgs = ['-c', 'core.quotePath=false', 'show', `:${relativePath}`]
            const result = await api.git.execSecure(fullArgs, targetRoot)
            if (result.success !== false && result.exitCode === 0) return result.stdout || ''
            return ''
        } catch { return '' }
    }

    async getFileContentAtCommit(filePath: string, commitHash: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['show', `${commitHash}:${filePath}`], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch { return null }
    }

    async stageFile(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['add', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async stageAll(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['add', '-A'], rootPath)
        return result.exitCode === 0
    }

    async unstageFile(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['reset', 'HEAD', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async unstageAll(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['reset', 'HEAD'], rootPath)
        return result.exitCode === 0
    }

    async discardChanges(filePath: string, rootPath?: string): Promise<boolean> {
        const result = await this.exec(['checkout', '--', filePath], rootPath)
        return result.exitCode === 0
    }

    async discardAllChanges(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['checkout', '--', '.'], rootPath)
        return result.exitCode === 0
    }

    async commit(message: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const formattedMessage = formatCommitMessage(message)
            const result = await this.exec(['commit', '-m', formattedMessage], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async commitAmend(message?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message
                ? ['commit', '--amend', '-m', formatCommitMessage(message)]
                : ['commit', '--amend', '--no-edit']
            const result = await this.exec(args, rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async init(rootPath?: string): Promise<boolean> {
        const result = await this.exec(['init'], rootPath)
        return result.exitCode === 0
    }

    async clone(url: string, targetDirectory: string, rootPath?: string): Promise<GitNetworkResult> {
        try {
            const trimmedUrl = url.trim()
            const trimmedTarget = targetDirectory.trim()
            if (!trimmedUrl || !trimmedTarget) return { success: false, error: 'Repository URL and target directory are required' }
            return await this.runNetworkCommand(['clone', trimmedUrl, trimmedTarget], rootPath, `git clone ${trimmedUrl}`)
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async pull(rootPath?: string): Promise<GitNetworkResult> {
        try {
            return await this.runNetworkCommand(['pull'], rootPath, 'git pull')
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async push(rootPath?: string, force?: boolean): Promise<GitNetworkResult> {
        try {
            const args = force ? ['push', '--force-with-lease'] : ['push']
            return await this.runNetworkCommand(args, rootPath, `git ${args.join(' ')}`)
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async fetch(rootPath?: string): Promise<GitNetworkResult> {
        try {
            return await this.runNetworkCommand(['fetch', '--all', '--prune'], rootPath, 'git fetch')
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    /**
     * 静默 fetch：只复用已存凭证，认证失败也不再弹窗
     *
     * 用于「打开工作区时自动 fetch」这类被动场景 —— 主动操作才应该弹凭证框。
     */
    async fetchQuiet(rootPath?: string): Promise<boolean> {
        try {
            const result = await this.exec(['fetch', '--all', '--prune'], rootPath, { useStored: true })
            return result.exitCode === 0
        } catch {
            return false
        }
    }


    /**
     * 带 remote / branch 选项的推送（AI 工具需要发布新分支时用 -u）
     *
     * 与其他网络命令一致：认证失败 → 弹凭证框 → 带一次性凭证重试
     */
    async pushBranch(
        options: { remote?: string; branch?: string; setUpstream?: boolean; force?: boolean } = {},
        rootPath?: string,
    ): Promise<GitNetworkResult> {
        try {
            const args = ['push']
            if (options.force) args.push('--force-with-lease')
            if (options.setUpstream) args.push('-u')
            const remote = (options.remote || '').trim()
            const branch = (options.branch || '').trim()
            if (remote || branch || options.setUpstream) {
                args.push(remote || 'origin')
                args.push(branch || 'HEAD')
            }
            return await this.runNetworkCommand(args, rootPath, `git ${args.join(' ')}`)
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    /** 带 remote / branch 选项的拉取 */
    async pullBranch(
        options: { remote?: string; branch?: string } = {},
        rootPath?: string,
    ): Promise<GitNetworkResult> {
        try {
            const args = ['pull']
            const remote = (options.remote || '').trim()
            const branch = (options.branch || '').trim()
            if (remote || branch) {
                args.push(remote || 'origin')
                if (branch) args.push(branch)
            }
            return await this.runNetworkCommand(args, rootPath, `git ${args.join(' ')}`)
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async getRemotes(rootPath?: string): Promise<{ name: string; url: string; type: 'fetch' | 'push' }[]> {
        try {
            const result = await this.exec(['remote', '-v'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            const remotes: { name: string; url: string; type: 'fetch' | 'push' }[] = []
            for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
                const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
                if (match) remotes.push({ name: match[1], url: match[2], type: match[3] as 'fetch' | 'push' })
            }
            return remotes
        } catch { return [] }
    }

    async getBranches(rootPath?: string): Promise<GitBranch[]> {
        try {
            const result = await this.exec(['branch', '-a', '-v'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            const branches: GitBranch[] = []
            for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
                const current = line.startsWith('*')
                const trimmed = line.replace(/^\*?\s+/, '')
                const parts = trimmed.split(/\s+/)
                let name = parts[0]
                const commitHash = parts[1] || ''
                if (name === 'HEAD' || name.includes('->')) continue
                const remote = name.startsWith('remotes/')
                if (remote) name = name.replace('remotes/', '')
                branches.push({ name, current, remote, lastCommit: commitHash.slice(0, 7) })
            }
            const currentBranch = branches.find(b => b.current)
            if (currentBranch) {
                try {
                    const aheadBehind = await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], rootPath)
                    if (aheadBehind.exitCode === 0) {
                        const parts = aheadBehind.stdout.trim().split(/\s+/)
                        if (parts.length >= 2) {
                            currentBranch.behind = Number(parts[0]) || 0
                            currentBranch.ahead = Number(parts[1]) || 0
                        }
                    }
                } catch { /* no upstream */ }
            }
            return branches
        } catch { return [] }
    }

    async checkoutBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['checkout', name], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async createBranch(name: string, startPoint?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = startPoint ? ['checkout', '-b', name, startPoint] : ['checkout', '-b', name]
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async deleteBranch(name: string, force?: boolean, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = force ? ['branch', '-D', name] : ['branch', '-d', name]
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async deleteRemoteBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const slashIndex = name.indexOf('/')
            if (slashIndex === -1) return { success: false, error: 'Invalid remote branch name format' }
            const remote = name.slice(0, slashIndex)
            const branch = name.slice(slashIndex + 1)
            const result = await this.exec(['push', remote, '--delete', branch], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async renameBranch(oldName: string, newName: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['branch', '-m', oldName, newName], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async mergeBranch(name: string, rootPath?: string): Promise<{ success: boolean; error?: string; conflicts?: string[] }> {
        try {
            const result = await this.exec(['merge', name], rootPath)
            if (result.exitCode !== 0) {
                const statusResult = await this.exec(['status', '--porcelain'], rootPath)
                const conflicts = statusResult.stdout.split('\n').filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD')).map(line => line.slice(3).trim())
                return { success: false, error: result.stderr || 'Merge conflict', conflicts: conflicts.length > 0 ? conflicts : undefined }
            }
            return { success: true }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async abortMerge(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['merge', '--abort'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async rebase(branch: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', branch], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async rebaseContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--continue'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async rebaseAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--abort'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async rebaseSkip(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['rebase', '--skip'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async cherryPick(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', commitHash], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async cherryPickContinue(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--continue'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async cherryPickAbort(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['cherry-pick', '--abort'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async stash(message?: string, includeUntracked?: boolean, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = ['stash', 'push']
            if (includeUntracked) args.push('-u')
            if (message) args.push('-m', message)
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async stashApply(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'apply', `stash@{${index}}`], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async stashPop(index?: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = index !== undefined ? ['stash', 'pop', `stash@{${index}}`] : ['stash', 'pop']
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async stashDrop(index: number, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'drop', `stash@{${index}}`], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async stashClear(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['stash', 'clear'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async getStashList(rootPath?: string): Promise<GitStashEntry[]> {
        try {
            const result = await this.exec(['stash', 'list', '--format=%gd%x00%gs%x00%ci'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
                const parts = line.split('\0')
                const indexMatch = parts[0]?.match(/stash@\{(\d+)\}/)
                const index = indexMatch ? parseInt(indexMatch[1]) : 0
                const message = parts[1] || ''
                const branchMatch = message.match(/^On\s+(\S+):\s*(.*)$/)
                return { index, branch: branchMatch?.[1] || 'unknown', message: branchMatch?.[2] || message, date: parts[2] ? new Date(parts[2]) : undefined }
            })
        } catch { return [] }
    }

    async getStashDiff(index: number, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['stash', 'show', '-p', `stash@{${index}}`], rootPath)
            return result.exitCode === 0 ? result.stdout : null
        } catch { return null }
    }

    async getRecentCommits(count: number = 20, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec(['log', `-${count}`, '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr, parents] = line.split('\0')
                return { hash, shortHash, message, author, email, date: new Date(dateStr), parents: parents ? parents.split(' ').filter(Boolean) : [] }
            })
        } catch { return [] }
    }

    async getCommitDetails(hash: string, rootPath?: string): Promise<{ commit: GitCommit; files: { path: string; status: string; additions: number; deletions: number }[] } | null> {
        try {
            const infoResult = await this.exec(['show', hash, '--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P', '--stat', '--stat-width=1000'], rootPath)
            if (infoResult.exitCode !== 0) return null
            const lines = infoResult.stdout.trim().split('\n')
            const [hash_, shortHash, message, author, email, dateStr, parents] = lines[0].split('\0')
            const commit: GitCommit = { hash: hash_, shortHash, message, author, email, date: new Date(dateStr), parents: parents ? parents.split(' ').filter(Boolean) : [] }
            const files: { path: string; status: string; additions: number; deletions: number }[] = []
            const numstatResult = await this.exec(['show', hash, '--numstat', '--format='], rootPath)
            if (numstatResult.exitCode === 0 && numstatResult.stdout) {
                for (const line of numstatResult.stdout.trim().split('\n').filter(Boolean)) {
                    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/)
                    if (match) files.push({ path: match[3], status: 'modified', additions: match[1] === '-' ? 0 : parseInt(match[1]), deletions: match[2] === '-' ? 0 : parseInt(match[2]) })
                }
            }
            return { commit, files }
        } catch { return null }
    }

    async getFileHistory(filePath: string, count: number = 20, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec(['log', `-${count}`, '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI', '--follow', '--', filePath], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('\0')
                return { hash, shortHash, message, author, email, date: new Date(dateStr) }
            })
        } catch { return [] }
    }

    async getBranchCommits(branch: string, count: number = 50, rootPath?: string): Promise<GitCommit[]> {
        try {
            const result = await this.exec(['log', branch, `-${count}`, '--pretty=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [hash, shortHash, message, author, email, dateStr] = line.split('\0')
                return { hash, shortHash, message, author, email, date: new Date(dateStr) }
            })
        } catch { return [] }
    }

    async resetSoft(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--soft', commitHash], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async resetMixed(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--mixed', commitHash], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async resetHard(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['reset', '--hard', commitHash], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async revertCommit(commitHash: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['revert', '--no-commit', commitHash], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async getTags(rootPath?: string): Promise<{ name: string; hash: string; message?: string }[]> {
        try {
            const result = await this.exec(['tag', '-l', '--format=%(refname:short)%00%(objectname:short)%00%(contents:subject)'], rootPath)
            if (result.exitCode !== 0 || !result.stdout) return []
            return result.stdout.trim().split('\n').filter(Boolean).map(line => {
                const [name, hash, message] = line.split('\0')
                return { name, hash, message }
            })
        } catch { return [] }
    }

    async createTag(name: string, message?: string, commitHash?: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const args = message ? ['tag', '-a', name, '-m', message] : ['tag', name]
            if (commitHash) args.push(commitHash)
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    async deleteTag(name: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['tag', '-d', name], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) { return { success: false, error: handleGitError(err) } }
    }

    /**
     * 读取 git 配置项
     *
     * @param global true 时读取全局配置（~/.gitconfig），否则读当前仓库配置。
     *               设置页的「仓库身份」需要同时展示两者（本仓库覆盖全局）。
     */
    async getGitConfig(key: string, rootPath?: string, global?: boolean): Promise<string | null> {
        try {
            const args = global ? ['config', '--global', '--get', key] : ['config', '--get', key]
            const result = await this.exec(args, rootPath)
            return result.exitCode === 0 ? result.stdout.trim() : null
        } catch { return null }
    }

    async setGitConfig(key: string, value: string, global?: boolean, rootPath?: string): Promise<boolean> {
        try {
            const args = global ? ['config', '--global', key, value] : ['config', key, value]
            const result = await this.exec(args, rootPath)
            return result.exitCode === 0
        } catch { return false }
    }

    async getOperationState(rootPath?: string): Promise<'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) return 'normal'
        return this.detectOperationState(targetPath ?? undefined)
    }

    async getBlame(filePath: string, rootPath?: string): Promise<{ line: number; hash: string; author: string; date: Date; content: string }[]> {
        try {
            const result = await this.exec(['blame', '--line-porcelain', filePath], rootPath)
            if (result.exitCode !== 0) return []
            const lines: { line: number; hash: string; author: string; date: Date; content: string }[] = []
            const chunks = result.stdout.split(/^([a-f0-9]{40})/m).filter(Boolean)
            let lineNum = 0
            for (let i = 0; i < chunks.length; i += 2) {
                const hash = chunks[i]
                const info = chunks[i + 1] || ''
                const authorMatch = info.match(/^author (.+)$/m)
                const timeMatch = info.match(/^author-time (\d+)$/m)
                const contentMatch = info.match(/^\t(.*)$/m)
                if (authorMatch && timeMatch) {
                    lineNum++
                    lines.push({ line: lineNum, hash: hash.slice(0, 8), author: authorMatch[1], date: new Date(parseInt(timeMatch[1]) * 1000), content: contentMatch?.[1] || '' })
                }
            }
            return lines
        } catch { return [] }
    }

    /**
     * 仓库级差异（AI 工具与审阅面板共用）
     *
     * - staged=true  → --cached（暂存区 vs HEAD）
     * - commit       → 该提交自身引入的改动（等价 git show <commit>）
     * - branch       → 当前 HEAD 与目标分支的差异
     * - stat=true    → 只返回文件级 +/- 统计，避免大仓库 diff 淹没上下文
     */
    async getRepoDiff(options: {
        staged?: boolean
        commit?: string
        branch?: string
        path?: string
        stat?: boolean
    } = {}, rootPath?: string): Promise<string | null> {
        try {
            const args = ['diff']
            if (options.stat) args.push('--stat')
            if (options.staged) args.push('--cached')
            if (options.commit) {
                args.push(`${options.commit}^!`)
            } else if (options.branch) {
                args.push(options.branch)
            }
            if (options.path) args.push('--', options.path)

            const result = await this.exec(args, rootPath)
            if (result.exitCode !== 0) {
                // 根提交没有父节点时 `^!` 会失败，回退为展示该提交本身
                if (options.commit) {
                    const fallback = await this.exec(['show', '--format=', options.commit], rootPath)
                    return fallback.exitCode === 0 ? fallback.stdout : null
                }
                return null
            }
            return result.stdout || ''
        } catch {
            return null
        }
    }

    /**
     * 提交历史（支持按文件 / 分支 / 关键字过滤）
     *
     * 输出用 \x1f（Unit Separator）分隔字段，避免提交信息里的空格 / 冒号
     * 破坏解析 —— 这是 git 输出解析最常见的踩坑点。
     */
    async getLog(
        options: { limit?: number; path?: string; branch?: string; grep?: string } = {},
        rootPath?: string,
    ): Promise<GitCommit[]> {
        try {
            const limit = Math.max(1, Math.min(options.limit ?? 20, 200))
            const args = [
                'log',
                '-n', String(limit),
                '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s',
            ]
            if (options.grep) args.push(`--grep=${options.grep}`)
            if (options.branch) args.push(options.branch)
            if (options.path) args.push('--', options.path)

            const result = await this.exec(args, rootPath)
            if (result.exitCode !== 0 || !result.stdout.trim()) return []

            return result.stdout
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line) => {
                    const [hash, shortHash, author, email, dateStr, ...rest] = line.split('\x1f')
                    return {
                        hash,
                        shortHash,
                        author,
                        email,
                        date: new Date(dateStr),
                        message: rest.join('\x1f'),
                    }
                })
        } catch {
            return []
        }
    }

    // ========================================
    // 链接工作树（worktree）—— 并行任务隔离
    // ========================================

    /**
     * 列出仓库的全部工作树
     *
     * `--porcelain` 输出以空行分隔条目，字段形如 `worktree <path>` / `HEAD <hash>`
     * / `branch refs/heads/<name>` / `detached`。带空格或含本地化文案的
     * `git worktree list`（普通输出）无法稳定解析，故固定用 porcelain。
     */
    async listWorktrees(rootPath?: string): Promise<GitWorktree[]> {
        try {
            const result = await this.exec(['worktree', 'list', '--porcelain'], rootPath)
            if (result.exitCode !== 0) return []

            const entries: GitWorktree[] = []
            let current: Partial<GitWorktree> | null = null

            const flush = () => {
                if (current?.path) {
                    entries.push({
                        path: current.path,
                        head: current.head,
                        branch: current.branch,
                        detached: current.detached === true,
                        bare: current.bare === true,
                        locked: current.locked === true,
                        prunable: current.prunable === true,
                        // porcelain 的第一条即仓库主工作树
                        isMain: entries.length === 0,
                    })
                }
                current = null
            }

            for (const rawLine of result.stdout.split('\n')) {
                const line = rawLine.trimEnd()
                if (!line.trim()) { flush(); continue }

                const spaceIndex = line.indexOf(' ')
                const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex)
                const value = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1).trim()

                if (key === 'worktree') {
                    flush()
                    current = { path: normalizePath(value) }
                    continue
                }
                if (!current) continue

                if (key === 'HEAD') current.head = value
                else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
                else if (key === 'detached') current.detached = true
                else if (key === 'bare') current.bare = true
                else if (key === 'locked') current.locked = true
                else if (key === 'prunable') current.prunable = true
            }
            flush()

            return entries
        } catch {
            return []
        }
    }

    /**
     * 新增链接工作树
     *
     * - createBranch=true → `git worktree add -b <branch> <path> [<startPoint>]`（新建分支）
     * - createBranch=false → `git worktree add <path> [<branch>]`（检出已有分支 / 提交）
     *
     * ⚠️ 同一个分支不能被两个工作树同时检出，重复时 git 会拒绝，
     * 这类报错原样返回给调用方（而非当作系统错误），便于 AI 换名重试。
     */
    async addWorktree(
        options: {
            path: string
            branch?: string
            createBranch?: boolean
            startPoint?: string
            force?: boolean
        },
        rootPath?: string,
    ): Promise<{ success: boolean; path?: string; branch?: string; error?: string }> {
        try {
            const targetPath = (options.path || '').trim()
            if (!targetPath) return { success: false, error: 'path is required' }

            const branch = (options.branch || '').trim()
            if (options.createBranch && !branch) {
                return { success: false, error: 'branch is required when create_branch=true' }
            }

            const args = ['worktree', 'add']
            if (options.force) args.push('--force')
            if (options.createBranch) args.push('-b', branch)
            args.push(targetPath)

            if (options.createBranch) {
                const startPoint = (options.startPoint || '').trim()
                if (startPoint) args.push(startPoint)
            } else if (branch) {
                args.push(branch)
            }

            const result = await this.exec(args, rootPath)
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    error: firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout) || '创建 worktree 失败',
                }
            }

            return { success: true, path: targetPath, branch: branch || undefined }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async removeWorktree(
        targetPath: string,
        force?: boolean,
        rootPath?: string,
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const target = (targetPath || '').trim()
            if (!target) return { success: false, error: 'path is required' }

            const args = ['worktree', 'remove']
            if (force) args.push('--force')
            args.push(target)

            const result = await this.exec(args, rootPath)
            if (result.exitCode !== 0) {
                const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout)
                return {
                    success: false,
                    // 有未提交改动时 git 会拒绝删除 —— 把原文透出，便于 AI 说明原因而不是无限重试
                    error: detail || '删除 worktree 失败（目录可能有未提交改动，需 force=true）',
                }
            }

            return { success: true }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    /** 清理已失效的工作树记录（目录被手工删除后残留的元数据） */
    async pruneWorktrees(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['worktree', 'prune'], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? firstNonEmptyLine(result.stderr) : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    // ========================================
    // 审计轨迹封存 —— 合规场景的不可篡改留痕
    // ========================================

    /**
     * 当前场景是否要求审计留痕
     *
     * legal / medical 等合规场景为 true（见 SCENARIO_COMMIT_CONFIGS.auditTrail）。
     * git_commit 在提交成功后会据此自动补一次封存，避免"合规场景提交了却没留痕"。
     */
    isAuditTrailRequired(): boolean {
        return getScenarioCommitConfig().auditTrail
    }

    /**
     * 审计封存
     *
     * 流程：
     *   1. 校验仓库可读且无未解决冲突
     *   2. 存在未提交变更时先按场景提交约定提交（否则这些改动会"隐身"在 tag 之后）
     *   3. 对 HEAD 打带注记的审计 tag（默认 `audit-<时间戳>`），注记写入封存时间 / 提交 / 变更数 / 原因
     *
     * 带注记 tag 指向固定提交，且注记内容参与 tag 对象自身的哈希，
     * 因此事后移动 tag 或改写注记都会破坏校验 —— 这是"不可篡改轨迹"的最小充分条件。
     */
    async sealAuditTrail(
        options: { reason?: string; tag?: string; requireClean?: boolean } = {},
        rootPath?: string,
    ): Promise<AuditSealResult> {
        try {
            const status = await this.getStatus(rootPath)
            if (!status) {
                return { success: false, error: '无法读取仓库状态（可能不是 Git 仓库）' }
            }

            if (status.hasConflicts) {
                return { success: false, error: '存在未解决的冲突，请先解决冲突再封存审计轨迹' }
            }

            const pending = status.staged.length + status.unstaged.length + status.untracked.length
            if (pending > 0 && options.requireClean) {
                return {
                    success: false,
                    error: `工作区有 ${pending} 个未提交变更；require_clean=true 时拒绝封存，请先提交或改为 require_clean=false`,
                }
            }

            const reason = (options.reason || '').trim()
            let committed = 0

            if (pending > 0) {
                const staged = await this.stageAll(rootPath)
                if (!staged) return { success: false, error: '暂存变更失败，审计封存中止' }

                committed = pending
                const commitResult = await this.commit(
                    `audit: 封存 ${committed} 个变更${reason ? ` — ${reason}` : ''}`,
                    rootPath,
                )
                if (!commitResult.success) {
                    return { success: false, error: commitResult.error || '审计提交失败' }
                }
            }

            const head = (await this.getRecentCommits(1, rootPath))[0]
            if (!head) {
                return { success: false, error: '仓库尚无提交，无法封存审计轨迹' }
            }

            let tagName = (options.tag || '').trim() || `audit-${formatAuditStamp(new Date())}`
            if (!options.tag) {
                // 同一秒内连续封存会撞名，而 git tag 重名会直接失败 → 自动追加序号
                const taken = new Set((await this.getTags(rootPath)).map((tag) => tag.name))
                if (taken.has(tagName)) {
                    let suffix = 2
                    while (taken.has(`${tagName}-${suffix}`)) suffix++
                    tagName = `${tagName}-${suffix}`
                }
            }
            const sealedAt = new Date().toISOString()
            const note = [
                `sealed-at: ${sealedAt}`,
                `commit: ${head.hash}`,
                `changed-files: ${committed}`,
                `reason: ${reason || '(none)'}`,
            ].join('\n')

            const tagResult = await this.createTag(tagName, note, undefined, rootPath)
            if (!tagResult.success) {
                return {
                    success: false,
                    error: tagResult.error
                        ? `审计 tag 创建失败：${firstNonEmptyLine(tagResult.error)}`
                        : '审计 tag 创建失败',
                    // 提交已落库，把 hash 回传，避免调用方重复提交
                    commitHash: head.hash,
                    commitShort: head.shortHash,
                }
            }

            return {
                success: true,
                commitHash: head.hash,
                commitShort: head.shortHash,
                tag: tagName,
                sealedAt,
                committed,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    /** 列出已封存的审计 tag（按时间倒序） */
    async listAuditSeals(rootPath?: string): Promise<AuditSealEntry[]> {
        try {
            const result = await this.exec(
                ['tag', '-l', 'audit-*', '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso-strict)%00%(contents:subject)'],
                rootPath,
            )
            if (result.exitCode !== 0 || !result.stdout.trim()) return []

            return result.stdout
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line) => {
                    const [name, hash, date, message] = line.split('\0')
                    return { name, hash, date: date || '', message: message || '' }
                })
                .sort((a, b) => (a.date < b.date ? 1 : -1))
        } catch {
            return []
        }
    }

    /**
     * 校验审计 tag 完整性
     *
     * 带注记 tag 的对象类型为 `tag`；轻量标签为 `commit`，无法证明未被移动。
     * 返回 valid=false 不代表出错（可能只是用了轻量标签），detail 说明判定依据。
     */
    async verifyAuditSeal(tag: string, rootPath?: string): Promise<{ valid: boolean; detail: string }> {
        try {
            const name = (tag || '').trim()
            if (!name) return { valid: false, detail: 'tag is required' }

            const typeResult = await this.exec(['cat-file', '-t', name], rootPath)
            if (typeResult.exitCode !== 0) {
                return { valid: false, detail: `审计 tag ${name} 不存在` }
            }
            const objectType = typeResult.stdout.trim()

            const commitResult = await this.exec(['rev-list', '-n', '1', name], rootPath)
            const commit = commitResult.stdout.trim()
            if (commitResult.exitCode !== 0 || !commit) {
                return { valid: false, detail: `审计 tag ${name} 未指向有效提交` }
            }

            if (objectType !== 'tag') {
                return {
                    valid: false,
                    detail: `审计 tag ${name} 是轻量标签（无注记），指向 ${commit.slice(0, 8)}；无法证明未被移动`,
                }
            }

            const noteResult = await this.exec(['tag', '-l', name, '--format=%(contents)'], rootPath)
            const note = noteResult.stdout.trim()
            return {
                valid: true,
                detail: `审计 tag ${name} 完好：带注记，指向提交 ${commit.slice(0, 8)}${note ? `，注记 ${note.split('\n').length} 行` : ''}`,
            }
        } catch (err) {
            return { valid: false, detail: handleGitError(err) }
        }
    }

    validateBranchName(name: string): { valid: boolean; suggestion?: string } {
        const config = getScenarioCommitConfig()
        if (!config.branchConvention) return { valid: true }
        if (config.branchConvention.test(name)) return { valid: true }
        return { valid: false, suggestion: `Branch name should match: ${config.branchConvention.source}` }
    }
}

export const gitService = new ScenarioVersionControl()
export { ScenarioVersionControl }
