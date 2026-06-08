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
 * - scenario:marketplaceInstall — 从市场在线下载并安装场景包
 * - scenario:marketplaceCheckUpdates — 批量检查场景更新
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
import * as crypto from 'crypto'
import { pipeline as callbackPipeline } from 'stream'
import { promisify } from 'util'
import { app, net } from 'electron'
import * as zlib from 'zlib'
import * as tar from 'tar'

void promisify(callbackPipeline)

function getScenariosDir(): string {
  return path.join(app.getPath('userData'), 'scenarios')
}

function getScenarioDir(scenarioId: string): string {
  return path.join(getScenariosDir(), scenarioId)
}

function getTempDir(): string {
  const tmp = path.join(app.getPath('userData'), 'tmp', 'scenario-downloads')
  if (!fs.existsSync(tmp)) {
    fs.mkdirSync(tmp, { recursive: true })
  }
  return tmp
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

interface MarketplaceInstallParams {
  scenarioId: string
  downloadUrl: string
  checksum: string
  signature?: string
  version: string
  fileSize: number
  packageType: string
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

interface DownloadProgress {
  scenarioId: string
  phase: 'downloading' | 'verifying' | 'extracting' | 'configuring'
  bytesDownloaded: number
  bytesTotal: number
  percent: number
}

function sendProgress(getMainWindow: () => BrowserWindow | null, progress: DownloadProgress) {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('scenario:installProgress', progress)
  }
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const dir = path.dirname(destPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let existingSize = 0
  if (fs.existsSync(destPath)) {
    existingSize = fs.statSync(destPath).size
  }

  return new Promise<void>((resolve, reject) => {
    const request = net.request(url)
    const fileStream = fs.createWriteStream(destPath, {
      flags: existingSize > 0 ? 'a' : 'w',
    })

    if (existingSize > 0) {
      request.setHeader('Range', `bytes=${existingSize}-`)
    }

    let bytesDownloaded = existingSize
    let bytesTotal = 0

    request.on('response', (response) => {
      const location = response.headers.location
        const redirectUrl = Array.isArray(location) ? location[0] : location
        if (response.statusCode >= 300 && response.statusCode < 400 && redirectUrl) {
          fileStream.close()
          downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject)
        return
      }

      if (response.statusCode === 416) {
        fileStream.close()
        resolve()
        return
      }

      if (response.statusCode !== 200 && response.statusCode !== 206) {
        fileStream.close()
        fs.unlinkSync(destPath)
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const contentLength = response.headers['content-length']
      if (contentLength) {
        const cl = Array.isArray(contentLength) ? contentLength[0] : contentLength
        const parsed = parseInt(cl, 10)
        if (!isNaN(parsed)) {
          bytesTotal = response.statusCode === 206 ? existingSize + parsed : parsed
        }
      }

      response.on('data', (chunk) => {
        fileStream.write(chunk)
        bytesDownloaded += chunk.length
        if (onProgress) {
          onProgress(bytesDownloaded, bytesTotal)
        }
      })

      response.on('end', () => {
        fileStream.end()
        resolve()
      })

      response.on('error', (err) => {
        fileStream.close()
        reject(err)
      })
    })

    request.on('error', (err) => {
      fileStream.close()
      reject(err)
    })

    request.end()
  })
}

function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const fileBuffer = fs.readFileSync(filePath)
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  return hash === expectedChecksum
}

function verifySignature(checksum: string, signature: string, publicKey: string): boolean {
  try {
    const formattedKey = publicKey.replace(/\\n/g, '\n')
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(checksum)
    verify.end()
    return verify.verify(formattedKey, signature, 'base64')
  } catch (err) {
    logger.agent.error(`[ScenarioInstall] Signature verification error: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

let cachedPublicKey: string | null = null

async function getSigningPublicKey(): Promise<string | null> {
  if (cachedPublicKey) return cachedPublicKey

  try {
    const configPath = path.join(app.getPath('userData'), 'signing-public-key.pem')
    if (fs.existsSync(configPath)) {
      cachedPublicKey = fs.readFileSync(configPath, 'utf-8').trim()
      return cachedPublicKey
    }
  } catch (e) { logger.security.warn('Failed to load cached public key:', e) }

  return null
}

function validateTarHeader(buffer: Buffer): boolean {
  if (buffer.length < 512) return false

  const header = buffer.subarray(0, 512)
  const checksumOffset = 148
  const checksumLength = 8

  let storedChecksum: number | null = null
  const checksumStr = header.subarray(checksumOffset, checksumOffset + checksumLength).toString('ascii').trim()
  if (checksumStr) {
    storedChecksum = parseInt(checksumStr, 8)
  }

  if (storedChecksum === null || isNaN(storedChecksum)) return false

  const headerForCalc = Buffer.from(header)
  headerForCalc.fill(0x20, checksumOffset, checksumOffset + checksumLength)
  let calculatedChecksum = 0
  for (let i = 0; i < 512; i++) {
    calculatedChecksum += headerForCalc[i]
  }

  return storedChecksum === calculatedChecksum
}

async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  const fileBuffer = fs.readFileSync(archivePath)

  if (fileBuffer.length < 2 || fileBuffer[0] !== 0x1f || fileBuffer[1] !== 0x8b) {
    throw new Error('TAR_BAD_ARCHIVE: Not a valid gzip file')
  }

  let decompressed: Buffer
  try {
    decompressed = zlib.gunzipSync(fileBuffer)
  } catch {
    throw new Error('TAR_BAD_ARCHIVE: Gzip decompression failed, file may be corrupted')
  }

  if (decompressed.length < 512 || !validateTarHeader(decompressed)) {
    throw new Error('TAR_BAD_ARCHIVE: Unrecognized archive format')
  }

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
  fs.mkdirSync(targetDir, { recursive: true })

  return tar.x({
    file: archivePath,
    cwd: targetDir,
    strip: 1,
  })
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
        return { success: false, error: `Scenario directory not found: ${scenarioDir}`, files: {}, config: null }
      }

      const files: Record<string, string> = {}

      const readFileIfExist = (filePath: string) => {
        const fullPath = path.join(scenarioDir, filePath)
        if (fs.existsSync(fullPath)) {
          try {
            files[filePath] = fs.readFileSync(fullPath, 'utf-8')
          } catch (e) { logger.system.warn('Failed to read scenario file:', e) }
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

  safeIpcHandle('scenario:marketplaceInstall', async (_event, params: MarketplaceInstallParams) => {
    const { scenarioId, downloadUrl, checksum, version, fileSize, packageType } = params
    const tmpDir = getTempDir()
    const archivePath = path.join(tmpDir, `${scenarioId}-${version}.tar.gz`)
    const targetDir = getScenarioDir(scenarioId)

    try {
      logger.agent.info(`[ScenarioMarketplace] Downloading scenario "${scenarioId}" v${version} from ${downloadUrl}`)

      sendProgress(getMainWindow, {
        scenarioId,
        phase: 'downloading',
        bytesDownloaded: 0,
        bytesTotal: fileSize,
        percent: 0,
      })

      await downloadFile(downloadUrl, archivePath, (downloaded, total) => {
        const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0
        sendProgress(getMainWindow, {
          scenarioId,
          phase: 'downloading',
          bytesDownloaded: downloaded,
          bytesTotal: total,
          percent: pct,
        })
      })

      sendProgress(getMainWindow, {
        scenarioId,
        phase: 'verifying',
        bytesDownloaded: fileSize,
        bytesTotal: fileSize,
        percent: 100,
      })

      const actualSize = fs.statSync(archivePath).size
      if (fileSize > 0 && actualSize !== fileSize) {
        fs.unlinkSync(archivePath)
        return { success: false, error: `File size mismatch: expected ${fileSize}, got ${actualSize}` }
      }

      if (!verifyChecksum(archivePath, checksum)) {
        fs.unlinkSync(archivePath)
        return { success: false, error: 'Checksum verification failed. The package may be corrupted or tampered with.' }
      }

      logger.agent.info(`[ScenarioMarketplace] Checksum verified for "${scenarioId}" v${version}`)

      if (params.signature) {
        const publicKey = await getSigningPublicKey()
        if (publicKey) {
          if (!verifySignature(checksum, params.signature, publicKey)) {
            fs.unlinkSync(archivePath)
            return { success: false, error: 'Signature verification failed. The package may be tampered with or from an untrusted source.' }
          }
          logger.agent.info(`[ScenarioMarketplace] Signature verified for "${scenarioId}" v${version}`)
        } else {
          logger.agent.warn(`[ScenarioMarketplace] No signing public key configured, skipping signature verification for "${scenarioId}"`)
        }
      }

      sendProgress(getMainWindow, {
        scenarioId,
        phase: 'extracting',
        bytesDownloaded: fileSize,
        bytesTotal: fileSize,
        percent: 50,
      })

      // 备份旧版本（用于回滚）
      const backupDir = path.join(getScenariosDir(), '.backups', scenarioId)
      if (fs.existsSync(targetDir)) {
        if (!fs.existsSync(path.dirname(backupDir))) {
          fs.mkdirSync(path.dirname(backupDir), { recursive: true })
        }
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true })
        }
        fs.renameSync(targetDir, backupDir)
        logger.agent.info(`[ScenarioMarketplace] Backed up previous version of "${scenarioId}" to ${backupDir}`)
      }

      await extractTarGz(archivePath, targetDir)

      sendProgress(getMainWindow, {
        scenarioId,
        phase: 'configuring',
        bytesDownloaded: fileSize,
        bytesTotal: fileSize,
        percent: 90,
      })

      logger.agent.info(`[ScenarioMarketplace] Extracted scenario "${scenarioId}" to ${targetDir}`)

      const config = readScenarioConfig(targetDir)
      if (!config) {
        logger.agent.warn(`[ScenarioMarketplace] No scenario.json found after extraction for "${scenarioId}", but files are in place`)
      }

      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath)
      }

      return {
        success: true,
        scenarioId,
        version,
        targetDir,
        config,
        packageType,
      }
    } catch (err) {
      logger.agent.error(`[ScenarioMarketplace] Install failed for "${scenarioId}":`, err)

      if (fs.existsSync(archivePath)) {
        try { fs.unlinkSync(archivePath) } catch (e) { logger.system.warn('Failed to delete archive:', e) }
      }

      if (fs.existsSync(targetDir)) {
        try { fs.rmSync(targetDir, { recursive: true, force: true }) } catch (e) { logger.system.warn('Failed to remove target dir:', e) }
      }

      const rawError = err instanceof Error ? err.message : String(err)
      let friendlyError = rawError
      if (rawError.includes('TAR_BAD_ARCHIVE') || rawError.includes('Unrecognized archive format')) {
        friendlyError = 'Package archive is corrupted or in an unsupported format. Please verify the scenario package.'
      } else if (rawError.includes('TAR_ENTRY_INVALID') || rawError.includes('checksum failure')) {
        friendlyError = 'Package archive is corrupted or contains invalid entries. Please verify the scenario package.'
      } else if (rawError.includes('TAR_ENTRY_ERROR') || rawError.includes('TAR_ABORT')) {
        friendlyError = 'Package archive extraction failed. The package may be corrupted.'
      } else if (rawError.includes('Checksum verification failed')) {
        friendlyError = 'Checksum verification failed. The package may be corrupted or tampered with.'
      } else if (rawError.includes('Signature verification failed')) {
        friendlyError = 'Signature verification failed. The package may be tampered with or from an untrusted source.'
      } else if (rawError.includes('ECONNREFUSED') || rawError.includes('ENOTFOUND') || rawError.includes('network') || rawError.includes('fetch failed')) {
        friendlyError = 'Network error occurred while downloading the scenario package.'
      }

      const result = {
        success: false,
        error: friendlyError,
      }
      logger.agent.info(`[ScenarioMarketplace] Returning error result for "${scenarioId}":`, JSON.stringify(result))
      return result
    }
  })

  safeIpcHandle('scenario:marketplaceCheckUpdates', async (
    _event,
    installedScenarios: Array<{ id: string; version: string }>,
  ) => {
    return installedScenarios.map(s => ({
      scenarioId: s.id,
      currentVersion: s.version,
      needsUpdate: false,
    }))
  })

  safeIpcHandle('scenario:marketplaceUpdate', async (
    _event,
    params: MarketplaceInstallParams,
  ) => {
    const { scenarioId, downloadUrl, checksum, version, fileSize, packageType } = params
    const tmpDir = getTempDir()
    const archivePath = path.join(tmpDir, `${scenarioId}-${version}.tar.gz`)
    const targetDir = getScenarioDir(scenarioId)
    const backupDir = `${targetDir}.bak.${Date.now()}`

    try {
      let previousVersion = ''
      if (fs.existsSync(targetDir)) {
        const existingConfig = readScenarioConfig(targetDir)
        previousVersion = existingConfig?.version || ''
        copyDirRecursive(targetDir, backupDir)
        logger.agent.info(`[ScenarioMarketplace] Backed up "${scenarioId}" to ${backupDir}`)
      }

      logger.agent.info(`[ScenarioMarketplace] Downloading update for "${scenarioId}" v${version}`)

      await downloadFile(downloadUrl, archivePath)

      const actualSize = fs.statSync(archivePath).size
      if (fileSize > 0 && actualSize !== fileSize) {
        fs.unlinkSync(archivePath)
        if (fs.existsSync(backupDir)) {
          copyDirRecursive(backupDir, targetDir)
          fs.rmSync(backupDir, { recursive: true, force: true })
        }
        return { success: false, error: `File size mismatch: expected ${fileSize}, got ${actualSize}` }
      }

      if (!verifyChecksum(archivePath, checksum)) {
        fs.unlinkSync(archivePath)
        if (fs.existsSync(backupDir)) {
          copyDirRecursive(backupDir, targetDir)
          fs.rmSync(backupDir, { recursive: true, force: true })
        }
        return { success: false, error: 'Checksum verification failed. The package may be corrupted or tampered with.' }
      }

      if (params.signature) {
        const publicKey = await getSigningPublicKey()
        if (publicKey) {
          if (!verifySignature(checksum, params.signature, publicKey)) {
            fs.unlinkSync(archivePath)
            if (fs.existsSync(backupDir)) {
              copyDirRecursive(backupDir, targetDir)
              fs.rmSync(backupDir, { recursive: true, force: true })
            }
            return { success: false, error: 'Signature verification failed. The package may be tampered with or from an untrusted source.' }
          }
          logger.agent.info(`[ScenarioMarketplace] Signature verified for update "${scenarioId}" v${version}`)
        }
      }

      await extractTarGz(archivePath, targetDir)

      const config = readScenarioConfig(targetDir)
      if (!config) {
        logger.agent.warn(`[ScenarioMarketplace] No scenario.json found after update for "${scenarioId}"`)
      }

      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath)
      }

      const rollbackDir = path.join(getScenariosDir(), '.rollback', scenarioId)
      if (fs.existsSync(rollbackDir)) {
        fs.rmSync(rollbackDir, { recursive: true, force: true })
      }
      fs.mkdirSync(rollbackDir, { recursive: true })
      const rollbackMetaPath = path.join(rollbackDir, 'meta.json')
      fs.writeFileSync(rollbackMetaPath, JSON.stringify({
        scenarioId,
        previousVersion: previousVersion,
        rolledBackAt: null,
        backedUpAt: new Date().toISOString(),
      }, null, 2))

      if (fs.existsSync(backupDir)) {
        const rollbackDataDir = path.join(rollbackDir, 'data')
        fs.renameSync(backupDir, rollbackDataDir)
      }

      logger.agent.info(`[ScenarioMarketplace] Updated scenario "${scenarioId}" to v${version}, rollback data preserved`)

      return {
        success: true,
        scenarioId,
        version,
        targetDir,
        config,
        packageType,
      }
    } catch (err) {
      logger.agent.error(`[ScenarioMarketplace] Update failed for "${scenarioId}":`, err)

      if (fs.existsSync(backupDir)) {
        logger.agent.info(`[ScenarioMarketplace] Rolling back "${scenarioId}" from backup`)
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        fs.renameSync(backupDir, targetDir)
      }

      if (fs.existsSync(archivePath)) {
        try { fs.unlinkSync(archivePath) } catch (e) { logger.system.warn('Failed to delete archive:', e) }
      }

      const rawError = err instanceof Error ? err.message : String(err)
      let friendlyError = rawError
      if (rawError.includes('TAR_BAD_ARCHIVE') || rawError.includes('Unrecognized archive format')) {
        friendlyError = 'Package archive is corrupted or in an unsupported format. Please verify the scenario package.'
      } else if (rawError.includes('TAR_ENTRY_INVALID') || rawError.includes('checksum failure')) {
        friendlyError = 'Package archive is corrupted or contains invalid entries. Please verify the scenario package.'
      } else if (rawError.includes('TAR_ENTRY_ERROR') || rawError.includes('TAR_ABORT')) {
        friendlyError = 'Package archive extraction failed. The package may be corrupted.'
      } else if (rawError.includes('Checksum verification failed')) {
        friendlyError = 'Checksum verification failed. The package may be corrupted or tampered with.'
      } else if (rawError.includes('Signature verification failed')) {
        friendlyError = 'Signature verification failed. The package may be tampered with or from an untrusted source.'
      } else if (rawError.includes('ECONNREFUSED') || rawError.includes('ENOTFOUND') || rawError.includes('network') || rawError.includes('fetch failed')) {
        friendlyError = 'Network error occurred while downloading the scenario package.'
      }

      return {
        success: false,
        error: friendlyError,
      }
    }
  })

  safeIpcHandle('scenario:getRollbackInfo', async (_event, scenarioId: string) => {
    const rollbackDir = path.join(getScenariosDir(), '.rollback', scenarioId)
    const metaPath = path.join(rollbackDir, 'meta.json')
    const dataDir = path.join(rollbackDir, 'data')

    if (!fs.existsSync(metaPath) || !fs.existsSync(dataDir)) {
      return { available: false }
    }

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      return {
        available: true,
        previousVersion: meta.previousVersion || '',
        backedUpAt: meta.backedUpAt || '',
      }
    } catch {
      return { available: false }
    }
  })

  safeIpcHandle('scenario:rollbackScenario', async (_event, scenarioId: string) => {
    const rollbackDir = path.join(getScenariosDir(), '.rollback', scenarioId)
    const dataDir = path.join(rollbackDir, 'data')
    const metaPath = path.join(rollbackDir, 'meta.json')
    const targetDir = getScenarioDir(scenarioId)

    if (!fs.existsSync(dataDir)) {
      return { success: false, error: 'No rollback data found for this scenario' }
    }

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }

      copyDirRecursive(dataDir, targetDir)

      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        meta.rolledBackAt = new Date().toISOString()
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      }

      fs.rmSync(rollbackDir, { recursive: true, force: true })

      const config = readScenarioConfig(targetDir)
      logger.agent.info(`[ScenarioMarketplace] Rolled back scenario "${scenarioId}"`)

      return {
        success: true,
        scenarioId,
        version: config?.version || '',
        targetDir,
        config,
      }
    } catch (err) {
      logger.agent.error(`[ScenarioMarketplace] Rollback failed for "${scenarioId}":`, err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  safeIpcHandle('scenario:clearRollbackData', async (_event, scenarioId?: string) => {
    const rollbackBase = path.join(getScenariosDir(), '.rollback')

    try {
      if (scenarioId) {
        const rollbackDir = path.join(rollbackBase, scenarioId)
        if (fs.existsSync(rollbackDir)) {
          fs.rmSync(rollbackDir, { recursive: true, force: true })
        }
      } else {
        if (fs.existsSync(rollbackBase)) {
          fs.rmSync(rollbackBase, { recursive: true, force: true })
        }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
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
