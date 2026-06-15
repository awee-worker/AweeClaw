/**
 * 安全懒加载工具
 *
 * 场景组件可能被卸载/删除，共享层不应因缺少场景组件而崩溃。
 * safeLazy 包裹 React.lazy，import 失败时渲染空组件。
 *
 * 使用 /* @vite-ignore *​/ 告诉 Vite 跳过对该 import 的静态分析，
 * 避免场景目录被删除后 Vite 预处理阶段报 "Failed to resolve import" 错误。
 */
import { lazy, type ComponentType } from 'react'

/** 无渲染回退组件 */
function NoRender(): null {
  return null
}

type SafeLazyOptions = {
  /** 错误日志上下文，如 'OnboardingWizard' */
  label?: string
  /** 失败时是否静默（不输出日志），默认 false */
  silent?: boolean
}

/**
 * 安全懒加载组件
 *
 * @param importFn 动态 import 函数，内部需包含 /* @vite-ignore *​/ 注释
 * @param options 选项
 *
 * @example
 * const OnboardingWizard = safeLazy(
 *   () => import(/* @vite-ignore *​/ '@scenarios/dev-assistant/components/OnboardingWizard'),
 *   { label: 'OnboardingWizard' }
 * )
 */
export function safeLazy<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  options: SafeLazyOptions = {}
): React.LazyExoticComponent<ComponentType<any>> {
  const { label, silent } = options

  return lazy(() =>
    importFn().catch((err: unknown) => {
      if (!silent) {
        console.warn(`[safeLazy] Failed to load${label ? ` ${label}` : ''}:`, (err as Error)?.message ?? err)
      }
      return { default: NoRender as unknown as T }
    })
  )
}

/**
 * 安全懒加载命名导出组件
 *
 * @param importFn 动态 import 函数，返回模块对象
 * @param exportName 命名导出名称
 * @param options 选项
 *
 * @example
 * const PdfPreview = safeNamedLazy(
 *   () => import(/* @vite-ignore *​/ '@scenarios/dev-assistant/components/editor/DocumentPreview'),
 *   'PdfPreview',
 *   { label: 'PdfPreview' }
 * )
 */
export function safeNamedLazy<T extends ComponentType<any>>(
  importFn: () => Promise<Record<string, any>>,
  exportName: string,
  options: SafeLazyOptions = {}
): React.LazyExoticComponent<ComponentType<any>> {
  return safeLazy(
    () => importFn().then(m => ({ default: (m[exportName] || NoRender) as T })),
    options
  )
}

export { NoRender }