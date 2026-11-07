/**
 * 工具终止语义（密封类型）
 *
 * 工具结果此前用业务码表达失败/接管，判定方要在字符串里做前缀匹配，散、脆、易漏。
 * 这里把它们收成一个判别联合：调用方按 `kind` 分支，不再解析文案。
 *
 * 业务码（`TAKEOVER:<reason>` 等）作为 `subtype` 保留，兼容尚未迁移的旧调用方；
 * 新代码优先构造完整 outcome。
 *
 * @module protocols/toolOutcomeProtocol
 */
import type { TakeoverRequest } from './deviceTaskProtocol'

/** 失败子类型：与前端友好文案一一对应 */
export type FailureSubtype =
  /** 目标被遮挡 / 权限拒绝 */
  | 'blocked'
  /** 登录未完成 */
  | 'login_incomplete'
  /** 验证码未完成 */
  | 'captcha_incomplete'
  /** 路径不存在 / 找不到目标 */
  | 'route_failed'
  /** 设备离线 */
  | 'device_unavailable'
  /** 其他交互失败 */
  | 'interaction_failed'

/** 需要用户确认的不可逆动作 */
export interface ToolConfirmRequest {
  /** 动作标识，例如 delete_file / push_branch / send_mail */
  action: string
  /** 给用户看的一句话 */
  message: string
  /** 是否不可逆：不可逆动作即使在免审模式下也必须拦 */
  irreversible?: boolean
  /** 建议置前的窗口标题 */
  foreground?: string | null
}

/**
 * 工具终止结果
 *
 * 只有五种可能，循环看到哪种走哪条路：
 * - ok：成功，继续推进
 * - failure：失败，recoverable 决定是「让模型改参数重试」还是「直接收尾」
 * - takeover：需要人到 PC 上处理（登录/验证码/付款/决策），是正常结局而非异常
 * - input：需要用户补充信息（选项由工具给出）
 * - confirm：需要用户确认不可逆动作
 */
export type ToolOutcome =
  | { kind: 'ok' }
  | { kind: 'failure'; subtype: FailureSubtype; message: string; recoverable: boolean }
  | { kind: 'takeover'; request: TakeoverRequest }
  | { kind: 'input'; prompt: string; options?: string[] }
  | { kind: 'confirm'; request: ToolConfirmRequest }

/** 是否属于「还能继续」的结局 */
export function isContinuableOutcome(outcome: ToolOutcome): boolean {
  if (outcome.kind === 'ok') return true
  if (outcome.kind === 'failure') return outcome.recoverable
  return false
}

/** 从 toolOutcome 取出给用户看的说明；无说明时返回 null */
export function outcomeMessage(outcome: ToolOutcome): string | null {
  switch (outcome.kind) {
    case 'failure':
      return outcome.message
    case 'takeover':
      return outcome.request.message
    case 'input':
      return outcome.prompt
    case 'confirm':
      return outcome.request.message
    default:
      return null
  }
}
