/**
 * 路径处理工具集
 *
 * 架构分层：
 * 1. 路径安全层 — 路径穿越检测、敏感路径识别、工作区边界校验
 * 2. 路径规范化层 — 分隔符统一、大小写处理、路径比较
 * 3. 路径解析层 — 相对/绝对路径转换、模块导入解析
 * 4. 跨平台层 — 平台检测、可执行文件名、包管理器命令
 * 5. URI 转换层 — file:// URI 与路径互转
 * 6. 场景感知层 — 法律/医疗/教育场景的路径策略
 *
 * 用于 main 和 renderer 进程
 */

import {
  isSensitivePath as sharedIsSensitivePath,
  hasPathTraversal as sharedHasPathTraversal,
} from '@shared/appConstants'
import { BRAND } from '@shared/brand'

/* ================================================================== */
/* 第一层：路径安全                                                    */
/* ================================================================== */

export const hasPathTraversal = sharedHasPathTraversal
export const isSensitivePath = sharedIsSensitivePath

/**
 * 判断路径是否位于工作区范围内
 *
 * 同时支持绝对路径与以 "./" 开头的相对路径
 */
export function isPathWithinWorkspace(target: string, workspaceRoot: string): boolean {
  if (!workspaceRoot) return false

  let candidate = target
  if (candidate.startsWith('./') || candidate.startsWith('.\\')) {
    candidate = candidate.slice(2)
  }

  const normalizedCandidate = normalizeFilePath(candidate)
  if (pathHasPrefix(normalizedCandidate, normalizeFilePath(workspaceRoot))) {
    return true
  }

  const resolvedCandidate = normalizeFilePath(resolveToAbsolute(candidate, workspaceRoot))
  return pathHasPrefix(resolvedCandidate, normalizeFilePath(workspaceRoot))
}

export interface PathSafetyAssertion {
  valid: boolean
  error?: string
  sanitizedPath?: string
}

/**
 * 校验路径安全性，返回校验结果与规范化后的路径
 *
 * @param target 待校验的路径
 * @param workspaceRoot 工作区根目录
 * @param options.allowSensitive 是否允许访问敏感路径（如 .ssh、.aws）
 * @param options.allowOutsideWorkspace 是否允许访问工作区外路径（跳过工作区边界检查）
 * @param options.extraAllowedRoots 额外允许访问的根目录列表（如项目目录），
 *        路径在这些目录下也视为合法，用于项目目录不在工作区内时的放行
 */
export function assertPathSafety(
  target: string,
  workspaceRoot: string | null,
  options?: {
    allowSensitive?: boolean
    allowOutsideWorkspace?: boolean
    extraAllowedRoots?: string[]
  }
): PathSafetyAssertion {
  const { allowSensitive = false, allowOutsideWorkspace = false, extraAllowedRoots = [] } = options || {}
  if (!target || typeof target !== 'string') {
    return { valid: false, error: 'Invalid path: empty or not a string' }
  }
  if (hasPathTraversal(target)) {
    return { valid: false, error: 'Path traversal detected' }
  }
  if (!allowSensitive && isSensitivePath(target)) {
    return { valid: false, error: 'Access to sensitive path denied' }
  }
  if (!allowOutsideWorkspace && workspaceRoot && !isPathWithinWorkspace(target, workspaceRoot)) {
    // 不在工作区内时，检查是否在额外允许的根目录下（如项目目录）
    const inExtraRoot = extraAllowedRoots.some(root =>
      root && isPathWithinWorkspace(target, root)
    )
    if (!inExtraRoot) {
      return { valid: false, error: 'Path is outside workspace' }
    }
  }
  return { valid: true, sanitizedPath: resolveToAbsolute(target, workspaceRoot) }
}

/* ================================================================== */
/* 第二层：路径规范化                                                  */
/* ================================================================== */

/** 将任意值安全转为字符串，非字符串返回空串 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 规范化路径：统一分隔符为正斜杠
 *
 * 与 Node.js path.posix 不同，此函数仅做分隔符替换，不解析 ".." 或 "."
 */
