import { knowledgeService } from './knowledgeService'
import type { KnowledgeEntry } from './knowledgeService/types'

export interface MemoryItem {
  id: string
  content: string
  createdAt: number
  enabled: boolean
}

function entryToMemoryItem(entry: KnowledgeEntry): MemoryItem {
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
      await knowledgeService.migrateFromMemoryService()
    } catch {
      // migration failure is non-fatal
    }
  }

  async getMemories(): Promise<MemoryItem[]> {
    await this.ensureMigrated()
    const entries = await knowledgeService.getEnabledEntries()
    return entries.filter(e => e.layer === 'manual').map(entryToMemoryItem)
  }

  async getAllMemories(): Promise<MemoryItem[]> {
    await this.ensureMigrated()
    const entries = await knowledgeService.getEntries('manual')
    return entries.map(entryToMemoryItem)
  }

  async addMemory(content: string): Promise<MemoryItem> {
    await this.ensureMigrated()
    const entry = await knowledgeService.addEntry({
      content,
      layer: 'manual',
      source: 'user',
    })
    return entryToMemoryItem(entry)
  }

  async updateMemory(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'enabled'>>): Promise<boolean> {
    await this.ensureMigrated()
    return knowledgeService.updateEntry(id, {
      content: updates.content,
      enabled: updates.enabled,
    })
  }

  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureMigrated()
    return knowledgeService.deleteEntry(id)
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
    const entries = await knowledgeService.getEntries('manual')
    for (const entry of entries) {
      await knowledgeService.deleteEntry(entry.id)
    }
  }

  clearCache(): void {
    knowledgeService.clearCache()
  }
}

export const memoryService = new MemoryService()
