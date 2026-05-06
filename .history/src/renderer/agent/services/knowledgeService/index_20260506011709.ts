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
  type KnowledgeSource,
} from './types'

const CURRENT_VERSION = 2
const MAX_ENTRIES = 500
const STORE_FILE = '.aweeclaw/knowledge/store.json'
const OLD_MANUAL_FILE = '.aweeclaw/knowledge/manual.json'
const OLD_MEMORY_FILE = '.aweeclaw/memory.json'

class KnowledgeService {
  private cache: KnowledgeStore | null = null

  async getEntries(): Promise<KnowledgeEntry[]> {
    const store = await this.loadStore()
    return store.entries
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
    const normalizedContent = input.content.trim()
    if (!normalizedContent) {
      throw new Error('Content cannot be empty')
    }

    const store = await this.loadStore()
    const existing = store.entries.find(
      e => e.content.trim() === normalizedContent
    )
    if (existing) return existing

    const now = Date.now()
    const entry: KnowledgeEntry = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || this.autoTitle(normalizedContent),
      content: normalizedContent,
      category: input.category ?? this.inferCategory(normalizedContent),
      tags: input.tags ?? this.extractTags(normalizedContent),
      starred: input.starred ?? false,
      enabled: input.enabled ?? true,
      source: input.source ?? 'user',
      sourceDetail: input.sourceDetail,
      confidence: input.confidence ?? (input.source === 'user' ? 1.0 : 0.9),
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    }

