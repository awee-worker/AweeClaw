/**
 * Lint 错误服务
 * 参考 void 编辑器的 get_lint_errors 功能
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { LintError } from '@intelligence/providerTypes'
import { CacheService } from '@shared/toolkit/CacheManager'
import { getCacheConfig } from '@configuration/agentProfile'
import { useDiagnosticsStore } from '@services/diagnosticRepository'
import { getNpxCommand, joinPath, normalizePath, platform } from '@shared/toolkit/pathHelper'
import { getServerIdForLanguage, LSP_SERVER_DEFINITIONS } from '@shared/languageRegistry'
import { ensureServerForFile, getFileWorkspaceRoot, getLanguageId, waitForDiagnostics } from '@services/languageServerAdapter'

// 支持的语言和对应的 lint 命令
const LINT_COMMANDS: Record<string, {
	getCommand: () => { command: string; args: string[] }
	parser: (output: string, file: string) => LintError[]
}> = {
	typescript: {
		getCommand: () => ({
			command: getNpxCommand(),
			args: ['tsc', '--noEmit', '--pretty', 'false'],
		}),
		parser: parseTscOutput,
	},
	javascript: {
		getCommand: () => ({
			command: getNpxCommand(),
			args: ['eslint', '--format', 'json'],
		}),
		parser: parseEslintOutput,
	},
	python: {
		getCommand: () => ({
			command: 'python',
			args: ['-m', 'pylint', '--output-format=json'],
		}),
		parser: parsePylintOutput,
	},
	// Vue 单文件组件：交给项目自带的 ESLint（配合 eslint-plugin-vue）检查
	vue: {
		getCommand: () => ({
			command: getNpxCommand(),
			args: ['eslint', '--format', 'json'],
		}),
		parser: parseEslintOutput,
	},
}

interface ResolvedLintCommand {
	command: string
	args: string[]
	cwd?: string
}

async function resolveWorkspaceTool(
	workspaceRoot: string | null,
	relativePaths: string[],
	args: string[]
): Promise<ResolvedLintCommand | null> {
	if (!workspaceRoot) return null

	for (const relativePath of relativePaths) {
		const fullPath = joinPath(workspaceRoot, relativePath)
		try {
			if (await api.file.exists(fullPath)) {
				return { command: fullPath, args, cwd: workspaceRoot }
			}
		} catch {
			// ignore and keep falling back
		}
	}

	return null
}

async function resolveLintCommand(filePath: string, language: string): Promise<ResolvedLintCommand | null> {
	const workspaceRoot = getFileWorkspaceRoot(filePath)

	if (language === 'typescript') {
		const localTsc = await resolveWorkspaceTool(
			workspaceRoot,
			[joinPath('node_modules', '.bin', platform.isWindows ? 'tsc.cmd' : 'tsc')],
			['--noEmit', '--pretty', 'false', filePath]
		)
		if (localTsc) return localTsc
	}

	if (language === 'javascript') {
		const localEslint = await resolveWorkspaceTool(
			workspaceRoot,
			[joinPath('node_modules', '.bin', platform.isWindows ? 'eslint.cmd' : 'eslint')],
			['--format', 'json', filePath]
		)
		if (localEslint) return localEslint
	}

	if (language === 'python') {
		const managedPython = await api.python.getPath()
		const pythonCmd = managedPython || 'python'
		const fallback = LINT_COMMANDS[language]
		return {
			command: pythonCmd,
			args: [...fallback.getCommand().args, filePath],
			cwd: workspaceRoot || undefined,
		}
	}

	if (language === 'vue') {
		// Vue 只走项目内 ESLint：.vue 的检查依赖项目自己的 eslint-plugin-vue 配置，
		// 用 npx 临时拉一份 eslint 出来既没有插件也没有配置，报出来的问题不可信。
		const localEslint = await resolveWorkspaceTool(
			workspaceRoot,
			[joinPath('node_modules', '.bin', platform.isWindows ? 'eslint.cmd' : 'eslint')],
			['--format', 'json', filePath]
		)
		return localEslint
	}

	const lintConfig = LINT_COMMANDS[language]
	if (!lintConfig) return null

	const fallback = lintConfig.getCommand()
	return {
		command: fallback.command,
		args: [...fallback.args, filePath],
		cwd: workspaceRoot || undefined,
	}
}

// 文件扩展名到语言的映射
const EXT_TO_LANG: Record<string, string> = {
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	py: 'python',
	vue: 'vue',
	nvue: 'vue',
}

/**
 * 解析 TypeScript 编译器输出
 */
function parseTscOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []
	const lines = output.split('\n')

	// 格式: file(line,col): error TS1234: message
	const regex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/

	for (const line of lines) {
		const match = line.match(regex)
		if (match) {
			const [, filePath, lineNum, , severity, code, message] = match

			// 只返回指定文件的错误
			if (filePath.includes(file) || file.includes(filePath)) {
				errors.push({
					code,
					message,
					severity: severity === 'error' ? 'error' : 'warning',
					startLine: parseInt(lineNum, 10),
					endLine: parseInt(lineNum, 10),
					file: filePath,
				})
			}
		}
	}

	return errors
}

/**
 * 解析 ESLint JSON 输出
 */
function parseEslintOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []

	try {
		const results = JSON.parse(output)

		for (const result of results) {
			if (!result.filePath.includes(file) && !file.includes(result.filePath)) {
				continue
			}

			for (const msg of result.messages || []) {
				errors.push({
					code: msg.ruleId || 'eslint',
					message: msg.message,
					severity: msg.severity === 2 ? 'error' : 'warning',
					startLine: msg.line || 1,
					endLine: msg.endLine || msg.line || 1,
					file: result.filePath,
				})
			}
		}
	} catch {
		// 解析失败，尝试文本格式
		const lines = output.split('\n')
		const regex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(\S+)$/

		for (const line of lines) {
			const match = line.match(regex)
			if (match) {
				const [, lineNum, , severity, message, code] = match
				errors.push({
					code,
					message,
					severity: severity === 'error' ? 'error' : 'warning',
					startLine: parseInt(lineNum, 10),
					endLine: parseInt(lineNum, 10),
					file,
				})
			}
		}
	}

	return errors
}

/**
 * 解析 Pylint JSON 输出
 */
function parsePylintOutput(output: string, file: string): LintError[] {
	const errors: LintError[] = []

	try {
		const results = JSON.parse(output)

		for (const msg of results) {
			if (!msg.path.includes(file) && !file.includes(msg.path)) {
				continue
			}

			errors.push({
				code: msg.symbol || msg['message-id'] || 'pylint',
				message: msg.message,
				severity: msg.type === 'error' || msg.type === 'fatal' ? 'error' : 'warning',
				startLine: msg.line || 1,
				endLine: msg.endLine || msg.line || 1,
				file: msg.path,
			})
		}
	} catch {
		// 解析失败
	}

	return errors
}

/**
 * 从 useDiagnosticsStore 中查找指定文件路径对应的 LSP 诊断。
 * 与 ProblemsView 使用完全相同的数据源和路径规范化逻辑。
 */
function getLspDiagnosticsForFile(filePath: string): LintError[] | null {
	const { diagnostics } = useDiagnosticsStore.getState()
	if (diagnostics.size === 0) return null

	const normalizedTarget = normalizePath(filePath).toLowerCase()

	for (const [uri, diags] of diagnostics) {
		// 与 diagnosticsStore.getFileStats 相同的 URI→path 转换
		let uriPath = uri
		if (uri.startsWith('file:///')) {
			uriPath = decodeURIComponent(uri.slice(8))
		} else if (uri.startsWith('file://')) {
			uriPath = decodeURIComponent(uri.slice(7))
		}

		const normalizedUri = normalizePath(uriPath).toLowerCase()

		if (normalizedUri === normalizedTarget || normalizedUri.endsWith(normalizedTarget)) {
			return diags.map((d) => ({
				code: d.code?.toString() || 'lsp',
				message: d.message,
				severity: d.severity === 1 ? 'error' : 'warning',
				startLine: d.range.start.line + 1,
				endLine: d.range.end.line + 1,
				file: uriPath,
			}))
		}
	}

	return null
}

/** lint 检查结果 */
export interface LintResult {
	errors: LintError[]
	/** LSP 服务器未安装时的提示信息 */
	notInstalled?: string
}

