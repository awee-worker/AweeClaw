import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'
import {
  type KnowledgeEntry,
  type KnowledgeEntryInput,
  type KnowledgeSearchParams,
  type KnowledgeSearchResult,
  type KnowledgeStore,
  type KnowledgeCategory,
  type KnowledgeLayer,
} from './types'

const CURRENT_VERSION = 1
const MAX_ENTRIES = 200
const MANUAL_FILE = '.aweeclaw/knowledge/manual.json'
const CONVERSATION_FILE = '.aweeclaw/knowledge/conversation.json'
const OLD_MEMORY_FILE = '.aweeclaw/memory.json'

class KnowledgeService {
  private manualCache: KnowledgeStore | null = null
  private conversationCache: KnowledgeStore | null = null

  async getEntries(layer?: KnowledgeLayer): Promise<KnowledgeEntry[]> {
    const stores = await this.loadAllStores()
    let entries: KnowledgeEntry[] = []
    for (const store of stores) {
      entries = entries.concat(store.entries)
    }
    if (layer) {
      entries = entries.filter(e => e.layer === layer)
    }
    return entries
  }

  async getEnabledEntries(): Promise<KnowledgeEntry[]> {
    const entries = await this.getEntries()
    return entries.filter(e => e.enabled)
  }

  async getEntry(id: string): Promise<KnowledgeEntry | null> {
    const entries = await this.getEntries()
    return entries.find(e => e.id === id) ?? null
  }

