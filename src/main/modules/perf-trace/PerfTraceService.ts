/**
 * 性能追踪服务
 *
 * 按固定间隔采样本应用的进程级 CPU / 内存占用与主进程事件循环延迟，
 * 连同渲染进程上报的锚点和采样，一起按行写入单个 JSONL 文件。
 *
 * 为什么不用现成的性能面板：
 * - 面板只给一条汇总曲线，本应用是多进程架构（主进程 / 渲染 / GPU /
 *   终端 PTY / 语言服务 / 本地语音 等若干 Utility），总量高无法定位到谁；
 * - 面板不落盘、不分函数，事后无法对比优化前后的差异。
 *
 * 落盘格式刻意选 JSONL：追加写不会因进程异常退出而损坏已有内容，
 * 且可以逐行流式读取，不必把整个文件载入内存。
 *
 * @module perf-trace/PerfTraceService
 */

import { app } from 'electron'
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'perf_hooks'
import { logger } from '@shared/toolkit/LogEngine'
import {
  PERF_TRACE_DEFAULT_INTERVAL_MS,
  PERF_TRACE_MAX_ANCHORS_PER_WINDOW,
  PERF_TRACE_MAX_RENDERER_PER_WINDOW,
  type PerfTraceMetaRecord,
  type PerfTraceProcessSample,
  type PerfTraceRecord,
  type PerfTraceReporterIdentity,
  type PerfTraceReportPayload,
  type PerfTraceStartOptions,
  type PerfTraceStatus,
  type PerfTraceTickRecord,
} from '@shared/protocols/perfTraceProtocol'

/** CPU 时间快照，用于在两次采样之间做差分 */
interface CpuSnapshot {
  idle: number
  total: number
}

/** 进程类型白名单：这几类无论占用多低都要留下，否则会丢失结构信息 */
const ALWAYS_KEEP_PROCESS_TYPES = new Set(['Browser', 'Tab', 'GPU'])

/** 单个进程的 CPU 保留门槛（%），低于此值且非白名单类型时不写入 */
const PROCESS_CPU_KEEP_THRESHOLD = 0.1

/**
 * 工具子进程的 CPU 保留门槛（%）。
 *
 * 比 Electron 进程的门槛高：这类进程是按需拉起的短任务，一次采样窗口里往往
 * 同时存在若干个几乎不占用的壳进程，门槛设低只会把 procs 撑满噪声。
 */
const TOOL_CPU_KEEP_THRESHOLD = 0.2

/**
 * 工具子进程的采样超时（毫秒）。
 *
 * `ps` 要遍历整张进程表，被系统拖慢时不阻塞采样循环（调用是异步的），
 * 但必须有个上限，否则回调可能落在很久之后，把陈旧的读数写进窗口。
 */
const TOOL_PS_TIMEOUT_MS = 1500

/**
 * 读取进程表的命令与字段顺序。
 *
 * 用 `time`（累计 CPU 时间）而不是 `%cpu`：BSD 的 `%cpu` 是自进程启动以来的
 * 衰减平均值，对「刚刚跑起来的工具命令」几乎恒为 0，而对跑完的长命令又长期
 * 偏高；累计时间做差分得到的才是本窗口的真实占用，与 Electron 侧口径一致。
 * `etime` 用于头一次采样没有基线时退回进程平均占用。
 */
const PS_ARGS = ['-Ao', 'pid=,ppid=,time=,etime=,rss=,comm=']

/**
 * 事件循环延迟的采样分辨率（毫秒）。
 *
 * 必须与采样间隔解耦，且固定取小值。`monitorEventLoopDelay` 的 resolution 就是
 * 内部定时器的触发周期，取大值会让读出的「延迟」趋近于 resolution 本身：
 * 实测 resolution=500 时 mean 恒在 500ms 附近、max 与 mean 只差一个桶宽，
 * 读数完全失去意义，会把「主进程卡了半秒」这种假象写进日志。10ms 与 Node
 * 默认值一致，既能捕捉到真实的阻塞时长，又不会因采样过密而引入可观开销。
 *
 * 解读方式：读数在空闲时就近似等于 resolution（实测 10ms 分辨率下 mean≈10.9ms），
 * 因此有意义的是它相对基线的抬升幅度，而不是绝对值。
 */
