/**
 * PPT 预览窗口 - 渲染进程入口
 *
 * 独立 React 根，不引入主窗口的 Store / Router。
 * 通过 IPC（ppt-preview:*）与主进程通信，接收幻灯片 JSON 数据并渲染。
 *
 * 参照 avatarEntry.tsx 的极简启动模式。
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { logger } from '@shared/toolkit/LogEngine'

import './styles/globals.css'

globalThis.__PROD__ = import.meta.env.PROD
logger.refreshProductionMode()

// 性能追踪跟随：主进程开始采样时本窗口自动上报。
// 未开启追踪时的成本只有一次订阅与一次状态查询。
void import('@intelligence/diagnostics/perfTraceAutoStart').then(({ installPerfTraceAutoStart }) =>
  installPerfTraceAutoStart()
)

class PptPreviewErrorBoundary extends React.Component<
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
    logger.system.error('[PptPreviewEntry] Render crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          color: '#ff6b6b',
          fontFamily: '-apple-system, sans-serif',
          fontSize: '14px',
        },
        children: `预览渲染出错: ${this.state.error.message}`,
      })
    }
    return this.props.children
  }
}

async function bootstrap() {
  const { PptPreviewApp } = await import('./components/ppt-preview/PptPreviewApp')
  const rootEl = document.getElementById('root')
  if (!rootEl) {
    logger.system.error('[PptPreviewEntry] Root element #root not found')
    return
  }

  const root = ReactDOM.createRoot(rootEl)
  root.render(
    <React.StrictMode>
      <PptPreviewErrorBoundary>
        <PptPreviewApp />
      </PptPreviewErrorBoundary>
    </React.StrictMode>,
  )
}

void bootstrap()
