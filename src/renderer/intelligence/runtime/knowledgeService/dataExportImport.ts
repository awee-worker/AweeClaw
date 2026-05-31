import { logger } from '@toolkit/LogEngine'
import { knowledgeService } from './index'
import { localGraphStore, type LocalGraphEntity, type LocalGraphRelation } from './localGraphStore'
import { e2eEncryption, type EncryptedPayload } from './e2eEncryption'
import { localVectorIndex } from './localVectorIndex'
import { useStore } from '@store'

const EXPORT_VERSION = 1

interface ExportManifest {
  version: number
  exportedAt: string
  deviceId: string
  encrypted: boolean
  entryCount: number
  entityCount: number
  relationCount: number
}

interface ExportData {
  manifest: ExportManifest
  entries: ExportEntry[]
  graphEntities: ExportGraphEntity[]
  graphRelations: ExportGraphRelation[]
}

interface ExportEntry {
  title: string
  content: string
  category: string
  tags: string[]
  source: string
  sourceDetail: string
  confidence: number
  starred: boolean
  enabled: boolean
  accessCount: number
  createdAt: number
  updatedAt: number
  encryptedPayload?: EncryptedPayload
}

interface ExportGraphEntity {
  name: string
  type: string
  properties: Record<string, unknown>
  entryId: string | null
}

interface ExportGraphRelation {
  sourceId: string
  targetId: string
  type: string
  properties: Record<string, unknown>
}

interface ImportResult {
  entriesImported: number
  entitiesImported: number
  relationsImported: number
  skipped: number
  errors: number
}

class DataExportImportService {
  async exportData(options: { encrypt?: boolean } = {}): Promise<string> {
    const { encrypt = false } = options
    const privacy = useStore.getState().privacySettings

    const entries = await knowledgeService.getEntries()
    const graphEntities = await localGraphStore.getEntities()
    const graphRelations = await localGraphStore.getRelations()

    const exportEntries: ExportEntry[] = []
    for (const entry of entries) {
      const exportEntry: ExportEntry = {
        title: entry.title,
        content: entry.content,
        category: entry.category,
        tags: entry.tags,
        source: entry.source,
        sourceDetail: entry.sourceDetail ?? '',
        confidence: entry.confidence,
        starred: entry.starred,
        enabled: entry.enabled,
        accessCount: entry.accessCount ?? 0,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }

      if (encrypt && privacy.enableE2EE) {
        try {
          const plainData = JSON.stringify({
            title: entry.title,
            content: entry.content,
          })
          exportEntry.encryptedPayload = await e2eEncryption.encrypt(plainData)
          exportEntry.title = '[ENCRYPTED]'
          exportEntry.content = '[ENCRYPTED]'
        } catch (err) {
          logger.agent.warn(`[DataExport] Encryption failed for entry, exporting as plain:`, err)
        }
      }

      exportEntries.push(exportEntry)
    }

    const exportGraphEntities: ExportGraphEntity[] = graphEntities.map(e => ({
      name: e.name,
      type: e.type,
      properties: e.properties ?? {},
      entryId: e.entryId,
    }))

    const exportGraphRelations: ExportGraphRelation[] = graphRelations.map(r => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
      properties: r.properties ?? {},
    }))

    const manifest: ExportManifest = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      deviceId: crypto.randomUUID(),
      encrypted: encrypt && privacy.enableE2EE,
      entryCount: exportEntries.length,
      entityCount: exportGraphEntities.length,
      relationCount: exportGraphRelations.length,
    }

    const data: ExportData = {
      manifest,
      entries: exportEntries,
      graphEntities: exportGraphEntities,
      graphRelations: exportGraphRelations,
    }

    logger.agent.info(
      `[DataExport] Exported ${manifest.entryCount} entries, ${manifest.entityCount} entities, ${manifest.relationCount} relations${manifest.encrypted ? ' (encrypted)' : ''}`,
    )

    return JSON.stringify(data, null, 2)
  }

  async importData(
    jsonString: string,
    options: { merge?: boolean; decrypt?: boolean } = {},
  ): Promise<ImportResult> {
    const { merge = true, decrypt = true } = options
    const result: ImportResult = { entriesImported: 0, entitiesImported: 0, relationsImported: 0, skipped: 0, errors: 0 }

    let data: ExportData
    try {
      data = JSON.parse(jsonString) as ExportData
    } catch (err) {
      throw new Error('Invalid JSON format')
    }

    if (!data.manifest || data.manifest.version > EXPORT_VERSION) {
      throw new Error(`Unsupported export version: ${data.manifest?.version}`)
    }

    const existingEntries = merge ? await knowledgeService.getEntries() : []

    for (const entry of data.entries) {
      try {
        let title = entry.title
        let content = entry.content

        if (entry.encryptedPayload && decrypt) {
          try {
            const decrypted = await e2eEncryption.decrypt(entry.encryptedPayload)
            const parsed = JSON.parse(decrypted)
            title = parsed.title ?? title
            content = parsed.content ?? content
          } catch (err) {
            logger.agent.warn('[DataImport] Failed to decrypt entry, skipping:', err)
            result.errors++
            continue
          }
        }

        if (merge) {
          const duplicate = existingEntries.find(e => e.title === title && e.content === content)
          if (duplicate) {
            result.skipped++
            continue
          }
        }

        await knowledgeService.addEntry({
          title,
          content,
          category: entry.category as any,
          tags: entry.tags,
          source: entry.source as any,
          confidence: entry.confidence,
          starred: entry.starred,
          enabled: entry.enabled,
        })

        result.entriesImported++
      } catch (err) {
        logger.agent.warn('[DataImport] Failed to import entry:', err)
        result.errors++
      }
    }

    for (const entity of data.graphEntities) {
      try {
        await localGraphStore.addEntitiesBatch([{
          id: `local-e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: entity.name,
          type: entity.type as LocalGraphEntity['type'],
          properties: entity.properties,
          entryId: entity.entryId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }])
        result.entitiesImported++
      } catch (err) {
        logger.agent.warn('[DataImport] Failed to import graph entity:', err)
        result.errors++
      }
    }

    for (const relation of data.graphRelations) {
      try {
        await localGraphStore.addRelationsBatch([{
          id: `local-r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceId: relation.sourceId,
          targetId: relation.targetId,
          type: relation.type as LocalGraphRelation['type'],
          properties: relation.properties,
          createdAt: Date.now(),
        }])
        result.relationsImported++
      } catch (err) {
        logger.agent.warn('[DataImport] Failed to import graph relation:', err)
        result.errors++
      }
    }

    localGraphStore.syncToInMemoryGraph()

    const importedEntries = await knowledgeService.getEntries()
    for (const entry of importedEntries) {
      await localVectorIndex.indexEntry(entry.id, entry.title, entry.content, entry.tags)
    }

    logger.agent.info(
      `[DataImport] Imported ${result.entriesImported} entries, ${result.entitiesImported} entities, ${result.relationsImported} relations, skipped ${result.skipped}, errors ${result.errors}`,
    )

    return result
  }

  downloadExportFile(jsonString: string, filename?: string): void {
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename ?? `aweeclaw-knowledge-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async readImportFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }
}

export const dataExportImport = new DataExportImportService()