const LOOP_DELAY_RESOLUTION_MS = 10

/**
 * 逻辑核心数。
 *
 * 进程生命周期内不变，缓存一次即可。`os.cpus()` 每次调用都要读系统 CPU 信息
 * 并分配一组对象，而采样是每秒固定触发的高频路径，没有理由重复付出这份成本。
 */
const CPU_COUNT = os.cpus().length

export class PerfTraceService {
  private static instance: PerfTraceService | null = null

  private running = false
  private filePath: string | null = null
  private writeStream: fs.WriteStream | null = null
  private timer: NodeJS.Timeout | null = null

  private intervalMs = PERF_TRACE_DEFAULT_INTERVAL_MS
  private startedAt: number | null = null
  private seq = 0
  private recordCount = 0
  private droppedCount = 0
  private lastError = ''

  /** 上一次的 CPU 时间快照，第一次采样只建立基线 */
  private lastCpu: CpuSnapshot | null = null

  /** 事件循环延迟直方图，随追踪会话启停 */
  private loopHistogram: IntervalHistogram | null = null

  /** 当前采样窗口内已写入的条数，用于限流 */
  private windowAnchors = 0
  private windowRenderer = 0

  /**
   * 上一次采样写入 JSONL 的耗时。
   *
   * 本次写入的耗时无法计入本次记录（记录在写之前就已构造完成），因此滞后
   * 一拍带上。判读时看量级即可，不必苛求同窗口对齐。
   */
  private lastWriteMs = 0

  /**
   * 最近一次取回的工具子进程占用。
   *
   * 与 Electron 进程不同步采集：`ps` 是异步子进程，采样循环是同步的。
   * 让 `tick()` 等待它会把子进程启动开销摊进事件循环延迟里，正好落进这份
   * 诊断想解释的那个指标上；因此这里持有上一次的结果，本轮先用旧值。
   * 一个窗口的滞后对「哪个进程在烧 CPU」这个结论没有影响。
   */
  private toolSamples: PerfTraceProcessSample[] = []

  /** 进程表读取是否在途，避免上一轮没回来就再发一次 */
  private toolSampleInFlight = false

  /** 工具子进程的累计 CPU 时间基线：键为 pid，值为秒数与取数时刻 */
  private toolCpuBaseline = new Map<number, { cpuSeconds: number; at: number }>()

  /** 工具子进程的峰值内存：进程退出即失去观测，只能自己维护 */
  private toolPeakMB = new Map<number, number>()

  /** Electron 自己的进程号，由最近一次 getAppMetrics 填充 */
  private electronPids = new Set<number>()

  private constructor() {}

  static getInstance(): PerfTraceService {
    if (!PerfTraceService.instance) {
      PerfTraceService.instance = new PerfTraceService()
    }
    return PerfTraceService.instance
  }

  /** 当前是否正在追踪 */
  isRunning(): boolean {
    return this.running
  }

  /** 当前采样间隔（毫秒），供跟随开启上报的窗口保持一致 */
  getIntervalMs(): number {
    return this.intervalMs
  }

  /** 查询运行状态 */
  getStatus(): PerfTraceStatus {
    return {
      running: this.running,
      filePath: this.filePath,
      startedAt: this.startedAt,
      intervalMs: this.intervalMs,
      recordCount: this.recordCount,
      droppedCount: this.droppedCount,
      lastError: this.lastError,
    }
  }

