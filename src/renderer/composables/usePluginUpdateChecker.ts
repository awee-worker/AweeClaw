/**
 * 插件更新自动检测 Hook
 *
 * 应用启动后延迟检查已安装插件是否有新版本：
 * - 启动后 30 秒执行首次检查（避免影响启动性能）
 * - 检测到更新时通过 toast.card 发送持久通知（带跳转按钮）
 * - 使用 dedupeKey 避免重复通知同一批更新
 * - 24 小时内只检查一次（localStorage 记录上次检查时间）
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { checkPluginUpdate, getInstalledPlugins } from '@services/pluginService'
import { toast } from '@components/foundation/InlineNotification'
import { logger } from '@shared/toolkit/LogEngine'
import type { InstalledPlugin } from '@services/pluginService'

/** 启动后延迟检查时间（毫秒） */
const INITIAL_DELAY_MS = 30 * 1000

/** 检查间隔（24 小时） */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** localStorage 键名 */
const LAST_CHECK_KEY = 'aweeclaw:plugin-update-last-check'
const NOTIFIED_VERSIONS_KEY = 'aweeclaw:plugin-update-notified-versions'

interface NotifiedVersion {
  pluginKey: string
  latestVersion: string
  notifiedAt: number
}

/** 读取上次检查时间 */
function getLastCheckTime(): number {
  try {
    const v = localStorage.getItem(LAST_CHECK_KEY)
    return v ? parseInt(v, 10) : 0
  } catch {
    return 0
  }
}

/** 记录检查时间 */
function saveCheckTime(time: number): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(time))
  } catch {
    // ignore
  }
}

/** 读取已通知的版本列表 */
function getNotifiedVersions(): NotifiedVersion[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_VERSIONS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as NotifiedVersion[]
    // 清理超过 7 天的记录
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return arr.filter(item => item.notifiedAt > cutoff)
  } catch {
    return []
  }
}

/** 记录已通知的版本 */
function saveNotifiedVersion(pluginKey: string, latestVersion: string): void {
  try {
    const existing = getNotifiedVersions().filter(v => v.pluginKey !== pluginKey)
    existing.push({ pluginKey, latestVersion, notifiedAt: Date.now() })
    localStorage.setItem(NOTIFIED_VERSIONS_KEY, JSON.stringify(existing))
  } catch {
    // ignore
  }
}

/** 检查是否已通知过该版本 */
function isAlreadyNotified(pluginKey: string, latestVersion: string): boolean {
  const notified = getNotifiedVersions()
  return notified.some(v => v.pluginKey === pluginKey && v.latestVersion === latestVersion)
}

interface UpdateCheckResult {
  plugin: InstalledPlugin
  hasUpdate: boolean
  latestVersion?: string
}

export function usePluginUpdateChecker(): void {
  const { isAuthenticated, language } = useStore(useShallow((state) => ({
    isAuthenticated: state.isAuthenticated,
    language: state.language,
  })))

  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || hasCheckedRef.current) return
    hasCheckedRef.current = true

    const checkUpdates = async () => {
      // 24 小时内只检查一次
      const lastCheck = getLastCheckTime()
      if (Date.now() - lastCheck < CHECK_INTERVAL_MS) {
        logger.system.debug('[PluginUpdateChecker] Skipped: checked within 24h')
        return
      }

      try {
        const installed = await getInstalledPlugins()
        if (installed.length === 0) {
          saveCheckTime(Date.now())
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

        // 筛选有更新且未通知过的
        const newUpdates = results.filter(
          (r) => r.hasUpdate && r.latestVersion && !isAlreadyNotified(r.plugin.pluginKey, r.latestVersion),
        )

        saveCheckTime(Date.now())

        if (newUpdates.length === 0) {
          logger.system.debug('[PluginUpdateChecker] No new updates found')
          return
        }

        // 发送通知
        const isZh = language === 'zh'
        const pluginNames = newUpdates.map(u => {
          const manifest = u.plugin.manifest as Record<string, unknown>
          return (manifest.nameZh as string) || (manifest.name as string) || u.plugin.pluginKey
        })

        for (const { plugin, latestVersion } of newUpdates) {
          if (latestVersion) {
            saveNotifiedVersion(plugin.pluginKey, latestVersion)
          }
        }

        const title = isZh
          ? (newUpdates.length === 1 ? '插件有新版本' : `${newUpdates.length} 个插件有新版本`)
          : (newUpdates.length === 1 ? 'Plugin Update Available' : `${newUpdates.length} Plugins Have Updates`)

        const firstVersion = newUpdates[0].latestVersion
        const message = isZh
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

        logger.system.info(`[PluginUpdateChecker] Found ${newUpdates.length} plugin update(s): ${pluginNames.join(', ')}`)
      } catch (err) {
        logger.system.warn('[PluginUpdateChecker] Check failed:', err)
      }
    }

    const timer = setTimeout(checkUpdates, INITIAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isAuthenticated, language])
}
