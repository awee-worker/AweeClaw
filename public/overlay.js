/**
 * AweeClaw 字幕 / 弹幕悬浮层 —— 渲染逻辑（原生 JS，无框架依赖）
 *
 * 职责：
 * 1. 建立通道并接收指令（双通道：优先 Electron IPC，其次 WebSocket）
 * 2. 按形态渲染：
 *    - subtitle：底部字幕条（最多 N 行，超时自动淡出）
 *    - danmaku ：顶部滚动弹幕（多轨道分配，避免重叠）
 * 3. 应用运行时配置（字号 / 速度 / 轨道数 / 描边 / 不透明度）
 *
 * 通道选择依据：
 * - 应用内透明窗口 → 有 preload，走 IPC（低延迟、无需服务）
 * - OBS 浏览器源  → 无 preload，自动降级到 WS（ws://127.0.0.1:<port>/ws/overlay）
 *   两者二选一消费，绝不会重复渲染。
 *
 * 配置来源优先级：
 *   1. window.__OVERLAY_CONFIG__（主进程 HTTP 服务注入，OBS 场景）
 *   2. window.electronAPI.overlay.getConfig()（应用内场景）
 *   3. 内置默认值
 */
;(function () {
  'use strict'

  // ============================================
  // 默认配置（与主进程 DEFAULT_OVERLAY_CONFIG 保持一致）
  // ============================================
  var DEFAULT_CONFIG = {
    windowMode: 'subtitle',
    window: { clickThrough: true, locked: false },
    subtitle: { fontSize: 34, durationMs: 8000, maxLines: 3, strokeWidth: 3, bgOpacity: 0.55 },
    danmaku: { fontSize: 30, speed: 180, tracks: 6, opacity: 1, filterLowPriority: false },
  }

  /** 需要过滤的低优先级弹幕类型（洪水保护） */
  var LOW_PRIORITY_TYPES = { enter_room: true, follow: true, like: true }

  /** WS 重连退避（毫秒） */
  var RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]

  // ============================================
  // 环境与状态
  // ============================================

  var query = readQuery()
  var mode = query.mode
  var portFromQuery = query.port

  var config = cloneDefault()
  var root = null
  var subtitleLayer = null
  var danmakuLayer = null
  var dragBar = null
  var statusHint = null

  /** WS 实例与重连状态 */
  var ws = null
  var reconnectAttempt = 0
  var reconnectTimer = null
  /** 是否已通过 IPC 通道接管（接管后不再建立 WS） */
  var usingIpc = false

  /** 每个轨道的「尾部离开屏幕」时间戳（performance.now 基准） */
  var trackTailAt = []

  // ============================================
  // 启动
  // ============================================

  function init() {
    root = document.getElementById('overlay-root')
    subtitleLayer = document.getElementById('subtitle-layer')
    danmakuLayer = document.getElementById('danmaku-layer')
    dragBar = document.getElementById('drag-bar')
    statusHint = document.getElementById('status-hint')

    if (!root || !subtitleLayer || !danmakuLayer) {
      // 结构缺失时静默退出（OBS 里不应出现报错弹层）
      return
    }

    root.setAttribute('data-mode', mode)

    loadConfig()
      .then(function (cfg) {
        config = cfg
        applyStyle()
        initTracks()
        syncDragBar()
        bindChannel()
      })
      .catch(function () {
        // 配置读取失败也要能把画面跑起来：用默认值继续
        applyStyle()
        initTracks()
        bindChannel()
      })
  }

  // ============================================
  // 配置
  // ============================================

  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  }

  /** 深合并（只覆盖已声明键，保持与主进程 mergeConfig 相同语义） */
  function merge(base, patch) {
    if (!patch || typeof patch !== 'object') return base
    Object.keys(base).forEach(function (key) {
      var next = patch[key]
      if (next === undefined || next === null) return
      var current = base[key]
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        merge(current, next)
      } else if (typeof next === typeof current) {
        base[key] = next
      }
    })
    return base
  }

  function loadConfig() {
    return new Promise(function (resolve) {
      // 1. 服务端注入（OBS 场景）
      if (window.__OVERLAY_CONFIG__ && typeof window.__OVERLAY_CONFIG__ === 'object') {
        resolve(merge(cloneDefault(), window.__OVERLAY_CONFIG__))
        return
      }

      // 2. 应用内 IPC
      var api = getOverlayApi()
      if (!api) {
        resolve(cloneDefault())
        return
      }

      api
        .getConfig()
        .then(function (res) {
          if (res && res.success && res.data) {
            resolve(merge(cloneDefault(), res.data))
          } else {
            resolve(cloneDefault())
          }
        })
        .catch(function () {
          resolve(cloneDefault())
        })
    })
  }

  /** 把配置写进 CSS 变量 */
  function applyStyle() {
    var style = document.documentElement.style
    style.setProperty('--overlay-subtitle-font-size', config.subtitle.fontSize + 'px')
    style.setProperty('--overlay-subtitle-bg-opacity', String(config.subtitle.bgOpacity))
    style.setProperty('--overlay-subtitle-stroke', config.subtitle.strokeWidth + 'px')
    style.setProperty('--overlay-danmaku-font-size', config.danmaku.fontSize + 'px')
    style.setProperty('--overlay-danmaku-opacity', String(config.danmaku.opacity))
  }

  function initTracks() {
    var count = Math.max(1, Math.min(20, config.danmaku.tracks | 0))
    trackTailAt = []
    for (var i = 0; i < count; i++) trackTailAt.push(0)
  }

  /** 拖拽条只在「应用内 + 非穿透 + 未锁定」时显示 */
  function syncDragBar() {
    if (!dragBar) return
    var isApp = !!getOverlayApi()
    var canDrag = isApp && !config.window.clickThrough && !config.window.locked
    dragBar.hidden = !canDrag
  }

  // ============================================
  // 通道
  // ============================================

  function getOverlayApi() {
    return window.electronAPI && window.electronAPI.overlay ? window.electronAPI.overlay : null
  }

  function bindChannel() {
    var api = getOverlayApi()

    if (api && typeof api.onEvent === 'function') {
      usingIpc = true
      api.onEvent(handleCommand)
      if (typeof api.onClickThroughChanged === 'function') {
        api.onClickThroughChanged(function (payload) {
          if (!payload) return
          config.window.clickThrough = !!payload.clickThrough
          syncDragBar()
        })
      }
      hideStatusHint()
      return
    }

    // 无 preload（OBS 场景）→ 走 WebSocket
    connectWs()
  }

  function resolveWsUrl() {
    if (portFromQuery) return 'ws://127.0.0.1:' + portFromQuery + '/ws/overlay'
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return 'ws://' + location.host + '/ws/overlay'
    }
    return 'ws://127.0.0.1:12800/ws/overlay'
  }

  function connectWs() {
    if (usingIpc) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    var url = resolveWsUrl()
    try {
      ws = new WebSocket(url)
    } catch (err) {
      scheduleReconnect()
      return
    }

    ws.onopen = function () {
      reconnectAttempt = 0
      hideStatusHint()
    }

    ws.onmessage = function (event) {
      var command = null
      try {
        command = JSON.parse(event.data)
      } catch (err) {
        return
      }
      handleCommand(command)
    }

    ws.onerror = function () {
      // 交给 onclose 统一处理重连
    }

    ws.onclose = function () {
      ws = null
      // 未连接时给一个轻提示，方便用户在 OBS 里定位问题（连上后自动隐藏）
      showStatusHint('等待 AweeClaw 连接…')
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    var delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)]
    reconnectAttempt++
    reconnectTimer = setTimeout(connectWs, delay)
  }

  // ============================================
  // 指令处理
  // ============================================

  function handleCommand(command) {
    if (!command || typeof command !== 'object') return

    if (command.action === 'clear') {
      clearAll()
      return
    }

    if (command.action === 'show' && command.data && typeof command.data.content === 'string') {
      render(command.data)
    }
  }

  function clearAll() {
    while (subtitleLayer.firstChild) subtitleLayer.removeChild(subtitleLayer.firstChild)
    while (danmakuLayer.firstChild) danmakuLayer.removeChild(danmakuLayer.firstChild)
    trackTailAt = trackTailAt.map(function () {
      return 0
    })
  }

  function render(payload) {
    if (mode === 'subtitle') {
      renderSubtitle(payload)
    } else {
      renderDanmaku(payload)
    }
  }

  // ============================================
  // 字幕
  // ============================================

  function renderSubtitle(payload) {
    var el = document.createElement('div')
    el.className = 'subtitle-item'
    el.textContent = payload.content
    subtitleLayer.appendChild(el)

    var maxLines = Math.max(1, config.subtitle.maxLines | 0)
    while (subtitleLayer.children.length > maxLines) {
      subtitleLayer.removeChild(subtitleLayer.firstChild)
    }

    var holdMs = Math.max(1000, config.subtitle.durationMs | 0)
    setTimeout(function () {
      fadeOutSubtitle(el)
    }, holdMs)
  }

  function fadeOutSubtitle(el) {
    if (!el || !el.parentNode) return
    el.classList.add('is-leaving')
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el)
    }, 260)
  }

  // ============================================
  // 弹幕
  // ============================================

  function renderDanmaku(payload) {
    var danmuType = payload.danmu_type || 'danmaku'

    if (config.danmaku.filterLowPriority && LOW_PRIORITY_TYPES[danmuType]) {
      return
    }

    var el = document.createElement('div')
    el.className = 'danmaku-item'
    el.setAttribute('data-type', danmuType)
    el.textContent = payload.content
    danmakuLayer.appendChild(el)

    var viewportWidth = danmakuLayer.clientWidth || window.innerWidth || 1920
    var fontSize = Math.max(12, config.danmaku.fontSize | 0)
    var trackHeight = Math.round(fontSize * 1.6)
    var speed = Math.max(30, config.danmaku.speed | 0)

    // 先测量文本宽度（此刻 transform 尚未生效，offsetWidth 是内容宽度）
    var textWidth = el.offsetWidth || 200
    var durationMs = ((textWidth + viewportWidth) / speed) * 1000

    var trackIndex = pickTrack(durationMs)

    el.style.top = trackIndex * trackHeight + 4 + 'px'

    var anim = null
    try {
      anim = el.animate(
        [
          { transform: 'translateX(' + viewportWidth + 'px)' },
          { transform: 'translateX(' + -textWidth + 'px)' },
        ],
        { duration: durationMs, easing: 'linear', fill: 'forwards' }
      )
    } catch (err) {
      // Web Animations API 不可用（极老内核）：退化为 CSS transition
      el.style.transition = 'transform ' + durationMs + 'ms linear'
      el.style.transform = 'translateX(' + -textWidth + 'px)'
      setTimeout(function () {
        removeNode(el)
      }, durationMs)
      return
    }

    anim.onfinish = function () {
      removeNode(el)
    }
  }

  /**
   * 选择轨道。
   *
   * 策略：优先挑「尾部已完全进入屏幕」的空闲轨道；都占用时挑最早空闲的
   * （允许轻微重叠，比直接丢弃更能保证弹幕不丢）。
   */
  function pickTrack(durationMs) {
    if (trackTailAt.length === 0) initTracks()

    var now = (window.performance && performance.now ? performance.now() : Date.now())
    var bestIndex = 0

    for (var i = 0; i < trackTailAt.length; i++) {
      if (trackTailAt[i] <= now) {
        trackTailAt[i] = now + durationMs
        return i
      }
      if (trackTailAt[i] < trackTailAt[bestIndex]) bestIndex = i
    }

    trackTailAt[bestIndex] = now + durationMs
    return bestIndex
  }

  function removeNode(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el)
  }

  // ============================================
  // 状态提示
  // ============================================

  function showStatusHint(text) {
    if (!statusHint) return
    statusHint.textContent = text
    statusHint.hidden = false
  }

  function hideStatusHint() {
    if (!statusHint) return
    statusHint.hidden = true
  }

  // ============================================
  // 工具
  // ============================================

  function readQuery() {
    var result = { mode: 'subtitle', port: 0 }
    try {
      var params = new URLSearchParams(location.search)
      result.mode = params.get('mode') === 'danmaku' ? 'danmaku' : 'subtitle'
      var portRaw = params.get('port')
      result.port = portRaw ? parseInt(portRaw, 10) || 0 : 0
    } catch (err) {
      /* 保持默认 */
    }
    return result
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
