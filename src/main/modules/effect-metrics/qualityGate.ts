/**
 * 插件与场景质量门
 *
 * 定位：回答「这一轮之后，某个插件或者场景是不是变差了」，并把答案压缩成
 * 一条可以据此行动的结论，而不是留一堆数字让人自己看。
 *
 * 与渲染层 gate.ts 的关系：
 * - gate.ts 比对的是离线评测报告（EvalReport），数据来自人工标注样本集，
 *   跑在渲染进程；
 * - 本模块比对的是线上真实运行记录（plugin_quality / session_effect），
 *   跑在主进程。
 * 两者数据结构不同（嵌套报告 vs 扁平指标快照），因此不共用实现，
 * 但沿用同一套判定原则：只对功能损坏设硬红线，体验损耗只告警。
 *
 * 指标方向：质量门的指标全部是「越低越好」——失败率、超时率、无效重试占比、
 * 耗时，没有哪个升高代表改善。因此劣化判定统一为 current > baseline。
 * 若将来引入正向指标（如成功率），需要在此显式补方向声明，不能默认套用。
 *
 * 本模块不读文件、不碰数据库，输入是两份指标快照，因此可以独立单测。
 *
 * @module effect-metrics/qualityGate
 */

/** 质量门作用维度 */
export type QualityGateScope = 'plugin' | 'scenario'

/**
 * 指标规格
 *
 * blocking 的划分依据：这个指标劣化是否意味着「功能损坏」。
 * 失败率与参数无效率升高说明插件本身或它与模型之间的契约出了问题，属功能损坏；
 * 超时与耗时升高可能来自机器负载等外部因素，代价是等待变久，属体验损耗。
 */
interface QualityMetricSpec {
  /** true = 劣化即阻断；false = 劣化仅告警 */
  blocking: boolean
  /** 容忍幅度：ratio 类按绝对增量比，relative 类按相对增幅比 */
  tolerance: number
  kind: 'ratio' | 'relative'
  /** 面向人的指标名，用于报告输出 */
  label: string
}

/**
 * 参与比对的指标表
 *
 * 未登记在此的指标一律不参与比对：宁可漏判，也不要因为口径不明的数字
 * 触发一次阻断。新增指标时连同容忍幅度一起在这里声明。
 */
const METRIC_SPECS: Record<string, QualityMetricSpec> = {
  // —— 插件维度 ——

  'plugin.failureRate': {
    blocking: true,
    tolerance: 0.05,
    kind: 'ratio',
    label: '工具失败率',
  },
  'plugin.invalidArgsRate': {
    // 参数传错多来自模型对这个工具的用法理解不到位，属工具描述与提示词的
    // 问题，不足以判定插件自身缺陷，因此只告警
    blocking: false,
    tolerance: 0.1,
    kind: 'ratio',
    label: '参数无效率',
  },
  'plugin.timeoutRate': {
    blocking: false,
    tolerance: 0.05,
    kind: 'ratio',
    label: '调用超时率',
  },
  'plugin.p95DurationMs': {
    blocking: false,
    tolerance: 0.3,
    kind: 'relative',
    label: '调用 p95 耗时',
  },

  // —— 场景维度 ——

  'scenario.futileRetryRatio': {
    blocking: true,
    tolerance: 0.05,
    kind: 'ratio',
    label: '无效重试占比',
  },
  'scenario.loopDetectionRate': {
    blocking: true,
    tolerance: 0.02,
    kind: 'ratio',
    label: '每会话循环检出次数',
  },
  'scenario.avgSteps': {
    blocking: false,
    tolerance: 0.3,
    kind: 'relative',
    label: '平均会话步数',
  },
  'scenario.interventionsPerSession': {
    // 容忍幅度为 0：需要人盯的次数变多，说明自主性在下降，
    // 这种变化幅度不大也该被看见
    blocking: false,
    tolerance: 0,
    kind: 'ratio',
    label: '每会话人工干预次数',
  },
  'scenario.avgFirstUsefulStep': {
    blocking: false,
    tolerance: 0.2,
    kind: 'relative',
    label: '平均首次可用步序',
  },
}

