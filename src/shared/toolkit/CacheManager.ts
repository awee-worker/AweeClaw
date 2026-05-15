/**
 * 场景感知缓存系统
 *
 * 差异化特性（vs 通用缓存）：
 * - 场景驱动的缓存策略（ScenarioCachePolicy）
 * - 法律场景：合规缓存，自动审计日志
 * - 医疗场景：隐私缓存，敏感数据自动脱敏
 * - 教育场景：学习缓存，知识图谱关联
 * - 通用场景：标准缓存策略
 * - 场景优先级淘汰：低优先级场景数据优先淘汰
 * - 场景隔离命名空间
 * - 场景统计聚合
 */

import { logger } from './LogEngine'

// ============================================
// 场景缓存策略定义
// ============================================

export type ScenarioCacheDomain = 'legal' | 'medical' | 'education' | 'general'

export interface ScenarioCachePolicy {
    domain: ScenarioCacheDomain
    defaultTTL: number
    maxMemory: number
    maxSize: number
    evictionPolicy: EvictionPolicy
    slidingExpiration: boolean
    auditEvictions: boolean
    sanitizeOnEvict: boolean
    priorityWeight: number
}

const SCENARIO_CACHE_POLICIES: Record<ScenarioCacheDomain, ScenarioCachePolicy> = {
    legal: {
        domain: 'legal',
        defaultTTL: 30 * 60 * 1000,
        maxMemory: 100 * 1024 * 1024,
        maxSize: 2000,
        evictionPolicy: 'lfu',
        slidingExpiration: true,
        auditEvictions: true,
        sanitizeOnEvict: false,
        priorityWeight: 1,
    },
    medical: {
        domain: 'medical',
        defaultTTL: 10 * 60 * 1000,
        maxMemory: 50 * 1024 * 1024,
        maxSize: 500,
        evictionPolicy: 'lru',
        slidingExpiration: false,
        auditEvictions: true,
        sanitizeOnEvict: true,
        priorityWeight: 1,
    },
    education: {
        domain: 'education',
        defaultTTL: 60 * 60 * 1000,
        maxMemory: 80 * 1024 * 1024,
        maxSize: 1500,
        evictionPolicy: 'lfu',
        slidingExpiration: true,
        auditEvictions: false,
        sanitizeOnEvict: false,
        priorityWeight: 2,
    },
    general: {
        domain: 'general',
        defaultTTL: 5 * 60 * 1000,
        maxMemory: 50 * 1024 * 1024,
        maxSize: 1000,
        evictionPolicy: 'lru',
        slidingExpiration: false,
        auditEvictions: false,
        sanitizeOnEvict: false,
        priorityWeight: 3,
    },
}

export function getScenarioCachePolicy(domain: ScenarioCacheDomain): ScenarioCachePolicy {
    return SCENARIO_CACHE_POLICIES[domain]
}

// ============================================
// 基础类型定义
// ============================================

export type EvictionPolicy = 'lru' | 'lfu' | 'fifo'

interface CacheEntry<T> {
    value: T
    createdAt: number
    lastAccessed: number
    accessCount: number
    size: number
    ttl: number
    slidingExpiration: boolean
    tags: string[]
    scenarioDomain?: ScenarioCacheDomain
    priorityWeight: number
}

export interface CacheConfig {
    maxSize: number
    maxMemory: number
    defaultTTL: number
    cleanupInterval: number
    evictionPolicy: EvictionPolicy
    slidingExpiration: boolean
    onEvict?: (key: string, value: unknown, reason: EvictReason) => void
    enableStats: boolean
}

export type EvictReason = 'expired' | 'capacity' | 'memory' | 'manual' | 'tag' | 'scenario-priority'

export interface CacheStats {
    name: string
    hits: number
    misses: number
    evictions: number
    size: number
    memoryUsage: number
    hitRate: number
    avgAccessTime: number
    oldestEntry: number
    newestEntry: number
    scenarioDomain?: ScenarioCacheDomain
}

export interface SetOptions {
    ttl?: number
    slidingExpiration?: boolean
    tags?: string[]
    scenarioDomain?: ScenarioCacheDomain
}

export type CacheEvent = 'set' | 'get' | 'delete' | 'evict' | 'clear' | 'expire'
export type CacheEventHandler<T> = (event: CacheEvent, key: string, value?: T) => void

// ============================================
// 场景感知缓存核心类
// ============================================