// LSP 服务器安装状态缓存（避免每次 lint 都查询）
let _serverStatusCache: Record<string, { installed: boolean }> | null = null
let _serverStatusTimestamp = 0
const SERVER_STATUS_TTL = 60_000 // 60 秒

async function getServerStatus(): Promise<Record<string, { installed: boolean }>> {
	if (_serverStatusCache && Date.now() - _serverStatusTimestamp < SERVER_STATUS_TTL) {
		return _serverStatusCache
	}
	try {
		_serverStatusCache = await api.lsp.getServerStatus()
		_serverStatusTimestamp = Date.now()
	} catch {
		_serverStatusCache = {}
	}
	return _serverStatusCache!
}

// ── 语言服务器按需安装（B 方案）────────────────────────────────────────
//
// 用户遇到 .vue 这类未安装服务器的语言时，看到的只是一条「未安装」提示，
// 很难意识到要去设置里点一次安装。这里在首次 lint 时静默装一次：
//   - 同一 serverId 只发起一次安装，后续调用复用同一个 Promise
//   - 超过等待上限就放行 lint，安装继续在后台跑，下次检查即可用
//   - 失败在本次会话内记下，不再反复尝试（否则每次 lint 都要卡一个 npm 超时）

const AUTO_INSTALL_WAIT_MS = 25_000
const autoInstallTasks = new Map<string, Promise<boolean>>()
const autoInstallFailed = new Set<string>()
/** 已经等满一次超时、仍在后台安装的服务器 */
const autoInstallPending = new Set<string>()

type OnDemandInstallOutcome = 'installed' | 'pending' | 'skipped'

function runOnDemandInstall(serverId: string): Promise<boolean> {
	const existing = autoInstallTasks.get(serverId)
	if (existing) return existing

	const task = (async () => {
		try {
			const result = await api.lsp.installServer(serverId)
			if (result?.success) {
				// 状态缓存有 60 秒 TTL，安装成功必须立刻失效，否则还会读到「未安装」
				_serverStatusCache = null
				_serverStatusTimestamp = 0
				logger.agent.info(`[Lint] Language server "${serverId}" installed on demand`)
				return true
			}
			autoInstallFailed.add(serverId)
			logger.agent.warn(`[Lint] On-demand install failed for "${serverId}": ${result?.error || 'unknown'}`)
			return false
		} catch (error) {
			autoInstallFailed.add(serverId)
			logger.agent.warn(`[Lint] On-demand install threw for "${serverId}"`, error)
			return false
		}
	})()

	autoInstallTasks.set(serverId, task)
	return task
}

async function tryOnDemandInstall(
	serverId: string,
	serverDef: typeof LSP_SERVER_DEFINITIONS[number] | undefined,
): Promise<OnDemandInstallOutcome> {
	// 不可自动安装的（rust / deno 之类）以及已经失败过的，直接跳过
	if (!serverDef?.installable || autoInstallFailed.has(serverId)) return 'skipped'

	// 上一轮已经等满过一次超时：安装还在后台跑，这次只做一次状态确认，
	// 不再阻塞调用方（否则一次慢安装会让连续几次 lint 各卡一个等待周期）
	if (autoInstallPending.has(serverId)) {
		const installedNow = await queryServerInstalled(serverId)
		if (installedNow) {
			autoInstallPending.delete(serverId)
			return 'installed'
		}
		return 'pending'
	}

	const task = runOnDemandInstall(serverId)
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => resolve('timeout'), AUTO_INSTALL_WAIT_MS)
	})

	try {
		const outcome = await Promise.race([task, timeout])
		if (outcome === 'timeout') {
			autoInstallPending.add(serverId)
			return 'pending'
		}
		return outcome ? 'installed' : 'skipped'
	} finally {
		if (timer) clearTimeout(timer)
	}
}

/** 绕开 TTL 缓存直接查一次安装状态（后台安装完成后用它确认） */
async function queryServerInstalled(serverId: string): Promise<boolean> {
	try {
		const status = await api.lsp.getServerStatus()
		_serverStatusCache = status
		_serverStatusTimestamp = Date.now()
		return !!status[serverId]?.installed
	} catch {
		return false
	}
}

class LintService {
	private cache: CacheService<LintError[]>

