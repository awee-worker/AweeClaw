/**
 * 场景角色匹配器
 *
 * 三级判定：
 * 1. 显式指定（@提及 / 角色选择器 / 场景默认角色锁定）→ 直接返回
 * 2. 规则匹配（关键词 / 意图 / 附件类型 + 阈值）→ 零延迟默认路径
 * 3. 语义匹配 → P2 交付，此处预留 reason='semantic' 不实现
 *
 * 匹配结果只影响「注入什么」和「是否建议拆子任务」，
 * 不改变主对话的人设与语气（安全边界始终由场景模式决定）。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 第 5 节
 */

import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { RoleDescriptor } from './RoleDescriptor'
import { ROLE_MATCH_THRESHOLD, ROLE_MATCH_WEIGHTS, ROLE_MATCH_GAP } from './RoleDescriptor'
import { detectRoleIntents } from '../planning/RoleIntentDetector'
import { useRoleLibraryStore } from '@renderer/modes/roleLibraryStore'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'

/** 匹配输入 */
export interface RoleMatchInput {
  userMessage: string
  attachments?: Array<{ name: string; ext: string }>
  sceneMode: SceneMode
  /** 当前会话是否已有用户显式指定的角色 */
  explicitRoleId?: string | null
  /** 附件扩展名（与 attachments 二选一，消息组装侧常只持有扩展名列表） */
  attachmentExts?: string[]
}

/** 匹配结果 */
export interface RoleMatchResult {
  /** 命中的角色；未命中为 null，表示沿用场景默认人设 */
  role: RoleDescriptor | null
  score: number
  reason: 'explicit' | 'rule' | 'semantic' | 'none'
  /** 候选列表，供「建议」与子任务拆分参考 */
  candidates: Array<{ roleId: string; score: number }>
  /** 是否建议拆成多角色子任务 */
  multiRoleSuggested: boolean
}

/** 简单对话 / 笼统请求的跳过判定（与 TaskComplexityDetector 口径一致） */
const SKIP_PATTERNS: RegExp[] = [
  /^(你好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好|早安|晚安)[\s!！.。~～]*$/i,
  /^(谢谢|感谢|thanks|thx|多谢|辛苦了)[\s!！.。~～]*$/i,
  /^(好的|ok|okay|嗯|行|可以|没问题|收到|明白|了解|知道了|懂了)[\s!！.。~～]*$/i,
  /^(再见|拜拜|bye)[\s!！.。~～]*$/i,
  /^(继续|接着|go on|continue)[\s!！.。~～]*$/i,
]

/** @角色名 提及解析：支持中英文名，如 @文档撰写、@work.doc-writer */
export function parseRoleMention(message: string): string | null {
  // 形式一：@<角色id>
  const idMatch = message.match(/@(work|life|study)\.[a-z0-9-]+/)
  if (idMatch) return idMatch[0].slice(1)
  // 形式二：@<中文名>（在当前场景的角色里按 nameZh/name 匹配）
  const nameMatches = Array.from(message.matchAll(/@([^\s@，。,]{1,12})/g))
  if (nameMatches.length === 0) return null
  const sceneMode = useSceneModeStore.getState().currentSceneMode
  const roles = useRoleLibraryStore.getState().getRolesByScene(sceneMode)
  for (const m of nameMatches) {
    const name = m[1]
    const hit = roles.find(r => r.nameZh === name || r.name === name)
    if (hit) return hit.id
  }
  return null
}

/** 判断是否为应跳过匹配的简单对话 */
export function isSkipMatchMessage(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed || trimmed.length < 2) return true
  return SKIP_PATTERNS.some(p => p.test(trimmed))
}

/** 收集附件扩展名（小写、不含点） */
function collectExts(input: RoleMatchInput): string[] {
  const exts: string[] = []
  if (input.attachmentExts) exts.push(...input.attachmentExts)
  if (input.attachments) {
    for (const a of input.attachments) {
      const ext = a.ext.replace(/^\./, '').toLowerCase()
      if (ext) exts.push(ext)
      // 兜底：从文件名取扩展名
      const dot = a.name.lastIndexOf('.')
      if (dot >= 0 && dot < a.name.length - 1) {
        exts.push(a.name.slice(dot + 1).toLowerCase())
      }
    }
  }
  return Array.from(new Set(exts))
}

