import { terminalManager } from '@services/TerminalAdapter'
import { api } from '../adapters/electronBridge'
import type { PreviewServerCandidate, PreviewServerSource, PreviewServerStatus } from '@shared/protocols/previewProtocol'

interface DiscoveryState {
  candidates: PreviewServerCandidate[]
  preferredCandidateId: string | null
  lastScanAt: number | null
}

type DiscoveryListener = (state: DiscoveryState) => void

const COMMON_PORTS = [3000, 4173, 4200, 4321, 5170, 8000, 8080, 8081]
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{2,5})?(?:[/?#][^\s"'`<>]*)?/gi

/**
 * 终端输出的扫描节拍（毫秒）
 *
 * PTY 数据是高频小块（几十到几百字节一块），dev server 启动期每秒可能上百块。
 * 逐块解析（stripAnsi + 全局正则）会把解析成本直接绑定到输出速率上，
 * 命中 URL 还会顺带重建候选状态并通知订阅方，于是输出越猛、重渲染越频繁。
 * 改为「入队 + 固定节拍合并解析」后，解析成本只与时间相关。
 *
 * 注意是固定节拍而不是 debounce：定时器不因新数据重置。
 * debounce 在持续输出下会被无限推迟，扫描与通知都会饿死。
 */
const SCAN_INTERVAL_MS = 300
/** 与上一批的重叠字符数：URL 可能正好被 PTY 拆到两个数据块里 */
const SCAN_OVERLAP_CHARS = 256
/** 待扫描积压上限：节拍被主线程长任务推迟时的兜底，超限立即扫描 */
const MAX_PENDING_SCAN_CHARS = 64 * 1024
/** 单终端记住的已入库 URL 数上限，避免长期运行的终端无限增长 */
const MAX_INGESTED_URLS_PER_TERMINAL = 64

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][AB012B]/g, '')
    .replace(/\x1b[=><]/g, '')
}

/** 剥离 ANSI 并提取本地服务 URL —— 解析成本集中在这里，只在扫描节拍点调用 */
function extractLocalUrls(value: string): string[] {
  return stripAnsi(value).match(LOCAL_URL_PATTERN) || []
}

function createCandidateId(url: string, workspaceRoot?: string): string {
  return `${workspaceRoot || 'global'}::${url}`.toLowerCase()
}

function deriveCandidateLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.port ? `localhost:${parsed.port}` : parsed.host
  } catch {
    return url
  }
}

function deriveTitle(url: string, source: PreviewServerSource): string {
  const label = deriveCandidateLabel(url)
  if (source === 'terminal') {
    return `Preview ${label}`
  }
  return label
}

function looksLikeHtmlResponse(result: Awaited<ReturnType<typeof api.http.readUrl>>): boolean {
  if (!result.success) return false
  const contentType = (result.contentType || '').toLowerCase()
  return contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType
}

export class DevServerDiscoveryService {
  private readonly listeners = new Set<DiscoveryListener>()
  private readonly candidates = new Map<string, PreviewServerCandidate>()
  private readonly probeCache = new Map<string, Promise<void>>()
  private readonly scannedTerminalIds = new Set<string>()
  /** 待扫描的数据块，按终端分组：攒到节拍点再合并解析 */
  private readonly pendingScanChunks = new Map<string, string[]>()
  private readonly pendingScanChars = new Map<string, number>()
  private readonly scanTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 上一批扫描文本的尾巴，用于拼接被拆断的 URL */
  private readonly scanOverlap = new Map<string, string>()
  /** 已入库的 URL：同一条 URL 反复刷屏时不再重建状态、不再通知订阅方 */
  private readonly ingestedUrls = new Map<string, Set<string>>()
  private initialized = false
  private state: DiscoveryState = {
    candidates: [],
    preferredCandidateId: null,
    lastScanAt: null,
  }

  initialize(): void {
    if (this.initialized) {
      return
    }

    this.initialized = true
    terminalManager.onData((terminalId, data) => {
      // 只入队：解析与状态通知都推迟到扫描节拍点
      this.enqueueTerminalOutput(terminalId, data)
    })
  }

  /** 接收终端数据块：只入队，解析推迟到扫描节拍点 */
  private enqueueTerminalOutput(terminalId: string, data: string): void {
    if (!data) {
      return
    }

    const chunks = this.pendingScanChunks.get(terminalId)
    if (chunks) {
      chunks.push(data)
    } else {
      this.pendingScanChunks.set(terminalId, [data])
    }

    const pendingChars = (this.pendingScanChars.get(terminalId) || 0) + data.length
    this.pendingScanChars.set(terminalId, pendingChars)

    // 积压过多说明节拍被长任务推迟了，立即扫描，避免 URL 一直压在队列里
    if (pendingChars >= MAX_PENDING_SCAN_CHARS) {
      this.flushTerminalOutput(terminalId)
      return
    }

    if (!this.scanTimers.has(terminalId)) {
      this.scanTimers.set(
        terminalId,
        setTimeout(() => this.flushTerminalOutput(terminalId), SCAN_INTERVAL_MS),
      )
    }
  }

