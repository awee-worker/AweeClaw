/**
 * 场景更新自动检测 + 自动更新 Hook
 *
 * 与插件更新检查保持一致的行为：
 * - 应用启动后延迟 30 秒执行首次检查（避免与启动阶段抢资源）
 * - 发现新版本时：
 *   · 自动更新开启 → 静默更新，完成后右上角 toast 汇总
 *   · 自动更新关闭 → toast 卡片提示（带「去更新」入口）
 * - 24 小时内不重复检查（localStorage 记录上次检查时间）
 * - 同一版本的提示只出现一次，避免反复打扰
 *
 * 自动更新开关存储在 localStorage（key: aweeclaw:scenario-auto-update），默认开启。
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  applyInstalledScenarioUpdate,
  checkInstalledScenarioUpdates,
  type ScenarioUpdateCandidate,
} from '@services/scenarioMarketplaceMap'
import { registerInstalledScenario } from '@components/scenario/scenarioInstallUtils'
import { scenarioRegistry } from '@configuration/scenarios'
import { toast } from '@components/foundation/InlineNotification'
import { logger } from '@toolkit/LogEngine'

/** 启动后延迟检查时间（毫秒） */
const INITIAL_DELAY_MS = 30 * 1000

/** 两次检查之间的最小间隔 */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const LAST_CHECK_KEY = 'aweeclaw:scenario-update-last-check'
const NOTIFIED_KEY = 'aweeclaw:scenario-update-notified'
const AUTO_UPDATE_KEY = 'aweeclaw:scenario-auto-update'

/** 读取自动更新开关（默认开启） */
export function isScenarioAutoUpdateEnabled(): boolean {
  try {
    const v = localStorage.getItem(AUTO_UPDATE_KEY)
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

/** 设置自动更新开关 */
export function setScenarioAutoUpdateEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, String(enabled))
  } catch {
    // ignore
  }
}

interface NotifiedEntry {
  marketId: string
  latestVersion: string
  notifiedAt: number
}

function getNotified(): NotifiedEntry[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as NotifiedEntry[]
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return arr.filter((item) => item.notifiedAt > cutoff)
  } catch {
    return []
  }
}

function markNotified(marketId: string, latestVersion: string): void {
  try {
    const list = getNotified().filter((v) => v.marketId !== marketId)
    list.push({ marketId, latestVersion, notifiedAt: Date.now() })
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

function isAlreadyNotified(marketId: string, latestVersion: string): boolean {
  return getNotified().some((v) => v.marketId === marketId && v.latestVersion === latestVersion)
}

function readLastCheckAt(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY) || 0) || 0
  } catch {
    return 0
  }
}

function saveLastCheckAt(at: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(at))
  } catch {
    // ignore
  }
}

/** 场景显示名称（中英文适配） */
function displayName(candidate: { name: string; nameZh: string }, isZh: boolean): string {
  return (isZh ? candidate.nameZh : candidate.name) || candidate.name || candidate.nameZh
}

/**
 * 更新单个场景并重新注册
 *
 * 更新只替换磁盘文件，进程内仍在使用旧 bundle；重新注册让新版本立即可用。
 * 重新注册失败不影响「已更新」的结论，只降级为提示。
 */
async function updateAndRegister(
  candidate: ScenarioUpdateCandidate,
  marketplaceId: string,
): Promise<{ success: boolean; error?: string; registerError?: string }> {
  const outcome = await applyInstalledScenarioUpdate(candidate)
  if (!outcome.success) {
    return { success: false, error: outcome.error }
  }

  let registerError: string | undefined
  try {
    const config = outcome.config as Parameters<typeof registerInstalledScenario>[0] | undefined
    if (config) {
      await registerInstalledScenario(config, {
        scenarioId: outcome.resolvedScenarioId || candidate.installedId,
        source: 'marketplace',
        version: candidate.latestVersion,
        marketplaceId,
      })
    } else {
      scenarioRegistry.updateScenario(candidate.installedId, { version: candidate.latestVersion })
    }
  } catch (err) {
    registerError = err instanceof Error ? err.message : String(err)
    logger.scenario.warn('[ScenarioUpdateChecker] Re-register after update failed:', err)
    scenarioRegistry.updateScenario(candidate.installedId, { version: candidate.latestVersion })
  }

  return { success: true, registerError }
}

