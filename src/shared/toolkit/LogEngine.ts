/**
 * 日志引擎 — 基于输出槽策略与环形缓冲区的事件驱动日志系统
 *
 * 核心机制：
 * - 输出槽策略模式：将日志输出抽象为独立 Sink（ConsoleSink / FileSink），支持热插拔与自定义扩展
 * - 环形缓冲区存储：固定容量缓冲区，O(1) 入队与淘汰，避免数组 shift() 的 O(n) 开销
 * - 定时批量刷新：固定间隔合并写入请求，配合异步落盘，避免阻塞事件循环
 * - 双通道着色：主进程使用 ANSI 转义序列，渲染进程使用 CSS 样式字符串
 *
 * 落盘策略（性能约束）：
 * 日志写入发生在与业务共享的事件循环上，任何同步文件操作都会直接表现为界面卡顿。
 * 因此 FileSink 只使用异步 I/O，并把「目录检查」「文件大小检查」这类系统调用
 * 降频到只在必要时执行；队列积压时按等级丢弃低价值日志，保证主流程不被日志拖垮。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                           */
/* ------------------------------------------------------------------ */

/** 日志严重等级 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 日志分类标签 */
export type LogCategory =
  | 'Agent'
  | 'LLM'
  | 'Tool'
  | 'LSP'
  | 'UI'
  | 'System'
  | 'Completion'
  | 'Store'
  | 'File'
  | 'Git'
  | 'IPC'
  | 'Index'
  | 'Security'
  | 'Settings'
  | 'Terminal'
  | 'Performance'
  | 'Cache'
  | 'MCP'
  | 'Plan'
  | 'Channel'
  | 'Gateway'
  | 'Scenario'
  | 'Session'
  | 'Desktop'
  | 'Perception'
  | 'Monitoring'
  | 'Causal'
  | 'IoT'
  | 'Proactive'
  | 'DeviceLink'

/** 单条日志记录的不可变快照 */
export interface LogEntry {
  timestamp: Date
  level: LogLevel
  category: LogCategory
  message: string
  data?: unknown
  duration?: number
  source?: 'main' | 'renderer'
  scenarioId?: string
}

/** 分类日志器接口 */
export interface CategoryLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  time(message: string, duration: number, data?: unknown): void
}

/** 引擎配置选项 */
export interface LoggerConfig {
  minLevel: LogLevel
  enabled: boolean
  maxLogs: number
  fileLogging: boolean
  consoleLogging: boolean
  logFilePath?: string
  maxFileSize: number
  maxFiles: number
}

/* ------------------------------------------------------------------ */
/* 常量映射                                                           */
/* ------------------------------------------------------------------ */

/** 等级权重 — 数值越大优先级越高 */
const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
})

/** 渲染进程 CSS 配色 — 采用青蓝-琥珀-玫红三色系 */
const RENDER_LEVEL_HUE: Readonly<Record<LogLevel, string>> = Object.freeze({
  debug: '#78909c',
  info: '#26c6da',
  warn: '#ffb300',
  error: '#e53935',
})

/** 渲染进程分类配色 — 采用去饱和度调色板 */
const RENDER_CATEGORY_HUE: Readonly<Partial<Record<LogCategory, string>>> = Object.freeze({
  Agent: '#7e57c2',
  LLM: '#42a5f5',
  Tool: '#66bb6a',
  LSP: '#ff7043',
  UI: '#ec407a',
  System: '#78909c',
  Completion: '#26c6da',
  Store: '#8d6e63',
  File: '#9ccc65',
  Git: '#ffa726',
  IPC: '#5c6bc0',
  Index: '#26a69a',
  Security: '#ef5350',
  Settings: '#7e57c2',
  Terminal: '#26c6da',
  Performance: '#ff7043',
  Cache: '#8d6e63',
  MCP: '#26c6da',
  Plan: '#ab47bc',
  Channel: '#26a69a',
  Gateway: '#bf360c',
  Scenario: '#c050c4',
  Session: '#5c6bc0',
  Desktop: '#26c6da',
  Perception: '#ec407a',
  Monitoring: '#ef5350',
  Causal: '#ab47bc',
  IoT: '#26a69a',
  Proactive: '#9c27b0',
})

/** 主进程 ANSI 转义码 — 使用 256 色扩展调色板 */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // 256 色前景
  gray: '\x1b[38;5;242m',
  red: '\x1b[38;5;203m',
  green: '\x1b[38;5;114m',
  yellow: '\x1b[38;5;221m',
  blue: '\x1b[38;5;75m',
  magenta: '\x1b[38;5;141m',
  cyan: '\x1b[38;5;81m',
  white: '\x1b[38;5;252m',
  // 256 色背景（Badge 风格）
  bgDebug: '\x1b[48;5;240m\x1b[38;5;255m',
  bgInfo: '\x1b[48;5;31m\x1b[38;5;255m',
  bgWarn: '\x1b[48;5;172m\x1b[38;5;0m',
  bgError: '\x1b[48;5;124m\x1b[38;5;255m',
} as const

