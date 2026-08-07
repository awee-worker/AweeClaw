/**
 * 截图覆盖窗口组件（透明窗口方案）
 *
 * 覆盖窗口本身透明，用户透过窗口看到真实桌面：
 * - 整屏半透明黑色遮罩（让用户感知进入截图模式）
 * - 鼠标按下 → 开始框选，选区内透明（露出真实桌面），选区外保持暗化
 * - 鼠标松开 → 完成框选，显示确认/取消按钮
 * - 双击选区 → 直接确认
 * - ESC → 取消
 * - Enter → 确认（有选区确认选区，无选区截全屏）
 *
 * 确认后主进程会先隐藏本窗口再截图，本组件不展示截图，杜绝像素对齐/重影问题。
 *
 * 注意：contextIsolation: true 下不能直接 import electron，
 * 通过 window.electronAPI.screenshotOverlay 调用 preload 暴露的 IPC API
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface SetupPayload {
  screenWidth: number
  screenHeight: number
  scaleFactor: number
  workAreaX: number
  workAreaY: number
  workAreaWidth: number
  workAreaHeight: number
}

type DragState = 'idle' | 'dragging' | 'selected'

/** preload 暴露的截图覆盖窗口 API（通过 contextBridge） */
const screenshotApi = (window as unknown as {
  electronAPI: {
    screenshotOverlay: {
      requestSetup: () => Promise<SetupPayload | null>
      sendCancel: () => void
      sendConfirm: (rect: SelectionRect) => void
    }
  }
}).electronAPI.screenshotOverlay

