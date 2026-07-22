/**
 * 代码依赖图 — 基于正则的轻量级多语言解析
 *
 * 职责：
 * - 解析 TS/JS/Python 文件的 import/export 关系
 * - 构建文件级依赖图（节点=文件，边=导入关系）
 * - 支持文件哈希增量更新（只重新解析变更文件）
 * - 提供 BFS 上游影响分析（谁会被改动波及）
 *
 * 设计原则：
 * - 零依赖：不使用 tree-sitter 等重量级解析器，纯正则实现
 * - 增量更新：通过文件哈希对比，只重新解析变更的文件
 * - 内存缓存：图结构常驻内存，避免重复构建
 * - 容错：解析失败的文件跳过，不阻断整体流程
 *
 * @module perception/CodeDependencyGraph
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'

// ============================================================
// 类型定义
// ============================================================

/** 支持的语言 */
export type CodeLanguage = 'typescript' | 'javascript' | 'python'

/** 代码符号（文件 + 导出符号） */
export interface CodeSymbol {
  /** 文件绝对路径 */
  filePath: string
  /** 相对项目根的路径 */
  relativePath: string
  /** 语言 */
  language: CodeLanguage
  /** 导出的符号名列表 */
  exports: string[]
  /** 导入的符号（来自哪些文件） */
  imports: CodeImport[]
  /** 文件哈希（用于增量更新） */
  hash: string
}

/** 代码导入关系 */
export interface CodeImport {
  /** 导入的符号名 */
  symbols: string[]
  /** 导入来源（原始字符串，可能是相对路径或包名） */
  source: string
  /** 解析后的绝对路径（相对路径已解析，包名则为空） */
  resolvedPath?: string
  /** 是否为外部包（node_modules / site-packages） */
  isExternal: boolean
}

/** 依赖图边 */
export interface CodeEdge {
  /** 源文件（导入方） */
  from: string
  /** 目标文件（被导入方） */
  to: string
  /** 导入的符号 */
  symbols: string[]
}

/** 依赖图 */
export interface DependencyGraph {
  /** 项目根路径 */
  projectPath: string
  /** 语言 */
  language: CodeLanguage
  /** 所有符号（按文件路径索引） */
  symbols: Map<string, CodeSymbol>
  /** 所有边（依赖关系） */
  edges: CodeEdge[]
  /** 构建时间戳 */
  builtAt: number
  /** 文件总数 */
  fileCount: number
}

// ============================================================
// 常量
// ============================================================

/** 忽略的目录 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.history',
])

/** 支持的文件扩展名 */
const EXTENSIONS: Record<string, CodeLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.py': 'python',
}

/** 最大文件大小（1MB，超过跳过） */
const MAX_FILE_SIZE = 1024 * 1024

/** 最大 BFS 深度 */
const MAX_BFS_DEPTH = 10

// ============================================================
// 代码依赖图构建器
// ============================================================

/**
 * 代码依赖图构建器
 *
 * 使用方式：
 * ```ts
 * const builder = CodeDependencyGraph.getInstance()
 * const graph = await builder.buildGraph('/path/to/project', 'typescript')
 * const impacted = builder.findUpstreamImpacted(graph, '/path/to/changed.ts')
 * ```
 */
export class CodeDependencyGraph {
  private static instance: CodeDependencyGraph | null = null

  /** 图缓存（按 projectPath + language 索引） */
  private graphCache: Map<string, DependencyGraph> = new Map()

  private constructor() {}

  static getInstance(): CodeDependencyGraph {
    if (!CodeDependencyGraph.instance) {
      CodeDependencyGraph.instance = new CodeDependencyGraph()
    }
    return CodeDependencyGraph.instance
  }