/** 等级到 ANSI 背景的映射 */
const LEVEL_ANSI_BG: Readonly<Record<LogLevel, string>> = Object.freeze({
  debug: ANSI.bgDebug,
  info: ANSI.bgInfo,
  warn: ANSI.bgWarn,
  error: ANSI.bgError,
})

/** 分类到 ANSI 前景的映射 */
const CATEGORY_ANSI_FG: Readonly<Partial<Record<LogCategory, string>>> = Object.freeze({
  Agent: ANSI.magenta,
  LLM: ANSI.blue,
  Tool: ANSI.green,
  LSP: ANSI.yellow,
  UI: ANSI.magenta,
  System: ANSI.white,
  IPC: ANSI.blue,
  Index: ANSI.cyan,
  Terminal: ANSI.cyan,
  Performance: ANSI.red,
  Plan: ANSI.magenta,
  Security: ANSI.red,
  Channel: ANSI.cyan,
  Scenario: ANSI.magenta,
  Session: ANSI.blue,
  Gateway: ANSI.yellow,
  Desktop: ANSI.cyan,
  Perception: ANSI.magenta,
  Monitoring: ANSI.red,
  Causal: ANSI.magenta,
  IoT: ANSI.cyan,
  Proactive: ANSI.magenta,
})

/* ------------------------------------------------------------------ */
/* 环形缓冲区 — O(1) 入队与淘汰                                      */
/* ------------------------------------------------------------------ */

/**
 * 固定容量的环形缓冲区
 *
 * 相比数组的 shift() 操作（O(n)），环形缓冲区通过移动头指针
 * 实现 O(1) 的元素淘汰，在高频日志场景下性能更优。
 */
class RingBuffer<T> {
  private readonly buffer: Array<T | undefined>
  private head = 0
  private tail = 0
  private _size = 0

  constructor(private readonly capacity: number) {
    this.buffer = new Array<T | undefined>(capacity)
  }

  /** 入队一个元素，缓冲区满时自动淘汰最旧元素 */
  push(item: T): void {
    this.buffer[this.tail] = item
    this.tail = (this.tail + 1) % this.capacity
    if (this._size === this.capacity) {
      this.head = (this.head + 1) % this.capacity
    } else {
      this._size++
    }
  }

  /** 按时间顺序返回所有元素 */
  toArray(): T[] {
    const result: T[] = new Array(this._size)
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head + i) % this.capacity
      result[i] = this.buffer[idx] as T
    }
    return result
  }

  /** 过滤返回符合条件的元素 */
  filter(predicate: (item: T) => boolean): T[] {
    const result: T[] = []
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head + i) % this.capacity
      const item = this.buffer[idx]
      if (item !== undefined && predicate(item)) {
        result.push(item)
      }
    }
    return result
  }

  /** 返回最后 N 个元素 */
  last(n: number): T[] {
    const count = Math.min(n, this._size)
    const result: T[] = new Array(count)
    for (let i = 0; i < count; i++) {
      const idx = (this.tail - count + i + this.capacity) % this.capacity
      result[i] = this.buffer[idx] as T
    }
    return result
  }

  /** 清空缓冲区 */
  clear(): void {
    this.buffer.fill(undefined)
    this.head = 0
    this.tail = 0
    this._size = 0
  }

  get size(): number {
    return this._size
  }
}

/* ------------------------------------------------------------------ */
/* 输出槽接口 — 策略模式                                              */
/* ------------------------------------------------------------------ */

/** 日志输出槽抽象接口 */
interface LogSink {
  /** 将一条日志写入输出目标 */
  write(entry: LogEntry): void
}

/** 控制台输出槽 — 负责终端 / 浏览器控制台着色输出 */
class ConsoleSink implements LogSink {
  constructor(
    private readonly isMainProcess: boolean,
  ) {}

  write(entry: LogEntry): void {
    const consoleFn =
      entry.level === 'error'
        ? console.error
        : entry.level === 'warn'
          ? console.warn
          : console.log

    if (this.isMainProcess) {
      consoleFn(this.formatAnsi(entry))
    } else {
      this.formatCss(entry, consoleFn)
    }
  }

