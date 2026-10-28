/**
 * 场景安装桥接 — 场景安装与市场的 IPC 接口
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
import { safeIpcHandle } from '../core/ipcGuard'
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
  type?: string
  entryPoint?: string
  styleFile?: string
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
  /** 打包形态，与 type 同义但出现在较早的场景配置里 */
  packageType?: string
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

/** 场景配置的规范相对路径，运行时与已安装目录扫描统一按此读取 */
const CANONICAL_CONFIG_REL = 'config/scenario.json'

/**
 * 场景配置的候选相对路径
 *
 * 磁盘上存在多种落盘结构，都要认：
 * - config/scenario.json：构建产物、已安装场景的规范位置
 * - scenario.json：市场分发包、早期手工场景的扁平结构
 * - src/config/scenario.json：尚未迁移到根 config 的工程
 *
 * 返回配置内容与命中的相对路径，安装时据此把非规范结构归一化。
 */
const CONFIG_CANDIDATE_RELS = [CANONICAL_CONFIG_REL, 'scenario.json', 'src/config/scenario.json']

function readScenarioConfigFile(
  dir: string
): { config: ScenarioConfigFile; configRel: string } | null {
  for (const rel of CONFIG_CANDIDATE_RELS) {
    const configPath = path.join(dir, rel)
    if (!fs.existsSync(configPath)) continue
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as ScenarioConfigFile
      // 同目录下的 package.json 之类不会被当成场景配置
      if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string' || !parsed.id) continue
      return { config: parsed, configRel: rel }
    } catch {
      continue
    }
  }
  return null
}

function readScenarioConfig(sourceDir: string): ScenarioConfigFile | null {
  return readScenarioConfigFile(sourceDir)?.config ?? null
}

/** 探测子目录时跳过与场景产物无关的目录，避免把 prompts/、db/ 之类误判成场景根 */
const SOURCE_PROBE_SKIP_DIRS = new Set([
  'node_modules', '.git', '.history', 'src', 'dist', 'config',
  'prompts', 'scripts', 'db', 'assets', 'docs', 'test',
])

/** 选中产物目录（而非工程根）时允许向上回溯的目录名 */
const PRODUCT_DIR_NAMES = new Set(['dist', 'build', 'out', 'lib'])

interface ResolvedScenarioSource {
  dir: string
  config: ScenarioConfigFile
  configRel: string
}

/**
 * 安装源解析结果
 *
 * 失败时区分三种原因，因为对应的修复动作完全不同：
 * - none     ：目录里确实没有任何场景配置，用户选错了目录
 * - ambiguous：命中了多个场景（选了场景集合的父目录），需要选具体场景
 * - not-built：配置存在但 entryPoint 产物缺失，需要先执行构建
 */
type ResolveInstallResult =
  | { ok: true; source: ResolvedScenarioSource }
  | { ok: false; reason: 'none' | 'ambiguous' | 'not-built'; candidates: string[] }

/** 场景是否为声明式（仅配置驱动，不依赖 entryPoint 产物） */
function isDeclarativeScenario(config: ScenarioConfigFile): boolean {
  return config.type === 'declarative' || config.packageType === 'declarative'
}

/**
 * 解析本地安装的实际源目录
 *
 * 用户在「安装本地场景」时选中的目录可能是五种形态：
 * - 构建产物目录：本身就有 config/scenario.json（正常情况）
 * - 场景工程根目录：config/scenario.json 指向 dist/index.js，需整体复制工程根
 * - 扁平场景包：scenario.json 直接在根目录（市场分发包形态）
 * - 外层目录 / 产物子目录：真正的场景目录在其子目录或上一级
 * - 场景集合目录：下面有多个场景，无法自动判定，需要用户选具体目录
 *
 * 判定依据不是「有没有 dist」而是「哪个目录能让 entryPoint 落地」：
 * - 根目录的 config/scenario.json 里 entryPoint 常写成 dist/index.js，需整体复制工程根；
 * - dist/config/scenario.json 只在 dist 自身承载运行时代码时才可选，否则会指向不存在的路径。
 */
