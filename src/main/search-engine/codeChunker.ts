/**
 * 代码分块服务（兜底模式） — 按行分块的降级方案
 *
 * 当 Tree-sitter 解析失败时使用，支持配置化的分块大小与重叠行数
 */

import * as path from 'path'
import * as crypto from 'crypto'
import { CodeChunk, IndexConfig, DEFAULT_INDEX_CONFIG } from './providerTypes'

/** 分块窗口配置 */
interface ChunkWindow {
  /** 窗口起始行索引（0-based） */
  start: number
  /** 窗口结束行索引（exclusive） */
  end: number
}

/** 滑动窗口分块器 — 按固定大小与重叠步长生成窗口 */
class SlidingWindow {
  private readonly step: number

  constructor(
    private readonly totalLines: number,
    private readonly windowSize: number,
    overlap: number,
  ) {
    this.step = Math.max(1, windowSize - overlap)
  }

  /** 生成所有窗口 */
  *iterate(): Generator<ChunkWindow> {
    if (this.totalLines === 0) return
    for (let start = 0; start < this.totalLines; start += this.step) {
      const end = Math.min(start + this.windowSize, this.totalLines)
      yield { start, end }
      if (end >= this.totalLines) break
    }
  }

  /** 判断是否只需一个窗口（文件足够小） */
  isSingleWindow(): boolean {
    return this.totalLines <= this.windowSize * 1.5
  }
}

/** 代码块工厂 — 封装 CodeChunk 创建逻辑 */
class CodeChunkFactory {
  constructor(
    private readonly filePath: string,
    private readonly relativePath: string,
    private readonly fileHash: string,
    private readonly language: string,
  ) {}

  /** 创建整文件块 */
  createFileChunk(content: string, lineCount: number): CodeChunk {
    return {
      id: `${this.filePath}:0`,
      filePath: this.filePath,
      relativePath: this.relativePath,
      fileHash: this.fileHash,
      content,
      startLine: 1,
      endLine: lineCount,
      type: 'file',
      language: this.language,
      symbols: [],
    }
  }

  /** 创建行范围块 */
  createBlockChunk(lines: string[], start: number, end: number): CodeChunk {
    return {
      id: `${this.filePath}:${start}`,
      filePath: this.filePath,
      relativePath: this.relativePath,
      fileHash: this.fileHash,
      content: lines.slice(start, end).join('\n'),
      startLine: start + 1,
      endLine: end,
      type: 'block',
      language: this.language,
      symbols: [],
    }
  }
}

/** 兜底分块服务 */
export class ChunkerService {
  private config: IndexConfig

  constructor(config?: Partial<IndexConfig>) {
    this.config = { ...DEFAULT_INDEX_CONFIG, ...config }
  }

  /** 更新配置 */
  updateConfig(config: Partial<IndexConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 分块单个文件（按行分块，不解析语法） */
  chunkFile(filePath: string, content: string, workspacePath: string): CodeChunk[] {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const fileHash = crypto.createHash('sha256').update(content).digest('hex')
    const language = ext || 'text'
    const relativePath = path.relative(workspacePath, filePath)
    const factory = new CodeChunkFactory(filePath, relativePath, fileHash, language)
    const lines = content.split('\n')

    const window = new SlidingWindow(lines.length, this.config.chunkSize, this.config.chunkOverlap)

    // 文件足够小，作为单个块
    if (window.isSingleWindow()) {
      return [factory.createFileChunk(content, lines.length)]
    }

    // 滑动窗口分块
    const chunks: CodeChunk[] = []
    for (const { start, end } of window.iterate()) {
      const chunkContent = lines.slice(start, end).join('\n')
      if (chunkContent.trim().length === 0) continue
      chunks.push(factory.createBlockChunk(lines, start, end))
    }

    return chunks
  }

  /** 检查文件是否应该被索引 */
  shouldIndexFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return this.config.includedExts.includes(ext)
  }

  /** 检查目录是否应该被忽略 */
  shouldIgnoreDir(dirName: string): boolean {
    return this.config.ignoredDirs.includes(dirName) || dirName.startsWith('.')
  }
}
