/**
 * 性能追踪契约（主进程 ↔ preload ↔ 渲染层共用）
 *
 * 目的：把「CPU 飙到 90%+」这一条总曲线，还原成可归因的时间轴。
 *
 * 做法：主进程按秒采各进程占用与事件循环延迟，渲染进程按秒采自身堆占用、
 * 长任务与关键链路计数，两侧写入**同一个** JSONL 文件。时间戳同源，因此
 * 事后逐行读出来就能对齐「AI 开始思考的那一刻，到底是哪个进程在烧」。
 *
 * 本文件被主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/perfTraceProtocol
 */

/** IPC 频道名 */
export const PERF_TRACE_CHANNELS = {
  /** 开始追踪，入参 { dir?: string; intervalMs?: number } */
  start: 'perf-trace:start',
  /** 停止追踪并落盘收尾 */
  stop: 'perf-trace:stop',
  /** 查询运行状态 */
  status: 'perf-trace:status',
  /**
   * 渲染进程上报单条记录。
   *
   * 刻意走单向 `send` 而非 `invoke`：上报发生在被测链路的同步路径上，
   * 若等待主进程回执，测量本身就会成为延迟来源，污染被测对象。
   */
  report: 'perf-trace:report',
  /**
   * 广播渲染层跟随主进程开启 / 停止上报（主 → 渲染，单向）。
   *
   * 渲染侧的上报开关默认是关的，只有主动调用 start 的窗口才会写数据。多窗口
   * 场景下这意味着桌面伴侣、悬浮头像、预览窗口全部落在观测之外——出问题时
   * 连一份数据都没有。主进程开始采样时向所有 webContents 广播这两个频道，
   * 渲染层收到就跟着切换，不必指望每个窗口入口都记得装上上报器。
   */
  autoStart: 'perf-trace:auto-start',
  autoStop: 'perf-trace:auto-stop',
} as const

/** 默认采样间隔（毫秒） */
export const PERF_TRACE_DEFAULT_INTERVAL_MS = 1000

/**
 * 每个采样窗口内允许写入的最大锚点条数。
 *
 * 渲染进程已对高频锚点做了收敛，但主进程必须自己兜底：一旦渲染层出现
 * 异常高频上报（例如某个 effect 循环里反复上报），诊断代码本身就会变成
 * 性能问题的来源。超出上限的条目直接丢弃并计入 dropped。
 */
export const PERF_TRACE_MAX_ANCHORS_PER_WINDOW = 200

/** 每个采样窗口内允许写入的最大渲染层采样条数 */
export const PERF_TRACE_MAX_RENDERER_PER_WINDOW = 20

/** 单个进程的占用采样（源自 `app.getAppMetrics()`） */
export interface PerfTraceProcessSample {
  pid: number
  /**
   * 进程类型。
   *
   * - Browser / Tab / GPU / Utility / Zygote：来自 `app.getAppMetrics()`
   * - `Tool`：应用自己拉起的非 Electron 子进程（工具命令、网关 sidecar 等），
   *   由主进程遍历进程树单独采集
   *
   * 两类必须分开：`getAppMetrics()` 只覆盖 Electron 自己的进程，工具命令拉起的
   * node / tsc / vite 全部不在其中。而这恰恰是「AI 执行命令时 CPU 飙高」最可能
   * 的归属，只看前者会把整机占用误判成应用自身开销。
   */
  type: string
  /**
   * Utility 进程的服务名（如 node.mojom.NodeService）。
   *
   * 这是区分子进程用途的唯一线索：终端 PTY、语言服务、本地语音、MCP
   * 桥接都落在 Utility 里，只看 type 会把它们混成一堆，无法归因。
   */
  service?: string
  /** 命令行（仅 `Tool` 类型填写）：工具子进程只有名字无法区分是哪条命令 */
  cmd?: string
  /** CPU 占用百分比（换算为「单核满载 = 100」，多核机器上可超过 100） */
  cpu: number
  /**
   * 每秒空闲唤醒次数。
   *
   * 偏高而 CPU 不高，通常意味着存在高频定时器在空转；偏高且 CPU 高，
   * 则说明唤醒后确实在干活。两种情况的修法不同，因此单独记一列。
   *
   * `Tool` 类型恒为 0：操作系统不按进程暴露唤醒次数，缺省值表示「未采集」，
   * 不要据此判断工具进程没有唤醒。
   */
  wakeups: number
  /** 常驻内存（MB） */
  wsMB: number
  /** 峰值内存（MB） */
  peakMB: number
}

