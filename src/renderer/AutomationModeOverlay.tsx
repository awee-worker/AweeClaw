/**
 * 自动化模式覆盖层 UI
 *
 * 渲染于独立透明全屏置顶窗口（?window=automation-overlay 路由轻量加载）
 *
 * 视觉元素：
 * 1. 屏幕四周边缘的呼吸式光晕动画（标识自动化模式已激活）
 * 2. 右下角圆形悬浮退出按钮（用户唯一可点击元素，点击触发紧急停止 + 退出）
 * 3. 顶部任务描述条 + 步骤进度指示
 * 4. 右下角退出按钮上方实时步骤日志（最近 3 条）
 *
 * 输入锁定说明：
 * - 覆盖窗口默认捕获鼠标事件（阻塞模式），用户仅能点击退出按钮
 * - AI 执行输入动作期间，主进程切换覆盖窗口为 click-through，本组件无需感知
 *
 * @module renderer/AutomationModeOverlay
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { createRoot } from 'react-dom/client'

// ============================================
// 类型定义（与主进程 AutomationModeController 对齐）
// ============================================

interface AutomationState {
  active: boolean
  task: string
  currentStep: number
  maxSteps: number
  startedAt: number | null
  lastExitReason: string | null
}

interface AutomationStepInfo {
  index: number
  actionType: string
  description: string
  status: 'running' | 'completed' | 'error'
  timestamp: number
}

interface AutomationLog {
  message: string
  level: 'info' | 'warn' | 'error'
  timestamp: number
}

// ============================================
// electronAPI 访问（preload 注入）
// ============================================

/** 通过类型断言访问 preload 注入的 automation API（避免与全局 ElectronAPI 类型声明冲突） */
interface AutomationElectronAPI {
  desktop?: {
    automation?: {
      userExit: () => Promise<{ success: boolean }>
      getState: () => Promise<{ success: boolean; data: AutomationState }>
      onStateChange: (cb: (state: AutomationState) => void) => () => void
      onStep: (cb: (step: AutomationStepInfo) => void) => () => void
      onLog: (cb: (log: AutomationLog) => void) => () => void
    }
  }
}

function getAutomationAPI() {
  const electronAPI = (window as unknown as { electronAPI?: AutomationElectronAPI }).electronAPI
  const api = electronAPI?.desktop?.automation
  if (!api) {
    throw new Error('Automation API not available in preload')
  }
  return api
}

// ============================================
// 提示音（Web Audio API，覆盖窗口独立实现，不依赖主窗口资源）
// ============================================

type SoundType = 'enter' | 'exit' | 'error' | 'step' | 'confirm'

const SOUND_PRESETS: Record<SoundType, { type: OscillatorType; freq: [number, number]; gain: number; duration: number }> = {
  enter: { type: 'sine', freq: [523, 784], gain: 0.15, duration: 0.4 },
  exit: { type: 'sine', freq: [784, 523], gain: 0.15, duration: 0.4 },
  error: { type: 'square', freq: [330, 262], gain: 0.12, duration: 0.35 },
  step: { type: 'sine', freq: [660, 880], gain: 0.08, duration: 0.15 },
  confirm: { type: 'sine', freq: [880, 660], gain: 0.12, duration: 0.3 },
}

function playSound(type: SoundType): void {
  try {
    const preset = SOUND_PRESETS[type]
    const ctx = new AudioContext()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.type = preset.type
    osc.frequency.setValueAtTime(preset.freq[0], now)
    osc.frequency.setValueAtTime(preset.freq[1], now + preset.duration * 0.4)
    gainNode.gain.setValueAtTime(preset.gain, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + preset.duration)
    osc.connect(gainNode)
    gainNode.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + preset.duration)
    setTimeout(() => ctx.close(), 1000)
  } catch (e) {
    // AudioContext 不可用时静默忽略
  }
}

// ============================================
// 主组件
// ============================================