  /** 扫描节拍点：合并队列 → 拼接上一批的尾巴 → 提取 URL 并登记 */
  private flushTerminalOutput(terminalId: string): void {
    const timer = this.scanTimers.get(terminalId)
    if (timer) {
      clearTimeout(timer)
      this.scanTimers.delete(terminalId)
    }

    const chunks = this.pendingScanChunks.get(terminalId)
    this.pendingScanChunks.delete(terminalId)
    this.pendingScanChars.delete(terminalId)
    if (!chunks || chunks.length === 0) {
      return
    }

    const batch = chunks.join('')
    const overlap = this.scanOverlap.get(terminalId) || ''
    this.scanOverlap.set(terminalId, batch.slice(-SCAN_OVERLAP_CHARS))

    const urls = extractLocalUrls(overlap + batch)
    if (urls.length === 0) {
      return
    }

    // 只有确实命中 URL 时才去取终端信息：getState() 会克隆整个终端状态
    const terminal = terminalManager.getState().terminals.find((item) => item.id === terminalId)
    this.registerTerminalUrls(urls, terminalId, terminal?.cwd)
  }

  /** 登记新出现的 URL：重复出现的 URL 直接跳过，不触发状态重建与通知 */
  private registerTerminalUrls(urls: string[], terminalId: string, workspaceRoot?: string): void {
    let ingested = this.ingestedUrls.get(terminalId)
    if (!ingested) {
      ingested = new Set<string>()
      this.ingestedUrls.set(terminalId, ingested)
    }

    for (const rawUrl of urls) {
      const url = rawUrl.replace(/\/$/, '')
      if (ingested.has(url)) {
        continue
      }

      if (ingested.size >= MAX_INGESTED_URLS_PER_TERMINAL) {
        const oldest = ingested.values().next().value
        if (oldest !== undefined) {
          ingested.delete(oldest)
        }
      }
      ingested.add(url)

      void this.ensureCandidate(this.buildCandidate(url, 'terminal', workspaceRoot, terminalId))
    }
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): DiscoveryState {
    return this.state
  }

  getCandidatesForWorkspace(workspaceRoot?: string | null): PreviewServerCandidate[] {
    return this.state.candidates.filter((candidate) => !workspaceRoot || candidate.workspaceRoot === workspaceRoot)
  }

  getPreferredCandidate(workspaceRoot?: string | null): PreviewServerCandidate | null {
    const scopedCandidates = this.getCandidatesForWorkspace(workspaceRoot)
    const readyCandidate = scopedCandidates.find((candidate) => candidate.status === 'ready')
    return readyCandidate || scopedCandidates[0] || null
  }

  async refresh(workspaceRoots: string[]): Promise<void> {
    this.initialize()
    this.scanExistingTerminalBuffers()
    const inferred = await this.inferWorkspaceCandidates(workspaceRoots)
    await Promise.all(inferred.map((candidate) => this.ensureCandidate(candidate)))
    this.state = {
      ...this.state,
      lastScanAt: Date.now(),
    }
    this.emit()
  }

  private scanExistingTerminalBuffers(): void {
    const { terminals } = terminalManager.getState()
    this.pruneClosedTerminalState(new Set(terminals.map((terminal) => terminal.id)))

    for (const terminal of terminals) {
      if (this.scannedTerminalIds.has(terminal.id)) {
        continue
      }
      this.scannedTerminalIds.add(terminal.id)
      const buffer = terminalManager.getOutputBuffer(terminal.id).join('')
      if (buffer) {
        this.ingestTerminalOutput(buffer, terminal.id, terminal.cwd)
      }
    }
  }

  /** 回收已关闭终端的扫描状态，避免长期运行后这些 Map 只增不减 */
  private pruneClosedTerminalState(liveTerminalIds: Set<string>): void {
    for (const [terminalId, timer] of this.scanTimers) {
      if (!liveTerminalIds.has(terminalId)) {
        clearTimeout(timer)
        this.scanTimers.delete(terminalId)
      }
    }

    // Set 与 Map 都有 keys()/delete()，统一按「按终端 id 索引的容器」处理
    const keyedStores: Array<{ keys(): IterableIterator<string>; delete(key: string): unknown }> = [
      this.scannedTerminalIds,
      this.pendingScanChunks,
      this.pendingScanChars,
      this.scanOverlap,
      this.ingestedUrls,
    ]

    for (const store of keyedStores) {
      for (const terminalId of [...store.keys()]) {
        if (!liveTerminalIds.has(terminalId)) {
          store.delete(terminalId)
        }
      }
    }
  }

