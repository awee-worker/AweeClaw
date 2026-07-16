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

// ============================================
// 共享依赖 bare specifier → 全局模块 key 映射
// ============================================

/**
 * 场景 bundle 中标记为 external 的共享依赖映射表
 *
 * key: bundle 中的 bare module specifier（与 esbuild external 配置一致）
 * value: window.__AWEECLAW_SHARED__.modules 中的模块 key
 *        （与 SharedDependencyProvider.ts 中的 SharedDependencyRegistry 一致）
 */
const SHARED_DEPS_MAP: Record<string, string> = {
  'react': 'react',
  'react-dom': 'reactDom',
  'react-dom/client': 'reactDom',
  'react/jsx-runtime': 'jsxRuntime',
  'zustand': 'zustand',
  'lucide-react': 'lucideReact',
  '@xyflow/react': 'xyflow',
  '@xyflow/react/system': 'xyflow',
  'framer-motion': 'framerMotion',
}

/**
 * 判断模块 specifier 是否是需要重写的 bare specifier
 *
 * 以下情况不重写：
 * - 相对路径（./xxx、../xxx）
 * - 绝对路径（/xxx）
 * - URL（http://、https://）
 * - scenario-bundle://、blob: 等自定义协议
 * - 不在 SHARED_DEPS_MAP 中的 bare specifier（保持原样，让浏览器报错）
 */
function isSharedDep(specifier: string): boolean {
  return specifier in SHARED_DEPS_MAP
}

/**
 * 获取共享依赖在 window.__AWEECLAW_SHARED__.modules 中的访问表达式
 */
function getSharedExpr(specifier: string): string {
  const key = SHARED_DEPS_MAP[specifier]
  return `window.__AWEECLAW_SHARED__.modules.${key}`
}

/**
 * 把 named import 项转换为解构赋值片段
 *
 * ESM import 语法与解构赋值语法在别名上不同：
 * - import 语法：`import { memo as memo2 }` （用 as）
 * - 解构赋值语法：`const { memo: memo2 }` （用冒号）
 *
 * 因此需要把 `a as b` 转换为 `a: b`，没有 as 的项保持原样。
 *
 * 示例：
 * - "memo" → "memo"
 * - "memo as memo2" → "memo: memo2"
 * - "Map as Map2" → "Map: Map2"
 */
function convertNamedImportToDestructure(item: string): string {
  const trimmed = item.trim()
  // 匹配 `name as alias` 格式
  const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/)
  if (asMatch) {
    return `${asMatch[1]}: ${asMatch[2]}`
  }
  return trimmed
}

/**
 * 重写 ESM bundle 中的 bare specifier import 语句
 *
 * 把 `import React from "react"` 等 bare specifier import
 * 重写为从 `window.__AWEECLAW_SHARED__` 读取的 const 声明。
 *
 * 支持的 import 格式（含跨行）：
 * 1. import D from "spec";
 *    → const { default: D } = __shared__.modules.spec;
 * 2. import { a, b as c } from "spec";
 *    → const { a, b: c } = __shared__.modules.spec;
 * 3. import D, { a, b as c } from "spec";
 *    → const { default: D, a, b: c } = __shared__.modules.spec;
 * 4. import * as N from "spec";
 *    → const N = __shared__.modules.spec;
 * 5. import "spec";
 *    → （移除，共享依赖无 side-effect）
 *
 * 只处理在 SHARED_DEPS_MAP 中的 bare specifier，其他 import 保持原样。
 */