export class ScenarioAwareCache<T = unknown> {
    private cache: Map<string, CacheEntry<T>> = new Map()
    private config: CacheConfig
    private scenarioPolicy: ScenarioCachePolicy | null
    private stats: Omit<CacheStats, 'name' | 'hitRate' | 'avgAccessTime' | 'oldestEntry' | 'newestEntry' | 'scenarioDomain'>
    private cleanupTimer: ReturnType<typeof setInterval> | null = null
    private name: string
    private eventHandlers: Set<CacheEventHandler<T>> = new Set()
    private accessTimes: number[] = []

    constructor(name: string, config?: Partial<CacheConfig>, scenarioDomain?: ScenarioCacheDomain) {
        this.name = name
        this.scenarioPolicy = scenarioDomain ? SCENARIO_CACHE_POLICIES[scenarioDomain] : null

        const policyDefaults = this.scenarioPolicy
            ? {
                maxSize: this.scenarioPolicy.maxSize,
                maxMemory: this.scenarioPolicy.maxMemory,
                defaultTTL: this.scenarioPolicy.defaultTTL,
                evictionPolicy: this.scenarioPolicy.evictionPolicy,
                slidingExpiration: this.scenarioPolicy.slidingExpiration,
            }
            : {}

        this.config = {
            maxSize: 1000,
            maxMemory: 50 * 1024 * 1024,
            defaultTTL: 5 * 60 * 1000,
            cleanupInterval: 60 * 1000,
            evictionPolicy: 'lru',
            slidingExpiration: false,
            enableStats: true,
            ...policyDefaults,
            ...config,
        }

        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            size: 0,
            memoryUsage: 0,
        }