  /** 主进程 ANSI 格式化 */
  private formatAnsi(entry: LogEntry): string {
    const time = entry.timestamp.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })

    const bg = LEVEL_ANSI_BG[entry.level] ?? ANSI.bgDebug
    const fg = CATEGORY_ANSI_FG[entry.category] ?? ANSI.white
    const sourceTag = `${ANSI.dim}${entry.source === 'main' ? 'M' : 'R'}${ANSI.reset}`
    const timeStr = `${ANSI.dim}${time}${ANSI.reset}`
    const levelStr = `${bg} ${entry.level.toUpperCase().padEnd(5)} ${ANSI.reset}`
    const categoryStr = `${fg}${ANSI.bold}${entry.category.toUpperCase().padEnd(10)}${ANSI.reset}`
    const durationStr =
      entry.duration !== undefined ? ` ${ANSI.yellow}(${entry.duration}ms)${ANSI.reset}` : ''
    const msgColor =
      entry.level === 'error' ? ANSI.red : entry.level === 'warn' ? ANSI.yellow : ''
    const message = `${msgColor}${entry.message}${ANSI.reset}`

    return `${timeStr} ${sourceTag} ${levelStr} ${categoryStr} ${message}${durationStr}`
  }

  /** 渲染进程 CSS 格式化 */
  private formatCss(entry: LogEntry, consoleFn: (...args: unknown[]) => void): void {
    const time = entry.timestamp.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })

    const levelHue = RENDER_LEVEL_HUE[entry.level]
    const categoryHue = RENDER_CATEGORY_HUE[entry.category] ?? '#78909c'

    const timeStyle = 'color:#78909c;font-family:monospace;font-size:10px;'
    const sourceStyle = 'color:#90a4ae;font-weight:700;font-family:monospace;font-size:10px;margin-right:4px;'
    const levelStyle = `background:${levelHue}22;color:${levelHue};border:1px solid ${levelHue}55;padding:1px 6px;border-radius:3px;font-weight:700;font-size:10px;text-transform:uppercase;margin-right:4px;`
    const categoryStyle = `color:${categoryHue};font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;`
    const messageStyle = `color:${entry.level === 'error' ? '#e53935' : entry.level === 'warn' ? '#ffb300' : 'inherit'};font-weight:${entry.level === 'info' ? '400' : '500'};margin-left:8px;`

    const durationStr = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
    const fullMessage = `${entry.message}${durationStr}`

    const prefix = `%c${time} %cR %c${entry.level.toUpperCase()} %c${entry.category.toUpperCase()} %c`

    if (entry.data !== undefined) {
      consoleFn(prefix, timeStyle, sourceStyle, levelStyle, categoryStyle, messageStyle, fullMessage, entry.data)
    } else {
      consoleFn(prefix, timeStyle, sourceStyle, levelStyle, categoryStyle, messageStyle, fullMessage)
    }
  }
}

