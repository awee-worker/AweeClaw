/**
 * 场景素材文件桥接
 *
 * 场景数据库只存结构化数据，图片 / 视频这类二进制放磁盘：
 * 把 base64 塞进表里会让一行记录膨胀到几 MB，读写与备份都跟着变慢。
 * 这里给场景一个受控的素材目录，只做四件事：写入、读回、导入、删除。
 *
 * 目录约定：{userData}/scenario-data/{scenarioId}/assets/{fileName}
 * 场景在业务数据里保存的是**相对场景数据目录的路径**（形如 `assets/img-a.png`），
 * 换机器、换工作区都不会失效。
 *
 * 安全边界：相对路径必须以 assets/ 开头，且归一后必须落在场景数据目录内。
 * `..`、绝对路径、盘符路径一律拒绝 —— 这个通道只服务素材，不提供任意文件读写。
 */
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

/** 素材目录名：与场景数据库同级，卸载场景时随目录一起清理 */
const ASSETS_DIR_NAME = 'assets'

/** 相对路径必须以它开头，否则请求会被拒绝 */
const ASSETS_PREFIX = `${ASSETS_DIR_NAME}/`

/** 允许导入的媒体扩展名：这个通道不接受任意文件 */
const IMPORTABLE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
])

/** 单个素材体积上限：超过就不再往场景目录里搬 */
const MAX_ASSET_BYTES = 32 * 1024 * 1024

/** 场景 id 只允许安全字符，避免拼出目录穿越 */
const SAFE_SCENARIO_ID = /^[a-z0-9][a-z0-9._-]*$/i

interface AssetParams {
  scenarioId: string
  relativePath?: string
}

interface WriteParams extends AssetParams {
  relativePath: string
  base64: string
}

interface ImportParams extends AssetParams {
  relativePath: string
  sourcePath: string
}

/** 场景数据目录：素材与数据库都挂在它下面 */
function resolveScenarioDataDir(scenarioId: string): string | null {
  if (!scenarioId || !SAFE_SCENARIO_ID.test(scenarioId)) return null
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'scenario-data', scenarioId)
}
/**
 * 把相对路径解析成绝对路径
 *
 * 只有 `assets/...` 这一种写法是合法的：归一后必须仍在场景数据目录之内，
 * `../../etc/passwd`、`/etc/passwd`、`C:\Windows` 都会被拒。
 * 返回 null 表示这个路径不合法，调用方按失败处理。
 */
function resolveAssetPath(scenarioId: string, relativePath: string): string | null {
  const root = resolveScenarioDataDir(scenarioId)
  if (!root) return null
  const raw = String(relativePath ?? '').trim()
  if (!raw) return null
  if (path.isAbsolute(raw) || /^[a-z]:/i.test(raw)) return null
  // 统一分隔符后再判断：Windows 客户端上场景可能传正斜杠路径
  const normalizedRel = raw.replace(/\\/g, '/')
  if (normalizedRel.split('/').some((segment) => segment === '..')) return null
  if (!normalizedRel.startsWith(ASSETS_PREFIX)) return null

  const target = path.resolve(root, normalizedRel)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (!target.startsWith(rootWithSep)) return null
  return target
}

/** 确保场景数据目录与素材子目录都存在 */
function ensureAssetsRoot(scenarioId: string): string | null {
  const root = resolveScenarioDataDir(scenarioId)
  if (!root) return null
  try {
    fs.mkdirSync(path.join(root, ASSETS_DIR_NAME), { recursive: true })
    return root
  } catch (err) {
    logger.agent.error(`[ScenarioAssets] Failed to create assets dir for "${scenarioId}":`, err)
    return null
  }
}

