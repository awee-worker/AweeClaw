/**
 * 应用 Store 初始化与统一访问
 *
 * - bootstrapStore：启动期配置（窗口位置、引导状态等）
 * - configStore：用户级配置（语言、主题、安全策略、最近工作区等）
 *
 * 两者均通过 electron-store 持久化到 userData 目录，由 configPath 模块统一管理路径。
 */
import type Store from 'electron-store'
import { createScopedStore, getBootstrapStore } from '../modules/configPath'

let bootstrapStore: Store<Record<string, unknown>> | null = null
let configStore: Store<Record<string, unknown>> | null = null

/** 初始化 Store，必须在所有依赖 Store 的模块加载前完成 */
export async function initStores(): Promise<void> {
  bootstrapStore = getBootstrapStore()
  configStore = createScopedStore('config', bootstrapStore)
}

/** 获取 bootstrapStore（仅在初始化后可用） */
export function getBootstrapStoreInstance(): Store<Record<string, unknown>> {
  if (!bootstrapStore) {
    throw new Error('[stores] bootstrapStore accessed before initStores()')
  }
  return bootstrapStore
}

/** 获取 configStore（仅在初始化后可用） */
export function getConfigStore(): Store<Record<string, unknown>> {
  if (!configStore) {
    throw new Error('[stores] configStore accessed before initStores()')
  }
  return configStore
}

/**
 * 兼容旧调用：IPC 处理器早期通过 key 名请求 Store，
 * 当前所有配置统一在 configStore，故忽略 key 直接返回 configStore。
 */
export function resolveStore(_key: string): Store<Record<string, unknown>> {
  return getConfigStore()
}
