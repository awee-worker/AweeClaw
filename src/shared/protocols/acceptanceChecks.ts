/**
 * 验收检查点核对
 *
 * 任务收尾前用契约声明的检查点逐条核对执行结果：未通过项要显式列出来，
 * 而不是让任务静默结案。
 *
 * 与任务执行结果里的「验收对照」是两层：那一层由模型自己填写，
 * 本模块做的是独立核对，并把自报结果当作交叉证据，
 * 用于识别「自报已通过、但执行记录里找不到依据」的情况。
 *
 * 分层约定：本模块只做判定，不负责采集证据，也不发起任何外部调用。
 *
 * @module shared/protocols/acceptanceChecks
 */

/** 自动判定的规则类型 */
export type AcceptanceVerifyKind = 'expression' | 'tool'

/** 自动判定规则 */
export interface AcceptanceVerify {
  kind: AcceptanceVerifyKind
  /**
   * 判定载荷：
   * - tool 类：工具名，或以 `path:` 开头的产出路径片段
   * - expression 类：暂不自动判定，见 judgeVerify 的说明
   */
  payload: string
}

/** 验收检查点 */
export interface AcceptanceCheck {
  id: string
  /** 人类可读的验收条件描述 */
  description: string
  /** 可自动判定的规则，缺省表示需人工确认 */
  verify?: AcceptanceVerify
}

/** 单条检查点的核对结论 */
export type AcceptanceVerdict = 'passed' | 'failed' | 'manual'

/** 核对依据 */
export interface AcceptanceEvidence {
  /** 本次任务实际调用过的工具名 */
  usedTools?: string[]
  /** 本次任务实际写入或修改过的文件路径 */
  writtenPaths?: string[]
  /** 模型自报的验收对照，仅作交叉证据 */
  claimed?: Array<{ criteria: string; passed: boolean; note?: string }>
}

/** 单条检查点的核对结果 */
export interface AcceptanceCheckResult {
  id: string
  description: string
  verdict: AcceptanceVerdict
  detail?: string
  /** 自报已通过，但客观证据不支持 */
  overclaim?: boolean
}

/** 整份核对结论 */
export interface AcceptanceOutcome {
  results: AcceptanceCheckResult[]
  /** 是否允许按完成结案：无未通过项即可，待人工确认项不阻塞 */
  passed: boolean
  failedCount: number
  manualCount: number
  /** 自报已通过但缺乏证据的条目数 */
  overclaimCount: number
  /** 可直接进入任务输出的逐条核对文本 */
  summary: string
}

/** 产出路径规则的载荷前缀 */
const PATH_PREFIX = 'path:'

/** 单份契约允许声明的检查点数量上限，避免声明膨胀拖慢收尾 */
const MAX_CHECKS = 32

/** 参与文本匹配的最短长度，过短的描述容易误配 */
const MIN_MATCH_LENGTH = 4

function normalizeCheck(raw: unknown, index: number): AcceptanceCheck | null {
  if (!raw || typeof raw !== 'object') return null

  const item = raw as Record<string, unknown>
  const description = typeof item.description === 'string' ? item.description.trim() : ''
  if (!description) return null

  const rawId = typeof item.id === 'string' ? item.id.trim() : ''
  const id = rawId || `check-${index + 1}`

  let verify: AcceptanceVerify | undefined
  const verifyRaw = item.verify
  if (verifyRaw && typeof verifyRaw === 'object') {
    const candidate = verifyRaw as Record<string, unknown>
    const payload = typeof candidate.payload === 'string' ? candidate.payload.trim() : ''
    if (payload && (candidate.kind === 'tool' || candidate.kind === 'expression')) {
      verify = { kind: candidate.kind, payload }
    }
  }

  return verify ? { id, description, verify } : { id, description }
}

/**
 * 解析检查点声明
 *
 * 声明来自契约或场景配置，可能缺失、格式不符或重复，解析时逐项兜底：
 * 描述为空的项丢弃，id 冲突的项只保留第一条。
 */
export function normalizeAcceptanceChecks(input: unknown): AcceptanceCheck[] {
  if (!Array.isArray(input)) return []

  const checks: AcceptanceCheck[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < input.length && checks.length < MAX_CHECKS; i++) {
    const check = normalizeCheck(input[i], i)
    if (!check || seenIds.has(check.id)) continue
    seenIds.add(check.id)
    checks.push(check)
  }

  return checks
}