/** 门禁配置 */
export interface QualityGateConfig {
  /**
   * 插件维度的最小样本量（窗口内调用次数）
   *
   * 样本不足时不阻断：3 次调用里失败 1 次就是 33% 的失败率，
   * 拿这种数字去拦人只会让门禁失去信任。
   */
  minPluginCalls: number
  /** 场景维度的最小样本量（窗口内会话数） */
  minScenarioSessions: number
  /** 逐指标的容忍幅度覆盖，未覆盖的取 METRIC_SPECS 内置值 */
  tolerances: Record<string, number>
}

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  minPluginCalls: 20,
  minScenarioSessions: 5,
  tolerances: {},
}

/** 单条指标变化 */
export interface QualityMetricDelta {
  metric: string
  /** 面向人的指标名 */
  label: string
  baseline: number
  current: number
  /** 变化量：ratio 类为绝对增量，relative 类为相对增幅 */
  delta: number
}

/** 一次聚合得到的指标快照 */
export interface QualitySnapshot {
  /** 扁平指标，键须与 METRIC_SPECS 对应 */
  metrics: Record<string, number>
  /** 参与聚合的样本数：插件维度为调用次数，场景维度为会话数 */
  sampleCount: number
  windowStart: number
  windowEnd: number
}

/** 门禁结论 */
export interface QualityGateResult {
  passed: boolean
  scope: QualityGateScope
  targetId: string
  /** 本次实际参与比对的指标快照 */
  metrics: Record<string, number>
  sampleSize: number
  /** 基线样本量，无基线时为 null */
  baselineSampleSize: number | null
  /** 触发阻断的原因 */
  regressions: QualityMetricDelta[]
  /** 不阻断但需要留意的变化 */
  warnings: Array<QualityMetricDelta & { reason: string }>
  /** 有改善的指标 */
  improvements: QualityMetricDelta[]
  /** 结论说明，供人类可读输出 */
  notes: string[]
}

export interface CompareQualityInput {
  scope: QualityGateScope
  targetId: string
  /** 上次快照，null 表示首次运行 */
  baseline: QualitySnapshot | null
  current: QualitySnapshot
  config?: Partial<QualityGateConfig>
}

/**
 * 基线比对
 *
 * 判定分两层，与 gate.ts 保持一致：
 * 1. 先按方向把指标分成劣化 / 改善两组；
 * 2. 再对劣化组套容忍幅度，超出容忍的按 blocking 归入阻断或告警，
 *    未超出的只在 notes 里留一句，不进告警列表——容忍范围内的波动
 *    天天出现，每次都告警等于没有告警。
 */
