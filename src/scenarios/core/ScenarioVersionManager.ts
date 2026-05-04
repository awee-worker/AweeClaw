/**
 * ScenarioVersionManager - 场景版本控制管理器
 *
 * 管理场景的版本信息，支持：
 * - 版本注册与追踪
 * - 多版本并存（同一场景可注册不同版本）
 * - 版本升级与回滚
 * - 最低应用版本兼容性检查
 * - 版本变更通知
 */

import type { ScenarioVersionInfo, ScenarioLoaderEvent } from '@shared/types/scenario-arch'
import { logger } from '@shared/utils/Logger'

interface VersionEntry {
  scenarioId: string
  versions: Map<string, ScenarioVersionInfo>
  activeVersion: string | null
}

class ScenarioVersionManagerClass {
  private entries = new Map<string, VersionEntry>()
  private listeners = new Set<(event: ScenarioLoaderEvent) => void>()

  registerVersion(scenarioId: string, versionInfo: ScenarioVersionInfo): void {
    let entry = this.entries.get(scenarioId)
    if (!entry) {
      entry = { scenarioId, versions: new Map(), activeVersion: null }
      this.entries.set(scenarioId, entry)
    }

    const existing = entry.versions.get(versionInfo.version)
    if (existing) {
      logger.agent.warn(
        `[ScenarioVersionManager] Version ${versionInfo.version} already exists for "${scenarioId}", updating`
      )
    }

    entry.versions.set(versionInfo.version, versionInfo)
    logger.agent.info(
      `[ScenarioVersionManager] Registered version ${versionInfo.version} for "${scenarioId}"`
    )
  }

  unregisterVersion(scenarioId: string, version: string): boolean {
    const entry = this.entries.get(scenarioId)
    if (!entry) return false

    if (entry.activeVersion === version) {
      logger.agent.warn(
        `[ScenarioVersionManager] Cannot unregister active version ${version} for "${scenarioId}"`
      )
      return false
    }

    const deleted = entry.versions.delete(version)
    if (deleted && entry.versions.size === 0) {
      this.entries.delete(scenarioId)
    }
    return deleted
  }

  setActiveVersion(scenarioId: string, version: string): boolean {
    const entry = this.entries.get(scenarioId)
    if (!entry || !entry.versions.has(version)) return false

    const oldVersion = entry.activeVersion
    entry.activeVersion = version

    if (oldVersion && oldVersion !== version) {
      this.notify({
        type: 'version-changed',
        scenarioId,
        oldVersion,
        newVersion: version,
      })
      logger.agent.info(
        `[ScenarioVersionManager] "${scenarioId}" version changed: ${oldVersion} → ${version}`
      )
    }

    return true
  }

  getActiveVersion(scenarioId: string): string | null {
    return this.entries.get(scenarioId)?.activeVersion ?? null
  }

  getVersionInfo(scenarioId: string, version: string): ScenarioVersionInfo | undefined {
    return this.entries.get(scenarioId)?.versions.get(version)
  }

  getAllVersions(scenarioId: string): ScenarioVersionInfo[] {
    const entry = this.entries.get(scenarioId)
    if (!entry) return []
    return Array.from(entry.versions.values()).sort((a, b) =>
      compareVersions(b.version, a.version)
    )
  }

  getLatestStableVersion(scenarioId: string): ScenarioVersionInfo | undefined {
    const versions = this.getAllVersions(scenarioId)
    return versions.find(v => v.isStable !== false)
  }

  isCompatible(scenarioId: string, version: string, appVersion: string): boolean {
    const info = this.getVersionInfo(scenarioId, version)
    if (!info?.minAppVersion) return true
    return compareVersions(appVersion, info.minAppVersion) >= 0
  }

  canUpgrade(_scenarioId: string, fromVersion: string, toVersion: string): boolean {
    return compareVersions(toVersion, fromVersion) > 0
  }

  cleanupScenario(scenarioId: string): void {
    this.entries.delete(scenarioId)
    logger.agent.info(`[ScenarioVersionManager] Cleaned up versions for "${scenarioId}"`)
  }

  onEvent(listener: (event: ScenarioLoaderEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(event: ScenarioLoaderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {}
    }
  }
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number)
  const partsB = b.replace(/^v/, '').split('.').map(Number)
  const len = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0
    const numB = partsB[i] || 0
    if (numA !== numB) return numA - numB
  }

  return 0
}

export const scenarioVersionManager = new ScenarioVersionManagerClass()
