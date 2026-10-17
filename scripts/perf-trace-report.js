#!/usr/bin/env node
/**
 * 性能追踪报告器
 *
 * 读取 PerfTraceService 落盘的 JSONL（cpu-<stamp>.jsonl），把逐行记录汇总成
 * 一份可直接判读的报告：CPU 归因、主进程事件循环、渲染层计数器、长任务与
 * 长动画帧，并按计数器之间的比值给出结论。
 *
 * 单个计数器没有意义，判读一律基于成对 / 三元组比值：
 *   - streamState.skipped / calls       写入洪峰里有多少是白跑的
 *   - react.baseMs / react.commitMs     记忆化是否在生效
 *   - frame.tasks / frame.runs          帧调度器是否真的合了帧
 *   - commitMs 与 longTasks 的对比      开销在 JS 还是在样式布局绘制
 * 这几组比值也是埋点设计时刻意留出的判据，报告把它们直接算出来，
 * 避免每次排查都要人工对着原始数字推。
 *
 * 使用方式：
 *   node scripts/perf-trace-report.js                 取最新的一份
 *   node scripts/perf-trace-report.js <file.jsonl>    指定文件
 *   node scripts/perf-trace-report.js <dir>           取该目录下最新的一份
 *   node scripts/perf-trace-report.js --timeline      附带逐秒时间线
 *   node scripts/perf-trace-report.js --json          输出机器可读汇总
 *   node scripts/perf-trace-report.js --top=15        调整排行条数
 *
 * @module scripts/perf-trace-report
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2)

function readFlag(name) {
  return argv.includes(`--${name}`)
}

function readNumberFlag(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const value = Number.parseInt(hit.slice(name.length + 3), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const FLAGS = {
  timeline: readFlag('timeline'),
  json: readFlag('json'),
  top: readNumberFlag('top', 12),
}

/** 位置参数：文件或目录 */
const positional = argv.filter((a) => !a.startsWith('--'))

/* ------------------------------------------------------------------ */
/* 输入定位                                                            */
/* ------------------------------------------------------------------ */

/**
 * 候选落盘目录。
 *
 * 采集端有两处默认落点：窗口绑定了工作空间时写进工作空间的 tmp-diag，
 * 否则退回应用数据目录。这里把两处都列出来，任一处命中即可。
 */
function candidateDirs() {
  const dirs = []

  // 脚本位于 <client>/scripts，工作空间通常是 client 的上一级
  const clientRoot = path.resolve(__dirname, '..')
  dirs.push(path.join(clientRoot, 'tmp-diag'))
  dirs.push(path.resolve(clientRoot, '..', 'tmp-diag'))

  const appData =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA || ''
        : path.join(os.homedir(), '.config')

  if (appData && fs.existsSync(appData)) {
    for (const entry of fs.readdirSync(appData)) {
      const dir = path.join(appData, entry, 'perf-trace')
      if (fs.existsSync(dir)) dirs.push(dir)
    }
  }

  return dirs.filter((d) => fs.existsSync(d))
}

/** 目录下按文件名倒序取第一个 cpu-*.jsonl（文件名带时间戳，可排序） */
function latestIn(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('cpu-') && f.endsWith('.jsonl'))
    .sort()
  if (files.length === 0) return null
  return path.join(dir, files[files.length - 1])
}

/**
 * 跨候选目录取全局最新的一份。
 *
 * 不能「遇到第一个非空目录就返回」：tmp-diag 里通常堆着历次历史文件，
 * 而新一次采集可能落在应用数据目录。只看第一个命中的目录，会安静地拿到
 * 几天前的旧数据并据此下结论 —— 这比「找不到文件」更危险，因为报告看起来
 * 完全正常，只是分析的根本不是刚跑的这一次。
 *
 * 按文件名比较而非 mtime：文件名是 cpu-YYYYMMDD-HHMMSS，天然按采集时间排序，
 * 且不受文件被复制 / 同步后 mtime 变化的影响。
 */
function newestAcross(dirs) {
  let best = null
  for (const dir of dirs) {
    const file = latestIn(dir)
    if (!file) continue
    if (!best || path.basename(file) > path.basename(best)) best = file
  }
  return best
}

function resolveInput() {
  const arg = positional[0]
  if (arg) {
    const target = path.resolve(arg)
    if (!fs.existsSync(target)) {
      fail(`路径不存在：${target}`)
    }
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      const found = latestIn(target)
      if (!found) fail(`目录下没有 cpu-*.jsonl：${target}`)
      return found
    }
    return target
  }

  // 无参数：先看当前目录，再跨所有候选目录取全局最新
  const cwdHit = latestIn(process.cwd())
  if (cwdHit) return cwdHit

  const found = newestAcross(candidateDirs())
  if (found) return found

  fail(
    [
      '没有找到 cpu-*.jsonl。',
      '先开启采集，再跑一次要分析的任务：',
      '  主窗口 DevTools 控制台执行  __perfTrace.start()',
      '  任务结束后执行            __perfTrace.stop()',
      '或用 <file.jsonl> / <dir> 显式指定文件位置。',
    ].join('\n  '),
  )
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* 读取与解析                                                          */
/* ------------------------------------------------------------------ */