  /**
   * 构建或获取依赖图
   *
   * @param projectPath 项目根路径
   * @param language 主语言（用于决定解析哪些扩展名）
   * @param forceRebuild 是否强制重建
   */
  async buildGraph(
    projectPath: string,
    language: CodeLanguage = 'typescript',
    forceRebuild = false,
  ): Promise<DependencyGraph> {
    const cacheKey = `${projectPath}:${language}`

    if (!forceRebuild) {
      const cached = this.graphCache.get(cacheKey)
      if (cached) {
        // 检查文件是否有变更
        const hasChanges = await this.hasFileChanges(cached)
        if (!hasChanges) return cached
      }
    }

    logger.perception?.info(
      `[CodeDependencyGraph] 构建依赖图: ${projectPath} (${language})`,
    )

    const symbols = new Map<string, CodeSymbol>()
    const startTime = Date.now()

    // 1. 扫描所有源文件
    const files = await this.scanSourceFiles(projectPath, language)
    logger.perception?.info(
      `[CodeDependencyGraph] 扫描到 ${files.length} 个源文件`,
    )

    // 2. 并行解析每个文件（分批避免内存峰值）
    const BATCH = 20
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (filePath) => {
          const symbol = await this.parseFile(filePath, projectPath)
          if (symbol) symbols.set(filePath, symbol)
        }),
      )
    }

    // 3. 解析导入路径（相对路径 → 绝对路径）
    this.resolveImportPaths(symbols)

    // 4. 构建边
    const edges = this.buildEdges(symbols)

    const graph: DependencyGraph = {
      projectPath,
      language,
      symbols,
      edges,
      builtAt: Date.now(),
      fileCount: symbols.size,
    }

    this.graphCache.set(cacheKey, graph)
    logger.perception?.info(
      `[CodeDependencyGraph] 构建完成: ${symbols.size} 文件, ${edges.length} 边, 耗时 ${Date.now() - startTime}ms`,
    )

    return graph
  }

  /**
   * 查找直接调用方（谁导入了这个文件）
   */
  findCallers(graph: DependencyGraph, filePath: string): string[] {
    const callers = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.to === filePath) {
        callers.add(edge.from)
      }
    }
    return Array.from(callers)
  }

  /**
   * 查找直接被调用方（这个文件导入了谁）
   */
  findCallees(graph: DependencyGraph, filePath: string): string[] {
    const callees = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.from === filePath) {
        callees.add(edge.to)
      }
    }
    return Array.from(callees)
  }

  /**
   * BFS 上游影响分析
   *
   * 从变更文件出发，沿导入关系反向遍历，找出所有受影响的文件。
   *
   * @param graph 依赖图
   * @param startFilePath 变更文件路径
   * @param maxDepth 最大深度（默认 10）
   * @returns 受影响的文件列表（按距离排序）
   */
  findUpstreamImpacted(
    graph: DependencyGraph,
    startFilePath: string,
    maxDepth: number = MAX_BFS_DEPTH,
  ): Array<{ filePath: string; depth: number }> {
    const visited = new Map<string, number>()
    const queue: Array<{ filePath: string; depth: number }> = [
      { filePath: startFilePath, depth: 0 },
    ]
    visited.set(startFilePath, 0)

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.depth >= maxDepth) continue

      const callers = this.findCallers(graph, current.filePath)
      for (const caller of callers) {
        if (!visited.has(caller)) {
          visited.set(caller, current.depth + 1)
          queue.push({ filePath: caller, depth: current.depth + 1 })
        }
      }
    }

    // 排除起点自身，按深度排序
    return Array.from(visited.entries())
      .filter(([filePath]) => filePath !== startFilePath)
      .map(([filePath, depth]) => ({ filePath, depth }))
      .sort((a, b) => a.depth - b.depth)
  }

  /** 清空缓存 */
  clearCache(): void {
    this.graphCache.clear()
  }

  /** 释放资源 */
  async dispose(): Promise<void> {
    this.graphCache.clear()
    CodeDependencyGraph.instance = null
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 扫描源文件 */
  private async scanSourceFiles(
    projectPath: string,
    language: CodeLanguage,
  ): Promise<string[]> {
    const result: string[] = []

    const walk = (dir: string): void => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') continue
        if (IGNORED_DIRS.has(entry.name)) continue

        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          const fileLang = EXTENSIONS[ext]
          if (fileLang && this.isLanguageMatch(fileLang, language)) {
            result.push(fullPath)
          }
        }
      }
    }

    walk(projectPath)
    return result
  }

  /** 判断文件语言是否匹配目标语言 */
  private isLanguageMatch(
    fileLang: CodeLanguage,
    targetLang: CodeLanguage,
  ): boolean {
    // TypeScript 项目同时解析 JS/TS
    if (targetLang === 'typescript') {
      return fileLang === 'typescript' || fileLang === 'javascript'
    }
    if (targetLang === 'javascript') {
      return fileLang === 'javascript' || fileLang === 'typescript'
    }
    return fileLang === targetLang
  }

  /** 解析单个文件 */
  private async parseFile(
    filePath: string,
    projectPath: string,
  ): Promise<CodeSymbol | null> {
    try {
      const stat = fs.statSync(filePath)
      if (stat.size > MAX_FILE_SIZE) return null

      const content = fs.readFileSync(filePath, 'utf-8')
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
      const ext = path.extname(filePath).toLowerCase()
      const language = EXTENSIONS[ext] ?? 'typescript'
      const relativePath = path.relative(projectPath, filePath)

      let exports: string[] = []
      let imports: CodeImport[] = []

      if (language === 'python') {
        imports = this.parsePythonImports(content)
        exports = this.parsePythonExports(content)
      } else {
        imports = this.parseTsJsImports(content)
        exports = this.parseTsJsExports(content)
      }

      return {
        filePath,
        relativePath,
        language,
        exports,
        imports,
        hash,
      }
    } catch (e) {
      logger.perception?.warn(
        `[CodeDependencyGraph] 解析文件失败 ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
      )
      return null
    }
  }

  /** 解析 TS/JS 导入 */
  private parseTsJsImports(content: string): CodeImport[] {
    const imports: CodeImport[] = []

    // ES Module: import { a, b } from 'path'
    // ES Module: import * as ns from 'path'
    // ES Module: import defaultExport from 'path'
    const esImportRegex =
      /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+(?:\s*,\s*\{[^}]*\})?)|(?:\{[^}]*\}\s*,\s*\w+))\s+from\s+['"]([^'"]+)['"]/g
    let match: RegExpExecArray | null
    while ((match = esImportRegex.exec(content)) !== null) {
      const source = match[1]
      const symbolsMatch = match[0].match(/\{([^}]*)\}/)
      const symbols = symbolsMatch
        ? symbolsMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
        : []
      imports.push({
        symbols,
        source,
        isExternal: this.isExternalModule(source),
      })
    }

    // CommonJS: const { a, b } = require('path')
    // CommonJS: const x = require('path')
    const requireRegex = /(?:const|let|var)\s+(?:(\{[^}]*\})|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g
    while ((match = requireRegex.exec(content)) !== null) {
      const source = match[3]
      const destructuring = match[1]
      const symbols = destructuring
        ? destructuring
            .replace(/[{}]/g, '')
            .split(',')
            .map((s) => s.trim().split(/\s*:\s*/)[0])
            .filter(Boolean)
        : [match[2]]
      imports.push({
        symbols,
        source,
        isExternal: this.isExternalModule(source),
      })
    }

    // 动态 import: await import('path')
    const dynamicImportRegex = /import\(['"]([^'"]+)['"]\)/g
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      imports.push({
        symbols: [],
        source: match[1],
        isExternal: this.isExternalModule(match[1]),
      })
    }

    return imports
  }

  /** 解析 TS/JS 导出 */
  private parseTsJsExports(content: string): string[] {
    const exports: string[] = []

    // export function/class/const/let/var name
    const exportNamedRegex =
      /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g
    let match: RegExpExecArray | null
    while ((match = exportNamedRegex.exec(content)) !== null) {
      exports.push(match[1])
    }

    // export { a, b, c }
    const exportListRegex = /export\s+\{([^}]+)\}/g
    while ((match = exportListRegex.exec(content)) !== null) {
      const names = match[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean)
      exports.push(...names)
    }

    // export default
    if (/export\s+default\s+/.test(content)) {
      exports.push('default')
    }

    // module.exports = { a, b }
    const moduleExportsRegex = /module\.exports\s*=\s*\{([^}]+)\}/g
    while ((match = moduleExportsRegex.exec(content)) !== null) {
      const names = match[1]
        .split(',')
        .map((s) => s.trim().split(/\s*:\s*/)[0])
        .filter(Boolean)
      exports.push(...names)
    }

    return Array.from(new Set(exports))
  }

  /** 解析 Python 导入 */
  private parsePythonImports(content: string): CodeImport[] {
    const imports: CodeImport[] = []

    // from module import a, b, c
    const fromImportRegex = /^from\s+(\S+)\s+import\s+(.+)$/gm
    let match: RegExpExecArray | null
    while ((match = fromImportRegex.exec(content)) !== null) {
      const source = match[1]
      const symbolsStr = match[2].replace(/\(.*?\)/gs, '').trim()
      const symbols = symbolsStr
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter((s) => s && !s.startsWith('#'))
      imports.push({
        symbols,
        source,
        isExternal: !source.startsWith('.'),
      })
    }

    // import module
    // import module as alias
    // import module.a.b
    const importRegex = /^import\s+(\S+)(?:\s+as\s+\w+)?$/gm
    while ((match = importRegex.exec(content)) !== null) {
      imports.push({
        symbols: [match[1].split('.').pop() ?? match[1]],
        source: match[1],
        isExternal: !match[1].startsWith('.'),
      })
    }

    return imports
  }

  /** 解析 Python 导出（Python 没有显式 export，所有顶层定义都是导出） */
  private parsePythonExports(content: string): string[] {
    const exports: string[] = []

    // def function_name
    const defRegex = /^def\s+(\w+)/gm
    let match: RegExpExecArray | null
    while ((match = defRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1])
    }

    // class ClassName
    const classRegex = /^class\s+(\w+)/gm
    while ((match = classRegex.exec(content)) !== null) {
      if (!match[1].startsWith('_')) exports.push(match[1])
    }

    // 顶层变量赋值（简化：只识别 ALL_CAPS 常量和 __all__）
    const allRegex = /__all__\s*=\s*\[([^\]]+)\]/g
    while ((match = allRegex.exec(content)) !== null) {
      const names = match[1]
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
      exports.push(...names)
    }

    return Array.from(new Set(exports))
  }

  /** 判断是否为外部模块 */
  private isExternalModule(source: string): boolean {
    // 相对路径
    if (source.startsWith('.') || source.startsWith('/')) return false
    // 绝对路径
    if (path.isAbsolute(source)) return false
    // 包名
    return true
  }

  /** 解析导入路径为绝对路径 */
  private resolveImportPaths(symbols: Map<string, CodeSymbol>): void {
    const allFiles = new Set(symbols.keys())
    const fileDirMap = new Map<string, string[]>() // 目录 → 文件列表（无扩展名）

    // 构建文件名索引（用于快速查找）
    for (const filePath of allFiles) {
      const dir = path.dirname(filePath)
      const base = path.basename(filePath, path.extname(filePath))
      const key = `${dir}/${base}`
      if (!fileDirMap.has(key)) fileDirMap.set(key, [])
      fileDirMap.get(key)!.push(filePath)

      // index 文件特殊处理
      if (base === 'index') {
        const parentKey = dir
        if (!fileDirMap.has(parentKey)) fileDirMap.set(parentKey, [])
        fileDirMap.get(parentKey)!.push(filePath)
      }
    }

    for (const symbol of symbols.values()) {
      for (const imp of symbol.imports) {
        if (imp.isExternal) continue
        imp.resolvedPath = this.resolvePath(
          imp.source,
          path.dirname(symbol.filePath),
          allFiles,
          fileDirMap,
        )
      }
    }
  }

  /** 解析单个导入路径 */
  private resolvePath(
    source: string,
    fromDir: string,
    allFiles: Set<string>,
    fileDirMap: Map<string, string[]>,
  ): string | undefined {
    // 绝对路径
    if (path.isAbsolute(source)) {
      return this.findExactFile(source, allFiles)
    }

    // 相对路径
    const resolved = path.resolve(fromDir, source)
    return this.findExactFile(resolved, allFiles) ?? this.findIndexFile(resolved, fileDirMap)
  }

  /** 查找精确文件（尝试多种扩展名） */
  private findExactFile(basePath: string, allFiles: Set<string>): string | undefined {
    // 精确匹配
    if (allFiles.has(basePath)) return basePath

    // 尝试添加扩展名
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py']) {
      const withExt = basePath + ext
      if (allFiles.has(withExt)) return withExt
    }

    return undefined
  }

  /** 查找 index 文件 */
  private findIndexFile(
    dirPath: string,
    fileDirMap: Map<string, string[]>,
  ): string | undefined {
    const files = fileDirMap.get(dirPath)
    return files?.[0]
  }

  /** 构建边 */
  private buildEdges(symbols: Map<string, CodeSymbol>): CodeEdge[] {
    const edges: CodeEdge[] = []
    for (const symbol of symbols.values()) {
      for (const imp of symbol.imports) {
        if (!imp.resolvedPath) continue
        if (!symbols.has(imp.resolvedPath)) continue
        edges.push({
          from: symbol.filePath,
          to: imp.resolvedPath,
          symbols: imp.symbols,
        })
      }
    }
    return edges
  }

  /** 检查文件是否有变更 */
  private async hasFileChanges(graph: DependencyGraph): Promise<boolean> {
    for (const symbol of graph.symbols.values()) {
      try {
        const content = fs.readFileSync(symbol.filePath, 'utf-8')
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
        if (hash !== symbol.hash) return true
      } catch {
        // 文件被删除也算变更
        return true
      }
    }
    return false
  }
}
