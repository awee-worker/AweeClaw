/**
 * 截图覆盖窗口 - 原生 JS 实现（无 React 依赖）
 *
 * 替代原 React 组件（src/renderer/components/screenshot-overlay/ScreenshotOverlay.tsx）：
 * 打包后 React vendor chunk 与 agent/ui-core 共享 chunk 循环依赖导致覆盖窗口 React 无法挂载，
 * 故改为纯原生 JS，逻辑与原组件完全一致：
 * - 整屏半透明黑色遮罩（让用户感知进入截图模式）
 * - 鼠标按下 → 开始框选，选区内透明（露出真实桌面），选区外保持暗化
 * - 鼠标松开 → 完成框选，显示确认/取消按钮
 * - 双击选区 → 直接确认
 * - ESC → 取消
 * - Enter → 确认（有选区确认选区，无选区截全屏）
 *
 * 依赖 window.electronAPI.screenshotOverlay（preload 暴露的 IPC API）：
 *   requestSetup() -> Promise<SetupPayload | null>
 *   sendCancel()
 *   sendConfirm(rect)
 */
(function () {
  'use strict'

  var root = document.getElementById('root')
  if (!root) {
    console.error('[ScreenshotOverlay] Root element #root not found')
    return
  }

  var api =
    window.electronAPI && window.electronAPI.screenshotOverlay
      ? window.electronAPI.screenshotOverlay
      : null
  if (!api) {
    // preload 未注入（理论不应发生），显示错误提示而非静默白屏
    root.innerHTML =
      '<div style="color:#fff;padding:20px;font-size:13px;font-family:-apple-system,\'PingFang SC\',sans-serif">' +
      'Screenshot overlay API unavailable</div>'
    console.error('[ScreenshotOverlay] electronAPI.screenshotOverlay not injected')
    return
  }

  // ============================================
  // 状态
  // ============================================
  /** 屏幕信息是否就绪（requestSetup 成功返回后置 true） */
  var ready = false
  /** idle | dragging | selected */
  var dragState = 'idle'
  /** 当前选区 { x, y, width, height }（CSS 像素） */
  var selection = null
  /** 屏幕尺寸（CSS 像素） */
  var screenSize = { width: 0, height: 0 }
  /** workArea 底部相对窗口顶部的偏移；窗口高度（=screenHeight）减去它 = Dock/任务栏高度 */
  var workAreaBottom = 0
  /** 屏幕完整高度（含菜单栏 + Dock），用于计算 bottom 定位 */
  var screenHeight = 0
  /** 拖拽起始点 */
  var dragStart = null

  // ============================================
  // DOM 骨架（一次性构建，状态变化仅更新样式，避免拖拽闪烁）
  // ============================================
  var container = document.createElement('div')
  container.style.cssText =
    'position:fixed;inset:0;overflow:hidden;cursor:crosshair;background:transparent;'
  root.appendChild(container)

  // 半透明遮罩：选区外区域暗化，选区内透明（露出真实桌面）。
  // 用 4 个 div 拼出"选区外"的暗化区域（比 SVG mask 更稳定，无跨平台渲染差异）。
  var maskBlocks = []
  for (var i = 0; i < 4; i++) {
    var block = document.createElement('div')
    block.style.cssText =
      'position:absolute;background:rgba(0,0,0,0.45);pointer-events:none;z-index:1;display:none;'
    container.appendChild(block)
    maskBlocks.push(block)
  }

  // idle 状态：整屏暗化
  var fullMask = document.createElement('div')
  fullMask.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.45);pointer-events:none;z-index:1;'
  container.appendChild(fullMask)

  // 选区边框
  var selBorder = document.createElement('div')
  selBorder.style.cssText =
    'position:absolute;border:2px solid #3b82f6;' +
    'box-shadow:0 0 0 1px rgba(59,130,246,0.3),inset 0 0 0 1px rgba(255,255,255,0.2);' +
    'pointer-events:none;z-index:10;display:none;'
  container.appendChild(selBorder)

  // 选区尺寸提示
  var sizeLabel = document.createElement('div')
  sizeLabel.style.cssText =
    'position:absolute;padding:2px 8px;background:rgba(0,0,0,0.75);color:#fff;' +
    'font-size:12px;border-radius:4px;font-family:-apple-system,Menlo,monospace;' +
    'pointer-events:none;z-index:11;white-space:nowrap;display:none;'
  container.appendChild(sizeLabel)

  // 顶部操作提示（idle + dragging 状态显示）
  var hint = document.createElement('div')
  hint.style.cssText =
    'position:absolute;top:20px;left:50%;transform:translateX(-50%);padding:8px 16px;' +
    'background:rgba(0,0,0,0.75);color:#fff;font-size:13px;border-radius:8px;' +
    'font-family:-apple-system,"PingFang SC",sans-serif;pointer-events:none;z-index:30;'
  container.appendChild(hint)

  // 按钮公共样式
  var btnBase =
    'padding:6px 14px;font-size:13px;color:#fff;border-radius:6px;cursor:pointer;' +
    'font-family:-apple-system,"PingFang SC",sans-serif;'

  // 确认/取消按钮组（selected 状态显示）
  var toolbar = document.createElement('div')
  toolbar.setAttribute('data-overlay-control', '1')
  toolbar.style.cssText = 'position:absolute;display:flex;gap:8px;z-index:20;'
  var cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消 (ESC)'
  cancelBtn.style.cssText =
    btnBase + 'background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);'
  cancelBtn.addEventListener('click', function () {
    api.sendCancel()
  })
  var confirmBtn = document.createElement('button')
  confirmBtn.textContent = '确认 (Enter)'
  confirmBtn.style.cssText =
    btnBase + 'background:#3b82f6;border:1px solid #2563eb;font-weight:500;'
  confirmBtn.addEventListener('click', function () {
    confirmSelection()
  })
  toolbar.appendChild(cancelBtn)
  toolbar.appendChild(confirmBtn)
  container.appendChild(toolbar)

  // 「截全屏」按钮组（idle 状态显示，底部居中）
  var fullToolbar = document.createElement('div')
  fullToolbar.setAttribute('data-overlay-control', '1')
  fullToolbar.style.cssText =
    'position:absolute;display:flex;gap:8px;z-index:20;left:50%;transform:translateX(-50%);'
  var fullCancelBtn = document.createElement('button')
  fullCancelBtn.textContent = '取消 (ESC)'
  fullCancelBtn.style.cssText =
    btnBase + 'background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);'
  fullCancelBtn.addEventListener('click', function () {
    api.sendCancel()
  })
  var fullConfirmBtn = document.createElement('button')
  fullConfirmBtn.textContent = '截全屏 (Enter)'
  fullConfirmBtn.style.cssText =
    btnBase + 'background:#3b82f6;border:1px solid #2563eb;font-weight:500;'
  fullConfirmBtn.addEventListener('click', function () {
    confirmSelection()
  })
  fullToolbar.appendChild(fullCancelBtn)
  fullToolbar.appendChild(fullConfirmBtn)
  container.appendChild(fullToolbar)

  // ============================================
  // 渲染（状态变化 → 更新 DOM 样式）
  // ============================================
  function render() {
    if (!ready) {
      // 透明 loading（不绘制遮罩，避免 ready 前遮挡桌面）
      fullMask.style.display = 'none'
      for (var m = 0; m < maskBlocks.length; m++) maskBlocks[m].style.display = 'none'
      selBorder.style.display = 'none'
      sizeLabel.style.display = 'none'
      hint.style.display = 'none'
      toolbar.style.display = 'none'
      fullToolbar.style.display = 'none'
      return
    }

    var hasSel = !!selection && selection.width > 0 && selection.height > 0

    // 遮罩
    if (hasSel) {
      fullMask.style.display = 'none'
      var s = selection
      var blocks = [
        // 上：选区上方
        { left: 0, top: 0, width: '100%', height: s.y + 'px' },
        // 下：选区下方
        { left: 0, top: s.y + s.height + 'px', width: '100%', bottom: 0 },
        // 左：选区左侧
        { left: 0, top: s.y + 'px', width: s.x + 'px', height: s.height + 'px' },
        // 右：选区右侧
        {
          left: s.x + s.width + 'px',
          top: s.y + 'px',
          right: 0,
          height: s.height + 'px',
        },
      ]
      for (var b = 0; b < 4; b++) {
        var bl = maskBlocks[b]
        bl.style.display = 'block'
        bl.style.left = blocks[b].left
        bl.style.top = blocks[b].top
        bl.style.width = blocks[b].width
        bl.style.height = blocks[b].height
        bl.style.right = blocks[b].right !== undefined ? blocks[b].right : 'auto'
        bl.style.bottom = blocks[b].bottom !== undefined ? blocks[b].bottom : 'auto'
      }

      // 选区边框
      selBorder.style.display = 'block'
      selBorder.style.left = s.x + 'px'
      selBorder.style.top = s.y + 'px'
      selBorder.style.width = s.width + 'px'
      selBorder.style.height = s.height + 'px'

      // 尺寸提示（选区 > 10px 才显示）
      if (s.width > 10 && s.height > 10) {
        sizeLabel.style.display = 'block'
        sizeLabel.textContent = Math.round(s.width) + ' \u00d7 ' + Math.round(s.height)
        sizeLabel.style.left = s.x + 'px'
        sizeLabel.style.top = s.y + s.height + 8 + 'px'
      } else {
        sizeLabel.style.display = 'none'
      }
    } else {
      fullMask.style.display = 'block'
      for (var b2 = 0; b2 < 4; b2++) maskBlocks[b2].style.display = 'none'
      selBorder.style.display = 'none'
      sizeLabel.style.display = 'none'
    }

    // 确认/取消按钮（selected）
    if (dragState === 'selected' && hasSel) {
      toolbar.style.display = 'flex'
      // 优先在选区下方显示；若超出 workArea 底部（被 Dock 遮挡），则改在选区上方显示
      var left = Math.min(selection.x + selection.width - 180, screenSize.width - 190)
      var top =
        selection.y + selection.height + 44 <= workAreaBottom
          ? selection.y + selection.height + 8
          : Math.max(selection.y - 40, 8)
      toolbar.style.left = left + 'px'
      toolbar.style.top = top + 'px'
    } else {
      toolbar.style.display = 'none'
    }

    // 「截全屏」按钮（idle）
    if (dragState === 'idle' && screenSize.width > 0) {
      fullToolbar.style.display = 'flex'
      // bottom = 窗口底部到按钮栏底部的距离 = Dock高度 + 按钮栏高度 + 安全间距
      // Dock高度 = screenHeight - workAreaBottom；按钮栏高度 ≈ 36px；安全间距 = 12px
      fullToolbar.style.bottom =
        screenHeight > 0 && workAreaBottom > 0
          ? screenHeight - workAreaBottom + 36 + 12 + 'px'
          : '80px'
      fullToolbar.style.top = 'auto'
    } else {
      fullToolbar.style.display = 'none'
    }

    // 顶部提示
    if (dragState !== 'selected') {
      hint.style.display = 'block'
      hint.textContent =
        dragState === 'idle'
          ? '\u62d6\u62fd\u9009\u62e9\u533a\u57df \u00b7 Enter \u622a\u5168\u5c4f \u00b7 ESC \u53d6\u6d88'
          : '\u677e\u5f00\u9f20\u6807\u5b8c\u6210\u6846\u9009 \u00b7 ESC \u53d6\u6d88'
    } else {
      hint.style.display = 'none'
    }
  }

  // ============================================
  // 动作
  // ============================================
  function confirmSelection() {
    if (selection && selection.width >= 10 && selection.height >= 10) {
      api.sendConfirm(selection)
      return
    }
    if (screenSize.width > 0 && screenSize.height > 0) {
      api.sendConfirm({ x: 0, y: 0, width: screenSize.width, height: screenSize.height })
      return
    }
    api.sendCancel()
  }

  // ============================================
  // 事件
  // ============================================
  container.addEventListener('mousedown', function (e) {
    // 点击按钮时不触发框选
    if (e.target && e.target.closest && e.target.closest('[data-overlay-control]')) return
    dragStart = { x: e.clientX, y: e.clientY }
    dragState = 'dragging'
    selection = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
    render()
  })

  container.addEventListener('mousemove', function (e) {
    if (dragState !== 'dragging' || !dragStart) return
    var start = dragStart
    var x = Math.min(start.x, e.clientX)
    var y = Math.min(start.y, e.clientY)
    selection = {
      x: x,
      y: y,
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
    }
    render()
  })

  container.addEventListener('mouseup', function () {
    if (dragState !== 'dragging') return
    dragStart = null
    if (selection && (selection.width < 10 || selection.height < 10)) {
      selection = null
      dragState = 'idle'
    } else {
      dragState = 'selected'
    }
    render()
  })

  // 双击选区确认
  container.addEventListener('dblclick', function () {
    if (dragState === 'selected') confirmSelection()
  })

  // 键盘快捷键
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      api.sendCancel()
    } else if (e.key === 'Enter') {
      if (dragState === 'selected' || dragState === 'idle') confirmSelection()
    }
  })

  // ============================================
  // 初始化：请求屏幕信息（用于 Enter 截全屏时计算全屏选区 + 按钮定位）
  // ============================================
  api
    .requestSetup()
    .then(function (payload) {
      if (!payload) {
        console.error('[ScreenshotOverlay] No setup data received')
        return
      }
      screenSize = { width: payload.screenWidth, height: payload.screenHeight }
      screenHeight = payload.screenHeight
      // workArea 底部相对屏幕原点 = workAreaY + workAreaHeight
      workAreaBottom = payload.workAreaY + payload.workAreaHeight
      ready = true
      render()
    })
    .catch(function (err) {
      console.error('[ScreenshotOverlay] Request setup failed:', err)
    })
})()