export function normalizeFilePath(path: unknown): string {
  return asString(path).replace(/\\/g, '/')
}

/** 路径比较（忽略大小写和分隔符差异） */
export function pathsAreEqual(path1: string, path2: string): boolean {
  return normalizeFilePath(path1).toLowerCase() === normalizeFilePath(path2).toLowerCase()
}

/**
 * 路径前缀比较（忽略大小写和分隔符差异）
 *
 * 确保 prefix 以分隔符结尾或完全匹配，避免 /foo 误匹配 /foobar
 */
export function pathHasPrefix(path: string, prefix: string): boolean {
  const normalizedPath = normalizeFilePath(path).toLowerCase()
  const normalizedPrefix = normalizeFilePath(prefix).toLowerCase()
  if (normalizedPath === normalizedPrefix) return true
  const slashTerminatedPrefix = normalizedPrefix.endsWith('/') ? normalizedPrefix : normalizedPrefix + '/'
  return normalizedPath.startsWith(slashTerminatedPrefix)
}

/** 检测路径使用的分隔符（反斜杠或正斜杠） */
export function detectSeparator(path: unknown): string {
  return asString(path).includes('\\') ? '\\' : '/'
}

/** 提取路径中的文件名（含扩展名） */
export function extractFileName(path: unknown): string {
  const safePath = asString(path)
  if (!safePath) return ''
  return safePath.split(/[/\\]/).pop() || ''
}

/** 提取路径中的目录部分 */
export function extractDirectory(path: unknown): string {
  const normalized = normalizeFilePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
}

/** 提取文件扩展名（小写，不含点） */
export function extractExtension(path: unknown): string {
  const fileName = extractFileName(path)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

/**
 * 拼接多个路径段，统一使用正斜杠
 *
 * 适用于 URL 风格的路径拼接
 */
export function concatPathSegments(...segments: string[]): string {
  return segments.map(s => s.replace(/\\/g, '/')).join('/').replace(/\/+/g, '/')
}

/**
 * 构建路径，保留原始分隔符风格
 *
 * 适用于文件系统路径拼接
 */
export function buildPath(...segments: string[]): string {
  if (segments.length === 0) return ''
  const sep = detectSeparator(segments[0])
  return segments.filter(Boolean).join(sep).replace(/[/\\]+/g, sep)
}

/* ================================================================== */
/* 第三层：路径解析                                                    */
/* ================================================================== */

/**
 * 将相对路径解析为绝对路径
 *
 * 处理 "./" 和 "." 前缀，保留已是绝对路径的输入
 */
export function resolveToAbsolute(relativePath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return relativePath

  // 已经是绝对路径
  if (relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) return relativePath

  // 处理 "./" 和 "." 开头的路径
  let candidate = relativePath
  if (candidate === '.') {
    return workspaceRoot
  }
  if (candidate.startsWith('./')) {
    candidate = candidate.slice(2)
  }
  if (candidate.startsWith('.\\')) {
    candidate = candidate.slice(2)
  }

  // 如果清理后是空字符串，返回 workspace 路径
  if (!candidate) return workspaceRoot

  const sep = detectSeparator(workspaceRoot)
  return `${workspaceRoot}${sep}${candidate}`
}

/**
 * 折叠路径中的 "." 与 ".." 片段（纯词法处理，不访问文件系统）
 *
 * 为什么需要：assertPathSafety 会把含 ".." 的原始输入直接判为「目录穿越」，
 * 于是 "src/../lib/x.ts"、"../b/y.ts"（折叠后仍落在工作区内）这类合法写法被误判，
 * AI 侧表现为「Path is outside workspace / 路径校验失败」。
 * 先按工作区根解析成绝对路径、再折叠、最后才做边界校验，
 * 既能放行合法写法，也不会放过真正逃出工作区的路径。
 *
 * 规则：
 * - 反斜杠统一成正斜杠；"." 片段丢弃；".." 折叠上一级
 * - 已经到根 / 盘符首层时，多余的 ".." 被丢弃（避免产出 "/.." 这类非法片段）
 * - 无根可折叠的相对路径（如 "../x"）保留 ".."，交由上层边界校验判定
 * - 保留前导 "/"（POSIX 根）、"//"（UNC）与 Windows 盘符 "C:"
 */
export function collapsePathSegments(target: unknown): string {
  const normalized = normalizeFilePath(target)
  if (!normalized) return ''

  const drive = (normalized.match(/^[a-zA-Z]:/) || [''])[0]
  let rest = drive ? normalized.slice(drive.length) : normalized

  const leadingSlashes = Math.min((rest.match(/^\/+/) || [''])[0].length, 2)
  rest = rest.replace(/^\/+/, '')

  const hasRoot = Boolean(drive) || leadingSlashes > 0
  const segments: string[] = []

  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      const last = segments[segments.length - 1]
      if (last !== undefined && last !== '..') {
        segments.pop()
      } else if (!hasRoot) {
        segments.push('..')
      }
      continue
    }
    segments.push(part)
  }

  const body = segments.join('/')
  const prefix = drive
    ? `${drive}${body ? '/' : ''}`
    : leadingSlashes > 0
      ? '/'.repeat(leadingSlashes)
      : ''

  return `${prefix}${body}`
}