        if (this.config.cleanupInterval > 0) {
            this.startCleanup()
        }
    }

    get(key: string): T | undefined {
        const startTime = performance.now()
        const entry = this.cache.get(key)

        if (!entry) {
            this.stats.misses++
            this.recordAccessTime(startTime)
            return undefined
        }

        if (this.isExpired(entry)) {
            this.evictEntry(key, 'expired')
            this.stats.misses++
            this.recordAccessTime(startTime)
            return undefined
        }

        entry.lastAccessed = Date.now()
        entry.accessCount++

        if (entry.slidingExpiration && entry.ttl > 0) {
            entry.createdAt = Date.now()
        }

        this.stats.hits++
        this.recordAccessTime(startTime)
        this.emit('get', key, entry.value)

        return entry.value
    }

    set(key: string, value: T, options?: SetOptions): void {
        const size = this.estimateSize(value)
        const ttl = options?.ttl ?? this.config.defaultTTL
        const slidingExpiration = options?.slidingExpiration ?? this.config.slidingExpiration
        const tags = options?.tags ?? []
        const scenarioDomain = options?.scenarioDomain ?? this.scenarioPolicy?.domain
        const priorityWeight = scenarioDomain
            ? SCENARIO_CACHE_POLICIES[scenarioDomain]?.priorityWeight ?? 3
            : 3

        this.ensureCapacity(size, key)

        const entry: CacheEntry<T> = {
            value,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 0,
            size,
            ttl,
            slidingExpiration,
            tags,
            scenarioDomain,
            priorityWeight,
        }

        const existing = this.cache.get(key)
        if (existing) {
            this.stats.memoryUsage -= existing.size
        }

        this.cache.set(key, entry)
        this.stats.size = this.cache.size
        this.stats.memoryUsage += size

        this.emit('set', key, value)
    }

    has(key: string): boolean {
        const entry = this.cache.get(key)
        if (!entry) return false
        if (this.isExpired(entry)) {
            this.evictEntry(key, 'expired')
            return false
        }
        return true
    }

    delete(key: string): boolean {
        return this.evictEntry(key, 'manual')
    }

    clear(): void {
        if (this.scenarioPolicy?.sanitizeOnEvict) {
            for (const entry of this.cache.values()) {
                if (entry.value && typeof entry.value === 'object') {
                    try {
                        const obj = entry.value as Record<string, unknown>
                        for (const k of Object.keys(obj)) {
                            if (typeof obj[k] === 'string') {
                                obj[k] = ''
                            }
                        }
                    } catch { /* ignore */ }
                }
            }
        }
        this.cache.clear()
        this.stats.size = 0
        this.stats.memoryUsage = 0
        this.emit('clear', '*')
    }

    async getOrSet(key: string, factory: () => Promise<T>, options?: SetOptions): Promise<T> {
        const cached = this.get(key)
        if (cached !== undefined) return cached
        const value = await factory()
        this.set(key, value, options)
        return value
    }

    getOrSetSync(key: string, factory: () => T, options?: SetOptions): T {
        const cached = this.get(key)
        if (cached !== undefined) return cached
        const value = factory()
        this.set(key, value, options)
        return value
    }

    getMany(keys: string[]): Map<string, T> {
        const result = new Map<string, T>()
        for (const key of keys) {
            const value = this.get(key)
            if (value !== undefined) result.set(key, value)
        }
        return result
    }

    setMany(entries: Array<{ key: string; value: T; options?: SetOptions }>): void {
        for (const { key, value, options } of entries) {
            this.set(key, value, options)
        }
    }

    deleteMany(keys: string[]): number {
        let count = 0
        for (const key of keys) {
            if (this.delete(key)) count++
        }
        return count
    }

    deleteByTag(tag: string): number {
        const keysToDelete: string[] = []
        for (const [key, entry] of this.cache) {
            if (entry.tags.includes(tag)) keysToDelete.push(key)
        }
        for (const key of keysToDelete) {
            this.evictEntry(key, 'tag')
        }
        return keysToDelete.length
    }

    deleteByPrefix(prefix: string): number {
        const keysToDelete: string[] = []
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) keysToDelete.push(key)
        }
        return this.deleteMany(keysToDelete)
    }

    deleteByScenarioDomain(domain: ScenarioCacheDomain): number {
        const keysToDelete: string[] = []
        for (const [key, entry] of this.cache) {
            if (entry.scenarioDomain === domain) keysToDelete.push(key)
        }
        for (const key of keysToDelete) {
            this.evictEntry(key, 'scenario-priority')
        }
        return keysToDelete.length
    }

    keys(pattern?: string | RegExp): string[] {
        const allKeys = Array.from(this.cache.keys())
        if (!pattern) return allKeys
        if (typeof pattern === 'string') return allKeys.filter(k => k.includes(pattern))
        return allKeys.filter(k => pattern.test(k))
    }

    values(): T[] {
        const result: T[] = []
        for (const key of this.cache.keys()) {
            const value = this.get(key)
            if (value !== undefined) result.push(value)
        }
        return result
    }

    forEach(callback: (value: T, key: string) => void): void {
        for (const [key, entry] of this.cache) {
            if (!this.isExpired(entry)) callback(entry.value, key)
        }
    }

    update(key: string, updater: (value: T) => T): boolean {
        const entry = this.cache.get(key)
        if (!entry || this.isExpired(entry)) return false
        const newValue = updater(entry.value)
        const newSize = this.estimateSize(newValue)
        this.stats.memoryUsage -= entry.size
        entry.value = newValue
        entry.size = newSize
        entry.lastAccessed = Date.now()
        this.stats.memoryUsage += newSize
        return true
    }

    touch(key: string): boolean {
        const entry = this.cache.get(key)
        if (!entry || this.isExpired(entry)) return false
        entry.lastAccessed = Date.now()
        if (entry.slidingExpiration && entry.ttl > 0) {
            entry.createdAt = Date.now()
        }
        return true
    }

    ttl(key: string): number {
        const entry = this.cache.get(key)
        if (!entry) return -2
        if (entry.ttl === 0) return -1
        const elapsed = Date.now() - entry.createdAt
        const remaining = entry.ttl - elapsed
        return remaining > 0 ? remaining : 0
    }

    getStats(): CacheStats {
        const total = this.stats.hits + this.stats.misses
        const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0
        const avgAccessTime = this.accessTimes.length > 0
            ? this.accessTimes.reduce((a, b) => a + b, 0) / this.accessTimes.length
            : 0

        let oldestEntry = Date.now()
        let newestEntry = 0
        for (const entry of this.cache.values()) {
            if (entry.createdAt < oldestEntry) oldestEntry = entry.createdAt
            if (entry.createdAt > newestEntry) newestEntry = entry.createdAt
        }

        return {
            name: this.name,
            ...this.stats,
            hitRate,
            avgAccessTime: Math.round(avgAccessTime * 100) / 100,
            oldestEntry: this.cache.size > 0 ? oldestEntry : 0,
            newestEntry,
            scenarioDomain: this.scenarioPolicy?.domain,
        }
    }

    resetStats(): void {
        this.stats.hits = 0
        this.stats.misses = 0
        this.stats.evictions = 0
        this.accessTimes = []
    }

    on(handler: CacheEventHandler<T>): () => void {
        this.eventHandlers.add(handler)
        return () => this.eventHandlers.delete(handler)
    }

    destroy(): void {
        this.stopCleanup()
        this.clear()
        this.eventHandlers.clear()
    }

    getScenarioPolicy(): ScenarioCachePolicy | null {
        return this.scenarioPolicy
    }

    applyScenarioPolicy(domain: ScenarioCacheDomain): void {
        const policy = SCENARIO_CACHE_POLICIES[domain]
        this.scenarioPolicy = policy
        this.config.defaultTTL = policy.defaultTTL
        this.config.maxMemory = policy.maxMemory
        this.config.maxSize = policy.maxSize
        this.config.evictionPolicy = policy.evictionPolicy
        this.config.slidingExpiration = policy.slidingExpiration
    }

    private evictEntry(key: string, reason: EvictReason): boolean {
        const entry = this.cache.get(key)
        if (!entry) return false

        if (this.scenarioPolicy?.auditEvictions && reason !== 'manual') {
            logger.cache.info(`[ScenarioAudit] Cache eviction: key=${key}, reason=${reason}, domain=${entry.scenarioDomain ?? 'none'}`)
        }

        if (this.scenarioPolicy?.sanitizeOnEvict && entry.value && typeof entry.value === 'object') {
            try {
                const obj = entry.value as Record<string, unknown>
                for (const k of Object.keys(obj)) {
                    if (typeof obj[k] === 'string') obj[k] = ''
                }
            } catch { /* ignore */ }
        }

        this.cache.delete(key)
        this.stats.size = this.cache.size
        this.stats.memoryUsage -= entry.size

        if (reason !== 'manual') {
            this.stats.evictions++
        }

        this.config.onEvict?.(key, entry.value, reason)
        this.emit(reason === 'expired' ? 'expire' : reason === 'manual' ? 'delete' : 'evict', key)

        return true
    }

    private isExpired(entry: CacheEntry<T>): boolean {
        if (entry.ttl === 0) return false
        return Date.now() - entry.createdAt > entry.ttl
    }

    private estimateSize(value: T): number {
        try {
            const str = JSON.stringify(value)
            return str.length * 2
        } catch {
            return 1024
        }
    }

    private ensureCapacity(newSize: number, excludeKey?: string): void {
        while (this.cache.size >= this.config.maxSize) {
            if (!this.evictByPriority(excludeKey)) break
        }
        while (this.stats.memoryUsage + newSize > this.config.maxMemory && this.cache.size > 0) {
            if (!this.evictByPriority(excludeKey)) break
        }
    }

    private evictByPriority(excludeKey?: string): boolean {
        const keyToEvict = this.selectEvictionCandidate(excludeKey)
        if (!keyToEvict) return false
        const reason: EvictReason = this.stats.memoryUsage > this.config.maxMemory ? 'memory' : 'capacity'
        return this.evictEntry(keyToEvict, reason)
    }

    private selectEvictionCandidate(excludeKey?: string): string | null {
        let candidateKey: string | null = null
        let candidateScore = Infinity

        for (const [key, entry] of this.cache) {
            if (key === excludeKey) continue

            let score: number
            switch (this.config.evictionPolicy) {
                case 'lru':
                    score = entry.lastAccessed
                    break
                case 'lfu':
                    score = entry.accessCount
                    break
                case 'fifo':
                    score = entry.createdAt
                    break
            }

            score += entry.priorityWeight * 1000000

            if (score < candidateScore) {
                candidateScore = score
                candidateKey = key
            }
        }

        return candidateKey
    }

    private recordAccessTime(startTime: number): void {
        if (!this.config.enableStats) return
        const elapsed = performance.now() - startTime
        this.accessTimes.push(elapsed)
        if (this.accessTimes.length > 1000) {
            this.accessTimes = this.accessTimes.slice(-500)
        }
    }

    private emit(event: CacheEvent, key: string, value?: T): void {
        for (const handler of this.eventHandlers) {
            try {
                handler(event, key, value)
            } catch (e) {
                logger.cache.error(`[${this.name}] Event handler error:`, e)
            }
        }
    }

    private startCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup()
        }, this.config.cleanupInterval)
    }

    private stopCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }
    }

    private cleanup(): void {
        const expiredKeys: string[] = []
        for (const [key, entry] of this.cache) {
            if (this.isExpired(entry)) expiredKeys.push(key)
        }
        for (const key of expiredKeys) {
            this.evictEntry(key, 'expired')
        }
        if (expiredKeys.length > 0) {
            logger.cache.debug(`[${this.name}] Cleanup: ${expiredKeys.length} expired`)
        }
    }
}

