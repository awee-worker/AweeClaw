/**
 * 项目摘要生成器
 *
 * 通过组合多个专职组件构建项目摘要：
 * - 项目类型探针：读取 package.json 检测框架与特性
 * - 目录目录构建器：聚合文件符号，生成目录统计
 * - 关键文件筛选器：按规则筛选需要展示的关键文件
 * - 摘要渲染器：将摘要对象渲染为 Markdown 文本
 * - 摘要缓存器：负责摘要的持久化与加载
 */

import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { ProjectSummary, DirectorySummary, FileSummary, SymbolInfo } from '../providerTypes'
import { BRAND } from '@shared/brand'

/* ------------------------------------------------------------------ */
/* 类型定义                                                           */
/* ------------------------------------------------------------------ */

/** 项目技术栈信息 */
interface TechStackInfo {
  /** 框架名称 */
  framework: string
  /** 运行时环境 */
  runtime: string
  /** 启用的特性列表 */
  features: string[]
}

/** 目录统计快照 */
interface DirectorySnapshot {
  /** 目录相对路径 */
  path: string
  /** 目录下文件列表 */
  files: string[]
  /** 目录下符号总数 */
  symbolCount: number
}

/* ------------------------------------------------------------------ */
/* 目录描述注册表                                                     */
/* ------------------------------------------------------------------ */

/** 常见目录的中文描述 */
const DIRECTORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  src: '源代码',
  lib: '库代码',
  components: 'UI 组件',
  pages: '页面组件',
  views: '视图组件',
  hooks: 'React Hooks',
  utils: '工具函数',
  helpers: '辅助函数',
  services: '服务层',
  api: 'API 处理器',
  store: '状态管理',
  stores: '状态管理',
  models: '数据模型',
  types: '类型定义',
  config: '配置',
  constants: '常量',
  assets: '静态资源',
  styles: '样式文件',
  tests: '测试文件',
  __tests__: '测试文件',
  main: '主进程（Electron）',
  renderer: '渲染进程（Electron）',
  shared: '共享代码',
  common: '通用工具',
  core: '核心功能',
  features: '功能模块',
  modules: '应用模块',
  plugins: '插件',
  middleware: '中间件',
  routes: '路由定义',
  controllers: '控制器',
  handlers: '请求处理器',
  schemas: '数据模式',
  public: '公共资源',
  dist: '构建输出',
  build: '构建输出',
  scripts: '构建/工具脚本',
  docs: '文档',
  agent: 'AI Agent 逻辑',
  prompts: '提示词模板',
  tools: '工具实现',
  ipc: 'IPC 处理器（Electron）',
  indexing: '代码索引',
  llm: 'LLM 集成',
})

/** 根据目录名获取中文描述 */
function describeDirectory(dirName: string): string {
  return DIRECTORY_LABELS[dirName.toLowerCase()] ?? ''
}

/* ------------------------------------------------------------------ */
/* 文件名模式注册表                                                   */
/* ------------------------------------------------------------------ */

/** 主入口文件名模式 */
const ENTRY_FILE_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /index\.[tj]sx?$/,
  /main\.[tj]sx?$/,
  /app\.[tj]sx?$/,
  /^[A-Z][a-zA-Z]+\.[tj]sx?$/,
])

/** 关键文件名模式 */
const NOTABLE_FILE_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /index\.[tj]sx?$/,
  /main\.[tj]sx?$/,
  /app\.[tj]sx?$/,
  /config/i,
  /service/i,
  /state/i,
  /router/i,
])

/* ------------------------------------------------------------------ */
/* 项目类型探针                                                       */
/* ------------------------------------------------------------------ */

