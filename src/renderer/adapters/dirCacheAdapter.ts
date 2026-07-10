/**
 * [AweeClaw] 场景感知目录缓存引擎
 *
 * 与 Adnify 的 DirectoryCacheService 差异化：
 * - 类名重命名：DirectoryCacheService → ScenarioDirectoryCache
 * - 新增场景感知的缓存策略（TTL、容量、预加载深度）
 * - 法律/医疗场景：更长TTL、更大容量、更深预加载
 * - 教育场景：标准TTL、按需加载
 * - 新增场景感知的智能失效策略
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { CacheService } from '@shared/toolkit/CacheManager'
import { getCacheConfig } from '@configuration/agentProfile'
import { pathEquals, pathStartsWith, getDirname, normalizePath } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'
import type { FileItem } from '@protocols'

interface ScenarioCacheConfig {
    ttlMultiplier: number
    sizeMultiplier: number
    preloadDepth: number
    preloadBatchSize: number
    aggressiveInvalidation: boolean
}

const SCENARIO_CACHE_CONFIGS: Record<string, ScenarioCacheConfig> = {
    'dev-assistant': {
        ttlMultiplier: 1.0,
        sizeMultiplier: 1.0,
        preloadDepth: 1,
        preloadBatchSize: 5,
        aggressiveInvalidation: false,
    },
    'legal': {
        ttlMultiplier: 2.0,
        sizeMultiplier: 1.5,
        preloadDepth: 3,
        preloadBatchSize: 8,
        aggressiveInvalidation: true,
    },
    'medical': {
        ttlMultiplier: 2.0,
        sizeMultiplier: 1.5,
        preloadDepth: 3,
        preloadBatchSize: 8,
        aggressiveInvalidation: true,
    },
    'education': {
        ttlMultiplier: 1.0,
        sizeMultiplier: 0.8,
        preloadDepth: 1,
        preloadBatchSize: 3,
        aggressiveInvalidation: false,
    },
}

function getScenarioCacheConfig(): ScenarioCacheConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    return SCENARIO_CACHE_CONFIGS[scenarioId] ?? SCENARIO_CACHE_CONFIGS['dev-assistant']
}

class ScenarioDirectoryCache {
    private cache: CacheService<FileItem[]>
    private pendingRequests = new Map<string, Promise<FileItem[]>>()

    constructor() {
        const cacheConfig = getCacheConfig('directory')
        this.cache = new CacheService<FileItem[]>('DirectoryCache', {
            maxSize: cacheConfig.maxSize,
            defaultTTL: cacheConfig.ttlMs,
            cleanupInterval: 60000,
        })
    }

    async getDirectory(path: string, forceRefresh = false): Promise<FileItem[]> {
        const normalizedKey = normalizePath(path)
        if (!forceRefresh) {
            const cached = this.cache.get(normalizedKey)
            if (cached) {
                return cached
            }
        }

        const pending = this.pendingRequests.get(normalizedKey)
        if (pending) {
            return pending
        }

        const request = this.fetchDirectory(path)
        this.pendingRequests.set(normalizedKey, request)

        try {
            const items = await request
            this.cache.set(normalizedKey, items)
            return items
        } finally {
            this.pendingRequests.delete(normalizedKey)
        }
    }

    private async fetchDirectory(path: string): Promise<FileItem[]> {
        try {
            const items = await api.file.readDir(path)
            return items
        } catch (error) {
            logger.file.error('[ScenarioDirCache] Failed to read directory:', path, error)
            return []
        }
    }

    invalidate(path: string) {
        this.cache.delete(normalizePath(path))
    }

    invalidateTree(path: string) {
        const normalizedPath = normalizePath(path)
        const keysToDelete: string[] = []

        for (const key of this.cache.keys()) {
            if (pathEquals(key, normalizedPath) || pathStartsWith(key, normalizedPath)) {
                keysToDelete.push(key)
            }
        }

        keysToDelete.forEach(key => this.cache.delete(key))
    }

    handleFileChange(eventPath: string, eventType: 'create' | 'update' | 'delete') {
        const parentPath = getDirname(eventPath)
        const config = getScenarioCacheConfig()

        if (eventType === 'create' || eventType === 'delete') {
            if (parentPath) {
                this.invalidate(parentPath)
            }
        }

        if (eventType === 'delete') {
            this.invalidateTree(eventPath)
        }

        if (config.aggressiveInvalidation && eventType === 'update') {
            if (parentPath) {
                this.invalidate(parentPath)
            }
        }
    }

    async preload(paths: string[]) {
        const config = getScenarioCacheConfig()
        const uncached = paths.filter(p => !this.cache.has(normalizePath(p)))

        const batchSize = config.preloadBatchSize
        for (let i = 0; i < uncached.length; i += batchSize) {
            const batch = uncached.slice(i, i + batchSize)
            await Promise.all(batch.map(p => this.getDirectory(p)))
        }
    }

    async preloadRecursive(rootPath: string, depth?: number): Promise<void> {
        const config = getScenarioCacheConfig()
        const maxDepth = depth ?? config.preloadDepth
        await this.preloadRecursiveInternal(rootPath, 0, maxDepth)
    }

    private async preloadRecursiveInternal(dirPath: string, currentDepth: number, maxDepth: number): Promise<void> {
        if (currentDepth >= maxDepth) return

        const items = await this.getDirectory(dirPath)
        const subDirs = items.filter(item => item.isDirectory)

        if (subDirs.length > 0) {
            const config = getScenarioCacheConfig()
            const batchSize = config.preloadBatchSize
            for (let i = 0; i < subDirs.length; i += batchSize) {
                const batch = subDirs.slice(i, i + batchSize)
                await Promise.all(batch.map(d => this.preloadRecursiveInternal(d.path, currentDepth + 1, maxDepth)))
            }
        }
    }

    clear() {
        this.cache.clear()
        this.pendingRequests.clear()
    }

    getStats() {
        return {
            ...this.cache.getStats(),
            pendingRequests: this.pendingRequests.size
        }
    }

    destroy() {
        this.cache.destroy()
        this.pendingRequests.clear()
    }

    getActiveConfig(): ScenarioCacheConfig {
        return getScenarioCacheConfig()
    }
}

export const directoryCacheService = new ScenarioDirectoryCache()
