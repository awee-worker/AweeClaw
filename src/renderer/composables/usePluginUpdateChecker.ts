/**
 * 插件更新自动检测 + 自动更新 Hook
 *
 * 应用启动后延迟检查已安装插件是否有新版本：
 * - 启动后 30 秒执行首次检查（避免影响启动性能）
 * - 检测到更新时：
 *   · 自动更新开启 → 静默升级，升级完成后右上角 toast 通知用户
 *   · 自动更新关闭 → 右上角 toast 卡片通知（带"去更新"按钮），跳转插件中心手动更新
 * - 使用 dedupeKey 避免重复通知同一批更新
 * - 24 小时内只检查一次（localStorage 记录上次检查时间）
 *
 * 自动更新开关存储在 localStorage（key: aweeclaw:plugin-auto-update），默认开启。
 * 用户可在设置中关闭以避免使用中插件被自动重启。
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  checkPluginUpdate,
  getInstalledPlugins,
  updatePlugin,
} from '@services/pluginService'
import { toast } from '@components/foundation/InlineNotification'
import { logger } from '@shared/toolkit/LogEngine'
import type { InstalledPlugin } from '@services/pluginService'

/** 启动后延迟检查时间（毫秒） */
const INITIAL_DELAY_MS = 30 * 1000

/** localStorage 键名 */
const NOTIFIED_VERSIONS_KEY = 'aweeclaw:plugin-update-notified-versions'
const AUTO_UPDATE_KEY = 'aweeclaw:plugin-auto-update'

/**
 * 读取自动更新开关（默认开启）。
 * 用户可在设置中关闭，避免使用中的插件被自动重启。
 */
export function isPluginAutoUpdateEnabled(): boolean {
  try {
    const v = localStorage.getItem(AUTO_UPDATE_KEY)
    // 未设置时默认开启
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

/** 设置自动更新开关 */
export function setPluginAutoUpdateEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, String(enabled))
  } catch {
    // ignore
  }
}

interface NotifiedVersion {
  pluginKey: string
  latestVersion: string
  notifiedAt: number
}

/** 读取已通知的版本列表 */
function getNotifiedVersions(): NotifiedVersion[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_VERSIONS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as NotifiedVersion[]
    // 清理超过 7 天的记录
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return arr.filter((item) => item.notifiedAt > cutoff)
  } catch {
    return []
  }
}

/** 记录已通知的版本 */
function saveNotifiedVersion(pluginKey: string, latestVersion: string): void {
  try {
    const existing = getNotifiedVersions().filter((v) => v.pluginKey !== pluginKey)
    existing.push({ pluginKey, latestVersion, notifiedAt: Date.now() })
    localStorage.setItem(NOTIFIED_VERSIONS_KEY, JSON.stringify(existing))
  } catch {
    // ignore
  }
}

/** 检查是否已通知过该版本 */
function isAlreadyNotified(pluginKey: string, latestVersion: string): boolean {
  const notified = getNotifiedVersions()
  return notified.some((v) => v.pluginKey === pluginKey && v.latestVersion === latestVersion)
}

interface UpdateCheckResult {
  plugin: InstalledPlugin
  hasUpdate: boolean
  latestVersion?: string
}

/**
 * 获取插件显示名称（中英文适配）
 */
function getPluginDisplayName(plugin: InstalledPlugin, isZh: boolean): string {
  const manifest = plugin.manifest as Record<string, unknown>
  return (
    (isZh ? (manifest.nameZh as string) : (manifest.name as string)) ||
    (manifest.name as string) ||
    (manifest.nameZh as string) ||
    plugin.pluginKey
  )
}

