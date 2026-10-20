/**
 * 【已废弃，不再被加载】截图覆盖窗口 React 实现
 *
 * 覆盖窗口实际由 public/screenshot-overlay.html + public/screenshot-overlay.js 提供：
 * 打包后 React vendor chunk 与 agent/ui-core 共享 chunk 形成循环依赖，
 * 覆盖窗口加载时序会触发 ui-core 执行时 React.forwardRef 为 undefined，
 * 导致本组件无法挂载。故改为纯原生 JS 实现，界面调整请改 public/screenshot-overlay.js。
 *
 * 本文件及其依赖（AnnotationEditor / annotationDrawing / annotationTypes）保留仅作参考。
 *
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
 * 确认后主进程会先隐藏本窗口再截图，裁剪结果回填到本窗口的选区原位：
 * 渲染层把截图铺在框选区域，并在其上叠加标注（矩形/椭圆/箭头/画笔/高亮/马赛克/文字），
 * 用户点「完成」才落盘并推送给发起截图窗口，避免产生未标注的中间文件。
 *
 * 注意：contextIsolation: true 下不能直接 import electron，
 * 通过 window.electronAPI.screenshotOverlay 调用 preload 暴露的 IPC API
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnnotationEditor } from './AnnotationEditor'
import type { EditImagePayload } from './annotationTypes'

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

type DragState = 'idle' | 'dragging' | 'capturing' | 'editing'

/** 标注收尾动作提交的图片 */
interface AnnotatedImagePayload {
  base64: string
  width: number
  height: number
}

/** preload 暴露的截图覆盖窗口 API（通过 contextBridge） */
const screenshotApi = (window as unknown as {
  electronAPI: {
    screenshotOverlay: {
      requestSetup: () => Promise<SetupPayload | null>
      sendCancel: () => void
      requestCapture: (rect: SelectionRect) => Promise<EditImagePayload | null>
      sendAnnotateSave: (payload: AnnotatedImagePayload) => void
      sendAnnotateCopy: (payload: AnnotatedImagePayload) => void
      sendAnnotateDownload: (payload: AnnotatedImagePayload) => void
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
  // 主进程回传的待标注截图（非空即处于标注编辑态）
  const [editImage, setEditImage] = useState<EditImagePayload | null>(null)
  // 截图失败提示
  const [captureError, setCaptureError] = useState('')

  // 拖拽起始点（用于计算选区）
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  // 是否已提交选区：截图需要几百毫秒，期间重复拖拽会重复触发
  const submittedRef = useRef(false)

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

  /**
   * 提交选区给主进程截图，拿到图片后进入标注态
   *
   * 用 await 等主进程完成「隐藏窗口 → 截屏 → 裁剪 → 恢复窗口」：
   * 截图必须隐藏覆盖窗口才不会截到遮罩，而窗口隐藏期间渲染进程会被节流，
   * 靠事件回填会与恢复时机竞争。请求-响应模式让时序由 Promise 保证。
   */
  const submitSelection = useCallback(async (rect: SelectionRect) => {
    if (submittedRef.current) return
    submittedRef.current = true
    setCaptureError('')
    setSelection(rect)
    setDragState('capturing')

    try {
      const payload = await screenshotApi.requestCapture(rect)
      if (!payload) {
        // 主进程侧已结束流程（截图失败或窗口已关闭），这里不再改动界面
        return
      }
      setEditImage(payload)
      setDragState('editing')
    } catch (err) {
      console.error('[ScreenshotOverlay] Capture failed:', err)
      submittedRef.current = false
      setDragState('idle')
      setSelection(null)
      setCaptureError('截图失败，请重新框选')
    }
  }, [])
  // 无选区时确认全屏截图
  const handleConfirm = useCallback(() => {
    if (screenSize.width <= 0 || screenSize.height <= 0) {
      handleCancel()
      return
    }
    submitSelection({
      x: 0,
      y: 0,
      width: screenSize.width,
      height: screenSize.height,
    })
  }, [screenSize, submitSelection, handleCancel])

  // 鼠标按下：开始框选
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 标注编辑态与截图进行中不响应框选
      if (dragState === 'editing' || dragState === 'capturing') return
      if ((e.target as HTMLElement).closest('[data-overlay-control]')) return

      dragStartRef.current = { x: e.clientX, y: e.clientY }
      setDragState('dragging')
      setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 })
    },
    [dragState],
  )

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

  // 鼠标松开：框选完成即提交截图，直接进入标注态
  const handleMouseUp = useCallback(() => {
    if (dragState !== 'dragging') return
    dragStartRef.current = null
    // 误触产生的极小选区直接丢弃，回到待框选状态
    if (!selection || selection.width < 10 || selection.height < 10) {
      setSelection(null)
      setDragState('idle')
      return
    }
    void submitSelection(selection)
  }, [dragState, selection, submitSelection])

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 标注编辑态的快捷键（Enter 完成、Esc 取消、撤销）由 AnnotationEditor 处理
      if (dragState === 'editing') return
      if (e.key === 'Escape') {
        handleCancel()
      } else if (e.key === 'Enter' && dragState === 'idle') {
        // 无选区时 Enter 截全屏
        handleConfirm()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dragState, handleCancel, handleConfirm])

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

      {/* 标注编辑层：截图回填到选区原位，叠加标注画布与工具条 */}
      {dragState === 'editing' && editImage && selection && (
        <AnnotationEditor
          image={editImage}
          rect={selection}
          screenWidth={screenSize.width}
          workAreaBottom={workAreaBottom}
          onSave={(base64, width, height) => {
            screenshotApi.sendAnnotateSave({ base64, width, height })
          }}
          onCopy={(base64) => {
            screenshotApi.sendAnnotateCopy({
              base64,
              width: editImage.width,
              height: editImage.height,
            })
          }}
          onDownload={(base64) => {
            screenshotApi.sendAnnotateDownload({
              base64,
              width: editImage.width,
              height: editImage.height,
            })
          }}
          onCancel={() => {
            screenshotApi.sendCancel()
          }}
        />
      )}

      {/* 选区尺寸提示 */}
      {dragState !== 'editing' && selection && selection.width > 10 && selection.height > 10 && (
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

      {/* 截图进行中提示（主进程截屏 + 裁剪通常 200~400ms） */}
      {dragState === 'capturing' && (
        <div
          data-overlay-control
          style={{
            ...toolbarStyle,
            left: selection
              ? Math.max(8, Math.min(selection.x, screenSize.width - 140))
              : screenSize.width / 2 - 70,
            top: selection
              ? selection.y + selection.height + 8 <= workAreaBottom
                ? selection.y + selection.height + 8
                : Math.max(selection.y - 40, 8)
              : 40,
          }}
        >
          <span
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              color: '#fff',
              background: 'rgba(0, 0, 0, 0.75)',
              borderRadius: 6,
              fontFamily: '-apple-system, "PingFang SC", sans-serif',
            }}
          >
            正在截图…
          </span>
        </div>
      )}

      {/* 顶部提示（idle + dragging 显示引导，超时失败时显示错误） */}
      {(dragState === 'idle' || dragState === 'dragging') && (
        <div style={hintStyle}>
          {captureError
            ? captureError
            : dragState === 'idle'
              ? '拖拽选择区域 · Enter 截全屏 · ESC 取消'
              : '松开鼠标即进入标注 · ESC 取消'}
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