/**
 * 解析工具入参路径：相对路径按工作区根展开为绝对路径，并折叠 "." / ".."
 *
 * 与 assertPathSafety 搭配使用（先折叠、后校验），避免合法相对写法被误判为目录穿越。
 */
export function resolveToolPathInput(target: string, workspaceRoot: string | null): string {
  return collapsePathSegments(resolveToAbsolute(target, workspaceRoot))
}

/**
 * 将绝对路径解析为相对于工作区的路径
 *
 * 如果路径不在工作区内，返回原始路径
 */
export function resolveToRelative(absolutePath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return absolutePath
  const normalizedAbs = normalizeFilePath(absolutePath)
  const normalizedRoot = normalizeFilePath(workspaceRoot)

  if (pathHasPrefix(normalizedAbs, normalizedRoot)) {
    let relative = normalizedAbs.slice(normalizedRoot.length)
    if (relative.startsWith('/') || relative.startsWith('\\')) relative = relative.slice(1)
    return relative
  }
  return absolutePath
}

/**
 * 匹配路径模式（支持 * 通配符）
 */
export function matchPathPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizeFilePath(path)
  const normalizedPattern = normalizeFilePath(pattern)
  if (normalizedPattern.includes('*')) {
    const regex = new RegExp('^' + normalizedPattern.replace(/\*/g, '.*') + '$')
    return regex.test(normalizedPath)
  }
  return normalizedPath === normalizedPattern || normalizedPath.endsWith('/' + normalizedPattern)
}

/**
 * 解析模块导入路径
 *
 * 支持：
 * - 相对路径（./ 或 ../）
 * - 别名路径（@/ 或 ~/）
 * - 裸模块路径（自动添加 src/ 前缀）
 */
export function resolveModuleImport(
  importPath: string,
  currentFilePath: string,
  workspaceRoot: string
): string {
  const sep = detectSeparator(currentFilePath)
  const currentDir = extractDirectory(currentFilePath)
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const parts = [...currentDir.split(/[/\\]/), ...importPath.split(/[/\\]/)]
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else if (part !== '.' && part !== '') resolved.push(part)
    }
    return resolved.join(sep)
  }
  if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
    return buildPath(workspaceRoot, importPath.slice(2))
  }
  if (!importPath.startsWith('/')) {
    return buildPath(workspaceRoot, 'src', importPath)
  }
  return importPath
}

/**
 * 拼接「指定根目录下的附件上传目录」绝对路径
 *
 * 附件目录名取自 BRAND.paths.uploads（单一真相源），但拼接点有三处：
 * 聊天窗口落盘、桌面伴侣迷你聊天落盘、主进程只读可信目录注册。
 * 集中在此，避免各写一份拼接逻辑导致「落盘目录」与「放行目录」不一致。
 *
 * @param root 根目录（工作区根目录，或应用 userData 目录）
 */
