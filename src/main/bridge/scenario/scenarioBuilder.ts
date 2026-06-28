/**
 * 场景开发助手（scenario-builder）主进程 IPC 桥接
 *
 * 提供场景开发助手所需的主进程能力：
 * - scenario-builder:createProjectFiles — 在文件系统创建项目骨架
 * - scenario-builder:readFile / writeFile — 项目文件读写
 * - scenario-builder:validate / build / pack — 校验/构建/打包（内嵌，不依赖外部 CLI）
 * - scenario-builder:tryRunStart / tryRunStop — 试运行调试预览
 * - scenario:uninstall — 卸载已安装场景
 * - developer:checkAuth / publishScenario — 开发者中心认证与发布
 *
 * 设计要点：
 * - 全部能力内嵌实现，**不依赖 aweeclaw-scenario-cli 外部二进制**
 * - 复用 scenario-system/cli 中已有的 validateScenarioPackage / packScenario / publishScenario
 * - 文件操作严格限定在 workspacePath 与项目 localPath 范围内，防止越权
 */

import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import {
  validateScenarioPackage,
  packScenario,
  type PackResult,
} from '../../../scenario-system/cli'
import type { DeclarativeScenarioConfig } from '@shared/protocols/scenario-declarative'

// ==========================================
// 常量
// ==========================================

const SCENARIOS_DIR_NAME = 'scenarios'

// ==========================================
// 辅助函数
// ==========================================

function getScenariosDir(): string {
  return path.join(app.getPath('userData'), SCENARIOS_DIR_NAME)
}

function getScenarioDir(scenarioId: string): string {
  return path.join(getScenariosDir(), scenarioId)
}

/**
 * 路径安全校验：禁止路径穿越（..）和绝对路径逃逸
 */
function safeJoinPath(base: string, target: string): string {
  if (!target || typeof target !== 'string') {
    throw new Error('Invalid path: target is empty')
  }
  if (path.isAbsolute(target)) {
    throw new Error(`Invalid path: absolute path not allowed: ${target}`)
  }
  const joined = path.resolve(base, target)
  if (!joined.startsWith(path.resolve(base) + path.sep) && joined !== path.resolve(base)) {
    throw new Error(`Path escape detected: ${target}`)
  }
  return joined
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) return defaultValue
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return defaultValue
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ==========================================
// 项目骨架生成
// ==========================================

interface CreateProjectFilesParams {
  localPath: string
  scenarioId: string
  name: string
  nameZh: string
  description?: string
  descriptionZh?: string
  author?: string
  version?: string
  category?: string
  type: 'declarative' | 'programmatic'
}