/** 主进程每秒采样 */
export interface PerfTraceTickRecord {
  type: 'tick'
  /** 采样时刻（epoch 毫秒） */
  t: number
  /** 采样序号，从 1 开始递增，用于识别丢帧 */
  seq: number
  /**
   * 系统整体 CPU 占用（%）。
   *
   * 来自 os.cpus() 时间差分，且**归一化到全部核心**：12 核机器上取 100
   * 表示 12 个核全部满载。它与 appCpu / appCpuSharePct 的口径不同，
   * 两者不能直接相减。
   */
  sysCpu: number
  /**
   * 本应用 Electron 进程 CPU 之和（%），**不含**工具子进程。
   *
   * 归一化到**单核**：100 表示占满一个核心，多核机器上可超过 100。与 sysCpu
   * 口径不同，差值没有意义 —— 需要「应用占整机多少」时用 appCpuSharePct。
   * 工具命令拉起的子进程另计在 toolCpu：那部分占用由用户或 Agent 选择的命令
   * 决定，不是应用自身的开销，混在一起会得出「应用很吃 CPU」的错误结论。
   */
  appCpu: number
  /**
   * 工具子进程 CPU 之和（%），口径同上（单核归一化）。
   *
   * 覆盖应用拉起的非 Electron 子进程：工具命令（tsc / vite / node / rg）、
   * 网关 sidecar 等。这些进程不在 `app.getAppMetrics()` 的视野内，而它们往往
   * 正是整机占用的真正大头。为 0 有两种含义：确实没有工具在跑，或本轮尚未
   * 取到进程表（采样是异步的，见 PerfTraceService）。
   */
  toolCpu?: number
  /**
   * Electron 进程占整机 CPU 的百分比（%）。
   *
   * 与 sysCpu 同口径（100 = 全机满载），即 appCpu / 逻辑核心数。这是回答
   * 「用户看到的 CPU 飙高到底是不是这个应用造成的」的直接读数：应用外占用
   * 就是 sysCpu - appCpuSharePct（含 toolCpu 对应的那部分）。
   */
  appCpuSharePct: number
  /** 系统负载（1 / 5 / 15 分钟） */
  loadavg: [number, number, number]
  /** 逻辑核心数，用于判断 CPU 百分比是否已经顶满 */
  cpuCount: number
  /** 主进程事件循环延迟统计（毫秒） */
  loop: { mean: number; max: number; p99: number }
  /**
   * 采样动作自身的耗时分解（毫秒）。
   *
   * 采样每秒同步跑一次，其中 getAppMetrics 要向所有子进程收取指标，本身就是
   * 一次跨进程同步操作。不把这部分单独记账，就无法分辨 loop 的尖峰是「被测
   * 应用卡了」还是「诊断工具在量」——后者会把采样器的开销原样写进被测量的
   * 指标里，形成自我观测。build 是三项之和（不含写盘）。
   */
  self?: {
    /** 到记录构造完成为止的总耗时 */
    build: number
    /** 读取系统 CPU（遍历全部核心） */
    sysCpu: number
    /** 读取事件循环延迟直方图 */
    loop: number
    /** 读取各进程占用 */
    procs: number
    /** 上一次写入 JSONL 的耗时：本次写入的耗时无法计入本次记录 */
    write: number
  }
  /**
   * 各进程占用，按 cpu 降序。
   *
   * 包含两类：Electron 自己的进程（Browser / Tab / GPU / Utility）与
   * 应用拉起的 `Tool` 子进程。后者是补齐归因用的 —— 单看 Electron 进程，
   * 「执行命令时 CPU 高」永远找不到归属。
   */
  procs: PerfTraceProcessSample[]
}