/** 归一化文本，用于与自报条目比对（忽略空白、大小写与常见标点） */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s`*_~「」【】（）()：:，,。.、\-—–[\]/]/g, '')
}

/** 在自报结果中查找与该检查点对应的条目 */
function findClaim(
  check: AcceptanceCheck,
  claimed: AcceptanceEvidence['claimed'],
): { criteria: string; passed: boolean; note?: string } | undefined {
  if (!claimed || claimed.length === 0) return undefined

  const target = normalizeText(check.description)
  if (!target) return undefined

  const exact = claimed.find((item) => normalizeText(item.criteria) === target)
  if (exact) return exact

  return claimed.find((item) => {
    const other = normalizeText(item.criteria)
    if (other.length < MIN_MATCH_LENGTH) return false
    return other.includes(target) || target.includes(other)
  })
}

/**
 * 判定单条自动规则
 *
 * 证据缺失（未采集）与证据为空（确实没做过）是两回事：
 * 前者返回 manual 交人工判断，后者才能判 failed，避免误伤。
 */
function judgeVerify(
  verify: AcceptanceVerify,
  evidence: AcceptanceEvidence,
): { verdict: AcceptanceVerdict; detail?: string } {
  if (verify.kind === 'expression') {
    // 不对模型生成的字符串求值：表达式类规则统一按人工确认处理
    return { verdict: 'manual', detail: '表达式类规则暂不自动判定，需人工确认' }
  }

  if (verify.payload.startsWith(PATH_PREFIX)) {
    const fragment = verify.payload.slice(PATH_PREFIX.length).trim()
    if (!fragment) return { verdict: 'manual', detail: '规则缺少路径片段' }

    const paths = evidence.writtenPaths
    if (!paths) return { verdict: 'manual', detail: '本次执行未采集产出路径，无法核对' }

    return paths.some((path) => path.includes(fragment))
      ? { verdict: 'passed', detail: `产出中包含 ${fragment}` }
      : { verdict: 'failed', detail: `产出中未出现 ${fragment}` }
  }

  const tools = evidence.usedTools
  if (!tools) return { verdict: 'manual', detail: '本次执行未采集工具调用记录，无法核对' }

  return tools.includes(verify.payload)
    ? { verdict: 'passed', detail: `已调用 ${verify.payload}` }
    : { verdict: 'failed', detail: `未调用 ${verify.payload}` }
}

/**
 * 逐条核对检查点
 *
 * 结论口径：只要有一条 failed，就不允许按完成结案；
 * 待人工确认项不阻塞，但在报告中列出，避免它们被当成已通过。
 */
export function evaluateAcceptanceChecks(
  checks: AcceptanceCheck[] | null | undefined,
  evidence: AcceptanceEvidence = {},
  language: 'zh' | 'en' = 'zh',
): AcceptanceOutcome {
  const list = Array.isArray(checks) ? checks : []
  const results: AcceptanceCheckResult[] = []

  for (const check of list) {
    const judged = check.verify
      ? judgeVerify(check.verify, evidence)
      : { verdict: 'manual' as AcceptanceVerdict, detail: '未声明自动判定规则，需人工确认' }

    const result: AcceptanceCheckResult = {
      id: check.id,
      description: check.description,
      verdict: judged.verdict,
      detail: judged.detail,
    }

    if (judged.verdict === 'failed' && findClaim(check, evidence.claimed)?.passed) {
      result.overclaim = true
      result.detail = `${judged.detail ?? ''}（自报已通过）`
    }

    results.push(result)
  }

  const outcome: AcceptanceOutcome = {
    results,
    passed: results.every((item) => item.verdict !== 'failed'),
    failedCount: results.filter((item) => item.verdict === 'failed').length,
    manualCount: results.filter((item) => item.verdict === 'manual').length,
    overclaimCount: results.filter((item) => item.overclaim).length,
    summary: '',
  }

  outcome.summary = renderAcceptanceReport(outcome, language)
  return outcome
}

/** 输出逐条核对文本，可直接附在任务结果后 */
export function renderAcceptanceReport(
  outcome: AcceptanceOutcome,
  language: 'zh' | 'en' = 'zh',
): string {
  const isZh = language === 'zh'

  if (outcome.results.length === 0) {
    return isZh
      ? '本次任务未声明验收检查点，无自动核对项。'
      : 'No acceptance checks were declared for this task.'
  }

  const total = outcome.results.length
  const passedCount = total - outcome.failedCount - outcome.manualCount
  const lines: string[] = []

  lines.push(
    isZh
      ? `验收核对：${total} 项，通过 ${passedCount}、未通过 ${outcome.failedCount}、待人工确认 ${outcome.manualCount}`
      : `Acceptance: ${total} checks — ${passedCount} passed, ${outcome.failedCount} failed, ${outcome.manualCount} awaiting manual confirmation`,
  )

  for (const result of outcome.results) {
    const mark =
      result.verdict === 'passed'
        ? isZh
          ? '通过'
          : 'PASS'
        : result.verdict === 'failed'
          ? isZh
            ? '未通过'
            : 'FAIL'
          : isZh
            ? '待确认'
            : 'MANUAL'
    const detail = result.detail ? `（${result.detail}）` : ''
    lines.push(`- [${mark}] ${result.description}${detail}`)
  }

  if (outcome.overclaimCount > 0) {
    lines.push(
      isZh
        ? `注意：${outcome.overclaimCount} 项自报已通过，但执行记录中找不到对应依据。`
        : `Note: ${outcome.overclaimCount} check(s) were reported as passed without supporting evidence.`,
    )
  }

  if (!outcome.passed) {
    lines.push(
      isZh
        ? '存在未通过的验收项，该任务不能按已完成结案。'
        : 'Some acceptance checks failed; this task must not be closed as completed.',
    )
  }

  return lines.join('\n')
}

/** 声明校验发现的问题 */
export interface AcceptanceValidationIssue {
  /** 声明中的位置（0 起） */
  index: number
  id?: string
  message: string
}

/** 声明校验结论 */
export interface AcceptanceValidationResult {
  /** 是否存在阻断项（error 为空即为合法，可发布） */
  valid: boolean
  errors: AcceptanceValidationIssue[]
  warnings: AcceptanceValidationIssue[]
  /** 归一化后的检查点 */
  checks: AcceptanceCheck[]
}

/**
 * 校验检查点声明
 *
 * 用于发布前把关：把结构问题在打包阶段就暴露出来，
 * 而不是等场景安装后运行时才发现声明的检查点全都不生效。
 *
 * 与 normalizeAcceptanceChecks 的分工：归一化只保留可用项、静默丢弃残缺项；
 * 校验则要把丢弃的原因逐条报出来，供发布者修复。
 */
export function validateAcceptanceChecks(raw: unknown): AcceptanceValidationResult {
  const errors: AcceptanceValidationIssue[] = []
  const warnings: AcceptanceValidationIssue[] = []

  // 未声明是许可的：验收检查点是可选能力，不声明就不做核对
  if (raw === undefined || raw === null) {
    return { valid: true, errors, warnings, checks: [] }
  }

  if (!Array.isArray(raw)) {
    errors.push({ index: -1, message: 'acceptanceChecks 必须是数组' })
    return { valid: false, errors, warnings, checks: [] }
  }

  if (raw.length === 0) {
    warnings.push({ index: -1, message: 'acceptanceChecks 为空数组，该声明不会产生任何核对项' })
    return { valid: true, errors, warnings, checks: [] }
  }

  if (raw.length > MAX_CHECKS) {
    warnings.push({
      index: -1,
      message: `检查点数量 ${raw.length} 超过上限 ${MAX_CHECKS}，超出部分不会生效`,
    })
  }

  const seenIds = new Set<string>()

  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push({ index, message: '检查点必须是对象' })
      return
    }

    const entry = item as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const description = typeof entry.description === 'string' ? entry.description.trim() : ''

    if (!id) {
      warnings.push({ index, message: '检查点缺少 id，将按序号自动补位' })
    } else if (seenIds.has(id)) {
      errors.push({ index, id, message: `检查点 id 重复：${id}` })
    } else {
      seenIds.add(id)
    }

    if (!description) {
      errors.push({ index, id: id || undefined, message: '检查点缺少描述' })
    }

    const verify = entry.verify
    if (verify === undefined || verify === null) return

    if (typeof verify !== 'object') {
      errors.push({ index, id: id || undefined, message: 'verify 必须是对象' })
      return
    }

    const rule = verify as Record<string, unknown>
    if (rule.kind !== 'tool' && rule.kind !== 'expression') {
      errors.push({
        index,
        id: id || undefined,
        message: `verify.kind 只支持 tool / expression，当前为 ${String(rule.kind)}`,
      })
      return
    }

    const payload = typeof rule.payload === 'string' ? rule.payload.trim() : ''
    if (!payload) {
      errors.push({ index, id: id || undefined, message: 'verify.payload 不能为空' })
      return
    }

    if (rule.kind === 'expression') {
      warnings.push({
        index,
        id: id || undefined,
        message: 'expression 类规则当前不自动判定，运行时会转人工确认',
      })
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks: normalizeAcceptanceChecks(raw),
  }
}

