import { logger } from '@utils/Logger'
export interface PageConfig {
  pageSize: number
  maxPagesInMemory: number
  prefetchPages: number
}

const DEFAULT_CONFIG: PageConfig = {
  pageSize: 50,
  maxPagesInMemory: 3,
  prefetchPages: 1,
}

interface ThreadPageState {
  threadId: string
  totalPages: number
  loadedPages: Set<number>
  currentPage: number
  lastAccessedAt: number
}

export class ThreadPageManager {
  private config: PageConfig
  private threadStates = new Map<string, ThreadPageState>()
  private messageStore = new Map<string, Map<number, unknown[]>>()

  constructor(config?: Partial<PageConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  registerThread(threadId: string, totalMessages: number): void {
    const totalPages = Math.max(1, Math.ceil(totalMessages / this.config.pageSize))
    this.threadStates.set(threadId, {
      threadId,
      totalPages,
      loadedPages: new Set(),
      currentPage: totalPages > 0 ? totalPages - 1 : 0,
      lastAccessedAt: Date.now(),
    })
  }

  unregisterThread(threadId: string): void {
    this.threadStates.delete(threadId)
    this.messageStore.delete(threadId)
  }

  touchThread(threadId: string): void {
    const state = this.threadStates.get(threadId)
    if (state) {
      state.lastAccessedAt = Date.now()
    }
  }

  getCurrentPage(threadId: string): number {
    return this.threadStates.get(threadId)?.currentPage ?? 0
  }

  getTotalPages(threadId: string): number {
    return this.threadStates.get(threadId)?.totalPages ?? 0
  }

  getPageSize(): number {
    return this.config.pageSize
  }

  getPageRange(threadId: string, page: number): { start: number; end: number } {
    const pageSize = this.config.pageSize
    const start = page * pageSize
    const end = start + pageSize
    return { start, end }
  }

  markPageLoaded(threadId: string, page: number): void {
    const state = this.threadStates.get(threadId)
    if (state) {
      state.loadedPages.add(page)
      this.evictOldPages(threadId)
    }
  }

  isPageLoaded(threadId: string, page: number): boolean {
    return this.threadStates.get(threadId)?.loadedPages.has(page) ?? false
  }

  setCurrentPage(threadId: string, page: number): number[] {
    const state = this.threadStates.get(threadId)
    if (!state) return []

    state.currentPage = page
    state.lastAccessedAt = Date.now()

    const pagesToLoad: number[] = []
    for (let offset = -this.config.prefetchPages; offset <= this.config.prefetchPages; offset++) {
      const targetPage = page + offset
      if (targetPage >= 0 && targetPage < state.totalPages && !state.loadedPages.has(targetPage)) {
        pagesToLoad.push(targetPage)
      }
    }

    return pagesToLoad
  }

  updateTotalMessages(threadId: string, totalMessages: number): void {
    const state = this.threadStates.get(threadId)
    if (state) {
      const newTotalPages = Math.max(1, Math.ceil(totalMessages / this.config.pageSize))
      state.totalPages = newTotalPages
      if (state.currentPage >= newTotalPages) {
        state.currentPage = Math.max(0, newTotalPages - 1)
      }
    }
  }

  getEvictionCandidates(): string[] {
    const candidates: Array<{ threadId: string; lastAccessedAt: number }> = []

    for (const [threadId, state] of this.threadStates) {
      if (state.loadedPages.size > 0) {
        candidates.push({ threadId, lastAccessedAt: state.lastAccessedAt })
      }
    }

    candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
    return candidates.map(c => c.threadId)
  }

  private evictOldPages(threadId: string): void {
    const state = this.threadStates.get(threadId)
    if (!state) return

    if (state.loadedPages.size <= this.config.maxPagesInMemory) return

    const pages = Array.from(state.loadedPages).sort((a, b) => {
      const distA = Math.abs(a - state.currentPage)
      const distB = Math.abs(b - state.currentPage)
      return distB - distA
    })

    while (state.loadedPages.size > this.config.maxPagesInMemory && pages.length > 0) {
      const pageToEvict = pages.shift()!
      if (pageToEvict === state.currentPage) continue

      state.loadedPages.delete(pageToEvict)
      const threadMessages = this.messageStore.get(threadId)
      if (threadMessages) {
        threadMessages.delete(pageToEvict)
      }
    }
  }

  clear(): void {
    this.threadStates.clear()
    this.messageStore.clear()
  }
}

export const threadPageManager = new ThreadPageManager()