  /**
   * 开始追踪。
   *
   * 重复调用会先停掉上一次会话，避免两个定时器同时追加同一文件时
   * 交错写入半行数据。
   */
  async start(options: PerfTraceStartOptions = {}): Promise<PerfTraceStatus> {
    if (this.running) {
      await this.stop()
    }

    const dir = options.dir && options.dir.trim() ? options.dir.trim() : this.defaultDir()
    const intervalMs = options.intervalMs && options.intervalMs >= 200
      ? Math.floor(options.intervalMs)
      : PERF_TRACE_DEFAULT_INTERVAL_MS

    await fs.promises.mkdir(dir, { recursive: true })

    const filePath = path.join(dir, `cpu-${formatStamp(new Date())}.jsonl`)
    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' })
    this.writeStream.on('error', (err) => {
      this.lastError = err instanceof Error ? err.message : String(err)
      logger.system?.error('[PerfTrace] 写入失败，已停止追踪:', err)
      void this.stop()
    })

    this.filePath = filePath
    this.intervalMs = intervalMs
    this.startedAt = Date.now()
    this.seq = 0
    this.recordCount = 0
    this.droppedCount = 0
    this.lastError = ''
    this.lastCpu = null
    this.windowAnchors = 0
    this.windowRenderer = 0
    this.lastWriteMs = 0
    this.toolSamples = []
    this.toolSampleInFlight = false
    this.toolCpuBaseline.clear()
    this.toolPeakMB.clear()
    this.electronPids.clear()

    // 事件循环延迟：分辨率与采样间隔无关，固定取小值（见 LOOP_DELAY_RESOLUTION_MS）
    this.loopHistogram = monitorEventLoopDelay({ resolution: LOOP_DELAY_RESOLUTION_MS })
    this.loopHistogram.enable()

    this.running = true

    this.writeMeta('start')

    this.timer = setInterval(() => {
      try {
        this.tick()
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        logger.system?.error('[PerfTrace] 采样异常:', err)
      }
    }, this.intervalMs)

    logger.system?.info(`[PerfTrace] 已开始追踪 → ${filePath}（间隔 ${intervalMs}ms）`)

    return this.getStatus()
  }

  /** 停止追踪并收尾落盘 */
  async stop(): Promise<PerfTraceStatus> {
    if (!this.running && !this.writeStream) {
      return this.getStatus()
    }

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    if (this.loopHistogram) {
      this.loopHistogram.disable()
      this.loopHistogram = null
    }

    if (this.running) {
      this.writeMeta('stop')
    }

    this.running = false

    const stream = this.writeStream
    this.writeStream = null

    if (stream) {
      // 等待内核缓冲刷完再返回，否则调用方立刻去读文件会读到截断的内容
      await new Promise<void>((resolve) => {
        stream.end(() => resolve())
      })
    }

    const finishedPath = this.filePath
    this.filePath = null
    this.startedAt = null

    logger.system?.info(`[PerfTrace] 已停止追踪，共 ${this.recordCount} 条 → ${finishedPath ?? '(未落盘)'}`)

    return this.getStatus()
  }

  /**
   * 接收渲染进程上报。
   *
   * 返回值只用于让调用方知道是否被写入，不阻塞上报方：渲染进程走单向
   * send，主进程侧同步返回，中间没有额外往返。
   */
  ingest(payload: PerfTraceReportPayload, identity?: PerfTraceReporterIdentity): boolean {
    if (!this.running || !payload || typeof payload !== 'object') return false

    // 身份由主进程补齐：渲染进程主世界拿不到稳定的进程标识，而 event.sender
    // 上 pid 与 webContents id 都是现成的。上报体来自 IPC 反序列化，是本次
    // 调用独占的对象，就地写入不必再复制一份。
    if (identity && (identity.pid !== undefined || identity.wid !== undefined)) {
      Object.assign(payload, identity)
    }

    if (payload.type === 'anchor') {
      if (this.windowAnchors >= PERF_TRACE_MAX_ANCHORS_PER_WINDOW) {
        this.droppedCount++
        return false
      }
      this.windowAnchors++
      this.write(payload)
      return true
    }

    if (payload.type === 'renderer') {
      if (this.windowRenderer >= PERF_TRACE_MAX_RENDERER_PER_WINDOW) {
        this.droppedCount++
        return false
      }
      this.windowRenderer++
      this.write(payload)
      return true
    }

    return false
  }

  // ============================================================
  // 内部实现
  // ============================================================

  /** 未指定目录时的默认落点：应用数据目录下的 perf-trace */
  private defaultDir(): string {
    return path.join(app.getPath('userData'), 'perf-trace')
  }

