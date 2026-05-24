/**
 * [AweeClaw] 场景感知版本控制引擎
 *
 * 与 Adnify 的 GitService 差异化：
 * - 类名重命名：GitService → ScenarioVersionControl
 * - 新增场景感知的提交策略（法律文档审计追踪、医疗合规记录、教育版本管理）
 * - 新增场景感知的忽略规则集成
 * - 新增场景特定的分支命名约定
 */

import { api } from './electronBridge'
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

interface GitExecResult {
    stdout: string
    stderr: string
    exitCode: number
}

interface ScenarioCommitConfig {
    commitPrefix: string
    requireCoAuthor: boolean
    auditTrail: boolean
    branchConvention: RegExp | null
}

const SCENARIO_COMMIT_CONFIGS: Record<string, ScenarioCommitConfig> = {
    'workspace-editor': {
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
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_COMMIT_CONFIGS[scenarioId] ?? SCENARIO_COMMIT_CONFIGS['workspace-editor']
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

    private async exec(args: string[], rootPath?: string): Promise<GitExecResult> {
        const targetPath = rootPath || this.primaryWorkspacePath
        if (!targetPath) {
            return { stdout: '', stderr: 'No workspace', exitCode: 1 }
        }

        try {
            const normalizedPath = normalizePath(targetPath)
            const fullArgs = ['-c', 'core.quotePath=false', ...args]
            const result = await api.git.execSecure(fullArgs, normalizedPath)
            const exitCode = result.success === false ? (result.exitCode ?? 1) : (result.exitCode || 0)
            return {
                stdout: result.stdout || '',
                stderr: result.stderr || result.error || '',
                exitCode
            }
        } catch (err) {
            return {
                stdout: '',
                stderr: handleGitError(err),
                exitCode: 1
            }
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

    async clone(url: string, targetDirectory: string, rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const trimmedUrl = url.trim()
            const trimmedTarget = targetDirectory.trim()
            if (!trimmedUrl || !trimmedTarget) return { success: false, error: 'Repository URL and target directory are required' }
            const result = await this.exec(['clone', trimmedUrl, trimmedTarget], rootPath)
            return {
                success: result.exitCode === 0,
                error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
            }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async pull(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['pull'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async push(rootPath?: string, force?: boolean): Promise<{ success: boolean; error?: string }> {
        try {
            const args = force ? ['push', '--force-with-lease'] : ['push']
            const result = await this.exec(args, rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
        } catch (err) {
            return { success: false, error: handleGitError(err) }
        }
    }

    async fetch(rootPath?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await this.exec(['fetch', '--all', '--prune'], rootPath)
            return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined }
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

    async getGitConfig(key: string, rootPath?: string): Promise<string | null> {
        try {
            const result = await this.exec(['config', '--get', key], rootPath)
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

    validateBranchName(name: string): { valid: boolean; suggestion?: string } {
        const config = getScenarioCommitConfig()
        if (!config.branchConvention) return { valid: true }
        if (config.branchConvention.test(name)) return { valid: true }
        return { valid: false, suggestion: `Branch name should match: ${config.branchConvention.source}` }
    }
}

export const gitService = new ScenarioVersionControl()
export { ScenarioVersionControl }