function resolveInstallSource(sourceDir: string): ResolveInstallResult {
  const entryExists = (dir: string, entry?: string): boolean => {
    if (!entry) return false
    const rel = entry.replace(/^\.\//, '')
    // 绝对路径与回溯路径不参与判定，交由默认分支处理
    if (!rel || path.isAbsolute(rel) || rel.includes('..')) return false
    return fs.existsSync(path.join(dir, rel))
  }

  /**
   * 判断解析出的目录是否能让场景真正加载：
   * 编程式场景要求 entryPoint（及 styleFile）在该目录下存在，
   * 声明式场景由配置文件驱动，entryPoint 不参与加载，无需校验。
   */
  const isRuntimeComplete = (hit: ResolvedScenarioSource): boolean => {
    if (isDeclarativeScenario(hit.config)) return true
    const { entryPoint, styleFile } = hit.config
    if (entryPoint && !entryExists(hit.dir, entryPoint)) return false
    if (styleFile && !entryExists(hit.dir, styleFile)) return false
    return true
  }

  const probe = (dir: string): ResolvedScenarioSource | null => {
    const distDir = path.join(dir, 'dist')
    const distHit = readScenarioConfigFile(distDir)
    const selfHit = readScenarioConfigFile(dir)

    if (distHit && entryExists(distDir, distHit.config.entryPoint)) {
      return { dir: distDir, ...distHit }
    }
    if (selfHit && entryExists(dir, selfHit.config.entryPoint)) {
      return { dir, ...selfHit }
    }
    // 声明式场景的 entryPoint 不指向可执行文件，此时以配置所在的目录为准
    if (selfHit) return { dir, ...selfHit }
    if (distHit) return { dir: distDir, ...distHit }

    return null
  }

  /** 向下探测子目录（最多两层），命中运行时完整的场景根后不再继续深入 */
  const probeSubdirs = (root: string, maxDepth = 2): ResolvedScenarioSource[] => {
    const hits: ResolvedScenarioSource[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > maxDepth) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') || SOURCE_PROBE_SKIP_DIRS.has(entry.name)) continue
        const child = path.join(dir, entry.name)
        const hit = probe(child)
        if (hit && isRuntimeComplete(hit)) {
          hits.push(hit)
          continue
        }
        walk(child, depth + 1)
      }
    }
    walk(root, 1)
    return hits
  }

  const direct = probe(sourceDir)
  if (direct && isRuntimeComplete(direct)) return { ok: true, source: direct }

  // 选中的是产物子目录（dist/build/…）时，回退到上一级工程目录，
  // 整体复制后 entryPoint 才能落地
  const isProductDir = PRODUCT_DIR_NAMES.has(path.basename(sourceDir).toLowerCase())
  if (!direct || isProductDir) {
    const parent = probe(path.dirname(sourceDir))
    if (parent && isRuntimeComplete(parent)) return { ok: true, source: parent }
  }

  // 配置存在但产物缺失：这是「还没构建」，不是「选错目录」，必须分开告诉用户
  if (direct) return { ok: false, reason: 'not-built', candidates: [direct.dir] }

  // 外层目录：命中恰好一个场景才认定，命中多个说明用户选了场景集合目录
  const hits = probeSubdirs(sourceDir)
  if (hits.length === 1) return { ok: true, source: hits[0] }
  if (hits.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: hits.map((hit) => hit.dir) }
  }

  return { ok: false, reason: 'none', candidates: [] }
}

/** 把解析失败的原因转成用户能直接照做的提示 */
function describeResolveFailure(
  sourceDir: string,
  result: Extract<ResolveInstallResult, { ok: false }>
): string {
  if (result.reason === 'ambiguous') {
    const list = result.candidates.map((dir) => `- ${dir}`).join('\n')
    return (
      `Multiple scenarios found under ${sourceDir}. Select the directory of a single scenario instead:\n${list}`
    )
  }

  if (result.reason === 'not-built') {
    return (
      `Scenario configuration found in ${result.candidates[0]}, but its entryPoint is not built yet. ` +
      'Run "npm run build" in the scenario project, then select the project root (or the dist directory) again.'
    )
  }

  return (
    `No scenario configuration found in ${sourceDir}. ` +
    'Expected one of: config/scenario.json, scenario.json, src/config/scenario.json, or dist/config/scenario.json. ' +
    'Select the scenario project root, the dist directory, or a packaged scenario directory.'
  )
}



