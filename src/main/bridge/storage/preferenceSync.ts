/**
 * 偏好设置同步 — 用户偏好与安全配置的 IPC 处理器
 *
 * 职责：
 * - 暴露用户配置目录管理（获取 / 设置）
 * - 暴露安全白名单管理（shell / git 可信路径）
 * - 暴露最近日志读取（用于诊断面板）
 * - 桥接 electron-store 持久化与渲染进程
 */

import { logger } from '@shared/toolkit/LogEngine'
import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import Store from 'electron-store'
import { getBootstrapStore, getUserConfigDir, setUserConfigDir } from '../../modules/configPath'
import { cleanConfigValue } from '@shared/configuration/configSanitizer'
import { SECURITY_DEFAULTS } from '@shared/appConstants'

interface SecurityModuleRef {
  securityManager: any
  updateWhitelist: (shell: string[], git: string[]) => void
  getWhitelist: () => { shell: string[]; git: string[] }
  /** 更新 Shell 命令黑名单 */
  updateBlacklist: (deniedShellCommands: string[]) => void
  /** 获取当前 Shell 命令黑名单 */
  getBlacklist: () => { shell: string[] }
}

const RECENT_LOG_MAX_BYTES = 1024 * 1024
const RECENT_LOG_MAX_LINES = 10000
const TAIL_CHUNK_SIZE = 64 * 1024

function readRecentLogTail(filePath: string, maxBytes = RECENT_LOG_MAX_BYTES, maxLines = RECENT_LOG_MAX_LINES): string {
  if (!fs.existsSync(filePath)) return ''

  const stats = fs.statSync(filePath)
  if (stats.size === 0) return ''

  const fileHandle = fs.openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    let position = stats.size
    let bytesCollected = 0
    let newlineCount = 0

    while (position > 0 && bytesCollected < maxBytes && newlineCount <= maxLines) {
      const readSize = Math.min(TAIL_CHUNK_SIZE, position, maxBytes - bytesCollected)
      position -= readSize
      const buffer = Buffer.alloc(readSize)
      const bytesRead = fs.readSync(fileHandle, buffer, 0, readSize, position)
      if (bytesRead <= 0) break

      const chunk = bytesRead === readSize ? buffer : buffer.subarray(0, bytesRead)
      chunks.unshift(chunk)
      bytesCollected += bytesRead
      newlineCount += chunk.toString('utf-8').split('\n').length - 1
    }

    const content = Buffer.concat(chunks).toString('utf-8')
    const lines = content.split(/\r?\n/)
    return lines.slice(-maxLines).join('\n')
  } finally {
    fs.closeSync(fileHandle)
  }
}

let securityRef: SecurityModuleRef | null = null