/**
 * 上报方身份，由主进程在收到上报时填充。
 *
 * 渲染层自己拿不到稳定的进程标识（主世界没有 process），而主进程侧
 * `event.sender` 上两样都有，因此身份不从渲染层传，直接由主进程补。
 * 有了它，渲染记录才能和 tick 里的进程清单按 pid 对齐；否则多开窗口时
 * 几条 `index.html` 混在一起，只能靠内存走势猜哪个进程是哪个窗口。
 */
export interface PerfTraceReporterIdentity {
  /** 渲染进程的操作系统进程号 */
  pid?: number
  /** Electron 的 webContents id */
  wid?: number
}

/** 锚点名称 */
export type PerfTraceAnchorName =
  /** AI 运行阶段变化：空闲 / 流式输出 / 待工具 / 工具执行中 / 出错 */
  | 'stream-phase'
  /** 等待模型的细分阶段：连接 / 建上下文 / 压缩 / 等模型 */
  | 'wait-phase'
  /** 工具批次开始与结束 */
  | 'tool-batch'
  /** 单个工具开始与结束 */
  | 'tool-call'
  /** 终端命令开始与结束 */
  | 'terminal-command'
  /** 追踪会话自身起止 */
  | 'session'

/** 事件锚点：把代码里的关键时刻钉到时间轴上 */
export interface PerfTraceAnchorRecord extends PerfTraceReporterIdentity {
  type: 'anchor'
  t: number
  name: PerfTraceAnchorName
  edge: 'begin' | 'end'
  /** 附加信息（阶段名、工具名、命令摘要等），字段因锚点而异 */
  detail?: Record<string, unknown>
}

/** 渲染进程每秒采样 */
export interface PerfTraceRendererRecord extends PerfTraceReporterIdentity {
  type: 'renderer'
  t: number
  /**
   * JS 堆占用（MB），来源不可靠时整块省略。
   *
   * 只有 `performance.memory` 这一个来源（标准 Web API 没有等价物），而
   * Chromium 出于侧信道防护对它是做了精度限制的：实测连续三百多个窗口读数
   * 恒为同一个值，与主进程侧观测到的数百 MB 工作集完全脱节。上报器会在
   * 连续多次读数相同时判定该来源不可用并停止上报——判断内存走势请用 tick
   * 里进程级的 wsMB，那是准确的。
   */
  mem?: { usedMB: number; totalMB: number; limitMB: number }
  /**
   * 自上次上报以来的计数器增量，键名见 PERF_TRACE_COUNTERS。
   *
   * 关注的不是绝对值而是比值：写入次数与真正产生新状态的次数之比，
   * 直接反映有多少次状态更新是白跑的。
   */
  counters: Record<string, number>
  /** 自上次上报以来的长任务（>50ms）统计 */
  longTasks: {
    count: number
    totalMs: number
    maxMs: number
    /**
     * 长任务按来源容器聚合，按耗时降序取前若干项。
     *
     * 只统计总量无法区分「主文档卡」和「某个子框架卡」：同一个渲染进程里
     * 编辑区、预览区、终端回显都可能挂在 iframe 上，它们的执行都记在同一个
     * 主线程账上。容器名缺失时退化为主文档自身，因此这一项永远非空。
     * 除次数与总量外同时给出单次峰值：峰值与总量背离时，问题是一次性的重算，
     * 而非持续的小额开销，两者的处理方式完全不同。
     */
    byContainer?: PerfTraceLongTaskAttribution[]
  }
  /**
   * 长动画帧（LoAF）统计。
   *
   * longtask 只回答「主线程被占用了多久」，不回答「被谁占用」，LoAF 的取向
   * 是补齐这份归因：帧内跑过哪些脚本、各自的来源与函数名，以及其中多少耗时
   * 来自强制同步样式/布局。
   *
   * 需要注意归因字段并非所有环境都提供。实测里 505 帧中有 502 帧的 scripts
   * 为空、没有一帧带 renderStart，此时 byScript 为空与分段缺失都是**环境
   * 能力缺失**，不能读成「这些帧里没有脚本执行」或「渲染不耗时」。
   */
  loaf?: PerfTraceLongAnimationFrameBlock
  /**
   * 上报窗口标识（入口文件名 + window.name）。
   *
   * 应用存在多个渲染窗口（主窗口、桌面伴侣、悬浮窗），它们的记录混在同一个
   * 文件里。不记身份就无法判断某段长任务属于哪个窗口，也就无从定位。
   */
  window?: string
}