  /**
   * 单个采样窗口。
   *
   * 采样路径自身也要记账。getAppMetrics 要向所有子进程收取指标，是一次跨
   * 进程的同步操作，它花掉的时间会被算进本窗口的事件循环延迟里——不分开记，
   * 事后就无法区分「应用卡了 200ms」和「诊断工具量了 200ms」，而这两种结论
   * 指向完全相反的处置。
   */
  private tick(): void {
    const t = Date.now()
    const tStart = performance.now()

    const sysCpu = this.sampleSystemCpu()
    const tSysCpu = performance.now()

    const loop = this.sampleEventLoopDelay()
    const tLoop = performance.now()

    const procs = this.collectProcessSamples()
    const tProcs = performance.now()

    // 下一轮的进程表读取在这里发出：不参与本轮记录，但保证数据持续刷新
    this.sampleToolProcesses()

    // appCpu 只统计 Electron 自己的进程，工具命令（tsc / vite / node）拉起的
    // 子进程不在其中 —— 那恰恰是「执行命令时 CPU 高」最可能的归属。两者分开
    // 记：合成一个总数会让「应用外的占用」和「工具进程的占用」混成一栏，
    // 而这两者的处置完全不同。
    const electronCpu = procs.reduce((sum, p) => sum + (p.type === 'Tool' ? 0 : p.cpu), 0)
    const toolCpu = procs.reduce((sum, p) => sum + (p.type === 'Tool' ? p.cpu : 0), 0)

    const appCpu = round2(electronCpu)
    const load = os.loadavg()

    const record: PerfTraceTickRecord = {
      type: 'tick',
      t,
      seq: ++this.seq,
      sysCpu,
      appCpu,
      appCpuSharePct: round2(appCpu / CPU_COUNT),
      toolCpu: round2(toolCpu),
      loadavg: [round2(load[0] ?? 0), round2(load[1] ?? 0), round2(load[2] ?? 0)],
      cpuCount: CPU_COUNT,
      loop,
      self: {
        build: round2(tProcs - tStart),
        sysCpu: round2(tSysCpu - tStart),
        loop: round2(tLoop - tSysCpu),
        procs: round2(tProcs - tLoop),
        write: this.lastWriteMs,
      },
      procs,
    }

    const tWrite = performance.now()
    this.write(record)
    this.lastWriteMs = round2(performance.now() - tWrite)

    // 窗口计数随采样窗口一起归零
    this.windowAnchors = 0
    this.windowRenderer = 0
  }

  /**
   * 系统整体 CPU 占用。
   *
   * 与 appCpu 的差值是有用信号：若系统高而应用低，说明元凶在应用之外，
   * 继续在本仓库里找是白费力气。
   */
  private sampleSystemCpu(): number {
    let idle = 0
    let total = 0

    for (const cpu of os.cpus()) {
      const times = cpu.times
      // 直接按字段求和，避免为每个核分配一次 Object.values 数组
      total += times.user + times.nice + times.sys + times.irq + times.idle
      idle += times.idle
    }

    const previous = this.lastCpu
    this.lastCpu = { idle, total }

    if (!previous) return 0

    const totalDiff = total - previous.total
    const idleDiff = idle - previous.idle
    if (totalDiff <= 0) return 0

    return round2(((totalDiff - idleDiff) / totalDiff) * 100)
  }

  /** 主进程事件循环延迟（毫秒）。直方图读取后归零，得到的是本窗口内的统计。 */
  private sampleEventLoopDelay(): { mean: number; max: number; p99: number } {
    const histogram = this.loopHistogram
    if (!histogram) return { mean: 0, max: 0, p99: 0 }

    // histogram 以纳秒为单位
    const result = {
      mean: round2(histogram.mean / 1e6),
      max: round2(histogram.max / 1e6),
      p99: round2(histogram.percentile(99) / 1e6),
    }
    histogram.reset()
    return result
  }