function readRecords(file) {
  const raw = fs.readFileSync(file, 'utf-8')
  const records = []
  let bad = 0

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') records.push(parsed)
      else bad++
    } catch {
      // 进程被强杀时最后一行可能是半条记录，跳过即可
      bad++
    }
  }

  return { records, bad }
}

/* ------------------------------------------------------------------ */
/* 聚合                                                                */
/* ------------------------------------------------------------------ */

function mean(values) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function summarize(records) {
  const stats = {
    metas: [],
    ticks: [],
    anchors: [],
    renderers: [],
    windows: new Map(),
    counters: new Map(),
    procs: new Map(),
    longTasks: { count: 0, totalMs: 0, maxMs: 0, byContainer: new Map() },
    loaf: {
      frames: 0,
      blockingMs: 0,
      maxBlockingMs: 0,
      taskMs: 0,
      renderMs: 0,
      maxRenderMs: 0,
      forcedStyleAndLayoutMs: 0,
      byScript: new Map(),
    },
  }

  for (const record of records) {
    switch (record.type) {
      case 'meta':
        stats.metas.push(record)
        break
      case 'tick':
        stats.ticks.push(record)
        break
      case 'anchor':
        stats.anchors.push(record)
        break
      case 'renderer':
        stats.renderers.push(record)
        accumulateRenderer(stats, record)
        break
      default:
        break
    }
  }

  accumulateProcs(stats)
  return stats
}

/** 渲染层计数器与长任务按窗口累加 */
function accumulateRenderer(stats, record) {
  // 身份缺失时归入一个占位分组，避免记录被静默丢弃
  const key = record.window || `pid:${record.pid ?? '?'}`

  let win = stats.windows.get(key)
  if (!win) {
    win = { samples: 0, pid: record.pid, wid: record.wid }
    stats.windows.set(key, win)
  }
  win.samples += 1

  for (const [name, value] of Object.entries(record.counters || {})) {
    if (!Number.isFinite(value) || value === 0) continue
    stats.counters.set(name, (stats.counters.get(name) || 0) + value)
  }

  const lt = record.longTasks
  if (lt) {
    stats.longTasks.count += lt.count || 0
    stats.longTasks.totalMs += lt.totalMs || 0
    stats.longTasks.maxMs = Math.max(stats.longTasks.maxMs, lt.maxMs || 0)
    for (const item of lt.byContainer || []) {
      const prev = stats.longTasks.byContainer.get(item.name) || { count: 0, totalMs: 0, maxMs: 0 }
      prev.count += item.count || 0
      prev.totalMs += item.totalMs || 0
      prev.maxMs = Math.max(prev.maxMs, item.maxMs || 0)
      stats.longTasks.byContainer.set(item.name, prev)
    }
  }

  const loaf = record.loaf
  if (loaf) {
    stats.loaf.frames += loaf.frames || 0
    stats.loaf.blockingMs += loaf.blockingMs || 0
    stats.loaf.maxBlockingMs = Math.max(stats.loaf.maxBlockingMs, loaf.maxBlockingMs || 0)
    stats.loaf.taskMs += loaf.taskMs || 0
    stats.loaf.renderMs += loaf.renderMs || 0
    stats.loaf.maxRenderMs = Math.max(stats.loaf.maxRenderMs, loaf.maxRenderMs || 0)
    stats.loaf.forcedStyleAndLayoutMs += loaf.forcedStyleAndLayoutMs || 0
    for (const item of loaf.byScript || []) {
      const prev = stats.loaf.byScript.get(item.name) || {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        forcedStyleAndLayoutMs: 0,
      }
      prev.count += item.count || 0
      prev.totalMs += item.totalMs || 0
      prev.maxMs = Math.max(prev.maxMs, item.maxMs || 0)
      prev.forcedStyleAndLayoutMs += item.forcedStyleAndLayoutMs || 0
      stats.loaf.byScript.set(item.name, prev)
    }
  }
}

/**
 * 进程占用聚合。
 *
 * tick 里的 procs 是每秒快照，cpu 为瞬时值，因此按 pid 求均值得到该进程
 * 在本段时间里的平均占用。type=Tool 是应用拉起的非 Electron 子进程
 * （工具命令、语言服务、网关 sidecar），它与界面开销的处置方式完全不同，
 * 报告里单独成组。
 */
function accumulateProcs(stats) {
  for (const tick of stats.ticks) {
    const seen = new Set()
    for (const proc of tick.procs || []) {
      const key = `${proc.pid}::${proc.type}::${proc.service || proc.cmd || ''}`
      seen.add(key)
      let item = stats.procs.get(key)
      if (!item) {
        item = {
          pid: proc.pid,
          type: proc.type,
          service: proc.service,
          cmd: proc.cmd,
          samples: 0,
          cpuSum: 0,
          cpuMax: 0,
          wsMax: 0,
          wakeSum: 0,
        }
        stats.procs.set(key, item)
      }
      item.samples += 1
      item.cpuSum += proc.cpu || 0
      item.cpuMax = Math.max(item.cpuMax, proc.cpu || 0)
      item.wsMax = Math.max(item.wsMax, proc.wsMB || 0)
      item.wakeSum += proc.wakeups || 0
    }
    // 未在本轮快照中出现的进程，样本数不变，均值自然按在场时间摊薄
    void seen
  }
}

