/**
 * 可信路径注册表（渲染层）
 *
 * 与主进程 SecurityManager.addAllowedAppPath 必须保持同一份目录清单：
 * 渲染层先校验、主进程再校验，两边不一致会表现为「工具报路径越界」或
 * 「渲染层放行、IPC 静默返回 null」（文件莫名读不到）。
 *
 * 放行对象是「应用自身的数据目录」：插件、外部场景、技能、运行时都由客户端安装到
 * 这些目录（应用默认数据目录 + 配置存储目录，后者用户可在设置里改成自定义路径）下的
 * 子目录里。这些绝对路径会随插件清单、插件自带文档、工具调用参数进入 AI 上下文，
 * 但目录本身在工作区之外 —— 若按工作区边界一律拒绝，AI 连插件自带的文档与脚本
 * 都读不到，插件调用会直接失败。
 *
 * 为什么是「读写」而不是只读：插件与运行时会在自身目录内写缓存、依赖与产物，
 * 只放行读取会让这些流程在途中失败；该目录内容全部由客户端自己创建和管理。
 * 敏感路径（.ssh / .aws 等）仍由 isSensitivePath 拦截，不受此处放行影响。
 */

import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/** 可信应用数据目录（模块级缓存，供同步的路径校验直接读取） */
let trustedAppDataRoots: string[] = []

/**
 * 初始化可信应用数据目录
 *
 * 渲染层启动阶段调用一次。未初始化时 resolvePath 不会放行工作区外路径，
 * 行为与改动前一致（不会误放行），因此调用失败不影响正常使用。
 */
export async function initTrustedAppDataRoots(): Promise<void> {
  try {
    const roots = await api.settings.getAppDataRoots()
    const ready = (roots ?? []).filter(root => typeof root === 'string' && root.length > 0)
    if (ready.length === 0) return
    trustedAppDataRoots = Array.from(new Set([...trustedAppDataRoots, ...ready]))
    logger.agent.info('[TrustedPath] App data roots ready:', trustedAppDataRoots)
  } catch (err) {
    logger.agent.warn('[TrustedPath] Failed to initialize app data roots:', err)
  }
}

/** 读取可信应用数据目录（供 buildToolPathPolicy 使用） */
export function getTrustedAppDataRoots(): string[] {
  return trustedAppDataRoots
}

/** 仅供测试：覆盖可信应用数据目录 */
export function __setTrustedAppDataRoots(roots: string[]): void {
  trustedAppDataRoots = [...roots]
}
