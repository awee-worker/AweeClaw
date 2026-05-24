/**
 * [AweeClaw] 场景感知写入追踪引擎
 *
 * 与 Adnify 的 writeOriginTracker 差异化：
 * - 新增场景感知的过期时间策略
 * - 法律/医疗场景：更长过期时间（审计追踪需求）
 * - 教育场景：标准过期时间
 * - 新增场景感知的追踪范围（按扩展名/目录过滤）
 */

import { useStore } from '@store'

interface ScenarioTrackerConfig {
    autoExpireMs: number
    trackByExtension: boolean
    trackedExtensions: string[]
    logTrackEvents: boolean
}

const SCENARIO_TRACKER_CONFIGS: Record<string, ScenarioTrackerConfig> = {
    'workspace-editor': {
        autoExpireMs: 5_000,
        trackByExtension: false,
        trackedExtensions: [],
        logTrackEvents: false,
    },
    'legal': {
        autoExpireMs: 30_000,
        trackByExtension: true,
        trackedExtensions: ['.docx', '.pdf', '.doc', '.txt', '.md'],
        logTrackEvents: true,
    },
    'medical': {
        autoExpireMs: 30_000,
        trackByExtension: true,
        trackedExtensions: ['.dicom', '.pdf', '.txt', '.md', '.json'],
        logTrackEvents: true,
    },
    'education': {
        autoExpireMs: 5_000,
        trackByExtension: false,
        trackedExtensions: [],
        logTrackEvents: false,
    },
}

function getScenarioTrackerConfig(): ScenarioTrackerConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_TRACKER_CONFIGS[scenarioId] ?? SCENARIO_TRACKER_CONFIGS['workspace-editor']
}

const trackedPaths = new Map<string, ReturnType<typeof setTimeout>>()

function normalizeKey(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase()
}

function shouldTrack(filePath: string): boolean {
    const config = getScenarioTrackerConfig()
    if (!config.trackByExtension || config.trackedExtensions.length === 0) return true
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase()
    return config.trackedExtensions.includes(ext)
}

function stamp(filePath: string): void {
    if (!shouldTrack(filePath)) return

    const config = getScenarioTrackerConfig()
    const key = normalizeKey(filePath)
    const prev = trackedPaths.get(key)
    if (prev) clearTimeout(prev)
    const handle = setTimeout(() => trackedPaths.delete(key), config.autoExpireMs)
    trackedPaths.set(key, handle)
}

function checkAndClear(filePath: string): boolean {
    const key = normalizeKey(filePath)
    const handle = trackedPaths.get(key)
    if (handle) {
        clearTimeout(handle)
        trackedPaths.delete(key)
        return true
    }
    return false
}

export const writeOriginTracker = { stamp, checkAndClear }

export const internalWriteTracker = { mark: stamp, consume: checkAndClear }

export function getActiveTrackerConfig(): ScenarioTrackerConfig {
    return getScenarioTrackerConfig()
}