export function compareQualityBaseline(input: CompareQualityInput): QualityGateResult {
  const { scope, targetId, baseline, current } = input
  const config: QualityGateConfig = { ...DEFAULT_QUALITY_GATE_CONFIG, ...input.config }

  const notes: string[] = []
  const regressions: QualityMetricDelta[] = []
  const warnings: Array<QualityMetricDelta & { reason: string }> = []
  const improvements: QualityMetricDelta[] = []

  const minSample =
    scope === 'plugin' ? config.minPluginCalls : config.minScenarioSessions

  const base: QualityGateResult = {
    passed: true,
    scope,
    targetId,
    metrics: current.metrics,
    sampleSize: current.sampleCount,
    baselineSampleSize: baseline ? baseline.sampleCount : null,
    regressions,
    warnings,
    improvements,
    notes,
  }

  if (current.sampleCount < minSample) {
    notes.push(
      `样本量不足（${current.sampleCount} / ${minSample}），本次只记录不拦截；` +
      '样本攒够后才会给出阻断结论',
    )
    return base
  }

  if (!baseline) {
    notes.push('首次运行，建立基线，不做阻断')
    return base
  }

  // 基线本身样本太少时，它不是一个可信的参照点：拿 2 次调用的失败率当基准，
  // 后续任何正常波动都会被读成劣化。
  if (baseline.sampleCount < minSample) {
    notes.push(
      `基线样本量不足（${baseline.sampleCount} / ${minSample}），参照点不可信，本次不比对`,
    )
    return base
  }

  for (const [metric, currentValue] of Object.entries(current.metrics)) {
    const spec = METRIC_SPECS[metric]
    if (!spec) {
      notes.push(`${metric}：未登记指标，不参与比对`)
      continue
    }
    if (!(metric in baseline.metrics)) {
      notes.push(`${spec.label}：基线中不存在该指标，本次建立，不参与比对`)
      continue
    }

    const baselineValue = baseline.metrics[metric]
    const delta = computeDelta(spec, baselineValue, currentValue)
    if (delta === null) {
      notes.push(`${spec.label}：基线值为 ${baselineValue}，无法换算增幅，不参与比对`)
      continue
    }

    const entry: QualityMetricDelta = {
      metric,
      label: spec.label,
      baseline: baselineValue,
      current: currentValue,
      delta,
    }

    if (delta < 0) {
      improvements.push(entry)
      continue
    }
    if (delta === 0) continue

    const tolerance = config.tolerances[metric] ?? spec.tolerance
    if (delta <= tolerance) {
      notes.push(
        `${spec.label}上升 ${formatDelta(spec, delta)}，未超过容忍幅度 ${formatDelta(spec, tolerance)}，放行`,
      )
      continue
    }

    if (spec.blocking) {
      regressions.push(entry)
      notes.push(
        `${spec.label}上升 ${formatDelta(spec, delta)}，超过容忍幅度 ` +
        `${formatDelta(spec, tolerance)}，属功能损坏，阻断`,
      )
    } else {
      warnings.push({
        ...entry,
        reason: '体验损耗，不阻断；若持续上升应检查外部因素与实现',
      })
    }
  }

  base.passed = regressions.length === 0
  if (base.passed && regressions.length === 0 && warnings.length === 0) {
    notes.push('与基线一致或更优，放行')
  }

  return base
}

/** 把门禁结论渲染为人类可读文本 */
export function renderQualityGateReport(result: QualityGateResult): string {
  const lines: string[] = []
  const scopeLabel = result.scope === 'plugin' ? '插件' : '场景'

  lines.push(`质量门结论：${result.passed ? '通过' : '阻断'}`)
  lines.push(`${scopeLabel}：${result.targetId}`)
  lines.push(`样本量：${result.sampleSize}${result.baselineSampleSize === null ? '（无基线）' : ` / 基线 ${result.baselineSampleSize}`}`)
  lines.push('')

  if (result.regressions.length > 0) {
    lines.push('阻断项：')
    for (const delta of result.regressions) {
      lines.push(`- ${delta.label}：${format(delta.baseline)} → ${format(delta.current)}`)
    }
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('告警项：')
    for (const warning of result.warnings) {
      lines.push(
        `- ${warning.label}：${format(warning.baseline)} → ${format(warning.current)}（${warning.reason}）`,
      )
    }
    lines.push('')
  }

  if (result.improvements.length > 0) {
    lines.push('改善项：')
    for (const delta of result.improvements) {
      lines.push(`- ${delta.label}：${format(delta.baseline)} → ${format(delta.current)}`)
    }
    lines.push('')
  }

  if (result.notes.length > 0) {
    lines.push('说明：')
    for (const note of result.notes) lines.push(`- ${note}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 换算指标变化量
 *
 * ratio 类直接相减；relative 类算相对增幅。基线为 0 时相对增幅没有意义
 * （任何正值都是无穷倍），返回 null 交给调用方跳过，避免造出一个假阻断。
 */
function computeDelta(
  spec: QualityMetricSpec,
  baseline: number,
  current: number,
): number | null {
  if (spec.kind === 'ratio') return current - baseline
  if (baseline <= 0) return null
  return (current - baseline) / baseline
}

function formatDelta(spec: QualityMetricSpec, delta: number): string {
  if (spec.kind === 'ratio') return `${(delta * 100).toFixed(2)} 个百分点`
  return `${(delta * 100).toFixed(1)}%`
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4)
}
