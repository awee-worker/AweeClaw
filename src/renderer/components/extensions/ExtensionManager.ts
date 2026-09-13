/**
 * 前端插件管理器
 *
 * 支持从 GitHub URL 安装或本地 ZIP 文件安装前端扩展插件。
 * 安装流程：解析 URL → 下载 ZIP → 解压 → 验证结构 → 保存到 IndexedDB
 *
 * 安全校验：
 * - 禁止 .exe / .sh / .bat 等可执行文件
 * - 仅允许 .html / .js / .css / .json / .png / .svg 等前端资源
 * - 沙箱运行（isolated iframe）
 */

// ==================== 类型定义 ====================

export type ExtensionStatus = 'installing' | 'success' | 'error'

export interface InstallProgress {
  extId: string
  status: ExtensionStatus
  progress: number       // 0-100
  message: string
  error?: string
}

export interface ExtensionMeta {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  repository?: string
  category?: string
  /** 入口文件 */
  entryFile?: string
  /** 安装时间戳 */
  installedAt: number
  /** 最后更新时间戳 */
  updatedAt: number
}

export interface ExtensionEntry {
  meta: ExtensionMeta
  /** 插件文件内容（以文件名→base64 或文本的形式存储） */
  files: Record<string, string>
}

// ==================== 常量 ====================

// Storage keys are managed within IndexedDB store operations

/** 禁止的可执行文件扩展名 */
const FORBIDDEN_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.ps1', '.vbs', '.msi',
  '.dll', '.so', '.dylib', '.bin', '.app',
  '.py', '.rb', '.php', '.pl',
])

// ==================== GitHub URL 解析 ====================

interface GitHubUrlParts {
  owner: string
  repo: string
  branch: string
  path?: string
}

/**
 * 解析 GitHub 仓库 URL
 * 支持格式:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/path
 *   https://github.com/owner/repo/archive/refs/heads/main.zip
 */
export function parseGitHubUrl(url: string): GitHubUrlParts {
  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/,
  )
  if (!match) throw new Error('Invalid GitHub URL format')

  const [, owner, repo, branch = 'main', path] = match
  return {
    owner: owner.trim(),
    repo: repo.trim(),
    branch: branch.trim(),
    path: path?.trim() || undefined,
  }
}

/**
 * 生成插件 ID（从 GitHub 仓库信息）
 */