	constructor() {
		const cacheConfig = getCacheConfig('lint')

		this.cache = new CacheService<LintError[]>('LintErrors', {
			maxSize: cacheConfig.maxSize,
			defaultTTL: cacheConfig.ttlMs,
			cleanupInterval: 60000,
		})
	}

	/**
	 * 获取文件的 lint 错误
	 */
	async getLintErrors(filePath: string, forceRefresh: boolean = false): Promise<LintResult> {
		// 1. 优先使用 LSP 诊断信息（与面板完全相同的数据源，支持所有 LSP 语言）
		const lspErrors = getLspDiagnosticsForFile(filePath)
		if (lspErrors !== null) {
			// LSP 已推送过诊断，直接返回（空数组表示该文件无错误）
			return { errors: lspErrors }
		}

		// 2. 检查该语言是否有对应的 LSP 服务器
		const languageId = getLanguageId(filePath)
		const serverId = getServerIdForLanguage(languageId)
		const ext = filePath.split('.').pop()?.toLowerCase() || ''
		const lang = EXT_TO_LANG[ext]
		const lintConfig = lang ? LINT_COMMANDS[lang] : undefined

		if (serverId) {
			const serverDef = LSP_SERVER_DEFINITIONS.find(s => s.id === serverId)
			const status = await getServerStatus()
			let installed = !!status[serverId]?.installed

			if (!installed) {
				// 首次遇到未安装的服务器时静默装一次（B 方案）。
				// 用户通常不知道要去设置里点安装，只有一句「未安装」提示等于什么都不做。
				const outcome = await tryOnDemandInstall(serverId, serverDef)
				if (outcome === 'installed') {
					installed = true
				} else if (!lintConfig) {
					// 既装不上、也没有 CLI 兜底 → 只能引导用户手动处理
					const serverName = serverDef?.name || serverId
					const serverDesc = serverDef?.description || serverId
					const state = outcome === 'pending'
						? `is being installed in the background, so ${languageId} files were not lint-checked this time. Retry in a moment.`
						: `is not installed, so ${languageId} files were not lint-checked. Install it in Settings > Language Servers (设置 → 语言服务器) to enable lint checking for these files.`
					return { errors: [], notInstalled: `Language server "${serverName}" (${serverDesc}) ${state}` }
				}
				// 有 CLI 兜底的语言（如 .vue → 项目内 ESLint）继续往下走
			}

			if (installed) {
				// 主动向常驻语言服务要一次诊断（不再限于强制刷新）。
				//
				// 写文件后的诊断是异步推送的：紧接着发生的 lint 调用往往还没在诊断
				// store 里看到结果。若此时直接走 CLI 回退，就会为一次检查拉起
				// `npm exec tsc --noEmit` 全量编译（实测单次就要 20-30s、占满 2-3 个
				// 核，是整个会话里最大的单项 CPU 开销）；而语言服务是常驻且增量更新的，
				// 要一次诊断只需毫秒级。因此先问 LSP，确实拿不到再考虑 CLI。
				// waitForDiagnostics 在语言服务侧有 3 秒超时，最坏情况也只是多等一次超时。
				try {
					const serverReady = await ensureServerForFile(filePath)
					if (serverReady) {
						await waitForDiagnostics(filePath)
						const refreshedErrors = getLspDiagnosticsForFile(filePath)
						if (refreshedErrors !== null) {
							return { errors: refreshedErrors }
						}
					}
				} catch (error) {
					logger.agent.warn('[Lint] Failed to refresh diagnostics via LSP, falling back if available:', error)
				}
			}
		}


		// 3. 没有可用的 LSP 诊断 → 尝试 CLI 回退
		if (languageId === 'plaintext') {
			return { errors: [], notInstalled: `Unsupported file type for lint checking.` }
		}

		// 检查缓存
		if (!forceRefresh) {
			const cached = this.cache.get(filePath)
			if (cached) {
				return { errors: cached }
			}
		}

		if (!lintConfig || !lang) {
			return { errors: [] }
		}


		try {
			const resolvedCommand = await resolveLintCommand(filePath, lang)
			if (!resolvedCommand) {
				// .vue 两条路都断了：LSP 没装上、项目内也没有 ESLint。
				// 说清楚原因，否则空结果会被误读成「检查通过」。
				if (lang === 'vue') {
					return {
						errors: [],
						notInstalled: 'No Vue lint backend available: the Vue language server is not installed and this project has no local ESLint, so .vue files were not lint-checked. Install the Vue language server in Settings > Language Servers, or add eslint-plugin-vue to the project. (当前项目未安装 Vue 语言服务器，也没有本地 ESLint，.vue 文件未做检查。)',
					}
				}
				return { errors: [] }
			}

			const result = await api.shell.executeSecure({
				command: resolvedCommand.command,
				args: resolvedCommand.args,
				cwd: resolvedCommand.cwd,
				timeout: 60000,
				requireConfirm: false
			})
			const output = (result.output || '') + (result.errorOutput || '')
			const errors = lintConfig.parser(output, filePath)

			this.cache.set(filePath, errors)
			return { errors }
		} catch (error) {
			logger.agent.error('Lint error:', error)
			return { errors: [] }
		}
	}

