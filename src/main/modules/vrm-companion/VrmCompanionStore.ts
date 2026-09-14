/**
 * VRM 伴侣数据服务（主进程）
 *
 * 职责：
 * 1. 资源托管：注册 `vrm-asset://` 自定义协议，安全地把本地模型文件暴露给渲染进程。
 *    为什么必须用自定义协议：渲染页面通过 loadFile 加载，origin 为 file://，
 *    Chromium 默认禁止 file:// 页面 XHR/fetch 读取 file:// 资源（GLTFLoader 会失败），
 *    因此在 ready 前 registerSchemesAsPrivileged + ready 后 protocol.handle 代理到文件系统。
 * 2. 模型库管理：内置默认模型（resources/vrm/models）+ 用户目录模型（userData/vrm/models）
 * 3. 好感度系统：从 AI 回复中提取 `<user=名称 love=数值 familiarity=数值>` 并持久化
 *    由 super-ai-browser 的 affection_system.py 移植为 TS，去除 Python 依赖。
 *
 * 存储布局：
 *   <userData>/vrm/models/*.vrm          用户导入的模型
 *   <userData>/vrm/affection_data.json   好感度数据
 *   <userData>/vrm/companion_config.json 伴侣窗口配置
 *   <resources>/vrm/models/*.vrm         内置默认模型（打包后位于 process.resourcesPath）
 */

