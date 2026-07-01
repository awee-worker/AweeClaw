import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/globals.css'
import { logger } from '@toolkit/LogEngine'
import { injectSharedDependencies } from '@scenario-system/core/SharedDependencyProvider'

// 注入生产环境标记（供 shared 代码使用）
// 必须在 Logger 首次使用前设置，确保生产环境检测正确
globalThis.__PROD__ = import.meta.env.PROD

// 刷新 Logger 的生产环境检测（确保配置已更新）
logger.refreshProductionMode()

injectSharedDependencies()

// ============================================
// 主应用入口
// ============================================

// 性能优化：延迟加载 Monaco worker 配置
// Monaco 是最大的依赖，延迟到实际需要时再初始化
const initMonaco = () => import('./monacoWorkerEntry')

// 延迟加载主应用
const App = React.lazy(() => import('./AweeApp'))

// 轻量级骨架屏组件（在 App 加载期间显示）
// HTML 中已有加载动画，这里返回 null 避免闪烁
function AppSkeleton() {
  return null
}

/** 顶层错误边界：捕获渲染异常，移除加载动画并展示错误信息 */
class TopLevelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.system.error('[Bootstrap] Render crashed:', error, info.componentStack)
    // 移除加载动画，让错误信息可见
    const loader = document.getElementById('initial-loader')
    if (loader) loader.remove()
    const rootEl = document.getElementById('root')
    if (rootEl) rootEl.classList.add('ready')
  }

  render() {
    if (this.state.error) {
      return React.createElement(
        'div',
        {
          style: {
            padding: '32px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#ff6b6b',
            background: '#1a1a1a',
            minHeight: '100vh',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          },
        },
        `Application failed to start:\n\n${this.state.error.message}\n\n${this.state.error.stack ?? ''}`,
      )
    }
    return this.props.children
  }
}

// 启动应用
const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <TopLevelErrorBoundary>
      <React.Suspense fallback={<AppSkeleton />}>
        <App />
      </React.Suspense>
    </TopLevelErrorBoundary>
  </React.StrictMode>
)

// 空闲时预加载 Monaco
if ('requestIdleCallback' in window) {
  const requestIdleCallback = (window as Window & { requestIdleCallback: typeof globalThis.requestIdleCallback }).requestIdleCallback
  requestIdleCallback(() => initMonaco(), { timeout: 2000 })
} else {
  setTimeout(initMonaco, 100)
}