/** 文件输出槽 — 负责将日志持久化到磁盘，支持轮转与定时批量写入 */
class FileSink implements LogSink {
  /** 单次落盘的最大条数，避免一次拼接出超大字符串 */
  private static readonly MAX_BATCH_SIZE = 500
  /** 批量落盘间隔（毫秒）—— 合并高频日志，降低系统调用次数 */
  private static readonly FLUSH_INTERVAL_MS = 120
  /** 待写入队列上限 —— 超出后丢弃低等级日志，防止内存膨胀与 IO 追不上 */
  private static readonly MAX_PENDING = 4000
  /** 队列溢出时可丢弃的日志等级（warn/error 始终保留） */
  private static readonly DROPPABLE_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['debug', 'info'])
  /** 单条日志附加数据的最大序列化长度，避免超大对象拖慢落盘 */
  private static readonly MAX_DATA_CHARS = 2000

  private pending: LogEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false
  private fsModule: typeof import('fs/promises') | null = null
  private pathModule: typeof import('path') | null = null
  /** 已确认存在的日志目录，避免每轮落盘都做目录系统调用 */
  private ensuredDir: string | null = null
  /** 当前日志文件的近似字节数，用于轮转判断（避免每轮 stat） */
  private approxBytes = 0
  /** 因队列溢出被丢弃的条数，在下一次成功落盘时写审计行 */
  private droppedCount = 0

  constructor(
    private config: { logFilePath?: string; maxFileSize: number; maxFiles: number },
  ) {}

  write(entry: LogEntry): void {
    // 背压保护：队列积压时丢弃低等级日志，优先保证主流程不被日志拖慢
    if (this.pending.length >= FileSink.MAX_PENDING && FileSink.DROPPABLE_LEVELS.has(entry.level)) {
      this.droppedCount += 1
      return
    }
    this.pending.push(entry)
    this.scheduleFlush()
  }

  /** 释放定时器（关闭文件日志时调用） */
  dispose(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pending.length = 0
  }

  /**
   * 安排一次批量落盘
   *
   * 用定时器而非微任务合并：微任务会在同一轮事件循环内立即执行，
   * 高频日志下等于每条日志都触发一次文件系统调用，并可能形成
   * 「flush → 仍有积压 → 再 flush」的微任务链，饿死其它事件（表现为进程卡死）。
   */
  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    const timer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, FileSink.FLUSH_INTERVAL_MS)
    // 定时器不阻塞进程退出（Node 环境）
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.flushTimer = timer
  }

  /** 批量落盘待写入日志（全异步 I/O，不阻塞事件循环） */
  private async flush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return
    const logPath = this.config.logFilePath
    if (!logPath) {
      this.pending.length = 0
      return
    }

    this.flushing = true
    try {
      if (!this.fsModule) {
        this.fsModule = await import('fs/promises')
        this.pathModule = await import('path')
      }
      const fs = this.fsModule
      const path = this.pathModule!

      await this.ensureDir(path.dirname(logPath), fs)

      // 轮转判断走近似字节数，只有首次落盘才做一次 stat
      if (this.approxBytes === 0) {
        this.approxBytes = await this.measureSize(logPath, fs)
      }
      if (this.approxBytes >= this.config.maxFileSize) {
        await this.rotate(logPath, fs, path)
        this.approxBytes = 0
      }

      const batch = this.pending.splice(0, FileSink.MAX_BATCH_SIZE)
      const overflowNote = this.takeOverflowNote()
      const lines = batch.map((e) => this.serialize(e))
      if (overflowNote) lines.unshift(overflowNote)
      const payload = lines.join('\n') + '\n'

      await fs.appendFile(logPath, payload, 'utf-8')
      // 用字符数近似字节数，仅用于轮转阈值判断，误差可接受
      this.approxBytes += payload.length
    } catch (err) {
      console.error('[LogEngine] 文件写入失败:', err)
    } finally {
      this.flushing = false
      // 仍有积压则安排下一轮，把事件循环让回给业务代码
      if (this.pending.length > 0) {
        this.scheduleFlush()
      }
    }
  }

  /** 确保日志目录存在（仅首次执行系统调用，后续走缓存） */
  private async ensureDir(dir: string, fs: typeof import('fs/promises')): Promise<void> {
    if (this.ensuredDir === dir) return
    try {
      // recursive 模式下目录已存在不会报错，省掉一次 existsSync
      await fs.mkdir(dir, { recursive: true })
      this.ensuredDir = dir
    } catch (err) {
      console.error('[LogEngine] 日志目录创建失败:', err)
    }
  }

  /** 读取日志文件大小（文件不存在视为 0） */
  private async measureSize(logPath: string, fs: typeof import('fs/promises')): Promise<number> {
    try {
      const stat = await fs.stat(logPath)
      return stat.size
    } catch {
      return 0
    }
  }

  /** 日志文件轮转 — 删除最旧文件并依次重命名 */
  private async rotate(
    logPath: string,
    fs: typeof import('fs/promises'),
    path: typeof import('path'),
  ): Promise<void> {
    const dir = path.dirname(logPath)
    const ext = path.extname(logPath)
    const base = path.basename(logPath, ext)

    // 删除最旧的轮转文件
    await this.removeIfExists(path.join(dir, `${base}.${this.config.maxFiles}${ext}`), fs)

    // 从旧到新依次重命名
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const src = path.join(dir, `${base}.${i}${ext}`)
      const dst = path.join(dir, `${base}.${i + 1}${ext}`)
      try {
        await fs.rename(src, dst)
      } catch {
        // 该轮转文件不存在，跳过
      }
    }

    // 当前文件重命名为 .1
    try {
      await fs.rename(logPath, path.join(dir, `${base}.1${ext}`))
    } catch {
      // 当前日志文件不存在，无需轮转
    }
  }

  /** 删除文件（不存在时静默跳过） */
  private async removeIfExists(target: string, fs: typeof import('fs/promises')): Promise<void> {
    try {
      await fs.unlink(target)
    } catch {
      // 目标文件不存在
    }
  }

  /** 生成队列溢出审计行（无丢弃时返回 null） */
  private takeOverflowNote(): string | null {
    if (this.droppedCount === 0) return null
    const count = this.droppedCount
    this.droppedCount = 0
    return `${new Date().toISOString()} [M] [System] [WARN] 日志队列溢出，已丢弃 ${count} 条低等级日志`
  }

  /** 将日志条目序列化为单行文本 */
  private serialize(entry: LogEntry): string {
    const ts = entry.timestamp.toISOString()
    const src = entry.source === 'main' ? 'M' : 'R'
    const dur = entry.duration !== undefined ? ` (${entry.duration}ms)` : ''
    let payload = ''
    if (entry.data) {
      let text: string
      try {
        text = JSON.stringify(entry.data) ?? ''
      } catch {
        text = '[unserializable data]'
      }
      if (text.length > FileSink.MAX_DATA_CHARS) {
        const omitted = text.length - FileSink.MAX_DATA_CHARS
        text = `${text.slice(0, FileSink.MAX_DATA_CHARS)}…(truncated ${omitted} chars)`
      }
      if (text) payload = ` ${text}`
    }
    return `${ts} [${src}] [${entry.category}] [${entry.level.toUpperCase()}] ${entry.message}${dur}${payload}`
  }
}


