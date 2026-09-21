/**
 * 记忆来源信任级别的解析与合并
 *
 * 本模块只做一件事：把已经写进记忆条目的来源字段解读出来，并在多条记忆
 * 合并成一条时决定结果的信任级别。写入侧是否允许落盘由写入守卫负责，不在这里。
 *
 * 核心规则是「向下收敛」：只要参与合并的来源中有一个不可信，结果就不可信。
 * 一旦允许向上提升，外部内容就能靠与可信记忆合并完成洗白，
 * 写入侧的净化会被这条路径整条绕过。
 */

import type { TrustChannel, TrustLevel } from '@intelligence/types/trustTypes'
import type { MemoryEntry } from './types'

/** 记忆来源字段集合 */
export type MemoryOrigin = Pick<
  MemoryEntry,
  'originTrust' | 'originLocator' | 'originChannel' | 'evidence'
>

/** 信任级别解析：无法识别的值返回 undefined，代表来源未知 */
export function parseTrustLevel(raw: string | null | undefined): TrustLevel | undefined {
  if (raw === 'instruction' || raw === 'trusted' || raw === 'untrusted') return raw
  return undefined
}

const TRUST_CHANNELS: TrustChannel[] = [
  'local_fs',
  'local_compute',
  'web',
  'external_service',
  'channel_message',
  'agent',
]

/** 来源通道解析：无法识别的值返回 undefined */
export function parseTrustChannel(raw: string | null | undefined): TrustChannel | undefined {
  if (!raw) return undefined
  return (TRUST_CHANNELS as string[]).includes(raw) ? (raw as TrustChannel) : undefined
}

/**
 * 合并多个来源的信任级别
 *
 * - 存在任一不可信来源 → 不可信
 * - 否则取首个明确的可信级别
 * - 全部来源未知 → 保持未知（交由写入侧兜底，不在此处假定可信）
 */
export function mergeOriginTrust(entries: MemoryOrigin[]): MemoryOrigin {
  if (entries.length === 0) return {}

  const collect = (pick: (entry: MemoryOrigin) => string | undefined): string[] => {
    return [...new Set(entries.map(pick).filter((v): v is string => Boolean(v)))]
  }

  const locators = collect(entry => entry.originLocator)
  const channels = collect(entry => entry.originChannel)
  const locatorSummary =
    locators.length === 0
      ? undefined
      : locators.length <= 3
        ? locators.join(', ')
        : `${locators.slice(0, 3).join(', ')} 等 ${locators.length} 处`

  const hasUntrusted = entries.some(entry => entry.originTrust === 'untrusted')
  const promoted: TrustLevel | undefined = hasUntrusted
    ? 'untrusted'
    : entries.find(entry => entry.originTrust === 'trusted' || entry.originTrust === 'instruction')?.originTrust

  return {
    originTrust: promoted,
    originLocator: locatorSummary,
    // 通道是枚举，多来源时取首个，拼接后会变成非法枚举值
    originChannel: channels[0] as TrustChannel | undefined,
    // 证据取首个非空：合并条目保留一条可追溯的原始凭据即可
    evidence: entries.find(entry => entry.evidence)?.evidence,
  }
}