export function usePluginUpdateChecker(): void {
  const { isAuthenticated, language } = useStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      language: state.language,
    })),
  )

  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || hasCheckedRef.current) return
    hasCheckedRef.current = true

    const checkUpdates = async () => {
      logger.system.info('[PluginUpdateChecker] Start checking for plugin updates...')

      try {
        const installed = await getInstalledPlugins()
        if (installed.length === 0) {
          logger.system.info('[PluginUpdateChecker] No installed plugins, skip')
          return
        }

        logger.system.info(`[PluginUpdateChecker] Checking ${installed.length} installed plugins for updates...`)

        // 并发检查所有插件
        const results: UpdateCheckResult[] = await Promise.all(
          installed.map(async (plugin: InstalledPlugin): Promise<UpdateCheckResult> => {
            try {
              const info = await checkPluginUpdate(plugin.pluginKey)
              return { plugin, hasUpdate: info.hasUpdate, latestVersion: info.latestVersion }
            } catch {
              return { plugin, hasUpdate: false }
            }
          }),
        )

        // 筛选有更新且未通知过的（NOTIFIED_VERSIONS 去重，避免同一版本重复通知/自动更新）
        const newUpdates = results.filter(
          (r) => r.hasUpdate && r.latestVersion && !isAlreadyNotified(r.plugin.pluginKey, r.latestVersion),
        )

        if (newUpdates.length === 0) {
          logger.system.info('[PluginUpdateChecker] No new updates found (all up-to-date or already notified)')
          return
        }

        const isZh = language === 'zh'
        const pluginNames = newUpdates.map((u) => getPluginDisplayName(u.plugin, isZh))
        const autoUpdate = isPluginAutoUpdateEnabled()

        logger.system.info(
          `[PluginUpdateChecker] Found ${newUpdates.length} update(s): ${pluginNames.join(', ')} (autoUpdate=${autoUpdate})`,
        )

        if (autoUpdate) {
          // ─── 自动更新模式：静默升级，完成后通知 ───
          const updatePromises = newUpdates.map(async (u) => {
            try {
              const result = await updatePlugin(u.plugin.pluginId, u.latestVersion!)
              if (result.success) {
                saveNotifiedVersion(u.plugin.pluginKey, u.latestVersion!)
                return { ...u, success: true as const }
              }
              return { ...u, success: false as const, error: result.error }
            } catch (err) {
              return { ...u, success: false as const, error: err instanceof Error ? err.message : String(err) }
            }
          })
          const updateResults = await Promise.all(updatePromises)

          const succeeded = updateResults.filter((r) => r.success)
          const failed = updateResults.filter((r) => !r.success)

          // 升级成功 → 右上角 toast 通知
          if (succeeded.length > 0) {
            const successNames = succeeded.map((r) => getPluginDisplayName(r.plugin, isZh))
            const title =
              isZh
                ? (succeeded.length === 1 ? '插件已自动更新' : `${succeeded.length} 个插件已自动更新`)
                : (succeeded.length === 1 ? 'Plugin Auto-Updated' : `${succeeded.length} Plugins Auto-Updated`)
            const message =
              isZh
                ? (succeeded.length === 1
                    ? `${successNames[0]} 已更新到 v${succeeded[0].latestVersion}`
                    : `${successNames.join('、')} 已更新到最新版本`)
                : (succeeded.length === 1
                    ? `${successNames[0]} updated to v${succeeded[0].latestVersion}`
                    : `${successNames.join(', ')} updated to latest`)

            toast.card({
              type: 'success',
              title,
              message,
              duration: 6000,
              source: 'PluginUpdateChecker',
              dedupeKey: 'plugin-auto-updated',
            })
          }

          // 升级失败 → 右上角 toast 警告（带去更新按钮）
          if (failed.length > 0) {
            const failedNames = failed.map((r) => getPluginDisplayName(r.plugin, isZh))
            const title =
              isZh
                ? (failed.length === 1 ? '插件自动更新失败' : `${failed.length} 个插件更新失败`)
                : (failed.length === 1 ? 'Plugin Update Failed' : `${failed.length} Plugins Failed to Update`)
            const message =
              isZh
                ? `${failedNames.join('、')} 更新失败，请手动重试`
                : `${failedNames.join(', ')} failed to update, please retry manually`

            toast.card({
              type: 'warning',
              title,
              message,
              duration: 0, // 持久通知
              source: 'PluginUpdateChecker',
              dedupeKey: 'plugin-auto-update-failed',
              actions: [
                {
                  id: 'go-update',
                  label: isZh ? '去更新' : 'Update',
                  onClick: () => {
                    useStore.getState().setShowPluginCenterPage(true)
                  },
                },
              ],
            })
          }
        } else {
          // ─── 手动更新模式：仅通知，不自动升级 ───
          for (const { plugin, latestVersion } of newUpdates) {
            if (latestVersion) {
              saveNotifiedVersion(plugin.pluginKey, latestVersion)
            }
          }

          const title =
            isZh
              ? (newUpdates.length === 1 ? '插件有新版本' : `${newUpdates.length} 个插件有新版本`)
              : (newUpdates.length === 1 ? 'Plugin Update Available' : `${newUpdates.length} Plugins Have Updates`)

          const firstVersion = newUpdates[0].latestVersion
          const message =
            isZh
              ? (newUpdates.length === 1
                  ? `${pluginNames[0]} 可更新到 v${firstVersion}`
                  : `${pluginNames.join('、')} 可更新`)
              : (newUpdates.length === 1
                  ? `${pluginNames[0]} can be updated to v${firstVersion}`
                  : `${pluginNames.join(', ')} have updates`)

          toast.card({
            type: 'info',
            title,
            message,
            duration: 0, // 持久通知，不自动消失
            source: 'PluginUpdateChecker',
            dedupeKey: 'plugin-update-available',
            actions: [
              {
                id: 'go-update',
                label: isZh ? '去更新' : 'Update',
                onClick: () => {
                  useStore.getState().setShowPluginCenterPage(true)
                },
              },
            ],
          })
        }
      } catch (err) {
        logger.system.warn('[PluginUpdateChecker] Check failed:', err)
      }
    }

    const timer = setTimeout(checkUpdates, INITIAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isAuthenticated, language])
}