  private async inferWorkspaceCandidates(workspaceRoots: string[]): Promise<PreviewServerCandidate[]> {
    const inferredCandidates: PreviewServerCandidate[] = []
    for (const workspaceRoot of workspaceRoots) {
      const packageJsonPath = `${workspaceRoot}/package.json`
      const packageJson = await api.file.read(packageJsonPath)
      const ports = new Set<number>()

      if (packageJson) {
        try {
          const parsed = JSON.parse(packageJson) as {
            scripts?: Record<string, string>
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
          }
          const scripts = Object.values(parsed.scripts || {}).join('\n')
          const dependencies = {
            ...(parsed.dependencies || {}),
            ...(parsed.devDependencies || {}),
          }

          if (/vite/i.test(scripts) || dependencies.vite) {
            ports.add(5170)
            ports.add(4173)
          }
          if (/next\s+dev/i.test(scripts) || dependencies.next) {
            ports.add(3000)
          }
          if (/nuxt/i.test(scripts) || dependencies.nuxt || dependencies.nuxi) {
            ports.add(3000)
          }
          if (/ng\s+serve/i.test(scripts) || dependencies['@angular/engine']) {
            ports.add(4200)
          }
          if (/react-scripts\s+start/i.test(scripts) || dependencies['react-scripts']) {
            ports.add(3000)
          }
          if (/astro/i.test(scripts) || dependencies.astro) {
            ports.add(4321)
          }

          const explicitPorts = [...scripts.matchAll(/(?:--port|-p)\s+(\d{2,5})/g)].map((match) => Number(match[1]))
          explicitPorts.forEach((port) => ports.add(port))
        } catch {
          // Ignore malformed package.json and fall back to common ports.
        }
      }

      if (ports.size === 0) {
        COMMON_PORTS.forEach((port) => ports.add(port))
      }

      for (const port of [...ports].slice(0, 6)) {
        const url = `http://127.0.0.1:${port}`
        inferredCandidates.push(this.buildCandidate(url, 'workspace-script', workspaceRoot))
      }
    }

    return inferredCandidates
  }

  /** 一次性扫描既有终端缓冲区（refresh 时补扫） */
  private ingestTerminalOutput(output: string, terminalId: string, workspaceRoot?: string): void {
    const urls = extractLocalUrls(output)
    if (urls.length === 0) {
      return
    }

    this.registerTerminalUrls(urls, terminalId, workspaceRoot)
  }

  private buildCandidate(
    url: string,
    source: PreviewServerSource,
    workspaceRoot?: string,
    terminalId?: string,
  ): PreviewServerCandidate {
    const now = Date.now()
    return {
      id: createCandidateId(url, workspaceRoot),
      url,
      source,
      status: 'idle',
      label: deriveCandidateLabel(url),
      title: deriveTitle(url, source),
      terminalId,
      workspaceRoot,
      detectedAt: now,
      lastSeenAt: now,
    }
  }

  private async ensureCandidate(candidate: PreviewServerCandidate): Promise<void> {
    const existing = this.candidates.get(candidate.id)
    const mergedCandidate: PreviewServerCandidate = existing
      ? {
          ...existing,
          ...candidate,
          status: existing.status,
          detectedAt: Math.min(existing.detectedAt, candidate.detectedAt),
          lastSeenAt: Date.now(),
        }
      : candidate

    this.candidates.set(candidate.id, mergedCandidate)
    this.rebuildState()
    this.emit()

    if (!this.probeCache.has(candidate.id)) {
      this.probeCache.set(candidate.id, this.probeCandidate(candidate.id))
    }

    await this.probeCache.get(candidate.id)
  }

  private async probeCandidate(candidateId: string): Promise<void> {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      return
    }

    this.updateCandidate(candidateId, {
      status: 'probing',
      lastCheckedAt: Date.now(),
      error: undefined,
    })

    try {
      const result = await api.http.readUrl(candidate.url, 1200)
      const nextStatus: PreviewServerStatus = looksLikeHtmlResponse(result) ? 'ready' : 'unreachable'
      this.updateCandidate(candidateId, {
        status: nextStatus,
        title: result.title || candidate.title,
        lastCheckedAt: Date.now(),
        error: nextStatus === 'ready' ? undefined : result.error || 'Not an HTML dev server',
      })
    } catch (error) {
      this.updateCandidate(candidateId, {
        status: 'unreachable',
        lastCheckedAt: Date.now(),
        error: error instanceof Error ? error.message : 'Probe failed',
      })
    } finally {
      this.probeCache.delete(candidateId)
    }
  }

  private updateCandidate(candidateId: string, updates: Partial<PreviewServerCandidate>): void {
    const candidate = this.candidates.get(candidateId)
    if (!candidate) {
      return
    }

    this.candidates.set(candidateId, {
      ...candidate,
      ...updates,
    })
    this.rebuildState()
    this.emit()
  }

  private rebuildState(): void {
    const candidates = [...this.candidates.values()].sort((left, right) => {
      const leftReady = left.status === 'ready' ? 1 : 0
      const rightReady = right.status === 'ready' ? 1 : 0
      if (rightReady !== leftReady) {
        return rightReady - leftReady
      }
      return right.lastSeenAt - left.lastSeenAt
    })

    this.state = {
      ...this.state,
      candidates,
      preferredCandidateId: candidates.find((candidate) => candidate.status === 'ready')?.id || candidates[0]?.id || null,
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state))
  }
}

export const devServerDiscoveryService = new DevServerDiscoveryService()