import { app, protocol, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { logger } from '@shared/toolkit/LogEngine'

// ============================================
// 类型定义
// ============================================

export type VrmModelSource = 'builtin' | 'user'

/** 模型条目（返回给渲染进程的信息） */
export interface VrmModelInfo {
  id: string
  name: string
  source: VrmModelSource
  /** 渲染进程可直接加载的 URL（vrm-asset://asset/<id>） */
  url: string
  /** 文件体积（字节），用于 UI 展示 */
  size: number
  /** 是否当前选中 */
  selected: boolean
}

/** 动作（.vrma）条目（返回给渲染进程的信息） */
export interface VrmAnimationInfo {
  id: string
  name: string
  source: VrmModelSource
  /** 渲染进程可直接加载的 URL（vrm-asset://asset/<id>） */
  url: string
  /** 文件体积（字节），用于 UI 展示 */
  size: number
  /**
   * 是否适合作为「待机循环」动作。
   *
   * 全身/幅度过大的动作（spin / squat / show_full_body / shoot）在桌面伴侣的
   * 上半身近景构图里会出画或显得突兀，渲染层据此只挑温和动作进入待机队列；
   * 其余动作保留给「一次性交互播放」（点击角色时触发）。
   */
  idleFriendly: boolean
}

/** 伴侣窗口持久化配置 */
export interface VrmCompanionConfig {
  enabled: boolean
  showOnStartup: boolean
  modelId: string | null
  /** 模型缩放（0.5 ~ 2.0） */
  scale: number
  /** 窗口尺寸 */
  width: number
  height: number
  positionX: number | null
  positionY: number | null
  /** 窗口置顶（高于普通应用窗口，始终浮在桌面最上层） */
  alwaysOnTop: boolean
  /** 锁定位置：开启后拖拽无效，避免误触移动 */
  locked: boolean
  /** 窗口整体不透明度（0.3 ~ 1） */
  opacity: number
  /** 待机动作：呼吸 / 身体摇摆 / 手臂摆动 / 眨眼 */
  idleAnimation: boolean
  /** 视线跟随鼠标：角色眼睛与头部朝向鼠标 */
  lookAtCursor: boolean
  /**
   * 自动隐藏：鼠标移到角色身上时画布淡出并让窗口鼠标穿透。
   *
   * 目的是「角色挡住的桌面内容可以正常选中/点击」——鼠标一碰到角色就让它让位，
   * 移开后自动淡入。默认关闭，避免用户第一次移动鼠标时角色凭空消失。
   */
  autoHide: boolean
  /**
   * 鼠标穿透：窗口整体忽略鼠标事件，点击直接落到桌面上。
   *
   * 默认开启 —— 桌面伴侣的定位是「陪在桌面一角」，不该抢走桌面的点击。
   * 穿透状态下鼠标移到角色上仍会浮出操作栏（见 VrmCompanionManager 的
   * 「按需临时接管鼠标事件」），因此不会把操作入口一起锁死。
   */
  clickThrough: boolean
}

/** 好感度：{ 用户名: { 属性名: 数值 } } */
export type AffectionStats = Record<string, number>
export type AffectionData = Record<string, AffectionStats>

// ============================================
// 常量
// ============================================

/** 自定义协议名（把本地模型文件安全暴露给渲染进程） */
export const VRM_ASSET_SCHEME = 'vrm-asset'

const VRM_DIR_NAME = 'vrm'
const USER_MODELS_DIR_NAME = 'models'
const AFFECTION_FILE_NAME = 'affection_data.json'
const CONFIG_FILE_NAME = 'companion_config.json'

/** 支持的模型扩展名 */
const SUPPORTED_MODEL_EXT = ['.vrm', '.glb']

/** 支持的动作扩展名（VRM Animation，本质是带 vrmAnimations 的 GLB） */
const SUPPORTED_ANIM_EXT = ['.vrma']

/** 用户动作目录名（<userData>/vrm/animations） */
const USER_ANIMATIONS_DIR_NAME = 'animations'

/**
 * 不宜作为待机循环的动作（按文件基名小写匹配）。
 *
 * 这些动作幅度大、涉及全身位移或下肢动作，在伴侣窗口的「上半身近景」构图中
 * 会跑出取景框或与静止站姿割裂，因此排除出待机队列，仅用于手动触发。
 */
const NON_IDLE_ANIMATION_NAMES = new Set(['spin', 'squat', 'show_full_body', 'shoot'])

/** 伴侣窗口默认尺寸（半身立绘比例） */
export const DEFAULT_COMPANION_WIDTH = 320
export const DEFAULT_COMPANION_HEIGHT = 480

/** 不透明度范围 */
export const MIN_COMPANION_OPACITY = 0.3
export const MAX_COMPANION_OPACITY = 1

/** 默认配置 */
export const DEFAULT_COMPANION_CONFIG: VrmCompanionConfig = {
  enabled: false,
  showOnStartup: false,
  modelId: null,
  scale: 1,
  width: DEFAULT_COMPANION_WIDTH,
  height: DEFAULT_COMPANION_HEIGHT,
  positionX: null,
  positionY: null,
  alwaysOnTop: true,
  locked: false,
  opacity: 1,
  idleAnimation: true,
  lookAtCursor: true,
  autoHide: false,
  clickThrough: true,
}

/**
 * 好感度标签匹配：`<user=名称 属性1=数值 属性2=数值>`
 * 与 Python 版保持一致，兼容属性名前带空格/多个属性的写法。
 */
const AFFECTION_TAG_RE = /<user=([^\s>]+)\s+([^>]+)>/
/** `属性=数值` 提取（支持中文属性名与负数） */
const AFFECTION_STAT_RE = /([a-zA-Z0-9_\u4e00-\u9fa5]+)\s*=\s*(-?\d+)/g

// ============================================
// 资源注册表（assetId → 绝对路径）
// ============================================

/**
 * vrm-asset:// 协议的可访问白名单。
 *
 * 只允许渲染进程加载已登记的模型文件，避免协议退化成任意文件读取漏洞。
 */
const assetRegistry = new Map<string, string>()

/** 登记一个资源并返回其 assetId */
function registerAsset(id: string, filePath: string): string {
  assetRegistry.set(id, filePath)
  return id
}

/** 生成渲染进程可用的资源 URL */
function toAssetUrl(id: string): string {
  return `${VRM_ASSET_SCHEME}://asset/${encodeURIComponent(id)}`
}

// ============================================
// 目录工具
// ============================================

/** 用户 VRM 数据根目录（<userData>/vrm） */
export function getVrmDataDir(): string {
  return path.join(app.getPath('userData'), VRM_DIR_NAME)
}

/** 用户模型目录（<userData>/vrm/models） */
export function getUserModelsDir(): string {
  return path.join(getVrmDataDir(), USER_MODELS_DIR_NAME)
}

/**
 * 内置模型目录。
 *
 * - 打包后：<process.resourcesPath>/vrm/models（由 electron-builder extraResources 投放）
 * - 开发态：<项目根>/resources/vrm/models
 */
export function getBuiltinModelsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, VRM_DIR_NAME, USER_MODELS_DIR_NAME)
  }
  // app.getAppPath() 在开发态指向项目根（包含 package.json 的目录）
  return path.join(app.getAppPath(), 'resources', VRM_DIR_NAME, USER_MODELS_DIR_NAME)
}

/**
 * 内置动作目录（.vrma）。
 *
 * 打包后：<process.resourcesPath>/vrm/animations
 * 开发态：<项目根>/resources/vrm/animations
 */
