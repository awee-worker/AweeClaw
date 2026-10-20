/**
 * 截图覆盖窗口 - 原生 JS 实现（无 React 依赖）
 *
 * 打包后 React vendor chunk 与 agent/ui-core 共享 chunk 形成循环依赖，
 * 覆盖窗口加载时序会触发 ui-core 执行时 React.forwardRef 为 undefined，
 * 导致 React 应用无法挂载、蒙版不渲染。故改为纯原生 JS：无任何 chunk 依赖，
 * dev 与打包行为完全一致。
 *
 * 交互流程：
 * - 整屏半透明遮罩，用户透过窗口看到真实桌面并在其上框选
 * - 鼠标松开 → 提交选区，主进程隐藏窗口截图后回传裁剪结果
 * - 拿到裁剪图进入标注态：截图铺在选区原位，叠加画笔/矩形/箭头等工具
 * - 完成 → 合成图交给主进程落盘并注入输入框；复制/保存为另两种收尾
 *
 * 依赖 window.electronAPI.screenshotOverlay（preload 暴露的 IPC API）：
 *   requestSetup() -> Promise<SetupPayload | null>
 *   sendCancel()
 *   requestCapture(rect) -> Promise<EditImagePayload | null>
 *   sendAnnotateSave(payload) / sendAnnotateCopy(payload) / sendAnnotateDownload(payload)
 */
