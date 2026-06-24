/**
 * Tree-sitter 代码分块器 — 基于语法树的智能分块
 *
 * 使用 Tree-sitter 解析源码，按语法结构（函数/类/接口）分块
 * 支持多语言，失败时返回空数组由调用方回退到按行分块
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as crypto from 'crypto'
import Parser from 'web-tree-sitter'
import * as fs from 'fs'
import { CodeChunk, IndexConfig, DEFAULT_INDEX_CONFIG } from './providerTypes'
import { getLanguageByExtension, getQueryForLanguage, resolveChunkType } from './languageQueries'

/** 行区间 */
interface LineRange {
  start: number
  end: number
}

/** 区间合并器 — 合并重叠或相邻的行区间 */
class RangeMerger {
  private ranges: LineRange[] = []

  /** 添加一个区间 */
  add(start: number, end: number): void {
    this.ranges.push({ start, end })
  }

  /** 合并所有重叠区间并返回排序后的结果 */
  merge(): LineRange[] {
    if (this.ranges.length === 0) return []
    const sorted = [...this.ranges].sort((a, b) => a.start - b.start)
    const merged: LineRange[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1]
      if (sorted[i].start <= last.end) {
        last.end = Math.max(last.end, sorted[i].end)
      } else {
        merged.push(sorted[i])
      }
    }
    return merged
  }
}

/** 代码块构建器 — 封装 CodeChunk 的创建逻辑 */
class ChunkBuilder {
  private readonly chunks: CodeChunk[] = []

  constructor(
    private readonly filePath: string,
    private readonly relativePath: string,
    private readonly fileHash: string,
    private readonly language: string,
  ) {}

  /** 从 AST 节点创建代码块 */
  fromNode(node: Parser.SyntaxNode, captureName: string): CodeChunk {
    const chunk: CodeChunk = {
      id: `${this.filePath}:${node.startPosition.row}`,
      filePath: this.filePath,
      relativePath: this.relativePath,
      fileHash: this.fileHash,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: resolveChunkType(captureName),
      language: this.language,
      symbols: extractNodeName(node),
    }
    this.chunks.push(chunk)
    return chunk
  }

  /** 创建截断的代码块 */
  truncated(node: Parser.SyntaxNode, maxChars: number): CodeChunk {
    const chunk: CodeChunk = {
      id: `${this.filePath}:${node.startPosition.row}`,
      filePath: this.filePath,
      relativePath: this.relativePath,
      fileHash: this.fileHash,
      content: node.text.slice(0, maxChars) + '\n...[truncated]',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      type: 'block',
      language: this.language,
      symbols: extractNodeName(node),
    }
    this.chunks.push(chunk)
    return chunk
  }

  /** 创建间隙代码块 */
  gap(lines: string[], startLine: number, endLine: number): CodeChunk {
    const chunk: CodeChunk = {
      id: `${this.filePath}:gap:${startLine}`,
      filePath: this.filePath,
      relativePath: this.relativePath,
      fileHash: this.fileHash,
      content: lines.join('\n'),
      startLine: startLine + 1,
      endLine,
      type: 'block',
      language: this.language,
      symbols: [],
    }
    this.chunks.push(chunk)
    return chunk
  }

  /** 获取所有已构建的代码块 */
  build(): CodeChunk[] {
    return this.chunks
  }
}

/** 从 AST 节点提取标识符名称 */
function extractNodeName(node: Parser.SyntaxNode): string[] {
  const findIdentifier = (n: Parser.SyntaxNode): string | null => {
    if (n.type === 'identifier' || n.type === 'type_identifier' || n.type === 'name') {
      return n.text
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (!child) continue
      if (child.type === 'identifier' || child.type === 'name') return child.text
      if (child.type === 'function_declarator') return findIdentifier(child)
    }
    return null
  }
  const name = findIdentifier(node)
  return name ? [name] : []
}

/** WASM 目录解析器 — 定位 Tree-sitter 运行时文件 */
function resolveWasmDir(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'tree-sitter'),
    path.join(process.cwd(), 'resources', 'tree-sitter'),
    path.join(__dirname, '..', '..', '..', 'resources', 'tree-sitter'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || candidates[1]
}

/** Tree-sitter 代码分块器 */
export class TreeSitterChunker {
  private config: IndexConfig
  private parser: Parser | null = null
  private readonly loadedLanguages = new Map<string, Parser.Language>()
  private readonly failedLanguages = new Set<string>()
  private initialized = false
  private readonly wasmDir: string