export function getBuiltinAnimationsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, VRM_DIR_NAME, USER_ANIMATIONS_DIR_NAME)
  }
  return path.join(app.getAppPath(), 'resources', VRM_DIR_NAME, USER_ANIMATIONS_DIR_NAME)
}

/** 用户动作目录（<userData>/vrm/animations） */
export function getUserAnimationsDir(): string {
  return path.join(getVrmDataDir(), USER_ANIMATIONS_DIR_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[VrmCompanion] ensureDir failed:', dir, err)
  }
}

/** 读取 JSON 文件（失败时返回 fallback） */
function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    logger.system.warn('[VrmCompanion] readJsonFile failed:', filePath, err)
    return fallback
  }
}

/** 写入 JSON 文件 */
function writeJsonFile(filePath: string, data: unknown): void {
  try {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    logger.system.warn('[VrmCompanion] writeJsonFile failed:', filePath, err)
  }
}

// ============================================
// 协议注册
// ============================================

/**
 * 注册自定义协议特权（必须在 app ready 之前调用）。
 *
 * standard:  让 URL 具备标准语义（host/path 可解析），GLTFLoader 的 URL 拼接依赖此点
 * supportFetchAPI: 允许 fetch 加载（loader 内部使用）
 * bypassCSP:  避免页面 CSP 拦截自定义协议
 */
export function registerVrmAssetScheme(): void {
  try {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: VRM_ASSET_SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          bypassCSP: true,
          corsEnabled: true,
        },
      },
    ])
  } catch (err) {
    logger.system.warn('[VrmCompanion] registerSchemesAsPrivileged failed:', err)
  }
}

/**
 * 挂载自定义协议处理器（必须在 app ready 之后调用）。
 *
 * URL 形式：vrm-asset://asset/<encodeURIComponent(assetId)>
 * 解析后从 assetRegistry 查表得到真实路径，仅放行已登记资源。
 */
export function handleVrmAssetProtocol(): void {
  try {
    protocol.handle(VRM_ASSET_SCHEME, async (request) => {
      try {
        const url = new URL(request.url)
        // host 固定为 'asset'，资源 id 位于 pathname
        const assetId = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const filePath = assetId ? assetRegistry.get(assetId) : undefined

        if (!filePath || !fs.existsSync(filePath)) {
          logger.system.warn('[VrmCompanion] Asset not found:', assetId)
          return new Response('Asset not found', { status: 404 })
        }

        // 交给 Electron net 读取本地文件，自动处理 Range 与 Content-Type
        return await net.fetch(pathToFileURL(filePath).toString())
      } catch (err) {
        logger.system.warn('[VrmCompanion] Asset protocol error:', err)
        return new Response('Bad request', { status: 400 })
      }
    })
    logger.system.info('[VrmCompanion] Asset protocol mounted:', VRM_ASSET_SCHEME)
  } catch (err) {
    logger.system.warn('[VrmCompanion] protocol.handle failed:', err)
  }
}

// ============================================
// 模型库
// ============================================

/** 扫描某个目录下的模型文件 */
/** 扫描结果（含真实文件路径，仅主进程内部使用，不下发渲染进程） */
interface ScannedModel {
  id: string
  name: string
  source: VrmModelSource
  filePath: string
  size: number
}

function scanModels(dir: string, source: VrmModelSource): ScannedModel[] {
  const result: ScannedModel[] = []
  try {
    if (!fs.existsSync(dir)) return result
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_MODEL_EXT.includes(ext)) continue

      const filePath = path.join(dir, entry.name)
      let size = 0
      try {
        size = fs.statSync(filePath).size
      } catch {
        size = 0
      }

      result.push({
        // id 使用「来源:文件名」，天然唯一且稳定（跨重启不变）
        id: `${source}:${entry.name}`,
        name: path.basename(entry.name, ext),
        source,
        filePath,
        size,
      })
    }
  } catch (err) {
    logger.system.warn('[VrmCompanion] scanModels failed:', dir, err)
  }
  return result
}

/**
 * 列出全部可用模型（内置 + 用户），并登记到资源注册表。
 *
 * 每次调用都会重新扫描并刷新 registry，保证导入/删除后立即生效。
 */
export function listModels(): VrmModelInfo[] {
  const config = getConfig()
  const builtin = scanModels(getBuiltinModelsDir(), 'builtin')
  const user = scanModels(getUserModelsDir(), 'user')
  const all = [...builtin, ...user]

  const models: VrmModelInfo[] = all.map((item) => {
    registerAsset(item.id, item.filePath)
    return {
      id: item.id,
      name: item.name,
      source: item.source,
      size: item.size,
      url: toAssetUrl(item.id),
      selected: config.modelId === item.id,
    }
  })

  // 未选择任何模型时，默认选中第一个可用模型并持久化
  if (!config.modelId && models.length > 0) {
    updateConfig({ modelId: models[0].id })
    models[0].selected = true
  }

  return models
}

