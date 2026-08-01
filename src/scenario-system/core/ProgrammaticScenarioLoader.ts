/**
 * 编程式场景加载器
 *
 * 负责从磁盘加载已安装的编程式场景（ESM bundle 类型），
 * 创建 ProgrammaticScenarioModule 并注册到 ScenarioLoader。
 *
 * 加载流程：
 * 1. 读取 scenario.json 获取元数据和包类型
 * 2. 如果 packageType === 'programmatic'，使用此加载器
 * 3. 通过 scenario-bundle:// 协议 fetch ESM bundle 内容
 * 4. 重写 bare specifier import（react、zustand 等）为从 window.__AWEECLAW_SHARED__ 读取
 * 5. 用 Blob URL 动态 import 重写后的模块
 * 6. 创建 ProgrammaticScenarioModule 实例
 * 7. 注册到 scenarioLoader
 *
 * 安全策略：
 * - 仅加载已通过校验的场景包
 * - 共享依赖版本兼容性检查
 * - 样式隔离：场景样式标记 data-scenario-id，卸载时移除
 *
 * 为什么需要 bare specifier 重写？
 * - 场景 bundle 构建时把 React、zustand 等标记为 external，保留 bare specifier import
 * - 浏览器原生 ESM 不支持 bare specifier（如 `import React from "react"`）
 * - 宿主应用通过 injectSharedDependencies() 把这些依赖挂载到 window.__AWEECLAW_SHARED__
 * - 加载器负责把 bare specifier import 重写为从全局变量读取的 const 声明
 */

import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from './ScenarioLoader'
import { ProgrammaticScenarioModule } from './ProgrammaticScenarioModule'
import type { ProgrammaticScenarioConfig } from './ProgrammaticScenarioModule'
import { createScenarioSDK, injectScenarioSDK, removeScenarioSDK } from './ScenarioSDK'
import { sharedDependencyProvider, injectSharedDependencies } from './SharedDependencyProvider'
import { logger } from '@shared/toolkit/LogEngine'
import { fetchAndRewriteBundle } from '@renderer/plugins/rewriteBareSpecifiers'

interface LoadScenarioFilesResult {
  success: boolean
  error?: string
  files: Record<string, string>
  config: Record<string, unknown> | null
  scenarioDir?: string
}

let loadFilesFn: ((scenarioId: string) => Promise<LoadScenarioFilesResult>) | null = null

export function setProgrammaticLoadFunction(
  fn: (scenarioId: string) => Promise<LoadScenarioFilesResult>,
): void {
  loadFilesFn = fn
}

// 共享依赖 bare specifier 重写逻辑已提取到 @renderer/plugins/rewriteBareSpecifiers
// rewriteBareSpecifiers / fetchAndRewriteBundle 从该模块导入，避免与插件系统重复