/* ------------------------------------------------------------------ */
/* 判读                                                                */
/* ------------------------------------------------------------------ */

/**
 * 判读项。
 *
 * level 语义：
 *   verdict  已可定性，读数直接指向一个处置方向
 *   hint     读数有倾向但不足以定性，需要结合场景确认
 *   info     仅为事实陈述，或用于说明某项读数不可用
 */
function judge(stats) {
  const items = []
  const c = (name) => stats.counters.get(name) || 0

  const ticks = stats.ticks
  const appCpu = ticks.map((t) => t.appCpu || 0)
  const toolCpu = ticks.map((t) => t.toolCpu || 0)
  const sysCpu = ticks.map((t) => t.sysCpu || 0)
  const share = ticks.map((t) => t.appCpuSharePct || 0)

  const peakApp = Math.max(0, ...appCpu)
  const peakTool = Math.max(0, ...toolCpu)
  const peakSys = Math.max(0, ...sysCpu)
  const meanShare = mean(share)

  /* 1. 占用归属：应用自身 / 工具子进程 / 应用之外 */
  if (ticks.length > 0) {
    const peakShare = Math.max(0, ...share)
    if (peakSys > 60 && peakShare < 15) {
      items.push({
        level: 'verdict',
        title: '高峰期的占用主要不在本应用',
        detail:
          `系统峰值 ${round(peakSys)}%，而 Electron 进程占整机峰值仅 ${round(peakShare)}%。` +
          `应用外占用 = sysCpu - appCpuSharePct，含其他程序与工具子进程。`,
        next: '先确认高峰期是否有其它程序在跑；在本仓库里继续找是白费力气。',
      })
    } else if (peakTool > peakApp && peakTool > 30) {
      items.push({
        level: 'verdict',
        title: '占用大头是工具子进程，不是界面',
        detail:
          `工具子进程峰值 ${round(peakTool)}%（单核口径），高于 Electron 进程的 ${round(peakApp)}%。` +
          '这类进程由 Agent 执行的命令拉起（tsc / vite / node / rg 等），不在 getAppMetrics 视野内。',
        next: '看下面的工具进程列表定位到具体命令。界面侧的优化对这一段无效。',
      })
      } else if (peakApp > 60) {
        // 单核口径的读数极易被误读：100 表示占满一个核心，多核机器上可超过 100，
        // 而用户看到的系统监视器是整机口径。不换算会让人把「84%」当成整机占用。
        const cores = ticks[0]?.cpuCount || 1
        items.push({
          level: 'verdict',
          title: 'Electron 进程内部存在高占用',
          detail:
            `Electron 进程峰值 ${round(peakApp)}%（单核口径：100 = 占满一个核心），` +
            `${cores} 核机器上相当于整机约 ${round(peakApp / cores)}%；均值 ${round(mean(appCpu))}%。`,
          next: '看下方进程排行定位到具体进程，再对照渲染层计数器判断是哪一环。',
        })
      }
  }

  /* 2. 高频定时器空转：唤醒高但 CPU 低 */
  for (const proc of stats.procs.values()) {
    const avgCpu = proc.samples > 0 ? proc.cpuSum / proc.samples : 0
    const avgWake = proc.samples > 0 ? proc.wakeSum / proc.samples : 0
    if (avgWake > 500 && avgCpu < 10) {
      items.push({
        level: 'hint',
        title: `${proc.type} 进程唤醒次数偏高而占用不高`,
        detail:
          `pid ${proc.pid}${proc.service ? ` (${proc.service})` : ''} 平均每秒唤醒 ${Math.round(avgWake)} 次，` +
          `平均占用仅 ${round(avgCpu)}%。唤醒高、占用低是高频定时器空转的形态。`,
        next: '排查该进程内的定时器周期；把不必要的高频轮询改为事件驱动。',
      })
      break
    }
  }

  /* 3. 流式写入洪峰有多少是白跑的 */
  const calls = c('streamState.calls')
  const skipped = c('streamState.skipped')
  if (calls > 0) {
    const ratio = skipped / calls
    items.push({
      level: ratio > 0.9 ? 'verdict' : 'hint',
      title: `streamState 写入短路率 ${(ratio * 100).toFixed(1)}%`,
      detail:
        `调用 ${calls} 次，其中 ${skipped} 次因键值未变被短路，实际产生新状态 ${c('streamState.commits')} 次。`,
      next:
        ratio > 0.9
          ? '恒等守卫已覆盖绝大部分写入，这条路径不是瓶颈，不必再动。'
          : '短路率偏低说明每次写入几乎都在提交，结合 react.commitMs 看代价落在哪一帧。',
    })
  }

  /* 4. 记忆化是否生效：baseMs 与 commitMs 的比值 */
  const commits = c('react.commits')
  const commitMs = c('react.commitMs')
  const baseMs = c('react.baseMs')
  if (commits > 0) {
    if (baseMs <= 0) {
      // baseMs 来自「不做记忆化」的对照探针，未开启时恒为 0。
      // 把它当成收益比为 0，就是把「没有对照」读成了「记忆化无效」，会直接把排查
      // 方向带到 props 身份上 —— 而这类结论在没有对照时本身无法成立。
      items.push({
        level: 'info',
        title: '无法判定记忆化收益',
        detail:
          `提交 ${commits} 次、累计耗时 ${round(commitMs)}ms，但没有采到对照基线（react.baseMs）。` +
          '该值来自不做记忆化的影子渲染，未开启对照探针时恒为 0。',
        next: '需要判定 memo 是否生效时，先开启对照探针再采集，不要在无对照时下结论。',
      })
    } else {
      const ratio = commitMs > 0 ? baseMs / commitMs : 0
      items.push({
        level: ratio >= 1.5 ? 'verdict' : 'hint',
        title: `记忆化收益比 ${ratio.toFixed(2)}x`,
        detail:
          `提交 ${commits} 次，累计提交耗时 ${round(commitMs)}ms，不做记忆化的估计值 ${round(baseMs)}ms。` +
          '比值明显大于 1 说明 memo 在生效，接近 1 则说明形同虚设。',
        next:
          ratio >= 1.5
            ? '记忆化有效，继续削减提交次数的收益有限。'
            : '记忆化基本无效，检查被穿透的 props 身份（多为内联函数与字面量对象）。',
      })
    }
  }

  /* 5. 提交耗时与长任务的对比：开销落在 JS 还是浏览器样式布局 */
  // 帧窗口内的提交耗时优先：它从帧回调起算到任务结束（含紧随的微任务排空），
  // 覆盖 React 的同步提交，与「这一帧花了多少」同一口径。缺失时退回 Profiler 读数。
  //
  // 两套 API 的口径不同，不能混着读：longTasks 只统计单次超过 50ms 的任务，
  // 而 LoAF 统计的是被标记为长动画帧的「帧」，一帧里可能包含多个短任务。
  // 只看 covered 会把「分散在大量 50ms 以下任务里的脚本时间」整个漏掉，
  // 从而得出「剩余时间都在样式布局」的错误结论 —— 而实际情况可能是
  // 大量未归因的 JS。因此必须同时给出 LoAF 脚本段作为上界对照。
  const totalCommit = c('frame.commitMs') || c('react.commitMs')
  const totalTask = c('frame.taskMs')
  const longTaskMs = stats.longTasks.totalMs
  const loafScriptMs = stats.loaf.taskMs
  if (longTaskMs > 0 && (totalCommit > 0 || totalTask > 0)) {
    const covered = (totalCommit + totalTask) / longTaskMs
    // 判定「有未归因脚本」的参照物应该是我们自己的脚本耗时，不是长任务总时长：
    // LoAF 脚本段包含所有脚本执行，而我们埋点只覆盖帧任务与 React 提交。
    // 两者相差一个量级时，差额就是没有埋点的 JS —— 这部分最容易被
    // 「剩余时间都在样式布局」的结论掩盖掉。
    const ourScriptMs = totalCommit + totalTask
    const unattributedJs =
      loafScriptMs > ourScriptMs * 1.5 && loafScriptMs > longTaskMs * 0.5
        ? loafScriptMs - ourScriptMs
        : 0

    items.push({
      level: unattributedJs > 0 ? 'hint' : 'verdict',
      title:
        unattributedJs > 0
          ? '存在大量未归因的脚本时间'
          : covered < 0.3
            ? '长任务里我们自己的 JS 占比很低'
            : '长任务主要花在我们自己的 JS 上',
      detail:
        `长任务(>50ms) 累计 ${round(longTaskMs)}ms；其中帧任务 ${round(totalTask)}ms、帧内提交 ${round(totalCommit)}ms，` +
        `合计占长任务 ${(covered * 100).toFixed(1)}%。` +
        (unattributedJs > 0
          ? ` 但长动画帧脚本段合计 ${round(loafScriptMs)}ms，比上述两项之和多出约 ${round(unattributedJs)}ms。` +
            '两套 API 口径不同（LoAF 按帧统计，长任务按单次任务统计），差额说明脚本时间分散在大量 50ms 以下的任务里。'
          : ''),
      next:
        unattributedJs > 0
          ? '这段脚本既不在 React 提交里、也不在帧调度器任务里，属于未埋点区域。用 DevTools Performance 录一段复现过程，看主线程火焰图落在哪些函数上，别再猜是样式还是注释性优化。'
          : covered < 0.3
            ? '剩余时间在样式计算、布局、绘制与合成上。继续减少 React 提交次数不会改善占用，应削减每次变更影响的节点规模或简化 CSS。'
            : '削任务与削重渲染是有效方向，优先处理每次提交都重建的那部分子树。',
    })
  }

  /* 6. 帧调度器是否真的合了帧 */
  // 合帧率不能单独读：流式数据一片一片到达，片间隔大于一帧时每帧自然只有
  // 一个任务，perFrame 趋近 1 是到达速率的必然结果，不是调度器失效。
  // 判定它是否值得关注，先看帧任务总共花了多少时间。
  const frameRuns = c('frame.runs')
  const frameTasks = c('frame.tasks')
  if (frameRuns > 0) {
    const perFrame = frameTasks / frameRuns
    const spanMs = ticks.length > 0 ? (ticks[ticks.length - 1].t - ticks[0].t) || 1 : 1
    const frameShare = spanMs > 0 ? totalTask / spanMs : 0

    // 帧任务占比可忽略时，合帧与否都不影响观感，不应占用排查精力
    if (frameShare < 0.01) {
      items.push({
        level: 'info',
        title: `帧调度器开销可忽略（平均每帧 ${perFrame.toFixed(2)} 个任务）`,
        detail:
          `运行 ${frameRuns} 帧、执行 ${frameTasks} 个任务，任务总计仅 ${round(totalTask)}ms，` +
          `占会话时长 ${(frameShare * 100).toFixed(2)}%。`,
        next: '这一项不是瓶颈，合帧率无需优化。',
      })
    } else {
      items.push({
        level: perFrame > 1.2 ? 'verdict' : 'hint',
        title: `帧调度器平均每帧执行 ${perFrame.toFixed(2)} 个任务`,
        detail:
          `运行 ${frameRuns} 帧、执行任务 ${frameTasks} 个，任务总计 ${round(totalTask)}ms，` +
          `占会话时长 ${(frameShare * 100).toFixed(2)}%。`,
        next:
          perFrame > 1.2
            ? '缓冲刷写与插值推进已合帧，一次用户可见更新对应一次提交。'
            : '比值趋近 1 但任务总耗时占比不低，说明每帧都有实际工作而非空转，重点看单个任务本身的成本。',
      })
    }
  }

  /* 7. Markdown 块体积：是否在无边界增长 */
  const blockParses = c('markdown.blockParses')
  const blockChars = c('markdown.blockChars')
  const splitMs = c('markdown.splitMs')
  const cleanMs = c('markdown.cleanMs')
  if (blockParses > 0) {
    const avgBlock = blockChars / blockParses
    items.push({
      level: avgBlock > 20000 ? 'verdict' : 'info',
      title: `Markdown 平均块体积 ${Math.round(avgBlock)} 字符`,
      detail:
        `重新解析 ${blockParses} 块，累计 ${blockChars} 字符；分块耗时 ${round(splitMs)}ms，清洗耗时 ${round(cleanMs)}ms。` +
        '解析成本与块体积近似成正比，平均块体积是唯一可调的变量。',
      next:
        avgBlock > 20000
          ? '平均块偏大，说明存在无空行隔断的超长文本（长代码段最常见）在持续增长。考虑对超长块做体积上限切分。'
          : '块体积在正常范围，分块复用已把单次解析压到「最后一段」的规模。',
    })
  }

  /* 8. 行级 diff：命中即为文件改动卡片的成本 */
  const diffMs = c('diff.linesMs')
  if (diffMs > 0) {
    items.push({
      level: diffMs > 50 ? 'verdict' : 'info',
      title: `行级 diff 累计 ${round(diffMs)}ms`,
      detail:
        `计算 ${c('diff.linesCalls')} 次，缓存命中 ${c('diff.cacheHits')} 次，` +
        `因超出尺寸上限跳过 ${c('diff.skippedTooLarge')} 次。diff 是超线性计算。`,
      next:
        diffMs > 50
          ? '只要这一项量级可观，卡顿就一定与文件改动卡片有关，不必再去猜解析或高亮。'
          : '量级很小，diff 不是卡顿来源。',
    })
  }

  /* 9. 代码高亮：已移出提交路径，总量高但长任务少属预期 */
  const highlightMs = c('highlight.ms')
  if (highlightMs > 0) {
    items.push({
      level: 'info',
      title: `代码高亮累计 ${round(highlightMs)}ms（${c('highlight.calls')} 次）`,
      detail: '高亮已从渲染提交路径挪到空闲时段，因此这一项衡量的是总工作量而非单次阻塞。',
      next: '总量高而长任务少即为预期结果；若长任务同时偏高，说明空闲时段不足以消化高亮队列。',
    })
  }

  /* 10. 长动画帧：时间被切碎在短任务里，还是卡在样式布局 */
  const loaf = stats.loaf
  if (loaf.frames > 0) {
    const scriptKeys = loaf.byScript.size
    const parts = []
    if (loaf.taskMs > 0) parts.push(`脚本段 ${round(loaf.taskMs)}ms`)
    if (loaf.renderMs > 0) parts.push(`渲染段 ${round(loaf.renderMs)}ms`)

    let detail =
      `长动画帧 ${loaf.frames} 帧，累计阻塞 ${round(loaf.blockingMs)}ms，单帧峰值 ${round(loaf.maxBlockingMs)}ms` +
      (parts.length > 0 ? `；${parts.join('，')}` : '') +
      '。'

    if (scriptKeys === 0) {
      detail +=
        ' 本次采样没有拿到任何脚本归因，且分段数据缺失 —— 这属于环境能力缺失，' +
        '不能读成「这些帧里没有脚本执行」。'
    }

    // 归因覆盖率：byScript 只统计被 LoAF 标记出 attributable 的脚本。
    // 覆盖率低时，指向「看脚本归因排行」是无效建议 —— 排行里不会有答案，
    // 只会让人误以为「没有热点」，把排查带到错误的方向。
    const attributedMs = [...loaf.byScript.values()].reduce((sum, i) => sum + i.totalMs, 0)
    const coverage = loaf.taskMs > 0 ? attributedMs / loaf.taskMs : 0
    if (scriptKeys > 0 && coverage < 0.1) {
      detail +=
        ` 脚本归因仅覆盖 ${round(attributedMs)}ms（占脚本段 ${(coverage * 100).toFixed(1)}%），` +
        '大面积未归因属于浏览器能力限制，不代表没有热点。'
    }

    items.push({
      level: 'hint',
      title: '长动画帧构成',
      detail,
      next:
        coverage < 0.1 && loaf.taskMs > 0
          ? '脚本段已经明确存在，但聚合归因覆盖不足，靠本报告无法定位到函数。用 DevTools Performance 录一段复现过程看火焰图。'
          : loaf.renderMs > 0 && loaf.taskMs > 0 && loaf.renderMs > loaf.taskMs * 1.5
            ? '渲染段明显高于脚本段，瓶颈在 DOM 变更量与样式计算复杂度 —— 削减每次变更影响的节点规模，比改 JS 更有效。'
            : loaf.taskMs > 0 && loaf.renderMs > 0 && loaf.taskMs > loaf.renderMs * 1.5
              ? '脚本段明显高于渲染段，时间花在我们自己的 JS 上，优先看上方脚本归因排行。'
              : '两个分段量级接近，说明时间同时分布在自己的 JS 与样式布局上，需结合脚本归因与容器排行分别处理。',
    })
  }

  /* 11. 长任务来源容器 */
  if (stats.longTasks.byContainer.size > 1) {
    const sorted = [...stats.longTasks.byContainer.entries()].sort(
      (a, b) => b[1].totalMs - a[1].totalMs,
    )
    const [name, item] = sorted[0]
    // main-document 是主文档自身的容器名（真实采样里的默认值），不构成「集中在
    // 某个子容器」的证据；不排除它，这一项会在每条记录上恒定命中。
    if (name !== 'main' && name !== 'document' && name !== 'main-document') {
      items.push({
        level: 'hint',
        title: `长任务集中在容器 ${name}`,
        detail: `该容器 ${item.count} 次、累计 ${round(item.totalMs)}ms、单次峰值 ${round(item.maxMs)}ms。`,
        next: '同一渲染进程里多个区域共用主线程账，定位到容器可直接缩小排查范围。',
      })
    }
  }

  /* 12. 采样器自身开销：避免把「诊断在量」读成「应用卡了」 */
  const selfBuild = ticks.map((t) => t.self?.build || 0)
  if (ticks.length > 0) {
    const maxSelf = Math.max(0, ...selfBuild)
    const loopMax = Math.max(0, ...ticks.map((t) => t.loop?.max || 0))
    if (maxSelf > 0) {
      items.push({
        level: maxSelf > 50 ? 'hint' : 'info',
        title: `采样器单次自身开销峰值 ${round(maxSelf)}ms`,
        detail:
          `其中含 getAppMetrics 跨进程收取指标。主进程事件循环延迟峰值 ${round(loopMax)}ms。`,
        next:
          maxSelf > 50
            ? '该开销会计入被测量的 loop 延迟，判读 loop 尖峰时需先扣掉这一段，否则会把采样成本误判为应用卡顿。'
            : '开销可忽略，loop 读数可用。',
      })
    }
  }

  return items
}

