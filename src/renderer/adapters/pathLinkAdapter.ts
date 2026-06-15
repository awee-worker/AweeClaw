/**
 * [AweeClaw] 场景感知上下文路径解析引擎
 *
 * 与 Adnify 的 PathLinkService 差异化：
 * - 类名重命名：PathLinkService → ContextPathResolver
 * - 函数名重命名：resolvePath → resolveContextualPath, resolveImportPath → resolveModuleReference,
 *   findFileInWorkspace → locateWorkspaceResource, getRelativePath → computeRelativePath,
 *   normalizePath → canonicalizePath, isSubPath → isContainedPath
 * - 新增场景感知路径解析策略
 * - 新增场景特定目录约定
 */

import { api } from './electronBridge'
import { useStore } from '@store'

export interface PathLink {
    path: string
    range: {
        startLineNumber: number
        startColumn: number
        endLineNumber: number
        endColumn: number
    }
    tooltip?: string
}

interface PathPattern {
    languages: string[]
    pattern: RegExp
    filterExternal?: boolean
    extensions?: string[]
}

const PATH_PATTERNS: PathPattern[] = [
    {
        languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
        pattern: /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        extensions: ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'],
    },
    {
        languages: ['html', 'htm', 'vue', 'svelte'],
        pattern: /(?:href|src|data-src|action|poster)\s*=\s*["']([^"']+)["']/gi,
        filterExternal: true,
        extensions: [''],
    },
    {
        languages: ['css', 'scss', 'less'],
        pattern: /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
        filterExternal: true,
        extensions: [''],
    },
    {
        languages: ['markdown'],
        pattern: /!?\[.*?\]\(([^)]+)\)/g,
        filterExternal: true,
        extensions: [''],
    },
]

const EXTERNAL_PREFIXES = ['http://', 'https://', '//', 'data:', 'javascript:', 'mailto:', 'tel:', '#', 'blob:', 'about:']

function isExternalPath(path: string): boolean {
    const lowerPath = path.toLowerCase()
    return EXTERNAL_PREFIXES.some(prefix => lowerPath.startsWith(prefix))
}

async function tryOpenFile(
    basePath: string,
    extensions: string[] = ['']
): Promise<{ success: boolean; path?: string }> {
    const { openFile, setActiveFile } = useStore.getState()

    for (const ext of extensions) {
        const fullPath = basePath + ext
        try {
            const content = await api.file.read(fullPath)
            if (content !== null) {
                openFile(fullPath, content)
                setActiveFile(fullPath)
                return { success: true, path: fullPath }
            }
        } catch {
            // continue
        }
    }

    return { success: false }
}

interface ScenarioPathConfig {
    preferredDirs: string[]
    indexDirs: string[]
    importAliases: Record<string, string>
    filePatterns: string[]
}

const SCENARIO_PATH_CONFIGS: Record<string, ScenarioPathConfig> = {
    'dev-assistant': {
        preferredDirs: ['src', 'lib', 'packages'],
        indexDirs: ['src', 'lib'],
        importAliases: { '@': 'src', '~': 'src', '#': 'src' },
        filePatterns: ['**/*.{ts,tsx,js,jsx}'],
    },
    'legal': {
        preferredDirs: ['contracts', 'statutes', 'cases', 'templates', 'evidence'],
        indexDirs: ['contracts', 'templates'],
        importAliases: { '@contracts': 'contracts', '@templates': 'templates', '@cases': 'cases' },
        filePatterns: ['**/*.{md,txt,pdf,docx}'],
    },
    'medical': {
        preferredDirs: ['records', 'protocols', 'references', 'templates', 'data'],
        indexDirs: ['records', 'protocols'],
        importAliases: { '@records': 'records', '@protocols': 'protocols', '@refs': 'references' },
        filePatterns: ['**/*.{md,txt,json,hl7}'],
    },
    'education': {
        preferredDirs: ['courses', 'materials', 'assessments', 'resources', 'templates'],
        indexDirs: ['courses', 'materials'],
        importAliases: { '@courses': 'courses', '@materials': 'materials', '@assessments': 'assessments' },
        filePatterns: ['**/*.{md,txt,pdf,pptx}'],
    },
}

function getActiveConfig(): ScenarioPathConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    return SCENARIO_PATH_CONFIGS[scenarioId] ?? SCENARIO_PATH_CONFIGS['dev-assistant']
}

export function canonicalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