  async addEntry(input: KnowledgeEntryInput): Promise<KnowledgeEntry> {
    const layer = input.layer ?? 'manual'
    const normalizedContent = input.content.trim()
    if (!normalizedContent) {
      throw new Error('Content cannot be empty')
    }

    const store = await this.loadStore(layer)
    const existing = store.entries.find(
      e => e.content.trim() === normalizedContent && e.layer === layer
    )
    if (existing) return existing

    const now = Date.now()
    const entry: KnowledgeEntry = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || this.autoTitle(normalizedContent),
      content: normalizedContent,
      layer,
      category: input.category ?? this.inferCategory(normalizedContent),
      tags: input.tags ?? this.extractTags(normalizedContent),
      starred: input.starred ?? false,
      enabled: input.enabled ?? true,
      source: input.source ?? (layer === 'manual' ? 'user' : 'auto'),
      confidence: input.confidence ?? (layer === 'manual' ? 1.0 : 0.8),
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    store.entries.unshift(entry)
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES)
    }

    await this.saveStore(layer, store)
    logger.agent.info('[KnowledgeService] Added entry:', entry.id, 'layer:', layer)
    return entry
  }

  async updateEntry(
    id: string,
    updates: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'category' | 'tags' | 'starred' | 'enabled'>>
  ): Promise<boolean> {
    const layer = await this.findEntryLayer(id)
    if (!layer) return false

    const store = await this.loadStore(layer)
    const entry = store.entries.find(e => e.id === id)
    if (!entry) return false

    if (updates.title !== undefined) entry.title = updates.title.trim()
    if (updates.content !== undefined) entry.content = updates.content.trim()
    if (updates.category !== undefined) entry.category = updates.category
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.starred !== undefined) entry.starred = updates.starred
    if (updates.enabled !== undefined) entry.enabled = updates.enabled
    entry.updatedAt = Date.now()

    await this.saveStore(layer, store)
    return true
  }

  async deleteEntry(id: string): Promise<boolean> {
    const layer = await this.findEntryLayer(id)
    if (!layer) return false

    const store = await this.loadStore(layer)
    const idx = store.entries.findIndex(e => e.id === id)
    if (idx === -1) return false

    store.entries.splice(idx, 1)
    await this.saveStore(layer, store)
    return true
  }

  async search(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult[]> {
    const entries = await this.getEntries()
    const query = params.query.toLowerCase()

    let filtered = entries.filter(e => {
      if (!e.enabled) return false
      if (params.layer && e.layer !== params.layer) return false
      if (params.category && e.category !== params.category) return false
      if (params.starred !== undefined && e.starred !== params.starred) return false
      if (params.tags && params.tags.length > 0) {
        if (!params.tags.some(t => e.tags.includes(t))) return false
      }
      return true
    })

    const results: KnowledgeSearchResult[] = filtered
      .map(entry => {
        let score = 0
        const titleLower = entry.title.toLowerCase()
        const contentLower = entry.content.toLowerCase()

        if (titleLower === query) score += 10
        else if (titleLower.includes(query)) score += 5

        if (contentLower.includes(query)) score += 3

        for (const tag of entry.tags) {
          if (tag.toLowerCase().includes(query)) score += 2
          if (query.includes(tag.toLowerCase())) score += 1
        }

        for (const word of query.split(/\s+/)) {
          if (word.length < 2) continue
          if (titleLower.includes(word)) score += 2
          if (contentLower.includes(word)) score += 1
        }

        score += entry.starred ? 1 : 0
        score += entry.confidence * 2
        const recencyBoost = Math.max(0, 1 - (Date.now() - entry.updatedAt) / (30 * 86_400_000))
        score += recencyBoost

        return { entry, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)

    if (params.limit) {
      return results.slice(0, params.limit)
    }
    return results
  }

  async semanticSearch(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult[]> {
    const keywordResults = await this.search(params)

    try {
      const { workspacePath } = useStore.getState()
      if (!workspacePath) return keywordResults

      const store = useStore.getState()
      const config = await this.getEmbeddingConfig()
      if (!config) return keywordResults

      const enabled = await this.getEnabledEntries()
      if (enabled.length === 0) return keywordResults

      const candidates = enabled.map(e => e.content.slice(0, 200))
      const similar = await api.llm.findSimilar({
        query: params.query,
        candidates,
        config,
        topK: params.limit ?? 10,
      })

      if (!similar || similar.length === 0) return keywordResults

      const semanticResults: KnowledgeSearchResult[] = similar
        .map(s => {
          const entry = enabled[s.index]
          if (!entry) return null
          return { entry, score: s.similarity * 10 }
        })
        .filter((r): r is KnowledgeSearchResult => r !== null)

      const merged = new Map<string, KnowledgeSearchResult>()
      for (const r of keywordResults) {
        merged.set(r.entry.id, r)
      }
      for (const r of semanticResults) {
        const existing = merged.get(r.entry.id)
        if (existing) {
          existing.score = existing.score * 0.4 + r.score * 0.6
        } else {
          merged.set(r.entry.id, r)
        }
      }

      return [...merged.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, params.limit ?? 20)
    } catch (err) {
      logger.agent.warn('[KnowledgeService] Semantic search failed, falling back to keyword:', err)
      return keywordResults
    }
  }

  async importFromFile(filePath: string): Promise<{ imported: number; skipped: number }> {
    const content = await api.file.read(filePath)
    if (!content) throw new Error('File not found or empty')

    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown'
    const ext = fileName.split('.').pop()?.toLowerCase()

    let entries: { title: string; content: string; category: KnowledgeCategory }[] = []

    if (ext === 'json') {
      entries = this.parseJsonContent(content, fileName)
    } else if (ext === 'md' || ext === 'markdown') {
      entries = this.parseMarkdownContent(content)
    } else if (ext === 'txt' || ext === 'csv') {
      entries = this.parseTextContent(content, fileName)
    } else {
      entries = this.parseTextContent(content, fileName)
    }

    let imported = 0
    let skipped = 0

    for (const item of entries) {
      try {
        await this.addEntry({
          title: item.title,
          content: item.content,
          layer: 'manual',
          category: item.category,
          tags: this.extractTags(item.content),
          source: `file:${fileName}`,
          confidence: 0.9,
        })
        imported++
      } catch {
        skipped++
      }
    }

    logger.agent.info(`[KnowledgeService] Imported ${imported} entries from ${fileName}, skipped ${skipped}`)
    return { imported, skipped }
  }

  async importFromUrl(url: string): Promise<{ imported: number; skipped: number }> {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentType = response.headers.get('content-type') || ''
      let text: string

      if (contentType.includes('json')) {
        text = await response.text()
      } else {
        text = await response.text()
      }

      const entries = this.parseTextContent(text, url)
      let imported = 0
      let skipped = 0

      for (const item of entries) {
        try {
          await this.addEntry({
            title: item.title,
            content: item.content,
            layer: 'manual',
            category: item.category,
            tags: this.extractTags(item.content),
            source: `url:${url.slice(0, 100)}`,
            confidence: 0.7,
          })
          imported++
        } catch {
          skipped++
        }
      }

      logger.agent.info(`[KnowledgeService] Imported ${imported} entries from URL, skipped ${skipped}`)
      return { imported, skipped }
    } catch (err) {
      logger.agent.warn('[KnowledgeService] URL import failed:', err)
      throw new Error(`Failed to import from URL: ${(err as Error).message}`)
    }
  }

  buildContextPrompt(entries: KnowledgeEntry[], tokenBudget: number = 2000): string {
    const enabled = entries.filter(e => e.enabled && e.content.trim())
    if (enabled.length === 0) return ''

    const lines: string[] = []
    let estimatedTokens = 0

    const manualEntries = enabled.filter(e => e.layer === 'manual')
    const otherEntries = enabled.filter(e => e.layer !== 'manual')
    const ordered = [...manualEntries, ...otherEntries]

    for (const entry of ordered) {
      const tag = entry.tags.length > 0 ? ` [${entry.tags.join(',')}]` : ''
      const line = `- [${entry.category}]${tag} ${entry.content}`
      const lineTokens = Math.ceil(line.length / 4)

      if (estimatedTokens + lineTokens > tokenBudget) break

      lines.push(line)
      estimatedTokens += lineTokens
    }

    if (lines.length === 0) return ''

    return `<knowledge>
Project knowledge base:

${lines.join('\n')}
</knowledge>`
  }

  async clearCache(): Promise<void> {
    this.manualCache = null
    this.conversationCache = null
  }

  async migrateFromMemoryService(): Promise<number> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return 0

    const manualStore = await this.loadStore('manual')
    if (manualStore.migratedFromMemory) return 0

    const oldFilePath = joinPath(workspacePath, OLD_MEMORY_FILE)
    const oldContent = await api.file.read(oldFilePath)
    if (!oldContent) return 0

    try {
      const oldStore = JSON.parse(oldContent)
      if (!oldStore || !Array.isArray(oldStore.items)) return 0

      let migrated = 0
      for (const item of oldStore.items) {
        if (!item.content || typeof item.content !== 'string') continue
        const exists = manualStore.entries.some(
          e => e.content.trim() === item.content.trim()
        )
        if (exists) continue

        manualStore.entries.push({
          id: item.id || crypto.randomUUID(),
          title: this.autoTitle(item.content),
          content: item.content.trim(),
          layer: 'manual',
          category: this.inferCategory(item.content),
          tags: this.extractTags(item.content),
          starred: false,
          enabled: item.enabled !== false,
          source: 'migrated',
          confidence: 1.0,
          accessCount: 0,
          createdAt: item.createdAt || Date.now(),
          updatedAt: Date.now(),
        })
        migrated++
      }

      if (migrated > 0) {
        manualStore.migratedFromMemory = true
        await this.saveStore('manual', manualStore)
        logger.agent.info(`[KnowledgeService] Migrated ${migrated} entries from old memory service`)
      }

      return migrated
    } catch (err) {
      logger.agent.warn('[KnowledgeService] Failed to migrate old memory data:', err)
      return 0
    }
  }

  private async loadStore(layer: KnowledgeLayer): Promise<KnowledgeStore> {
    if (layer === 'manual' && this.manualCache) return this.manualCache
    if (layer === 'conversation' && this.conversationCache) return this.conversationCache

    const { workspacePath } = useStore.getState()
    if (!workspacePath) return this.createEmptyStore()

    const filePath = joinPath(workspacePath, layer === 'manual' ? MANUAL_FILE : CONVERSATION_FILE)
    const content = await api.file.read(filePath)

    if (!content) return this.createEmptyStore()

    try {
      const store = this.normalizeStore(JSON.parse(content))
      if (layer === 'manual') this.manualCache = store
      if (layer === 'conversation') this.conversationCache = store
      return store
    } catch {
      logger.agent.warn(`[KnowledgeService] Failed to parse ${layer} store`)
      return this.createEmptyStore()
    }
  }

  private async loadAllStores(): Promise<KnowledgeStore[]> {
    const [manual, conversation] = await Promise.all([
      this.loadStore('manual'),
      this.loadStore('conversation'),
    ])
    return [manual, conversation]
  }

  private async saveStore(layer: KnowledgeLayer, store: KnowledgeStore): Promise<void> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return

    const normalized = this.normalizeStore(store)
    if (layer === 'manual') this.manualCache = normalized
    if (layer === 'conversation') this.conversationCache = normalized

    const knowledgeDir = joinPath(workspacePath, '.aweeclaw/knowledge')
    const filePath = joinPath(
      workspacePath,
      layer === 'manual' ? MANUAL_FILE : CONVERSATION_FILE
    )
    const content = JSON.stringify(normalized, null, 2)

    await api.file.ensureDir(knowledgeDir)
    await api.file.write(filePath, content)
  }

  private async findEntryLayer(id: string): Promise<KnowledgeLayer | null> {
    const manualStore = await this.loadStore('manual')
    if (manualStore.entries.some(e => e.id === id)) return 'manual'

    const convStore = await this.loadStore('conversation')
    if (convStore.entries.some(e => e.id === id)) return 'conversation'

    return null
  }

  private createEmptyStore(): KnowledgeStore {
    return { version: CURRENT_VERSION, entries: [] }
  }

  private normalizeStore(raw: unknown): KnowledgeStore {
    if (!raw || typeof raw !== 'object') return this.createEmptyStore()

    const candidate = raw as Partial<KnowledgeStore> & { entries?: unknown }
    const entries = Array.isArray(candidate.entries)
      ? candidate.entries
          .map(item => this.normalizeEntry(item))
          .filter((e): e is KnowledgeEntry => e !== null)
          .slice(0, MAX_ENTRIES)
      : []

    return {
      version: typeof candidate.version === 'number' ? candidate.version : CURRENT_VERSION,
      entries,
      migratedFromMemory: (candidate as any).migratedFromMemory ?? false,
    }
  }

  private normalizeEntry(raw: unknown): KnowledgeEntry | null {
    if (!raw || typeof raw !== 'object') return null

    const c = raw as Partial<KnowledgeEntry>
    if (typeof c.content !== 'string' || !c.content.trim()) return null

    return {
      id: typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID(),
      title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : this.autoTitle(c.content),
      content: c.content.trim(),
      layer: (['manual', 'conversation', 'codebase'] as const).includes(c.layer as any) ? c.layer as KnowledgeLayer : 'manual',
      category: this.isValidCategory(c.category) ? c.category! : 'concept',
      tags: Array.isArray(c.tags) ? c.tags.filter((t: any) => typeof t === 'string') : [],
      starred: c.starred === true,
      enabled: c.enabled !== false,
      source: typeof c.source === 'string' ? c.source : 'user',
      confidence: typeof c.confidence === 'number' ? Math.min(1, Math.max(0, c.confidence)) : 1.0,
      accessCount: typeof c.accessCount === 'number' ? c.accessCount : 0,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : undefined,
    }
  }

  private isValidCategory(cat: unknown): cat is KnowledgeCategory {
    return typeof cat === 'string' && [
      'concept', 'decision', 'preference', 'faq', 'reference',
      'glossary', 'best-practice', 'error-solution', 'api', 'pattern',
    ].includes(cat)
  }

  private autoTitle(content: string): string {
    const trimmed = content.trim()
    const firstLine = trimmed.split('\n')[0]
    if (firstLine.length <= 50) return firstLine
    return firstLine.slice(0, 47) + '...'
  }

  private inferCategory(content: string): KnowledgeCategory {
    const lower = content.toLowerCase()
    if (/prefer|喜欢|偏好|prefer/i.test(lower)) return 'preference'
    if (/error|bug|fix|解决|修复/i.test(lower)) return 'error-solution'
    if (/decide|决定|决策|架构/i.test(lower)) return 'decision'
    if (/api|endpoint|接口/i.test(lower)) return 'api'
    if (/best.?practice|最佳实践/i.test(lower)) return 'best-practice'
    if (/faq|常见问题/i.test(lower)) return 'faq'
    return 'concept'
  }

  private extractTags(text: string): string[] {
    const tags: string[] = []
    const patterns = [
      /\b(react|vue|angular|svelte|next|nuxt)\b/gi,
      /\b(typescript|javascript|python|rust|go|java)\b/gi,
      /\b(docker|kubernetes|aws|gcp|azure)\b/gi,
      /\b(postgres|mysql|mongodb|redis|sqlite)\b/gi,
      /\b(git|github|gitlab)\b/gi,
      /\b(tailwind|css|scss)\b/gi,
      /\b(vite|webpack|esbuild|rollup)\b/gi,
      /\b(jest|vitest|cypress|playwright)\b/gi,
    ]
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern)
      for (const match of matches) {
        tags.push(match[1].toLowerCase())
      }
    }
    return [...new Set(tags)]
  }

  private async getEmbeddingConfig() {
    try {
      const { getLLMConfigForTask } = await import('../llmConfigService')
      const store = useStore.getState()
      return getLLMConfigForTask(store.llmConfig.provider, store.llmConfig.model)
    } catch {
      return null
    }
  }

  private parseJsonContent(content: string, fileName: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []
    try {
      const data = JSON.parse(content)
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string' && item.trim()) {
            entries.push({ title: this.autoTitle(item), content: item.trim(), category: 'concept' })
          } else if (item && typeof item === 'object') {
            const text = item.content || item.text || item.description || item.value
            if (typeof text === 'string' && text.trim()) {
              entries.push({
                title: item.title || item.name || this.autoTitle(text),
                content: text.trim(),
                category: this.inferCategory(text),
              })
            }
          }
        }
      } else if (data && typeof data === 'object') {
        const text = data.content || data.text || data.description
        if (typeof text === 'string' && text.trim()) {
          entries.push({
            title: data.title || data.name || fileName,
            content: text.trim(),
            category: this.inferCategory(text),
          })
        }
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'string' && value.trim() && key !== 'content' && key !== 'text') {
            entries.push({
              title: key,
              content: value.trim(),
              category: 'reference',
            })
          }
        }
      }
    } catch {
      // not valid JSON, treat as text
      entries.push(...this.parseTextContent(content, fileName))
    }
    return entries
  }

  private parseMarkdownContent(content: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []
    const sections = content.split(/^(#{1,3})\s+(.+)$/m)

    let i = 1
    while (i < sections.length) {
      const level = sections[i]
      const title = sections[i + 1]?.trim()
      const body = sections[i + 2]?.trim()
      if (title && body) {
        const chunkSize = 500
        if (body.length <= chunkSize) {
          entries.push({ title, content: body, category: this.inferCategory(body) })
        } else {
          const chunks = body.match(new RegExp(`.{1,${chunkSize}}`, 'gs')) || [body]
          for (let j = 0; j < chunks.length; j++) {
            entries.push({
              title: chunks.length > 1 ? `${title} (${j + 1}/${chunks.length})` : title,
              content: chunks[j].trim(),
              category: this.inferCategory(chunks[j]),
            })
          }
        }
      }
      i += 3
    }

    if (entries.length === 0 && content.trim()) {
      entries.push(...this.parseTextContent(content, 'markdown'))
    }
    return entries
  }

  private parseTextContent(content: string, source: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []
    const lines = content.split('\n')
    const chunkSize = 300
    let currentChunk: string[] = []
    let chunkIndex = 0

    for (const line of lines) {
      currentChunk.push(line)
      const chunkText = currentChunk.join('\n').trim()
      if (chunkText.length >= chunkSize) {
        entries.push({
          title: currentChunk.length > 1 ? `${source} (${chunkIndex + 1})` : source,
          content: chunkText,
          category: 'reference',
        })
        currentChunk = []
        chunkIndex++
      }
    }

    if (currentChunk.length > 0) {
      const remaining = currentChunk.join('\n').trim()
      if (remaining) {
        entries.push({
          title: chunkIndex > 0 ? `${source} (${chunkIndex + 1})` : source,
          content: remaining,
          category: 'reference',
        })
      }
    }

    return entries
  }
}

export const knowledgeService = new KnowledgeService()
