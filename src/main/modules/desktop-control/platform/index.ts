/**
 * 平台适配器工厂
 * 根据 process.platform 动态加载对应平台实现
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './types'
import { DarwinPlatformAdapter } from './darwin'
import { Win32PlatformAdapter } from './win32'
import { LinuxPlatformAdapter } from './linux'

let cachedAdapter: PlatformAdapter | null = null

/**
 * 获取当前平台的适配器实例（单例）
 * 平台不匹配时返回 null，调用方应做降级处理
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (cachedAdapter) return cachedAdapter

  switch (process.platform) {
    case 'darwin':
      cachedAdapter = new DarwinPlatformAdapter()
      break
    case 'win32':
      cachedAdapter = new Win32PlatformAdapter()
      break
    case 'linux':
      cachedAdapter = new LinuxPlatformAdapter()
      break
    default:
      logger.desktop.warn(`[Platform] Unsupported platform: ${process.platform}, falling back to Linux adapter`)
      cachedAdapter = new LinuxPlatformAdapter()
  }

  logger.desktop.info(`[Platform] Adapter initialized for ${process.platform}`)
  return cachedAdapter
}

/** 重置缓存（仅测试用） */
export function resetPlatformAdapter(): void {
  cachedAdapter = null
}

export type { PlatformAdapter } from './types'
export { DarwinPlatformAdapter, Win32PlatformAdapter, LinuxPlatformAdapter }