/* ------------------------------------------------------------------ */
/* 输出                                                                */
/* ------------------------------------------------------------------ */

function line(char = '─', width = 72) {
  return char.repeat(width)
}

function heading(title) {
  console.log(`\n${title}`)
  console.log(line())
}

function fmtMs(value) {
  return `${round(value)}ms`
}

function printSession(stats, file, badLines) {
  const start = stats.metas.find((m) => m.event === 'start')
  const stop = stats.metas.filter((m) => m.event === 'stop').pop()

  heading('会话')

  console.log(`  文件      ${path.basename(file)}`)
  console.log(`  完整路径  ${file}`)

  if (start) {
    console.log(`  应用版本  ${start.appVersion}`)
    console.log(`  平台      ${start.platform} / ${start.arch} / ${start.cpuCount} 核`)
    console.log(`  采样间隔  ${start.intervalMs}ms`)
    console.log(`  开始时间  ${new Date(start.t).toLocaleString()}`)
  }

  if (start && stop) {
    const seconds = (stop.t - start.t) / 1000
    console.log(`  时长      ${seconds.toFixed(1)}s`)
  } else if (!stop) {
    console.log('  结束标记  缺失（未正常 stop，可能有截断）')
  }

  console.log(
    `  记录      tick ${stats.ticks.length} / 渲染 ${stats.renderers.length} / 锚点 ${stats.anchors.length}`,
  )

  if (stop && stop.dropped) {
    console.log(`  限流丢弃  ${stop.dropped} 条（超过单窗口上限的记录）`)
  }
  if (badLines > 0) {
    console.log(`  坏行      ${badLines} 条（JSON 不完整，已跳过）`)
  }
}

