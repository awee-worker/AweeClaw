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

import { logger } from '@shared/utils/Logger'
import { safeIpcHandle } from './safeHandle'
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
      title: 'Select Scenario Directory',
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

  logger.ipc.info('[ScenarioInstall] IPC handlers registered')
}