// ============================================
// 向后兼容别名
// ============================================

export class CacheService<T = unknown> extends ScenarioAwareCache<T> {
    constructor(name: string, config?: Partial<CacheConfig>) {
        super(name, config)
    }
}

// ============================================
// 场景缓存编排器
// ============================================

class ScenarioCacheOrchestrator {
    private caches = new Map<string, ScenarioAwareCache<unknown>>()
    private static instance: ScenarioCacheOrchestrator

    static getInstance(): ScenarioCacheOrchestrator {
        if (!ScenarioCacheOrchestrator.instance) {
            ScenarioCacheOrchestrator.instance = new ScenarioCacheOrchestrator()
        }
        return ScenarioCacheOrchestrator.instance
    }

    register<T>(cache: ScenarioAwareCache<T>): void {
        const stats = cache.getStats()
        this.caches.set(stats.name, cache as ScenarioAwareCache<unknown>)
    }

    unregister(name: string): void {
        this.caches.delete(name)
    }

    get<T>(name: string): ScenarioAwareCache<T> | undefined {
        return this.caches.get(name) as ScenarioAwareCache<T> | undefined
    }

    getAllStats(): CacheStats[] {
        return Array.from(this.caches.values()).map(c => c.getStats())
    }

    getScenarioStats(domain: ScenarioCacheDomain): CacheStats[] {
        return this.getAllStats().filter(s => s.scenarioDomain === domain)
    }