function printCpu(stats) {
  const ticks = stats.ticks
  if (ticks.length === 0) return

  const pick = (fn) => {
    const values = ticks.map(fn)
    return {
      mean: mean(values),
      p95: percentile(values, 95),
      max: Math.max(0, ...values),
    }
  }

  heading('CPU')

  // 同一张表里混着两种归一化基数，读数极易被误读：把单核口径的 4.41% 与全机口径的
  // 21% 并排一看，会得出「应用几乎不吃 CPU」。两者分母不同，必须先换算再比较，
  // 因此把「应用占整机」提到与「系统整体」相邻，并在表下显式点出口径分界。
  const rows = [
    ['系统整体', pick((t) => t.sysCpu || 0), '% 全机口径（100 = 所有核心满载）'],
    ['应用占整机', pick((t) => t.appCpuSharePct || 0), '% 全机口径（可与上一行直接比较）'],
    ['Electron', pick((t) => t.appCpu || 0), '% 单核口径（100 = 占满一个核心）'],
    ['工具子进程', pick((t) => t.toolCpu || 0), '% 单核口径（100 = 占满一个核心）'],
  ]

  console.log('  口径        平均       p95       峰值')
  for (const [name, s, unit] of rows) {
    console.log(
      `  ${name.padEnd(11)} ${String(round(s.mean)).padStart(7)} ${String(round(s.p95)).padStart(8)} ${String(round(s.max)).padStart(9)}  ${unit}`,
    )
  }

  const cores = ticks[0]?.cpuCount || 1
  console.log(
    `\n  口径提示：前两行为全机口径，彼此可直接比较；后两行为单核口径，` +
      `需 ÷ ${cores} 核才换算成全机占用，不要与上面两行直接比。`,
  )

  const loop = pick((t) => t.loop?.mean || 0)
  const loopMax = Math.max(0, ...ticks.map((t) => t.loop?.max || 0))
  console.log(`\n  主进程事件循环  平均 ${fmtMs(loop.mean)}  峰值 ${fmtMs(loopMax)}`)
}