/** 读取 package.json 并推断项目技术栈 */
class TechStackProbe {
  /**
   * 探测指定工作区的技术栈信息
   *
   * @param workspacePath 工作区根路径
   * @returns 技术栈信息，读取失败时返回空值字段
   */
  detect(workspacePath: string): TechStackInfo {
    const info: TechStackInfo = { framework: '', runtime: '', features: [] }
    const pkgPath = path.join(workspacePath, 'package.json')
    if (!fs.existsSync(pkgPath)) return info

    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    } catch {
      return info
    }

    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    this.fillFramework(info, deps)
    this.fillFeatures(info, deps)
    return info
  }

  /** 根据依赖项填充框架与运行时 */
  private fillFramework(
    info: TechStackInfo,
    deps: Record<string, string>,
  ): void {
    if (deps.electron) {
      info.framework = 'Electron'
      info.runtime = 'Node.js + Chromium'
      return
    }
    if (deps.next) {
      info.framework = 'Next.js'
      info.runtime = 'Node.js'
      return
    }
    if (deps.nuxt) {
      info.framework = 'Nuxt'
      info.runtime = 'Node.js'
      return
    }
    if (deps.react || deps['react-dom']) {
      info.framework = 'React'
      info.runtime = 'Browser'
      return
    }
    if (deps.vue) {
      info.framework = 'Vue'
      info.runtime = 'Browser'
      return
    }
    if (deps.express || deps.fastify || deps.koa) {
      info.framework = deps.express ? 'Express' : deps.fastify ? 'Fastify' : 'Koa'
      info.runtime = 'Node.js'
    }
  }

  /** 根据依赖项填充特性列表 */
  private fillFeatures(
    info: TechStackInfo,
    deps: Record<string, string>,
  ): void {
    if (deps.typescript) info.features.push('TypeScript')
    if (deps.tailwindcss) info.features.push('Tailwind CSS')
    if (deps.zustand || deps.redux || deps.mobx) info.features.push('State Management')
    if (deps.prisma || deps.typeorm || deps.mongoose) info.features.push('ORM/Database')
    if (deps.vitest || deps.jest) info.features.push('Testing')
    if (deps['@tanstack/react-query'] || deps.swr) info.features.push('Data Fetching')
  }
}

/* ------------------------------------------------------------------ */
/* 目录目录构建器                                                     */
/* ------------------------------------------------------------------ */

/** 聚合文件符号映射，生成目录统计快照 */
class DirectoryCatalog {
  /**
   * 扫描文件符号映射，构建目录统计
   *
   * @param fileSymbols 文件路径到符号列表的映射
   * @returns 目录统计快照列表
   */
  build(fileSymbols: Map<string, SymbolInfo[]>): DirectorySnapshot[] {
    const buckets = new Map<string, DirectorySnapshot>()

    for (const [relativePath, symbols] of fileSymbols) {
      const dirPath = path.dirname(relativePath)
      const snapshot = this.getOrCreate(dirPath, buckets)
      if (!snapshot.files.includes(relativePath)) {
        snapshot.files.push(relativePath)
      }
      snapshot.symbolCount += symbols.length
    }

    return Array.from(buckets.values())
  }

  /** 获取或创建目录快照 */
  private getOrCreate(
    dirPath: string,
    buckets: Map<string, DirectorySnapshot>,
  ): DirectorySnapshot {
    let snapshot = buckets.get(dirPath)
    if (!snapshot) {
      snapshot = { path: dirPath, files: [], symbolCount: 0 }
      buckets.set(dirPath, snapshot)
    }
    return snapshot
  }

  /** 将目录快照转换为目录摘要 */
  toSummaries(snapshots: DirectorySnapshot[], limit: number): DirectorySummary[] {
    return snapshots
      .sort((a, b) => b.files.length - a.files.length)
      .slice(0, limit)
      .map((snap) => ({
        path: snap.path || '.',
        description: describeDirectory(path.basename(snap.path)),
        fileCount: snap.files.length,
        mainFiles: this.pickEntryFiles(snap.files),
      }))
  }

  /** 从文件列表中筛选入口文件 */
  private pickEntryFiles(files: string[]): string[] {
    return files
      .filter((f) => ENTRY_FILE_PATTERNS.some((p) => p.test(path.basename(f))))
      .map((f) => path.basename(f))
      .slice(0, 5)
  }
}

/* ------------------------------------------------------------------ */
/* 关键文件筛选器                                                     */
/* ------------------------------------------------------------------ */

/** 按规则筛选需要展示的关键文件 */
class KeyFileFilter {
  /** 最小符号数阈值，低于此值的文件不视为关键文件 */
  private readonly minSymbolThreshold = 5