;(function () {
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
  // 常量
  // ============================================
  /** 可选标注颜色 */
  var COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#1c1c1e']
  /** 可选线宽档位（CSS 像素，绘制前乘以 scaleFactor） */
  var LINE_WIDTHS = [3, 5, 8]
  /** 文字工具基准字号（CSS 像素） */
  var TEXT_FONT_SIZE = 18
  /**
   * 图标路径（24×24 viewBox，描边风格）
   *
   * 工具条全部使用图标：工具数量多，中文标签会把工具条撑到接近整屏宽度，
   * 小尺寸下图形也比文字更容易一眼区分。语义由 title 悬停提示补充。
   */
  var ICON_PATHS = {
    rect: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M12.5 5H19v6.5"/>',
    pen: '<path d="M4 20l.9-3.6L16 5.3a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L8.6 19.1 5 20z"/>',
    // 高亮：一支斜握的荧光笔 + 笔下的纸面折角，比抽象的斜方块一眼就能认出是"涂亮"
    highlight:
      '<path d="m9 11-6 6v3h9l3-3"/>' +
      '<path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    // 马赛克：外框圈出处理区域，内部对角两格填实构成棋盘格，
    // 这是透明底/已模糊处理的通用视觉，比等分的四个实心块更能读成"这块被打码了"
    mosaic:
      '<rect x="3.5" y="3.5" width="17" height="17" rx="2.6"/>' +
      '<rect x="5.7" y="5.7" width="5.7" height="5.7" rx="0.9" fill="currentColor" stroke="none"/>' +
      '<rect x="12.6" y="12.6" width="5.7" height="5.7" rx="0.9" fill="currentColor" stroke="none"/>',
    // 文字：字母 T
    text: '<path d="M5.5 6h13"/><path d="M12 6v12.5"/>',
    undo: '<path d="M9.5 14 4.5 9l5-5"/><path d="M4.5 9h8a6 6 0 0 1 0 12H9"/>',
    copy:
      '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
      '<path d="M15 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h.5"/>',
    save: '<path d="M12 3.5v10"/><path d="M8 10l4 4 4-4"/><path d="M4 19.5h16"/>',
    done: '<path d="M4.5 12.5l5 5 10-11"/>',
    cancel: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  }

  /** 生成描边图标 SVG */
  function iconSvg(name, size) {
    return (
      '<svg viewBox="0 0 24 24" width="' +
      size +
      '" height="' +
      size +
      '" fill="none" stroke="currentColor" stroke-width="1.7"' +
      ' stroke-linecap="round" stroke-linejoin="round"' +
      ' style="display:block;pointer-events:none">' +
      (ICON_PATHS[name] || '') +
      '</svg>'
    )
  }

  /** 各工具按钮定义（label 仅用于 title 提示） */
  var TOOLS = [
    { tool: 'rect', label: '矩形' },
    { tool: 'ellipse', label: '椭圆' },
    { tool: 'arrow', label: '箭头' },
    { tool: 'pen', label: '画笔' },
    { tool: 'highlight', label: '高亮' },
    { tool: 'mosaic', label: '马赛克' },
    { tool: 'text', label: '文字' },
  ]

  // ============================================
  // 状态
  // ============================================
  /** 屏幕信息是否就绪（requestSetup 成功返回后置 true） */
  var ready = false
  /** idle | dragging | selected | capturing | editing */
  var mode = 'idle'
  /** 当前选区 { x, y, width, height }（CSS 像素） */
  var selection = null
  /** 屏幕尺寸（CSS 像素） */
  var screenSize = { width: 0, height: 0 }
  /** workArea 底部相对窗口顶部的偏移；窗口高度（=screenHeight）减去它 = Dock/任务栏高度 */
  var workAreaBottom = 0
  /** Dock/任务栏占用高度（主进程按屏幕与 workArea 差值算出） */
  var dockHeight = 0
  /** 屏幕完整高度（含菜单栏 + Dock），用于计算 bottom 定位 */
  var screenHeight = 0
  /** 拖拽起始点 */
  var dragStart = null
  /** 选区提交后到拿到裁剪图之前为 true，避免重复提交 */
  var submitting = false

  // 标注态状态
  /** 主进程回传的裁剪图 { base64, width, height, scaleFactor } */
  var editImage = null
  /** CSS 偏移 → 物理像素的缩放比 */
  var scaleFactor = 1
  /** 竖直方向的缩放比：宽高比例理论上相同，但取整后仍有细微差异，分开存更准 */
  var scaleFactorY = 1
  /** 底图 canvas（只含截图，马赛克需要回采它的像素） */
  var baseCanvas = null
  /** 底图是否已解码完成 */
  var imageReady = false
  /** 已确认的标注集合 */
  var items = []
  /** 当前拖拽中的草稿标注 */
  var draft = null
  /** 当前工具：null 表示未激活任何工具，此时画布处于选择/移动态 */
  var tool = null
  /** 正在移动的已有标注：{ item, grab, origin, moved } */
  var moving = null
  /** 当前颜色 */
  var color = COLORS[0]
  /** 当前线宽（CSS 像素） */
  var lineWidthCss = LINE_WIDTHS[0]
  /** 是否正在画布上拖拽 */
  var drawing = false
  /** 文字输入中：{ cssX, cssY } */
  var textAnchor = null

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
    'font-family:-apple-system,"PingFang SC",sans-serif;border:1px solid rgba(255,255,255,0.2);'
  var btnGhost = btnBase + 'background:rgba(0,0,0,0.6);'
  var btnPrimary = btnBase + 'background:#3b82f6;border:1px solid #2563eb;font-weight:500;'

  // 确认/取消按钮组（selected 状态显示）
  var toolbar = document.createElement('div')
  toolbar.setAttribute('data-overlay-control', '1')
  toolbar.style.cssText = 'position:absolute;display:flex;gap:8px;z-index:20;'
  var cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消 (ESC)'
  cancelBtn.style.cssText = btnGhost
  cancelBtn.addEventListener('click', function () {
    api.sendCancel()
  })
  var confirmBtn = document.createElement('button')
  confirmBtn.textContent = '确认 (Enter)'
  confirmBtn.style.cssText = btnPrimary
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
  fullCancelBtn.style.cssText = btnGhost
  fullCancelBtn.addEventListener('click', function () {
    api.sendCancel()
  })
  var fullConfirmBtn = document.createElement('button')
  fullConfirmBtn.textContent = '截全屏 (Enter)'
  fullConfirmBtn.style.cssText = btnPrimary
  fullConfirmBtn.addEventListener('click', function () {
    confirmSelection()
  })
  fullToolbar.appendChild(fullCancelBtn)
  fullToolbar.appendChild(fullConfirmBtn)
  container.appendChild(fullToolbar)

  // 截图进行中提示（主进程隐藏窗口截图，通常 200~600ms）
  var captureHint = document.createElement('div')
  captureHint.setAttribute('data-overlay-control', '1')
  captureHint.style.cssText =
    'position:absolute;z-index:25;display:none;padding:6px 14px;font-size:13px;color:#fff;' +
    'background:rgba(0,0,0,0.75);border-radius:6px;transform:translateX(-50%);' +
    'font-family:-apple-system,"PingFang SC",sans-serif;'
  captureHint.textContent = '正在截图…'
  container.appendChild(captureHint)
  /** 提示的延迟显示定时器：截图很快时不弹，避免提示一闪而过 */
  var captureHintTimer = null

  // ============================================
  // 标注编辑层 DOM
  // ============================================
  /** 编辑区：定位在选区原位，裁剪图 1:1 铺满 */
  var editorWrap = document.createElement('div')
  editorWrap.setAttribute('data-overlay-control', '1')
  editorWrap.style.cssText =
    'position:absolute;overflow:hidden;z-index:12;display:none;' +
    'box-shadow:0 0 0 1px rgba(59,130,246,0.9);'
  container.appendChild(editorWrap)

  /** 底层画布：底图 + 已确认标注 */
  var committedCanvas = document.createElement('canvas')
  committedCanvas.style.cssText = 'position:absolute;left:0;top:0;display:block;'
  editorWrap.appendChild(committedCanvas)

  /** 上层画布：当前拖拽中的草稿，每次移动重绘，与底层互不干扰 */
  var draftCanvas = document.createElement('canvas')
  draftCanvas.style.cssText = 'position:absolute;left:0;top:0;display:block;touch-action:none;'
  editorWrap.appendChild(draftCanvas)

  /** 文字输入框（点击文字工具后出现在点击位置） */
  var textArea = document.createElement('textarea')
  textArea.placeholder = '输入文字'
  textArea.style.cssText =
    'position:absolute;display:none;min-width:140px;padding:2px 4px;' +
    'background:rgba(0,0,0,0.55);border-radius:3px;outline:none;resize:none;' +
    'font-size:' +
    TEXT_FONT_SIZE +
    'px;line-height:1.35;font-weight:600;' +
    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;'
  editorWrap.appendChild(textArea)

  /** 标注工具条 */
  var annotToolbar = document.createElement('div')
  annotToolbar.setAttribute('data-overlay-control', '1')
  annotToolbar.style.cssText =
    'position:absolute;z-index:20;display:none;align-items:center;gap:4px;' +
    'padding:5px 6px;background:rgba(28,28,30,0.94);border-radius:8px;' +
    'box-shadow:0 6px 20px rgba(0,0,0,0.35);' +
    'font-family:-apple-system,"PingFang SC",sans-serif;'
  container.appendChild(annotToolbar)

  /**
   * 自定义悬停提示
   *
   * 不用原生 title：macOS 上原生提示有一秒多的延迟且样式无法控制，图标按钮没有文字标签时
   * 用户几乎得不到引导。这里用 fixed 定位的小气泡，鼠标进入即显示，位置跟着按钮走。
   */
  var tipEl = document.createElement('div')
  tipEl.style.cssText =
    'position:fixed;z-index:60;display:none;padding:4px 9px;border-radius:5px;' +
    'background:rgba(0,0,0,0.9);color:#fff;font-size:12px;line-height:1.4;white-space:nowrap;' +
    'pointer-events:none;box-shadow:0 3px 10px rgba(0,0,0,0.35);' +
    'font-family:-apple-system,"PingFang SC",sans-serif;'
  container.appendChild(tipEl)

  var tipTimer = null

  /** 隐藏提示并清除待显示定时器 */
  function hideTip() {
    if (tipTimer) {
      clearTimeout(tipTimer)
      tipTimer = null
    }
    tipEl.style.display = 'none'
  }

  /** 把提示气泡摆到按钮正上方，超出屏幕边缘则夹取 */
  function positionTip(target) {
    var box = target.getBoundingClientRect()
    // 先显示以便读取宽度
    var tipWidth = tipEl.offsetWidth
    var tipHeight = tipEl.offsetHeight
    var left = box.left + box.width / 2 - tipWidth / 2
    left = Math.max(6, Math.min(left, window.innerWidth - tipWidth - 6))
    var top = box.top - tipHeight - 6
    if (top < 6) top = box.bottom + 6
    tipEl.style.left = left + 'px'
    tipEl.style.top = top + 'px'
  }

  /** 给按钮挂上悬停提示（替代 title） */
  function attachTip(btn, text) {
    btn.addEventListener('mouseenter', function () {
      if (tipTimer) clearTimeout(tipTimer)
      tipTimer = setTimeout(function () {
        tipEl.textContent = text
        tipEl.style.display = 'block'
        positionTip(btn)
      }, 120)
    })
    btn.addEventListener('mouseleave', hideTip)
    btn.addEventListener('mousedown', hideTip)
    btn.addEventListener('click', hideTip)
  }

  /** 工具按钮（记录引用以便刷新选中态） */
  var toolButtons = []
  TOOLS.forEach(function (meta) {
    var btn = document.createElement('button')
    btn.setAttribute('aria-label', meta.label)
    btn.innerHTML = iconSvg(meta.tool, 20)
    btn.style.cssText =
      'width:32px;height:32px;padding:0;display:flex;align-items:center;' +
      'justify-content:center;color:#fff;cursor:pointer;border-radius:6px;' +
      'border:1px solid transparent;background:transparent;'
    attachTip(btn, meta.label)
    // 工具按钮是开关：点一次开始标注，再点同一个按钮退出标注回到选择态
    btn.addEventListener('click', function () {
      tool = tool === meta.tool ? null : meta.tool
      // 退出标注时先收掉未提交的文字，避免输入框悬浮在画布上
      if (!tool) commitText()
      renderAnnotToolbar()
    })
    annotToolbar.appendChild(btn)
    toolButtons.push({ tool: meta.tool, el: btn })
  })

  /** 分隔线 */
  function separator() {
    var line = document.createElement('div')
    line.style.cssText =
      'width:1px;height:20px;background:rgba(255,255,255,0.18);margin:0 2px;'
    return line
  }
  annotToolbar.appendChild(separator())

  /** 颜色色块 */
  var colorButtons = []
  COLORS.forEach(function (value) {
    var dot = document.createElement('button')
    dot.setAttribute('aria-label', value)
    dot.style.cssText =
      'width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;' +
      'border:2px solid transparent;background:' +
      value +
      ';'
    attachTip(dot, value)
    dot.addEventListener('click', function () {
      color = value
      if (textAnchor) textArea.style.color = color
      renderAnnotToolbar()
    })
    annotToolbar.appendChild(dot)
    colorButtons.push({ color: value, el: dot })
  })

  annotToolbar.appendChild(separator())

  /** 线宽档位 */
  var widthButtons = []
  LINE_WIDTHS.forEach(function (value) {
    var btn = document.createElement('button')
    btn.setAttribute('aria-label', '线宽 ' + value)
    btn.style.cssText =
      'width:26px;height:26px;padding:0;cursor:pointer;background:transparent;' +
      'border:1px solid transparent;border-radius:6px;display:flex;' +
      'align-items:center;justify-content:center;'
    var dot = document.createElement('span')
    dot.style.cssText =
      'display:block;border-radius:50%;background:#fff;width:' +
      (value + 1) +
      'px;height:' +
      (value + 1) +
      'px;'
    btn.appendChild(dot)
    attachTip(btn, '线宽 ' + value)
    btn.addEventListener('click', function () {
      lineWidthCss = value
      renderAnnotToolbar()
    })
    annotToolbar.appendChild(btn)
    widthButtons.push({ width: value, el: btn })
  })

  annotToolbar.appendChild(separator())

  /** 动作按钮（图标 + 悬停提示，primary 为高亮主操作） */
  function annotButton(icon, label, primary) {
    var btn = document.createElement('button')
    btn.setAttribute('aria-label', label)
    btn.innerHTML = iconSvg(icon, 20)
    btn.style.cssText =
      'width:32px;height:32px;padding:0;display:flex;align-items:center;' +
      'justify-content:center;color:#fff;cursor:pointer;border-radius:6px;' +
      (primary
        ? 'background:#3b82f6;border:1px solid #2563eb;'
        : 'background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.16);')
    attachTip(btn, label)
    annotToolbar.appendChild(btn)
    return btn
  }

  var undoBtn = annotButton('undo', '撤销 (Cmd/Ctrl+Z)')
  undoBtn.addEventListener('click', function () {
    items.pop()
    redrawCommitted()
  })
  var copyBtn = annotButton('copy', '复制到剪贴板')
  copyBtn.addEventListener('click', function () {
    var base64 = exportBase64()
    if (!base64) return
    api.sendAnnotateCopy({ base64: base64, width: editImage.width, height: editImage.height })
    showToast('已复制到剪贴板')
  })
  var saveBtn = annotButton('save', '保存为文件')
  saveBtn.addEventListener('click', function () {
    var base64 = exportBase64()
    if (!base64) return
    api.sendAnnotateDownload({ base64: base64, width: editImage.width, height: editImage.height })
  })

  // 导出（撤销/复制/保存）与收尾（取消/完成）分成两组，竖线把两种操作意图隔开
  annotToolbar.appendChild(separator())

  // 取消在左、完成在右，与弹出式对话框的习惯一致，主操作固定在最后一个位置
  var cancelAnnotBtn = annotButton('cancel', '取消 (Esc)')
  cancelAnnotBtn.addEventListener('click', function () {
    api.sendCancel()
  })
  var doneBtn = annotButton('done', '完成 (Enter)', true)
  doneBtn.addEventListener('click', function () {
    finishEditing()
  })

  /** 轻提示（复制成功等） */
  var toast = document.createElement('div')
  toast.style.cssText =
    'position:absolute;left:50%;top:12px;transform:translateX(-50%);padding:5px 14px;' +
    'border-radius:14px;background:rgba(0,0,0,0.78);color:#fff;font-size:12px;' +
    'pointer-events:none;z-index:5;display:none;' +
    'font-family:-apple-system,"PingFang SC",sans-serif;'
  editorWrap.appendChild(toast)

  var toastTimer = null
  function showToast(text) {
    toast.textContent = text
    toast.style.display = 'block'
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      toast.style.display = 'none'
    }, 1600)
  }

  /** 是否已通知主进程恢复窗口（整个编辑流程只通知一次） */
  var revealRequested = false

  /**
   * 通知主进程恢复覆盖窗口的不透明度
   *
   * 截图期间窗口整体透明（遮罩不能进入截图）。恢复时机放在编辑态绘制完成之后：
   * 图片解码、画布铺设、工具条定位都做完了才发起通知，窗口重新可见的第一帧就是
   * 带截图和工具的完整界面，不会先闪出一帧「只有选框、没有工具」的中间画面。
   * 延时 32ms 约两帧，确保合成器已经拿到新的图层内容。
   */
  function revealWindow() {
    if (revealRequested) return
    revealRequested = true
    setTimeout(function () {
      if (api.notifyReady) api.notifyReady()
    }, 32)
  }

  // ============================================
  // 标注绘制内核（坐标均为物理像素）
  // ============================================

  /** 把两个对角点整理成「左上角 + 宽高」 */
  function toRect(start, end) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  /** 箭头：主线 + 两条箭头翼 */
  function drawArrow(ctx, start, end, lineWidth) {
    var dx = end.x - start.x
    var dy = end.y - start.y
    var length = Math.sqrt(dx * dx + dy * dy)
    if (length < 1) return

    var angle = Math.atan2(dy, dx)
    // 箭头翼长度随线宽增长，但设下限避免细线时箭头小到看不清
    var headLength = Math.max(lineWidth * 4, 12)
    var headAngle = Math.PI / 7

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLength * Math.cos(angle - headAngle),
      end.y - headLength * Math.sin(angle - headAngle),
    )
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLength * Math.cos(angle + headAngle),
      end.y - headLength * Math.sin(angle + headAngle),
    )
    ctx.stroke()
  }

  /** 画笔轨迹：折线连接所有采样点 */
  function drawPath(ctx, points) {
    if (!points || points.length === 0) return

    // 单点也要可见：画一个圆点
    if (points.length === 1) {
      ctx.beginPath()
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (var i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.stroke()
  }

  /**
   * 马赛克：把底图对应区域缩到极小再放大回去，实现像素块化
   *
   * 块大小跟线宽联动（3/5/8 → 约 9/15/24 物理像素），
   * 用户切换到粗档就能获得更明显的遮挡效果。
   */
  function drawMosaic(ctx, rect, lineWidth) {
    if (!baseCanvas) return
    var x = rect.x
    var y = rect.y
    var width = rect.width
    var height = rect.height
    if (width < 1 || height < 1) return

    var block = Math.max(6, lineWidth * 3)
    var smallWidth = Math.max(1, Math.round(width / block))
    var smallHeight = Math.max(1, Math.round(height / block))

    var buffer = document.createElement('canvas')
    buffer.width = smallWidth
    buffer.height = smallHeight
    var bufferCtx = buffer.getContext('2d')
    if (!bufferCtx) return

    bufferCtx.imageSmoothingEnabled = false
    bufferCtx.drawImage(baseCanvas, x, y, width, height, 0, 0, smallWidth, smallHeight)

    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(buffer, 0, 0, smallWidth, smallHeight, x, y, width, height)
    ctx.restore()
  }

  /** 文字：逐行绘制，先描边再填充，保证在任意背景上都可读 */
  function drawText(ctx, item) {
    var content = item.text || ''
    if (!content) return

    var fontSize = item.fontSize || 20
    var lineHeight = fontSize * 1.3

    ctx.save()
    ctx.font =
      '600 ' + fontSize + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'

    var outlineWidth = Math.max(2, fontSize / 7)
    var lines = content.split('\n')

    for (var index = 0; index < lines.length; index++) {
      var line = lines[index]
      if (!line) continue
      var lineY = item.start.y + index * lineHeight
      ctx.lineWidth = outlineWidth
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(line, item.start.x, lineY)
      ctx.fillStyle = item.color
      ctx.fillText(line, item.start.x, lineY)
    }

    ctx.restore()
  }

  /** 绘制单条标注 */
  function drawItem(ctx, item) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = item.color
    ctx.fillStyle = item.color
    ctx.lineWidth = item.lineWidth

    if (item.tool === 'rect') {
      var rect = toRect(item.start, item.end)
      if (rect.width >= 1 || rect.height >= 1) {
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
      }
    } else if (item.tool === 'ellipse') {
      var er = toRect(item.start, item.end)
      if (er.width >= 1 && er.height >= 1) {
        ctx.beginPath()
        ctx.ellipse(
          er.x + er.width / 2,
          er.y + er.height / 2,
          er.width / 2,
          er.height / 2,
          0,
          0,
          Math.PI * 2,
        )
        ctx.stroke()
      }
    } else if (item.tool === 'arrow') {
      drawArrow(ctx, item.start, item.end, item.lineWidth)
    } else if (item.tool === 'pen') {
      drawPath(ctx, item.points)
    } else if (item.tool === 'highlight') {
      var hr = toRect(item.start, item.end)
      if (hr.width >= 1 && hr.height >= 1) {
        ctx.globalAlpha = 0.32
        ctx.fillRect(hr.x, hr.y, hr.width, hr.height)
      }
    } else if (item.tool === 'mosaic') {
      drawMosaic(ctx, toRect(item.start, item.end), item.lineWidth)
    } else if (item.tool === 'text') {
      drawText(ctx, item)
    }

    ctx.restore()
  }

  /** 重绘底层：底图 + 全部已确认标注 */
  function redrawCommitted() {
    if (!editImage) return
    var ctx = committedCanvas.getContext('2d')
    if (!ctx || !baseCanvas || !imageReady) return
    ctx.clearRect(0, 0, editImage.width, editImage.height)
    ctx.drawImage(baseCanvas, 0, 0)
    for (var i = 0; i < items.length; i++) {
      drawItem(ctx, items[i])
    }
  }

  /** 重绘上层：只画当前草稿 */
  function redrawDraft() {
    if (!editImage) return
    var ctx = draftCanvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, editImage.width, editImage.height)
    if (draft) {
      drawItem(ctx, draft)
    }
  }

  /** 合成最终图片：底层已含底图与标注，若仍有草稿则一并叠加 */
  function exportBase64() {
    if (!editImage) return ''
    var out = document.createElement('canvas')
    out.width = editImage.width
    out.height = editImage.height
    var ctx = out.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(committedCanvas, 0, 0)
    ctx.drawImage(draftCanvas, 0, 0)
    var dataUrl = out.toDataURL('image/png')
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  }

  // ============================================
  // 标注交互
  // ============================================

  /** 把指针位置换算成画布物理像素坐标 */
  function toCanvasPoint(clientX, clientY) {
    var box = editorWrap.getBoundingClientRect()
    return {
      x: (clientX - box.left) * scaleFactor,
      y: (clientY - box.top) * scaleFactorY,
    }
  }

  /** 判断一条标注是否值得保留（过滤误触产生的极小图形） */
  function isValidItem(item) {
    if (item.tool === 'pen') return item.points.length > 1
    if (item.tool === 'text') return !!(item.text && item.text.trim())
    if (item.tool === 'arrow') {
      return Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) >= 6
    }
    var width = Math.abs(item.end.x - item.start.x)
    var height = Math.abs(item.end.y - item.start.y)
    return width >= 4 && height >= 4
  }

  /** 生成一个空标注项（起点与终点重合，拖拽时不断更新终点） */
  function createItem(startPoint) {
    return {
      tool: tool,
      color: color,
      lineWidth: lineWidthCss * scaleFactor,
      start: { x: startPoint.x, y: startPoint.y },
      end: { x: startPoint.x, y: startPoint.y },
      points: [{ x: startPoint.x, y: startPoint.y }],
    }
  }

  /** 标注的命中范围：包围盒外扩约一个线宽，比视觉边界宽容一点才好点中 */
  function itemBounds(item) {
    var pad = Math.max(8, item.lineWidth * 1.5)

    if (item.tool === 'pen') {
      if (!item.points || item.points.length === 0) return null
      var minX = Infinity
      var minY = Infinity
      var maxX = -Infinity
      var maxY = -Infinity
      for (var i = 0; i < item.points.length; i++) {
        var p = item.points[i]
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      return {
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
      }
    }

    if (item.tool === 'text') {
      // 文字没有实测宽高，按字号估算：中文一字约一个字号宽，这里折中取 0.75
      var fontSize = item.fontSize || 20
      var lines = String(item.text || '').split('\n')
      var widest = 0
      for (var l = 0; l < lines.length; l++) {
        if (lines[l].length > widest) widest = lines[l].length
      }
      return {
        x: item.start.x - pad,
        y: item.start.y - pad,
        width: widest * fontSize * 0.75 + pad * 2,
        height: lines.length * fontSize * 1.3 + pad * 2,
      }
    }

    var rect = toRect(item.start, item.end)
    return {
      x: rect.x - pad,
      y: rect.y - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    }
  }

  /** 从最上层往下找命中的标注（后画的盖住先画的） */
  function hitTestItem(point) {
    for (var i = items.length - 1; i >= 0; i--) {
      var box = itemBounds(items[i])
      if (!box) continue
      if (
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height
      ) {
        return items[i]
      }
    }
    return null
  }

  /** 快照标注坐标：拖动时以按下瞬间的坐标为基准，避免逐帧累加产生漂移 */
  function snapshotItem(item) {
    return {
      start: { x: item.start.x, y: item.start.y },
      end: { x: item.end.x, y: item.end.y },
      points:
        item.points && item.points.length
          ? item.points.map(function (p) {
              return { x: p.x, y: p.y }
            })
          : null,
    }
  }

  /** 按快照 + 位移整体平移标注，形状与尺寸保持不变 */
  function shiftItem(item, origin, dx, dy) {
    item.start = { x: origin.start.x + dx, y: origin.start.y + dy }
    item.end = { x: origin.end.x + dx, y: origin.end.y + dy }
    if (origin.points) {
      item.points = origin.points.map(function (p) {
        return { x: p.x + dx, y: p.y + dy }
      })
    }
  }

  draftCanvas.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return
    e.stopPropagation()

    var box = editorWrap.getBoundingClientRect()

    if (tool === 'text') {
      // 文字工具：在点击位置弹出输入框
      // 必须 preventDefault：否则浏览器在 pointerdown 之后会把焦点移回文档，
      // 刚 focus 的输入框立刻 blur，被 blur 处理器提交并隐藏，表现为"点了没法输入"。
      e.preventDefault()
      commitText()
      textAnchor = { cssX: e.clientX - box.left, cssY: e.clientY - box.top }
      textArea.value = ''
      textArea.style.display = 'block'
      textArea.style.left = textAnchor.cssX + 'px'
      textArea.style.top = textAnchor.cssY + 'px'
      textArea.style.color = color
      textArea.style.border = '1px solid ' + color
      textArea.style.maxWidth = Math.max(140, box.width - textAnchor.cssX - 8) + 'px'
      textArea.focus()
      return
    }

    // 未激活工具即选择态：按住已有标注拖动调整位置，点空白处不产生新标注
    if (!tool) {
      var grab = toCanvasPoint(e.clientX, e.clientY)
      var hit = hitTestItem(grab)
      if (!hit) return
      e.preventDefault()
      draftCanvas.setPointerCapture(e.pointerId)
      moving = { item: hit, grab: grab, origin: snapshotItem(hit) }
      return
    }

    e.preventDefault()
    draftCanvas.setPointerCapture(e.pointerId)
    drawing = true
    draft = createItem(toCanvasPoint(e.clientX, e.clientY))
    redrawDraft()
  })

  draftCanvas.addEventListener('pointermove', function (e) {
    // 移动已有标注：直接改底层画布，草稿层保持干净
    if (moving) {
      var movePoint = toCanvasPoint(e.clientX, e.clientY)
      var dx = movePoint.x - moving.grab.x
      var dy = movePoint.y - moving.grab.y
      shiftItem(moving.item, moving.origin, dx, dy)
      redrawCommitted()
      return
    }

    if (!drawing || !draft) {
      // 选择态下指针压在某条标注上时给出可拖动的反馈
      if (!tool) {
        draftCanvas.style.cursor = hitTestItem(toCanvasPoint(e.clientX, e.clientY))
          ? 'move'
          : 'default'
      }
      return
    }

    var point = toCanvasPoint(e.clientX, e.clientY)

    if (draft.tool === 'pen') {
      var last = draft.points[draft.points.length - 1]
      // 采样抽稀：距离过近的点丢弃，避免轨迹数组膨胀
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return
      draft.points.push(point)
      draft.end = point
    } else {
      draft.end = point
    }
    redrawDraft()
  })

  function endDraw() {
    // 移动结束：位置已在 pointermove 里写回，这里只需清理拖动状态
    if (moving) {
      moving = null
      redrawCommitted()
      return
    }
    if (!drawing) return
    drawing = false
    if (draft && isValidItem(draft)) {
      items.push(draft)
    }
    draft = null
    redrawDraft()
    redrawCommitted()
  }

  draftCanvas.addEventListener('pointerup', endDraw)
  draftCanvas.addEventListener('pointercancel', endDraw)

  // 画布上按下鼠标不能冒泡到 container，否则会触发框选
  draftCanvas.addEventListener('mousedown', function (e) {
    e.stopPropagation()
  })

  /** 提交文字输入 */
  function commitText() {
    if (!textAnchor) return
    var content = textArea.value.trim()
    var anchor = textAnchor
    textAnchor = null
    textArea.style.display = 'none'
    if (!content) return

    items.push({
      tool: 'text',
      color: color,
      lineWidth: lineWidthCss * scaleFactor,
      start: { x: anchor.cssX * scaleFactor, y: anchor.cssY * scaleFactorY },
      end: { x: anchor.cssX * scaleFactor, y: anchor.cssY * scaleFactorY },
      points: [],
      text: content,
      fontSize: TEXT_FONT_SIZE * scaleFactor,
    })
    redrawCommitted()
  }

  textArea.addEventListener('blur', commitText)
  textArea.addEventListener('keydown', function (e) {
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitText()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      textAnchor = null
      textArea.style.display = 'none'
    }
  })

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
      captureHint.style.display = 'none'
      editorWrap.style.display = 'none'
      annotToolbar.style.display = 'none'
      return
    }

    var hasSel = !!selection && selection.width > 0 && selection.height > 0
    // 标注态沿用选区作为"取景框"：选区内显示截图与画布，四周仍暗化
    var showSelectionFrame = hasSel && mode !== 'idle'

    // 遮罩
    if (showSelectionFrame) {
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

      // 选区边框（标注态由编辑区自带的蓝框代替，避免双边框）
      // capturing 阶段保留边框与尺寸提示：截图期间界面元素越少变化，中断感越弱
      if (mode !== 'idle' && mode !== 'editing') {
        selBorder.style.display = 'block'
        selBorder.style.left = s.x + 'px'
        selBorder.style.top = s.y + 'px'
        selBorder.style.width = s.width + 'px'
        selBorder.style.height = s.height + 'px'
      } else {
        selBorder.style.display = 'none'
      }

      // 尺寸提示（框选阶段才需要）
      if (mode !== 'editing' && s.width > 10 && s.height > 10) {
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
    if (mode === 'selected' && hasSel) {
      toolbar.style.display = 'flex'
      // 优先在选区下方显示；若超出 workArea 底部（被 Dock 遮挡），则改在选区上方显示
      var left = Math.min(selection.x + selection.width - 180, screenSize.width - 190)
      // 选区下方放得下就放在下方，否则翻到选区上方；两种情况都夹在 Dock 之上
      var confirmMaxTop = toolbarMaxTop(38)
      var confirmBelow = selection.y + selection.height + 8
      var top = confirmBelow <= confirmMaxTop ? confirmBelow : selection.y - 46
      top = Math.max(8, Math.min(top, confirmMaxTop))
      toolbar.style.left = Math.max(8, left) + 'px'
      toolbar.style.top = top + 'px'
    } else {
      toolbar.style.display = 'none'
    }

    // 「截全屏」按钮（idle）
    if (mode === 'idle' && screenSize.width > 0) {
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

    // 截图进行中提示：定位在选区中心，且延迟 300ms 才出现。
    // 截图通常 200~400ms 完成，立刻弹提示会一闪而过；只有真卡住时用户才需要这个反馈。
    if (mode === 'capturing' && selection) {
      var centerX = selection.x + selection.width / 2
      var centerY = selection.y + selection.height / 2
      captureHint.style.left = Math.max(70, Math.min(centerX, screenSize.width - 70)) + 'px'
      captureHint.style.top = Math.max(8, centerY - 14) + 'px'
      if (!captureHintTimer) {
        captureHintTimer = setTimeout(function () {
          captureHintTimer = null
          if (mode === 'capturing') captureHint.style.display = 'block'
        }, 300)
      }
    } else {
      if (captureHintTimer) {
        clearTimeout(captureHintTimer)
        captureHintTimer = null
      }
      captureHint.style.display = 'none'
    }
    // 顶部提示（只在框选阶段显示）
    if (mode === 'idle' || mode === 'dragging') {
      hint.style.display = 'block'
      hint.textContent =
        mode === 'idle'
          ? '拖拽选择区域 · Enter 截全屏 · ESC 取消'
          : '松开鼠标即进入标注 · ESC 取消'
    } else {
      hint.style.display = 'none'
    }

    // 编辑层
    if (mode === 'editing' && editImage && selection) {
      editorWrap.style.display = 'block'
      editorWrap.style.left = selection.x + 'px'
      editorWrap.style.top = selection.y + 'px'
      editorWrap.style.width = selection.width + 'px'
      editorWrap.style.height = selection.height + 'px'
      annotToolbar.style.display = 'flex'
      renderAnnotToolbar()
      positionAnnotToolbar()
    } else {
      editorWrap.style.display = 'none'
      annotToolbar.style.display = 'none'
    }
  }

  /**
   * 工具条可用的最大 top（底部安全线）
   *
   * workArea 已经排除了 Dock 与菜单栏，工具条底边压到它之下就会被程序坞挡住。
   * 留 8px 间距，并且再和屏幕高度取小值兜底，避免 workArea 数据缺失时越界。
   */
  function toolbarMaxTop(barHeight) {
    // workArea 缺失时用「屏幕高度 - Dock 高度」兜底，避免工具条压进程序坞
    var limit = workAreaBottom > 0 ? workAreaBottom : screenHeight - dockHeight
    if (screenHeight > 0) limit = Math.min(limit, screenHeight)
    return limit - barHeight - 8
  }

  /** 工具条定位：优先选区下方，下方放不下则翻到上方，最终夹在 Dock 之上 */
  function positionAnnotToolbar() {
    if (!selection) return
    // 先让浏览器算出工具条真实宽度，再做水平夹取
    var barWidth = annotToolbar.offsetWidth || 640
    var barHeight = annotToolbar.offsetHeight || 40

    var left = Math.min(selection.x, screenSize.width - barWidth - 8)
    left = Math.max(8, left)

    var maxTop = toolbarMaxTop(barHeight)
    var below = selection.y + selection.height + 8
    // 选区贴底时下方放不下，改放选区上方；选区几乎占满整屏时会被夹回顶部
    var top = below <= maxTop ? below : selection.y - barHeight - 8
    top = Math.max(8, Math.min(top, maxTop))

    annotToolbar.style.left = left + 'px'
    annotToolbar.style.top = top + 'px'
  }

  /** 刷新工具条选中态 */
  function renderAnnotToolbar() {
    for (var i = 0; i < toolButtons.length; i++) {
      var active = toolButtons[i].tool === tool
      toolButtons[i].el.style.background = active ? 'rgba(59,130,246,0.9)' : 'transparent'
      toolButtons[i].el.style.borderColor = active ? '#2563eb' : 'transparent'
    }
    for (var c = 0; c < colorButtons.length; c++) {
      var picked = colorButtons[c].color === color
      colorButtons[c].el.style.borderColor = picked ? '#3b82f6' : 'transparent'
      colorButtons[c].el.style.transform = picked ? 'scale(1.15)' : 'scale(1)'
    }
    for (var w = 0; w < widthButtons.length; w++) {
      var on = widthButtons[w].width === lineWidthCss
      widthButtons[w].el.style.background = on ? 'rgba(59,130,246,0.9)' : 'transparent'
      widthButtons[w].el.style.borderColor = on ? '#2563eb' : 'transparent'
    }
    // 文字工具用文字光标，绘图工具为十字，未激活工具时是普通指针（此时可拖动已有标注）
    draftCanvas.style.cursor = tool === 'text' ? 'text' : tool ? 'crosshair' : 'default'
  }

  // ============================================
  // 动作
  // ============================================

  /** 提交选区给主进程截图，拿到裁剪图后进入标注态 */
  function confirmSelection() {
    if (submitting) return

    var rect = null
    if (selection && selection.width >= 10 && selection.height >= 10) {
      rect = selection
    } else if (screenSize.width > 0 && screenSize.height > 0) {
      rect = { x: 0, y: 0, width: screenSize.width, height: screenSize.height }
    } else {
      api.sendCancel()
      return
    }

    submitting = true
    selection = rect
    mode = 'capturing'
    render()

    api
      .requestCapture(rect)
      .then(function (payload) {
        submitting = false
        if (!payload) {
          // 主进程侧已结束流程（截图失败或窗口已关闭），不再改动界面
          return
        }
        enterEditing(payload)
      })
      .catch(function (err) {
        console.error('[ScreenshotOverlay] Capture failed:', err)
        submitting = false
        selection = null
        mode = 'idle'
        render()
        hint.style.display = 'block'
        hint.textContent = '截图失败，请重新框选'
      })
  }

  /** 进入标注态：铺设裁剪图并初始化标注画布 */
  function enterEditing(payload) {
    editImage = payload
    scaleFactor = payload.scaleFactor || 1
    items = []
    draft = null
    drawing = false
    imageReady = false
    // 每轮编辑重新允许通知主进程恢复窗口
    revealRequested = false
    // 进入标注态默认不激活工具：先看清截图，点工具才开始画
    tool = null
    moving = null
    color = COLORS[0]
    lineWidthCss = LINE_WIDTHS[0]
    textAnchor = null
    textArea.style.display = 'none'

    // 画布尺寸 = 物理像素，CSS 尺寸由编辑区（选区尺寸）决定，两者比例即 scaleFactor
    committedCanvas.width = payload.width
    committedCanvas.height = payload.height
    draftCanvas.width = payload.width
    draftCanvas.height = payload.height
    committedCanvas.style.width = selection.width + 'px'
    committedCanvas.style.height = selection.height + 'px'
    draftCanvas.style.width = selection.width + 'px'
    draftCanvas.style.height = selection.height + 'px'

    // 比例以「画布像素 ÷ 编辑区 CSS 尺寸」实算，与主进程实际裁剪比例保持一致；
    // 主进程传入的 scaleFactor 仅作初始兜底，两者若有微小差异时以画布为准，
    // 否则标注落点会随位置线性偏离被标注的内容。
    scaleFactor = payload.width / Math.max(1, selection.width)
    scaleFactorY = payload.height / Math.max(1, selection.height)

    // 底图解码：画布尺寸与图片一致，直接 1:1 绘制
    baseCanvas = document.createElement('canvas')
    baseCanvas.width = payload.width
    baseCanvas.height = payload.height

    // 解码完成前保持 "capturing" 界面，不提前切到编辑态：
    // 先切 editing 再异步填图会露出一块空画布、随后被图片覆盖，视觉上就是"闪一下"。
    // 解码用 createImageBitmap 而非 Image：不走 DOM 图片管线，Retina 大图能快十几毫秒。
    function applyBitmap(source) {
      var ctx = baseCanvas.getContext('2d')
      if (ctx) ctx.drawImage(source, 0, 0, payload.width, payload.height)
      imageReady = true
      redrawCommitted()
      redrawDraft()
      mode = 'editing'
      render()
      // render 内已按 offsetWidth 定位一次，这里再补一次以消除首次布局误差
      positionAnnotToolbar()
      showToast('选择工具开始标注，再点一次可退出')
      // 界面已就绪，通知主进程把窗口恢复可见（第一帧直接是编辑态）
      revealWindow()
    }

    function decodeFailed() {
      console.error('[ScreenshotOverlay] Decode cropped image failed')
      selection = null
      mode = 'idle'
      render()
      hint.style.display = 'block'
      hint.textContent = '截图解码失败，请重新框选'
      // 解码失败也要通知恢复，否则窗口会一直停留在透明态
      revealWindow()
    }

    /** 回退路径：createImageBitmap 不可用或 Blob 转换失败时仍按 Image 解码 */
    function decodeWithImage() {
      var img = new Image()
      img.onload = function () {
        applyBitmap(img)
      }
      img.onerror = decodeFailed
      img.src = 'data:image/png;base64,' + payload.base64
    }

    try {
      var binary = atob(payload.base64)
      var bytes = new Uint8Array(binary.length)
      for (var k = 0; k < binary.length; k++) bytes[k] = binary.charCodeAt(k)

      if (typeof createImageBitmap === 'function') {
        createImageBitmap(new Blob([bytes], { type: 'image/png' }))
          .then(function (bitmap) {
            applyBitmap(bitmap)
            if (bitmap.close) bitmap.close()
          })
          .catch(decodeWithImage)
      } else {
        decodeWithImage()
      }
    } catch (err) {
      console.error('[ScreenshotOverlay] Base64 decode failed:', err)
      decodeWithImage()
    }
  }

  /** 完成标注：合成图交给主进程落盘并注入输入框 */
  function finishEditing() {
    if (!editImage) return
    commitText()
    var base64 = exportBase64()
    if (!base64) return
    api.sendAnnotateSave({
      base64: base64,
      width: editImage.width,
      height: editImage.height,
    })
  }

  // ============================================
  // 事件
  // ============================================
  container.addEventListener('mousedown', function (e) {
    // 标注态、截图态不响应框选
    if (mode === 'editing' || mode === 'capturing') return
    // 点击按钮时不触发框选
    if (e.target && e.target.closest && e.target.closest('[data-overlay-control]')) return

    dragStart = { x: e.clientX, y: e.clientY }
    mode = 'dragging'
    selection = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
    render()
  })

  container.addEventListener('mousemove', function (e) {
    if (mode !== 'dragging' || !dragStart) return
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
    if (mode !== 'dragging') return
    dragStart = null
    if (selection && (selection.width < 10 || selection.height < 10)) {
      selection = null
      mode = 'idle'
      render()
      return
    }
    // 松手直接提交截图，进入标注态（无需再点确认）
    confirmSelection()
  })

  // 双击选区重新提交（例如标注态误按 Esc 后回到框选）
  container.addEventListener('dblclick', function () {
    if (mode === 'selected') confirmSelection()
  })

  // 键盘快捷键
  window.addEventListener('keydown', function (e) {
    if (mode === 'editing') {
      if (e.key === 'Escape') {
        if (textAnchor) {
          textAnchor = null
          textArea.style.display = 'none'
          return
        }
        api.sendCancel()
      } else if (e.key === 'Enter') {
        if (textAnchor) return
        e.preventDefault()
        finishEditing()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        items.pop()
        redrawCommitted()
      }
      return
    }

    if (e.key === 'Escape') {
      api.sendCancel()
    } else if (e.key === 'Enter') {
      if (mode === 'idle' || mode === 'selected') confirmSelection()
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
      // 主进程已把 workArea 底边换算到覆盖窗口坐标系，直接用；
      // 老版本返回值没有该字段时退回自行相加（单屏原点为 0 时两者等价）
      workAreaBottom =
        typeof payload.workAreaBottom === 'number'
          ? payload.workAreaBottom
          : payload.workAreaY + payload.workAreaHeight
      dockHeight = typeof payload.dockHeight === 'number' ? payload.dockHeight : 0
      ready = true
      render()
    })
    .catch(function (err) {
      console.error('[ScreenshotOverlay] Request setup failed:', err)
    })
})()
