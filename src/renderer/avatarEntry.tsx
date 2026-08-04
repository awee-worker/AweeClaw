/**
 * 悬浮头像窗口 - 渲染进程入口
 *
 * 与主窗口 bootstrap.tsx 的区别：
 * - 极简启动：不加载 Monaco / 插件 UI 注册表 / 场景系统等重依赖
 * - 独立 React 根：使用独立的 AvatarApp 组件，不引入主窗口的 Store / Router
 * - 透明窗口适配：移除加载动画后立即可见，避免白屏闪烁
 *
 * 关键设计：
 * - 头像窗口通过 IPC（floatingAvatar.*）与主进程通信，不直接访问 @store
 * - 语音上下文由主窗口 push（floating-avatar:update-voice-context），
 *   头像窗口通过 useAvatarBridge 订阅 onVoiceContextUpdated 获取
 * - 3D 球体使用 @react-three/fiber，独立 Canvas，不影响主窗口性能
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { logger } from '@shared/toolkit/LogEngine'

// 加载全局样式（Tailwind CSS + CSS 变量），使 avatar 窗口能使用与主窗口一致的 Tailwind class。
// avatar.html 的 `background: transparent !important` 会覆盖 globals.css 的 body 背景色，
// 确保透明窗口（悬浮球态）不受影响。展开为聊天面板时，面板容器有自己的不透明背景。
import './styles/globals.css'

// 注入生产环境标记（供 shared 代码使用，必须在 Logger 首次使用前设置）
globalThis.__PROD__ = import.meta.env.PROD
logger.refreshProductionMode()

// 顶层错误边界：捕获渲染异常，避免头像窗口白屏
class AvatarErrorBoundary extends React.Component<
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
    logger.system.error('[AvatarEntry] Render crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      // 头像窗口出错时显示一个静态圆点，保持悬浮可见（不让用户感知崩溃）
      return React.createElement('div', {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        },
      }, React.createElement('div', {
        style: {
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #f87171 0%, #dc2626 50%, #7f1d1d 100%)',
          boxShadow: '0 0 20px rgba(220, 38, 38, 0.6)',
        },
      }))
    }
    return this.props.children
  }
}

// 延迟加载 AvatarApp（code-split，减小初始包体积）
const AvatarApp = React.lazy(() =>
  import('./components/floating-avatar/AvatarApp').then((m) => ({ default: m.AvatarApp })),
)

// 延迟加载右键菜单组件（菜单窗口专用，URL 参数 mode=menu 时渲染）
const AvatarContextMenu = React.lazy(() =>
  import('./components/floating-avatar/AvatarContextMenu').then((m) => ({
    default: m.AvatarContextMenu,
  })),
)

/** 是否为右键菜单窗口（AvatarMenuWindow 加载 avatar.html?mode=menu） */
const isMenuMode = new URLSearchParams(window.location.search).get('mode') === 'menu'

// 菜单窗口主题适配：头像窗口有主窗口主题同步，菜单窗口独立加载，
// 用 prefers-color-scheme 设置 CSS 变量（亮/暗主题背景/前景/hover 色）
if (isMenuMode) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const root = document.documentElement
  if (dark) {
    root.style.setProperty('--avatar-menu-bg', 'rgba(32,32,32,0.98)')
    root.style.setProperty('--avatar-menu-fg', '#e6e6e6')
    root.style.setProperty('--avatar-menu-hover', 'rgba(255,255,255,0.16)')
    root.style.setProperty('--avatar-menu-separator', 'rgba(255,255,255,0.12)')
    root.style.setProperty('--avatar-menu-check', '#60a5fa')
    // 菜单窗口不透明（覆盖 avatar.html 的 transparent 背景），避免透明窗口吞鼠标事件
    document.body.style.background = '#1a1a1a'
  } else {
    root.style.setProperty('--avatar-menu-bg', 'rgba(255,255,255,0.98)')
    root.style.setProperty('--avatar-menu-fg', '#1f2328')
    root.style.setProperty('--avatar-menu-hover', 'rgba(0,0,0,0.08)')
    root.style.setProperty('--avatar-menu-separator', 'rgba(128,128,128,0.2)')
    root.style.setProperty('--avatar-menu-check', '#3b82f6')
    document.body.style.background = '#ffffff'
  }
}

// 移除加载占位（React 挂载后）
function removeLoader() {
  const loader = document.getElementById('avatar-loader')
  if (loader) loader.remove()
}

// 菜单模式下立即移除 loader（avatar.html 的 #avatar-loader 是 position:absolute;inset:0，
// 会覆盖整个窗口吞掉所有鼠标事件。头像模式由 AvatarApp onReady 回调移除，
// 菜单模式渲染 AvatarContextMenu 不走 onReady，必须在此显式移除，否则菜单项无法点击）
if (isMenuMode) {
  removeLoader()
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  logger.system.error('[AvatarEntry] Root element #root not found')
} else {
  const root = ReactDOM.createRoot(rootEl)

  root.render(
    <React.StrictMode>
      <AvatarErrorBoundary>
        <React.Suspense fallback={null}>
          {isMenuMode ? <AvatarContextMenu /> : <AvatarApp onReady={removeLoader} />}
        </React.Suspense>
      </AvatarErrorBoundary>
    </React.StrictMode>,
  )
}