/* ------------------------------------------------------------------ */
/* 计时器记录                                                         */
/* ------------------------------------------------------------------ */

interface TimerRecord {
  category: LogCategory
  startedAt: number
  meta?: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* 生产环境探测                                                        */
/* ------------------------------------------------------------------ */

interface GlobalWithProd {
  __PROD__?: boolean
}

/** 探测当前是否运行在打包后的生产环境 */
function detectProduction(): boolean {
  // 渲染进程 — 读取 Vite 注入的 __PROD__ 标记
  if (typeof globalThis !== 'undefined') {
    const flag = (globalThis as unknown as GlobalWithProd).__PROD__
    if (flag === true) return true
  }

  // 主进程 — 读取 Electron 打包状态
  if (typeof process !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      if (app?.isPackaged === true) return true
    } catch {
      // 非 Electron 主进程
    }
  }

  // 通用 — 读取 NODE_ENV
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return true
  }

  // 后备 — 检查 .asar 打包路径
  if (typeof process !== 'undefined' && process.execPath) {
    const exec = process.execPath.toLowerCase()
    if (exec.includes('.asar')) return true
  }

  return false
}

/* ------------------------------------------------------------------ */
/* 日志引擎核心                                                       */
/* ------------------------------------------------------------------ */

/**
 * 日志引擎核心
 *
 * 通过 Proxy 动态代理分类日志器，避免手动枚举每个分类。
 * 日志条目存储在环形缓冲区中，输出通过 Sink 策略分发。
 */
class LogEngineCore {
  private config: LoggerConfig
  private readonly ring: RingBuffer<LogEntry>
  private readonly timers = new Map<string, TimerRecord>()
  private readonly consoleSink: ConsoleSink
  private fileSink: FileSink | null = null
  private prodCached: boolean | null = null

  /** 判断是否运行在主进程 */
  private readonly isMain =
    typeof process !== 'undefined' &&
    !!process.versions?.node &&
    typeof (globalThis as Record<string, unknown>).window === 'undefined'

  constructor() {
    const prod = detectProduction()
    this.prodCached = prod
    this.config = {
      minLevel: prod ? 'warn' : 'info',
      enabled: true,
      maxLogs: 1000,
      fileLogging: false,
      consoleLogging: !prod,
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
    }
    this.ring = new RingBuffer<LogEntry>(this.config.maxLogs)
    this.consoleSink = new ConsoleSink(this.isMain)
  }

  /** 读取生产环境状态（带缓存） */
  private get isProd(): boolean {
    if (this.prodCached === null) {
      this.prodCached = detectProduction()
      if (this.prodCached) {
        this.config.minLevel = 'warn'
        this.config.consoleLogging = false
      }
    }
    return this.prodCached
  }

  /* -------------------- 配置管理 -------------------- */

  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  setMinLevel(level: LogLevel): void {
    this.config.minLevel = level
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
  }

  setConsoleLogging(enabled: boolean): void {
    this.config.consoleLogging = enabled
  }

  isProductionMode(): boolean {
    return this.isProd
  }

  refreshProductionMode(): void {
    this.prodCached = null
    if (this.isProd) {
      this.config.minLevel = 'warn'
      this.config.consoleLogging = false
    }
  }

  enableFileLogging(logFilePath: string): void {
    this.config.fileLogging = true
    this.config.logFilePath = logFilePath
    // 重复启用时释放上一个输出槽，避免残留定时器与队列
    this.fileSink?.dispose()
    this.fileSink = new FileSink({
      logFilePath,
      maxFileSize: this.config.maxFileSize,
      maxFiles: this.config.maxFiles,
    })
    if (this.config.minLevel === 'debug' || this.config.minLevel === 'info') {
      this.config.minLevel = 'warn'
    }
  }

  /* -------------------- 日志查询 -------------------- */

  getLogs(): LogEntry[] {
    return this.ring.toArray()
  }

  getLogsByCategory(category: LogCategory): LogEntry[] {
    return this.ring.filter((e) => e.category === category)
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.ring.filter((e) => e.level === level)
  }

  getRecentErrors(count: number = 10): LogEntry[] {
    return this.ring.filter((e) => e.level === 'error').slice(-count)
  }