	/**
	 * 批量获取多个文件的 lint 错误
	 */
	async getLintErrorsForFiles(filePaths: string[], forceRefresh: boolean = false): Promise<Map<string, LintResult>> {
		const results = new Map<string, LintResult>()

		// 并行执行，但限制并发数
		const batchSize = 3
		for (let i = 0; i < filePaths.length; i += batchSize) {
			const batch = filePaths.slice(i, i + batchSize)
			const batchResults = await Promise.all(
				batch.map(async (path) => ({
					path,
					result: await this.getLintErrors(path, forceRefresh),
				}))
			)

			for (const { path, result } of batchResults) {
				results.set(path, result)
			}
		}

		return results
	}

	/**
	 * 简单的语法检查（不依赖外部工具）
	 */
	quickSyntaxCheck(content: string, language: string): LintError[] {
		const errors: LintError[] = []
		const lines = content.split('\n')

		if (language === 'typescript' || language === 'javascript') {
			// 检查括号匹配
			const brackets: { char: string; line: number }[] = []
			const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
			const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				let inString = false
				let stringChar = ''

				for (let j = 0; j < line.length; j++) {
					const char = line[j]
					const prevChar = line[j - 1]

					// 跳过字符串内容
					if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
						if (!inString) {
							inString = true
							stringChar = char
						} else if (char === stringChar) {
							inString = false
						}
						continue
					}

					if (inString) continue

					if (pairs[char]) {
						brackets.push({ char, line: i + 1 })
					} else if (closers[char]) {
						const last = brackets.pop()
						if (!last || last.char !== closers[char]) {
							errors.push({
								code: 'syntax',
								message: `Unmatched '${char}'`,
								severity: 'error',
								startLine: i + 1,
								endLine: i + 1,
								file: '',
							})
						}
					}
				}
			}

			// 检查未闭合的括号
			for (const bracket of brackets) {
				errors.push({
					code: 'syntax',
					message: `Unclosed '${bracket.char}'`,
					severity: 'error',
					startLine: bracket.line,
					endLine: bracket.line,
					file: '',
				})
			}
		}

		return errors
	}

	/**
	 * 清除缓存
	 */
	clearCache(filePath?: string): void {
		if (filePath) {
			this.cache.delete(filePath)
		} else {
			this.cache.clear()
		}
	}

	/**
	 * 获取缓存统计
	 */
	getCacheStats() {
		return {
			lint: this.cache.getStats(),
		}
	}

	/**
	 * 格式化错误为字符串
	 */
	formatErrors(errors: LintError[]): string {
		if (errors.length === 0) {
			return '✅ No lint errors found'
		}

		const errorCount = errors.filter(e => e.severity === 'error').length
		const warningCount = errors.filter(e => e.severity === 'warning').length

		let output = `Found ${errorCount} error(s), ${warningCount} warning(s):\n\n`

		for (const error of errors.slice(0, 20)) {
			const icon = error.severity === 'error' ? '❌' : '⚠️'
			output += `${icon} Line ${error.startLine}: [${error.code}] ${error.message}\n`
		}

		if (errors.length > 20) {
			output += `\n... and ${errors.length - 20} more issues`
		}

		return output
	}

	/**
	 * 销毁服务
	 */
	dispose() {
		this.cache.destroy()
	}
}

// 单例导出
export const lintService = new LintService()
