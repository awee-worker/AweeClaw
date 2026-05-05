import { logger } from '@utils/Logger'

interface SerializedThread {
  threadId: string
  messages: unknown[]
  serializedAt: number
  messageCount: number
}

class InactiveThreadPersister {
  private storage = new Map<string, SerializedThread>()
  private activeThreads = new Set<string>()
  private maxMemoryThreads: number

  constructor(maxMemoryThreads = 5) {
    this.maxMemoryThreads = maxMemoryThreads
  }

  markActive(threadId: string): void {
    this.activeThreads.add(threadId)
  }

  markInactive(threadId: string): void {
    this.activeThreads.delete(threadId)
  }

  isActive(threadId: string): boolean {
    return this.activeThreads.has(threadId)
  }

  serializeThread(threadId: string, messages: unknown[]): void {
    this.storage.set(threadId, {
      threadId,
      messages,
      serializedAt: Date.now(),
      messageCount: messages.length,
    })
    this.dirty = true
    logger.agent.info(`[ThreadPersister] Serialized thread ${threadId}: ${messages.length} messages`)
  }

  deserializeThread(threadId: string): unknown[] | null {
    const serialized = this.storage.get(threadId)
    if (!serialized) return null

    this.storage.delete(threadId)
    this.dirty = true
    logger.agent.info(`[ThreadPersister] Deserialized thread ${threadId}: ${serialized.messageCount} messages`)
    return serialized.messages
  }

  isSerialized(threadId: string): boolean {
    return this.storage.has(threadId)
  }

  getEvictionCandidates(activeThreadId: string): string[] {
    const candidates: Array<{ threadId: string; serializedAt: number }> = []

    for (const [threadId, data] of this.storage) {
      if (threadId === activeThreadId) continue
      if (this.activeThreads.has(threadId)) continue
      candidates.push({ threadId, serializedAt: data.serializedAt })
    }

    candidates.sort((a, b) => a.serializedAt - b.serializedAt)
    return candidates.map(c => c.threadId)
  }

  shouldEvict(totalActiveThreads: number): boolean {
    return totalActiveThreads > this.maxMemoryThreads
  }

  getStats(): { serializedCount: number; activeCount: number; totalMemoryEntries: number } {
    return {
      serializedCount: this.storage.size,
      activeCount: this.activeThreads.size,
      totalMemoryEntries: this.storage.size,
    }
  }

  clear(): void {
    this.storage.clear()
    this.activeThreads.clear()
    this.dirty = false
  }
}

export const inactiveThreadPersister = new InactiveThreadPersister()