export async function loadProgrammaticScenario(scenarioId: string): Promise<{
  success: boolean
  error?: string
}> {
  if (!loadFilesFn) {
    return { success: false, error: 'Programmatic load function not initialized' }
  }

  if (scenarioLoader.has(scenarioId)) {
    return { success: true }
  }

  try {
    const result = await loadFilesFn(scenarioId)
    if (!result.success || !result.config) {
      return { success: false, error: result.error || 'Failed to load scenario files' }
    }

    const config = result.config as unknown as ProgrammaticScenarioConfig

    if (!config.entryPoint) {
      return { success: false, error: 'Programmatic scenario missing entryPoint in scenario.json' }
    }

    const scenarioDir = result.scenarioDir
    if (!scenarioDir) {
      return { success: false, error: 'Scenario directory path not available' }
    }

    const module = new ProgrammaticScenarioModule(config)

    // 确保 shared dependencies 已注入（bootstrap.tsx 中未 await，此处兜底）
    // bundle 顶层代码会通过 window.__AWEECLAW_SHARED__ 访问 React 等，
    // 必须在 import bundle 前完成注入。
    if (!sharedDependencyProvider.isInjected()) {
      await injectSharedDependencies()
    }

    // 注入 ScenarioSDK 到 window.__AWEECLAW_SDK__
    // bundle 顶层代码（如 drawStore.ts）会通过 window.__AWEECLAW_SDK__.shared.zustand
    // 动态获取共享依赖，必须在 import bundle 前注入。
    // SDK 中的 shared 字段直接引用 sharedDependencyProvider 的模块，确保数据一致。
    // 传入 manifest 声明的 permissions，供 mcp/tools 命名空间做前置权限校验。
    const declaredPermissions = (config.permissions || []) as import('@shared/protocols/scenario-arch').ScenarioPermission[]
    const sdk = createScenarioSDK(scenarioId, config.version || '1.0.0', null, declaredPermissions)
    injectScenarioSDK(sdk)
    logger.agent.info(`[ProgrammaticLoader] Injected ScenarioSDK for "${scenarioId}" (permissions: ${declaredPermissions.join(',') || 'none'})`)

    // 使用 scenario-bundle:// 协议加载 ESM bundle
    // 该协议在 Electron 主进程中注册为 standard: true，支持 dynamic import()
    // file:// 协议在 Electron 渲染进程中被 webSecurity 阻止，无法用于 import()
    //
    // URL 构造说明：
    // - 将 Windows 反斜杠转换为正斜杠
    // - 使用 encodeURI 编码路径中的特殊字符（如空格）
    // - 必须使用 'localhost' 作为 host，否则 Chrome 解析 standard 协议时会把
    //   `scenario-bundle:///Users/liwei/...` 中的 `Users` 当作 host（会被小写化为 `users`），
    //   导致路径前导 / 丢失，最终变成 `scenario-bundle://users/liwei/...` 而 fetch 失败。
    // - 使用 `scenario-bundle://localhost/path` 格式：
    //   macOS/Linux: scenario-bundle://localhost/Users/liwei/...
    //   Windows:     scenario-bundle://localhost/C:/Users/...（handler 会剥离前导 /）
    const normalizedDir = scenarioDir.replace(/\\/g, '/')
    const encodedDir = encodeURI(normalizedDir)
    const encodedEntry = encodeURI(config.entryPoint)
    const scenarioBundleUrl = `scenario-bundle://localhost${encodedDir}/${encodedEntry}`

    // 加载 bundle 内容并重写 bare specifier import
    // 重写后的代码用 Blob URL 加载，原始 scenarioBundleUrl 保留用于样式文件加载
    const blobUrl = await fetchAndRewriteBundle(scenarioBundleUrl)

    try {
      await module.loadModule(blobUrl, scenarioBundleUrl)
    } finally {
      // 加载完成后释放 Blob URL（模块已缓存，URL 不再需要）
      URL.revokeObjectURL(blobUrl)
    }

    scenarioLoader.register(module)

    logger.agent.info(
      `[ProgrammaticLoader] Loaded programmatic scenario: ${scenarioId} v${config.version}`
    )

    return { success: true }
  } catch (err) {
    logger.agent.error(
      `[ProgrammaticLoader] Failed to load programmatic scenario "${scenarioId}":`,
      err
    )
    // 加载失败时移除 SDK，避免残留无效的 SDK 实例
    removeScenarioSDK()
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function loadAllProgrammaticScenarios(): Promise<{
  loaded: string[]
  failed: Array<{ scenarioId: string; error: string }>
}> {
  if (!loadFilesFn) {
    return { loaded: [], failed: [] }
  }

  const customScenarios = scenarioRegistry.getAll().filter(s => !s.isBuiltin)
  const loaded: string[] = []
  const failed: Array<{ scenarioId: string; error: string }> = []

  for (const scenario of customScenarios) {
    if (scenarioLoader.has(scenario.id)) {
      loaded.push(scenario.id)
      continue
    }

    try {
      const result = await loadFilesFn(scenario.id)
      if (!result.success || !result.config) continue

      const config = result.config as Record<string, unknown>
      if (config.packageType !== 'programmatic') continue

      const loadResult = await loadProgrammaticScenario(scenario.id)
      if (loadResult.success) {
        loaded.push(scenario.id)
      } else {
        failed.push({ scenarioId: scenario.id, error: loadResult.error || 'Unknown error' })
      }
    } catch (err) {
      failed.push({
        scenarioId: scenario.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { loaded, failed }
}