  /** 读取各进程占用，按 CPU 降序 */
  private collectProcessSamples(): PerfTraceProcessSample[] {
    let metrics: ReturnType<typeof app.getAppMetrics>
    try {
      metrics = app.getAppMetrics()
    } catch (err) {
      // 应用退出过程中可能取不到
      logger.system?.warn('[PerfTrace] getAppMetrics 不可用:', err)
      return []
    }

    const samples: PerfTraceProcessSample[] = []
    this.electronPids.clear()

    for (const metric of metrics) {
      const cpu = round2(metric.cpu?.percentCPUUsage ?? 0)
      const type = metric.type ?? 'Unknown'

      this.electronPids.add(metric.pid)

      // 低占用的非核心进程不写，减少体积；核心进程始终保留以维持进程拓扑
      if (cpu < PROCESS_CPU_KEEP_THRESHOLD && !ALWAYS_KEEP_PROCESS_TYPES.has(type)) {
        continue
      }

      samples.push({
        pid: metric.pid,
        type,
        service: metric.serviceName || undefined,
        cpu,
        wakeups: round2(metric.cpu?.idleWakeupsPerSecond ?? 0),
        wsMB: kbToMB(metric.memory?.workingSetSize ?? 0),
        peakMB: kbToMB(metric.memory?.peakWorkingSetSize ?? 0),
      })
    }

    // 工具子进程直接追加：它们的 pid 与 Electron 进程不重叠（采集时已排除），
    // 因此不会再排序一次全局列表，只在末尾并入自己那一小段。
    for (const tool of this.toolSamples) {
      if (tool.cpu < TOOL_CPU_KEEP_THRESHOLD) continue
      samples.push(tool)
    }

    samples.sort((a, b) => b.cpu - a.cpu)
    return samples
  }

  /**
   * 读取应用进程树里的工具子进程。
   *
   * 只取 `process.pid` 的后代中不属于 Electron 的那些：Electron 自己的进程
   * 已经由 getAppMetrics 覆盖（那些有真实的唤醒次数），重复记录只会让同一份
   * 占用出现两次。
   */
  private sampleToolProcesses(): void {
    // Windows 的 ps 没有这套字段，跳过即可：这是补充归因，缺它不影响其余采样
    if (process.platform === 'win32') return
    if (this.toolSampleInFlight) return

    this.toolSampleInFlight = true
    execFile(
      'ps',
      PS_ARGS,
      { timeout: TOOL_PS_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        this.toolSampleInFlight = false
        if (err || !stdout) return
        try {
          this.toolSamples = this.parseProcessTable(stdout)
        } catch (parseErr) {
          // 解析失败保留上一次结果：宁可滞后一个窗口，也不写半截数据
          logger.system?.warn('[PerfTrace] 进程表解析失败:', parseErr)
        }
      },
    )
  }

  /**
   * 解析 `ps` 输出并挑出应用拉起的工具子进程。
   *
   * 占用取「累计 CPU 时间在本窗口内的增量」而非 `%cpu`：BSD 的 `%cpu` 是进程
   * 生命周期内的衰减均值，刚启动的命令近乎 0、早已跑完的命令长期偏高，恰好
   * 会漏掉最需要看见的短时高占用。首次见到某个 pid 时没有基线可用，退回
   * 「累计时间 / 已运行时间」的进程平均值，至少不为 0。
   */
  private parseProcessTable(stdout: string): PerfTraceProcessSample[] {
    const now = Date.now()
    const children = new Map<number, number[]>()
    const rows = new Map<number, { ppid: number; cpuSeconds: number; elapsedSeconds: number; rssMB: number; cmd: string }>()

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // pid ppid time etime rss comm —— comm 可能含空格，因此用前五段定界
      const parts = trimmed.split(/\s+/)
      if (parts.length < 6) continue

      const pid = Number(parts[0])
      const ppid = Number(parts[1])
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue

      const cpuSeconds = parsePsTime(parts[2])
      const elapsedSeconds = parsePsElapsed(parts[3])
      const rssMB = Number(parts[4]) / 1024
      const cmd = parts.slice(5).join(' ')

      rows.set(pid, { ppid, cpuSeconds, elapsedSeconds, rssMB, cmd })

      const siblings = children.get(ppid)
      if (siblings) siblings.push(pid)
      else children.set(ppid, [pid])
    }

    // 从主进程出发按层展开，只保留后代；Electron 进程随后被排除
    const seen = new Set<number>()
    const queue = [...(children.get(process.pid) ?? [])]
    const descendants: number[] = []
    while (queue.length > 0) {
      const pid = queue.pop() as number
      if (seen.has(pid)) continue
      seen.add(pid)
      descendants.push(pid)
      const kids = children.get(pid)
      if (kids) queue.push(...kids)
    }