export function registerScenarioAssetsIpcHandlers(): void {
  // 素材根目录：场景启动时取一次，之后所有读写都基于它
  safeIpcHandle('scenario-asset:dir', async (_event, params: AssetParams) => {
    const root = ensureAssetsRoot(params?.scenarioId ?? '')
    if (!root) {
      return { success: false, error: `无法创建场景素材目录：${params?.scenarioId ?? 'unknown'}` }
    }
    return { success: true, dir: root }
  })

  // 写入素材：base64 解码后落盘，父目录按需创建
  safeIpcHandle('scenario-asset:write', async (_event, params: WriteParams) => {
    const scenarioId = params?.scenarioId ?? ''
    const target = resolveAssetPath(scenarioId, params?.relativePath ?? '')
    if (!target) {
      return { success: false, error: '素材路径不合法' }
    }
    if (typeof params?.base64 !== 'string' || params.base64.length === 0) {
      return { success: false, error: '缺少素材内容' }
    }
    if (!ensureAssetsRoot(scenarioId)) {
      return { success: false, error: '无法创建场景素材目录' }
    }

    try {
      const buffer = Buffer.from(params.base64, 'base64')
      if (buffer.length === 0) {
        return { success: false, error: '素材内容为空' }
      }
      if (buffer.length > MAX_ASSET_BYTES) {
        return {
          success: false,
          error: `素材 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_ASSET_BYTES / 1024 / 1024}MB 上限`,
        }
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, buffer)
      return { success: true, absPath: target, sizeBytes: buffer.length }
    } catch (err) {
      logger.agent.error('[ScenarioAssets] write failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 读回素材：返回 base64，供导出时内联成 data URL
  safeIpcHandle('scenario-asset:read', async (_event, params: AssetParams) => {
    const target = resolveAssetPath(params?.scenarioId ?? '', params?.relativePath ?? '')
    if (!target) return { success: false, error: '素材路径不合法' }
    try {
      const buffer = await fs.promises.readFile(target)
      if (buffer.length > MAX_ASSET_BYTES) {
        return { success: false, error: '素材体积超出上限' }
      }
      return { success: true, base64: buffer.toString('base64') }
    } catch {
      // 文件不存在是常态（用户删过素材），不当成异常上报
      return { success: false, error: '素材文件不存在' }
    }
  })

  // 导入已有本地文件（MCP 出图、用户拖入的原图）
  safeIpcHandle('scenario-asset:import', async (_event, params: ImportParams) => {
    const scenarioId = params?.scenarioId ?? ''
    const target = resolveAssetPath(scenarioId, params?.relativePath ?? '')
    if (!target) return { success: false, error: '素材路径不合法' }

    const source = String(params?.sourcePath ?? '').trim()
    if (!source) return { success: false, error: '缺少源文件路径' }
    const ext = path.extname(source).toLowerCase()
    if (!IMPORTABLE_EXTENSIONS.has(ext)) {
      return { success: false, error: `不支持导入 ${ext || '未知类型'} 文件` }
    }

    try {
      const stats = await fs.promises.stat(source)
      if (!stats.isFile()) return { success: false, error: '源路径不是文件' }
      if (stats.size > MAX_ASSET_BYTES) {
        return { success: false, error: '源文件超出素材体积上限' }
      }
      if (!ensureAssetsRoot(scenarioId)) {
        return { success: false, error: '无法创建场景素材目录' }
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.copyFile(source, target)
      return { success: true, absPath: target, sizeBytes: stats.size }
    } catch (err) {
      logger.agent.warn('[ScenarioAssets] import failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 删除素材：节点换图后用来回收孤儿文件
  safeIpcHandle('scenario-asset:remove', async (_event, params: AssetParams) => {
    const target = resolveAssetPath(params?.scenarioId ?? '', params?.relativePath ?? '')
    if (!target) return { success: false, error: '素材路径不合法' }
    try {
      await fs.promises.unlink(target)
      return { success: true }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') return { success: true }
      logger.agent.warn('[ScenarioAssets] remove failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  logger.ipc.info('[ScenarioAssets] IPC handlers registered')
}
