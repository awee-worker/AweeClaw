/**
 * quotaUsage.ts — 套餐数量配额的「已用数量」统计
 *
 * 背景
 * ----
 * 套餐能力（PlanFeatures）中的数量上限由创建入口在落库前调用
 * `useFeatureGuard().requireQuota(key, currentCount)` 校验。校验依赖一个
 * 「当前已用数量」，而同一个配额可能对应多个创建入口 —— 若各入口自行
 * 统计，口径一旦不一致，同一配额在不同入口就会给出互相矛盾的判定。
 * 因此所有跨入口的计数集中在此处实现。
 *
 * 口径
 * ----
 * - 项目：后端 /api/v1/projects 的项目总数（「项目」菜单的唯一数据源）
 * - 自动化任务：「自动化」菜单的后端规则数 + 「定时任务」菜单的本地任务数
 *   - 「自动化」创建的是后端 automation_rules 记录
 *   - 「定时任务」创建的是本地 cronScheduler 任务（AI 的 schedule 工具同源）
 *   - 自动化的 schedule 类型规则会在本地 cronScheduler 注册一个带 ruleId
 *     的**镜像任务**，它不是独立任务，必须排除，否则一次创建会被计两次
 *
 * 容错
 * ----
 * 任一数据源不可达时按「该源为空」处理：计数偏小 → 判定偏宽松。这与付费墙
 * 既有的离线降级策略一致（宁可放行，也不因网络问题阻塞用户创建）。
 */
import { automationApi, projectsApi } from './taskProjectApi'
import { api } from './electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEffectiveFeatures,
  isAuthoritativeFeatures,
  getFeatureLimitSync,
} from './featureGuardService'

/** 本地定时任务结构（仅声明计数所需字段） */
interface CronTaskLike {
  ruleId?: string
}

/**
 * 统计「项目」已用数量。
 *
 * 注意：后端不可达时返回 0（宽松放行），调用方可自行决定是否信任该结果。
 */
export async function countProjects(): Promise<number> {
  try {
    const list = await projectsApi.list()
    return list.length
  } catch (e) {
    logger.system.warn('[QuotaUsage] Count projects failed:', e)
    return 0
  }
}

/**
 * 统计「自动化任务」已用数量。
 *
 * 口径 = 后端自动化规则数 + 本地定时任务中「非规则派生」的任务数。
 *
 * 返回值为 -1 时表示无法确定（后端与本地均不可达），调用方应据此放行。
 */
export async function countAutomationTasks(): Promise<number> {
  const [rules, cronTasks] = await Promise.all([
    automationApi.list().catch((e) => {
      logger.system.warn('[QuotaUsage] Fetch automation rules failed:', e)
      return null
    }),
    api.cron
      .getAllTasks()
      .then((res) => (res.success ? res.tasks ?? [] : null))
      .catch((e) => {
        logger.system.warn('[QuotaUsage] Fetch cron tasks failed:', e)
        return null
      }),
  ])

  // 两处都拿不到 → 无法确定用量，交给调用方按宽松策略放行
  if (rules === null && cronTasks === null) return -1

  const ruleCount = rules?.length ?? 0
  const standaloneTaskCount = (cronTasks ?? []).filter(
    (t: CronTaskLike) => !t.ruleId,
  ).length

  return ruleCount + standaloneTaskCount
}

/**
 * 「定时任务」创建前的配额校验（供 AI 工具等无 React 上下文的调用方使用）。
 *
 * 与 `useFeatureGuard().requireQuota` 的差异：
 * - requireQuota 依赖登录态（未登录直接放行）
 * - 此处改为依赖权益快照的**可信度**：快照非权威（未登录 / 离线且无缓存）
 *   一律放行，避免把离线用户挡在门外；只有拿到真实权益时才按上限拦截。
 */
export async function checkAutomationTaskQuota(): Promise<{
  allowed: boolean
  reason?: string
  limit: number
  used: number
}> {
  const eff = await getEffectiveFeatures()
  if (!isAuthoritativeFeatures(eff)) {
    return { allowed: true, limit: -1, used: 0 }
  }

  const used = await countAutomationTasks()
  // 用量未知（后端与本地均不可达）→ 放行
  if (used < 0) return { allowed: true, limit: -1, used: 0 }

  const limit = getFeatureLimitSync('automationTasksLimit', eff.planId)
  const allowed = limit === -1 || used < limit

  return {
    allowed,
    limit,
    used,
    reason: allowed
      ? undefined
      : `已达到当前套餐自动化任务数量上限（${limit} 个），请升级解锁更多`,
  }
}