    store.entries.unshift(entry)
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES)
    }

    await this.saveStore(store)
    logger.agent.info('[KnowledgeService] Added entry:', entry.id, 'source:', entry.source)
    return entry
  }

  async updateEntry(
    id: string,
    updates: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'category' | 'tags' | 'starred' | 'enabled'>>
  ): Promise<boolean> {
    const store = await this.loadStore()
    const entry = store.entries.find(e => e.id === id)
    if (!entry) return false

    if (updates.title !== undefined) entry.title = updates.title.trim()
    if (updates.content !== undefined) entry.content = updates.content.trim()
    if (updates.category !== undefined) entry.category = updates.category
    if (updates.tags !== undefined) entry.tags = updates.tags
    if (updates.starred !== undefined) entry.starred = updates.starred
    if (updates.enabled !== undefined) entry.enabled = updates.enabled
    entry.updatedAt = Date.now()

    await this.saveStore(store)
    return true
  }

  async deleteEntry(id: string): Promise<boolean> {
    const store = await this.loadStore()
    const idx = store.entries.findIndex(e => e.id === id)
    if (idx === -1) return false

    store.entries.splice(idx, 1)
    await this.saveStore(store)
    return true
  }

  async search(params: KnowledgeSearchParams): Promise<KnowledgeSearchResult[]> {
    const entries = await this.getEntries()
    const query = params.query.toLowerCase()

    let filtered = entries.filter(e => {
      if (!e.enabled) return false
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
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown'
    const ext = fileName.split('.').pop()?.toLowerCase()

    let rawContent: string | null = null

    if (ext === 'docx') {
      rawContent = await api.file.extractDocxText(filePath)
    } else if (ext === 'doc') {
      rawContent = await api.file.extractDocText(filePath)
    } else if (ext === 'ppt' || ext === 'pptx') {
      rawContent = await api.file.extractPptText(filePath)
    } else if (ext === 'xlsx' || ext === 'xls') {
      rawContent = await api.file.extractXlsxText(filePath)
    } else if (ext === 'pdf') {
      rawContent = await api.file.extractPdfText(filePath)
    } else {
      rawContent = await api.file.read(filePath)
    }

    if (!rawContent) throw new Error('File not found or empty')

    let entries: { title: string; content: string; category: KnowledgeCategory }[] = []

    if (ext === 'json') {
      entries = this.parseJsonContent(rawContent, fileName)
    } else if (ext === 'md' || ext === 'markdown') {
      entries = this.parseMarkdownContent(rawContent)
    } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      entries = this.parseStructuredContent(rawContent, fileName)
    } else {
      entries = this.parseTextContent(rawContent, fileName)
    }

    let imported = 0
    let skipped = 0

    for (const item of entries) {
      try {
        await this.addEntry({
          title: item.title,
          content: item.content,
          category: item.category,
          tags: this.extractTags(item.content),
          source: 'file',
          sourceDetail: fileName,
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
      const text = await response.text()

      let rawContent: string

      if (contentType.includes('text/html')) {
        rawContent = this.htmlToMarkdown(text)
      } else if (contentType.includes('application/json')) {
        rawContent = text
      } else {
        rawContent = text
      }

      let entries: { title: string; content: string; category: KnowledgeCategory }[] = []

      if (contentType.includes('application/json')) {
        entries = this.parseJsonContent(rawContent, url)
      } else if (contentType.includes('text/html')) {
        entries = this.parseMarkdownContent(rawContent)
      } else {
        entries = this.parseTextContent(rawContent, url)
      }

      let imported = 0
      let skipped = 0

      for (const item of entries) {
        try {
          await this.addEntry({
            title: item.title,
            content: item.content,
            category: item.category,
            tags: this.extractTags(item.content),
            source: 'url',
            sourceDetail: url.slice(0, 100),
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

    const starredFirst = [...enabled.filter(e => e.starred), ...enabled.filter(e => !e.starred)]

    for (const entry of starredFirst) {
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
    this.cache = null
  }

  async migrateFromMemoryService(): Promise<number> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return 0

    const store = await this.loadStore()
    if (store.migratedFromMemory) return 0

    let totalMigrated = 0

    const oldFilePath = joinPath(workspacePath, OLD_MEMORY_FILE)
    const oldContent = await api.file.read(oldFilePath)
    if (oldContent) {
      try {
        const oldStore = JSON.parse(oldContent)
        if (oldStore && Array.isArray(oldStore.items)) {
          for (const item of oldStore.items) {
            if (!item.content || typeof item.content !== 'string') continue
            const exists = store.entries.some(
              e => e.content.trim() === item.content.trim()
            )
            if (exists) continue

            store.entries.push({
              id: item.id || crypto.randomUUID(),
              title: this.autoTitle(item.content),
              content: item.content.trim(),
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
            totalMigrated++
          }
        }
      } catch (err) {
        logger.agent.warn('[KnowledgeService] Failed to migrate old memory data:', err)
      }
    }

    const oldManualPath = joinPath(workspacePath, OLD_MANUAL_FILE)
    const oldManualContent = await api.file.read(oldManualPath)
    if (oldManualContent) {
      try {
        const oldManual = JSON.parse(oldManualContent)
        if (oldManual && Array.isArray(oldManual.entries)) {
          for (const item of oldManual.entries) {
            if (!item.content || typeof item.content !== 'string') continue
            const exists = store.entries.some(
              e => e.content.trim() === item.content.trim()
            )
            if (exists) continue

            store.entries.push({
              id: item.id || crypto.randomUUID(),
              title: item.title || this.autoTitle(item.content),
              content: item.content.trim(),
              category: item.category || this.inferCategory(item.content),
              tags: item.tags || this.extractTags(item.content),
              starred: item.starred || false,
              enabled: item.enabled !== false,
              source: 'migrated',
              confidence: item.confidence ?? 1.0,
              accessCount: item.accessCount ?? 0,
              createdAt: item.createdAt || Date.now(),
              updatedAt: Date.now(),
            })
            totalMigrated++
          }
        }
      } catch (err) {
        logger.agent.warn('[KnowledgeService] Failed to migrate old manual data:', err)
      }
    }

    if (totalMigrated > 0) {
      store.migratedFromMemory = true
      await this.saveStore(store)
      logger.agent.info(`[KnowledgeService] Migrated ${totalMigrated} entries from old stores`)
    }

    return totalMigrated
  }

  private async loadStore(): Promise<KnowledgeStore> {
    if (this.cache) return this.cache

    const { workspacePath } = useStore.getState()
    if (!workspacePath) return this.createEmptyStore()

    const filePath = joinPath(workspacePath, STORE_FILE)
    const content = await api.file.read(filePath)

    if (!content) return this.createEmptyStore()

    try {
      const store = this.normalizeStore(JSON.parse(content))
      this.cache = store
      return store
    } catch {
      logger.agent.warn('[KnowledgeService] Failed to parse store')
      return this.createEmptyStore()
    }
  }

  private async saveStore(store: KnowledgeStore): Promise<void> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return

    this.cache = store

    const knowledgeDir = joinPath(workspacePath, '.aweeclaw/knowledge')
    const filePath = joinPath(workspacePath, STORE_FILE)
    const content = JSON.stringify(store, null, 2)

    await api.file.ensureDir(knowledgeDir)
    await api.file.write(filePath, content)
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

    const c = raw as any
    if (typeof c.content !== 'string' || !c.content.trim()) return null

    return {
      id: typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID(),
      title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : this.autoTitle(c.content),
      content: c.content.trim(),
      category: this.isValidCategory(c.category) ? c.category : 'concept',
      tags: Array.isArray(c.tags) ? c.tags.filter((t: any) => typeof t === 'string') : [],
      starred: c.starred === true,
      enabled: c.enabled !== false,
      source: this.normalizeSource(c.source),
      sourceDetail: typeof c.sourceDetail === 'string' ? c.sourceDetail : undefined,
      confidence: typeof c.confidence === 'number' ? Math.min(1, Math.max(0, c.confidence)) : 1.0,
      accessCount: typeof c.accessCount === 'number' ? c.accessCount : 0,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : undefined,
    }
  }

  private normalizeSource(source: unknown): KnowledgeSource {
    if (typeof source === 'string') {
      if (['user', 'file', 'url', 'database', 'web-crawl', 'migrated'].includes(source)) {
        return source as KnowledgeSource
      }
      if (source === 'auto' || source === 'auto_extracted') return 'user'
    }
    return 'user'
  }

  private isValidCategory(cat: unknown): cat is KnowledgeCategory {
    return typeof cat === 'string' && [
      'concept', 'decision', 'faq', 'reference',
      'glossary', 'best-practice', 'error-solution', 'api', 'pattern', 'document',
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
      }
    } catch {
      entries.push({ title: fileName, content, category: 'document' })
    }
    return entries
  }

  private parseMarkdownContent(content: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []
    const sections = content.split(/^(?=#{1,3}\s)/m).filter(Boolean)

    if (sections.length <= 1) {
      entries.push({ title: this.autoTitle(content), content: content.trim(), category: 'document' })
      return entries
    }

    for (const section of sections) {
      const lines = section.trim().split('\n')
      const title = lines[0].replace(/^#{1,3}\s+/, '').trim()
      const body = lines.slice(1).join('\n').trim()
      if (body) {
        entries.push({ title: title || this.autoTitle(body), content: body, category: 'document' })
      }
    }

    return entries.length > 0 ? entries : [{ title: this.autoTitle(content), content: content.trim(), category: 'document' }]
  }

  private parseTextContent(content: string, fileName: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []

    if (fileName.endsWith('.csv')) {
      const lines = content.split('\n').filter(l => l.trim())
      if (lines.length > 1) {
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
          const rowContent = headers.map((h, idx) => `${h}: ${values[idx] || ''}`).join('\n')
          entries.push({
            title: `${fileName} - Row ${i}`,
            content: rowContent,
            category: 'reference',
          })
        }
      }
      return entries.length > 0 ? entries : [{ title: fileName, content, category: 'document' }]
    }

    const paragraphs = content.split(/\n{2,}/).filter(p => p.trim())
    if (paragraphs.length <= 1) {
      entries.push({ title: this.autoTitle(content), content: content.trim(), category: 'document' })
    } else {
      for (const para of paragraphs) {
        entries.push({ title: this.autoTitle(para), content: para.trim(), category: 'document' })
      }
    }

    return entries
  }

  private parseStructuredContent(content: string, fileName: string): { title: string; content: string; category: KnowledgeCategory }[] {
    const entries: { title: string; content: string; category: KnowledgeCategory }[] = []
    const sheetSections = content.split(/(?=^## Sheet: )/m).filter(Boolean)

    for (const section of sheetSections) {
      const lines = section.trim().split('\n')
      const sheetTitle = lines[0].replace(/^## Sheet:\s*/, '').trim()
      const body = lines.slice(1).join('\n').trim()

      if (!body) continue

      const csvLines = body.split('\n')
      if (csvLines.length < 2) {
        entries.push({ title: `${fileName} - ${sheetTitle}`, content: body, category: 'reference' })
        continue
      }

      const headers = csvLines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      const chunkSize = 50
      for (let i = 1; i < csvLines.length; i += chunkSize) {
        const chunk = csvLines.slice(i, i + chunkSize)
        const rowTexts = chunk.map(row => {
          const values = row.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
          return headers.map((h, idx) => `${h}: ${values[idx] || ''}`).join('\n')
        })
        const chunkContent = rowTexts.join('\n\n---\n\n')
        const startRow = i
        const endRow = Math.min(i + chunkSize - 1, csvLines.length - 1)
        entries.push({
          title: `${fileName} - ${sheetTitle} (Rows ${startRow}-${endRow})`,
          content: chunkContent,
          category: 'reference',
        })
      }
    }

    return entries.length > 0 ? entries : [{ title: fileName, content, category: 'document' }]
  }

  private htmlToMarkdown(html: string): string {
    let text = html
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '')
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '')
    text = text.replace(/<header[\s\S]*?<\/header>/gi, '')
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
    text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n')
    text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n')
    text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n')
    text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n')
    text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')
    text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n')
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '![$1]')
    text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n')
    text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
      const rows = tableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
      return rows.map(row => {
        const cells = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || []
        return '| ' + cells.map(c => c.replace(/<\/?t[hd][^>]*>/gi, '').trim()).join(' | ') + ' |'
      }).join('\n') + '\n'
    })
    text = text.replace(/<[^>]+>/g, '')
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#39;/g, "'")
    text = text.replace(/&nbsp;/g, ' ')
    text = text.replace(/\n{3,}/g, '\n\n')
    return text.trim()
  }
}

export const knowledgeService = new KnowledgeService()