export function registerSettingsHandlers(
  resolveStore: (key: string) => Store,
  preferencesStore: Store,
  _bootstrapStore: Store,
  securityModule?: SecurityModuleRef
) {
  if (securityModule) {
    securityRef = securityModule
  }

  ipcMain.handle('settings:get', (_, key: string) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        return undefined
      }
      return store.get(key)
    } catch (e) {
      logger.ipc.error('[Settings] settings:get failed', { key, error: e })
      throw e
    }
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    try {
      const store = resolveStore(key)
      if (!store) {
        logger.ipc.error('[Settings] resolveStore returned null for key:', key)
        throw new Error(`Config store not ready for key: ${key}`)
      }
      const cleanedValue = cleanConfigValue(key, value)

      if (cleanedValue === undefined) {
        store.delete(key as any)
      } else {
        store.set(key, cleanedValue)
      }

      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('settings:changed', { key, value })
        }
      })

      if (key === 'securitySettings' && securityRef) {
        const securitySettings = (cleanedValue ?? value) as any
        const defaults = {
          enablePermissionConfirm: true,
          strictWorkspaceMode: true,
          allowedShellCommands: SECURITY_DEFAULTS.SHELL_COMMANDS,
          deniedShellCommands: SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS,
          allowedGitSubcommands: SECURITY_DEFAULTS.GIT_SUBCOMMANDS,
        }
        securityRef.securityManager.updateConfig(securitySettings ?? defaults)

        // 旧版白名单同步（保留以兼容已安装版本；shell 部分不再用于校验）
        const shellCommands =
          securitySettings?.allowedShellCommands != null
            ? securitySettings.allowedShellCommands
            : SECURITY_DEFAULTS.SHELL_COMMANDS
        const gitCommands =
          securitySettings?.allowedGitSubcommands != null
            ? securitySettings.allowedGitSubcommands
            : SECURITY_DEFAULTS.GIT_SUBCOMMANDS
        securityRef.updateWhitelist(shellCommands, gitCommands)

        // 黑名单同步（AI 执行 Shell 命令时实际生效的拦截策略）
        const deniedShellCommands =
          securitySettings?.deniedShellCommands != null
            ? securitySettings.deniedShellCommands
            : SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS
        securityRef.updateBlacklist(deniedShellCommands)

        // 工作区外允许访问目录同步（用户主动配置的额外可访问目录）
        const allowedExternalDirs =
          Array.isArray(securitySettings?.allowedExternalDirectories)
            ? securitySettings.allowedExternalDirectories
            : []
        securityRef.securityManager.setAllowedExternalDirectories(allowedExternalDirs)
      }

      return true
    } catch (e) {
      logger.ipc.error('[Settings] settings:set failed', { key, error: e })
      throw e
    }
  })

  ipcMain.handle('settings:getWhitelist', () => {
    if (!securityRef) {
      return { shell: [], git: [] }
    }
    return securityRef.getWhitelist()
  })

  ipcMain.handle('settings:resetWhitelist', () => {
    const defaultShellCommands = [...SECURITY_DEFAULTS.SHELL_COMMANDS]
    const defaultGitCommands = [...SECURITY_DEFAULTS.GIT_SUBCOMMANDS]
    const defaultDeniedShellCommands = [...SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS]

    if (securityRef) {
      // 旧版白名单（仍同步以便兼容已安装版本配置）
      securityRef.updateWhitelist(defaultShellCommands, defaultGitCommands)
      // 黑名单也一并重置为默认值（UI 上的"重置"按钮会触发此 IPC）
      securityRef.updateBlacklist(defaultDeniedShellCommands)
    }

    const currentSecuritySettings = preferencesStore.get('securitySettings', {}) as any
    const newSecuritySettings = {
      ...currentSecuritySettings,
      allowedShellCommands: defaultShellCommands,
      deniedShellCommands: defaultDeniedShellCommands,
      allowedGitSubcommands: defaultGitCommands,
    }
    preferencesStore.set('securitySettings', newSecuritySettings)

    return { shell: defaultShellCommands, git: defaultGitCommands }
  })

  // 获取当前 Shell 命令黑名单
  ipcMain.handle('settings:getBlacklist', () => {
    if (!securityRef) {
      return { shell: [] }
    }
    return securityRef.getBlacklist()
  })

  // 重置 Shell 命令黑名单为默认值
  ipcMain.handle('settings:resetBlacklist', () => {
    const defaultDeniedShellCommands = [...SECURITY_DEFAULTS.DENIED_SHELL_COMMANDS]

    if (securityRef) {
      securityRef.updateBlacklist(defaultDeniedShellCommands)
    }

    const currentSecuritySettings = preferencesStore.get('securitySettings', {}) as any
    const newSecuritySettings = {
      ...currentSecuritySettings,
      deniedShellCommands: defaultDeniedShellCommands,
    }
    preferencesStore.set('securitySettings', newSecuritySettings)

    return { shell: defaultDeniedShellCommands }
  })

  ipcMain.handle('settings:getConfigPath', () => {
    return getUserConfigDir()
  })

  ipcMain.handle('settings:setConfigPath', async (_, newPath: string) => {
    try {
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true })
      }
      setUserConfigDir(newPath, getBootstrapStore())
      return true
    } catch (err) {
      logger.ipc.error('[Settings] Failed to set config path:', err)
      return false
    }
  })

  ipcMain.handle('workspace:restore:legacy', () => {
    const store = resolveStore('lastWorkspacePath')
    return store ? store.get('lastWorkspacePath') : undefined
  })

  ipcMain.handle('settings:getUserDataPath', () => {
    return getUserConfigDir()
  })

  ipcMain.handle('settings:getAppConfig', async () => {
    try {
      const path = require('path')
      const configPath = path.join(getUserConfigDir(), '.aweeclaw', 'aweeclaw-config.json')
      if (!fs.existsSync(configPath)) {
        return null
      }
      const raw = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      return { serverUrl: config.serverUrl || null }
    } catch (err) {
      logger.ipc.warn('[Settings] Failed to read app config:', err)
      return null
    }
  })

  ipcMain.handle('settings:getRecentLogs', async () => {
    try {
      const path = require('path')
      const logPath = path.join(getUserConfigDir(), 'logs', 'main.log')
      return readRecentLogTail(logPath)
    } catch (err) {
      logger.ipc.error('[Settings] Failed to read logs:', err)
      return ''
    }
  })
}
