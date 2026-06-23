/**
 * 代码库索引编排器 — 索引服务的 IPC 桥接层
 *
 * 职责：
 * - 通过 IPC 暴露索引服务的初始化、配置、重建等能力
 * - 持久化索引配置到 electron-store，支持跨会话恢复
 * - 向渲染进程推送索引进度事件
 *
 * 差异化特性（相比基础实现）：
 * - 知识库索引支持
 * - 跨项目搜索能力
 * - 索引健康检查
 * - 使用 Result 协议（ok / failFromError）统一错误处理
 * - 品牌配置通过 `@shared/brand` 集中管理
 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, BrowserWindow } from 'electron'
import { getIndexService, initIndexServiceWithConfig } from '../../search-engine/indexOrchestrator'
import { EmbeddingConfig, IndexMode, IndexConfig } from '../../search-engine/engineTypes'
import { ok, failFromError, Result } from '@shared/protocols/outcomeProtocol'
import Store from 'electron-store'
import { BRAND } from '@shared/brand'

let _configStore: Store | null = null

function getSavedConfig(): Partial<IndexConfig> | undefined {
  if (!_configStore) return undefined
  return _configStore.get('indexConfig') as Partial<IndexConfig> | undefined
}

function saveConfig(updates: Partial<IndexConfig>): void {
  if (!_configStore) return
  const current = getSavedConfig() || {}
  _configStore.set('indexConfig', { ...current, ...updates })
}

export function registerIndexingHandlers(getMainWindow: () => BrowserWindow | null, configStore?: Store) {
  _configStore = configStore || null

  // 初始化
  ipcMain.handle('index:initialize', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)

      const mainWindow = getMainWindow()
      if (mainWindow) indexService.setMainWindow(mainWindow)
      await indexService.initialize()
      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Initialize failed:', e)
      return failFromError(e)
    }
  })

  // 开始索引
  ipcMain.handle('index:start', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)

      const mainWindow = getMainWindow()
      if (mainWindow) indexService.setMainWindow(mainWindow)
      await indexService.initialize()
      indexService.indexWorkspace().catch(e => logger.ipc.error('[Index] Indexing failed:', e))
      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Start failed:', e)
      return failFromError(e)
    }
  })

  // 获取状态
  ipcMain.handle('index:status', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getStatus()
    } catch {
      return { mode: 'structural', isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    }
  })

  // 检查是否有索引
  ipcMain.handle('index:hasIndex', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.hasIndex()
    } catch {
      return false
    }
  })

  // 搜索
  ipcMain.handle('index:search', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.search(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Search failed:', e)
      return []
    }
  })

  // 混合搜索
  ipcMain.handle('index:hybridSearch', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.hybridSearch(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Hybrid search failed:', e)
      return []
    }
  })

  // 符号搜索
  ipcMain.handle('index:searchSymbols', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const indexService = getIndexService(workspacePath)
      return indexService.searchSymbols(query, topK || 20)
    } catch (e) {
      logger.ipc.error('[Index] Symbol search failed:', e)
      return []
    }
  })

  // 获取项目摘要
  ipcMain.handle('index:getProjectSummary', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getProjectSummary()
    } catch {
      return null
    }
  })

  // 获取项目摘要文本
  ipcMain.handle('index:getProjectSummaryText', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getProjectSummaryText()
    } catch {
      return ''
    }
  })

  // 清空索引
  ipcMain.handle('index:clear', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.clearIndex()
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 切换索引模式
  ipcMain.handle('index:setMode', async (_, workspacePath: string, mode: IndexMode): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.setMode(mode)
      saveConfig({ mode })
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 更新 Embedding 配置
  ipcMain.handle('index:updateEmbeddingConfig', async (_, workspacePath: string, config: Partial<EmbeddingConfig>): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      indexService.updateEmbeddingConfig(config)
      const saved = getSavedConfig() || {}
      saveConfig({ embedding: { ...saved.embedding, ...config } as EmbeddingConfig })
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 测试 Embedding 连接
  ipcMain.handle('index:testConnection', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      return await indexService.testEmbeddingConnection()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 获取支持的 Embedding 提供商
  ipcMain.handle('index:getProviders', () => {
    return [
      { id: 'jina', name: 'Jina AI', description: '免费 100万 tokens/月', free: true },
      { id: 'voyage', name: 'Voyage AI', description: '免费 5000万 tokens', free: true },
      { id: 'cohere', name: 'Cohere', description: '免费 100次/分钟', free: true },
      { id: 'huggingface', name: 'HuggingFace', description: '免费，有速率限制', free: true },
      { id: 'ollama', name: 'Ollama', description: '本地运行，完全免费', free: true },
      { id: 'openai', name: 'OpenAI', description: '付费，质量最高', free: false },
    ]
  })

  // 更新单个文件索引（用于文件监听）
  ipcMain.handle('index:updateFile', async (_, workspacePath: string, filePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.updateFiles([filePath])
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 批量更新文件索引（用于文件监听）
  ipcMain.handle('index:updateFiles', async (_, workspacePath: string, filePaths: string[]): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.updateFiles(filePaths)
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 删除文件索引（用于文件监听）
  ipcMain.handle('index:deleteFile', async (_, workspacePath: string, filePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.deleteFileIndex(filePath)
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // AST 解析调用图
  ipcMain.handle('index:parseCallGraph', async (_, filePath: string, content: string) => {
    try {
      const { ASTParser } = await import('../../search-engine/engineCore')
      const parser = new ASTParser()
      await parser.init()
      return await parser.parseCallGraph(filePath, content)
    } catch (e) {
      logger.ipc.error('[Index] Parse Call Graph failed:', e)
      return []
    }
  })

  // ============================================
  // [AweeClaw] 知识库索引
  // ============================================

  interface KnowledgeEntry {
    id: string
    title: string
    content: string
    source: string
    tags: string[]
    createdAt: number
    updatedAt: number
  }

  const knowledgeStore = new Map<string, KnowledgeEntry>()

  ipcMain.handle('index:addKnowledge', async (_, _workspacePath: string, entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const id = `kn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = Date.now()
      const knowledge: KnowledgeEntry = {
        ...entry,
        id,
        createdAt: now,
        updatedAt: now,
      }
      knowledgeStore.set(id, knowledge)
      return { success: true, id }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('index:updateKnowledge', async (_, id: string, updates: Partial<KnowledgeEntry>) => {
    const entry = knowledgeStore.get(id)
    if (!entry) return { success: false, error: 'Knowledge entry not found' }
    knowledgeStore.set(id, { ...entry, ...updates, updatedAt: Date.now() })
    return { success: true }
  })

  ipcMain.handle('index:removeKnowledge', async (_, id: string) => {
    knowledgeStore.delete(id)
    return { success: true }
  })

  ipcMain.handle('index:listKnowledge', async (_, filter?: { tag?: string; source?: string }) => {
    let results = Array.from(knowledgeStore.values())
    if (filter?.tag) results = results.filter(e => e.tags.includes(filter.tag!))
    if (filter?.source) results = results.filter(e => e.source === filter.source)
    return { success: true, entries: results }
  })

  ipcMain.handle('index:searchKnowledge', async (_, query: string, topK?: number) => {
    const queryLower = query.toLowerCase()
    const results = Array.from(knowledgeStore.values())
      .filter(e =>
        e.title.toLowerCase().includes(queryLower) ||
        e.content.toLowerCase().includes(queryLower) ||
        e.tags.some(t => t.toLowerCase().includes(queryLower))
      )
      .slice(0, topK || 10)
    return { success: true, entries: results }
  })

  // ============================================
  // [AweeClaw] 索引健康检查
  // ============================================

  ipcMain.handle('index:healthCheck', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      const status = indexService.getStatus()
      const hasIndex = await indexService.hasIndex()

      const health = {
        status: 'healthy' as string,
        checks: [] as { name: string; status: string; message?: string }[],
      }

      health.checks.push({
        name: 'index_exists',
        status: hasIndex ? 'ok' : 'warning',
        message: hasIndex ? undefined : 'No index found for workspace',
      })

      if (status.isIndexing) {
        health.checks.push({
          name: 'indexing_progress',
          status: 'info',
          message: `Indexing: ${status.indexedFiles}/${status.totalFiles} files`,
        })
      }

      if (status.totalFiles > 0 && status.indexedFiles < status.totalFiles * 0.5) {
        health.checks.push({
          name: 'index_coverage',
          status: 'warning',
          message: `Low index coverage: ${Math.round(status.indexedFiles / status.totalFiles * 100)}%`,
        })
        health.status = 'degraded'
      }

      return { success: true, health }
    } catch (e) {
      return {
        success: true,
        health: {
          status: 'unhealthy',
          checks: [{ name: 'index_service', status: 'error', message: e instanceof Error ? e.message : String(e) }],
        },
      }
    }
  })

  // ============================================
  // [AweeClaw] 跨项目搜索
  // ============================================

  ipcMain.handle('index:crossProjectSearch', async (_, workspacePaths: string[], query: string, topK?: number) => {
    try {
      const allResults: any[] = []
      for (const wsPath of workspacePaths) {
        try {
          const saved = getSavedConfig()
          const indexService = saved
            ? initIndexServiceWithConfig(wsPath, saved)
            : getIndexService(wsPath)
          await indexService.initialize()
          const results = await indexService.search(query, topK || 5)
          allResults.push(...results.map((r: any) => ({ ...r, workspacePath: wsPath })))
        } catch {
          // skip failed workspaces
        }
      }
      allResults.sort((a, b) => (b.score || 0) - (a.score || 0))
      return { success: true, results: allResults.slice(0, topK || 10) }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  logger.ipc.info(`[Index] ${BRAND.name} enhanced IPC handlers registered (knowledge, health check, cross-project search)`)
}
