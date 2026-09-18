/**
 * 性能追踪自动挂载（渲染进程）
 *
 * 应用同时存在多个渲染窗口：主窗口、桌面伴侣、悬浮头像、预览与覆盖层。
 * 上报开关默认关闭，只有主动调用 start 的窗口才会写数据，因此此前只有主窗口
 * 进入观测范围，其余窗口全程没有一条记录——它们一旦卡顿，连数据都拿不到。
 *
 * 覆盖靠两条路径合起来完成，缺一不可：
 * 1. 挂载时查询一次主进程状态，覆盖「追踪已经在进行，窗口才打开」；
 * 2. 订阅主进程广播的启停信号，覆盖「窗口已存在，追踪随后开启」。
 * 只做第二条会漏掉追踪期间新开的窗口，只做第一条则窗口后开的追踪无从跟随。
 *
 * 本模块不 import 上报器本体：上报器带着长任务观察器、计数器与每秒定时器，
 * 而多数窗口根本不会开启追踪。动态加载让未开启时的成本保持为一次订阅加一次
 * 状态查询。
 *
 * @module intelligence/diagnostics/perfTraceAutoStart
 */

/** 桥接的最小可用面（避免与类型声明文件强耦合） */
interface PerfTraceAutoBridge {
  status?: () => Promise<{
    success?: boolean
    data?: { running?: boolean; intervalMs?: number }
  }>
  onAutoStart?: (handler: (payload?: { intervalMs?: number }) => void) => void
  onAutoStop?: (handler: () => void) => void
}

/** 取性能追踪桥接 */
function getBridge(): PerfTraceAutoBridge | undefined {
  return (window as unknown as { electronAPI?: { perfTrace?: PerfTraceAutoBridge } }).electronAPI
    ?.perfTrace
}

/**
 * 挂载跟随逻辑。
 *
 * 每个渲染窗口入口调用一次即可。桥接缺失（非 Electron 环境、preload 未暴露）
 * 时静默返回：追踪是诊断能力，取不到就当它不存在，不影响窗口本身。
 */
export function installPerfTraceAutoStart(): void {
  const bridge = getBridge()
  if (!bridge) return

  bridge.onAutoStart?.((payload) => {
    void import('./perfTraceReporter').then((reporter) => {
      reporter.startLocal(payload?.intervalMs)
    })
  })

  bridge.onAutoStop?.(() => {
    void import('./perfTraceReporter').then((reporter) => {
      reporter.stopLocal()
    })
  })

  void (async () => {
    try {
      const response = await bridge.status?.()
      if (!response?.success || !response.data?.running) return

      const reporter = await import('./perfTraceReporter')
      reporter.startLocal(response.data.intervalMs)
    } catch {
      // 主进程不可达时不影响窗口本身
    }
  })()
}
