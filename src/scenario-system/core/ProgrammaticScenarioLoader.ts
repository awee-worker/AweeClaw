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
import { buildLocalFileUrl } from '@shared/protocols/bundleUrl'
import { scenarioLoader } from './ScenarioLoader'
import { ProgrammaticScenarioModule } from './ProgrammaticScenarioModule'
import type { ProgrammaticScenarioConfig } from './ProgrammaticScenarioModule'
import { createScenarioSDK, injectScenarioSDK, removeScenarioSDK } from './ScenarioSDK'
import { sharedDependencyProvider, injectSharedDependencies } from './SharedDependencyProvider'
import { logger } from '@shared/toolkit/LogEngine'
import { fetchAndRewriteBundle } from '@renderer/plugins/rewriteBareSpecifiers'
import { useStore } from '@renderer/state'
import { unregisterScenarioI18n } from '@renderer/i18n/i18nSetup'

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

export async function loadProgrammaticScenario(
  scenarioId: string,
  options: { force?: boolean } = {},
): Promise<{
  success: boolean
  error?: string
}> {
  if (!loadFilesFn) {
    return { success: false, error: 'Programmatic load function not initialized' }
  }

  // force 表示「以磁盘上的 bundle 为准重新加载」，场景更新后走这条路径。
  // 不先摘掉旧模块的话，下面的 has() 会直接返回成功，进程内继续跑旧 bundle：
  // 界面版本号已经是新的、功能却还是旧的，只有重启才会恢复。
  if (options.force) {
    await unloadProgrammaticScenario(scenarioId)
  } else if (scenarioLoader.has(scenarioId)) {
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
    // 场景的 context.workspacePath 决定它自己的产物（素材、导出）落在哪里。
    // 传 null 会让场景退化成相对路径（如 assets/xxx.mp4），写入与预览都指向
    // 进程工作目录而不是用户工作空间，表现为「导入成功但预览加载失败」。
    const resolveWorkspacePath = (): string | null => useStore.getState().workspacePath ?? null
    const sdk = createScenarioSDK(
      scenarioId,
      config.version || '1.0.0',
      resolveWorkspacePath(),
      declaredPermissions,
      resolveWorkspacePath,
    )
    injectScenarioSDK(sdk)
    logger.agent.info(`[ProgrammaticLoader] Injected ScenarioSDK for "${scenarioId}" (permissions: ${declaredPermissions.join(',') || 'none'})`)

    // 使用 scenario-bundle:// 协议加载 ESM bundle
    // 该协议在 Electron 主进程中注册为 standard: true，支持 dynamic import()
    // file:// 协议在 Electron 渲染进程中被 webSecurity 阻止，无法用于 import()
    //
    // URL 构造统一由 buildLocalFileUrl 负责：host 固定 localhost，绝对路径必须带
    // 前导 / 才会落在 pathname 上。Windows 的 C:/Users/... 缺少这个斜杠，
    // 直接拼接会让 host 变成 localhostC 并丢掉盘符，协议处理器读文件返回 404。
    //   macOS/Linux: scenario-bundle://localhost/Users/liwei/...
    //   Windows:     scenario-bundle://localhost/C:/Users/...（handler 会剥离前导 /）
    const scenarioBundleUrl = buildLocalFileUrl('scenario-bundle', scenarioDir, config.entryPoint)

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

/**
 * 卸载已加载的编程式场景
 *
 * 场景更新只替换磁盘文件，进程内的模块不会自动失效。不摘掉旧模块就直接
 * 重新注册，ScenarioLoader.register 在场景处于激活态时会直接 return，
 * 表现为「更新成功、版本号也变了，功能还是旧的」，只有重启才恢复。
 *
 * 清理顺序有讲究：
 * 1. 激活中的场景 unregister 会被拒绝，必须先 deactivate
 * 2. 样式是挂在 document 上的 <link data-scenario-id>，ScenarioLoader 不负责
 *    摘除，必须由模块自己清理，否则新旧样式会叠加
 * 3. 最后再 unregister，清掉工具注册、数据总线、版本与监控记录
 *
 * @returns 是否确实卸载了某个模块
 */
export async function unloadProgrammaticScenario(scenarioId: string): Promise<boolean> {
  if (!scenarioLoader.has(scenarioId)) return false

  const entry = scenarioLoader.getEntry(scenarioId)
  const state = scenarioLoader.getState(scenarioId)

  if (state === 'activated' || state === 'activating') {
    await scenarioLoader.deactivate(scenarioId)
  }

  // removeStyles 只有编程式模块提供，用鸭子类型调用避免耦合到具体实现类
  const module = entry?.module as { removeStyles?: () => void } | undefined
  try {
    module?.removeStyles?.()
  } catch (err) {
    logger.agent.warn(`[ProgrammaticLoader] removeStyles failed for "${scenarioId}":`, err)
  }

  const removed = scenarioLoader.unregister(scenarioId)
  if (!removed) {
    logger.agent.warn(
      `[ProgrammaticLoader] Could not unregister "${scenarioId}" in state: ${scenarioLoader.getState(scenarioId)}`,
    )
    return false
  }

  // 翻译与 SDK 都是进程级单例，旧版本留下的条目不清掉，新版本重新注册时会读到旧文案
  unregisterScenarioI18n(scenarioId)
  removeScenarioSDK()

  logger.agent.info(`[ProgrammaticLoader] Unloaded programmatic scenario: ${scenarioId}`)
  return true
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