function buildScenarioConfig(p: CreateProjectFilesParams): DeclarativeScenarioConfig {
  return {
    id: p.scenarioId,
    name: p.name,
    nameZh: p.nameZh,
    version: p.version || '1.0.0',
    author: p.author || 'developer',
    category: (p.category as DeclarativeScenarioConfig['category']) || 'custom',
    icon: 'Package',
    description: p.description || `Custom scenario: ${p.name}`,
    descriptionZh: p.descriptionZh || `自定义场景：${p.nameZh}`,
    identity: {
      systemPromptFile: 'prompts/system.md',
    },
    capabilities: {
      builtinTools: ['read_file', 'write_file', 'run_command', 'web_search'],
      modes: [
        {
          id: 'chat',
          label: 'Quick',
          labelZh: '快速',
          icon: 'Zap',
          description: 'Quick mode for most situations',
          descriptionZh: '适用于大部分场景的快速模式',
          toolPolicy: { enabled: true, requireApproval: false },
        },
        {
          id: 'agent',
          label: 'Think',
          labelZh: '思考',
          icon: 'Brain',
          description: 'Think mode for harder problems',
          descriptionZh: '适用于复杂问题的思考模式',
          toolPolicy: { enabled: true, requireApproval: true },
        },
      ],
      contextTypes: [
        { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
        { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
      ],
      outputFormats: ['text', 'markdown'],
    },
    ui: {
      layout: 'chat-centric',
      panels: ['chat'],
    },
  } as DeclarativeScenarioConfig
}

/**
 * 在文件系统创建项目骨架（含 config/scenario.json、prompts/system.md、db 脚本占位）
 */
function createProjectScaffold(params: CreateProjectFilesParams): void {
  const { localPath } = params
  ensureDir(localPath)

  // 1. config/scenario.json
  const configDir = path.join(localPath, 'config')
  ensureDir(configDir)
  const config = buildScenarioConfig(params)
  writeJsonFile(path.join(configDir, 'scenario.json'), config)

  // 2. prompts/system.md
  const promptsDir = path.join(localPath, 'prompts')
  ensureDir(promptsDir)
  const systemPrompt = [
    `# ${params.nameZh || params.name} 系统提示词`,
    '',
    `你是 **${params.nameZh || params.name}** 场景的 AI 助手。`,
    '',
    '## 核心职责',
    `- ${params.descriptionZh || params.description || '帮助用户完成任务'}`,
    '- 提供专业、准确、高效的服务',
    '',
    '## 行为准则',
    '- 遵循场景配置的工作流程',
    '- 主动澄清不明确的需求',
    '- 遵守安全规则，不执行危险操作',
    '',
    '## 输出规范',
    '- 使用结构化格式（标题、列表）',
    '- 复杂内容使用表格或代码块',
    '- 保持简洁，避免冗余',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(promptsDir, 'system.md'), systemPrompt, 'utf-8')

  // 3. db/install.sql + uninstall.sql 占位
  const dbDir = path.join(localPath, 'db')
  ensureDir(dbDir)
  const installSql = [
    `-- ${params.scenarioId} 场景安装脚本`,
    `-- 在场景首次激活时执行，创建所需的表结构`,
    '',
    `CREATE TABLE IF NOT EXISTS ${params.scenarioId.replace(/-/g, '_')}_data (`,
    "  id TEXT PRIMARY KEY,",
    "  data TEXT NOT NULL,",
    "  created_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ');',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dbDir, 'install.sql'), installSql, 'utf-8')

  const uninstallSql = [
    `-- ${params.scenarioId} 场景卸载脚本`,
    `-- 在场景卸载时执行，清理表结构`,
    '',
    `DROP TABLE IF EXISTS ${params.scenarioId.replace(/-/g, '_')}_data;`,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dbDir, 'uninstall.sql'), uninstallSql, 'utf-8')

  // 4. README.md
  const readme = [
    `# ${params.nameZh || params.name}`,
    '',
    `> ${params.descriptionZh || params.description || ''}`,
    '',
    '## 场景信息',
    `- 场景 ID: \`${params.scenarioId}\``,
    `- 版本: \`${params.version || '1.0.0'}\``,
    `- 作者: \`${params.author || 'developer'}\``,
    `- 类型: \`${params.type}\``,
    '',
    '## 目录结构',
    '```',
    'config/scenario.json   场景配置清单',
    'prompts/system.md      系统提示词',
    'db/install.sql         安装脚本',
    'db/uninstall.sql       卸载脚本',
    '```',
    '',
    '## 开发流程',
    '1. 编辑 `config/scenario.json` 配置场景元数据',
    '2. 编辑 `prompts/system.md` 编写系统提示词',
    '3. 编辑 `db/install.sql` 设计数据库表',
    '4. 使用场景开发助手的构建/校验功能测试',
    '5. 通过安装功能部署到本地客户端测试',
    '6. 通过发布功能上传到开发者中心',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(localPath, 'README.md'), readme, 'utf-8')

  // 5. .gitignore（如果项目目录在工作区下，避免误提交构建产物）
  fs.writeFileSync(
    path.join(localPath, '.gitignore'),
    ['dist/', '*.log', '.DS_Store', ''].join('\n'),
    'utf-8',
  )
}

// ==========================================
// 文件读写
// ==========================================

interface ReadFileParams {
  projectPath: string
  relativePath: string
}

interface WriteFileParams {
  projectPath: string
  relativePath: string
  content: string
  createDirs?: boolean
}

// ==========================================
// 内嵌构建/打包
// ==========================================

interface ValidateParams {
  projectPath: string
}

interface PackParams {
  projectPath: string
  outputPath?: string
}

interface BuildParams {
  projectPath: string
}

/**
 * 递归读取目录下所有文件，返回相对路径 → 内容的映射
 */
function readProjectFiles(projectPath: string, maxFileSize = 1024 * 1024): Record<string, string> {
  const files: Record<string, string> = {}
  if (!fs.existsSync(projectPath)) return files

  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name

      // 跳过 dist/、node_modules/、.git/
      if (entry.isDirectory()) {
        if (['dist', 'node_modules', '.git'].includes(entry.name)) continue
        walk(fullPath, relPath)
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath)
        if (stat.size > maxFileSize) {
          logger.system.warn(`[ScenarioBuilder] Skipping large file: ${relPath} (${stat.size} bytes)`)
          continue
        }
        try {
          files[relPath] = fs.readFileSync(fullPath, 'utf-8')
        } catch (e) {
          logger.system.warn(`[ScenarioBuilder] Failed to read file ${relPath}:`, e)
        }
      }
    }
  }
  walk(projectPath, '')
  return files
}