export function useScenarioUpdateChecker(): void {
  const { isAuthenticated, language } = useStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      language: state.language,
    })),
  )

  const hasScheduledRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || hasScheduledRef.current) return
    hasScheduledRef.current = true

    const runCheck = async () => {
      // 24 小时内已经检查过就不再打扰
      if (Date.now() - readLastCheckAt() < CHECK_INTERVAL_MS) {
        logger.system.info('[ScenarioUpdateChecker] Skipped, checked within 24h')
        return
      }

      try {
        const candidates = await checkInstalledScenarioUpdates()
        saveLastCheckAt(Date.now())

        const fresh = candidates.filter(
          (c) => !isAlreadyNotified(c.marketId, c.latestVersion),
        )
        if (fresh.length === 0) {
          logger.system.info('[ScenarioUpdateChecker] No new scenario updates')
          return
        }

        const isZh = language === 'zh'
        const names = fresh.map((c) => displayName(c, isZh))
        const autoUpdate = isScenarioAutoUpdateEnabled()

        logger.system.info(
          `[ScenarioUpdateChecker] Found ${fresh.length} update(s): ${names.join(', ')} (autoUpdate=${autoUpdate})`,
        )

        if (!autoUpdate) {
          fresh.forEach((c) => markNotified(c.marketId, c.latestVersion))
          toast.card({
            type: 'info',
            title: isZh
              ? fresh.length === 1
                ? '场景有新版本'
                : `${fresh.length} 个场景有新版本`
              : fresh.length === 1
                ? 'Scenario Update Available'
                : `${fresh.length} Scenarios Have Updates`,
            message: isZh
              ? fresh.length === 1
                ? `${names[0]} 可更新到 v${fresh[0].latestVersion}`
                : `${names.join('、')} 可更新`
              : fresh.length === 1
                ? `${names[0]} can be updated to v${fresh[0].latestVersion}`
                : `${names.join(', ')} have updates`,
            duration: 0,
            source: 'ScenarioUpdateChecker',
            dedupeKey: 'scenario-update-available',
            actions: [
              {
                id: 'go-update',
                label: isZh ? '去更新' : 'Update',
                onClick: () => {
                  useStore.getState().setShowScenarioPage(true)
                  useStore.getState().setScenarioPageTab('installed')
                },
              },
            ],
          })
          return
        }

        const updated: string[] = []
        const failed: string[] = []
        const needRestart: string[] = []

        // 逐个更新：多个场景同时写运行时目录会互相干扰
        for (const candidate of fresh) {
          const result = await updateAndRegister(candidate, candidate.marketId)
          if (result.success) {
            updated.push(`${displayName(candidate, isZh)} v${candidate.latestVersion}`)
            markNotified(candidate.marketId, candidate.latestVersion)
            if (result.registerError) needRestart.push(displayName(candidate, isZh))
          } else {
            failed.push(
              `${displayName(candidate, isZh)}：${result.error || (isZh ? '未知错误' : 'Unknown error')}`,
            )
          }
        }

        if (updated.length > 0) {
          toast.card({
            type: 'success',
            title: isZh
              ? updated.length === 1
                ? '场景已自动更新'
                : `${updated.length} 个场景已自动更新`
              : updated.length === 1
                ? 'Scenario Auto-Updated'
                : `${updated.length} Scenarios Auto-Updated`,
            message: isZh
              ? `已更新到最新版本：${updated.join('、')}${needRestart.length > 0 ? '（部分场景需重启客户端后完全生效）' : ''}`
              : `Updated: ${updated.join(', ')}${needRestart.length > 0 ? ' (restart to take full effect for some)' : ''}`,
            duration: 8000,
            source: 'ScenarioUpdateChecker',
            dedupeKey: 'scenario-auto-updated',
          })
        }

        if (failed.length > 0) {
          toast.card({
            type: 'warning',
            title: isZh
              ? failed.length === 1
                ? '场景自动更新失败'
                : `${failed.length} 个场景更新失败`
              : failed.length === 1
                ? 'Scenario Update Failed'
                : `${failed.length} Scenarios Failed to Update`,
            message: isZh
              ? `${failed.join('；')}，请到场景管理中手动重试`
              : `${failed.join('; ')}, retry in Scenario Manager`,
            duration: 0,
            source: 'ScenarioUpdateChecker',
            dedupeKey: 'scenario-auto-update-failed',
            actions: [
              {
                id: 'go-update',
                label: isZh ? '去查看' : 'Open',
                onClick: () => {
                  useStore.getState().setShowScenarioPage(true)
                  useStore.getState().setScenarioPageTab('installed')
                },
              },
            ],
          })
        }
      } catch (err) {
        logger.system.warn('[ScenarioUpdateChecker] Check failed:', err)
      }
    }

    const timer = setTimeout(runCheck, INITIAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isAuthenticated, language])
}