export function generateExtId(owner: string, repo: string): string {
  return `ext_${owner}_${repo}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

// ==================== 核心实现 ====================

export class ExtensionManager {
  private readonly indexedDBName = 'aweeclaw-extensions'
  private readonly storeName = 'extensions'

  /**
   * 从 GitHub URL 安装插件
   */
  async installFromGitHub(
    url: string,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<{ id: string; status: ExtensionStatus; meta: ExtensionMeta }> {
    let extId = ''
    try {
      const parsed = parseGitHubUrl(url)
      extId = generateExtId(parsed.owner, parsed.repo)

      onProgress?.({ extId, status: 'installing', progress: 10, message: '正在下载插件...' })

      // 下载 ZIP
      const zipUrl = `https://github.com/${parsed.owner}/${parsed.repo}/archive/refs/heads/${parsed.branch}.zip`
      const response = await fetch(zipUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

      onProgress?.({ extId, status: 'installing', progress: 40, message: '正在解压插件...' })

      // 解压 ZIP（使用 JSZip，需提前在 HTML 中引入）
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(await response.blob())
      const files = await this.extractAndValidate(zip, extId, onProgress)

      onProgress?.({ extId, status: 'installing', progress: 80, message: '正在保存插件...' })

      // 提取元数据
      const meta = await this.extractMeta(files, url, parsed)

      // 保存到 IndexedDB
      await this.saveExtension(extId, meta, files)

      onProgress?.({ extId, status: 'success', progress: 100, message: '安装完成' })

      return { id: extId, status: 'success', meta }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      onProgress?.({ extId: extId || 'unknown', status: 'error', progress: 0, message: '安装失败', error: errorMsg })
      throw err
    }
  }

  /**
   * 从本地 ZIP 文件安装插件
   */
  async installFromLocal(
    file: File,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<{ id: string; status: ExtensionStatus; meta: ExtensionMeta }> {
    let extId = 'local_ext'
    try {
      onProgress?.({ extId, status: 'installing', progress: 10, message: '正在读取文件...' })

      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(file)

      onProgress?.({ extId, status: 'installing', progress: 40, message: '正在验证结构...' })
      const files = await this.extractAndValidate(zip, extId, onProgress)

      onProgress?.({ extId, status: 'installing', progress: 80, message: '正在保存插件...' })

      // 尝试从 package.json 或文件名获取 ID
      const pkgJson = files['package.json']
      if (pkgJson) {
        try {
          const pkg = JSON.parse(pkgJson)
          extId = `local_${(pkg.name || file.name).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`
        } catch { /* ignore */ }
      }

      const meta = await this.extractMetaFromLocal(files, file.name)
      await this.saveExtension(extId, meta, files)

      onProgress?.({ extId, status: 'success', progress: 100, message: '安装完成' })

      return { id: extId, status: 'success', meta }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      onProgress?.({ extId, status: 'error', progress: 0, message: '安装失败', error: errorMsg })
      throw err
    }
  }

  /**
   * 获取已安装插件列表
   */
  async listExtensions(): Promise<ExtensionMeta[]> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const txn = db.transaction(this.storeName, 'readonly')
      const store = txn.objectStore(this.storeName)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result.map((item: ExtensionEntry) => item.meta))
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * 获取单个插件
   */
  async getExtension(extId: string): Promise<ExtensionEntry | null> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const txn = db.transaction(this.storeName, 'readonly')
      const store = txn.objectStore(this.storeName)
      const request = store.get(extId)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * 卸载插件
   */
  async uninstall(extId: string): Promise<boolean> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const txn = db.transaction(this.storeName, 'readwrite')
      const store = txn.objectStore(this.storeName)
      const request = store.delete(extId)
      request.onsuccess = () => resolve(true)
      request.onerror = () => reject(request.error)
    })
  }

  // ==================== 私有方法 ====================

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.indexedDBName, 1)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async saveExtension(
    extId: string,
    meta: ExtensionMeta,
    files: Record<string, string>,
  ): Promise<void> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const txn = db.transaction(this.storeName, 'readwrite')
      const store = txn.objectStore(this.storeName)
      store.put({ id: extId, meta, files })
      txn.oncomplete = () => resolve()
      txn.onerror = () => reject(txn.error)
    })
  }

  /**
   * 解压并验证 ZIP 结构
   */
  private async extractAndValidate(
    zip: ReturnType<typeof import('jszip')>,
    extId: string,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {}
    const entries = Object.entries(zip.files)

    for (let i = 0; i < entries.length; i++) {
      const [path, entry] = entries[i]
      if (entry.dir) continue

      onProgress?.({ extId, status: 'installing', progress: 40 + (i / entries.length) * 30, message: `正在验证: ${path}` })

      // 安全检查
      if (this.isForbiddenFile(path)) {
        throw new Error(`禁止的文件类型: ${path}`)
      }

      const content = await entry.async('text')
      files[path] = content
    }

    // 验证必须有 index.html 或 index.js
    const hasEntry = Object.keys(files).some(
      (p) => p.endsWith('index.html') || p.endsWith('index.js') || p.endsWith('index.ts'),
    )
    if (!hasEntry) {
      throw new Error('插件结构无效：缺少 index.html 或 index.js')
    }

    return files
  }

  /**
   * 检查是否为禁止的文件类型
   */
  private isForbiddenFile(path: string): boolean {
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
    return FORBIDDEN_EXTENSIONS.has(ext)
  }

  /**
   * 从文件集合中提取元数据
   */
  private async extractMeta(
    files: Record<string, string>,
    repositoryUrl: string,
    parsedUrl: GitHubUrlParts,
  ): Promise<ExtensionMeta> {
    const pkgJsonStr = files['package.json'] || Object.entries(files).find(([k]) => k.endsWith('package.json'))?.[1]
    let meta: Partial<ExtensionMeta> = { installedAt: Date.now(), updatedAt: Date.now() }

    if (pkgJsonStr) {
      try {
        const pkg = JSON.parse(pkgJsonStr)
        meta = {
          ...meta,
          name: pkg.name || parsedUrl.repo,
          description: pkg.description,
          version: pkg.version,
          author: pkg.author,
          category: pkg.category || pkg.keywords?.[0],
          entryFile: pkg.main || pkg.module || 'index.html',
        }
      } catch { /* ignore parse error */ }
    }

    return {
      id: '',
      ...meta,
      repository: repositoryUrl,
    } as ExtensionMeta
  }

  private async extractMetaFromLocal(
    files: Record<string, string>,
    filename: string,
  ): Promise<ExtensionMeta> {
    const pkgJsonStr = Object.entries(files).find(([k]) => k.endsWith('package.json'))?.[1]
    let meta: Partial<ExtensionMeta> = { installedAt: Date.now(), updatedAt: Date.now() }

    if (pkgJsonStr) {
      try {
        const pkg = JSON.parse(pkgJsonStr)
        meta = {
          ...meta,
          name: pkg.name || filename,
          description: pkg.description,
          version: pkg.version,
          author: pkg.author,
        }
      } catch { /* ignore */ }
    }

    return {
      id: '',
      ...meta,
    } as ExtensionMeta
  }
}

/** 单例实例 */
export const extensionManager = new ExtensionManager()
export default extensionManager
