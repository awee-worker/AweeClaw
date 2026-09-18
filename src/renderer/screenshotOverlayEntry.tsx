/**
 * 截图覆盖窗口 - 渲染进程入口
 *
 * 极简启动：仅加载 ScreenshotOverlay 组件
 * 不加载 Store / Router / Monaco 等重依赖
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ScreenshotOverlay } from './components/screenshot-overlay/ScreenshotOverlay'

// 注入生产环境标记（供 shared 代码使用）
globalThis.__PROD__ = import.meta.env.PROD

// 性能追踪跟随：主进程开始采样时本窗口自动上报。
// 未开启追踪时的成本只有一次订阅与一次状态查询。
void import('@intelligence/diagnostics/perfTraceAutoStart').then(({ installPerfTraceAutoStart }) =>
  installPerfTraceAutoStart()
)

const rootEl = document.getElementById('root')
if (!rootEl) {
  console.error('[ScreenshotOverlayEntry] Root element #root not found')
} else {
  const root = ReactDOM.createRoot(rootEl)
  root.render(
    <React.StrictMode>
      <ScreenshotOverlay />
    </React.StrictMode>,
  )
}
