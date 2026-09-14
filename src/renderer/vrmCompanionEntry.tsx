/**
 * VRM 桌面伴侣窗口 - 渲染进程入口
 *
 * 与主窗口 bootstrap.tsx / 头像窗口 avatarEntry.tsx 的区别：
 * - 极简启动：只加载 3D 渲染所需的依赖（Three.js + three-vrm），
 *   不引入 Monaco / 插件注册表 / 场景系统 / 主窗口 Store
 * - 独立 React 根：仅挂载 VrmCompanionApp
 * - 透明窗口适配：无加载动画，避免白屏闪烁
 *
 * 通信约定：全部通过 IPC（electronAPI.vrmCompanion.*），不直接访问 @store。
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { logger } from '@shared/toolkit/LogEngine'

// 加载全局样式（Tailwind CSS + CSS 变量），保证与主窗口 / 头像窗口风格一致。
// vrm-companion.html 的 `background: transparent !important` 会覆盖 globals.css 的 body 背景，
// 确保透明窗口不受影响。
import './styles/globals.css'

// 注入生产环境标记（供 shared 代码使用，必须在 Logger 首次使用前设置）
globalThis.__PROD__ = import.meta.env.PROD
logger.refreshProductionMode()

/** 顶层错误边界：3D 渲染异常时不让窗口白屏 */
class VrmErrorBoundary extends React.Component<
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
    logger.system.error('[VrmCompanionEntry] Render crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      // 出错时保持窗口透明可见（不显示误导性内容），日志已记录
      return null
    }
    return this.props.children
  }
}

// 延迟加载主组件（code-split，缩小初始包体积）
const VrmCompanionApp = React.lazy(() =>
  import('./components/vrm-companion/VrmCompanionApp').then((m) => ({
    default: m.VrmCompanionApp,
  })),
)

/** 移除加载占位 */
function removeLoader() {
  const loader = document.getElementById('vrm-loader')
  if (loader) loader.remove()
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  logger.system.error('[VrmCompanionEntry] Root element #root not found')
} else {
  const root = ReactDOM.createRoot(rootEl)
  root.render(
    <React.StrictMode>
      <VrmErrorBoundary>
        <React.Suspense fallback={null}>
          <VrmCompanionApp onReady={removeLoader} />
        </React.Suspense>
      </VrmErrorBoundary>
    </React.StrictMode>,
  )
}