/** 长任务在来源容器上的聚合项 */
export interface PerfTraceLongTaskAttribution {
  /** 容器描述：主文档自身，或「iframe:名称」形式 */
  name: string
  count: number
  totalMs: number
  /** 该容器内单次最长任务的耗时 */
  maxMs: number
}

/** 长动画帧内单个脚本的聚合项 */
export interface PerfTraceLoafScriptAttribution {
  /** 脚本来源描述：「函数名 @ 文件名」，信息缺失时退化为文件名或调用者类型 */
  name: string
  /** 出现次数 */
  count: number
  totalMs: number
  maxMs: number
  /** 其中由强制同步样式/布局（读写交替触发的重排）造成的耗时 */
  forcedStyleAndLayoutMs: number
}

/** 长动画帧（LoAF）聚合块 */
export interface PerfTraceLongAnimationFrameBlock {
  /** 长动画帧数量（帧时长超过阈值的帧） */
  frames: number
  /** 累计阻塞时长：超过阈值、真正让用户感到迟滞的那一部分 */
  blockingMs: number
  maxBlockingMs: number
  /**
   * 累计「帧开始 → 渲染开始」的耗时。
   *
   * 这段是渲染管线接手之前、主线程被任务占住的时间，脚本执行、事件处理、
   * 微任务清空都发生在这里。byScript 为空但本项很高时，说明时间被切碎在
   * 大量短任务里（单个任务都不足以触发 longtask），问题在任务数量而非单次时长。
   */
  taskMs?: number
  /**
   * 累计「渲染开始 → 帧呈现」的耗时。
   *
   * 这段是样式计算、布局、绘制与合成。它解释了另一类现象：脚本耗时不高
   * （taskMs 小、byScript 空）却依然结成长帧，说明瓶颈在 DOM 变更量或样式
   * 计算复杂度，改 JS 无效，要削减每次变更影响的节点规模。
   */
  renderMs?: number
  /** 单帧「渲染开始 → 呈现」的最长耗时，用于识别偶发的重排尖峰 */
  maxRenderMs?: number
  /** 累计强制同步样式/布局耗时 */
  forcedStyleAndLayoutMs: number
  /** 按脚本来源聚合，按累计耗时降序取前若干项 */
  byScript: PerfTraceLoafScriptAttribution[]
}

/** 会话元信息，写在文件首尾便于事后确认采样条件 */
export interface PerfTraceMetaRecord {
  type: 'meta'
  t: number
  event: 'start' | 'stop'
  platform: string
  arch: string
  cpuCount: number
  appVersion: string
  /** 采样间隔（毫秒） */
  intervalMs: number
  /** 本次会话启动后累计丢弃的记录数 */
  dropped?: number
}

/** JSONL 中的一行 */
export type PerfTraceRecord =
  | PerfTraceTickRecord
  | PerfTraceAnchorRecord
  | PerfTraceRendererRecord
  | PerfTraceMetaRecord

/**
 * 渲染层计数器键名。
 *
 * 成对设计（调用 / 短路 / 提交）是这套埋点的核心：只有三者放在一起看，
 * 才能判断「流式期间的写入洪峰」到底是必要的状态推进，还是大量无差异写入
 * 在反复唤醒订阅者。
 */