function printProcs(stats, top) {
  if (stats.procs.size === 0) return

  heading('进程排行（按平均占用）')

  const items = [...stats.procs.values()]
    .map((p) => ({
      ...p,
      avgCpu: p.samples > 0 ? p.cpuSum / p.samples : 0,
      avgWake: p.samples > 0 ? p.wakeSum / p.samples : 0,
    }))
    .sort((a, b) => b.avgCpu - a.avgCpu)
    .slice(0, top)

  console.log('  类型        平均CPU   峰值CPU   内存峰值   平均唤醒   进程')
  for (const p of items) {
    const label = p.service || p.cmd ? `${p.type} ${p.service || path.basename(p.cmd || '')}` : p.type
    console.log(
      `  ${String(p.type).padEnd(10)} ${String(round(p.avgCpu)).padStart(7)} ${String(round(p.cpuMax)).padStart(9)} ` +
        `${String(round(p.wsMax)).padStart(9)}MB ${String(Math.round(p.avgWake)).padStart(10)}   ` +
        `${label.slice(0, 34)} (pid ${p.pid})`,
    )
  }
}

function printCounters(stats, top) {
  if (stats.counters.size === 0) {
    console.log('\n  （没有渲染层计数器。确认采集时主窗口处于打开状态，且任务确实产生了流式输出。）')
    return
  }

  heading('渲染层计数器')

  const items = [...stats.counters.entries()].sort((a, b) => b[1] - a[1])

  // 耗时类计数器的键名以 ms 结尾，大小写并存（diff.linesMs / highlight.ms）。
  // 用后缀判定比维护白名单耐用：新增计时项不必同步改这里。
  const isDuration = (key) => /(Ms|\.ms)$/.test(key)
  const timeKeys = items.filter(([k]) => isDuration(k))
  const countKeys = items.filter(([k]) => !isDuration(k))

  if (timeKeys.length > 0) {
    console.log('  累计耗时')
    for (const [name, value] of timeKeys.slice(0, top)) {
      console.log(`    ${name.padEnd(28)} ${String(round(value)).padStart(12)}`)
    }
  }

  if (countKeys.length > 0) {
    console.log('\n  计数与规模')
    for (const [name, value] of countKeys.slice(0, top)) {
      console.log(`    ${name.padEnd(28)} ${String(Math.round(value)).padStart(12)}`)
    }
  }

  const windows = [...stats.windows.entries()]
  if (windows.length > 1) {
    console.log('\n  上报窗口')
    for (const [key, win] of windows) {
      console.log(`    ${String(key).padEnd(28)} ${String(win.samples).padStart(6)} 次采样  (pid ${win.pid ?? '?'})`)
    }
  }
}

