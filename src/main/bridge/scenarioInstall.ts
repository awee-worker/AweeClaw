/**
 * 场景安装 IPC handlers
 *
 * 提供场景安装相关的主进程能力：
 * - scenario:getScenariosDir  — 获取场景存储目录
 * - scenario:installFromLocal — 从本地目录安装场景
 * - scenario:selectScenarioDir — 弹出目录选择对话框
 * - scenario:readScenarioConfig — 读取场景配置文件
 * - scenario:getInstalledScenarioDirs — 获取已安装的外部场景目录列表
 * - scenario:deleteScenarioDir — 删除场景目录文件
 *
 * 场景存储策略：
 *   内置场景: 打包在 app 内部
 *   外部场景: {userDataPath}/scenarios/{scenarioId}/
 */

import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from './ipcGuard'
import { dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

function getScenariosDir(): string {
  return path.join(app.getPath('userData'), 'scenarios')
}

function getScenarioDir(scenarioId: string): string {
  return path.join(getScenariosDir(), scenarioId)
}

interface ScenarioConfigFile {
  id: string
  name: string
  nameZh: string
  icon?: string
  description?: string
  descriptionZh?: string
  version?: string
  author?: string
  category?: string
  tags?: string[]
  source?: string
  hasSettings?: boolean
  requiresWorkspace?: boolean
  identity?: Record<string, unknown>
  capabilities?: Record<string, unknown>
  ui?: Record<string, unknown>
  dataSources?: Record<string, unknown>
  permissions?: string[]
  dependencies?: Array<{ id: string; versionRange?: string; required?: boolean }>
  minAppVersion?: string
  homepage?: string
  license?: string
  installScripts?: Array<{ id: string; description?: string; sql: string }>
  uninstallScripts?: Array<{ id: string; description?: string; sql: string }>
}

function readScenarioConfig(sourceDir: string): ScenarioConfigFile | null {
  const configPath = path.join(sourceDir, 'config', 'scenario.json')
  if (!fs.existsSync(configPath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as ScenarioConfigFile
  } catch {
    return null
  }
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function registerScenarioInstallIpcHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  safeIpcHandle('scenario:getScenariosDir', async () => {
    return getScenariosDir()
  })

  safeIpcHandle('scenario:selectScenarioDir', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'DropdownSelector Scenario Directory',
      properties: ['openDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })

  safeIpcHandle('scenario:readScenarioConfig', async (_event, sourceDir: string) => {
    const config = readScenarioConfig(sourceDir)
    if (!config) {
      return { success: false, error: 'No scenario.json found in config directory' }
    }

    if (!config.id || !config.name) {
      return { success: false, error: 'Invalid scenario config: missing id or name' }
    }

    return { success: true, config }
  })

  safeIpcHandle('scenario:installFromLocal', async (_event, sourceDir: string) => {
    try {
      const config = readScenarioConfig(sourceDir)
      if (!config) {
        return { success: false, error: 'No valid scenario.json found in config directory' }
      }

      if (!config.id || !config.name) {
        return { success: false, error: 'Invalid scenario config: missing id or name' }
      }

      const scenarioId = config.id
      const targetDir = getScenarioDir(scenarioId)

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }

      fs.mkdirSync(targetDir, { recursive: true })

      copyDirRecursive(sourceDir, targetDir)

      logger.agent.info(`[ScenarioInstall] Copied scenario "${scenarioId}" to ${targetDir}`)

      return {
        success: true,
        scenarioId,
        targetDir,
        config,
      }
    } catch (err) {
      logger.agent.error('[ScenarioInstall] Install from local failed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  safeIpcHandle('scenario:getInstalledScenarioDirs', async () => {
    const scenariosDir = getScenariosDir()
    if (!fs.existsSync(scenariosDir)) {
      return []
    }

    const dirs: Array<{ scenarioId: string; dir: string; config: ScenarioConfigFile | null }> = []
    const entries = fs.readdirSync(scenariosDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const scenarioDir = path.join(scenariosDir, entry.name)
        const config = readScenarioConfig(scenarioDir)
        dirs.push({ scenarioId: entry.name, dir: scenarioDir, config })
      }
    }

    return dirs
  })

  safeIpcHandle('scenario:deleteScenarioDir', async (_event, scenarioId: string) => {
    try {
      const scenarioDir = getScenarioDir(scenarioId)
      if (fs.existsSync(scenarioDir)) {
        fs.rmSync(scenarioDir, { recursive: true, force: true })
        logger.agent.info(`[ScenarioInstall] Deleted scenario directory for "${scenarioId}"`)
      }
      return { success: true }
    } catch (err) {
      logger.agent.error(`[ScenarioInstall] Failed to delete scenario dir for "${scenarioId}":`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('scenario:deleteBuiltinSourceDir', async (_event, scenarioId: string) => {
    try {
      const appPath = app.getAppPath()
      const builtinDir = path.join(appPath, 'src', 'scenarios', scenarioId)
      if (fs.existsSync(builtinDir)) {
        fs.rmSync(builtinDir, { recursive: true, force: true })
        logger.agent.info(`[ScenarioInstall] Deleted builtin scenario source directory for "${scenarioId}"`)
        return { success: true }
      }

      const devDir = path.join(process.cwd(), 'src', 'scenarios', scenarioId)
      if (fs.existsSync(devDir)) {
        fs.rmSync(devDir, { recursive: true, force: true })
        logger.agent.info(`[ScenarioInstall] Deleted dev scenario source directory for "${scenarioId}"`)
        return { success: true }
      }

      return { success: true }
    } catch (err) {
      logger.agent.error(`[ScenarioInstall] Failed to delete builtin source dir for "${scenarioId}":`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('scenario:loadScenarioFiles', async (_event, scenarioId: string) => {
    try {
      const scenarioDir = getScenarioDir(scenarioId)
      if (!fs.existsSync(scenarioDir)) {
        return { success: false, error: `Scenario directory not found: ${scenarioId}`, files: {}, config: null }
      }

      const files: Record<string, string> = {}

      const readFileIfExist = (filePath: string) => {
        const fullPath = path.join(scenarioDir, filePath)
        if (fs.existsSync(fullPath)) {
          try {
            files[filePath] = fs.readFileSync(fullPath, 'utf-8')
          } catch {}
        }
      }

      readFileIfExist('prompts/system.md')
      readFileIfExist('prompts/security.md')
      readFileIfExist('prompts/conventions.md')
      readFileIfExist('prompts/workflow.md')

      const dbDir = path.join(scenarioDir, 'db')
      if (fs.existsSync(dbDir)) {
        const dbEntries = fs.readdirSync(dbDir)
        for (const entry of dbEntries) {
          if (entry.endsWith('.sql')) {
            readFileIfExist(`db/${entry}`)
          }
        }
      }

      const toolsDir = path.join(scenarioDir, 'tools')
      if (fs.existsSync(toolsDir)) {
        const toolEntries = fs.readdirSync(toolsDir)
        for (const entry of toolEntries) {
          if (entry.endsWith('.json')) {
            readFileIfExist(`tools/${entry}`)
          }
        }
      }

      const scriptsDir = path.join(scenarioDir, 'scripts')
      if (fs.existsSync(scriptsDir)) {
        const readScriptsRecursive = (dir: string, prefix: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
              readScriptsRecursive(fullPath, relPath)
            } else if (entry.name.endsWith('.js')) {
              readFileIfExist(`scripts/${relPath}`)
            }
          }
        }
        readScriptsRecursive(scriptsDir, '')
      }

      const config = readScenarioConfig(scenarioDir)

      return { success: true, files, config }
    } catch (err) {
      logger.agent.error(`[ScenarioInstall] Failed to load scenario files for "${scenarioId}":`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err), files: {}, config: null }
    }
  })

  logger.ipc.info('[ScenarioInstall] IPC handlers registered')
}

export function registerScenarioMarketplaceHandlers(): void {
  safeIpcHandle('scenario:marketplaceSearch', async (_event, query: string, page?: number, pageSize?: number) => {
    try {
      const { marketplaceAPI } = await import('../../scenario-system/marketplace')
      return await marketplaceAPI.search(query, page, pageSize)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Search failed:', err)
      return { total: 0, page: 1, pageSize: 20, scenarios: [] }
    }
  })

  safeIpcHandle('scenario:marketplaceFeatured', async () => {
    try {
      const { marketplaceAPI } = await import('../../scenario-system/marketplace')
      return await marketplaceAPI.getFeatured()
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get featured failed:', err)
      return []
    }
  })

  safeIpcHandle('scenario:marketplaceDetails', async (_event, scenarioId: string) => {
    try {
      const { marketplaceAPI } = await import('../../scenario-system/marketplace')
      return await marketplaceAPI.getDetails(scenarioId)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get details failed:', err)
      return null
    }
  })

  safeIpcHandle('scenario:marketplaceCategories', async () => {
    try {
      const { marketplaceAPI } = await import('../../scenario-system/marketplace')
      return await marketplaceAPI.getCategories()
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get categories failed:', err)
      return []
    }
  })

  safeIpcHandle('scenario:marketplaceDownload', async (_event, scenarioId: string) => {
    try {
      const { marketplaceAPI } = await import('../../scenario-system/marketplace')
      return await marketplaceAPI.download(scenarioId)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Download failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.ipc.info('[ScenarioMarketplace] IPC handlers registered')
}
