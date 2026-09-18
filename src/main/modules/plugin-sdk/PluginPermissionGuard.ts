/**
 * 插件权限守卫 — 基于 manifest.permissions 的能力访问控制
 *
 * 职责：
 * - 维护 pluginId → permissions 运行时映射
 * - 定义 HostServices 字段到 PluginPermission 的映射关系
 * - 提供 createGuardedHostServices(pluginId) 创建受限代理
 * - 未声明权限的能力访问被拒绝并记录安全日志
 *
 * 安全策略：
 * - 安装时：PluginInstaller 调用 validatePermissions 校验声明合法性
 * - 加载时：PluginRegistry 调用 registerPermissions 注册运行时权限
 * - 运行时：插件通过 ctx.host 访问受限代理，未声明权限的能力访问抛错
 *
 * 注意：
 * 当前插件代码通过 import() 直接运行在主进程中（无沙箱），
 * 理论上可绕过 JS 代理直接 require Node API。
 * 本权限守卫作为「第一层防线」，防止正常插件因 bug 意外越权，
 * 并为后续沙箱化（UtilityProcess 隔离）奠定权限模型基础。
 *
 * @module plugin-sdk/PluginPermissionGuard
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PluginPermission } from '@shared/plugin-sdk/types'
import type { HostServices } from './hostServices'

// ─── HostService 能力到权限的映射 ──────────────────────────

/**
 * HostServices 字段到 PluginPermission 的映射表。
 *
 * 未在此表中的字段视为「无权限要求」（基础能力，所有插件可用），
 * 如 logger、z（zod）、McpServer、InMemoryTransport 等基础设施。
 *
 * 映射依据：
 * - getDesktopControlManager → desktop.input（可模拟鼠标键盘、杀死进程）
 * - macVisionOcrRouter → desktop.screen（需截屏才能 OCR）
 * - sharp → filesystem.write（图像处理涉及文件写入）
 * - ocr → desktop.screen（OCR 依赖截屏）
 * - inputListener → desktop.recording（录制用户操作）
 * - perceptionStore → system.info（读取系统感知数据）
 * - localEmbedder → system.info（本地模型推理）
 * - vlmModelManager → desktop.screen（视觉理解依赖图像）
 * - behaviorPredictor → system.info（行为预测读取历史）
 * - codeDependencyGraph → filesystem.read（读取代码文件）
 * - impactAnalyzer → filesystem.read（分析代码变更影响）
 * - monitoringService → system.info（系统监控数据）
 * - iotBridge → system.info（IoT 设备数据）
 * - cronScheduler → 无权限要求（基础定时能力）
 * - pptxgen → filesystem.write（生成 PPT 文件）
 * - pptPreview → ui.render（推送 UI 数据到预览窗口）
 * - parsePptxFile → filesystem.read（读取 PPT 文件）
 * - pythonRuntime → python.runtime（复用内置 Python 运行时并执行脚本）
 * - shell → desktop.apps（用系统默认程序打开产物文件 / 外部链接）
 * - nativeImage → 无权限要求（基础图像工具）
 */
const HOST_SERVICE_PERMISSION_MAP: Partial<Record<keyof HostServices, PluginPermission>> = {
  getDesktopControlManager: 'desktop.input',
  macVisionOcrRouter: 'desktop.screen',
  sharp: 'filesystem.write',
  ocr: 'desktop.screen',
  inputListener: 'desktop.recording',
  perceptionStore: 'system.info',
  localEmbedder: 'system.info',
  vlmModelManager: 'desktop.screen',
  behaviorPredictor: 'system.info',
  codeDependencyGraph: 'filesystem.read',
  impactAnalyzer: 'filesystem.read',
  monitoringService: 'system.info',
  iotBridge: 'system.info',
  pptxgen: 'filesystem.write',
  pptPreview: 'ui.render',
  parsePptxFile: 'filesystem.read',
  pythonRuntime: 'python.runtime',
  shell: 'desktop.apps',
}

// ─── 合法权限值列表 ────────────────────────────────────────

/**
 * 所有合法的 PluginPermission 值。
 * 用于安装时校验 manifest.permissions 中是否包含未知值。
 */
const VALID_PERMISSIONS: readonly PluginPermission[] = [
  'network',
  'filesystem.read',
  'filesystem.write',
  'shell.execute',
  'clipboard.read',
  'clipboard.write',
  'notification',
  'system.info',
  'desktop.input',
  'desktop.screen',
  'desktop.windows',
  'desktop.apps',
  'desktop.recording',
  'desktop.workflow',
  'desktop.visual-agent',
  'ui.render',
  'python.runtime',
  'process.spawn',
] as const

// ─── 运行时权限注册表 ──────────────────────────────────────

/** pluginId → 已声明权限集合 */
const permissionRegistry = new Map<string, Set<PluginPermission>>()

// ─── 公开 API ──────────────────────────────────────────────

/**
 * 校验 manifest.permissions 声明的合法性。
 *
 * 在 PluginInstaller 安装时调用：
 * - permissions 缺失时默认为空数组（仅允许基础能力）
 * - 包含未知权限值时记录警告但不阻止安装（向前兼容未来新增权限）
 *
 * @returns 规范化后的权限集合
 */