    const samples: PerfTraceProcessSample[] = []

    for (const pid of descendants) {
      if (this.electronPids.has(pid)) continue

      const row = rows.get(pid)
      if (!row) continue

      const baseline = this.toolCpuBaseline.get(pid)
      let cpu = 0
      if (baseline && now - baseline.at >= 200) {
        cpu = ((row.cpuSeconds - baseline.cpuSeconds) / ((now - baseline.at) / 1000)) * 100
      } else if (row.elapsedSeconds > 0) {
        cpu = (row.cpuSeconds / row.elapsedSeconds) * 100
      }
      this.toolCpuBaseline.set(pid, { cpuSeconds: row.cpuSeconds, at: now })

      const peak = Math.max(this.toolPeakMB.get(pid) ?? 0, row.rssMB)
      this.toolPeakMB.set(pid, peak)

      samples.push({
        pid,
        type: 'Tool',
        cmd: row.cmd,
        cpu: round2(Math.max(0, cpu)),
        // 操作系统不按进程暴露唤醒次数，缺省 0 表示未采集
        wakeups: 0,
        wsMB: round2(row.rssMB),
        peakMB: round2(peak),
      })
    }

    // 回收已退出进程的基线：进程表里已经查不到 pid 就说明它结束了，
    // 否则长时间追踪下这两张表只增不减
    for (const pid of [...this.toolCpuBaseline.keys()]) {
      if (!rows.has(pid)) {
        this.toolCpuBaseline.delete(pid)
        this.toolPeakMB.delete(pid)
      }
    }

    samples.sort((a, b) => b.cpu - a.cpu)
    return samples
  }

  /** 写入会话元信息 */
  private writeMeta(event: 'start' | 'stop'): void {
    const record: PerfTraceMetaRecord = {
      type: 'meta',
      t: Date.now(),
      event,
      platform: process.platform,
      arch: process.arch,
      cpuCount: CPU_COUNT,
      appVersion: app.getVersion(),
      intervalMs: this.intervalMs,
      dropped: this.droppedCount,
    }
    this.write(record)
  }

  /** 追加一行 */
  private write(record: PerfTraceRecord): void {
    const stream = this.writeStream
    if (!stream || stream.destroyed) return

    try {
      stream.write(`${JSON.stringify(record)}\n`)
      this.recordCount++
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
    }
  }
}

/** 时间戳格式化为 20260918-211820，用于文件名排序 */
function formatStamp(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * 解析 `ps` 的时长字段（`time` / `etime`）。
 *
 * 两种格式都接受：`MM:SS.ss`、`HH:MM:SS`，以及 Linux 上带天数的
 * `D-HH:MM:SS`。字段缺失或格式意外时返回 0：这个值只用于换算占用，
 * 解析不出来时退化成「本窗口 0」，不会污染其他读数。
 */
function parsePsDuration(raw: string): number {
  if (!raw) return 0

  let rest = raw
  let days = 0
  const dash = rest.indexOf('-')
  if (dash > 0) {
    days = Number(rest.slice(0, dash))
    rest = rest.slice(dash + 1)
  }

  const parts = rest.split(':')
  if (parts.length === 0 || parts.length > 3) return 0

  let seconds = 0
  for (const part of parts) {
    const value = Number(part)
    if (!Number.isFinite(value)) return 0
    seconds = seconds * 60 + value
  }

  const total = days * 86400 + seconds
  return Number.isFinite(total) ? total : 0
}

/** 解析 `ps -o time=` 的累计 CPU 时间（秒） */
function parsePsTime(raw: string): number {
  return parsePsDuration(raw)
}

/** 解析 `ps -o etime=` 的已运行时长（秒） */
function parsePsElapsed(raw: string): number {
  return parsePsDuration(raw)
}

/** 保留两位小数 */
function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/** KB 转 MB */
function kbToMB(kb: number): number {
  if (!Number.isFinite(kb) || kb <= 0) return 0
  return Math.round((kb / 1024) * 10) / 10
}
