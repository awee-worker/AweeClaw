/**
 * 编程式场景 SDK API
 *
 * 编程式场景（ESM bundle）通过此 API 与宿主应用交互。
 * 与 SandboxAPI 不同，此 API 运行在主线程中，直接提供
 * React 组件、状态管理、样式注入等高级能力。
 *
 * 使用方式（在场景 ESM bundle 中）：
 * ```ts
 * const sdk = window.__AWEECLAW_SDK__
 * const { react, zustand } = sdk.shared
 * const { injectStyle, removeStyle } = sdk.style
 * const { getState, setState } = sdk.storage
 * ```
 *
 * API 模块：
 * - shared: 共享依赖（React、zustand、lucide-react）
 * - style: 样式注入/移除
 * - storage: 场景状态持久化
 * - context: 场景上下文信息
 * - dataBus: 场景间数据通信
 * - logger: 日志记录
 * - health: 健康检查上报
 */

import type React from 'react'
import type { SharedDependencyRegistry } from './SharedDependencyProvider'
import { sharedDependencyProvider } from './SharedDependencyProvider'
import { scenarioStyleManager } from './ScenarioStyleManager'
import { scenarioDataBus } from './ScenarioDataBus'
import { scenarioMonitor } from './ScenarioMonitor'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'

export interface ScenarioStorageAPI {
  getState: (key: string) => unknown
  setState: (key: string, value: unknown) => void
  removeState: (key: string) => void
  getAllKeys: () => string[]
}

export interface ScenarioStyleAPI {
  injectFromUrl: (cssUrl: string) => void
  injectInline: (cssContent: string, namespace?: boolean) => void
  remove: () => void
  updateInline: (cssContent: string, namespace?: boolean) => void
}

export interface ScenarioContextAPI {
  scenarioId: string
  version: string
  appVersion: string
  workspacePath: string | null
  platform: string
  locale: string
}

export interface ScenarioDataBusAPI {
  publish: (type: string, payload: unknown, targetScenarioId?: string) => void
  subscribe: (messageType: string, handler: (payload: unknown, sourceScenarioId: string) => void) => () => void
  setSharedData: (key: string, value: unknown, readOnly?: boolean) => void
  getSharedData: (key: string) => unknown
}