function rewriteBareSpecifiers(code: string): string {
  // 1. 处理 side-effect import: import "spec";
  //    共享依赖无 side-effect，直接移除
  const sideEffectRegex = /import\s+["']([^"']+)["'];?/g
  code = code.replace(sideEffectRegex, (match, specifier: string) => {
    if (!isSharedDep(specifier)) return match
    return ''
  })

  // 2. 处理带 from 的 import 语句（支持跨行）
  //    正则说明：
  //    - import\s+ 匹配 import 关键字后跟空白
  //    - 分支1: (\*\s+as\s+\w+) → namespace import（如 * as N）
  //    - 分支2: (\w+)\s*,\s*\{([\s\S]*?)\} → default + named（如 D, { a, b }）
  //    - 分支3: (\w+) → default only（如 D）
  //    - 分支4: \{([\s\S]*?)\} → named only（如 { a, b }）
  //    - \s*from\s*["']([^"']+)["'] 匹配 from "specifier"
  //    - [\s\S]*? 非贪婪匹配花括号内容，支持跨行
  const importRegex =
    /import\s+(?:(\*\s+as\s+\w+)|(\w+)\s*,\s*\{([\s\S]*?)\}|(\w+)|\{([\s\S]*?)\})\s*from\s*["']([^"']+)["'];?/g

  code = code.replace(
    importRegex,
    (
      match: string,
      namespaceImp: string | undefined,
      defaultWithNamedImp: string | undefined,
      namedWithDefault: string | undefined,
      defaultOnlyImp: string | undefined,
      namedOnlyImp: string | undefined,
      specifier: string,
    ) => {
      if (!isSharedDep(specifier)) return match

      const sharedExpr = getSharedExpr(specifier)

      // namespace import: import * as N from "spec";
      if (namespaceImp) {
        const name = namespaceImp.replace(/\*\s+as\s+/, '')
        return `const ${name} = ${sharedExpr};`
      }

      // 收集解构片段
      const destructureParts: string[] = []

      // default + named: import D, { a, b as c } from "spec";
      if (defaultWithNamedImp) {
        destructureParts.push(`default: ${defaultWithNamedImp}`)
        if (namedWithDefault) {
          const named = namedWithDefault
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          for (const item of named) {
            destructureParts.push(convertNamedImportToDestructure(item))
          }
        }
      }

      // default only: import D from "spec";
      if (defaultOnlyImp) {
        destructureParts.push(`default: ${defaultOnlyImp}`)
      }

      // named only: import { a, b as c } from "spec";
      if (namedOnlyImp) {
        const named = namedOnlyImp
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        for (const item of named) {
          destructureParts.push(convertNamedImportToDestructure(item))
        }
      }

      if (destructureParts.length > 0) {
        return `const { ${destructureParts.join(', ')} } = ${sharedExpr};`
      }

      return match
    },
  )

  return code
}

/**
 * 从 scenario-bundle:// URL 加载 bundle 内容，重写 bare specifier 后用 Blob URL 加载
 *
 * 为什么不直接 import(scenarioBundleUrl)？
 * - bundle 中保留了 `import React from "react"` 等 bare specifier
 * - 浏览器原生 ESM 不支持 bare specifier，会报 "Failed to resolve module specifier"
 * - 必须先把 bare specifier 重写为从 window.__AWEECLAW_SHARED__ 读取的 const 声明
 *
 * 为什么用 Blob URL 而非 data URL？
 * - data URL 有 URL 长度限制（Chrome 约 2MB），大 bundle 可能超限
 * - Blob URL 无大小限制，且对 ESM import() 完全兼容
 *
 * @param scenarioBundleUrl scenario-bundle:// 协议的 URL（用于 fetch 原始内容）
 * @returns 重写后的 Blob URL（用于 dynamic import）
 */
async function fetchAndRewriteBundle(scenarioBundleUrl: string): Promise<string> {
  const response = await fetch(scenarioBundleUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: HTTP ${response.status} ${response.statusText}`)
  }

  const bundleCode = await response.text()
  const rewrittenCode = rewriteBareSpecifiers(bundleCode)

  const blob = new Blob([rewrittenCode], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

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
    const sdk = createScenarioSDK(scenarioId, config.version || '1.0.0', null)
    injectScenarioSDK(sdk)
    logger.agent.info(`[ProgrammaticLoader] Injected ScenarioSDK for "${scenarioId}"`)

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