export function AutomationModeOverlay(): React.ReactElement {
  const [state, setState] = useState<AutomationState | null>(null)
  const [steps, setSteps] = useState<AutomationStepInfo[]>([])
  const [logs, setLogs] = useState<AutomationLog[]>([])
  const [exiting, setExiting] = useState(false)
  const exitBtnRef = useRef<HTMLButtonElement>(null)
  const prevActiveRef = useRef(false)

  // 订阅主进程事件并同步初始状态
  useEffect(() => {
    let unsubState: (() => void) | undefined
    let unsubStep: (() => void) | undefined
    let unsubLog: (() => void) | undefined

    try {
      const api = getAutomationAPI()

      // 拉取初始状态
      api.getState().then((res) => {
        if (res.success && res.data) setState(res.data)
      }).catch(() => { /* 忽略 */ })

      unsubState = api.onStateChange((s) => {
        setState(s)
        // 进入自动化模式时播放提示音
        if (s.active && !prevActiveRef.current) {
          playSound('enter')
        }
        // 退出自动化模式时播放提示音
        if (!s.active && prevActiveRef.current) {
          playSound('exit')
          setExiting(true)
        }
        prevActiveRef.current = s.active
      })

      unsubStep = api.onStep((step) => {
        setSteps((prev) => {
          const next = [...prev]
          const idx = next.findIndex((s) => s.index === step.index)
          if (idx >= 0) {
            next[idx] = step
          } else {
            next.push(step)
          }
          // 仅保留最近 20 条
          return next.slice(-20)
        })
        // 步骤完成/出错时播放提示音
        if (step.status === 'completed') playSound('step')
        if (step.status === 'error') playSound('error')
      })

      unsubLog = api.onLog((log) => {
        setLogs((prev) => [...prev, log].slice(-30))
        // 错误日志播放提示音
        if (log.level === 'error') playSound('error')
      })
    } catch (err) {
      // API 不可用时仍渲染基础 UI，避免窗口空白
      console.error('[AutomationOverlay] init failed:', err)
    }

    return () => {
      unsubState?.()
      unsubStep?.()
      unsubLog?.()
    }
  }, [])

  // 退出按钮点击
  // 设置 3s 超时兜底：主进程销毁窗口后 IPC 返回值可能无法送达，
  // 超时后渲染端主动尝试关闭窗口
  const handleExit = useCallback(async () => {
    if (exiting) return
    setExiting(true)
    try {
      const api = getAutomationAPI()
      await Promise.race([
        api.userExit(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('exit-timeout')), 3000),
        ),
      ])
    } catch (err) {
      console.error('[AutomationOverlay] userExit failed, attempting window.close():', err)
      // 超时或失败，尝试直接关闭窗口（主进程可能已销毁窗口但 IPC 未返回）
      try {
        window.close()
      } catch {
        // window.close() 失败说明窗口已被主进程销毁，无需处理
      }
    }
  }, [exiting])

  // 注意：覆盖窗口 focusable=false，无法接收键盘焦点，window.addEventListener('keydown') 不会触发。
  // 键盘退出通过主进程全局快捷键 CommandOrControl+Alt+Q 实现，此处不再注册 Esc 监听。

  // 进度百分比
  const progress = state && state.maxSteps > 0
    ? Math.min(100, Math.round((state.currentStep / state.maxSteps) * 100))
    : 0

  // 最近 3 条步骤日志（用于右下角展示）
  const recentSteps = steps.slice(-3).reverse()
  const recentLogs = logs.slice(-3).reverse()

  return (
    <div style={overlayRootStyle}>
      {/* 1. 边缘光晕动画 */}
      <div style={haloStyle} aria-hidden="true" />

      {/* 2. 顶部任务信息条 */}
      {state?.active && (
        <div style={topBarStyle}>
          <div style={topBarLeftStyle}>
            <span style={badgeStyle}>AUTO</span>
            <span style={taskTextStyle} title={state.task}>
              {state.task || '桌面自动化进行中'}
            </span>
          </div>
          <div style={progressContainerStyle}>
            <div style={progressTrackStyle}>
              <div
                style={{
                  ...progressFillStyle,
                  width: `${progress}%`,
                }}
              />
            </div>
            <span style={progressTextStyle}>
              {state.currentStep}/{state.maxSteps > 0 ? state.maxSteps : '∞'}
            </span>
          </div>
        </div>
      )}

      {/* 3. 右下角退出按钮 + 步骤日志 */}
      <div style={bottomRightContainerStyle}>
        {/* 步骤日志卡片 */}
        {(recentSteps.length > 0 || recentLogs.length > 0) && (
          <div style={logCardStyle}>
            {recentSteps.map((s) => (
              <div key={`step-${s.index}`} style={logRowStyle(s.status)}>
                <span style={logDotStyle(s.status)} />
                <span style={logActionStyle}>{s.actionType}</span>
                <span style={logDescStyle} title={s.description}>{s.description}</span>
              </div>
            ))}
            {recentLogs.map((l, i) => (
              <div key={`log-${i}-${l.timestamp}`} style={logRowStyle2(l.level)}>
                <span style={logDescStyle}>{l.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* 退出按钮 */}
        <button
          ref={exitBtnRef}
          type="button"
          onClick={handleExit}
          disabled={exiting}
          style={exitButtonStyle(exiting)}
          aria-label="退出桌面自动化模式"
          title="退出自动化模式 (Esc)"
        >
          {exiting ? (
            <SpinnerIcon />
          ) : (
            <StopIcon />
          )}
        </button>
      </div>

      {/* 4. 退出过渡遮罩 */}
      {exiting && (
        <div style={exitOverlayStyle}>
          <div style={exitTextStyle}>正在退出自动化模式...</div>
        </div>
      )}
    </div>
  )
}

// ============================================
// 样式（内联，避免引入 CSS 依赖，保持覆盖窗口轻量）
// ============================================

const overlayRootStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none', // 根容器不拦截，仅退出按钮等子元素 pointer-events: auto
  zIndex: 2147483647,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  userSelect: 'none',
}

// 边缘光晕：通过 box-shadow inset 实现四周边缘发光
const haloStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxShadow: 'inset 0 0 120px rgba(99, 102, 241, 0.45), inset 0 0 60px rgba(59, 130, 246, 0.35)',
  border: '2px solid rgba(99, 102, 241, 0.5)',
  animation: 'aweeclaw-halo-pulse 2.4s ease-in-out infinite',
}

// 顶部任务信息条
const topBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '8px 16px',
  background: 'rgba(15, 23, 42, 0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 12,
  border: '1px solid rgba(99, 102, 241, 0.4)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  color: '#e2e8f0',
  fontSize: 13,
  maxWidth: '70vw',
  pointerEvents: 'none',
}

const topBarLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  flex: '1 1 auto',
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  borderRadius: 4,
  flexShrink: 0,
}

const taskTextStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '50vw',
}

const progressContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
}

const progressTrackStyle: React.CSSProperties = {
  width: 120,
  height: 4,
  background: 'rgba(255, 255, 255, 0.15)',
  borderRadius: 2,
  overflow: 'hidden',
}

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #6366f1, #3b82f6)',
  borderRadius: 2,
  transition: 'width 0.3s ease',
}

const progressTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#94a3b8',
  fontVariantNumeric: 'tabular-nums',
}

// 右下角容器（bottom 上移 80px，避免遮挡系统 Dock）
const bottomRightContainerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 112,
  right: 32,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 12,
  pointerEvents: 'none',
}

// 步骤日志卡片
const logCardStyle: React.CSSProperties = {
  minWidth: 240,
  maxWidth: 360,
  padding: '10px 12px',
  background: 'rgba(15, 23, 42, 0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 10,
  border: '1px solid rgba(99, 102, 241, 0.3)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  color: '#cbd5e1',
  fontSize: 11,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  pointerEvents: 'none',
}

const logRowStyle = (status: AutomationStepInfo['status']): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: status === 'error' ? '#fca5a5' : status === 'completed' ? '#86efac' : '#fde68a',
})

const logRowStyle2 = (level: AutomationLog['level']): React.CSSProperties => ({
  color: level === 'error' ? '#fca5a5' : level === 'warn' ? '#fde68a' : '#94a3b8',
  fontSize: 10,
})