export function resolveUploadDir(root: string): string {
  return `${root.replace(/[/\\]+$/, '')}/${BRAND.paths.uploads}`
}

/* ================================================================== */
/* 第四层：跨平台工具                                                  */
/* ================================================================== */

/**
 * 运行时平台检测
 *
 * 支持三种检测方式，按优先级递减：
 * 1. Node.js process.platform（main 进程）
 * 2. navigator.userAgentData（现代 Chromium renderer）
 * 3. navigator.userAgent（兜底）
 */
function detectRuntimePlatform() {
  // 1. Node.js / Electron main 进程
  if (typeof process !== 'undefined' && process.platform) {
    return {
      isWindows: process.platform === 'win32',
      isMac: process.platform === 'darwin',
      isLinux: process.platform === 'linux',
    }
  }

  // 2. Renderer 进程 fallback：navigator.userAgentData（现代 Chromium API）
  if (typeof navigator !== 'undefined') {
    const uad = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    if (uad?.platform) {
      const p = uad.platform.toLowerCase()
      return {
        isWindows: p === 'windows',
        isMac: p === 'macos',
        isLinux: p === 'linux',
      }
    }

    // 3. 兜底：navigator.userAgent
    const ua = navigator.userAgent || ''
    return {
      isWindows: ua.includes('Windows'),
      isMac: ua.includes('Macintosh') || ua.includes('Mac OS'),
      isLinux: ua.includes('Linux') && !ua.includes('Android'),
    }
  }

  // 4. 未知环境
  return { isWindows: false, isMac: false, isLinux: false }
}

export const platform = detectRuntimePlatform()

/**
 * 获取可执行文件名（Windows 自动添加 .exe 扩展名）
 * @example platformExecutableName('gopls') => 'gopls.exe' (Windows) / 'gopls' (Unix)
 */
export function platformExecutableName(name: string): string {
  return platform.isWindows ? `${name}.exe` : name
}

/**
 * 获取 npm 命令（Windows 使用 npm.cmd）
 */
export function platformNpmCommand(): string {
  return platform.isWindows ? 'npm.cmd' : 'npm'
}

/**
 * 获取 npx 命令（Windows 使用 npx.cmd）
 */
export function platformNpxCommand(): string {
  return platform.isWindows ? 'npx.cmd' : 'npx'
}

/* ================================================================== */
/* 第五层：URI 转换                                                    */
/* ================================================================== */

/**
 * 路径转为 file:// URI 格式
 * @example convertPathToUri('C:/foo/bar.ts') => 'file:///C:/foo/bar.ts'
 */
export function convertPathToUri(filePath: string): string {
  const normalized = normalizeFilePath(filePath)
  // Windows 绝对路径：C:/...
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  // Unix 绝对路径：/home/...
  return `file://${normalized}`
}

/**
 * file:// URI 转为路径格式
 * @example convertUriToPath('file:///C:/foo/bar.ts') => 'C:/foo/bar.ts'
 */
export function convertUriToPath(uri: string): string {
  if (uri.startsWith('file:///')) {
    const path = uri.slice(8)
    if (/^[a-zA-Z]:/.test(path)) {
      return path
    }
    return '/' + path
  }
  if (uri.startsWith('file://')) {
    return uri.slice(7)
  }
  return uri
}

/* ================================================================== */
/* 第六层：场景感知路径工具                                            */
/* ================================================================== */

export type ScenarioPathDomain = 'legal' | 'medical' | 'education' | 'general'

export interface ScenarioPathConfig {
    domain: ScenarioPathDomain
    restrictedPatterns: RegExp[]
    workspaceSubdirs: string[]
    importAliases: Record<string, string>
    auditPathAccess: boolean
}

