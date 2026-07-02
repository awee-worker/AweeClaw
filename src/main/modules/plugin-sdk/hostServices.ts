/**
 * Host Services 桥接层
 *
 * 将客户端主进程的 native 能力通过 globalThis.__AWEECLAW_HOST__ 暴露给外部插件，
 * 使插件包内的代码可以访问 Electron API 和桌面控制服务，无需内置在客户端源码中。
 *
 * 暴露的服务：
 * - getDesktopControlManager(): 获取桌面控制管理器（截图/鼠标/键盘/窗口/进程/文件）
 * - macVisionOcrRouter: macOS Vision OCR 路由器
 * - nativeImage: Electron 的 nativeImage 模块
 * - logger: 日志器
 *
 * 安全约束：
 * - 仅在主进程设置，渲染进程无法访问
 * - 插件通过 host 桥访问的能力受插件 permissions 声明约束（由 PluginInstaller 校验）
 *
 * @module plugin-sdk/hostServices
 */

import { nativeImage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../desktop-control/DesktopControlManager'
import { macVisionOcrRouter } from '../desktop-control/MacVisionOcrRouter'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'

/** Host 服务接口 */
export interface HostServices {
  /** 获取桌面控制管理器实例 */
  getDesktopControlManager: typeof getDesktopControlManager
  /** macOS Vision OCR 路由器实例 */
  macVisionOcrRouter: typeof macVisionOcrRouter
  /** Electron nativeImage 模块 */
  nativeImage: typeof nativeImage
  /** 日志器（按模块分区） */
  logger: typeof logger
  /** MCP Server 类（来自 @modelcontextprotocol/sdk） */
  McpServer: typeof McpServer
  /** InMemoryTransport 类（来自 @modelcontextprotocol/sdk） */
  InMemoryTransport: typeof InMemoryTransport
  /** zod schema 构建器 */
  z: typeof z
}

/** 全局变量名 */
const HOST_GLOBAL_KEY = '__AWEECLAW_HOST__'

/** 标记是否已初始化 */
let initialized = false

/**
 * 初始化 Host 服务桥接，将 native 能力挂载到 globalThis。
 *
 * 在主进程启动时调用一次即可，重复调用幂等。
 * 插件代码通过 `globalThis.__AWEECLAW_HOST__` 访问暴露的服务。
 */
export function initHostServices(): void {
  if (initialized) return
  if (process.type !== 'browser') {
    logger.system?.warn('[HostServices] Not in main process, skipping initialization')
    return
  }

  const services: HostServices = {
    getDesktopControlManager,
    macVisionOcrRouter,
    nativeImage,
    logger,
    McpServer,
    InMemoryTransport,
    z,
  }

  Object.defineProperty(globalThis, HOST_GLOBAL_KEY, {
    value: Object.freeze(services),
    writable: false,
    configurable: false,
    enumerable: false,
  })

  initialized = true
  logger.system?.info('[HostServices] Host services bridge initialized (globalThis.__AWEECLAW_HOST__)')
}

/**
 * 获取 Host 服务（供插件代码调用）。
 *
 * 如果在插件代码中调用，会从 globalThis 读取。
 * 如果未初始化，抛出错误。
 */
export function getHostServices(): HostServices {
  const host = (globalThis as Record<string, unknown>)[HOST_GLOBAL_KEY] as HostServices | undefined
  if (!host) {
    throw new Error(
      'Host services not initialized. Ensure initHostServices() is called in main process startup.',
    )
  }
  return host
}