const logDotStyle = (status: AutomationStepInfo['status']): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
  background: status === 'error' ? '#ef4444' : status === 'completed' ? '#22c55e' : '#f59e0b',
  boxShadow: status === 'running' ? '0 0 6px rgba(245, 158, 11, 0.8)' : 'none',
})

const logActionStyle: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: 'monospace',
  fontSize: 10,
  color: '#a5b4fc',
}

const logDescStyle: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '1 1 auto',
}

// 退出按钮
const exitButtonStyle = (exiting: boolean): React.CSSProperties => ({
  width: 64,
  height: 64,
  borderRadius: '50%',
  border: 'none',
  cursor: exiting ? 'wait' : 'pointer',
  pointerEvents: 'auto', // 唯一可点击元素
  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 8px 24px rgba(239, 68, 68, 0.5), 0 0 0 2px rgba(255, 255, 255, 0.2)',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  animation: 'aweeclaw-exit-pulse 1.8s ease-in-out infinite',
})

// 退出过渡遮罩
const exitOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  animation: 'aweeclaw-fade-in 0.3s ease',
}

const exitTextStyle: React.CSSProperties = {
  color: '#fff',
  fontSize: 16,
  fontWeight: 500,
  letterSpacing: 1,
}

// ============================================
// 图标（纯 SVG，避免引入图标库）
// ============================================

function StopIcon(): React.ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  )
}

function SpinnerIcon(): React.ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ animation: 'aweeclaw-spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="42 12" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}

// ============================================
// 动画 keyframes（运行时注入）
// ============================================

const ANIMATION_CSS = `
@keyframes aweeclaw-halo-pulse {
  0%, 100% {
    box-shadow: inset 0 0 120px rgba(99, 102, 241, 0.35), inset 0 0 60px rgba(59, 130, 246, 0.25);
    border-color: rgba(99, 102, 241, 0.4);
  }
  50% {
    box-shadow: inset 0 0 160px rgba(99, 102, 241, 0.55), inset 0 0 80px rgba(59, 130, 246, 0.45);
    border-color: rgba(99, 102, 241, 0.7);
  }
}
@keyframes aweeclaw-exit-pulse {
  0%, 100% { box-shadow: 0 8px 24px rgba(239, 68, 68, 0.5), 0 0 0 2px rgba(255, 255, 255, 0.2); }
  50% { box-shadow: 0 8px 32px rgba(239, 68, 68, 0.7), 0 0 0 6px rgba(239, 68, 68, 0.15); }
}
@keyframes aweeclaw-spin {
  to { transform: rotate(360deg); }
}
@keyframes aweeclaw-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* 强制覆盖窗口背景透明（覆盖 globals.css 中 body 的 bg-background 深色背景） */
html, body, #root {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}
`

let styleInjected = false
function injectAnimations(): void {
  if (styleInjected) return
  const style = document.createElement('style')
  style.textContent = ANIMATION_CSS
  document.head.appendChild(style)
  styleInjected = true
}

// ============================================
// 渲染入口（由 bootstrap 路由调用）
// ============================================

/**
 * 挂载自动化模式覆盖层到 #root
 * 仅在 ?window=automation-overlay 路由下调用
 */
export function mountAutomationModeOverlay(): void {
  injectAnimations()
  const rootEl = document.getElementById('root')
  if (!rootEl) {
    console.error('[AutomationOverlay] #root not found')
    return
  }
  // 移除加载动画
  const loader = document.getElementById('initial-loader')
  if (loader) loader.remove()
  rootEl.classList.add('ready')

  const root = createRoot(rootEl)
  root.render(<AutomationModeOverlay />)
}