function printLongTasks(stats, top) {
  const lt = stats.longTasks
  if (lt.count === 0 && stats.loaf.frames === 0) return

  heading('长任务与长动画帧')

  if (lt.count > 0) {
    console.log(
      `  长任务(>50ms) ${lt.count} 次，累计 ${fmtMs(lt.totalMs)}，单次峰值 ${fmtMs(lt.maxMs)}`,
    )
    const containers = [...lt.byContainer.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)
    for (const [name, item] of containers.slice(0, top)) {
      console.log(
        `    ${String(name).padEnd(28)} ${String(item.count).padStart(6)} 次  ${String(round(item.totalMs)).padStart(10)}ms  峰值 ${round(item.maxMs)}ms`,
      )
    }
  }

  const loaf = stats.loaf
  if (loaf.frames > 0) {
    console.log(
      `\n  长动画帧 ${loaf.frames} 帧，阻塞 ${fmtMs(loaf.blockingMs)}（峰值 ${fmtMs(loaf.maxBlockingMs)}）`,
    )
    if (loaf.taskMs > 0 || loaf.renderMs > 0) {
      console.log(`    脚本段 ${fmtMs(loaf.taskMs)}   渲染段 ${fmtMs(loaf.renderMs)}`)
    }
    if (loaf.forcedStyleAndLayoutMs > 0) {
      console.log(`    强制同步样式/布局 ${fmtMs(loaf.forcedStyleAndLayoutMs)}（读写交替触发的重排）`)
    }
    const scripts = [...loaf.byScript.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)
    if (scripts.length > 0) {
      console.log('\n    脚本归因')
      for (const [name, item] of scripts.slice(0, top)) {
        console.log(
          `      ${String(name).slice(0, 44).padEnd(46)} ${String(round(item.totalMs)).padStart(9)}ms  峰值 ${round(item.maxMs)}ms`,
        )
      }
    }
  }
}

