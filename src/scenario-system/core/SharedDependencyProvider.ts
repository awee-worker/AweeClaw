/**
 * 共享依赖注入机制
 *
 * 将宿主应用的 React、zustand、lucide-react 等共享库
 * 挂载到全局 `window.__AWEECLAW_SHARED__`，使预编译的场景
 * ESM bundle 无需自行打包这些依赖，通过全局变量引用即可。
 *
 * 设计原则：
 * - 单一注册：宿主应用启动时一次性注入，场景只读取
 * - 版本锁定：记录每个共享依赖的版本号，场景可校验兼容性
 * - 按需扩展：支持动态注册新的共享模块
 * - 类型安全：提供完整的 TypeScript 类型定义
 */

import type React from 'react'
import { logger } from '@shared/toolkit/LogEngine'

export interface SharedDependencyMeta {
  version: string
  moduleName: string
}

export interface SharedDependencyRegistry {
  react: typeof React
  reactDom: typeof import('react-dom/client')
  jsxRuntime: typeof import('react/jsx-runtime')
  zustand: typeof import('zustand')
  lucideReact: typeof import('lucide-react')
  [key: string]: unknown
}

export interface SharedDependencyMap {
  modules: SharedDependencyRegistry
  meta: Record<string, SharedDependencyMeta>
  appVersion: string
  injectedAt: number
}

declare global {
  interface Window {
    __AWEECLAW_SHARED__: SharedDependencyMap | undefined
  }
}

const GLOBAL_KEY = '__AWEECLAW_SHARED__' as const

class SharedDependencyProviderClass {
  private injected = false

  inject(modules: Partial<SharedDependencyRegistry>, meta: Record<string, SharedDependencyMeta>): void {
    if (this.injected) {
      logger.agent.warn('[SharedDeps] Dependencies already injected, skipping re-injection')
      return
    }

    const appVersion = (globalThis.__APP_VERSION__ as string) || '0.0.0'

    const sharedMap: SharedDependencyMap = {
      modules: modules as SharedDependencyRegistry,
      meta,
      appVersion,
      injectedAt: Date.now(),
    }

    window.__AWEECLAW_SHARED__ = sharedMap
    this.injected = true

    const moduleNames = Object.keys(modules)
    logger.agent.info(`[SharedDeps] Injected ${moduleNames.length} shared dependencies: ${moduleNames.join(', ')}`)
  }

  get(): SharedDependencyMap | null {
    const shared = window.__AWEECLAW_SHARED__
    return shared || null
  }

  getModule<K extends keyof SharedDependencyRegistry>(name: K): SharedDependencyRegistry[K] | null {
    const shared = this.get()
    if (!shared) return null
    return (shared.modules[name] as SharedDependencyRegistry[K]) || null
  }

  getMeta(name: string): SharedDependencyMeta | null {
    const shared = this.get()
    if (!shared) return null
    return shared.meta[name] || null
  }

  isInjected(): boolean {
    return this.injected
  }

  getSharedGlobalVarName(): string {
    return GLOBAL_KEY
  }

  checkCompatibility(requiredVersions: Record<string, string>): {
    compatible: boolean
    mismatches: Array<{ module: string; required: string; actual: string }>
  } {
    const shared = this.get()
    const mismatches: Array<{ module: string; required: string; actual: string }> = []

    if (!shared) {
      return { compatible: false, mismatches: Object.keys(requiredVersions).map(m => ({ module: m, required: requiredVersions[m], actual: 'not-injected' })) }
    }

    for (const [moduleName, requiredVersion] of Object.entries(requiredVersions)) {
      const meta = shared.meta[moduleName]
      if (!meta) {
        mismatches.push({ module: moduleName, required: requiredVersion, actual: 'not-found' })
        continue
      }
      if (!this.versionSatisfies(meta.version, requiredVersion)) {
        mismatches.push({ module: moduleName, required: requiredVersion, actual: meta.version })
      }
    }

    return { compatible: mismatches.length === 0, mismatches }
  }

  private versionSatisfies(actual: string, required: string): boolean {
    if (required.startsWith('^')) {
      const reqParts = required.slice(1).split('.').map(Number)
      const actParts = actual.split('.').map(Number)
      return actParts[0] === reqParts[0] && actParts[1] >= reqParts[1]
    }
    if (required.startsWith('>=')) {
      return this.compareVersions(actual, required.slice(2)) >= 0
    }
    return actual === required
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0
      const nb = pb[i] || 0
      if (na !== nb) return na - nb
    }
    return 0
  }
}

export const sharedDependencyProvider = new SharedDependencyProviderClass()

export async function injectSharedDependencies(): Promise<void> {
  if (sharedDependencyProvider.isInjected()) return

  try {
    const [react, reactDom, jsxRuntime, zustand, lucideReact] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('react/jsx-runtime'),
      import('zustand'),
      import('lucide-react'),
    ])

    const modules: Partial<SharedDependencyRegistry> = {
      react: react.default || react,
      reactDom: reactDom,
      jsxRuntime: jsxRuntime,
      zustand: zustand,
      lucideReact: lucideReact,
    }

    const meta: Record<string, SharedDependencyMeta> = {
      react: { version: react.version || '18.0.0', moduleName: 'react' },
      reactDom: { version: '18.0.0', moduleName: 'react-dom' },
      jsxRuntime: { version: react.version || '18.0.0', moduleName: 'react/jsx-runtime' },
      zustand: { version: '5.0.0', moduleName: 'zustand' },
      lucideReact: { version: '0.400.0', moduleName: 'lucide-react' },
    }

    sharedDependencyProvider.inject(modules, meta)
  } catch (err) {
    logger.agent.error('[SharedDeps] Failed to inject shared dependencies:', err)
  }
}