  constructor(config?: Partial<IndexConfig>) {
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }
    this.wasmDir = resolveWasmDir()
  }

  /** 初始化解析器 */
  async init(): Promise<void> {
    if (this.initialized) return
    try {
      const parserWasm = path.join(this.wasmDir, 'tree-sitter.wasm')
      await Parser.init({ locateFile: () => parserWasm })
      this.parser = new Parser()
      this.initialized = true
    } catch (e) {
      logger.index.error('[TreeSitterChunker] 初始化失败:', e)
    }
  }

  /** 加载指定语言 */
  private async loadLanguage(langName: string): Promise<boolean> {
    if (!this.parser) return false
    const cached = this.loadedLanguages.get(langName)
    if (cached) {
      this.parser.setLanguage(cached)
      return true
    }
    if (this.failedLanguages.has(langName)) return false

    try {
      const wasmPath = path.join(this.wasmDir, `tree-sitter-${langName}.wasm`)
      const lang = await Parser.Language.load(wasmPath)
      this.loadedLanguages.set(langName, lang)
      this.parser.setLanguage(lang)
      return true
    } catch (e) {
      this.failedLanguages.add(langName)
      logger.index.warn(`[TreeSitterChunker] 加载语言 ${langName} 失败:`, e)
      return false
    }
  }

  /** 分块单个文件 */
  async chunkFile(filePath: string, content: string, workspacePath: string): Promise<CodeChunk[]> {
    if (!this.initialized) await this.init()
    if (!this.parser) return []

    const ext = path.extname(filePath).slice(1).toLowerCase()
    const langName = getLanguageByExtension(ext)
    if (!langName) return []

    const loaded = await this.loadLanguage(langName)
    if (!loaded) return []

    const tree = this.parser.parse(content)
    if (!tree) return []

    const queryStr = getQueryForLanguage(langName)
    if (!queryStr) {
      tree.delete()
      return []
    }

    const fileHash = crypto.createHash('sha256').update(content).digest('hex')
    const relativePath = path.relative(workspacePath, filePath)
    const builder = new ChunkBuilder(filePath, relativePath, fileHash, langName)
    const rangeMerger = new RangeMerger()
    const maxChunkChars = this.config.chunkSize * 50

    try {
      const lang = this.loadedLanguages.get(langName)!
      const query = lang.query(queryStr)
      const captures = query.captures(tree.rootNode)
      captures.sort((a, b) => a.node.startIndex - b.node.startIndex)

      for (const capture of captures) {
        const { node, name } = capture
        // 跳过过小的节点（少于 3 行）
        if (node.endPosition.row - node.startPosition.row < 3) continue

        rangeMerger.add(node.startPosition.row, node.endPosition.row)

        if (node.text.length > maxChunkChars) {
          this.splitLargeNode(node, builder, maxChunkChars)
        } else {
          builder.fromNode(node, name)
        }
      }

      // 填充未被捕获的间隙代码
      this.fillGaps(content, rangeMerger.merge(), builder)
    } catch (e) {
      logger.index.error(`[TreeSitterChunker] 查询 ${filePath} 失败:`, e)
    } finally {
      tree.delete()
    }

    return builder.build()
  }

  /** 拆分过大的 AST 节点（迭代式，避免栈溢出） */
  private splitLargeNode(
    node: Parser.SyntaxNode,
    builder: ChunkBuilder,
    maxChunkChars: number,
  ): void {
    const stack: Parser.SyntaxNode[] = [node]

    while (stack.length > 0) {
      const current = stack.pop()!

      // 收集有意义的子节点
      const children: Parser.SyntaxNode[] = []
      for (let i = 0; i < current.childCount; i++) {
        const child = current.child(i)
        if (child && child.text.length > 50) {
          children.push(child)
        }
      }

      // 无法拆分：子节点不足
      if (children.length < 2) {
        if (current.text.length > maxChunkChars) {
          builder.truncated(current, maxChunkChars)
        }
        continue
      }

      // 处理子节点
      for (const child of children) {
        if (child.text.length > maxChunkChars) {
          stack.push(child)
        } else if (child.endPosition.row - child.startPosition.row >= 3) {
          builder.fromNode(child, 'block')
        }
      }
    }
  }

  /** 填充未被 Tree-sitter 捕获的间隙代码 */
  private fillGaps(
    content: string,
    mergedRanges: LineRange[],
    builder: ChunkBuilder,
  ): void {
    if (mergedRanges.length === 0) return

    const lines = content.split('\n')
    let cursor = 0

    for (const range of mergedRanges) {
      if (range.start > cursor) {
        const gapLines = lines.slice(cursor, range.start)
        if (gapLines.length > 5 && gapLines.join('').trim().length > 50) {
          builder.gap(gapLines, cursor, range.start)
        }
      }
      cursor = range.end + 1
    }

    // 处理尾部间隙
    if (cursor < lines.length) {
      const gapLines = lines.slice(cursor)
      if (gapLines.length > 5 && gapLines.join('').trim().length > 50) {
        builder.gap(gapLines, cursor, lines.length)
      }
    }
  }
}