export const PERF_TRACE_COUNTERS = {
  /** setStreamState 被调用次数（流式期间每个分片都会走这里） */
  streamStateCalls: 'streamState.calls',
  /** 其中因键值未变而被短路的次数 */
  streamStateSkipped: 'streamState.skipped',
  /** 其中真正产生新 state 的次数 */
  streamStateCommits: 'streamState.commits',
  /** 工具调用执行次数 */
  toolCalls: 'tool.calls',
  /** 终端输出分片处理次数 */
  terminalChunks: 'terminal.chunks',
  /**
   * 文本清洗调用次数与累计耗时（毫秒）。
   *
   * 耗时走计数器而不是锚点：清洗每个内容分片都要跑一次，用锚点会在时间轴上
   * 刷出上百条记录，把真正需要对齐的阶段区间挤掉。计数器只留聚合值，
   * 既能看「每帧多少毫秒」，也能看「一秒钟跑了几次」。
   */
  cleanCalls: 'markdown.cleanCalls',
  cleanMs: 'markdown.cleanMs',
  /** 其中命中增量缓存、未重新处理的行数 */
  cleanReusedLines: 'markdown.cleanReusedLines',
  /** 因处于围栏代码块内而跳过的行数（不做链接化与表情替换） */
  cleanFenceSkipped: 'markdown.fenceSkipped',
  /** 分块调用次数与累计耗时（毫秒） */
  splitCalls: 'markdown.splitCalls',
  splitMs: 'markdown.splitMs',
  /** 分块器复用的已提交块数量 */
  splitReusedBlocks: 'markdown.splitReusedBlocks',
  /** Markdown 解析次数：记忆化命中时不计数，因此等于真正重新解析的块数 */
  blockParses: 'markdown.blockParses',
  /**
   * Markdown 块累积字符数。
   *
   * 解析成本几乎与块体积成正比（实测约 1.3 微秒/字符），而块体积是流式渲染里
   * 唯一可调的变量，因此比「耗时」更值得记录：累加字符数既能推算解析耗时，
   * 也能看出块是否在无边界地增长 —— 后者才是真正需要处理的形态。
   *
   * 这里不直接计时：解析发生在 ReactMarkdown 自己的 render 里，
   * 外层组件拿到的时间戳量不到它，测出来会严重偏低。
   */
  blockChars: 'markdown.blockChars',
  /**
   * 行级 diff 累计耗时与次数。
   *
   * diff 是超线性计算（实测 5 万字符对 5 万字符超过 1 秒），而它此前发生在
   * 渲染提交路径上，因此需要单独计量：只要这一项不为零且量级可观，
   * 卡顿就一定与文件改动卡片有关，不必再去猜解析或高亮。
   */
  diffLinesMs: 'diff.linesMs',
  diffLinesCalls: 'diff.linesCalls',
  /** 因超出单边尺寸上限而未做精确 diff 的次数 */
  diffSkippedTooLarge: 'diff.skippedTooLarge',
  /** 行级 diff 命中缓存、未重复计算的次数（同一份改动只应真正计算一次） */
  diffCacheHits: 'diff.cacheHits',
  /**
   * 代码高亮累计耗时与次数（毫秒）。
   *
   * 高亮已从渲染提交路径挪到空闲时段，因此这里计量的是「总工作量」，
   * 而不是「单次阻塞」：总量高但长任务少，正是预期结果。
   */
  highlightMs: 'highlight.ms',
  highlightCalls: 'highlight.calls',
  /** 流式插值推进帧数（每帧都会重渲染一次尾部块） */
  smoothTicks: 'stream.ticks',
  /** 落在未闭合围栏内、走纯文本渲染而未做 Markdown 解析的尾块帧数 */
  fenceTailRenders: 'stream.fenceTailRenders',

  /* ------------------------------------------------------------------ */
  /* React 提交探针（<Profiler>）                                        */
  /* ------------------------------------------------------------------ */

  /**
   * 提交次数、累计提交耗时与累计基线耗时（毫秒）。
   *
   * 前面的计数器只回答「写入了几次、短路了几次」，回答不了「这次提交花了多久」。
   * 两者缺一不可：若累计提交耗时远小于同期的长任务总量，剩余时间就不在 React
   * 的提交阶段里（更可能在任务队列与 GC 上），继续削减提交次数的收益有限。
   *
   * baseMs 是同一子树「不做记忆化」所需耗时的估计值，它明显高于 commitMs 时，
   * 说明记忆化正在生效；两者接近则说明 memo 形同虚设。
   */
  reactCommits: 'react.commits',
  reactCommitMs: 'react.commitMs',
  reactBaseMs: 'react.baseMs',
  /** 消息列表整棵子树（Virtuoso 及其条目）的累计提交耗时 */
  reactMessagesCommitMs: 'react.messagesCommitMs',
  /** 单条助手消息内容子树的累计提交耗时 */
  reactAssistantCommitMs: 'react.assistantCommitMs',

  /**
   * 工具组与工具卡片的重渲染次数。
   *
   * 成对记录是为了回答一个具体问题：流式期间文本分片不断改写消息 parts，
   * 而工具卡片的数据（tc）本身没有变化 —— 那么「每次提交到底重渲染了几张
   * 卡片」就是判断优化方向的直接依据。卡片数与 renders 的比值接近 1 说明
   * 元素身份已经稳定；若每次提交都等于卡片总数，说明是 props 身份不稳定。
   *
   * 注意：开发构建下 StrictMode 会双调用渲染函数，读数约为生产构建的两倍。
   */
  toolGroupRenders: 'toolGroup.renders',
  toolCardRenders: 'toolCard.renders',

  /**
   * 帧调度器的实际运行帧数与执行的任务数。
   *
   * 两者比值反映合帧效果：流式期间缓冲刷写与插值推进若各自独立定时，
   * 这个比值会趋近 1（每帧只跑一个任务，等于没合）；合到同一帧后应稳定 > 1。
   */
  frameRuns: 'frame.runs',
  frameTasks: 'frame.tasks',
  /**
   * 帧任务自身耗时与帧内提交窗口耗时（毫秒）。
   *
   * 这两个值存在的唯一理由是「把长任务拆开」：longTasks 只回答「主线程被占了
   * 多久」，回答不了「占在哪一环」。同一窗口下三者对比即可定性：
   *
   *   commitMs ≈ taskMs ≈ longTasks  → 开销在我们自己的 JS 上，削任务/削重渲染有效；
   *   commitMs 远小于 longTasks      → 剩下的是浏览器的样式计算、布局、绘制，
   *                                    继续减少 React 提交次数不会改善占用，
   *                                    该去改 DOM 规模与 CSS 而不是改调度；
   *   commitMs 远大于 taskMs         → 时间花在 React 的渲染与提交阶段，
   *                                    要看提交探针定位到哪棵子树。
   *
   * taskMs 只统计帧回调里我们自己的任务代码；commitMs 从帧回调开始一直算到
   * 该任务结束（含紧随其后的微任务排空），因此能覆盖 React 同步提交。
   */
  frameTaskMs: 'frame.taskMs',
  frameCommitMs: 'frame.commitMs',
} as const