  clearLogs(): void {
    this.ring.clear()
  }

  exportLogs(): string {
    return JSON.stringify(this.ring.toArray(), null, 2)
  }

  /* -------------------- 性能计时 -------------------- */

  startTimer(
    name: string,
    category: LogCategory = 'Performance',
    metadata?: Record<string, unknown>,
  ): void {
    this.timers.set(name, {
      category,
      startedAt: performance.now(),
      meta: metadata,
    })
  }

  endTimer(name: string, additionalData?: Record<string, unknown>): number | null {
    const record = this.timers.get(name)
    if (!record) {
      this.emit('warn', 'Performance', `计时器 "${name}" 未找到`)
      return null
    }

    const elapsed = Math.round(performance.now() - record.startedAt)
    this.timers.delete(name)

    const merged = { ...record.meta, ...additionalData }
    this.emit(
      'info',
      record.category,
      `${name} 已完成`,
      Object.keys(merged).length > 0 ? merged : undefined,
      elapsed,
    )
    return elapsed
  }

  async measure<T>(
    name: string,
    fn: () => Promise<T>,
    category: LogCategory = 'Performance',
  ): Promise<T> {
    this.startTimer(name, category)
    try {
      const result = await fn()
      this.endTimer(name, { success: true })
      return result
    } catch (error) {
      this.endTimer(name, { success: false, error: String(error) })
      throw error
    }
  }

  measureSync<T>(
    name: string,
    fn: () => T,
    category: LogCategory = 'Performance',
  ): T {
    this.startTimer(name, category)
    try {
      const result = fn()
      this.endTimer(name, { success: true })
      return result
    } catch (error) {
      this.endTimer(name, { success: false, error: String(error) })
      throw error
    }
  }

  /* -------------------- 核心写入 -------------------- */

  /**
   * 内部日志发射方法 — 经过等级过滤后写入缓冲区与输出槽
   */
  private emit(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
    duration?: number,
  ): void {
    if (!this.config.enabled) return
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.config.minLevel]) return

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data,
      duration,
      source: this.isMain ? 'main' : 'renderer',
    }

    // 写入环形缓冲区
    this.ring.push(entry)

    // 分发到输出槽
    if (this.config.consoleLogging) {
      this.consoleSink.write(entry)
    }
    if (this.config.fileLogging && this.isMain && this.fileSink) {
      this.fileSink.write(entry)
    }
  }

  /* -------------------- 分类日志器 -------------------- */

  /** 创建绑定到指定分类的日志器 */
  private createCategoryLogger(category: LogCategory): CategoryLogger {
    const self = this
    return {
      debug(message: string, ...args: unknown[]) {
        self.emit('debug', category, message, args.length > 0 ? args : undefined)
      },
      info(message: string, ...args: unknown[]) {
        self.emit('info', category, message, args.length > 0 ? args : undefined)
      },
      warn(message: string, ...args: unknown[]) {
        self.emit('warn', category, message, args.length > 0 ? args : undefined)
      },
      error(message: string, ...args: unknown[]) {
        self.emit('error', category, message, args.length > 0 ? args : undefined)
      },
      time(message: string, duration: number, data?: unknown) {
        self.emit('info', category, message, data, duration)
      },
    }
  }

  /* -------------------- 分类日志器属性 -------------------- */

  get agent(): CategoryLogger {
    return this.createCategoryLogger('Agent')
  }
  get llm(): CategoryLogger {
    return this.createCategoryLogger('LLM')
  }
  get tool(): CategoryLogger {
    return this.createCategoryLogger('Tool')
  }
  get lsp(): CategoryLogger {
    return this.createCategoryLogger('LSP')
  }
  get ui(): CategoryLogger {
    return this.createCategoryLogger('UI')
  }
  get system(): CategoryLogger {
    return this.createCategoryLogger('System')
  }
  get completion(): CategoryLogger {
    return this.createCategoryLogger('Completion')
  }
  get store(): CategoryLogger {
    return this.createCategoryLogger('Store')
  }
  get file(): CategoryLogger {
    return this.createCategoryLogger('File')
  }
  get git(): CategoryLogger {
    return this.createCategoryLogger('Git')
  }
  get ipc(): CategoryLogger {
    return this.createCategoryLogger('IPC')
  }
  get index(): CategoryLogger {
    return this.createCategoryLogger('Index')
  }
  get security(): CategoryLogger {
    return this.createCategoryLogger('Security')
  }
  get settings(): CategoryLogger {
    return this.createCategoryLogger('Settings')
  }
  get terminal(): CategoryLogger {
    return this.createCategoryLogger('Terminal')
  }
  get perf(): CategoryLogger {
    return this.createCategoryLogger('Performance')
  }
  get cache(): CategoryLogger {
    return this.createCategoryLogger('Cache')
  }
  get mcp(): CategoryLogger {
    return this.createCategoryLogger('MCP')
  }
  get plan(): CategoryLogger {
    return this.createCategoryLogger('Plan')
  }
  get channel(): CategoryLogger {
    return this.createCategoryLogger('Channel')
  }
  get gateway(): CategoryLogger {
    return this.createCategoryLogger('Gateway')
  }
  get scenario(): CategoryLogger {
    return this.createCategoryLogger('Scenario')
  }
  get session(): CategoryLogger {
    return this.createCategoryLogger('Session')
  }
  get desktop(): CategoryLogger {
    return this.createCategoryLogger('Desktop')
  }
  get perception(): CategoryLogger {
    return this.createCategoryLogger('Perception')
  }
  get monitoring(): CategoryLogger {
    return this.createCategoryLogger('Monitoring')
  }
  get causal(): CategoryLogger {
    return this.createCategoryLogger('Causal')
  }
  get iot(): CategoryLogger {
    return this.createCategoryLogger('IoT')
  }
  get proactive(): CategoryLogger {
    return this.createCategoryLogger('Proactive')
  }
  get deviceLink(): CategoryLogger {
    return this.createCategoryLogger('DeviceLink')
  }

  /* -------------------- 便捷方法 -------------------- */

  logScenario(
    level: LogLevel,
    scenarioId: string,
    message: string,
    data?: unknown,
  ): void {
    this.emit(level, 'Scenario', `[${scenarioId}] ${message}`, data)
  }

  logWithCategory(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
  ): void {
    this.emit(level, category, message, data)
  }
}

