/**
 * Bare Specifier 重写工具 — 从 ProgrammaticScenarioLoader 提取的共享逻辑
 *
 * 作用：把 ESM bundle 中的 bare specifier import（如 `import React from "react"`）
 * 重写为从 `window.__AWEECLAW_SHARED__.modules` 读取的 const 声明，
 * 使浏览器原生 ESM 能加载包含 bare specifier 的 bundle。
 *
 * 被场景系统（ProgrammaticScenarioLoader）和插件系统（PluginUiRegistry）共用。
 *
 * @module shared/bareSpecifierRewriter
 */

/**
 * 共享依赖 bare specifier → 全局模块 key 映射
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
 * - 自定义协议（scenario-bundle://、plugin-bundle://、blob: 等）
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
 */
function convertNamedImportToDestructure(item: string): string {
  const trimmed = item.trim()
  // 用 [$\w] 而非 \w：JavaScript 标识符可包含 $（esbuild 压缩后常用 $ 作变量名，如 jsxs as $）
  const asMatch = trimmed.match(/^([$\w]+)\s+as\s+([$\w]+)$/)
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
 * 1. import D from "spec";        → const { default: D } = __shared__.modules.spec;
 * 2. import { a, b as c } from "spec";  → const { a, b: c } = __shared__.modules.spec;
 * 3. import D, { a, b as c } from "spec"; → const { default: D, a, b: c } = __shared__.modules.spec;
 * 4. import * as N from "spec";   → const N = __shared__.modules.spec;
 * 5. import "spec";               → （移除，共享依赖无 side-effect）
 *
 * 只处理在 SHARED_DEPS_MAP 中的 bare specifier，其他 import 保持原样。
 */
export function rewriteBareSpecifiers(code: string): string {
  // 1. 处理 side-effect import: import "spec";（共享依赖无 side-effect，直接移除）
  // 用 \bimport\s* 而非 import\s+：esbuild 压缩后会移除 import 与后续 token 之间的空格
  // （如 import"react"），\s* 兼容零空格和有空格两种形式；\b 防止匹配 myimport 等标识符。
  const sideEffectRegex = /\bimport\s*["']([^"']+)["'];?/g
  code = code.replace(sideEffectRegex, (match, specifier: string) => {
    if (!isSharedDep(specifier)) return match
    return ''
  })

  // 2. 处理带 from 的 import 语句（支持跨行）
  // 同样用 \bimport\s*：兼容压缩产物 import{...}from"react"（无空格）和
  // 正常产物 import {...} from "react"（有空格）两种形式。
  // 用 [$\w] 而非 \w：JavaScript 标识符可包含 $（esbuild 压缩后常用 $ 作变量名）
  const importRegex =
    /\bimport\s*(?:(\*\s+as\s+[$\w]+)|([$\w]+)\s*,\s*\{([\s\S]*?)\}|([$\w]+)|\{([\s\S]*?)\})\s*from\s*["']([^"']+)["'];?/g

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

      const destructureParts: string[] = []

      // default + named: import D, { a, b as c } from "spec";
      if (defaultWithNamedImp) {
        destructureParts.push(`default: ${defaultWithNamedImp}`)
        if (namedWithDefault) {
          const named = namedWithDefault.split(',').map((s) => s.trim()).filter(Boolean)
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
        const named = namedOnlyImp.split(',').map((s) => s.trim()).filter(Boolean)
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
 * 从 bundle URL 加载内容，重写 bare specifier 后用 Blob URL 加载
 *
 * 为什么不直接 import(bundleUrl)？
 * - bundle 中保留了 `import React from "react"` 等 bare specifier
 * - 浏览器原生 ESM 不支持 bare specifier，会报 "Failed to resolve module specifier"
 * - 必须先把 bare specifier 重写为从 window.__AWEECLAW_SHARED__ 读取的 const 声明
 *
 * 为什么用 Blob URL 而非 data URL？
 * - data URL 有 URL 长度限制（Chrome 约 2MB），大 bundle 可能超限
 * - Blob URL 无大小限制，且对 ESM import() 完全兼容
 *
 * @param bundleUrl plugin-bundle:// 或 scenario-bundle:// 协议的 URL（用于 fetch 原始内容）
 * @returns 重写后的 Blob URL（用于 dynamic import）
 */
export async function fetchAndRewriteBundle(bundleUrl: string): Promise<string> {
  const response = await fetch(bundleUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch bundle: HTTP ${response.status} ${response.statusText}`)
  }

  const bundleCode = await response.text()
  const rewrittenCode = rewriteBareSpecifiers(bundleCode)

  const blob = new Blob([rewrittenCode], { type: 'application/javascript' })
  return URL.createObjectURL(blob)
}

/**
 * 构造 plugin-bundle:// 协议的 URL
 *
 * URL 构造说明（与 scenario-bundle 一致）：
 * - 将 Windows 反斜杠转换为正斜杠
 * - 使用 encodeURI 编码路径中的特殊字符（如空格）
 * - 必须使用 'localhost' 作为 host，否则 Chrome 解析 standard 协议时会把
 *   路径中的首段当作 host（会被小写化），导致路径前导 / 丢失而 fetch 失败。
 *
 * @param absDir 绝对目录路径（插件安装目录）
 * @param entry 相对入口文件名（如 "ui.js"）
 * @returns plugin-bundle://localhost/<encodedAbsDir>/<encodedEntry>
 */
export function buildPluginBundleUrl(absDir: string, entry: string): string {
  const normalizedDir = absDir.replace(/\\/g, '/')
  const encodedDir = encodeURI(normalizedDir)
  const encodedEntry = encodeURI(entry)
  return `plugin-bundle://localhost${encodedDir}/${encodedEntry}`
}