    getSummary(): {
        totalCaches: number
        totalSize: number
        totalMemory: number
        totalHits: number
        totalMisses: number
        overallHitRate: number
    } {
        const stats = this.getAllStats()
        const totalHits = stats.reduce((sum, s) => sum + s.hits, 0)
        const totalMisses = stats.reduce((sum, s) => sum + s.misses, 0)
        const total = totalHits + totalMisses

        return {
            totalCaches: stats.length,
            totalSize: stats.reduce((sum, s) => sum + s.size, 0),
            totalMemory: stats.reduce((sum, s) => sum + s.memoryUsage, 0),
            totalHits,
            totalMisses,
            overallHitRate: total > 0 ? Math.round((totalHits / total) * 100) : 0,
        }
    }

    clearAll(): void {
        for (const cache of this.caches.values()) cache.clear()
    }

    destroyAll(): void {
        for (const cache of this.caches.values()) cache.destroy()
        this.caches.clear()
    }

    clearByTag(tag: string): number {
        let total = 0
        for (const cache of this.caches.values()) total += cache.deleteByTag(tag)
        return total
    }

    clearByScenarioDomain(domain: ScenarioCacheDomain): number {
        let total = 0
        for (const cache of this.caches.values()) {
            total += cache.deleteByScenarioDomain(domain)
        }
        return total
    }
}

export const cacheManager = ScenarioCacheOrchestrator.getInstance()

// ============================================
// 工厂函数
// ============================================

export function createScenarioCache<T>(
    name: string,
    config?: Partial<CacheConfig>,
    scenarioDomain?: ScenarioCacheDomain
): ScenarioAwareCache<T> {
    const cache = new ScenarioAwareCache<T>(name, config, scenarioDomain)
    cacheManager.register(cache)
    return cache
}

export function createCache<T>(name: string, config?: Partial<CacheConfig>): ScenarioAwareCache<T> {
    return createScenarioCache<T>(name, config)
}

// ============================================
// 预配置缓存工厂
// ============================================

import { getCacheConfig, type CacheConfigs } from '@configuration/agentProfile'

export function createScenarioTypedCache<T>(
    type: keyof CacheConfigs,
    scenarioDomain?: ScenarioCacheDomain,
    nameOverride?: string
): ScenarioAwareCache<T> {
    const config = getCacheConfig(type)
    const name = nameOverride || type.charAt(0).toUpperCase() + type.slice(1) + 'Cache'

    return createScenarioCache<T>(name, {
        maxSize: config.maxSize,
        defaultTTL: config.ttlMs,
        maxMemory: config.maxMemory || 50 * 1024 * 1024,
    }, scenarioDomain)
}

export function createTypedCache<T>(
    type: keyof CacheConfigs,
    nameOverride?: string
): ScenarioAwareCache<T> {
    return createScenarioTypedCache<T>(type, undefined, nameOverride)
}

export default ScenarioAwareCache