// ============================================
// 动作库（.vrma）
// ============================================

/**
 * 扫描某个目录下的动作文件。
 *
 * id 前缀与模型保持一致（`builtin:` / `user:`），但动作与模型是两套命名空间，
 * 故在 id 中再加一段 `anim:` 前缀避免与同名模型在 assetRegistry 中冲突。
 */
function scanAnimations(dir: string, source: VrmModelSource): VrmAnimationInfo[] {
  const result: VrmAnimationInfo[] = []
  try {
    if (!fs.existsSync(dir)) return result
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_ANIM_EXT.includes(ext)) continue

      const filePath = path.join(dir, entry.name)
      const baseName = path.basename(entry.name, ext)
      let size = 0
      try {
        size = fs.statSync(filePath).size
      } catch {
        size = 0
      }

      const id = `anim:${source}:${entry.name}`
      registerAsset(id, filePath)

      result.push({
        id,
        name: baseName,
        source,
        size,
        url: toAssetUrl(id),
        idleFriendly: !NON_IDLE_ANIMATION_NAMES.has(baseName.toLowerCase()),
      })
    }
  } catch (err) {
    logger.system.warn('[VrmCompanion] scanAnimations failed:', dir, err)
  }
  // 按名称排序，保证「待机队列」顺序稳定可预期（跨重启一致）
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}

/**
 * 列出全部可用动作（内置 + 用户）。
 *
 * 每次调用重新扫描并刷新 registry，保证新增/删除动作后立即生效。
 */
export function listAnimations(): VrmAnimationInfo[] {
  return [
    ...scanAnimations(getBuiltinAnimationsDir(), 'builtin'),
    ...scanAnimations(getUserAnimationsDir(), 'user'),
  ]
}

/**
 * 导入用户模型（从任意路径复制到 userData/vrm/models）。
 *
 * @param sourcePath 源文件绝对路径
 * @returns 导入结果（含新模型信息）
 */