export function ScreenshotOverlay() {
  const [ready, setReady] = useState(false)
  const [dragState, setDragState] = useState<DragState>('idle')
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 })
  // workArea 底部相对窗口顶部的偏移；窗口高度（=screenHeight）减去它 = Dock/任务栏高度
  const [workAreaBottom, setWorkAreaBottom] = useState(0)
  // 屏幕完整高度（含菜单栏 + Dock），用于计算 bottom 定位
  const [screenHeight, setScreenHeight] = useState(0)

  // 拖拽起始点（用于计算选区）
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  // 组件挂载后请求屏幕信息（用于 Enter 截全屏时计算全屏选区 + 按钮定位）
  useEffect(() => {
    screenshotApi
      .requestSetup()
      .then((payload: SetupPayload | null) => {
        if (!payload) {
          console.error('[ScreenshotOverlay] No setup data received')
          return
        }
        setScreenSize({ width: payload.screenWidth, height: payload.screenHeight })
        setScreenHeight(payload.screenHeight)
        // workArea 底部相对屏幕原点 = workAreaY + workAreaHeight
        setWorkAreaBottom(payload.workAreaY + payload.workAreaHeight)
        setReady(true)
      })
      .catch((err: unknown) => {
        console.error('[ScreenshotOverlay] Request setup failed:', err)
      })
  }, [])

  // 取消截图
  const handleCancel = useCallback(() => {
    screenshotApi.sendCancel()
  }, [])

  // 确认选区（有选区时确认选区，无选区时确认全屏）
  const handleConfirm = useCallback(() => {
    if (selection && selection.width >= 10 && selection.height >= 10) {
      screenshotApi.sendConfirm(selection)
      return
    }
    if (screenSize.width > 0 && screenSize.height > 0) {
      screenshotApi.sendConfirm({
        x: 0,
        y: 0,
        width: screenSize.width,
        height: screenSize.height,
      })
      return
    }
    handleCancel()
  }, [selection, screenSize, handleCancel])

  // 鼠标按下：开始框选
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 点击按钮时不触发框选
    if ((e.target as HTMLElement).closest('[data-overlay-control]')) return

    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDragState('dragging')
    setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 })
  }, [])

  // 鼠标移动：更新选区
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragState !== 'dragging' || !dragStartRef.current) return
      const start = dragStartRef.current
      const x = Math.min(start.x, e.clientX)
      const y = Math.min(start.y, e.clientY)
      const width = Math.abs(e.clientX - start.x)
      const height = Math.abs(e.clientY - start.y)
      setSelection({ x, y, width, height })
    },
    [dragState],
  )

  // 鼠标松开：完成框选
  const handleMouseUp = useCallback(() => {
    if (dragState !== 'dragging') return
    dragStartRef.current = null
    if (selection && (selection.width < 10 || selection.height < 10)) {
      setSelection(null)
      setDragState('idle')
    } else {
      setDragState('selected')
    }
  }, [dragState, selection])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel()
      } else if (e.key === 'Enter') {
        if (dragState === 'selected' || dragState === 'idle') {
          handleConfirm()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dragState, handleCancel, handleConfirm])

  // 双击选区确认
  const handleDoubleClick = useCallback(() => {
    if (dragState === 'selected') handleConfirm()
  }, [dragState, handleConfirm])

  if (!ready) {
    // 透明 loading（不绘制遮罩，避免 ready 前遮挡桌面）
    return <div style={{ width: '100%', height: '100%' }} />
  }

  return (
    <div
      style={overlayContainerStyle}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    >
      {/*
        半透明遮罩：选区外区域暗化，选区内透明（露出真实桌面）。
        用 4 个 div 拼出"选区外"的暗化区域（比 SVG mask 更稳定，无跨平台渲染差异）。
        idle 状态（无选区）：整屏暗化。
        dragging/selected 状态：选区内透明，四周暗化。
      */}
      {selection && selection.width > 0 && selection.height > 0 ? (
        <>
          {/* 上：选区上方 */}
          <div
            style={{
              ...maskBlockStyle,
              left: 0,
              top: 0,
              width: '100%',
              height: selection.y,
            }}
          />
          {/* 下：选区下方 */}
          <div
            style={{
              ...maskBlockStyle,
              left: 0,
              top: selection.y + selection.height,
              width: '100%',
              bottom: 0,
            }}
          />
          {/* 左：选区左侧 */}
          <div
            style={{
              ...maskBlockStyle,
              left: 0,
              top: selection.y,
              width: selection.x,
              height: selection.height,
            }}
          />
          {/* 右：选区右侧 */}
          <div
            style={{
              ...maskBlockStyle,
              left: selection.x + selection.width,
              top: selection.y,
              right: 0,
              height: selection.height,
            }}
          />
        </>
      ) : (
        /* idle 状态：整屏暗化 */
        <div style={{ ...maskBlockStyle, left: 0, top: 0, width: '100%', height: '100%' }} />
      )}

      {/* 选区边框 */}
      {selection && selection.width > 0 && selection.height > 0 && (
        <div
          style={{
            ...selectionBorderStyle,
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        />
      )}

      {/* 选区尺寸提示 */}
      {selection && selection.width > 10 && selection.height > 10 && (
        <div
          style={{
            ...sizeLabelStyle,
            left: selection.x,
            top: selection.y + selection.height + 8,
          }}
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {/* 确认/取消按钮（仅在选区完成后显示） */}
      {dragState === 'selected' && selection && (
        <div
          data-overlay-control
          style={{
            ...toolbarStyle,
            left: Math.min(selection.x + selection.width - 180, screenSize.width - 190),
            // 优先在选区下方显示；若超出 workArea 底部（被 Dock 遮挡），则改在选区上方显示
            top:
              selection.y + selection.height + 44 <= workAreaBottom
                ? selection.y + selection.height + 8
                : Math.max(selection.y - 40, 8),
          }}
        >
          <button style={cancelBtnStyle} onClick={handleCancel}>
            取消 (ESC)
          </button>
          <button style={confirmBtnStyle} onClick={handleConfirm}>
            确认 (Enter)
          </button>
        </div>
      )}

      {/* 顶部提示（idle + dragging 状态显示操作引导） */}
      {dragState !== 'selected' && (
        <div style={hintStyle}>
          {dragState === 'idle'
            ? '拖拽选择区域 · Enter 截全屏 · ESC 取消'
            : '松开鼠标完成框选 · ESC 取消'}
        </div>
      )}

      {/* idle 状态下的「截全屏」按钮（底部居中，方便不拖拽直接确认） */}
      {dragState === 'idle' && screenSize.width > 0 && (
        <div
          data-overlay-control
          style={{
            ...toolbarStyle,
            left: '50%',
            transform: 'translateX(-50%)',
            // 用 bottom 定位到 workArea 底部上方，确保按钮栏完全在 Dock/任务栏之上。
            // bottom = 窗口底部到按钮栏底部的距离 = Dock高度 + 按钮栏高度 + 安全间距
            //   - Dock高度 = screenHeight - workAreaBottom
            //   - 按钮栏高度 ≈ 36px（padding 6px*2 + fontSize 13px + border 2px）
            //   - 安全间距 = 12px
            // 按钮栏从 bottom 点向上延伸（高度 36px），所以 bottom 必须 ≥ Dock高度 + 按钮栏高度，
            // 否则按钮栏顶部仍在 Dock 区域内被遮挡。
            bottom:
              screenHeight > 0 && workAreaBottom > 0
                ? screenHeight - workAreaBottom + 36 + 12
                : 80,
            top: 'auto',
          }}
        >
          <button style={cancelBtnStyle} onClick={handleCancel}>
            取消 (ESC)
          </button>
          <button style={confirmBtnStyle} onClick={handleConfirm}>
            截全屏 (Enter)
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// 样式
// ============================================

/** 容器：透明背景，用户透过窗口看到真实桌面 */
const overlayContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  cursor: 'crosshair',
  background: 'transparent',
}

/** 暗化遮罩块：半透明黑色，覆盖在选区外的桌面上 */
const maskBlockStyle: React.CSSProperties = {
  position: 'absolute',
  background: 'rgba(0, 0, 0, 0.45)',
  pointerEvents: 'none',
  zIndex: 1,
}

const selectionBorderStyle: React.CSSProperties = {
  position: 'absolute',
  border: '2px solid #3b82f6',
  boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.3), inset 0 0 0 1px rgba(255,255,255,0.2)',
  pointerEvents: 'none',
  zIndex: 10,
}

const sizeLabelStyle: React.CSSProperties = {
  position: 'absolute',
  padding: '2px 8px',
  background: 'rgba(0, 0, 0, 0.75)',
  color: '#fff',
  fontSize: '12px',
  borderRadius: 4,
  fontFamily: '-apple-system, Menlo, monospace',
  pointerEvents: 'none',
  zIndex: 11,
  whiteSpace: 'nowrap',
}

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  display: 'flex',
  gap: 8,
  zIndex: 20,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.6)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: '-apple-system, "PingFang SC", sans-serif',
}

const confirmBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  color: '#fff',
  background: '#3b82f6',
  border: '1px solid #2563eb',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: '-apple-system, "PingFang SC", sans-serif',
  fontWeight: 500,
}

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '8px 16px',
  background: 'rgba(0, 0, 0, 0.75)',
  color: '#fff',
  fontSize: '13px',
  borderRadius: 8,
  fontFamily: '-apple-system, "PingFang SC", sans-serif',
  pointerEvents: 'none',
  zIndex: 30,
}