/** 渲染层上报体的联合类型（与 report 频道载荷一致） */
export type PerfTraceReportPayload = PerfTraceAnchorRecord | PerfTraceRendererRecord

/** 追踪运行状态 */
export interface PerfTraceStatus {
  running: boolean
  /** 当前写入的 JSONL 绝对路径，未运行时为 null */
  filePath: string | null
  startedAt: number | null
  /**
   * 当前采样间隔（毫秒）。
   *
   * 跟随主进程开启上报的窗口要按同一节奏采集，否则同一份文件里两侧的记录
   * 密度不一致，按时间对齐时会误判成「某个窗口上报少了」。
   */
  intervalMs: number
  /** 本次会话已写入的记录条数 */
  recordCount: number
  /** 因窗口限流被丢弃的记录条数 */
  droppedCount: number
  /** 最近一次写入失败原因（无则空串） */
  lastError: string
}

/** 开始追踪的入参 */
export interface PerfTraceStartOptions {
  /**
   * JSONL 落盘目录。
   *
   * 省略时由调用方语境决定：IPC 侧默认写入工作区下的 tmp-diag，
   * 无工作区则退回应用数据目录。
   */
  dir?: string
  /** 采样间隔（毫秒），省略取默认值 */
  intervalMs?: number
}

/** 通用 IPC 响应包装 */
export interface PerfTraceIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