export interface ScenarioLoggerAPI {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

export interface ScenarioHealthAPI {
  reportCheck: (name: string, status: 'healthy' | 'degraded' | 'unhealthy', message?: string) => void
  reportError: (error: string) => void
}

export interface ScenarioSDK {
  shared: {
    react: typeof React
    reactDom: typeof import('react-dom/client')
    zustand: typeof import('zustand')
    lucideReact: typeof import('lucide-react')
    xyflow: typeof import('@xyflow/react')
    framerMotion: typeof import('framer-motion')
    getModule: <K extends keyof SharedDependencyRegistry>(name: K) => SharedDependencyRegistry[K] | null
  }
  style: ScenarioStyleAPI
  storage: ScenarioStorageAPI
  context: ScenarioContextAPI
  dataBus: ScenarioDataBusAPI
  logger: ScenarioLoggerAPI
  health: ScenarioHealthAPI
}

declare global {
  interface Window {
    __AWEECLAW_SDK__: ScenarioSDK | undefined
  }
}

const SDK_GLOBAL_KEY = '__AWEECLAW_SDK__'

export function createScenarioSDK(
  scenarioId: string,
  version: string,
  workspacePath: string | null,
): ScenarioSDK {
  const storagePrefix = `scenario:${scenarioId}:`

  const storageApi: ScenarioStorageAPI = {
    getState: (key: string) => {
      try {
        return StorageService.get(`${storagePrefix}${key}`) ?? undefined
      } catch {
        return undefined
      }
    },
    setState: (key: string, value: unknown) => {
      try {
        StorageService.set(`${storagePrefix}${key}`, value)
      } catch (err) {
        logger.agent.warn(`[SDK:Storage] Failed to set state for key "${key}":`, err)
      }
    },
    removeState: (key: string) => {
      StorageService.remove(`${storagePrefix}${key}`)
    },
    getAllKeys: () => {
      const keys: string[] = []
      // StorageService 使用 aweeclaw: 前缀，需要匹配完整前缀
      const fullPrefix = `aweeclaw:${storagePrefix}`
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(fullPrefix)) {
          keys.push(k.slice(fullPrefix.length))
        }
      }
      return keys
    },
  }

  const styleApi: ScenarioStyleAPI = {
    injectFromUrl: (cssUrl: string) => {
      scenarioStyleManager.injectFromUrl(scenarioId, cssUrl)
    },
    injectInline: (cssContent: string, namespace?: boolean) => {
      scenarioStyleManager.injectInline(scenarioId, cssContent, namespace)
    },
    remove: () => {
      scenarioStyleManager.removeScenarioStyles(scenarioId)
    },
    updateInline: (cssContent: string, namespace?: boolean) => {
      scenarioStyleManager.updateInlineStyle(scenarioId, cssContent, namespace)
    },
  }

  const sharedDeps = sharedDependencyProvider.get()

  const contextApi: ScenarioContextAPI = {
    scenarioId,
    version,
    appVersion: sharedDeps?.appVersion || '0.0.0',
    workspacePath,
    platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin'
      : navigator.platform.toLowerCase().includes('win') ? 'win32'
      : 'linux',
    locale: navigator.language || 'en',
  }

  const dataBusApi: ScenarioDataBusAPI = {
    publish: (type: string, payload: unknown, targetScenarioId?: string) => {
      scenarioDataBus.publish(scenarioId, type, payload, targetScenarioId)
    },
    subscribe: (messageType: string, handler: (payload: unknown, sourceScenarioId: string) => void) => {
      return scenarioDataBus.subscribe(scenarioId, messageType, (message) => {
        handler(message.payload, message.sourceScenarioId)
      })
    },
    setSharedData: (key: string, value: unknown, readOnly?: boolean) => {
      scenarioDataBus.setSharedData(scenarioId, key, value, readOnly)
    },
    getSharedData: (key: string) => {
      return scenarioDataBus.getSharedData(key)
    },
  }

  const scenarioLogger = scenarioMonitor.createLogger(scenarioId)
  const loggerApi: ScenarioLoggerAPI = {
    info: scenarioLogger.info.bind(scenarioLogger),
    warn: scenarioLogger.warn.bind(scenarioLogger),
    error: scenarioLogger.error.bind(scenarioLogger),
    debug: scenarioLogger.debug.bind(scenarioLogger),
  }

  const healthReporter = scenarioMonitor.createHealthReporter(scenarioId)
  const healthApi: ScenarioHealthAPI = {
    reportCheck: healthReporter.reportCheck.bind(healthReporter),
    reportError: healthReporter.reportError.bind(healthReporter),
  }

  const sdk: ScenarioSDK = {
    shared: {
      react: sharedDeps?.modules.react as typeof React,
      reactDom: sharedDeps?.modules.reactDom as typeof import('react-dom/client'),
      zustand: sharedDeps?.modules.zustand as typeof import('zustand'),
      lucideReact: sharedDeps?.modules.lucideReact as typeof import('lucide-react'),
      xyflow: sharedDeps?.modules.xyflow as typeof import('@xyflow/react'),
      framerMotion: sharedDeps?.modules.framerMotion as typeof import('framer-motion'),
      getModule: <K extends keyof SharedDependencyRegistry>(name: K) => {
        return sharedDependencyProvider.getModule(name)
      },
    },
    style: styleApi,
    storage: storageApi,
    context: contextApi,
    dataBus: dataBusApi,
    logger: loggerApi,
    health: healthApi,
  }

  return sdk
}

export function injectScenarioSDK(sdk: ScenarioSDK): void {
  ;(window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY] = sdk
}

export function removeScenarioSDK(): void {
  delete (window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY]
}

export function getScenarioSDK(): ScenarioSDK | null {
  return (window as unknown as Record<string, unknown>)[SDK_GLOBAL_KEY] as ScenarioSDK | null
}