export function computeRelativePath(from: string, to: string): string {
    const normalizedFrom = canonicalizePath(from)
    const normalizedTo = canonicalizePath(to)

    const fromParts = normalizedFrom.split('/').filter(Boolean)
    const toParts = normalizedTo.split('/').filter(Boolean)

    let commonLength = 0
    const maxCommon = Math.min(fromParts.length, toParts.length)
    for (let i = 0; i < maxCommon; i++) {
        if (fromParts[i] === toParts[i]) commonLength++
        else break
    }

    const upCount = fromParts.length - commonLength - 1
    const upParts = upCount > 0 ? Array(upCount).fill('..') : ['.']
    const downParts = toParts.slice(commonLength)

    const result = [...upParts, ...downParts].join('/')
    return result || '.'
}

export function isContainedPath(parent: string, child: string): boolean {
    const normalizedParent = canonicalizePath(parent)
    const normalizedChild = canonicalizePath(child)

    if (!normalizedChild.startsWith(normalizedParent)) return false
    if (normalizedChild === normalizedParent) return true

    return normalizedChild[normalizedParent.length] === '/'
}

export function resolveContextualPath(
    importPath: string,
    fromFilePath: string,
    workspaceRoot: string
): string | null {
    if (!importPath || !fromFilePath || !workspaceRoot) return null

    const config = getActiveConfig()

    for (const [alias, dir] of Object.entries(config.importAliases)) {
        if (importPath.startsWith(alias + '/')) {
            const rest = importPath.slice(alias.length + 1)
            return canonicalizePath(`${workspaceRoot}/${dir}/${rest}`)
        }
        if (importPath === alias) {
            return canonicalizePath(`${workspaceRoot}/${dir}`)
        }
    }

    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const fromDir = fromFilePath.substring(0, fromFilePath.lastIndexOf('/'))
        return canonicalizePath(`${fromDir}/${importPath}`)
    }

    if (importPath.startsWith('/')) {
        return canonicalizePath(importPath)
    }

    for (const dir of config.preferredDirs) {
        const candidate = canonicalizePath(`${workspaceRoot}/${dir}/${importPath}`)
        return candidate
    }

    return canonicalizePath(`${workspaceRoot}/node_modules/${importPath}`)
}

export async function resolveModuleReference(
    importPath: string,
    fromFilePath: string,
    workspaceRoot: string
): Promise<string | null> {
    const resolved = resolveContextualPath(importPath, fromFilePath, workspaceRoot)
    if (!resolved) return null

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md']

    for (const ext of extensions) {
        try {
            const exists = await api.file.exists(resolved + ext)
            if (exists) return resolved + ext
        } catch { /* ignore */ }
    }

    for (const indexFile of ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs']) {
        try {
            const indexPath = `${resolved}/${indexFile}`
            const exists = await api.file.exists(indexPath)
            if (exists) return indexPath
        } catch { /* ignore */ }
    }

    try {
        const entries = await api.file.readDir(resolved)
        if (entries && entries.length > 0) return resolved
    } catch { /* ignore */ }

    try {
        const exists = await api.file.exists(resolved)
        if (exists) return resolved
    } catch { /* ignore */ }

    return null
}

export async function locateWorkspaceResource(
    fileName: string,
    workspaceRoot: string,
    _maxDepth = 5
): Promise<string | null> {
    if (!fileName || !workspaceRoot) return null

    const config = getActiveConfig()

    for (const dir of config.indexDirs) {
        const candidate = canonicalizePath(`${workspaceRoot}/${dir}/${fileName}`)
        try {
            const exists = await api.file.exists(candidate)
            if (exists) return candidate
        } catch { /* ignore */ }
    }

    try {
        const results = await api.file.search(fileName, workspaceRoot, { maxResults: 1 })
        if (results && results.length > 0) return results[0].path ?? results[0]
    } catch { /* ignore */ }

    return null
}