/**
 * 递归复制场景目录
 *
 * 排除不需要的目录和文件：
 * - node_modules/（依赖包，体积大且不需要在安装目录中）
 * - .git/（版本控制元数据）
 * - src/（源代码，运行时只需 dist/ 编译产物）
 * - .gitignore, tsconfig.json, esbuild.config.mjs（开发配置文件）
 */
const COPY_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'src', '.vscode', '.idea'])
const COPY_EXCLUDE_FILES = new Set([
  '.gitignore', 'tsconfig.json', 'esbuild.config.mjs', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'README.md',
])

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (COPY_EXCLUDE_DIRS.has(entry.name)) continue
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      copyDirRecursive(srcPath, destPath)
    } else {
      if (COPY_EXCLUDE_FILES.has(entry.name)) continue
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
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

/**
 * 主进程 HTTP 请求辅助函数
 * 使用 Electron 的 net 模块发起请求，避免引入额外依赖
 */
async function makeHttpRequest(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method })
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    }

    for (const [key, value] of Object.entries(requestHeaders)) {
      request.setHeader(key, value)
    }

    let data = ''
    request.on('response', (response) => {
      response.on('data', (chunk) => {
        data += chunk.toString()
      })
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${data.slice(0, 200)}`))
        }
      })
      response.on('error', reject)
    })
    request.on('error', reject)

    if (body && method === 'POST') {
      request.write(JSON.stringify(body))
    }
    request.end()
  })
}
/** 后端 /marketplace/check-updates 返回的单条更新记录 */
interface UpdatePayload {
  scenarioId: string
  scenarioName?: string
  scenarioNameZh?: string
  scenarioIcon?: string
  currentVersion: string
  latestVersion: string
  changelog?: string
  minAppVersion?: string
  fileSize?: number
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

/**
 * 判断一个目录是否构成可运行的场景根
 *
 * 判据是 entryPoint（与 styleFile）在该目录下能落地，而不是「有没有 dist 目录」：
 * 包内层级由打包方式决定，只有入口能解析出来才算落在了正确位置。
 */
function isCompleteScenarioRoot(dir: string): boolean {
  const hit = readScenarioConfigFile(dir)
  if (!hit) return false
  if (isDeclarativeScenario(hit.config)) return true

  const entry = (hit.config.entryPoint || '').replace(/^\.\//, '')
  if (!entry) return false
  if (!fs.existsSync(path.join(dir, entry))) return false

  const style = (hit.config.styleFile || '').replace(/^\.\//, '')
  if (style && !fs.existsSync(path.join(dir, style))) return false

  return true
}

/**
 * 在解压结果里定位真正的场景根
 *
 * 发布包顶层形态取决于打包方式，三种都要认：
 * - 单一工程目录：pkg/config/scenario.json + pkg/dist/index.js
 * - 产物目录作顶层：dist/config/scenario.json + dist/bundle/index.js
 * - 配置与产物各占一个顶层目录：config/scenario.json + dist/index.js
 *
 * 第三种本身就是场景根，不能再往里剥一层：剥掉之后 entryPoint 指向的
 * dist/index.js 会与落到根目录的 index.js 错位，表现为安装成功、
 * 启动加载时报 bundle 404。
 */
function locateScenarioRoot(dir: string): string | null {
  if (isCompleteScenarioRoot(dir)) return dir

  const subdirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(dir, entry.name))

  const complete = subdirs.filter(isCompleteScenarioRoot)
  if (complete.length === 1) return complete[0]

  return null
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

  // 解压到临时目录再定位场景根：包内层级在解压前无法判断，
  // 固定 strip 层数会把「配置与产物各占一个顶层目录」的包拆散。
  const stagingDir = path.join(getTempDir(), `extract-${path.basename(targetDir)}-${Date.now()}`)
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    await tar.x({ file: archivePath, cwd: stagingDir })

    const root = locateScenarioRoot(stagingDir)
    if (!root) {
      throw new Error(
        'SCENARIO_ROOT_NOT_FOUND: Package does not contain a runnable scenario ' +
          '(config/scenario.json whose entryPoint exists in the package)'
      )
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true })
    fs.renameSync(root, targetDir)
  } finally {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true })
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
    const result = resolveInstallSource(sourceDir)
    if (!result.ok) {
      return { success: false, error: describeResolveFailure(sourceDir, result) }
    }

    const { config, dir } = result.source
    if (!config.id || !config.name) {
      return { success: false, error: 'Invalid scenario config: missing id or name' }
    }

    return { success: true, config, resolvedDir: dir }
  })

  safeIpcHandle('scenario:installFromLocal', async (_event, sourceDir: string) => {
    try {
      const result = resolveInstallSource(sourceDir)
      if (!result.ok) {
        return { success: false, error: describeResolveFailure(sourceDir, result) }
      }

      const resolved = result.source
      const { config, configRel } = resolved
      if (!config.id || !config.name) {
        return { success: false, error: 'Invalid scenario config: missing id or name' }
      }

      // 编程式场景必须携带可执行的 entryPoint 产物：
      // 未构建（entryPoint 指向不存在文件）或入口落在安装时被排除的源码目录，
      // 都会导致安装成功但运行时无法加载，这里提前拦下并给出可执行的修复指引
      const entryRel = (config.entryPoint || '').replace(/^\.\//, '')
      if (!isDeclarativeScenario(config) && entryRel) {
        if (!fs.existsSync(path.join(resolved.dir, entryRel))) {
          return {
            success: false,
            error:
              `entryPoint "${config.entryPoint}" does not exist in ${resolved.dir}. ` +
              'Run "npm run build" and select the project root or the dist directory again.',
          }
        }
        const entryTopDir = entryRel.split(/[\\/]/)[0]
        if (COPY_EXCLUDE_DIRS.has(entryTopDir)) {
          return {
            success: false,
            error:
              `entryPoint "${config.entryPoint}" points into the source directory, which is excluded from installation. ` +
              'Run "npm run build" and select the project root containing dist/, or the dist directory itself.',
          }
        }
      }

      const scenarioId = config.id
      const targetDir = getScenarioDir(scenarioId)

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }

      fs.mkdirSync(targetDir, { recursive: true })

      // 复制解析后的目录（工程根目录会被解析到 dist），避免产物层级错位
      copyDirRecursive(resolved.dir, targetDir)

      // 扁平包（scenario.json 在根）归一化为 config/scenario.json，
      // 否则 getInstalledScenarioDirs / loadScenarioFiles 按规范路径读不到配置
      if (configRel !== CANONICAL_CONFIG_REL) {
        const canonicalPath = path.join(targetDir, CANONICAL_CONFIG_REL)
        if (!fs.existsSync(canonicalPath)) {
          fs.mkdirSync(path.dirname(canonicalPath), { recursive: true })
          // 直接落解析后的配置而不复制源文件：配置可能位于 src/ 等被排除的目录，
          // 复制会因源文件未随安装一起拷贝而失败
          fs.writeFileSync(canonicalPath, JSON.stringify(config, null, 2), 'utf-8')
          logger.agent.info(
            `[ScenarioInstall] Normalized "${configRel}" to "${CANONICAL_CONFIG_REL}" for "${scenarioId}"`
          )
        }
      }

      logger.agent.info(
        `[ScenarioInstall] Copied scenario "${scenarioId}" from ${resolved.dir} to ${targetDir}`
      )

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
      let scenarioDir = getScenarioDir(scenarioId)
      if (!fs.existsSync(scenarioDir)) {
        // 兼容：磁盘目录名可能与 config.id 不一致（市场场景使用市场 ID 命名目录），
        // 按 config.id 扫描匹配实际目录，避免卸载后磁盘目录残留。
        const scenariosDir = getScenariosDir()
        if (fs.existsSync(scenariosDir)) {
          const entries = fs.readdirSync(scenariosDir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const candidate = path.join(scenariosDir, entry.name)
            try {
              const cfg = readScenarioConfig(candidate)
              if (cfg?.id === scenarioId) {
                scenarioDir = candidate
                break
              }
            } catch {
              // ignore
            }
          }
        }
      }
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
      let scenarioDir = getScenarioDir(scenarioId)
      if (!fs.existsSync(scenarioDir)) {
        // 兼容处理：市场场景的磁盘目录名可能使用市场 ID（与 config.id 不一致），
        // 例如目录为 {scenarios}/2j01rqaAydQx 而 config.id 为 education-assistant。
        // 直接按 scenarioId 找不到目录时，扫描场景根目录，按 config.id 匹配实际目录，
        // 确保应用重启后 loadExternalScenarios 能正确加载已安装场景到 scenarioLoader。
        const scenariosDir = getScenariosDir()
        if (fs.existsSync(scenariosDir)) {
          const entries = fs.readdirSync(scenariosDir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const candidate = path.join(scenariosDir, entry.name)
            try {
              const cfg = readScenarioConfig(candidate)
              if (cfg?.id === scenarioId) {
                scenarioDir = candidate
                logger.agent.info(
                  `[ScenarioInstall] Resolved scenario "${scenarioId}" to dir "${candidate}" (dir name differs from config.id)`
                )
                break
              }
            } catch {
              // 单个目录读取失败不影响其他目录扫描
            }
          }
        }
      }
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

      return { success: true, files, config, scenarioDir }
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
    // 备份目录在函数级声明：安装失败时 catch 需要用它把旧版本放回去
    const backupDir = path.join(getScenariosDir(), '.backups', scenarioId)

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

      // 根因修复：市场场景的包内 config.id 可能与市场场景 ID 不一致
      // （例如市场 ID 为 2j01rqaAydQx，config.id 为 education-assistant）。
      // 统一以 config.id 作为场景目录名，确保 registry/loader 的 key 与磁盘目录一致，
      // 否则应用重启后 loadExternalScenarios 按 config.id 找不到目录，场景无法加载到 scenarioLoader。
      let finalScenarioId = scenarioId
      let finalTargetDir = targetDir
      if (config?.id && config.id !== scenarioId) {
        const canonicalDir = getScenarioDir(config.id)
        if (!fs.existsSync(canonicalDir)) {
          fs.renameSync(targetDir, canonicalDir)
          finalScenarioId = config.id
          finalTargetDir = canonicalDir
          logger.agent.info(
            `[ScenarioMarketplace] Renamed scenario dir "${targetDir}" → "${canonicalDir}" to match config.id "${config.id}"`
          )
        } else {
          // 目标目录已存在（如历史安装过），保留原目录并回退用 config.id 作为返回 ID
          finalScenarioId = config.id
          logger.agent.warn(
            `[ScenarioMarketplace] Scenario dir "${canonicalDir}" already exists, keeping "${targetDir}" but returning config.id "${config.id}"`
          )
        }
      }

      if (fs.existsSync(archivePath)) {
        fs.unlinkSync(archivePath)
      }

      return {
        success: true,
        scenarioId: finalScenarioId,
        version,
        targetDir: finalTargetDir,
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

      // 解压或校验中途失败时，把备份的旧版本放回原位。
      // 不做这一步，用户在升级一个已安装场景失败后会连旧版本一起丢掉。
      if (fs.existsSync(backupDir)) {
        try {
          fs.mkdirSync(path.dirname(targetDir), { recursive: true })
          fs.renameSync(backupDir, targetDir)
          logger.agent.info(`[ScenarioMarketplace] Rolled back "${scenarioId}" to the previously installed version`)
        } catch (e) {
          logger.system.warn('Failed to restore backup after install failure:', e)
        }
      }

      const rawError = err instanceof Error ? err.message : String(err)
      let friendlyError = rawError
      if (rawError.includes('SCENARIO_ROOT_NOT_FOUND')) {
        friendlyError =
          'This package does not contain a runnable scenario: config/scenario.json is present but its ' +
          'entryPoint (e.g. dist/index.js) is missing inside the archive. Repackage it with the scenario ' +
          'root as the single top-level directory, then republish.'
      } else if (rawError.includes('TAR_BAD_ARCHIVE') || rawError.includes('Unrecognized archive format')) {
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
    backendUrl?: string,
    accessToken?: string,
  ) => {
    if (!backendUrl || installedScenarios.length === 0) {
      return installedScenarios.map(s => ({
        scenarioId: s.id,
        currentVersion: s.version,
        needsUpdate: false,
      }))
    }

    try {
      const response = await makeHttpRequest(
        `${backendUrl}/api/v1/marketplace/check-updates`,
        'POST',
        { scenarios: installedScenarios },
        // 后端 check-updates 受 JwtAuthGuard 保护：不带 token 会直接 401，
        // 异常被下面的 catch 吞掉后就变成「没有更新」，表现是所有场景永远提示已是最新
        accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      )

      const payload = JSON.parse(response) as
        | UpdatePayload[]
        | { data?: UpdatePayload[]; items?: UpdatePayload[] }

      // 后端统一用 { success, data } 信封返回，data 才是更新列表。
      // 直接对信封调用 map 会抛 TypeError，被下面的 catch 吞成「无更新」，
      // 结果是任何新版本都检测不到——市场里已发版、客户端永远提示已是最新。
      const updates: UpdatePayload[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.items)
            ? payload.items
            : []

      return updates.map(u => ({
        scenarioId: u.scenarioId,
        scenarioName: u.scenarioName,
        scenarioNameZh: u.scenarioNameZh,
        scenarioIcon: u.scenarioIcon,
        currentVersion: u.currentVersion,
        latestVersion: u.latestVersion,
        changelog: u.changelog,
        minAppVersion: u.minAppVersion,
        fileSize: u.fileSize,
        needsUpdate: true,
      }))
    } catch (err) {
      logger.agent.warn(`[ScenarioMarketplace] Check updates failed: ${err instanceof Error ? err.message : String(err)}`)
      return installedScenarios.map(s => ({
        scenarioId: s.id,
        currentVersion: s.version,
        needsUpdate: false,
      }))
    }
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

      // 与安装流程一致：config.id 与目录名不一致时统一目录名，保证重启后按 config.id 可找到场景
      let finalScenarioId = scenarioId
      let finalTargetDir = targetDir
      if (config?.id && config.id !== scenarioId) {
        const canonicalDir = getScenarioDir(config.id)
        if (!fs.existsSync(canonicalDir)) {
          fs.renameSync(targetDir, canonicalDir)
          finalScenarioId = config.id
          finalTargetDir = canonicalDir
          logger.agent.info(
            `[ScenarioMarketplace] Normalized update dir for "${config.id}" → "${canonicalDir}"`
          )
        } else {
          finalScenarioId = config.id
          logger.agent.warn(
            `[ScenarioMarketplace] Scenario dir "${canonicalDir}" already exists for update, returning config.id "${config.id}"`
          )
        }
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
        scenarioId: finalScenarioId,
        version,
        targetDir: finalTargetDir,
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
      const { marketplaceAPI } = await import('../../../scenario-system/marketplace')
      return await marketplaceAPI.search(query, page, pageSize)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Search failed:', err)
      return { total: 0, page: 1, pageSize: 20, scenarios: [] }
    }
  })

  safeIpcHandle('scenario:marketplaceFeatured', async () => {
    try {
      const { marketplaceAPI } = await import('../../../scenario-system/marketplace')
      return await marketplaceAPI.getFeatured()
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get featured failed:', err)
      return []
    }
  })

  safeIpcHandle('scenario:marketplaceDetails', async (_event, scenarioId: string) => {
    try {
      const { marketplaceAPI } = await import('../../../scenario-system/marketplace')
      return await marketplaceAPI.getDetails(scenarioId)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get details failed:', err)
      return null
    }
  })

  safeIpcHandle('scenario:marketplaceCategories', async () => {
    try {
      const { marketplaceAPI } = await import('../../../scenario-system/marketplace')
      return await marketplaceAPI.getCategories()
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Get categories failed:', err)
      return []
    }
  })

  safeIpcHandle('scenario:marketplaceDownload', async (_event, scenarioId: string) => {
    try {
      const { marketplaceAPI } = await import('../../../scenario-system/marketplace')
      return await marketplaceAPI.download(scenarioId)
    } catch (err) {
      logger.agent.error('[ScenarioMarketplace] Download failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.ipc.info('[ScenarioMarketplace] IPC handlers registered')
}
