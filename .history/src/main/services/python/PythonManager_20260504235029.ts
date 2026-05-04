/**
 * Python 环境管理器
 *
 * 功能：
 * - 自动检测系统 Python
 * - 自动下载安装 uv 工具
 * - 通过 uv 安装 Python 运行时
 * - 创建虚拟环境并安装基础包（debugpy、pylint）
 * - 提供统一的 Python/uv 路径给各消费方
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import Store from 'electron-store'

const store = new Store({ name: 'python-config' })

const CONFIG_KEY_PYTHON_PATH = 'pythonPath'
const CONFIG_KEY_UV_PATH = 'uvPath'
const CONFIG_KEY_VENV_DIR = 'venvDir'
const CONFIG_KEY_STATUS = 'status'

const DEFAULT_PYTHON_DIR = path.join(app.getPath('userData'), 'python-env')
const PYTHON_VERSION = '3.12'
const BASE_PACKAGES = ['debugpy', 'pylint']

const UV_DOWNLOAD_URLS: Record<string, string> = {
  'darwin-arm64': 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz',
  'win32-x64': 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip',
  'linux-x64': 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz',
}

export interface PythonStatus {
  ready: boolean
  pythonPath: string | null
  uvPath: string | null
  source: 'system' | 'managed' | 'none'
  version: string | null
  venvDir: string | null
  installedPackages: string[]
  error?: string
}

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function getUvDownloadUrl(): string | null {
  return UV_DOWNLOAD_URLS[getPlatformKey()] || null
}

function getCommonBinaryDirs(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Python312',
      'C:\\Python311',
      'C:\\Python310',
      'C:\\Python39',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310'),
    ]
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    '/usr/bin',
    '/bin',
  ]
}

function getAugmentedPathEnv(): string {
  const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const merged = [...existing, ...getCommonBinaryDirs()]
  return Array.from(new Set(merged)).join(path.delimiter)
}

function resolveCommandPath(cmd: string): string | null {
  if (!cmd) return null
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd

  const searchDirs = getAugmentedPathEnv().split(path.delimiter).filter(Boolean)
  const executableCandidates = process.platform === 'win32'
    ? Array.from(new Set([cmd, `${cmd}.cmd`, `${cmd}.exe`, `${cmd}.bat`]))
    : [cmd]

  for (const dir of searchDirs) {
    for (const candidate of executableCandidates) {
      const fullPath = path.join(dir, candidate)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }
  return null
}

function execCommandAsync(command: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout || 60000,
      env: { ...process.env, PATH: getAugmentedPathEnv() },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }))
  })
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const file = fs.createWriteStream(destPath)
    const request = (targetUrl: string) => {
      https.get(targetUrl, { timeout: 120000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            res.resume()
            request(redirectUrl)
            return
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        fs.unlinkSync(destPath)
        reject(err)
      }).on('timeout', () => {
        fs.unlinkSync(destPath)
        reject(new Error('Download timeout'))
      })
    }
    request(url)
  })
}

function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    if (archivePath.endsWith('.zip')) {
      const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { timeout: 60000 })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`unzip failed with code ${code}`))
      })
      proc.on('error', reject)
    } else {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { timeout: 60000 })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar failed with code ${code}`))
      })
      proc.on('error', reject)
    }
  })
}

class PythonManager {
  private static instance: PythonManager | null = null
  private _status: PythonStatus = {
    ready: false,
    pythonPath: null,
    uvPath: null,
    source: 'none',
    version: null,
    venvDir: null,
    installedPackages: [],
  }
  private initializing = false

  private constructor() {}

  static getInstance(): PythonManager {
    if (!PythonManager.instance) {
      PythonManager.instance = new PythonManager()
    }
    return PythonManager.instance
  }

  get status(): PythonStatus {
    return { ...this._status }
  }

  getPythonPath(): string | null {
    return this._status.pythonPath
  }

  getUvPath(): string | null {
    return this._status.uvPath
  }

  async ensureReady(): Promise<PythonStatus> {
    if (this._status.ready) return this.status

    if (this.initializing) {
      while (this.initializing) {
        await new Promise((r) => setTimeout(r, 200))
      }
      return this.status
    }

    this.initializing = true
    try {
      await this._ensureReady()
    } catch (err) {
      logger.system.error('[PythonManager] ensureReady failed:', err)
      this._status.error = toAppError(err).message
    } finally {
      this.initializing = false
    }
    return this.status
  }

  private async _ensureReady(): Promise<void> {
    logger.system.info('[PythonManager] Starting Python environment setup...')

    const cachedPython = store.get(CONFIG_KEY_PYTHON_PATH) as string | undefined
    if (cachedPython && fs.existsSync(cachedPython)) {
      const version = await this._getPythonVersion(cachedPython)
      if (version) {
        logger.system.info(`[PythonManager] Found cached Python: ${cachedPython} (${version})`)
        this._status = {
          ready: true,
          pythonPath: cachedPython,
          uvPath: (store.get(CONFIG_KEY_UV_PATH) as string) || null,
          source: path.dirname(cachedPython).includes(DEFAULT_PYTHON_DIR) ? 'managed' : 'system',
          version,
          venvDir: (store.get(CONFIG_KEY_VENV_DIR) as string) || null,
          installedPackages: [],
        }
        return
      }
      store.delete(CONFIG_KEY_PYTHON_PATH)
    }

    const systemPython = await this._detectSystemPython()
    if (systemPython) {
      logger.system.info(`[PythonManager] Found system Python: ${systemPython.path} (${systemPython.version})`)
      this._status.pythonPath = systemPython.path
      this._status.version = systemPython.version
      this._status.source = 'system'
      this._status.ready = true
      store.set(CONFIG_KEY_PYTHON_PATH, systemPython.path)
      await this._ensureVenv(systemPython.path)
      return
    }

    logger.system.info('[PythonManager] No system Python found, attempting managed installation...')

    const uvPath = await this._ensureUv()
    if (uvPath) {
      this._status.uvPath = uvPath
      store.set(CONFIG_KEY_UV_PATH, uvPath)

      const managedPython = await this._installPythonViaUv(uvPath)
      if (managedPython) {
        this._status.pythonPath = managedPython
        this._status.source = 'managed'
        this._status.ready = true
        store.set(CONFIG_KEY_PYTHON_PATH, managedPython)
        const version = await this._getPythonVersion(managedPython)
        this._status.version = version
        await this._ensureVenv(managedPython)
        return
      }
    }

    logger.system.warn('[PythonManager] Python environment setup failed - Python features will be unavailable')
    this._status.ready = false
    this._status.source = 'none'
    this._status.error = 'Python not found and auto-installation failed. Please install Python manually.'
  }

  private async _detectSystemPython(): Promise<{ path: string; version: string } | null> {
    const commands = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python']

    for (const cmd of commands) {
      const resolved = resolveCommandPath(cmd)
      if (!resolved) continue

      const version = await this._getPythonVersion(resolved)
      if (version) {
        const major = parseInt(version.split('.')[0], 10)
        if (major >= 3) return { path: resolved, version }
      }
    }
    return null
  }

  private async _getPythonVersion(pythonPath: string): Promise<string | null> {
    try {
      const { stdout, code } = await execCommandAsync(pythonPath, ['--version'], { timeout: 10000 })
      if (code === 0 && stdout) {
        const match = stdout.match(/Python\s+(\d+\.\d+\.\d+)/i)
        return match ? match[1] : null
      }
    } catch {
      // ignore
    }
    return null
  }

  private async _ensureUv(): Promise<string | null> {
    const systemUv = resolveCommandPath('uv')
    if (systemUv) {
      logger.system.info(`[PythonManager] Found system uv: ${systemUv}`)
      return systemUv
    }

    const cachedUv = store.get(CONFIG_KEY_UV_PATH) as string | undefined
    if (cachedUv && fs.existsSync(cachedUv)) {
      logger.system.info(`[PythonManager] Found cached uv: ${cachedUv}`)
      return cachedUv
    }

    return this._installUv()
  }

  private async _installUv(): Promise<string | null> {
    const url = getUvDownloadUrl()
    if (!url) {
      logger.system.error(`[PythonManager] No uv download URL for platform: ${getPlatformKey()}`)
      return null
    }

    logger.system.info(`[PythonManager] Downloading uv from: ${url}`)

    const tmpDir = path.join(DEFAULT_PYTHON_DIR, 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
    const archivePath = path.join(tmpDir, `uv-download${ext}`)
    const extractDir = path.join(tmpDir, 'uv-extract')

    try {
      await downloadFile(url, archivePath)
      logger.system.info('[PythonManager] uv download complete, extracting...')

      await extractArchive(archivePath, extractDir)

      const uvBinary = this._findUvBinary(extractDir)
      if (!uvBinary) {
        logger.system.error('[PythonManager] uv binary not found in extracted archive')
        return null
      }

      const uvDestDir = path.join(DEFAULT_PYTHON_DIR, 'bin')
      if (!fs.existsSync(uvDestDir)) fs.mkdirSync(uvDestDir, { recursive: true })

      const uvDest = path.join(uvDestDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
      fs.copyFileSync(uvBinary, uvDest)

      if (process.platform !== 'win32') {
        fs.chmodSync(uvDest, 0o755)
      }

      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }

      logger.system.info(`[PythonManager] uv installed at: ${uvDest}`)
      return uvDest
    } catch (err) {
      logger.system.error('[PythonManager] uv installation failed:', err)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return null
    }
  }

  private _findUvBinary(searchDir: string): string | null {
    const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv'

    const directPath = path.join(searchDir, uvName)
    if (fs.existsSync(directPath)) return directPath

    const entries = fs.readdirSync(searchDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(searchDir, entry.name, uvName)
        if (fs.existsSync(subPath)) return subPath

        const subEntries = fs.readdirSync(path.join(searchDir, entry.name), { withFileTypes: true })
        for (const subEntry of subEntries) {
          if (subEntry.isDirectory()) {
            const deepPath = path.join(searchDir, entry.name, subEntry.name, uvName)
            if (fs.existsSync(deepPath)) return deepPath
          }
        }
      }
    }
    return null
  }

  private async _installPythonViaUv(uvPath: string): Promise<string | null> {
    logger.system.info(`[PythonManager] Installing Python ${PYTHON_VERSION} via uv...`)

    const pythonInstallDir = path.join(DEFAULT_PYTHON_DIR, 'python')
    if (!fs.existsSync(pythonInstallDir)) fs.mkdirSync(pythonInstallDir, { recursive: true })

    try {
      const { stdout, stderr, code } = await execCommandAsync(
        uvPath,
        ['python', 'install', PYTHON_VERSION, '--preview', '--install-dir', pythonInstallDir],
        { timeout: 300000 }
      )

      if (code !== 0) {
        logger.system.error('[PythonManager] uv python install failed:', { stdout, stderr })
        return null
      }

      const pythonBin = this._findPythonInDir(pythonInstallDir)
      if (pythonBin) {
        logger.system.info(`[PythonManager] Python installed at: ${pythonBin}`)
        return pythonBin
      }

      logger.system.error('[PythonManager] Python binary not found after uv install')
      return null
    } catch (err) {
      logger.system.error('[PythonManager] uv python install error:', err)
      return null
    }
  }

  private _findPythonInDir(searchDir: string): string | null {
    const pythonName = process.platform === 'win32' ? 'python.exe' : 'python3'
    const pythonAltName = process.platform === 'win32' ? 'python3.exe' : 'python'

    const candidates = [pythonName, pythonAltName]

    const findRecursive = (dir: string, depth: number): string | null => {
      if (depth > 4) return null
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (candidates.includes(entry.name) && !entry.isDirectory()) {
            return path.join(dir, entry.name)
          }
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const result = findRecursive(path.join(dir, entry.name), depth + 1)
            if (result) return result
          }
        }
      } catch {
        // ignore
      }
      return null
    }

    return findRecursive(searchDir, 0)
  }

  private async _ensureVenv(pythonPath: string): Promise<void> {
    const venvDir = path.join(DEFAULT_PYTHON_DIR, 'venv')

    if (fs.existsSync(path.join(venvDir, 'pyvenv.cfg'))) {
      logger.system.info(`[PythonManager] venv already exists at: ${venvDir}`)
      this._status.venvDir = venvDir
      store.set(CONFIG_KEY_VENV_DIR, venvDir)

      const venvPython = this._getVenvPython(venvDir)
      if (venvPython && fs.existsSync(venvPython)) {
        this._status.pythonPath = venvPython
        store.set(CONFIG_KEY_PYTHON_PATH, venvPython)
        await this._installBasePackages(venvDir)
      }
      return
    }

    logger.system.info(`[PythonManager] Creating venv at: ${venvDir}`)
    try {
      const { code, stderr } = await execCommandAsync(pythonPath, ['-m', 'venv', venvDir], { timeout: 60000 })
      if (code !== 0) {
        logger.system.error('[PythonManager] venv creation failed:', stderr)
        return
      }

      this._status.venvDir = venvDir
      store.set(CONFIG_KEY_VENV_DIR, venvDir)

      const venvPython = this._getVenvPython(venvDir)
      if (venvPython && fs.existsSync(venvPython)) {
        this._status.pythonPath = venvPython
        store.set(CONFIG_KEY_PYTHON_PATH, venvPython)
      }

      await this._installBasePackages(venvDir)
    } catch (err) {
      logger.system.error('[PythonManager] venv creation error:', err)
    }
  }

  private _getVenvPython(venvDir: string): string | null {
    if (process.platform === 'win32') {
      return path.join(venvDir, 'Scripts', 'python.exe')
    }
    return path.join(venvDir, 'bin', 'python3') || path.join(venvDir, 'bin', 'python')
  }

  private _getVenvPip(venvDir: string): string | null {
    if (process.platform === 'win32') {
      const pipPath = path.join(venvDir, 'Scripts', 'pip.exe')
      return fs.existsSync(pipPath) ? pipPath : null
    }
    const pip3 = path.join(venvDir, 'bin', 'pip3')
    if (fs.existsSync(pip3)) return pip3
    const pip = path.join(venvDir, 'bin', 'pip')
    return fs.existsSync(pip) ? pip : null
  }

  private async _installBasePackages(venvDir: string): Promise<void> {
    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath) {
      logger.system.error('[PythonManager] pip not found in venv')
      return
    }

    logger.system.info(`[PythonManager] Installing base packages: ${BASE_PACKAGES.join(', ')}`)
    try {
      const { code, stderr } = await execCommandAsync(
        pipPath,
        ['install', '--quiet', ...BASE_PACKAGES],
        { timeout: 120000 }
      )
      if (code !== 0) {
        logger.system.error('[PythonManager] pip install failed:', stderr)
        return
      }
      this._status.installedPackages = [...BASE_PACKAGES]
      logger.system.info('[PythonManager] Base packages installed successfully')
    } catch (err) {
      logger.system.error('[PythonManager] pip install error:', err)
    }
  }

  async installPackage(packageName: string): Promise<{ success: boolean; error?: string }> {
    const venvDir = this._status.venvDir
    if (!venvDir) return { success: false, error: 'No venv available' }

    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath) return { success: false, error: 'pip not found in venv' }

    try {
      const { code, stderr } = await execCommandAsync(pipPath, ['install', '--quiet', packageName], { timeout: 120000 })
      if (code !== 0) return { success: false, error: stderr }

      if (!this._status.installedPackages.includes(packageName)) {
        this._status.installedPackages.push(packageName)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  }

  private _extractPythonDependencies(scriptContent: string): string[] {
    const PYTHON_IMPORT_TO_PACKAGE: Record<string, string> = {
      pandas: 'pandas', pd: 'pandas',
      numpy: 'numpy', np: 'numpy',
      openpyxl: 'openpyxl',
      xlrd: 'xlrd', xlwt: 'xlwt',
      matplotlib: 'matplotlib', plt: 'matplotlib',
      seaborn: 'seaborn',
      scipy: 'scipy',
      sklearn: 'scikit-learn',
      requests: 'requests',
      bs4: 'beautifulsoup4',
      PIL: 'pillow',
      plotly: 'plotly',
      sympy: 'sympy',
      statsmodels: 'statsmodels',
      sqlalchemy: 'sqlalchemy',
      psycopg2: 'psycopg2-binary',
    }
    const deps = new Set<string>()
    const importRegex = /^\s*(?:from|import)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(scriptContent)) !== null) {
      const pkg = PYTHON_IMPORT_TO_PACKAGE[match[1]]
      if (pkg) deps.add(pkg)
    }
    return Array.from(deps)
  }

  private async _ensureDependencies(scriptContent: string): Promise<void> {
    const deps = this._extractPythonDependencies(scriptContent)
    if (deps.length === 0) return

    for (const dep of deps) {
      if (!this._status.installedPackages.includes(dep)) {
        logger.system.info(`[PythonManager] Auto-installing dependency: ${dep}`)
        const result = await this.installPackage(dep)
        if (!result.success) {
          logger.system.warn(`[PythonManager] Failed to install ${dep}: ${result.error}`)
        }
      }
    }
  }

  async executeScript(params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    const { scriptPath, args = [], cwd, timeout = 120000 } = params

    if (!fs.existsSync(scriptPath)) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: `Script file not found: ${scriptPath}` }
    }

    const pythonPath = this._status.pythonPath
    if (pythonPath && fs.existsSync(pythonPath)) {
      try {
        const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
        await this._ensureDependencies(scriptContent)
      } catch (err) {
        logger.system.warn('[PythonManager] Failed to scan dependencies:', err)
      }

      logger.system.info(`[PythonManager] Executing script via venv python: ${scriptPath}`)
      try {
        const result = await execCommandAsync(
          pythonPath,
          [scriptPath, ...args],
          { cwd: cwd || path.dirname(scriptPath), timeout }
        )
        return {
          success: result.code === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.code,
          error: result.code !== 0 ? result.stderr : undefined,
        }
      } catch (err) {
        const errMsg = toAppError(err).message
        logger.system.warn('[PythonManager] venv python execution failed, falling back to uv run:', errMsg)
      }
    }

    const uvPath = this._status.uvPath || resolveCommandPath('uv')
    if (!uvPath) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: 'No Python runtime available. Please ensure Python environment is set up.' }
    }

    logger.system.info(`[PythonManager] Executing script via uv run: ${scriptPath}`)
    try {
      const result = await execCommandAsync(
        uvPath,
        ['run', '--script', scriptPath, ...args],
        { cwd: cwd || path.dirname(scriptPath), timeout }
      )

      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        error: result.code !== 0 ? result.stderr : undefined,
      }
    } catch (err) {
      const errMsg = toAppError(err).message
      logger.system.error('[PythonManager] Script execution failed:', errMsg)
      return { success: false, stdout: '', stderr: errMsg, exitCode: null, error: errMsg }
    }
  }

  async executeInlineScript(params: {
    script: string
    dependencies?: string[]
    args?: string[]
    cwd?: string
    timeout?: number
  }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string; tempFile?: string }> {
    const { script, dependencies = [], args = [], cwd, timeout = 120000 } = params

    const baseDir = cwd || DEFAULT_PYTHON_DIR
    const tempDir = path.join(baseDir, '.aweeclaw', 'python-temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const tempFile = path.join(tempDir, `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`)

    const pythonPath = this._status.pythonPath
    if (pythonPath && fs.existsSync(pythonPath)) {
      try {
        fs.writeFileSync(tempFile, script, 'utf-8')

        await this._ensureDependencies(script)
        for (const dep of dependencies) {
          if (!this._status.installedPackages.includes(dep)) {
            logger.system.info(`[PythonManager] Auto-installing explicit dependency: ${dep}`)
            const result = await this.installPackage(dep)
            if (!result.success) {
              logger.system.warn(`[PythonManager] Failed to install ${dep}: ${result.error}`)
            }
          }
        }

        logger.system.info(`[PythonManager] Executing inline script via venv python: ${tempFile}`)
        try {
          const result = await execCommandAsync(
            pythonPath,
            [tempFile, ...args],
            { cwd: cwd || path.dirname(tempFile), timeout }
          )

          return {
            success: result.code === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
            error: result.code !== 0 ? result.stderr : undefined,
            tempFile,
          }
        } catch (err) {
          const errMsg = toAppError(err).message
          logger.system.warn('[PythonManager] venv python inline execution failed, falling back to uv run:', errMsg)
        }
      } finally {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
        } catch { /* ignore */ }
      }
    }

    const uvPath = this._status.uvPath || resolveCommandPath('uv')
    if (!uvPath) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: 'No Python runtime available. Please ensure Python environment is set up.' }
    }

    const fallbackTempFile = path.join(tempDir, `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`)

    try {
      let scriptContent = script
      if (dependencies.length > 0) {
        const depComment = `# /// script\n# dependencies = [${dependencies.map(d => `"${d}"`).join(', ')}]\n# ///\n`
        scriptContent = depComment + script
      }

      fs.writeFileSync(fallbackTempFile, scriptContent, 'utf-8')

      logger.system.info(`[PythonManager] Executing inline script via uv run: ${fallbackTempFile}`)

      const result = await execCommandAsync(
        uvPath,
        ['run', '--script', fallbackTempFile, ...args],
        { cwd: cwd || path.dirname(fallbackTempFile), timeout }
      )

      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        error: result.code !== 0 ? result.stderr : undefined,
        tempFile: fallbackTempFile,
      }
    } catch (err) {
      const errMsg = toAppError(err).message
      logger.system.error('[PythonManager] Inline script execution failed:', errMsg)
      return { success: false, stdout: '', stderr: errMsg, exitCode: null, error: errMsg, tempFile: fallbackTempFile }
    } finally {
      try {
        if (fs.existsSync(fallbackTempFile)) fs.unlinkSync(fallbackTempFile)
      } catch { /* ignore */ }
    }
  }

  async reinstall(): Promise<PythonStatus> {
    logger.system.info('[PythonManager] Reinstalling Python environment...')

    store.delete(CONFIG_KEY_PYTHON_PATH)
    store.delete(CONFIG_KEY_UV_PATH)
    store.delete(CONFIG_KEY_VENV_DIR)
    store.delete(CONFIG_KEY_STATUS)

    try {
      if (fs.existsSync(DEFAULT_PYTHON_DIR)) {
        fs.rmSync(DEFAULT_PYTHON_DIR, { recursive: true, force: true })
      }
    } catch (err) {
      logger.system.warn('[PythonManager] Failed to clean python-env dir:', err)
    }

    this._status = {
      ready: false,
      pythonPath: null,
      uvPath: null,
      source: 'none',
      version: null,
      venvDir: null,
      installedPackages: [],
    }

    return this.ensureReady()
  }

  setCustomPythonPath(customPath: string | null): void {
    if (customPath && fs.existsSync(customPath)) {
      store.set(CONFIG_KEY_PYTHON_PATH, customPath)
      this._status.pythonPath = customPath
      this._status.source = 'system'
      this._status.ready = true
      this._getPythonVersion(customPath).then((v) => {
        this._status.version = v
      })
    } else if (customPath === null) {
      store.delete(CONFIG_KEY_PYTHON_PATH)
      this._status.pythonPath = null
      this._status.ready = false
      this._status.source = 'none'
    }
  }
}

export const pythonManager = PythonManager.getInstance()