export function validatePermissions(
  pluginId: string,
  permissions: PluginPermission[] | undefined,
): Set<PluginPermission> {
  const declared = new Set<PluginPermission>()
  if (!permissions || !Array.isArray(permissions)) {
    return declared
  }

  for (const perm of permissions) {
    if (typeof perm !== 'string') {
      logger.security.warn(`[PermissionGuard] Plugin ${pluginId} has non-string permission: ${String(perm)}`)
      continue
    }
    if (!VALID_PERMISSIONS.includes(perm)) {
      logger.security.warn(
        `[PermissionGuard] Plugin ${pluginId} declares unknown permission: ${perm} (allowed, forward-compatible)`,
      )
    }
    declared.add(perm)
  }

  return declared
}

/**
 * 注册插件的运行时权限。
 * 在 PluginRegistry.load 时调用，将 manifest.permissions 存入运行时映射。
 */
export function registerPermissions(pluginId: string, permissions: Set<PluginPermission>): void {
  permissionRegistry.set(pluginId, permissions)
  if (permissions.size > 0) {
    logger.security.info(
      `[PermissionGuard] Registered permissions for ${pluginId}: ${Array.from(permissions).join(', ')}`,
    )
  } else {
    logger.security.info(`[PermissionGuard] Registered permissions for ${pluginId}: (none, basic access only)`)
  }
}

/**
 * 注销插件的运行时权限。
 * 在 PluginRegistry.unload / uninstall 时调用。
 */
export function unregisterPermissions(pluginId: string): void {
  permissionRegistry.delete(pluginId)
}

/**
 * 检查插件是否声明了指定权限。
 *
 * @returns true 表示已声明（允许访问）
 */
export function hasPermission(pluginId: string, permission: PluginPermission): boolean {
  const perms = permissionRegistry.get(pluginId)
  if (!perms) return false
  return perms.has(permission)
}

/**
 * 断言插件拥有指定权限，未声明时抛出 PermissionDeniedError。
 */
export function assertPermission(pluginId: string, permission: PluginPermission): void {
  if (!hasPermission(pluginId, permission)) {
    const err = new PermissionDeniedError(pluginId, permission)
    logger.security.warn(`[PermissionGuard] Access denied: ${err.message}`)
    throw err
  }
}

/**
 * 获取插件的权限列表（用于 UI 展示和审计）。
 */
export function getPluginPermissions(pluginId: string): PluginPermission[] {
  const perms = permissionRegistry.get(pluginId)
  return perms ? Array.from(perms) : []
}

// ─── 受限代理工厂 ──────────────────────────────────────────

/**
 * 为指定插件创建受限的 HostServices 代理。
 *
 * 访问策略：
 * - 无权限要求的字段（logger、z、McpServer 等）→ 直接放行
 * - 有权限要求的字段 → 检查 manifest.permissions，未声明时抛出 PermissionDeniedError
 * - 返回值被冻结为只读，防止插件篡改服务引用
 *
 * 使用方式：
 * ```typescript
 * const guardedHost = createGuardedHostServices(pluginId, fullHost)
 * // guardedHost.getDesktopControlManager() // 若未声明 desktop.input 则抛错
 * ```
 *
 * 注意：当前插件代码通过 globalThis.__AWEECLAW_HOST__ 访问（全局共享），
 * 本函数用于 PluginContext.host 注入路径。完整隔离需待 P0-1 沙箱化完成。
 *
 * @param pluginId 插件 ID
 * @param fullHost 完整的 HostServices 实例
 * @returns 受限代理（Proxy）
 */
export function createGuardedHostServices(pluginId: string, fullHost: HostServices): HostServices {
  return new Proxy(fullHost, {
    get(target: HostServices, prop: string | symbol, receiver: unknown): unknown {
      // 非 string 属性（Symbol.iterator 等）直接放行
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver)
      }

      // 查找该字段是否需要权限
      const requiredPermission = HOST_SERVICE_PERMISSION_MAP[prop as keyof HostServices]

      // 无权限要求 → 直接放行
      if (!requiredPermission) {
        return Reflect.get(target, prop, receiver)
      }

      // 有权限要求 → 校验
      if (!hasPermission(pluginId, requiredPermission)) {
        const err = new PermissionDeniedError(pluginId, requiredPermission)
        logger.security.warn(
          `[PermissionGuard] Plugin ${pluginId} accessed '${prop}' without permission '${requiredPermission}'`,
        )
        throw err
      }

      return Reflect.get(target, prop, receiver)
    },
    // 禁止插件篡改 HostServices 上的属性
    set(): boolean {
      logger.security.warn(`[PermissionGuard] Attempted to modify HostServices (blocked by proxy)`)
      return false
    },
    // 禁止删除属性
    deleteProperty(): boolean {
      logger.security.warn(`[PermissionGuard] Attempted to delete HostServices property (blocked by proxy)`)
      return false
    },
  })
}

// ─── 错误类型 ──────────────────────────────────────────────

/**
 * 权限拒绝错误。
 * 插件访问未声明权限的能力时抛出。
 */
export class PermissionDeniedError extends Error {
  readonly pluginId: string
  readonly permission: PluginPermission

  constructor(pluginId: string, permission: PluginPermission) {
    super(`Plugin '${pluginId}' lacks required permission: '${permission}'`)
    this.name = 'PermissionDeniedError'
    this.pluginId = pluginId
    this.permission = permission
    Object.setPrototypeOf(this, PermissionDeniedError.prototype)
  }
}