  /**
   * 从文件符号映射中筛选关键文件
   *
   * @param fileSymbols 文件路径到符号列表的映射
   * @param limit 返回的最大文件数
   * @returns 关键文件摘要列表
   */
  select(fileSymbols: Map<string, SymbolInfo[]>, limit: number): FileSummary[] {
    const selected: FileSummary[] = []

    for (const [relativePath, symbols] of fileSymbols) {
      if (!this.isNotable(relativePath, symbols.length)) continue
      const ext = path.extname(relativePath).slice(1)
      selected.push({
        relativePath,
        language: ext || 'unknown',
        symbols,
      })
    }

    return selected
      .sort((a, b) => b.symbols.length - a.symbols.length)
      .slice(0, limit)
  }

  /** 判断文件是否为关键文件 */
  private isNotable(relativePath: string, symbolCount: number): boolean {
    if (NOTABLE_FILE_PATTERNS.some((p) => p.test(relativePath))) return true
    return symbolCount >= this.minSymbolThreshold
  }
}

/* ------------------------------------------------------------------ */
/* 摘要渲染器                                                         */
/* ------------------------------------------------------------------ */

/** 将项目摘要对象渲染为 Markdown 文本 */
class SummaryRenderer {
  /** 目录结构最大展示条数 */
  private readonly maxStructureItems = 15
  /** 关键文件最大展示条数 */
  private readonly maxKeyFileItems = 12
  /** 每个文件展示的符号数 */
  private readonly symbolsPerFile = 6
  /** 语言统计最大展示条数 */
  private readonly maxLanguageItems = 5

  /**
   * 渲染摘要文本
   *
   * @param summary 项目摘要对象
   * @param techStack 技术栈信息
   * @returns Markdown 格式的摘要文本
   */
  render(summary: ProjectSummary, techStack: TechStackInfo): string {
    const sections: string[] = []
    sections.push(this.renderHeader(summary.name))
    sections.push(this.renderTechStack(techStack))
    sections.push(this.renderStats(summary))
    sections.push(this.renderStructure(summary.structure))
    sections.push(this.renderKeyFiles(summary.keyFiles))
    return sections.filter(Boolean).join('\n')
  }

  /** 渲染标题 */
  private renderHeader(name: string): string {
    return `# Project: ${name}\n`
  }

  /** 渲染技术栈信息 */
  private renderTechStack(techStack: TechStackInfo): string {
    if (!techStack.framework && !techStack.runtime) return ''
    const lines: string[] = []
    const typeInfo = [techStack.framework, techStack.runtime].filter(Boolean).join(' / ')
    lines.push(`**Type:** ${typeInfo}`)
    if (techStack.features.length > 0) {
      lines.push(`**Stack:** ${techStack.features.join(', ')}`)
    }
    lines.push('')
    return lines.join('\n')
  }

  /** 渲染规模与语言统计 */
  private renderStats(summary: ProjectSummary): string {
    const langStats = Object.entries(summary.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.maxLanguageItems)
      .map(([lang, count]) => `${lang}(${count})`)
      .join(', ')
    return [
      `**Languages:** ${langStats}`,
      `**Scale:** ${summary.totalFiles} files, ${summary.totalSymbols} symbols`,
      '',
    ].join('\n')
  }

  /** 渲染目录结构 */
  private renderStructure(structure: DirectorySummary[]): string {
    const lines: string[] = ['## Directory Structure']
    for (const dir of structure.slice(0, this.maxStructureItems)) {
      const desc = dir.description ? ` - ${dir.description}` : ''
      lines.push(`- \`${dir.path}/\`${desc} (${dir.fileCount} files)`)
    }
    lines.push('')
    return lines.join('\n')
  }

  /** 渲染关键文件与导出符号 */
  private renderKeyFiles(keyFiles: FileSummary[]): string {
    const lines: string[] = ['## Key Files & Exports']
    for (const file of keyFiles.slice(0, this.maxKeyFileItems)) {
      const symbols = file.symbols.slice(0, this.symbolsPerFile)
      const symbolStr = symbols
        .map((s) => `${this.symbolPrefix(s.kind)}${s.name}`)
        .join(', ')
      const suffix = file.symbols.length > this.symbolsPerFile ? '...' : ''
      lines.push(`- \`${file.relativePath}\`: ${symbolStr}${suffix}`)
    }
    return lines.join('\n')
  }

  /** 获取符号类型对应的前缀标记 */
  private symbolPrefix(kind: string): string {
    if (kind === 'class') return '📦'
    if (kind === 'function') return 'ƒ'
    return '•'
  }
}

/* ------------------------------------------------------------------ */
/* 摘要缓存器                                                         */
/* ------------------------------------------------------------------ */