/* ------------------------------------------------------------------ */
/* 单例导出                                                           */
/* ------------------------------------------------------------------ */

export const logger = new LogEngineCore()
export default logger

/* ------------------------------------------------------------------ */
/* 场景感知日志扩展                                                   */
/* ------------------------------------------------------------------ */

/** 日志场景类型 */
export type LogScenarioDomain = 'legal' | 'medical' | 'education' | 'general'

/** 场景日志策略 */
export interface ScenarioLogPolicy {
  /** 场景名称 */
  domain: LogScenarioDomain
  /** 最低日志级别（覆盖全局配置） */
  minLevel: LogLevel
  /** 是否强制启用文件日志（审计） */
  forceFileLogging: boolean
  /** 是否记录完整审计轨迹 */
  auditTrail: boolean
  /** 日志保留天数 */
  retentionDays: number
  /** 敏感数据脱敏模式 */
  sanitizeMode: 'none' | 'basic' | 'strict'
  /** 是否包含调用栈 */
  includeStackTrace: boolean
  /** 日志输出格式 */
  outputFormat: 'standard' | 'audit' | 'compliance'
}

/** 场景日志策略预设 */
const SCENARIO_LOG_POLICIES: Record<LogScenarioDomain, ScenarioLogPolicy> = {
  /** 法律场景：完整审计，严格脱敏，长期保留 */
  legal: {
    domain: 'legal',
    minLevel: 'info',
    forceFileLogging: true,
    auditTrail: true,
    retentionDays: 365 * 7, // 7年保留（法律合规）
    sanitizeMode: 'strict',
    includeStackTrace: true,
    outputFormat: 'compliance',
  },

  /** 医疗场景：HIPAA 合规，严格脱敏 */
  medical: {
    domain: 'medical',
    minLevel: 'info',
    forceFileLogging: true,
    auditTrail: true,
    retentionDays: 365 * 6, // 6年保留（HIPAA）
    sanitizeMode: 'strict',
    includeStackTrace: true,
    outputFormat: 'audit',
  },

  /** 教育场景：标准日志，基本脱敏 */
  education: {
    domain: 'education',
    minLevel: 'info',
    forceFileLogging: false,
    auditTrail: false,
    retentionDays: 90,
    sanitizeMode: 'basic',
    includeStackTrace: false,
    outputFormat: 'standard',
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    minLevel: 'debug',
    forceFileLogging: false,
    auditTrail: false,
    retentionDays: 30,
    sanitizeMode: 'none',
    includeStackTrace: false,
    outputFormat: 'standard',
  },
}