export function extractPathFromPosition(
    line: string,
    column: number
): { path: string; start: number; end: number } | null {
    const patterns = [
        /(?:from|import|require)\s*\(?['"]([^'"]+)['"]/,
        /['"]([^'"]+\.[a-zA-Z]+)['"]/,
        /(?:path|file|dir|src|dest|href|src)\s*[:=]\s*['"]([^'"]+)['"]/,
    ]

    for (const pattern of patterns) {
        const match = pattern.exec(line)
        if (match && match.index !== undefined) {
            const pathStr = match[1]
            const start = line.indexOf(pathStr, match.index)
            const end = start + pathStr.length
            if (column >= start && column <= end) {
                return { path: pathStr, start, end }
            }
        }
    }

    return null
}

export function getScenarioImportAliases(): Record<string, string> {
    return { ...getActiveConfig().importAliases }
}

export const resolvePath = resolveContextualPath
export const resolveImportPath = resolveModuleReference
export const findFileInWorkspace = locateWorkspaceResource
export const getRelativePath = computeRelativePath
export const normalizePath = canonicalizePath
export const isSubPath = isContainedPath

export const pathLinkService = {
    resolvePath: resolveContextualPath,
    resolveImportPath: resolveModuleReference,
    findFileInWorkspace: locateWorkspaceResource,
    getRelativePath: computeRelativePath,
    normalizePath: canonicalizePath,
    isSubPath: isContainedPath,
    extractPathFromPosition,
    getScenarioImportAliases,

    extractLinks(content: string, language: string): PathLink[] {
        const links: PathLink[] = []
        const lines = content.split('\n')

        const applicablePatterns = PATH_PATTERNS.filter(p =>
            p.languages.includes(language)
        )

        if (applicablePatterns.length === 0) return links

        for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
            const lineContent = lines[lineNumber]

            for (const patternConfig of applicablePatterns) {
                const regex = new RegExp(patternConfig.pattern.source, patternConfig.pattern.flags)
                let match

                while ((match = regex.exec(lineContent)) !== null) {
                    const capturedPath = match[1] || match[2]
                    if (!capturedPath) continue

                    if (patternConfig.filterExternal && isExternalPath(capturedPath)) {
                        continue
                    }

                    const fullMatch = match[0]
                    const pathStartInMatch = fullMatch.indexOf(capturedPath)
                    const pathStart = match.index + pathStartInMatch

                    links.push({
                        path: capturedPath,
                        range: {
                            startLineNumber: lineNumber + 1,
                            startColumn: pathStart + 1,
                            endLineNumber: lineNumber + 1,
                            endColumn: pathStart + capturedPath.length + 1,
                        },
                        tooltip: `Ctrl+Click to open ${capturedPath}`,
                    })
                }
            }
        }

        return links
    },

    async handlePathClick(linkPath: string, currentFilePath: string): Promise<boolean> {
        const { workspacePath } = useStore.getState()
        if (!workspacePath) return false

        const resolvedPath = resolveContextualPath(linkPath, currentFilePath, workspacePath)
        if (!resolvedPath) return false

        const ext = currentFilePath.split('.').pop()?.toLowerCase() || ''
        const pattern = PATH_PATTERNS.find(p =>
            p.languages.some(lang => {
                if (lang === 'typescript' || lang === 'typescriptreact') return ext === 'ts' || ext === 'tsx'
                if (lang === 'javascript' || lang === 'javascriptreact') return ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs'
                return lang === ext
            })
        )

        const extensions = pattern?.extensions || ['']
        const result = await tryOpenFile(resolvedPath, extensions)
        return result.success
    },

    createLinkProvider() {
        const self = this
        return {
            provideLinks: (model: any) => {
                const language = model.getLanguageId()
                const content = model.getValue()
                const pathLinks = self.extractLinks(content, language)

                const links = pathLinks.map(link => ({
                    range: link.range,
                    url: `aweeclaw-path://${encodeURIComponent(link.path)}`,
                    tooltip: link.tooltip,
                }))

                return { links }
            },

            resolveLink: async (link: any) => {
                if (!link.url) return link

                const urlStr = typeof link.url === 'string' ? link.url : link.url.toString()
                if (urlStr.startsWith('aweeclaw-path://')) {
                    const linkPath = decodeURIComponent(urlStr.replace('aweeclaw-path://', ''))
                    const { activeFilePath } = useStore.getState()
                    if (activeFilePath) {
                        await self.handlePathClick(linkPath, activeFilePath)
                    }
                    return undefined
                }

                return link
            }
        }
    },

    getLinkAtPosition(
        content: string,
        language: string,
        lineNumber: number,
        column: number
    ): string | null {
        const links = this.extractLinks(content, language)

        for (const link of links) {
            if (link.range.startLineNumber === lineNumber &&
                column >= link.range.startColumn &&
                column <= link.range.endColumn) {
                return link.path
            }
        }

        return null
    },
}