const SCENARIO_PATH_CONFIGS: Record<ScenarioPathDomain, ScenarioPathConfig> = {
    legal: {
        domain: 'legal',
        restrictedPatterns: [
            /\/\.env/i,
            /\/secrets?\//i,
            /\/private\//i,
        ],
        workspaceSubdirs: ['contracts', 'cases', 'templates', 'audit', 'compliance'],
        importAliases: {
            '@legal': 'legal',
            '@contracts': 'legal/contracts',
            '@templates': 'legal/templates',
        },
        auditPathAccess: true,
    },
    medical: {
        domain: 'medical',
        restrictedPatterns: [
            /\/patient[_-]?records?\//i,
            /\/phi\//i,
            /\/hipaa\//i,
            /\/diagnosis\//i,
        ],
        workspaceSubdirs: ['records', 'protocols', 'audit', 'compliance', 'research'],
        importAliases: {
            '@medical': 'medical',
            '@protocols': 'medical/protocols',
            '@research': 'medical/research',
        },
        auditPathAccess: true,
    },
    education: {
        domain: 'education',
        restrictedPatterns: [],
        workspaceSubdirs: ['courses', 'assignments', 'resources', 'assessments'],
        importAliases: {
            '@education': 'education',
            '@courses': 'education/courses',
            '@resources': 'education/resources',
        },
        auditPathAccess: false,
    },
    general: {
        domain: 'general',
        restrictedPatterns: [],
        workspaceSubdirs: ['src', 'docs', 'tests'],
        importAliases: {},
        auditPathAccess: false,
    },
}

export function getScenarioPathConfig(domain: ScenarioPathDomain): ScenarioPathConfig {
    return SCENARIO_PATH_CONFIGS[domain]
}

export function getScenarioWorkspaceSubdirs(domain: ScenarioPathDomain): string[] {
    return [...SCENARIO_PATH_CONFIGS[domain].workspaceSubdirs]
}

export function validateScenarioPath(
    filePath: string,
    domain: ScenarioPathDomain
): { allowed: boolean; reason?: string } {
    const config = SCENARIO_PATH_CONFIGS[domain]
    for (const pattern of config.restrictedPatterns) {
        if (pattern.test(filePath)) {
            return {
                allowed: false,
                reason: `Path restricted by ${domain} scenario policy: ${pattern.source}`,
            }
        }
    }
    return { allowed: true }
}

export function resolveScenarioImportPath(
    importPath: string,
    currentFilePath: string,
    workspacePath: string,
    domain: ScenarioPathDomain = 'general'
): string {
    const config = SCENARIO_PATH_CONFIGS[domain]

    for (const [alias, target] of Object.entries(config.importAliases)) {
        if (importPath === alias || importPath.startsWith(alias + '/')) {
            const remaining = importPath.slice(alias.length)
            const resolved = buildPath(workspacePath, target, remaining)
            return resolved
        }
    }

    return resolveModuleImport(importPath, currentFilePath, workspacePath)
}

export function isScenarioRestrictedPath(
    filePath: string,
    domain: ScenarioPathDomain
): boolean {
    const config = SCENARIO_PATH_CONFIGS[domain]
    return config.restrictedPatterns.some(p => p.test(filePath))
}

/* ================================================================== */
/* 向后兼容别名（供逐步迁移使用）                                      */
/* ================================================================== */

export const isPathInWorkspace = isPathWithinWorkspace
export const validatePath = assertPathSafety
export const pathEquals = pathsAreEqual
export const pathStartsWith = pathHasPrefix
export const normalizePath = normalizeFilePath
export const getPathSeparator = detectSeparator
export const getFileName = extractFileName
export const getBasename = extractFileName
export const getDirname = extractDirectory
export const getDirPath = extractDirectory
export const getExtension = extractExtension
export const joinPaths = concatPathSegments
export const joinPath = buildPath
export const toFullPath = resolveToAbsolute
export const toRelativePath = resolveToRelative
export const pathMatches = matchPathPattern
export const resolveImportPath = resolveModuleImport
export const getExecutableName = platformExecutableName
export const getNpmCommand = platformNpmCommand
export const getNpxCommand = platformNpxCommand
export const pathToUri = convertPathToUri
export const uriToPath = convertUriToPath
