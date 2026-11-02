/**
 * 触发器 → 任务账本 的自动建档订阅者
 *
 * 这是把"事件命中"真正落成"任务记录"的那根线。之前 triggerRegistry 的 'hit'
 * 事件广播出去没有任何接收方，命中只停留在日志里。
 *
 * 行为受 automationSettings.autoCreateTask 控制：
 * - 关闭（默认）：命中只记 debug 日志，账本不增长
 * - 开启：每条命中建一条任务记录，停在 queued，不执行
 *
 * 注意这里**不触发执行**。执行由渲染层的任务执行器负责，
 * 并且受另一个开关 autoExecuteTask 控制，两层独立。
 *
 * @module trigger/TaskAutoCreateSubscriber
 */

import { logger } from '@shared/toolkit/LogEngine'
import { automationSettings } from '../automation-settings/AutomationSettingsStore'
import { taskLedger } from '../task-ledger/TaskLedger'
import type { TaskRisk } from '../task-ledger/types'
import { triggerRegistry } from './TriggerRegistry'
import { TRIGGER_LOG_PREFIX, type TriggerHit } from './types'

/** 订阅者依赖的最小接口，便于测试时替换 */
export interface TriggerHitEmitter {
  on(event: 'hit', listener: (hit: TriggerHit) => void): unknown
  off(event: 'hit', listener: (hit: TriggerHit) => void): unknown
}

/** 单条任务标题上限，避免把超长路径整段写进列表 */
const TITLE_MAX = 120

/**
 * 从命中推导任务标题
 *
 * 规则名是给人看的，subject 说明具体是什么东西变了，
 * 两者拼起来比单独任何一个都有信息量。
 */
function buildTitle(hit: TriggerHit): string {
  const name = hit.ruleName || hit.ruleId
  const subject = hit.event.subject || hit.event.eventType
  const title = `${name}: ${subject}`
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title
}

/**
 * 从命中推导风险等级
 *
 * 触发器目前无法判断动作的实际破坏性（规则里的 action.payload 是自由文本），
 * 一律按 low 处理：low 只影响是否需要人工审批，不代表会跳过任何安全校验，
 * 执行阶段仍受工具级授权与沙箱约束。
 */
function resolveRisk(): TaskRisk {
  return 'low'
}

export class TaskAutoCreateSubscriber {
  private readonly emitter: TriggerHitEmitter
  private handler: ((hit: TriggerHit) => void) | null = null

  constructor(emitter: TriggerHitEmitter = triggerRegistry) {
    this.emitter = emitter
  }

  /** 开始订阅（幂等） */
  start(): void {
    if (this.handler) return
    this.handler = (hit: TriggerHit) => this.handleHit(hit)
    this.emitter.on('hit', this.handler)
    logger.system.info(`${TRIGGER_LOG_PREFIX} 任务自动建档订阅者已挂载`)
  }

  /** 停止订阅 */
  stop(): void {
    if (!this.handler) return
    this.emitter.off('hit', this.handler)
    this.handler = null
    logger.system.info(`${TRIGGER_LOG_PREFIX} 任务自动建档订阅者已卸载`)
  }

  private handleHit(hit: TriggerHit): void {
    try {
      if (!automationSettings.get().autoCreateTask) {
        logger.system.debug(
          `${TRIGGER_LOG_PREFIX} 自动建任务已关闭，命中仅记录: ${hit.ruleName}`,
        )
        return
      }

      // 用 dedupKey 做幂等键：同一条规则对同一个主体，冷却窗口内只会命中一次，
      // 但重启恢复、多路径投递仍可能重复触发，幂等创建在这里兜最后一道
      const { idempotent, task } = taskLedger.createIdempotent({
        origin: 'trigger',
        originId: hit.ruleId,
        kind: 'trigger',
        title: buildTitle(hit),
        risk: resolveRisk(),
        idempotencyKey: hit.dedupKey,
        request: {
          ruleId: hit.ruleId,
          ruleName: hit.ruleName,
          sourceType: hit.event.sourceType,
          sourceId: hit.event.sourceId,
          eventType: hit.event.eventType,
          subject: hit.event.subject,
          action: hit.action,
          hitAt: hit.timestamp,
        },
      })

      if (idempotent) {
        logger.system.debug(
          `${TRIGGER_LOG_PREFIX} 命中已存在任务，跳过建档: ${task.id} (${hit.ruleName})`,
        )
      } else {
        logger.system.info(
          `${TRIGGER_LOG_PREFIX} 命中已建档为任务: ${task.id} (${hit.ruleName})`,
        )
      }
    } catch (err) {
      // 建档失败不得影响触发器本身：命中已经派发完了，
      // 这里出问题只是少一条记录，不能反过来把事件处理链路打断
      logger.system.warn(
        `${TRIGGER_LOG_PREFIX} 自动建任务失败: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 全局订阅者单例 */
export const taskAutoCreateSubscriber = new TaskAutoCreateSubscriber()