function printTimeline(stats) {
  if (stats.ticks.length === 0) return

  heading('时间线（逐秒）')

  const base = stats.ticks[0].t
  console.log('  时刻     系统   Electron  工具   应用占比   循环延迟   长任务')

  for (const tick of stats.ticks) {
    const at = ((tick.t - base) / 1000).toFixed(0).padStart(4)
    console.log(
      `  ${at}s  ${String(round(tick.sysCpu || 0)).padStart(6)} ${String(round(tick.appCpu || 0)).padStart(9)} ` +
        `${String(round(tick.toolCpu || 0)).padStart(6)} ${String(round(tick.appCpuSharePct || 0)).padStart(9)}% ` +
        `${String(round(tick.loop?.max || 0)).padStart(10)}ms`,
    )
  }
}

function printAnchors(stats) {
  const interesting = stats.anchors.filter((a) => a.name !== 'session')
  if (interesting.length === 0) return

  heading('事件锚点')

  const byName = new Map()
  for (const a of interesting) {
    const item = byName.get(a.name) || { begin: 0, end: 0 }
    item[a.edge] = (item[a.edge] || 0) + 1
    byName.set(a.name, item)
  }

  for (const [name, item] of byName) {
    console.log(`  ${String(name).padEnd(20)} begin ${item.begin} / end ${item.end}`)
  }

  const begin = interesting.find((a) => a.name === 'stream-phase' && a.edge === 'begin')
  const end = [...interesting].reverse().find((a) => a.name === 'stream-phase' && a.edge === 'end')
  if (begin && end) {
    console.log(`\n  首个流式阶段开始于 ${new Date(begin.t).toLocaleTimeString()}，持续 ${((end.t - begin.t) / 1000).toFixed(1)}s`)
  }
}

function printJudgement(items) {
  heading('判读')

  if (items.length === 0) {
    console.log('  没有可判读的信号。')
    return
  }

  const tag = { verdict: '结论', hint: '待确认', info: '说明' }

  for (const item of items) {
    console.log(`\n  [${tag[item.level] || 'info'}] ${item.title}`)
    console.log(`    ${item.detail}`)
    if (item.next) console.log(`    → ${item.next}`)
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function main() {
  const file = resolveInput()
  const { records, bad } = readRecords(file)

  if (records.length === 0) {
    fail(`文件为空或无法解析：${file}`)
  }

  const stats = summarize(records)

  if (FLAGS.json) {
    const payload = {
      file,
      windows: Object.fromEntries(stats.windows),
      counters: Object.fromEntries(stats.counters),
      longTasks: {
        count: stats.longTasks.count,
        totalMs: round(stats.longTasks.totalMs),
        maxMs: round(stats.longTasks.maxMs),
      },
      loaf: {
        frames: stats.loaf.frames,
        blockingMs: round(stats.loaf.blockingMs),
        taskMs: round(stats.loaf.taskMs),
        renderMs: round(stats.loaf.renderMs),
      },
      procs: [...stats.procs.values()].map((p) => ({
        pid: p.pid,
        type: p.type,
        service: p.service,
        cmd: p.cmd,
        avgCpu: round(p.samples > 0 ? p.cpuSum / p.samples : 0),
        maxCpu: round(p.cpuMax),
      })),
      judgement: judge(stats),
    }
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  printSession(stats, file, bad)
  printCpu(stats)
  printProcs(stats, FLAGS.top)
  printCounters(stats, FLAGS.top)
  printLongTasks(stats, FLAGS.top)
  printAnchors(stats)
  if (FLAGS.timeline) printTimeline(stats)
  printJudgement(judge(stats))

  console.log(`\n${line('═')}\n`)
}

main()