/** 敏感数据脱敏模式 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[EMAIL]' },
  { pattern: /\b\d{16,19}\b/g, replacement: '[CARD]' },
  { pattern: /\b\d{3}\s?\d{3}\s?\d{4}\b/g, replacement: '[PHONE]' },
  { pattern: /password\s*[:=]\s*\S+/gi, replacement: 'password=[REDACTED]' },
  { pattern: /token\s*[:=]\s*\S+/gi, replacement: 'token=[REDACTED]' },
  { pattern: /api[_-]?key\s*[:=]\s*\S+/gi, replacement: 'api_key=[REDACTED]' },
]

/**
 * 场景感知日志引擎
 *
 * 在标准 LogEngine 基础上，增加场景策略：
 * - 场景感知的日志级别
 * - 敏感数据脱敏
 * - 审计日志强制启用
 * - 合规输出格式
 */
export class ScenarioLogEngine {
  private policy: ScenarioLogPolicy
  private readonly engine: LogEngineCore

  constructor(
    domain: LogScenarioDomain = 'general',
    engine: LogEngineCore = logger,
  ) {
    this.policy = SCENARIO_LOG_POLICIES[domain]
    this.engine = engine

    // 应用场景策略
    this.applyPolicy()
  }

  /**
   * 应用场景策略到日志引擎
   */
  private applyPolicy(): void {
    this.engine.setMinLevel(this.policy.minLevel)

    if (this.policy.forceFileLogging && this.engine.isProductionMode()) {
      const logPath = this.getDefaultLogPath()
      this.engine.enableFileLogging(logPath)
    }
  }

  /**
   * 获取默认日志路径
   */
  private getDefaultLogPath(): string {
    const domain = this.policy.domain
    const date = new Date().toISOString().slice(0, 10)
    return `logs/${domain}-${date}.log`
  }

  /**
   * 切换场景策略
   */
  switchScenario(domain: LogScenarioDomain): void {
    this.policy = SCENARIO_LOG_POLICIES[domain]
    this.applyPolicy()
  }

  /**
   * 获取当前策略
   */
  getPolicy(): ScenarioLogPolicy {
    return this.policy
  }

  /**
   * 脱敏处理
   */
  private sanitize(data: unknown): unknown {
    if (this.policy.sanitizeMode === 'none' || data === undefined) {
      return data
    }

    if (typeof data === 'string') {
      return this.sanitizeString(data)
    }

    if (typeof data === 'object' && data !== null) {
      try {
        const json = JSON.stringify(data)
        const sanitized = this.sanitizeString(json)
        return JSON.parse(sanitized)
      } catch {
        return data
      }
    }

    return data
  }

  /**
   * 字符串脱敏
   */
  private sanitizeString(text: string): string {
    let result = text
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, replacement)
    }
    return result
  }

  /**
   * 格式化审计日志消息
   */
  private formatAuditMessage(
    level: LogLevel,
    category: LogCategory,
    message: string,
  ): string {
    if (this.policy.outputFormat === 'standard') {
      return message
    }

    const timestamp = new Date().toISOString()
    const user = typeof process !== 'undefined' ? process.env?.USER ?? 'unknown' : 'unknown'
    const format = this.policy.outputFormat === 'compliance' ? 'COMPLIANCE' : 'AUDIT'

    return `[${format}] [${timestamp}] [user=${user}] [${category}] [${level}] ${message}`
  }

  /**
   * 场景感知日志写入
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
  ): void {
    const formattedMessage = this.formatAuditMessage(level, category, message)
    const sanitizedData = this.sanitize(data)
    this.engine.logWithCategory(level, category, formattedMessage, sanitizedData)
  }

  /**
   * 审计日志（仅法律/医疗场景）
   */
  audit(action: string, resource: string, details?: unknown): void {
    if (!this.policy.auditTrail) {
      return
    }

    const message = `AUDIT: action=${action} resource=${resource}`
    this.log('info', 'Security', message, details)
  }

  /**
   * 便捷方法：info
   */
  info(category: LogCategory, message: string, data?: unknown): void {
    this.log('info', category, message, data)
  }

  /**
   * 便捷方法：warn
   */
  warn(category: LogCategory, message: string, data?: unknown): void {
    this.log('warn', category, message, data)
  }

  /**
   * 便捷方法：error
   */
  error(category: LogCategory, message: string, data?: unknown): void {
    this.log('error', category, message, data)
    if (this.policy.includeStackTrace && data instanceof Error) {
      this.log('error', category, `Stack: ${data.stack}`)
    }
  }

  /**
   * 便捷方法：debug
   */
  debug(category: LogCategory, message: string, data?: unknown): void {
    this.log('debug', category, message, data)
  }
}

/**
 * 获取场景日志策略
 */
export function getScenarioLogPolicy(
  domain: LogScenarioDomain,
): ScenarioLogPolicy {
  return SCENARIO_LOG_POLICIES[domain]
}

/**
 * 创建场景日志引擎实例
 */
export function createScenarioLogger(
  domain: LogScenarioDomain = 'general',
): ScenarioLogEngine {
  return new ScenarioLogEngine(domain)
}
