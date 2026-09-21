/**
 * TaskContract - 任务契约
 *
 * 把「本次任务允许做什么」变成可声明、可校验、可审计的契约。
 *
 * 分层约定（避免与既有模块重复实现）：
 * - 本模块是**声明层**：只描述边界、判定单次操作是否越界
 * - TokenQuotaManager 等预算控制器是**执行层**：负责计量与中断
 * 契约不自己数 token，只回答「按声明的额度，现在该不该继续」。
 */

/** 确认策略 */
export type TaskApprovalPolicy = 'default' | 'strict' | 'trusted'

/** 任务契约 */
export interface TaskContract {
  taskId: string
  /** token 上限 */
  tokenBudget: number
  /** 工具白名单（空数组表示不限制） */
  allowedTools: string[]
  /** 类别黑名单 */
  deniedCategories: string[]
  /** 时间上限（毫秒） */
  timeLimitMs: number
  /** 确认策略 */
  approvalPolicy: TaskApprovalPolicy
  /** 是否允许消费外部内容 */
  allowUntrustedContent: boolean
  /** 是否允许写操作 */
  allowWrites: boolean
  /** 契约生效起始时间 */
  issuedAt?: number
  /** 契约失效时间，缺省表示不设失效 */
  expiresAt?: number
}

/** 越界原因 */
export type ContractViolationReason =
  | 'tool_not_allowed'
  | 'category_denied'
  | 'write_not_allowed'
  | 'untrusted_content_not_allowed'
  | 'token_budget_exceeded'
  | 'time_limit_exceeded'
  | 'contract_expired'

export interface ContractCheck {
  allowed: boolean
  reason?: ContractViolationReason
  detail?: string
}

/** 放行结果 */
const ALLOWED: ContractCheck = { allowed: true }

/**
 * 写操作工具
 *
 * 与工具循环检测用的写工具清单同口径，只收录会改变外部状态的工具。
 */
const WRITE_TOOLS = new Set([
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
  'run_command',
])

/** 默认确认策略 */
const APPROVAL_POLICIES: TaskApprovalPolicy[] = ['default', 'strict', 'trusted']

/** 默认时间上限：30 分钟 */
const DEFAULT_TIME_LIMIT_MS = 30 * 60 * 1000

/** 默认 token 上限 */
const DEFAULT_TOKEN_BUDGET = 200_000

/**
 * 创建任务契约
 *
 * 默认值取「宽松但明确」：允许写、不允许消费外部内容。
 * 后者默认关闭是因为外部内容是把指令带进上下文的入口，
 * 需要显式开启，而不是默认放行。
 */
export function createDefaultTaskContract(
  taskId: string,
  overrides: Partial<Omit<TaskContract, 'taskId'>> = {},
): TaskContract {
  return {
    taskId,
    tokenBudget: DEFAULT_TOKEN_BUDGET,
    allowedTools: [],
    deniedCategories: [],
    timeLimitMs: DEFAULT_TIME_LIMIT_MS,
    approvalPolicy: 'default',
    allowUntrustedContent: false,
    allowWrites: true,
    issuedAt: Date.now(),
    ...overrides,
  }
}

/** 校验契约自身是否合法：声明有矛盾时先拦住，别让它去约束执行 */
export function validateTaskContract(contract: TaskContract | null | undefined): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!contract || typeof contract !== 'object') {
    return { valid: false, errors: ['契约缺失'] }
  }

  if (!contract.taskId) errors.push('缺少 taskId')
  if (!(contract.tokenBudget > 0)) errors.push('tokenBudget 必须为正数')
  if (!(contract.timeLimitMs > 0)) errors.push('timeLimitMs 必须为正数')
  if (!Array.isArray(contract.allowedTools)) errors.push('allowedTools 必须是数组')
  if (!Array.isArray(contract.deniedCategories)) errors.push('deniedCategories 必须是数组')

  if (!APPROVAL_POLICIES.includes(contract.approvalPolicy)) {
    errors.push(`未知的确认策略：${String(contract.approvalPolicy)}`)
  }

  if (contract.expiresAt !== undefined && contract.issuedAt !== undefined) {
    if (contract.expiresAt <= contract.issuedAt) errors.push('有效期结束时间早于起始时间')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 判定单个工具是否越界
 *
 * 判定顺序：类别黑名单 → 写权限 → 工具白名单。
 * 把黑名单放前面，是因为黑名单表达「无论如何都不许」，
 * 而白名单表达「默认里挑几个」，前者优先级更高。
 */
export function checkToolAllowed(
  contract: TaskContract,
  toolName: string,
  category?: string,
): ContractCheck {
  if (category && contract.deniedCategories.includes(category)) {
    return {
      allowed: false,
      reason: 'category_denied',
      detail: `类别 ${category} 被契约列入黑名单`,
    }
  }

  if (!contract.allowWrites && WRITE_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: 'write_not_allowed',
      detail: `契约禁止写操作，${toolName} 属于写工具`,
    }
  }

  if (contract.allowedTools.length > 0 && !contract.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: 'tool_not_allowed',
      detail: `${toolName} 不在白名单内`,
    }
  }

  return ALLOWED
}

/** 判定是否允许消费外部内容 */
export function checkUntrustedContent(contract: TaskContract): ContractCheck {
  if (contract.allowUntrustedContent) return ALLOWED
  return {
    allowed: false,
    reason: 'untrusted_content_not_allowed',
    detail: '契约未允许消费外部内容',
  }
}

