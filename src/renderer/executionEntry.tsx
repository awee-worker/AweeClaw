/**
 * 项目执行窗口 - 渲染进程入口
 *
 * 与主窗口 bootstrap.tsx 的区别：
 * - 极简启动：不加载 Monaco / 插件 UI 注册表 / 场景系统等重依赖
 * - 独立 React 根：使用独立的 ProjectExecutionWindowApp 组件
 * - 复用 IntelligenceStore + Agent（通过 channelBridge 连接主进程）
 *
 * 关键设计：
 * - 执行窗口独立初始化 Agent（每进程单例），不依赖主窗口代理
 * - 通过 api.settings + api.file 从主进程加载配置和工作区
 * - 从 URL 参数读取 projectId/sessionId/threadId，加载指定线程消息历史
 * - 通过 IPC 推送执行状态到主进程 → 悬浮球
 *
 * 与 avatarEntry.tsx 的区别：
 * - 不透明窗口（普通窗口，非透明悬浮窗）
 * - 需要完整的 Agent 能力（消息流、工具调用、批准）
 * - 需要初始化 IntelligenceStore + 全局 store
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/globals.css'
import { logger } from '@shared/toolkit/LogEngine'

// 注入生产环境标记（供 shared 代码使用，必须在 Logger 首次使用前设置）
globalThis.__PROD__ = import.meta.env.PROD
logger.refreshProductionMode()

// 性能追踪跟随：主进程开始采样时本窗口自动上报。
// 未开启追踪时的成本只有一次订阅与一次状态查询。
void import('@intelligence/diagnostics/perfTraceAutoStart').then(({ installPerfTraceAutoStart }) =>
  installPerfTraceAutoStart()
)

// 顶层错误边界：捕获渲染异常，避免执行窗口白屏
class ExecutionErrorBoundary extends React.Component<
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
    logger.system.error('[ExecutionEntry] Render crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: '#0a0a0c',
          color: '#999',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        },
      },
        React.createElement('div', { style: { fontSize: '14px', fontWeight: 500 } }, '执行窗口出错'),
        React.createElement('div', { style: { fontSize: '12px', color: '#666' } }, this.state.error.message),
        React.createElement('button', {
          onClick: () => window.close(),
          style: {
            marginTop: '8px',
            padding: '6px 16px',
            borderRadius: '6px',
            border: '1px solid #444',
            background: '#2a2a2a',
            color: '#ccc',
            fontSize: '12px',
            cursor: 'pointer',
          },
        }, '关闭窗口'),
      )
    }
    return this.props.children
  }
}

// 延迟加载执行窗口主组件（code-split，减小初始包体积）
const ProjectExecutionWindowApp = React.lazy(() =>
  import('./components/project-execution/ProjectExecutionWindowApp').then((m) => ({
    default: m.ProjectExecutionWindowApp,
  })),
)

// 移除加载占位（React 挂载后）
function removeLoader() {
  const loader = document.getElementById('execution-loader')
  if (loader) loader.remove()
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  logger.system.error('[ExecutionEntry] Root element #root not found')
} else {
  const root = ReactDOM.createRoot(rootEl)

  root.render(
    // ⚠️ 执行窗口不使用 React.StrictMode
    // StrictMode 在开发模式下会双调用 effect，导致 async init() 并发执行两次，
    // 各自 createThread() 产生两个线程，第二个覆盖 currentThreadId，
    // 造成消息内容闪现后消失。执行窗口是独立窗口，不需要副作用检测。
    <ExecutionErrorBoundary>
      <React.Suspense fallback={null}>
        <ProjectExecutionWindowApp onReady={removeLoader} />
      </React.Suspense>
    </ExecutionErrorBoundary>,
  )
}
