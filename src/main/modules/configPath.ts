/**
 * 配置路径管理器 — 用户级与工作区级配置文件路径统一管理
 *
 * 设计理念：
 * - 双层配置：用户级（全局）+ 工作区级（项目内 .aweeclaw/）
 * - 路径校验：自动检测目录存在性，避免无效路径
 * - 缓存机制：bootstrap store 单例缓存，避免重复创建
 * - 沙箱隔离：每个 scope 独立的 electron-store 实例
 * - 路径安全：规范化路径分隔符，防止跨平台问题
 * - 可观测性：路径变更时记录日志
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import { BRAND } from '@shared/brand'
import { logger } from '@shared/toolkit/LogEngine'

/** bootstrap store 名称 */
const BOOTSTRAP_STORE_NAME = 'bootstrap'

/** 自定义配置路径的存储键 */
const CUSTOM_PATH_KEY = 'customConfigPath'

/** bootstrap store 单例（懒加载） */
let bootstrapStoreInstance: Store<Record<string, unknown>> | null = null

/**
 * 创建 bootstrap store 实例
 *
 * 使用单例模式，避免重复创建导致的数据不一致
 */
function createBootstrapStore(): Store<Record<string, unknown>> {
  if (bootstrapStoreInstance) {
    return bootstrapStoreInstance
  }

  bootstrapStoreInstance = new Store<Record<string, unknown>>({
    name: BOOTSTRAP_STORE_NAME,
  })
  return bootstrapStoreInstance
}

/**
 * 规范化路径分隔符（跨平台兼容）
 *
 * @param rawPath 原始路径
 * @returns 规范化后的绝对路径
 */
function normalizePath(rawPath: string): string {
  return path.resolve(path.normalize(rawPath))
}

/**
 * 校验目录是否存在且可访问
 *
 * @param targetPath 目标路径
 * @returns 存在则返回规范化路径，否则 undefined
 */
function resolveExistingDirectory(targetPath: string | undefined): string | undefined {
  if (!targetPath || typeof targetPath !== 'string') {
    return undefined
  }

  const normalized = normalizePath(targetPath)
  try {
    if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
      return normalized
    }
  } catch (err) {
    logger.system.warn('[configPath] 目录访问失败', { path: normalized, error: String(err) })
  }

  return undefined
}

/**
 * 获取 bootstrap store 实例
 *
 * @returns bootstrap store
 */
export function getBootstrapStore(): Store<Record<string, unknown>> {
  return createBootstrapStore()
}

/**
 * 获取用户自定义配置路径
 *
 * @param store bootstrap store 实例（默认使用单例）
 * @returns 自定义路径（已校验存在），未设置或不存在则返回 undefined
 */
export function getCustomConfigPath(
  store: Store<Record<string, unknown>> = getBootstrapStore(),
): string | undefined {
  return resolveExistingDirectory(store.get(CUSTOM_PATH_KEY) as string | undefined)
}

/**
 * 获取 electron-store 的初始化选项
 *
 * @param name store 名称
 * @param store bootstrap store 实例
 * @returns store 选项（含可选 cwd）
 */
export function getStoreOptions(
  name: string,
  store: Store<Record<string, unknown>> = getBootstrapStore(),
): { name: string; cwd?: string } {
  const cwd = getCustomConfigPath(store)
  return cwd ? { name, cwd } : { name }
}

/**
 * 创建作用域隔离的 store 实例
 *
 * @param name store 名称
 * @param store bootstrap store 实例
 * @returns 新的 store 实例
 */
export function createScopedStore(
  name: string,
  store: Store<Record<string, unknown>> = getBootstrapStore(),
): Store<Record<string, unknown>> {
  return new Store<Record<string, unknown>>(getStoreOptions(name, store))
}

/**
 * 获取用户配置目录
 *
 * 优先使用自定义路径，否则回退到 Electron 默认的 userData 目录
 *
 * @param store bootstrap store 实例
 * @returns 用户配置目录绝对路径
 */
export function getUserConfigDir(
  store: Store<Record<string, unknown>> = getBootstrapStore(),
): string {
  return getCustomConfigPath(store) ?? app.getPath('userData')
}

/**
 * 设置用户自定义配置路径
 *
 * @param newPath 新的配置路径
 * @param store bootstrap store 实例
 * @throws 如果路径不存在或不可访问
 */
export function setUserConfigDir(
  newPath: string,
  store: Store<Record<string, unknown>> = getBootstrapStore(),
): void {
  const normalized = normalizePath(newPath)

  if (!fs.existsSync(normalized)) {
    throw new Error(`[configPath] 配置路径不存在: ${normalized}`)
  }

  store.set(CUSTOM_PATH_KEY, normalized)
  logger.system.info('[configPath] 用户配置路径已更新', { path: normalized })
}

/**
 * 获取用户级配置文件的完整路径
 *
 * @param filename 文件名
 * @param subdir 子目录（可选）
 * @param store bootstrap store 实例
 * @returns 配置文件绝对路径
 */
export function getConfigFilePath(
  filename: string,
  subdir?: string,
  store?: Store<Record<string, unknown>>,
): string {
  const baseDir = getUserConfigDir(store)
  return subdir ? path.join(baseDir, subdir, filename) : path.join(baseDir, filename)
}

/**
 * 获取工作区级配置文件的完整路径
 *
 * 工作区配置存储在项目根目录下的 `.aweeclaw/` 子目录中
 *
 * @param workspaceRoot 工作区根目录
 * @param filename 文件名
 * @param subdir 子目录（可选）
 * @returns 工作区配置文件绝对路径
 */
export function getWorkspaceConfigFilePath(
  workspaceRoot: string,
  filename: string,
  subdir?: string,
): string {
  const base = path.join(workspaceRoot, BRAND.dirName)
  return subdir ? path.join(base, subdir, filename) : path.join(base, filename)
}

/**
 * 确保工作区配置目录存在
 *
 * @param workspaceRoot 工作区根目录
 * @param subdir 子目录（可选）
 * @returns 配置目录路径
 */
export function ensureWorkspaceConfigDir(
  workspaceRoot: string,
  subdir?: string,
): string {
  const dir = subdir
    ? path.join(workspaceRoot, BRAND.dirName, subdir)
    : path.join(workspaceRoot, BRAND.dirName)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  return dir
}

/** 配置文件名常量 */
export const CONFIG_FILES = {
  /** 主配置文件 */
  MAIN: 'config.json',
  /** MCP 服务器配置文件 */
  MCP: 'mcp.json',
  /** 设置子目录 */
  SETTINGS_DIR: 'settings',
} as const

/** 配置文件类型 */
export type ConfigFileKey = keyof typeof CONFIG_FILES