/** 判定 token 是否超限（计量由执行层提供） */
export function checkTokenBudget(contract: TaskContract, usedTokens: number): ContractCheck {
  if (usedTokens <= contract.tokenBudget) return ALLOWED
  return {
    allowed: false,
    reason: 'token_budget_exceeded',
    detail: `已用 ${usedTokens} tokens，契约上限 ${contract.tokenBudget}`,
  }
}

/** 判定是否超出时间上限 */
export function checkTimeLimit(
  contract: TaskContract,
  startedAt: number,
  now = Date.now(),
): ContractCheck {
  const elapsed = now - startedAt
  if (elapsed <= contract.timeLimitMs) return ALLOWED
  return {
    allowed: false,
    reason: 'time_limit_exceeded',
    detail: `已运行 ${Math.round(elapsed / 1000)}s，契约上限 ${Math.round(contract.timeLimitMs / 1000)}s`,
  }
}

/** 判定契约是否已失效 */
export function checkContractExpiry(contract: TaskContract, now = Date.now()): ContractCheck {
  if (contract.expiresAt === undefined) return ALLOWED
  if (now <= contract.expiresAt) return ALLOWED
  return {
    allowed: false,
    reason: 'contract_expired',
    detail: `契约已于 ${new Date(contract.expiresAt).toISOString()} 失效`,
  }
}

/** 汇总契约的执行前提，逐项判定 */
export function evaluateContract(
  contract: TaskContract,
  state: { usedTokens?: number; startedAt?: number; now?: number } = {},
): ContractCheck {
  const now = state.now ?? Date.now()

  const expiry = checkContractExpiry(contract, now)
  if (!expiry.allowed) return expiry

  if (state.usedTokens !== undefined) {
    const tokenCheck = checkTokenBudget(contract, state.usedTokens)
    if (!tokenCheck.allowed) return tokenCheck
  }

  if (state.startedAt !== undefined) {
    const timeCheck = checkTimeLimit(contract, state.startedAt, now)
    if (!timeCheck.allowed) return timeCheck
  }

  return ALLOWED
}

/**
 * 渲染契约清单
 *
 * 用途：企业场景需要导出「该 Agent 被允许做什么」的说明，
 * 也让用户在长任务开始前能一眼看清边界。
 */
export function summarizeContract(contract: TaskContract, language: 'zh' | 'en' = 'zh'): string {
  const isZh = language === 'zh'
  const lines: string[] = []

  lines.push(isZh ? `任务契约（${contract.taskId}）` : `Task contract (${contract.taskId})`)

  lines.push(
    isZh
      ? `- token 上限：${contract.tokenBudget}`
      : `- Token budget: ${contract.tokenBudget}`,
  )
  lines.push(
    isZh
      ? `- 时间上限：${Math.round(contract.timeLimitMs / 1000)}s`
      : `- Time limit: ${Math.round(contract.timeLimitMs / 1000)}s`,
  )
  lines.push(
    isZh
      ? `- 工具白名单：${contract.allowedTools.length > 0 ? contract.allowedTools.join(', ') : '不限制'}`
      : `- Allowed tools: ${contract.allowedTools.length > 0 ? contract.allowedTools.join(', ') : 'unrestricted'}`,
  )
  lines.push(
    isZh
      ? `- 类别黑名单：${contract.deniedCategories.length > 0 ? contract.deniedCategories.join(', ') : '无'}`
      : `- Denied categories: ${contract.deniedCategories.length > 0 ? contract.deniedCategories.join(', ') : 'none'}`,
  )
  lines.push(
    isZh
      ? `- 写操作：${contract.allowWrites ? '允许' : '禁止'}`
      : `- Writes: ${contract.allowWrites ? 'allowed' : 'denied'}`,
  )
  lines.push(
    isZh
      ? `- 外部内容：${contract.allowUntrustedContent ? '允许消费' : '禁止消费'}`
      : `- Untrusted content: ${contract.allowUntrustedContent ? 'allowed' : 'denied'}`,
  )
  lines.push(
    isZh
      ? `- 确认策略：${contract.approvalPolicy}`
      : `- Approval policy: ${contract.approvalPolicy}`,
  )

  if (contract.expiresAt !== undefined) {
    lines.push(
      isZh
        ? `- 失效时间：${new Date(contract.expiresAt).toISOString()}`
        : `- Expires at: ${new Date(contract.expiresAt).toISOString()}`,
    )
  }

  return lines.join('\n')
}

/** 执行结果摘要 */
export interface ContractOutcome {
  /** 实际使用 token */
  usedTokens?: number
  /** 实际耗时（毫秒） */
  elapsedMs?: number
  /** 触发过的越界判定 */
  violations: Array<{ reason: ContractViolationReason; detail?: string; at: number }>
  /** 整体是否正常结束（未因越界中断） */
  completed: boolean
}

/**
 * 生成审计记录内容
 *
 * 契约与执行结果一并留痕，事后可回答「这次任务是在什么边界下跑的、
 * 有没有越界、越了几次」。
 */
export function toContractAuditEntry(
  contract: TaskContract,
  outcome: ContractOutcome,
): {
  action: string
  taskId: string
  contract: TaskContract
  outcome: ContractOutcome
  violationCount: number
} {
  return {
    action: 'task.contract',
    taskId: contract.taskId,
    contract,
    outcome,
    violationCount: outcome.violations.length,
  }
}