/**
 * 读取 config/scenario.json
 */
function readScenarioConfig(projectPath: string): DeclarativeScenarioConfig {
  const configPath = path.join(projectPath, 'config', 'scenario.json')
  if (!fs.existsSync(configPath)) {
    throw new Error('config/scenario.json not found in project directory')
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DeclarativeScenarioConfig
}

/**
 * 内嵌打包：使用 scenario-system/cli 的 packScenario，输出 .aweeclawpkg 文件
 */
function doPack(projectPath: string, outputPath?: string): {
  success: boolean
  packagePath?: string
  size?: number
  hash?: string
  error?: string
} {
  try {
    const config = readScenarioConfig(projectPath)
    const files = readProjectFiles(projectPath)
    const result: PackResult = packScenario(config, files)
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Pack failed' }
    }

    // 输出到文件
    const pkgDir = path.join(projectPath, 'dist')
    ensureDir(pkgDir)
    const fileName = `${config.id}-${config.version}.aweeclawpkg`
    const finalPath = outputPath || path.join(pkgDir, fileName)
    ensureDir(path.dirname(finalPath))

    // 解码 base64 写入（避免大字符串通过 IPC 损耗）
    const buffer = Buffer.from(result.data, 'base64')
    fs.writeFileSync(finalPath, buffer)

    logger.agent.info(`[ScenarioBuilder] Packed scenario "${config.id}" → ${finalPath} (${result.size} bytes)`)

    return {
      success: true,
      packagePath: finalPath,
      size: result.size,
      hash: result.hash,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 内嵌构建：声明式场景只需校验 + 生成 dist/；
 * 编程式场景额外执行 esbuild bundle（如项目存在 scripts/ 入口）
 */
async function doBuild(projectPath: string): Promise<{
  success: boolean
  output: string
  error?: string
}> {
  const output: string[] = []
  try {
    // 1. 校验
    const config = readScenarioConfig(projectPath)
    const files = readProjectFiles(projectPath)
    const validation = validateScenarioPackage(config, files)
    output.push(`[validate] ${validation.valid ? 'PASSED' : 'FAILED'}`)
    if (validation.errors.length > 0) {
      validation.errors.forEach(e => output.push(`  ERROR: ${e.path}: ${e.message}`))
      return { success: false, output: output.join('\n') }
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => output.push(`  WARN:  ${w.path}: ${w.message}`))
    }

    // 2. 生成 dist/
    const distDir = path.join(projectPath, 'dist')
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true, force: true })
    }
    ensureDir(distDir)

    // 3. 拷贝所有源文件到 dist/（保留目录结构）
    for (const [relPath, content] of Object.entries(files)) {
      const destPath = path.join(distDir, relPath)
      ensureDir(path.dirname(destPath))
      fs.writeFileSync(destPath, content, 'utf-8')
    }
    output.push(`[build] Copied ${Object.keys(files).length} files to dist/`)

    // 4. 编程式场景：尝试 esbuild bundle（如可加载 esbuild）
    if (config.scripts?.onActivateFile || config.scripts?.onDeactivateFile || config.scripts?.tools?.length) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const esbuild = require('esbuild')
        const scriptFiles = new Set<string>()
        if (config.scripts?.onActivateFile) scriptFiles.add(config.scripts.onActivateFile)
        if (config.scripts?.onDeactivateFile) scriptFiles.add(config.scripts.onDeactivateFile)
        config.scripts?.tools?.forEach(t => scriptFiles.add(t.scriptFile))

        for (const scriptFile of scriptFiles) {
          const srcPath = path.join(projectPath, scriptFile)
          if (!fs.existsSync(srcPath)) {
            output.push(`  WARN: script not found: ${scriptFile}`)
            continue
          }
          const destPath = path.join(distDir, scriptFile.replace(/\.ts$/, '.js'))
          ensureDir(path.dirname(destPath))
          await esbuild.build({
            entryPoints: [srcPath],
            outfile: destPath,
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node16',
            sourcemap: false,
            logLevel: 'silent',
          })
          output.push(`  [esbuild] bundled ${scriptFile} → ${scriptFile.replace(/\.ts$/, '.js')}`)
        }
      } catch (e) {
        output.push(`  WARN: esbuild not available, scripts copied as-is: ${e instanceof Error ? e.message : ''}`)
      }
    }

    output.push('[build] SUCCESS')
    return { success: true, output: output.join('\n') }
  } catch (err) {
    output.push(`[build] FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, output: output.join('\n'), error: err instanceof Error ? err.message : String(err) }
  }
}

// ==========================================
// 试运行（P3）
// ==========================================

/** 试运行场景注册表：scenarioId → projectPath */
const tryRunRegistry = new Map<string, string>()

function startTryRun(projectPath: string): { success: boolean; scenarioId?: string; error?: string } {
  try {
    const config = readScenarioConfig(projectPath)
    const scenarioId = config.id

    // 标记为试运行（场景加载器会优先检查此注册表）
    tryRunRegistry.set(scenarioId, projectPath)

    // 通过 webContents 通知渲染进程刷新场景列表
    // 实际加载由渲染进程的 ScenarioLoader 完成
    return { success: true, scenarioId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function stopTryRun(scenarioId: string): { success: boolean } {
  tryRunRegistry.delete(scenarioId)
  return { success: true }
}

function isTryRunning(scenarioId: string): boolean {
  return tryRunRegistry.has(scenarioId)
}

function getTryRunPath(scenarioId: string): string | null {
  return tryRunRegistry.get(scenarioId) || null
}

// ==========================================
// 开发者中心认证与发布
// ==========================================

interface DeveloperAuthInfo {
  loggedIn: boolean
  developerName?: string
  token?: string
}

interface PublishParams {
  scenarioId: string
  version: string
  name: string
  nameZh: string
  type: string
  category: string
  permissions?: string[]
  changelog?: string
  packagePath: string
  backendUrl?: string
}

/**
 * 读取开发者认证信息（存储于 userData/developer-auth.json）
 */
function readDeveloperAuth(): DeveloperAuthInfo {
  const authPath = path.join(app.getPath('userData'), 'developer-auth.json')
  return readJsonFile<DeveloperAuthInfo>(authPath, { loggedIn: false })
}

/**
 * 主进程使用 Electron net 发起 multipart/form-data 文件上传
 */
async function uploadScenarioPackage(
  getMainWindow: () => BrowserWindow | null,
  params: PublishParams,
  token: string,
): Promise<{ success: boolean; marketplaceId?: string; downloadUrl?: string; error?: string }> {
  const { net } = require('electron')
  const backendUrl = params.backendUrl || 'https://developer.aweeclaw.com'
  const url = `${backendUrl}/api/v1/marketplace/developer/${params.scenarioId}/upload-package`

  if (!fs.existsSync(params.packagePath)) {
    return { success: false, error: `Package file not found: ${params.packagePath}` }
  }

  const fileBuffer = fs.readFileSync(params.packagePath)
  const fileName = path.basename(params.packagePath)
  const boundary = `----AweeClawFormBoundary${Date.now().toString(16)}`

  // 构造 multipart/form-data body
  const parts: Buffer[] = []

  // metadata 字段
  const metadata = {
    id: params.scenarioId,
    version: params.version,
    name: params.name,
    nameZh: params.nameZh,
    type: params.type,
    category: params.category,
    permissions: params.permissions || [],
    changelog: params.changelog || `Release ${params.version}`,
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    ),
  )

  // 文件字段
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  return new Promise(resolve => {
    const request = net.request({
      url,
      method: 'POST',
    })
    request.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
    request.setHeader('Authorization', `Bearer ${token}`)
    request.setHeader('Content-Length', String(body.length))

    let data = ''
    request.on('response', (response: Electron.IncomingMessage) => {
      response.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      response.on('end', () => {
        const ok = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300
        if (!ok) {
          resolve({ success: false, error: `HTTP ${response.statusCode}: ${data.slice(0, 500)}` })
          return
        }
        try {
          const parsed = JSON.parse(data)
          resolve({
            success: true,
            marketplaceId: parsed.id || parsed.scenarioId,
            downloadUrl: parsed.downloadUrl,
          })
        } catch {
          resolve({ success: true })
        }
      })
      response.on('error', (err: Error) => {
        resolve({ success: false, error: err.message })
      })
    })
    request.on('error', (err: Error) => {
      resolve({ success: false, error: err.message })
    })
    request.write(body)
    request.end()

    // 通知主窗口（用于 UI 显示上传进度）
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('scenario-builder:publishProgress', {
        scenarioId: params.scenarioId,
        phase: 'uploading',
        bytesTotal: body.length,
      })
    }
  })
}

// ==========================================
// IPC Handler 注册
// ==========================================

export function registerScenarioBuilderIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  // ─── 项目骨架创建 ─────────────────────────────────────
  safeIpcHandle('scenario-builder:createProjectFiles', async (_event, params: CreateProjectFilesParams) => {
    try {
      if (!params.localPath || !params.scenarioId || !params.name) {
        return { success: false, error: 'Missing required fields: localPath, scenarioId, name' }
      }
      if (fs.existsSync(params.localPath) && fs.readdirSync(params.localPath).length > 0) {
        return { success: false, error: `Directory not empty: ${params.localPath}` }
      }
      createProjectScaffold(params)
      logger.agent.info(`[ScenarioBuilder] Created project scaffold at ${params.localPath}`)
      return { success: true, localPath: params.localPath }
    } catch (err) {
      logger.agent.error('[ScenarioBuilder] createProjectFiles failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 文件读取 ───────────────────────────────────────
  safeIpcHandle('scenario-builder:readFile', async (_event, params: ReadFileParams) => {
    try {
      const fullPath = safeJoinPath(params.projectPath, params.relativePath)
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${params.relativePath}`, content: '' }
      }
      const stat = fs.statSync(fullPath)
      if (stat.size > 5 * 1024 * 1024) {
        return { success: false, error: 'File too large (max 5MB)', content: '' }
      }
      const content = fs.readFileSync(fullPath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), content: '' }
    }
  })

  // ─── 文件写入 ───────────────────────────────────────
  safeIpcHandle('scenario-builder:writeFile', async (_event, params: WriteFileParams) => {
    try {
      const fullPath = safeJoinPath(params.projectPath, params.relativePath)
      if (params.createDirs !== false) {
        ensureDir(path.dirname(fullPath))
      }
      fs.writeFileSync(fullPath, params.content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 校验 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:validate', async (_event, params: ValidateParams) => {
    try {
      const config = readScenarioConfig(params.projectPath)
      const files = readProjectFiles(params.projectPath)
      const result = validateScenarioPackage(config, files)
      return {
        success: true,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        structure: result.structure,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 构建 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:build', async (_event, params: BuildParams) => {
    const result = await doBuild(params.projectPath)
    return result
  })

  // ─── 打包 ──────────────────────────────────────────
  safeIpcHandle('scenario-builder:pack', async (_event, params: PackParams) => {
    return doPack(params.projectPath, params.outputPath)
  })

  // ─── 试运行 ─────────────────────────────────────────
  safeIpcHandle('scenario-builder:tryRunStart', async (_event, params: { projectPath: string }) => {
    return startTryRun(params.projectPath)
  })
  safeIpcHandle('scenario-builder:tryRunStop', async (_event, params: { scenarioId: string }) => {
    return stopTryRun(params.scenarioId)
  })
  safeIpcHandle('scenario-builder:tryRunStatus', async (_event, params: { scenarioId: string }) => {
    return { running: isTryRunning(params.scenarioId), projectPath: getTryRunPath(params.scenarioId) }
  })

  // ─── 卸载 ──────────────────────────────────────────
  safeIpcHandle('scenario:uninstall', async (_event, scenarioId: string) => {
    try {
      const scenarioDir = getScenarioDir(scenarioId)
      if (!fs.existsSync(scenarioDir)) {
        return { success: false, error: `Scenario not installed: ${scenarioId}` }
      }
      // 尝试执行卸载 SQL 脚本
      try {
        const config = readScenarioConfig(scenarioDir)
        if (config.database?.uninstallScripts && config.database.uninstallScripts.length > 0) {
          logger.agent.info(`[ScenarioUninstall] Running ${config.database.uninstallScripts.length} uninstall scripts for "${scenarioId}"`)
          // 实际 SQL 执行通过 scenario-db:drop IPC 完成（由渲染进程触发）
        }
      } catch {
        // 配置读取失败不阻塞卸载
      }
      fs.rmSync(scenarioDir, { recursive: true, force: true })
      logger.agent.info(`[ScenarioUninstall] Removed scenario "${scenarioId}" from ${scenarioDir}`)
      return { success: true }
    } catch (err) {
      logger.agent.error(`[ScenarioUninstall] Failed for "${scenarioId}":`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 开发者中心认证 ─────────────────────────────────
  safeIpcHandle('developer:checkAuth', async () => {
    const auth = readDeveloperAuth()
    return {
      loggedIn: auth.loggedIn,
      developerName: auth.developerName,
    }
  })

  safeIpcHandle('developer:logout', async () => {
    const authPath = path.join(app.getPath('userData'), 'developer-auth.json')
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath)
    }
    return { success: true }
  })

  safeIpcHandle('developer:saveAuth', async (_event, auth: DeveloperAuthInfo) => {
    try {
      writeJsonFile(path.join(app.getPath('userData'), 'developer-auth.json'), auth)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ─── 发布到开发者中心 ────────────────────────────────
  safeIpcHandle('developer:publishScenario', async (_event, params: PublishParams) => {
    try {
      const auth = readDeveloperAuth()
      if (!auth.loggedIn || !auth.token) {
        return { success: false, error: 'Not logged in to developer center' }
      }

      const result = await uploadScenarioPackage(getMainWindow, params, auth.token)
      return result
    } catch (err) {
      logger.agent.error('[ScenarioBuilder] publishScenario failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/**
 * 导出试运行注册表查询（供场景加载器调用）
 * 当渲染进程尝试加载场景时，先查询此注册表，若有则从项目目录加载
 */
export function getTryRunProjectPath(scenarioId: string): string | null {
  return tryRunRegistry.get(scenarioId) || null
}