export function importModel(sourcePath: string): { success: boolean; model?: VrmModelInfo; error?: string } {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { success: false, error: 'FILE_NOT_FOUND' }
    }
    const ext = path.extname(sourcePath).toLowerCase()
    if (!SUPPORTED_MODEL_EXT.includes(ext)) {
      return { success: false, error: 'UNSUPPORTED_FORMAT' }
    }

    const userDir = getUserModelsDir()
    ensureDir(userDir)

    // 目标文件名去重：name.vrm → name-1.vrm → name-2.vrm
    const baseName = path.basename(sourcePath, ext)
    let targetName = `${baseName}${ext}`
    let counter = 1
    while (fs.existsSync(path.join(userDir, targetName))) {
      targetName = `${baseName}-${counter}${ext}`
      counter += 1
    }

    const targetPath = path.join(userDir, targetName)
    fs.copyFileSync(sourcePath, targetPath)

    const id = `user:${targetName}`
    registerAsset(id, targetPath)
    let size = 0
    try {
      size = fs.statSync(targetPath).size
    } catch {
      size = 0
    }

    logger.system.info('[VrmCompanion] Model imported:', targetName)

    return {
      success: true,
      model: {
        id,
        name: path.basename(targetName, ext),
        source: 'user',
        size,
        url: toAssetUrl(id),
        selected: false,
      },
    }
  } catch (err) {
    logger.system.warn('[VrmCompanion] importModel failed:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 删除用户导入的模型（内置模型不可删除） */
export function deleteModel(id: string): { success: boolean; error?: string } {
  try {
    if (!id.startsWith('user:')) {
      return { success: false, error: 'BUILTIN_READONLY' }
    }
    const fileName = id.slice('user:'.length)
    const filePath = path.join(getUserModelsDir(), fileName)
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'FILE_NOT_FOUND' }
    }
    fs.unlinkSync(filePath)
    assetRegistry.delete(id)

    // 若删除的是当前选中模型，清空选择以便回落到默认模型
    const config = getConfig()
    if (config.modelId === id) {
      updateConfig({ modelId: null })
    }

    logger.system.info('[VrmCompanion] Model deleted:', fileName)
    return { success: true }
  } catch (err) {
    logger.system.warn('[VrmCompanion] deleteModel failed:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ============================================
// 配置读写
// ============================================

/** 读取伴侣配置（缺失字段用默认值补齐） */
export function getConfig(): VrmCompanionConfig {
  const filePath = path.join(getVrmDataDir(), CONFIG_FILE_NAME)
  const raw = readJsonFile<Partial<VrmCompanionConfig>>(filePath, {})
  return {
    ...DEFAULT_COMPANION_CONFIG,
    ...raw,
    // 数值字段兜底（防止脏数据导致窗口尺寸异常）
    scale: typeof raw.scale === 'number' && raw.scale > 0 ? raw.scale : DEFAULT_COMPANION_CONFIG.scale,
    width: typeof raw.width === 'number' && raw.width > 0 ? raw.width : DEFAULT_COMPANION_WIDTH,
    height: typeof raw.height === 'number' && raw.height > 0 ? raw.height : DEFAULT_COMPANION_HEIGHT,
    opacity: normalizeOpacity(raw.opacity),
    // 布尔字段兜底（老配置文件缺少这些字段时回落到默认值）
    alwaysOnTop: typeof raw.alwaysOnTop === 'boolean' ? raw.alwaysOnTop : DEFAULT_COMPANION_CONFIG.alwaysOnTop,
    locked: typeof raw.locked === 'boolean' ? raw.locked : DEFAULT_COMPANION_CONFIG.locked,
    idleAnimation:
      typeof raw.idleAnimation === 'boolean' ? raw.idleAnimation : DEFAULT_COMPANION_CONFIG.idleAnimation,
    lookAtCursor:
      typeof raw.lookAtCursor === 'boolean' ? raw.lookAtCursor : DEFAULT_COMPANION_CONFIG.lookAtCursor,
    autoHide: typeof raw.autoHide === 'boolean' ? raw.autoHide : DEFAULT_COMPANION_CONFIG.autoHide,
    clickThrough:
      typeof raw.clickThrough === 'boolean' ? raw.clickThrough : DEFAULT_COMPANION_CONFIG.clickThrough,
  }
}

/** 把任意输入归一化到合法不透明度区间 */
export function normalizeOpacity(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return MAX_COMPANION_OPACITY
  return Math.max(MIN_COMPANION_OPACITY, Math.min(MAX_COMPANION_OPACITY, n))
}

/** 增量更新配置并落盘，返回更新后的完整配置 */
export function updateConfig(partial: Partial<VrmCompanionConfig>): VrmCompanionConfig {
  const next = { ...getConfig(), ...partial }
  // 不透明度归一化，避免脏值写盘后窗口整个消失
  next.opacity = normalizeOpacity(next.opacity)
  const filePath = path.join(getVrmDataDir(), CONFIG_FILE_NAME)
  writeJsonFile(filePath, next)
  return next
}

// ============================================
// 好感度系统（TS 移植自 affection_system.py）
// ============================================

function getAffectionFilePath(): string {
  return path.join(getVrmDataDir(), AFFECTION_FILE_NAME)
}

/** 读取好感度数据 */
export function loadAffectionData(): AffectionData {
  return readJsonFile<AffectionData>(getAffectionFilePath(), {})
}

/** 全量保存好感度数据 */
export function saveAffectionData(data: AffectionData): void {
  writeJsonFile(getAffectionFilePath(), data)
}

/**
 * 从 AI 完整回复中提取好感度标签并更新数据。
 *
 * 标签格式：`<user=名称 属性1=数值 属性2=数值>`
 * 例如：`<user=李伟 love=12 familiarity=15>`
 *
 * @returns 是否有更新（供上层决定是否推送渲染进程刷新 UI）
 */
export function extractAndUpdateAffection(fullContent: string): boolean {
  if (!fullContent) return false

  const match = AFFECTION_TAG_RE.exec(fullContent)
  if (!match) return false

  const userName = match[1]
  const statsStr = match[2]

  // 重置正则 lastIndex，避免全局正则跨调用残留导致漏匹配
  AFFECTION_STAT_RE.lastIndex = 0
  const stats: AffectionStats = {}
  let statMatch: RegExpExecArray | null
  while ((statMatch = AFFECTION_STAT_RE.exec(statsStr)) !== null) {
    stats[statMatch[1]] = Number.parseInt(statMatch[2], 10)
  }

  if (Object.keys(stats).length === 0) return false

  const data = loadAffectionData()
  data[userName] = { ...(data[userName] || {}), ...stats }
  saveAffectionData(data)

  logger.system.info('[VrmCompanion] Affection updated:', userName, stats)
  return true
}