/** 规则层单角色得分 */
function scoreRole(role: RoleDescriptor, message: string, exts: string[], intents: string[]): number {
  const text = message.toLowerCase()
  let score = 0

  // 关键词命中：每个 +0.25，上限 0.75
  let keywordHits = 0
  for (const kw of role.triggers.keywords) {
    if (text.includes(kw.toLowerCase())) {
      keywordHits++
      if (keywordHits * ROLE_MATCH_WEIGHTS.perKeyword >= ROLE_MATCH_WEIGHTS.keywordsCap) break
    }
  }
  score += Math.min(keywordHits * ROLE_MATCH_WEIGHTS.perKeyword, ROLE_MATCH_WEIGHTS.keywordsCap)

  // 意图命中：+0.3
  if (role.triggers.intents.some(i => intents.includes(i))) {
    score += ROLE_MATCH_WEIGHTS.intentHit
  }

  // 附件类型命中：+0.2
  if (role.triggers.fileTypes?.length && exts.some(e => role.triggers.fileTypes!.includes(e))) {
    score += ROLE_MATCH_WEIGHTS.fileTypeHit
  }

  // priority 微调（0~100 → 0~1 的小数部分），只作平局打破
  score += role.priority / 100 * 0.001

  return score
}

/**
 * 场景角色匹配主入口
 *
 * 在 buildSceneModeDirectives() 之前调用，结果供后续注入使用。
 * 自动匹配关闭时完全跳过第二级，只保留显式指定。
 */
export function resolveSceneRole(input: RoleMatchInput): RoleMatchResult {
  const empty: RoleMatchResult = { role: null, score: 0, reason: 'none', candidates: [], multiRoleSuggested: false }
  try {
    const store = useRoleLibraryStore.getState()

    // —— 第一级：显式指定 ——
    // 优先级：会话内选择器 > @提及 > 场景默认角色锁定
    const explicitId =
      input.explicitRoleId ??
      parseRoleMention(input.userMessage) ??
      (store.autoMatchEnabled ? store.getDefaultRole(input.sceneMode)?.id ?? null : null)
    if (explicitId) {
      const role = store.getRole(explicitId)
      if (role && role.sceneMode === input.sceneMode && role.enabled) {
        return {
          role,
          score: 1,
          reason: 'explicit',
          candidates: [{ roleId: role.id, score: 1 }],
          multiRoleSuggested: false,
        }
      }
    }

    // 自动匹配关闭：到此为止
    if (!store.autoMatchEnabled) return empty

    // 简单对话 / 笼统请求直接跳过，不退化为猜测
    if (isSkipMatchMessage(input.userMessage)) return empty

    // —— 第二级：规则匹配 ——
    const roles = store.getEnabledRoles(input.sceneMode)
    if (roles.length === 0) return empty

    const { intents } = detectRoleIntents(input.userMessage)
    const exts = collectExts(input)

    const scored = roles
      .map(role => {
        // 负面关键词一票否决
        if (role.triggers.excludeKeywords?.some(kw => input.userMessage.toLowerCase().includes(kw.toLowerCase()))) {
          return { role, score: 0, excluded: true }
        }
        return { role, score: scoreRole(role, input.userMessage, exts, intents), excluded: false }
      })
      .filter(s => !s.excluded && s.score >= ROLE_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) return empty

    const top = scored[0]
    const second = scored[1]

    // 唯一候选，或最高分比第二名高出 0.2 以上 → 采用
    const uniqueOrClear = scored.length === 1 || (top.score - (second?.score ?? 0)) >= ROLE_MATCH_GAP
    if (uniqueOrClear) {
      return {
        role: top.role,
        score: top.score,
        reason: 'rule',
        candidates: scored.map(s => ({ roleId: s.role.id, score: s.score })),
        multiRoleSuggested: false,
      }
    }

    // 多候选分数接近 → 不自动采用，作为建议交给主 Agent 决定是否拆子任务
    return {
      role: null,
      score: top.score,
      reason: 'rule',
      candidates: scored.map(s => ({ roleId: s.role.id, score: s.score })),
      multiRoleSuggested: true,
    }
  } catch (err) {
    // 匹配失败绝不阻塞主链路
    logger.agent.warn('[SceneRoleMatcher] resolve failed:', err)
    return empty
  }
}
