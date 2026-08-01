/**
 * PluginBoundary — 插件 UI 错误边界 + Suspense
 *
 * 隔离插件 UI 渲染失败对主应用的影响。
 * 单个插件崩溃时显示降级 UI，不影响其他插件和主界面。
 *
 * @module renderer/plugins/PluginBoundary
 */

import { Component, Suspense, type ReactNode } from 'react'

interface PluginBoundaryProps {
  /** 插件标识（用于错误提示） */
  pluginKey: string
  children: ReactNode
}

interface PluginBoundaryState {
  hasError: boolean
  error?: Error
}

class PluginErrorBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
  constructor(props: PluginBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): PluginBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[PluginBoundary] Plugin "${this.props.pluginKey}" crashed:`, error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <p className="text-[12px] text-status-error mb-1">
            {this.props.pluginKey} 插件 UI 加载失败
          </p>
          <p className="text-[12px] text-text-muted opacity-70">
            {this.state.error?.message || '未知错误'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * 插件 UI 渲染包装器
 *
 * 用法：
 * <PluginBoundary pluginKey="ai-macro-recorder">
 *   <MacroPanel host={host} />
 * </PluginBoundary>
 */
export function PluginBoundary({ pluginKey, children }: PluginBoundaryProps) {
  return (
    <PluginErrorBoundary pluginKey={pluginKey}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-[12px] text-text-muted opacity-60">加载中...</div>
          </div>
        }
      >
        {children}
      </Suspense>
    </PluginErrorBoundary>
  )
}
