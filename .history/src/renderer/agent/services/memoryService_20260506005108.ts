import { longTermMemoryService } from './longTermMemoryService'
import type { MemoryEntry } from './longTermMemoryService/types'

export interface MemoryItem {
  id: string
  content: string
  createdAt: number
  enabled: boolean
}

function entryToMemoryItem(entry: MemoryEntry): MemoryItem {
  return {
    id: entry.id,
    content: entry.content,
    createdAt: entry.createdAt,
    enabled: entry.enabled,
  }
}

class MemoryService {
  private migrated = false

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return
    this.migrated = true
    try {
      await longTermMemoryService.migrateFromKnowledgeConversation()
    } catch {
    }
  }

  async getMemories(): Promise<MemoryItem[]> {
    await this.ensureMigrated()
    const entries = await longTermMemoryService.getEnabledEntries()
    return entries.filter(e => e.status === 'short_term' || e.status === 'long_term').map(entryToMemoryItem)
  }

  async getAllMemories(): Promise<MemoryItem[]> {
    await this.ensureMigrated()
    const entries = await longTermMemoryService.getEntries()
    return entries.filter(e => e.status !== 'forgotten').map(entryToMemoryItem)
  }

  async addMemory(content: string): Promise<MemoryItem> {
    await this.ensureMigrated()
    const entry = await longTermMemoryService.addEntry({
      content,
      source: 'user',
      status: 'long_term',
      confidence: 1.0,
    })
    return entryToMemoryItem(entry)
  }

  async updateMemory(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'enabled'>>): Promise<boolean> {
    await this.ensureMigrated()
    return longTermMemoryService.updateEntry(id, {
      content: updates.content,
      enabled: updates.enabled,
    })
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureMigrated()
    return longTermMemoryService.deleteEntry(id)
  }

  buildMemoryPrompt(memories: MemoryItem[]): string {
    const enabledMemories = memories.filter(m => m.enabled && m.content.trim())
    if (enabledMemories.length === 0) return ''

    const lines = enabledMemories.map(m => `- ${m.content}`).join('\n')

    return `<memory>
Important facts and preferences for this project:

${lines}
</memory>`
  }

  async clearAll(): Promise<void> {
    const entries = await longTermMemoryService.getEntries()
    for (const entry of entries) {
      if (entry.status !== 'forgotten') {
        await longTermMemoryService.deleteEntry(entry.id)
      }
    }
  }

  clearCache(): void {
    longTermMemoryService.clearCache()
  }
}

export const memoryService = new MemoryService()
