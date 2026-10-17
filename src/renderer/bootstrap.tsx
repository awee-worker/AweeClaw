import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/globals.css'
import { logger } from '@toolkit/LogEngine'

// 注入生产环境标记（供 shared 代码使用）
// 必须在 Logger 首次使用前设置，确保生产环境检测正确
globalThis.__PROD__ = import.meta.env.PROD

// 刷新 Logger 的生产环境检测（确保配置已更新）
logger.refreshProductionMode()

// 异步注入共享依赖（React、zustand 等）到 window.__AWEECLAW_SHARED__
// 不 await：应用启动时场景尚未加载，注入会在场景加载前完成；
// ProgrammaticScenarioLoader 中有兜底检查（isInjected + await），确保 bundle 执行前已注入。
//
// 这里用动态 import 而不是顶部静态导入：该模块与场景系统、intelligence 两侧共享，
// 静态导入会把它所在的 chunk（打包时与 Agent 引擎合并在一起）一并提升为首屏静态依赖，
// 导致首屏被迫加载整套引擎。动态导入把它推到本轮微任务之后，
// 场景加载本来就是异步的，且有 isInjected 兜底，时序不受影响。
void import('@scenario-system/core/SharedDependencyProvider').then(
  ({ injectSharedDependencies }) => {
    try {
      injectSharedDependencies()
    } catch (err) {
      logger.system.error('[Bootstrap] Shared dependency injection failed:', err)
    }
  },
)

// 初始化插件 UI 扩展点注册表：拉取已安装插件的 contributes 声明，
// 注册插件贡献的侧边栏导航项（懒加载，ui.js 在面板首次激活时才 import）。
// 不 await：注册表初始化是异步的，导航项就绪后通过订阅机制触发 NavigationRail 重新渲染。
void import('./plugins/PluginUiRegistry').then(({ pluginUiRegistry }) => {
  pluginUiRegistry.initialize().catch((err) => {
    logger.system.error('[Bootstrap] PluginUiRegistry initialize failed:', err)
  })
})

// 注册场景工具 AI 桥接：将 21 个内置工具数据域暴露给 AI Agent（scene_tools_* 工具）。
// 同时启动 UI 事件跟踪：用户在工具面板的操作（增删改）会记录为事件，供 AI 感知衔接。
// 懒加载 + 幂等注册，失败不影响主流程。
void import('./components/scene-tools/agentBridge').then(({ registerSceneToolsAgent, initSceneToolEventTracking }) => {
  try {
    registerSceneToolsAgent()
    initSceneToolEventTracking()
  } catch (err) {
    logger.system.error('[Bootstrap] SceneTools agent bridge register failed:', err)
  }
})

// 预热场景工具 SQLite 持久化：等待所有场景工具 store 完成 hydration，
// 保证工具面板与 AI Agent 读取到完整数据（而非空数据）。
// 数据已从 localStorage 迁移到 SQLite（scene-tools.db），不阻塞启动。
void import('./components/scene-tools/stores').then(({ warmupSceneToolsStores }) => {
  warmupSceneToolsStores().catch((err) => {
    logger.system.error('[Bootstrap] SceneTools stores warmup failed:', err)
  })
})

// 注册可信应用数据目录（插件 / 场景 / 技能 / 运行时所在的应用配置存储目录）：
// 这些目录由客户端安装而来、且工作空间之外，其中的插件文档与脚本需要能被 AI 读取，
// 否则插件调用会因路径越界直接失败。同时该目录也覆盖了附件兜底上传目录
// （<配置目录>/.aweeclaw/uploads）—— 历史附件在打开工作空间后仍需可读。
// 不 await：路径校验同步读模块级缓存，未就绪时不放行，行为与改动前一致。
void import('./intelligence/toolkit/trustedPathRegistry').then(({ initTrustedAppDataRoots }) =>
  initTrustedAppDataRoots()
)

// 挂载性能追踪上报器：把入口暴露为 window.__perfTrace，排查时在 DevTools
// 控制台执行 __perfTrace.start() 即可开始采集。刻意不自动启动——
// 常驻采集对绝大多数会话都是无谓开销。
void import('./intelligence/diagnostics/perfTraceReporter').then(({ initPerfTraceReporter }) =>
  initPerfTraceReporter()
)

// 跟随主进程的启停：主窗口之外还有桌面伴侣、悬浮头像、预览等渲染窗口，
// 它们都走各自的入口，不会主动开启上报。主进程开始采样时统一广播，
// 各窗口据此自动跟随，避免只有主窗口有数据。
void import('./intelligence/diagnostics/perfTraceAutoStart').then(({ installPerfTraceAutoStart }) =>
  installPerfTraceAutoStart()
)

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
//
// 文案按语言分包懒加载，必须在首次渲染前就绪：t() 是同步 API，
// 字典未加载时只能返回原始 key。语言取自用户设置（持久化在 store 里），
// 未设置时回落到浏览器语言。
async function mountApp() {
  const root = ReactDOM.createRoot(document.getElementById('root')!)

  try {
    const [{ initI18n, detectBrowserLanguage }, { useStore }] = await Promise.all([
      import('./i18n/i18nSetup'),
      import('@store'),
    ])
    const stored = useStore.getState().language
    const lang = stored === 'zh' || stored === 'en' ? stored : detectBrowserLanguage()
    await initI18n(lang)
  } catch (err) {
    // 文案加载失败不阻塞启动：界面会显示 key，但应用本身仍可用
    logger.system.error('[Bootstrap] i18n initialization failed:', err)
  }

  root.render(
    <React.StrictMode>
      <TopLevelErrorBoundary>
        <React.Suspense fallback={<AppSkeleton />}>
          <App />
        </React.Suspense>
      </TopLevelErrorBoundary>
    </React.StrictMode>
  )
}

void mountApp()

// 空闲时预加载 Monaco
if ('requestIdleCallback' in window) {
  const requestIdleCallback = (window as Window & { requestIdleCallback: typeof globalThis.requestIdleCallback }).requestIdleCallback
  requestIdleCallback(() => initMonaco(), { timeout: 2000 })
} else {
  setTimeout(initMonaco, 100)
}