/** 负责摘要的持久化、加载与清除 */
class SummaryCache {
  /**
   * @param cachePath 缓存文件路径
   */
  constructor(private readonly cachePath: string) {}

  /** 加载缓存的摘要，不存在或读取失败时返回 null */
  async load(): Promise<ProjectSummary | null> {
    if (!fs.existsSync(this.cachePath)) return null
    try {
      const content = await fs.promises.readFile(this.cachePath, 'utf-8')
      return JSON.parse(content) as ProjectSummary
    } catch (e) {
      logger.index.warn('[ProjectSummary] 读取缓存失败:', e)
      return null
    }
  }

  /** 保存摘要到磁盘 */
  async save(summary: ProjectSummary): Promise<void> {
    try {
      const dir = path.dirname(this.cachePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }
      await fs.promises.writeFile(this.cachePath, JSON.stringify(summary, null, 2))
    } catch (e) {
      logger.index.warn('[ProjectSummary] 保存缓存失败:', e)
    }
  }

  /** 清除缓存文件 */
  async clear(): Promise<void> {
    if (!fs.existsSync(this.cachePath)) return
    try {
      await fs.promises.unlink(this.cachePath)
      logger.index.info('[ProjectSummary] 缓存已清除')
    } catch (e) {
      logger.index.warn('[ProjectSummary] 清除缓存失败:', e)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 项目摘要生成器（外观）                                             */
/* ------------------------------------------------------------------ */

/** 目录摘要最大保留条数 */
const MAX_STRUCTURE_SUMMARIES = 20
/** 关键文件最大保留条数 */
const MAX_KEY_FILES = 20

/** 项目摘要生成器 — 协调各组件生成项目摘要并提供缓存能力 */
export class ProjectSummaryGenerator {
  private readonly workspacePath: string
  private readonly techStackProbe: TechStackProbe
  private readonly directoryCatalog: DirectoryCatalog
  private readonly keyFileFilter: KeyFileFilter
  private readonly renderer: SummaryRenderer
  private readonly cache: SummaryCache

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath
    const cachePath = path.join(workspacePath, BRAND.dirName, 'project-summary.json')
    this.techStackProbe = new TechStackProbe()
    this.directoryCatalog = new DirectoryCatalog()
    this.keyFileFilter = new KeyFileFilter()
    this.renderer = new SummaryRenderer()
    this.cache = new SummaryCache(cachePath)
  }

  /**
   * 生成项目摘要
   *
   * @param fileSymbols 文件路径到符号列表的映射
   * @param languages 语言到文件数的映射
   * @returns 项目摘要对象
   */
  generate(
    fileSymbols: Map<string, SymbolInfo[]>,
    languages: Record<string, number>,
  ): ProjectSummary {
    const snapshots = this.directoryCatalog.build(fileSymbols)
    const structure = this.directoryCatalog.toSummaries(snapshots, MAX_STRUCTURE_SUMMARIES)
    const keyFiles = this.keyFileFilter.select(fileSymbols, MAX_KEY_FILES)
    const totalSymbols = this.sumTotalSymbols(fileSymbols)

    const summary: ProjectSummary = {
      name: path.basename(this.workspacePath),
      structure,
      keyFiles,
      totalFiles: fileSymbols.size,
      totalSymbols,
      languages,
      generatedAt: Date.now(),
    }

    // 异步保存缓存，不阻塞返回
    void this.cache.save(summary)
    return summary
  }

  /**
   * 将摘要对象渲染为 Markdown 文本
   *
   * @param summary 项目摘要对象
   * @returns Markdown 格式的摘要文本
   */
  toText(summary: ProjectSummary): string {
    const techStack = this.techStackProbe.detect(this.workspacePath)
    return this.renderer.render(summary, techStack)
  }

  /** 加载缓存的摘要 */
  async loadCache(): Promise<ProjectSummary | null> {
    return this.cache.load()
  }

  /** 清除缓存的摘要 */
  async clearCache(): Promise<void> {
    return this.cache.clear()
  }

  /** 统计所有文件的符号总数 */
  private sumTotalSymbols(fileSymbols: Map<string, SymbolInfo[]>): number {
    let total = 0
    for (const symbols of fileSymbols.values()) {
      total += symbols.length
    }
    return total
  }
}
